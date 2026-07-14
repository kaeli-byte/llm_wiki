/**
 * Pipeline logger — structured observability for the ingest pipeline.
 * Saves run artifacts under .llm-wiki/runs/<run-id>/ for every stage:
 * resolved prompts, LLM inputs/outputs, timing, token counts, and errors.
 *
 * Phase 0 of the improved ingest pipeline.
 */

import { createDirectory, readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

export type StageName =
  | "startup"
  | "mineru"
  | "source-read"
  | "cache-check"
  | "chunking"
  | "evidence-extraction"
  | "evidence-consolidation"
  | "entity-resolution"
  | "entity-resolution-repair"
  | "page-planning"
  | "batch-generation"
  | "quality-review"
  | "repair"
  | "validation"
  | "index-update"
  | "cache-save"
  | "analysis"
  | "generation"
  | "chunking"
  | "cache-check"
  | "complete"
  | "error"

export interface StageEntry {
  name: StageName
  startedAt: string
  completedAt?: string
  status: "running" | "completed" | "failed"
  detail?: string
  durationMs?: number
  error?: string
}

export interface LlmCallEntry {
  callId: string
  stage: StageName
  purpose: string
  promptName: string
  promptSource: "override" | "builtin" | "fallback"
  promptHash: string
  modelProvider: string
  modelName: string
  startedAt: string
  completedAt?: string
  durationMs?: number
  inputTokensEstimate?: number
  outputTokensActual?: number
  outputLengthChars?: number
  truncated: boolean
  parseWarnings: string[]
  error?: string
}

export interface PipelineManifest {
  runId: string
  sourceIdentity: string
  sourcePath: string
  sourceSizeBytes: number
  sourceContentHash: string
  sourceLengthChars: number
  chunked: boolean
  chunkCount: number
  startedAt: string
  completedAt?: string
  stages: StageEntry[]
  llmCalls: LlmCallEntry[]
  verifiedWrittenPaths: string[]
  summary: {
    totalLlmCalls: number
    totalLlmDurationMs: number
    totalOutputTokens: number
    totalPagesGenerated: number
    qualityPassed?: boolean
    verifiedFilesWritten: number
    errors: string[]
  }
}

export class PipelineLogger {
  projectPath: string
  runId: string
  basePath: string
  manifest: PipelineManifest
  private stages: Map<string, StageEntry>
  private llmCalls: LlmCallEntry[]
  private startTimes: Map<string, number>
  private logFilePath: string
  private logContent: string
  private logInitialized: boolean
  private logWrite: Promise<void>
  private callCounter: number

  constructor(
    projectPath: string,
    sourceIdentity: string,
    sourcePath: string,
    sourceSizeBytes: number,
    sourceContentHash: string,
    sourceLengthChars: number,
  ) {
    this.projectPath = normalizePath(projectPath)
    this.runId = `${sourceIdentity.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40)}-${new Date().toISOString().replace(/[:.]/g, "-")}`
    this.basePath = `${this.projectPath}/.llm-wiki/runs/${this.runId}`
    this.stages = new Map()
    this.llmCalls = []
    this.startTimes = new Map()
    this.callCounter = 0
    this.logFilePath = `${this.projectPath}/.llm-wiki/pipeline.log`
    this.logContent = ""
    this.logInitialized = false
    this.logWrite = Promise.resolve()
    this.manifest = {
      runId: this.runId,
      sourceIdentity,
      sourcePath,
      sourceSizeBytes,
      sourceContentHash,
      sourceLengthChars,
      chunked: false,
      chunkCount: 0,
      startedAt: new Date().toISOString(),
      stages: [],
      llmCalls: [],
      verifiedWrittenPaths: [],
      summary: {
        totalLlmCalls: 0,
        totalLlmDurationMs: 0,
        totalOutputTokens: 0,
        totalPagesGenerated: 0,
        verifiedFilesWritten: 0,
        errors: [],
      },
    }
  }

  getRunId(): string {
    return this.runId
  }

  getBasePath(): string {
    return this.basePath
  }


  async ensureDirectories(): Promise<void> {
    await createDirectory(this.basePath)
    await createDirectory(`${this.basePath}/resolved-prompts`)
    await createDirectory(`${this.basePath}/llm-calls`)
    await createDirectory(`${this.basePath}/batches`)
    await createDirectory(`${this.basePath}/evidence`)
  }

  private appendLog(level: string, message: string): Promise<void> {
    this.logWrite = this.logWrite.then(async () => {
      if (!this.logInitialized) {
        try {
          this.logContent = await readFile(this.logFilePath)
        } catch {
          this.logContent = ""
        }
        this.logInitialized = true
      }
      const line = `${new Date().toISOString()} [${level}] ${this.runId} ${message}\n`
      this.logContent += line
      await writeFile(this.logFilePath, this.logContent)
    })
    return this.logWrite
  }

  // ── Stage tracking ──

  startStage(name: StageName, detail?: string): void {
    const entry: StageEntry = {
      name,
      startedAt: new Date().toISOString(),
      status: "running",
      detail,
    }
    this.stages.set(name, entry)
    this.startTimes.set(name, Date.now())
    console.log(`[pipeline] ${name}: started${detail ? ` — ${detail}` : ""}`)
    this.appendLog("STAGE", `${name}: started${detail ? ` — ${detail}` : ""}`).catch(() => {})
  }

  completeStage(name: StageName, detail?: string, error?: string): void {
    const entry = this.stages.get(name)
    if (!entry) return
    const startTime = this.startTimes.get(name) ?? Date.now()
    entry.completedAt = new Date().toISOString()
    entry.status = error ? "failed" : "completed"
    entry.detail = detail ?? entry.detail
    entry.durationMs = Date.now() - startTime
    entry.error = error
    if (error) {
      this.manifest.summary.errors.push(`${name}: ${error}`)
      console.error(`[pipeline] ${name}: FAILED — ${error}`)
      this.appendLog("ERROR", `${name}: ${error}`).catch(() => {})
    } else {
      console.log(`[pipeline] ${name}: completed in ${entry.durationMs}ms${detail ? ` — ${detail}` : ""}`)
    this.appendLog("STAGE", `${name}: completed in ${entry.durationMs}ms${detail ? ` — ${detail}` : ""}`).catch(() => {})
    }
    // Persist after each stage
    this.saveManifest().catch(() => {})
  }

  // ── LLM call tracking ──

  startLlmCall(
    stage: StageName,
    purpose: string,
    promptName: string,
    promptSource: "override" | "builtin" | "fallback",
    promptHash: string,
    modelProvider: string,
    modelName: string,
    inputTokensEstimate?: number,
  ): string {
    this.callCounter++
    const callId = `call-${String(this.callCounter).padStart(3, "0")}-${stage}`
    const entry: LlmCallEntry = {
      callId,
      stage,
      purpose,
      promptName,
      promptSource,
      promptHash,
      modelProvider,
      modelName,
      startedAt: new Date().toISOString(),
      inputTokensEstimate,
      outputTokensActual: 0,
      outputLengthChars: 0,
      truncated: false,
      parseWarnings: [],
    }
    this.llmCalls.push(entry)
    this.startTimes.set(callId, Date.now())
    console.log(`[pipeline:llm] ${callId}: ${stage}/${purpose} — ${promptName} (${promptSource}) — ${modelProvider}/${modelName}`)
    this.appendLog("LLM", `${callId}: start — ${stage}/${purpose} — ${promptName} (${promptSource})`).catch(() => {})
    return callId
  }

  completeLlmCall(
    callId: string,
    outputLengthChars: number,
    outputTokensEstimate: number,
    truncated: boolean = false,
    parseWarnings: string[] = [],
    error?: string,
  ): void {
    const entry = this.llmCalls.find((c) => c.callId === callId)
    if (!entry) return
    const startTime = this.startTimes.get(callId) ?? Date.now()
    entry.completedAt = new Date().toISOString()
    entry.durationMs = Date.now() - startTime
    entry.outputLengthChars = outputLengthChars
    entry.outputTokensActual = outputTokensEstimate
    entry.truncated = truncated
    entry.parseWarnings = parseWarnings
    entry.error = error

    this.manifest.summary.totalLlmCalls++
    this.manifest.summary.totalLlmDurationMs += entry.durationMs
    this.manifest.summary.totalOutputTokens += outputTokensEstimate

    this.appendLog("LLM", `${callId}: done in ${entry.durationMs}ms — ${outputLengthChars} chars, ~${outputTokensEstimate} tokens${truncated ? " (TRUNCATED)" : ""}${error ? ` — ERROR: ${error}` : ""}`).catch(() => {})
    console.log(
      `[pipeline:llm] ${callId}: completed in ${entry.durationMs}ms — ${outputLengthChars} chars, ~${outputTokensEstimate} tokens${truncated ? " (TRUNCATED)" : ""}${error ? ` — ERROR: ${error}` : ""}`,
    )
  }

  // ── Artifact saving ──

  async saveResolvedPrompt(name: string, content: string, source: string, hash: string): Promise<void> {
    try {
      await writeFile(
        `${this.basePath}/resolved-prompts/${name}.md`,
        `# Resolved Prompt: ${name}\nSource: ${source}\nHash: ${hash}\n\n---\n\n${content}`,
      )
    } catch (err) {
      console.warn(`[pipeline] Failed to save prompt "${name}":`, err instanceof Error ? err.message : err)
    }
  }

  async saveLlmCallArtifact(callId: string, systemPrompt: string, userPrompt: string, response: string): Promise<void> {
    try {
      const entry = this.llmCalls.find((c) => c.callId === callId)
      await writeFile(
        `${this.basePath}/llm-calls/${callId}.md`,
        [
          `# LLM Call: ${callId}`,
          `Stage: ${entry?.stage ?? "unknown"}`,
          `Purpose: ${entry?.purpose ?? "unknown"}`,
          `Prompt: ${entry?.promptName ?? "unknown"} (${entry?.promptSource ?? "unknown"})`,
          `Model: ${entry?.modelProvider ?? "unknown"}/${entry?.modelName ?? "unknown"}`,
          `Duration: ${entry?.durationMs ?? "?"}ms`,
          `Output: ${entry?.outputLengthChars ?? "?"} chars, ~${entry?.outputTokensActual ?? "?"} tokens`,
          entry?.truncated ? "⚠️ TRUNCATED" : "",
          "",
          "## System Prompt",
          "```",
          systemPrompt.slice(0, 5000),
          "```",
          "",
          "## User Prompt",
          "```",
          userPrompt.slice(0, 5000),
          "```",
          "",
          "## Response",
          response.slice(0, 50000),
        ].join("\n"),
      )
    } catch (err) {
      console.warn(`[pipeline] Failed to save LLM call artifact:`, err instanceof Error ? err.message : err)
    }
  }

  async saveBatchOutput(batchId: string, pages: Array<{ path: string; content: string }>): Promise<void> {
    try {
      await writeFile(
        `${this.basePath}/batches/${batchId}.json`,
        JSON.stringify({ batchId, pageCount: pages.length, pages }, null, 2),
      )
    } catch (err) {
      console.warn(`[pipeline] Failed to save batch output:`, err instanceof Error ? err.message : err)
    }
  }

  async saveJsonArtifact(name: string, value: unknown): Promise<void> {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) throw new Error(`Unsafe artifact name: ${name}`)
    await writeFile(`${this.basePath}/${name}.json`, JSON.stringify(value, null, 2))
  }

  setChunked(count: number): void {
    this.manifest.chunked = true
    this.manifest.chunkCount = count
  }

  setQualityPassed(passed: boolean): void {
    this.manifest.summary.qualityPassed = passed
  }

  setTotalPagesGenerated(count: number): void {
    this.manifest.summary.totalPagesGenerated = count
  }

  setVerifiedFilesWritten(paths: string[]): void {
    this.manifest.verifiedWrittenPaths = [...new Set(paths)]
    this.manifest.summary.verifiedFilesWritten = this.manifest.verifiedWrittenPaths.length
  }

  async saveManifest(): Promise<void> {
    try {
      this.manifest.stages = [...this.stages.values()]
      this.manifest.llmCalls = this.llmCalls
      await writeFile(
        `${this.basePath}/manifest.json`,
        JSON.stringify(this.manifest, null, 2),
      )
    } catch (err) {
      console.warn(`[pipeline] Failed to save manifest:`, err instanceof Error ? err.message : err)
    }
  }

  /** Create a tracked LLM call and return context for streamChat. */
  createCall(stage: StageName, purpose: string, promptName: string, promptSource: "override" | "builtin" | "fallback", promptHash: string, modelProvider: string, modelName: string, inputEstimate?: number): { callId: string; onComplete: (outputChars: number, outputTokensEst: number, truncated?: boolean, warnings?: string[], error?: string) => void; onToken: (token: string) => void } {
    const callId = this.startLlmCall(stage, purpose, promptName, promptSource, promptHash, modelProvider, modelName, inputEstimate)
    let charCount = 0
    return {
      callId,
      onComplete: (outputChars, outputTokensEst, truncated = false, warnings = [], error) => {
        this.completeLlmCall(callId, outputChars, outputTokensEst, truncated, warnings, error)
      },
      onToken: (token: string) => {
        charCount += token.length
      },
    }
  }

  async finalize(): Promise<void> {
    await this.logWrite
    this.manifest.completedAt = new Date().toISOString()
    this.manifest.stages = [...this.stages.values()]
    this.manifest.llmCalls = this.llmCalls
    await this.saveManifest()
    console.log(
      `[pipeline] Run ${this.runId} complete — ${this.manifest.summary.totalLlmCalls} LLM calls, ${this.manifest.summary.totalLlmDurationMs}ms, ${this.manifest.summary.totalPagesGenerated} pages`,
    )
  }
}

/** Quick content hash for logging — not cryptographic. */
export function quickHash(text: string): string {
  let hash = 0
  for (let i = 0; i < Math.min(text.length, 5000); i++) {
    const char = text.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 8)
}
