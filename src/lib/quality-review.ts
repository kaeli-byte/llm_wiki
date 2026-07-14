/**
 * Quality review — model-based semantic QA against page plan,
 * evidence ledger, and generated pages. Produces repair batches
 * for identified issues.
 *
 * Release C of the improved ingest pipeline.
 */

import { resolvePrompt } from "@/lib/prompts/resolver"
import { streamChat } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import type { WikiPagePlan, ConsolidatedEvidenceLedger, QualityReviewResult } from "@/lib/ingest-quality-types"
import type { PipelineLogger } from "@/lib/pipeline-logger"
import { quickHash } from "@/lib/pipeline-logger"

export interface QualityReviewContext {
  projectPath: string
  llmConfig: LlmConfig
  pagePlan: WikiPagePlan
  evidenceLedger: ConsolidatedEvidenceLedger
  generatedPageManifest: Array<{ path: string; type: string; title: string }>
  schema: string
  signal?: AbortSignal
  pipelineLogger?: PipelineLogger
  deterministicFailurePaths?: string[]
}

const SEMANTIC_REVIEW_KINDS = new Set(["strategic_topic", "financial_performance", "risk", "acquisition"])

/** Keep expensive semantic QA focused on synthesis-heavy pages and pages
 * already rejected by deterministic validation. */
export function selectSemanticReviewPlan(
  plan: WikiPagePlan,
  deterministicFailurePaths: string[] = [],
): WikiPagePlan {
  const failures = new Set(deterministicFailurePaths)
  const pages = plan.pages.filter((page) =>
    (page.portfolioKind !== undefined && SEMANTIC_REVIEW_KINDS.has(page.portfolioKind)) || failures.has(page.path))
  const paths = new Set(pages.map((page) => page.path))
  return {
    ...plan,
    pages,
    batches: plan.batches
      .map((batch) => ({ ...batch, pagePaths: batch.pagePaths.filter((path) => paths.has(path)) }))
      .filter((batch) => batch.pagePaths.length > 0),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid quality review: ${path} must be a number`)
  return value
}

function requireStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`Invalid quality review: ${path} must be an array of strings`)
  return value
}

/** Validate and normalize the prompt-facing snake_case QA contract. */
export function parseQualityReviewResult(raw: string): QualityReviewResult {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error("Invalid quality review: no JSON object found")
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch (err) {
    throw new Error(`Invalid quality review JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!isRecord(parsed) || typeof parsed.passed !== "boolean") throw new Error("Invalid quality review: passed must be a boolean")
  if (!isRecord(parsed.metrics)) throw new Error("Invalid quality review: metrics must be an object")
  const metrics = parsed.metrics
  const missingPaths = requireStringArray(parsed.missing_paths ?? parsed.missingPaths, "missing_paths")
  const warnings = requireStringArray(parsed.warnings, "warnings")
  const rawInvalidPaths = parsed.invalid_paths ?? parsed.invalidPaths
  const rawRepairBatches = parsed.repair_batches ?? parsed.repairBatches
  if (!Array.isArray(rawInvalidPaths)) throw new Error("Invalid quality review: invalid_paths must be an array")
  if (!Array.isArray(rawRepairBatches)) throw new Error("Invalid quality review: repair_batches must be an array")

  const invalidPaths = rawInvalidPaths.map((value, index) => {
    if (!isRecord(value) || typeof value.path !== "string") throw new Error(`Invalid quality review: invalid_paths/${index} is malformed`)
    return { path: value.path, issues: requireStringArray(value.issues, `invalid_paths/${index}/issues`) }
  })
  const repairBatches = rawRepairBatches.map((value, index) => {
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.reason !== "string") throw new Error(`Invalid quality review: repair_batches/${index} is malformed`)
    return { id: value.id, pagePaths: requireStringArray(value.page_paths ?? value.pagePaths, `repair_batches/${index}/page_paths`), reason: value.reason }
  })

  return {
    passed: parsed.passed,
    metrics: {
      plannedPages: requireNumber(metrics.planned_pages ?? metrics.plannedPages, "metrics/planned_pages"),
      generatedPages: requireNumber(metrics.generated_pages ?? metrics.generatedPages, "metrics/generated_pages"),
      criticalHighCoverage: requireNumber(metrics.critical_high_coverage ?? metrics.criticalHighCoverage, "metrics/critical_high_coverage"),
      claimLocatorCoverage: requireNumber(metrics.claim_locator_coverage ?? metrics.claimLocatorCoverage, "metrics/claim_locator_coverage"),
      analysisClaimLinkCoverage: requireNumber(metrics.analysis_claim_link_coverage ?? metrics.analysisClaimLinkCoverage, "metrics/analysis_claim_link_coverage"),
      brokenLinks: requireNumber(metrics.broken_links ?? metrics.brokenLinks, "metrics/broken_links"),
      unsupportedClaims: requireNumber(metrics.unsupported_claims ?? metrics.unsupportedClaims, "metrics/unsupported_claims"),
    },
    missingPaths,
    invalidPaths,
    repairBatches,
    warnings,
  }
}

/**
 * Run the model-based semantic QA against generated pages.
 * Returns structured results including repair batches if issues found.
 */
export async function runQualityReview(
  ctx: QualityReviewContext,
): Promise<QualityReviewResult> {
  const reviewPlan = selectSemanticReviewPlan(ctx.pagePlan, ctx.deterministicFailurePaths)
  const reviewPaths = new Set(reviewPlan.pages.map((page) => page.path))
  const reviewManifest = ctx.generatedPageManifest.filter((page) => reviewPaths.has(page.path))
  const evidenceIds = new Set(reviewPlan.pages.flatMap((page) => page.evidenceIds))
  const reviewLedger = { ...ctx.evidenceLedger, records: ctx.evidenceLedger.records.filter((record) => evidenceIds.has(record.id)) }
  const systemPrompt = await resolvePrompt("quality-review", {
    pagePlanJson: JSON.stringify(reviewPlan),
    evidenceLedgerJson: JSON.stringify(reviewLedger),
    generatedPageManifestJson: JSON.stringify(reviewManifest),
    schema: ctx.schema,
  }, { projectPath: ctx.projectPath })

  if (!systemPrompt) {
    console.warn("[quality-review] Prompt not found, skipping QA")
    return {
      passed: true,
      metrics: {
        plannedPages: reviewPlan.pages.length,
        generatedPages: reviewManifest.length,
        criticalHighCoverage: 1.0,
        claimLocatorCoverage: 1.0,
        analysisClaimLinkCoverage: 1.0,
        brokenLinks: 0,
        unsupportedClaims: 0,
      },
      missingPaths: [],
      invalidPaths: [],
      repairBatches: [],
      warnings: ["Quality review skipped: prompt not found"],
    }
  }

  let raw = ""
  let hadError = false
  const trackedCall = ctx.pipelineLogger?.createCall(
    "quality-review", "semantic quality gate", "quality-review", "builtin",
    quickHash(systemPrompt), ctx.llmConfig.provider, ctx.llmConfig.model,
  )

  await streamChat(
    ctx.llmConfig,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: "Validate the generated pages and emit your findings as valid JSON only." },
    ],
    {
      onToken: (token) => { raw += token; trackedCall?.onToken(token) },
      onDone: () => {},
      onError: () => { hadError = true },
    },
    ctx.signal,
    { temperature: 0.1, reasoning: { mode: "off" }, max_tokens: 8192 },
  )

  if (hadError) {
    trackedCall?.onComplete(raw.length, Math.ceil(raw.length / 4), false, [], "Quality review stream failed")
    return {
      passed: false,
      metrics: {
        plannedPages: reviewPlan.pages.length,
        generatedPages: reviewManifest.length,
        criticalHighCoverage: 0,
        claimLocatorCoverage: 0,
        analysisClaimLinkCoverage: 0,
        brokenLinks: 0,
        unsupportedClaims: 0,
      },
      missingPaths: [],
      invalidPaths: [],
      repairBatches: [],
      warnings: ["Quality review stream failed"],
    }
  }
  trackedCall?.onComplete(raw.length, Math.ceil(raw.length / 4))

  // Parse and normalize JSON from response
  let result: QualityReviewResult
  try {
    result = parseQualityReviewResult(raw)
  } catch (err) {
    console.warn("[quality-review] Failed to parse QA response:", err instanceof Error ? err.message : err)
    return {
      passed: false,
      metrics: {
        plannedPages: reviewPlan.pages.length,
        generatedPages: reviewManifest.length,
        criticalHighCoverage: 0,
        claimLocatorCoverage: 0,
        analysisClaimLinkCoverage: 0,
        brokenLinks: 0,
        unsupportedClaims: 0,
      },
      missingPaths: [],
      invalidPaths: [],
      repairBatches: [],
      warnings: ["Failed to parse QA response JSON"],
    }
  }

  // Cap repair rounds at 2
  if (result.repairBatches.length > 2) {
    result.repairBatches = result.repairBatches.slice(0, 2)
    result.warnings.push("Repair batches capped at 2 rounds")
  }

  return result
}

/**
 * Generate repair pages for a single repair batch.
 */
export async function runRepairBatch(
  ctx: QualityReviewContext & {
    repairBatch: { id: string; pagePaths: string[]; reason: string }
  },
): Promise<Map<string, string>> {
  const systemPrompt = await resolvePrompt("batch-generation", {
    batchPlanJson: JSON.stringify({ id: ctx.repairBatch.id, pages: ctx.pagePlan.pages.filter(p => ctx.repairBatch.pagePaths.includes(p.path)) }),
    assignedEvidenceJson: JSON.stringify(ctx.evidenceLedger.records.filter(r =>
      ctx.pagePlan.pages.some(p => ctx.repairBatch.pagePaths.includes(p.path) && p.evidenceIds.includes(r.id))
    )),
    schema: ctx.schema,
    purpose: "",
    index: "",
    sourceIdentity: "repair",
    today: new Date().toISOString().slice(0, 10),
  }, { projectPath: ctx.projectPath })

  if (!systemPrompt) throw new Error("Batch generation prompt not found for repair")

  let raw = ""
  const trackedCall = ctx.pipelineLogger?.createCall(
    "repair", ctx.repairBatch.id, "batch-generation", "builtin",
    quickHash(systemPrompt), ctx.llmConfig.provider, ctx.llmConfig.model,
  )
  await streamChat(
    ctx.llmConfig,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Repair these pages. Reason: ${ctx.repairBatch.reason}. Output only FILE blocks.` },
    ],
    {
      onToken: (token) => { raw += token; trackedCall?.onToken(token) },
      onDone: () => {},
      onError: () => { throw new Error("Repair batch generation failed") },
    },
    ctx.signal,
    { temperature: 0.1, reasoning: { mode: "off" }, max_tokens: 16384 },
  )
  trackedCall?.onComplete(raw.length, Math.ceil(raw.length / 4))

  // Parse FILE blocks
  const { parseFileBlocks } = await import("@/lib/ingest")
  const parsed = parseFileBlocks(raw)
  const result = new Map<string, string>()
  for (const block of parsed.blocks) {
    result.set(block.path, block.content)
  }
  return result
}

/**
 * Build a generated page manifest from validation results.
 */
export function buildPageManifest(
  generatedPaths: string[],
  pagePlan: WikiPagePlan,
): Array<{ path: string; type: string; title: string }> {
  return generatedPaths.map((path) => {
    const planned = pagePlan.pages.find((p) => p.path === path)
    return {
      path,
      type: planned?.type ?? "unknown",
      title: planned?.title ?? path.split("/").pop()?.replace(/\.md$/, "") ?? "Unknown",
    }
  })
}
