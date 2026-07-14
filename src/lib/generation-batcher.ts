/**
 * Generation batcher — token-aware page batching, batch continuation,
 * staging directory writes, transactional commit to wiki, and
 * truncation recovery.
 *
 * Release C of the improved ingest pipeline.
 */

import { parseFileBlocks, type ParsedFileBlock, type ParseFileBlocksResult } from "@/lib/ingest"
import { writeFile, createDirectory, deleteFile, listDirectory, readFile } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { resolvePrompt } from "@/lib/prompts/resolver"
import { streamChat } from "@/lib/llm-client"
import { normalizePath } from "@/lib/path-utils"
import { validateGeneratedPages, type BatchValidationResult } from "@/lib/page-validator"
import { computeIngestGenerationMaxTokens } from "@/lib/ingest"
import type { LlmConfig } from "@/stores/wiki-store"
import type { WikiPagePlan, PlannedPage, ConsolidatedEvidenceLedger } from "@/lib/ingest-quality-types"
import type { PipelineLogger } from "@/lib/pipeline-logger"
import { quickHash } from "@/lib/pipeline-logger"

// ── Batch status tracking ──

export type BatchStatus = "pending" | "generating" | "generated" | "invalid" | "written"

export interface BatchResult {
  batchId: string
  status: BatchStatus
  paths: string[]
  generatedPaths: string[]
  blockCount: number
  truncated: boolean
  validation?: BatchValidationResult
  error?: string
}

export interface BatchGenerationResult {
  success: boolean
  batches: BatchResult[]
  totalGeneratedPages: number
  totalPlannedPages: number
  stagingDir: string
  warnings: string[]
}

export interface BatchGenerationContext {
  projectPath: string
  sourceSummarySlug: string
  sourceIdentity: string
  llmConfig: LlmConfig
  plan: WikiPagePlan
  evidenceLedger: ConsolidatedEvidenceLedger
  schema: string
  purpose: string
  index: string
  signal?: AbortSignal
  activityId: string
  onBatchProgress?: (batchIndex: number, total: number, status: string) => void
  pipelineLogger?: PipelineLogger
  maxConcurrentBatches?: number
}

// ── Token estimation ──

function estimateBatchOutputTokens(pages: PlannedPage[]): number {
  let total = 0
  for (const page of pages) {
    // Frontmatter overhead ~200 tokens, FILE markers ~30 tokens
    // Body: max_words * ~1.3 tokens per word (approx)
    const bodyTokens = (page.maxWords ?? 300) * 1.3
    total += 230 + bodyTokens
  }
  return Math.ceil(total)
}

// ── Staging ──

function stagingPath(projectPath: string, sourceSlug: string): string {
  return normalizePath(`${projectPath}/.llm-wiki/staging/${sourceSlug}`)
}

async function writeStagedFile(
  stagingRoot: string,
  relativePath: string,
  content: string,
): Promise<string> {
  const fullPath = normalizePath(`${stagingRoot}/${relativePath}`)
  const dir = fullPath.slice(0, fullPath.lastIndexOf("/"))
  await createDirectory(dir)
  await writeFile(fullPath, content)
  return fullPath
}

async function commitStagedToWiki(
  stagingRoot: string,
  projectPath: string,
  files: Map<string, string>,
): Promise<string[]> {
  const written: string[] = []
  for (const [relativePath, content] of files) {
    const wikiPath = normalizePath(`${projectPath}/${relativePath}`)
    const dir = wikiPath.slice(0, wikiPath.lastIndexOf("/"))
    await createDirectory(dir)
    await writeFile(wikiPath, content)
    written.push(relativePath)
  }

  // Clean up staging directory
  try {
    await deleteFile(stagingRoot)
  } catch {
    console.warn(`[batcher] Failed to clean staging directory: ${stagingRoot}`)
  }

  return written
}

function flattenFiles(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap((node) => node.is_dir ? flattenFiles(node.children ?? []) : [node])
}

function hasStructuralPageBody(content: string): boolean {
  return /^---\n[\s\S]*?\n---\n/.test(content.trim())
}

async function loadRetainedStagedFiles(
  stagingRoot: string,
  plannedPaths: Set<string>,
): Promise<Map<string, string>> {
  const retained = new Map<string, string>()
  try {
    const nodes = await listDirectory(stagingRoot, { includeHidden: true, maxDepth: 12 })
    const prefix = `${normalizePath(stagingRoot)}/`
    for (const node of flattenFiles(nodes)) {
      const fullPath = normalizePath(node.path)
      if (!fullPath.startsWith(prefix)) continue
      const relativePath = fullPath.slice(prefix.length)
      if (!plannedPaths.has(relativePath)) continue
      const content = await readFile(fullPath)
      if (hasStructuralPageBody(content)) retained.set(relativePath, content)
    }
  } catch {
    // No previous staging tree, or a stale unreadable tree. Generation
    // will recreate only the missing planned pages.
  }
  return retained
}

// ── Batch generation ──

async function generateSingleBatch(
  ctx: BatchGenerationContext,
  batchId: string,
  pagePaths: string[],
  maxOutputTokens: number,
): Promise<{ blocks: ParsedFileBlock[]; raw: string; truncated: boolean; warnings: string[] }> {
  const pages = ctx.plan.pages.filter((p) => pagePaths.includes(p.path))
  const assignedIds = new Set(pages.flatMap((p) => p.evidenceIds))
  const assignedEvidence = ctx.evidenceLedger.records.filter((r) => assignedIds.has(r.id))

  const systemPrompt = (await resolvePrompt("batch-generation", {
    batchPlanJson: JSON.stringify({ id: batchId, pages }),
    assignedEvidenceJson: JSON.stringify(assignedEvidence),
    schema: ctx.schema,
    purpose: ctx.purpose,
    index: ctx.index,
    sourceIdentity: ctx.sourceIdentity,
    today: new Date().toISOString().slice(0, 10),
  }, { projectPath: ctx.projectPath }))

  if (!systemPrompt) throw new Error(`Batch generation prompt not found`)

  let raw = ""
  let hadError = false
  const trackedCall = ctx.pipelineLogger?.createCall(
    "batch-generation",
    batchId,
    "batch-generation",
    "builtin",
    quickHash(systemPrompt),
    ctx.llmConfig.provider,
    ctx.llmConfig.model,
  )

  await streamChat(
    ctx.llmConfig,
    [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          `Generate exactly the pages listed in BATCH_PLAN. Your response must begin with ---FILE:.`,
          `No preamble, no commentary. Output ONLY FILE blocks.`,
        ].join("\n"),
      },
    ],
    {
      onToken: (token) => { raw += token; trackedCall?.onToken(token) },
      onDone: () => {},
      onError: () => { hadError = true },
    },
    ctx.signal,
    {
      temperature: 0.1,
      reasoning: { mode: "off" },
      max_tokens: maxOutputTokens,
    },
  )

  if (hadError) throw new Error("Batch generation stream failed")

  // Parse FILE blocks
  const parsed: ParseFileBlocksResult = parseFileBlocks(raw)
  let blocks = parsed.blocks
  let acceptedEofFallback = false
  if (pagePaths.length === 1 && !blocks.some((block) => block.path === pagePaths[0])) {
    const fallback = extractExpectedSinglePageAtEof(raw, pagePaths[0])
    if (fallback) {
      blocks = [fallback]
      acceptedEofFallback = true
    }
  }
  const truncated = !acceptedEofFallback && parsed.warnings.some((w) =>
    w.includes("was not closed before end of stream") || w.includes("likely truncation"),
  )
  trackedCall?.onComplete(raw.length, Math.ceil(raw.length / 4), truncated, parsed.warnings)

  return {
    blocks,
    raw,
    truncated,
    warnings: parsed.warnings,
  }
}

/**
 * DeepSeek sometimes finishes a complete one-page body but omits the
 * transport-only END FILE line. This fallback is deliberately narrow:
 * one exact opener, no competing opener/closer, and valid frontmatter.
 */
export function extractExpectedSinglePageAtEof(
  raw: string,
  expectedPath: string,
): ParsedFileBlock | null {
  const lines = raw.replace(/\r\n/g, "\n").split("\n")
  const opener = /^---\s*FILE:\s*(.+?)\s*---\s*$/i
  const closer = /^---\s*END\s+FILE\s*---\s*$/i
  const openerIndexes: number[] = []
  for (let index = 0; index < lines.length; index++) {
    if (opener.test(lines[index])) openerIndexes.push(index)
  }
  if (openerIndexes.length !== 1 || lines.some((line) => closer.test(line))) return null
  const openerMatch = opener.exec(lines[openerIndexes[0]])
  if (!openerMatch || openerMatch[1].trim() !== expectedPath) return null
  const content = lines.slice(openerIndexes[0] + 1).join("\n").trim()
  if (!hasStructuralPageBody(content)) return null
  return { path: expectedPath, content }
}

// ── Batch continuation after truncation ──

async function continueTruncatedBatch(ctx: BatchGenerationContext,
  batchId: string,
  pagePaths: string[],
  maxOutputTokens: number,
): Promise<{ blocks: ParsedFileBlock[]; raw: string; truncated: boolean; warnings: string[] }> {
  // Only generate remaining pages (those whose FILE blocks weren't completed)
  const result = await generateSingleBatch(ctx, batchId, pagePaths, maxOutputTokens)
  return result
}

// ── Main entry point ──

export async function generateWikiPagesInBatches(
  ctx: BatchGenerationContext,
): Promise<BatchGenerationResult> {
  const pp = normalizePath(ctx.projectPath)
  const stagingRoot = stagingPath(pp, ctx.sourceSummarySlug)
  await createDirectory(stagingRoot)

  const results: BatchResult[] = []
  const allGeneratedFiles = new Map<string, string>() // path → content
  const warnings: string[] = []
  const plannedPaths = new Set(ctx.plan.pages.map((page) => page.path))
  const retainedFiles = await loadRetainedStagedFiles(stagingRoot, plannedPaths)
  const maxOutputTokens = computeIngestGenerationMaxTokens(ctx.llmConfig.maxContextSize)
  for (const [path, content] of retainedFiles) allGeneratedFiles.set(path, content)

  const processBatch = async (batch: WikiPagePlan["batches"][number], batchIndex: number): Promise<void> => {
    if (batch.pagePaths.every((path) => allGeneratedFiles.has(path))) {
      results.push({
        batchId: batch.id,
        status: "generated",
        paths: batch.pagePaths,
        generatedPaths: [...batch.pagePaths],
        blockCount: batch.pagePaths.length,
        truncated: false,
      })
      return
    }
    ctx.onBatchProgress?.(
      batchIndex + 1,
      ctx.plan.batches.length,
      `Generating batch ${batch.id}...`,
    )

    const estimatedTokens = estimateBatchOutputTokens(
      ctx.plan.pages.filter((p) => batch.pagePaths.includes(p.path)),
    )
    const containsSource = ctx.plan.pages.some((page) =>
      batch.pagePaths.includes(page.path) && page.type === "source")
    const minimumTokens = batch.pagePaths.length === 1
      ? (containsSource ? 8_192 : 4_096)
      : 4_096
    const batchTokens = Math.min(Math.max(estimatedTokens, minimumTokens), maxOutputTokens)

    let batchResult: BatchResult = {
      batchId: batch.id,
      status: "generating",
      paths: batch.pagePaths,
      generatedPaths: [],
      blockCount: 0,
      truncated: false,
    }

    try {
      // First attempt
      const { blocks, raw: _raw, truncated, warnings: batchWarnings } = await generateSingleBatch(
        ctx,
        batch.id,
        batch.pagePaths,
        batchTokens,
      )
      warnings.push(...batchWarnings)

      let allBlocks = blocks

      // If truncated, attempt one continuation
      if (truncated) {
        ctx.onBatchProgress?.(batchIndex + 1, ctx.plan.batches.length, `Continuing truncated batch ${batch.id}...`)

        // Find which paths still need generation
        const completedPaths = new Set(blocks.map((b) => b.path))
        const remainingPaths = batch.pagePaths.filter((p) => !completedPaths.has(p))

        if (remainingPaths.length > 0) {
          const continuation = await continueTruncatedBatch(
            ctx,
            batch.id,
            remainingPaths,
            Math.floor(batchTokens * 0.5),
          )
          allBlocks = [...blocks, ...continuation.blocks]
          batchResult.truncated = continuation.truncated
          warnings.push(...continuation.warnings)
        }
      }

      // Write to staging directory
      for (const block of allBlocks) {
        if (!plannedPaths.has(block.path)) {
          warnings.push(`Batch ${batch.id} returned unplanned path ${block.path}; block ignored`)
          continue
        }
        await writeStagedFile(stagingRoot, block.path, block.content)
        allGeneratedFiles.set(block.path, block.content)
        batchResult.generatedPaths.push(block.path)
      }

      batchResult.blockCount = allBlocks.length
      batchResult.status = "generated"
      results.push(batchResult)
    } catch (err) {
      batchResult.status = "invalid"
      batchResult.error = err instanceof Error ? err.message : String(err)
      results.push(batchResult)

      console.warn(`[batcher] Batch ${batch.id} failed:`, batchResult.error)
      warnings.push(`Batch ${batch.id} failed: ${batchResult.error}`)

      // Don't fail the entire run for one batch — collect results
      return
    }
  }
  const concurrency = Math.max(1, Math.min(4, ctx.maxConcurrentBatches ?? 3))
  for (let offset = 0; offset < ctx.plan.batches.length; offset += concurrency) {
    await Promise.all(ctx.plan.batches.slice(offset, offset + concurrency)
      .map((batch, index) => processBatch(batch, offset + index)))
  }
  results.sort((a, b) => a.batchId.localeCompare(b.batchId))

  let missingPaths = [...plannedPaths].filter((path) => !allGeneratedFiles.has(path))
  if (missingPaths.length > 0) {
    warnings.push(`Focused recovery for ${missingPaths.length} missing planned page(s)`)
    for (let index = 0; index < missingPaths.length; index++) {
      const path = missingPaths[index]
      const page = ctx.plan.pages.find((candidate) => candidate.path === path)
      if (!page) continue
      const recoveryId = `recovery-${String(index + 1).padStart(3, "0")}`
      const recoveryResult: BatchResult = {
        batchId: recoveryId,
        status: "generating",
        paths: [path],
        generatedPaths: [],
        blockCount: 0,
        truncated: false,
      }
      try {
        ctx.onBatchProgress?.(
          ctx.plan.batches.length + index + 1,
          ctx.plan.batches.length + missingPaths.length,
          `Recovering missing page ${index + 1}/${missingPaths.length}...`,
        )
        const pageTokens = Math.min(
          Math.max(estimateBatchOutputTokens([page]), page.type === "source" ? 8_192 : 4_096),
          maxOutputTokens,
        )
        const recovery = await generateSingleBatch(ctx, recoveryId, [path], pageTokens)
        recoveryResult.truncated = recovery.truncated
        warnings.push(...recovery.warnings)
        for (const block of recovery.blocks) {
          if (block.path !== path) {
            warnings.push(`Recovery for ${path} returned ${block.path}; block ignored`)
            continue
          }
          await writeStagedFile(stagingRoot, block.path, block.content)
          allGeneratedFiles.set(block.path, block.content)
          recoveryResult.generatedPaths.push(block.path)
        }
        recoveryResult.blockCount = recovery.blocks.length
        recoveryResult.status = recoveryResult.generatedPaths.includes(path) ? "generated" : "invalid"
        if (recoveryResult.status === "invalid") recoveryResult.error = `Recovery did not produce ${path}`
      } catch (err) {
        recoveryResult.status = "invalid"
        recoveryResult.error = err instanceof Error ? err.message : String(err)
      }
      results.push(recoveryResult)
    }
    missingPaths = [...plannedPaths].filter((path) => !allGeneratedFiles.has(path))
  }
  if (missingPaths.length > 0) {
    warnings.push(`Missing planned pages: ${missingPaths.join(", ")}`)
  }
  const hasUnrecoveredInvalidBatch = results.some((result) =>
    result.status === "invalid" && result.paths.some((path) => !allGeneratedFiles.has(path)))
  const complete = !hasUnrecoveredInvalidBatch && missingPaths.length === 0

  // ── Commit to wiki only when the complete approved plan exists ──
  if (complete && allGeneratedFiles.size > 0) {
    await commitStagedToWiki(stagingRoot, pp, allGeneratedFiles)
    console.log(`[batcher] Committed ${allGeneratedFiles.size} files to wiki`)
  }

  return {
    success: complete,
    batches: results,
    totalGeneratedPages: allGeneratedFiles.size,
    totalPlannedPages: ctx.plan.pages.length,
    stagingDir: stagingRoot,
    warnings,
  }
}

// ── Validation after generation ──

export function validateAllBatches(
  generatedFiles: Map<string, string>,
  plan: WikiPagePlan,
  evidenceLedger: ConsolidatedEvidenceLedger,
): BatchValidationResult {
  return validateGeneratedPages(generatedFiles, plan, evidenceLedger)
}
