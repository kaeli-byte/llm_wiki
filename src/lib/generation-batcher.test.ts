import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ConsolidatedEvidenceLedger, WikiPagePlan } from "./ingest-quality-types"
import type { FileNode } from "@/types/wiki"

const { streamChatMock, listDirectoryMock, readFileMock, writeFileMock } = vi.hoisted(() => ({
  streamChatMock: vi.fn(),
  listDirectoryMock: vi.fn<() => Promise<FileNode[]>>(async () => []),
  readFileMock: vi.fn<() => Promise<string>>(async () => ""),
  writeFileMock: vi.fn(async (_path: string, _content: string) => {}),
}))

vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(async () => {}),
  writeFile: writeFileMock,
  deleteFile: vi.fn(async () => {}),
  listDirectory: listDirectoryMock,
  readFile: readFileMock,
}))
vi.mock("@/lib/prompts/resolver", () => ({
  resolvePrompt: vi.fn(async (_name, values) => `batch prompt ${values?.batchPlanJson ?? ""}`),
}))
vi.mock("@/lib/llm-client", () => ({ streamChat: streamChatMock }))

import { generateWikiPagesInBatches } from "./generation-batcher"

const plan: WikiPagePlan = {
  version: 1,
  sourceIdentity: "report.pdf",
  pages: [
    {
      path: "wiki/sources/report.md",
      type: "source",
      title: "Report",
      priority: "critical",
      action: "create",
      subjects: ["Report"],
      evidenceIds: ["C1-E001"],
      relatedPaths: [],
      requiredSections: ["Summary"],
      maxWords: 200,
    },
    {
      path: "wiki/claims/revenue.md",
      type: "claim",
      title: "Revenue",
      priority: "critical",
      action: "create",
      subjects: ["Revenue"],
      evidenceIds: ["C1-E001"],
      relatedPaths: [],
      requiredSections: ["Evidence"],
      maxWords: 200,
    },
  ],
  batches: [{
    id: "batch-001",
    pagePaths: ["wiki/sources/report.md", "wiki/claims/revenue.md"],
  }],
  coverageSummary: {
    evidenceRecordsTotal: 1,
    evidenceRecordsAssigned: 1,
    criticalPages: 2,
    highPages: 0,
    unassignedEvidenceIds: [],
    omittedLowPriorityCandidates: [],
  },
}

const evidenceLedger: ConsolidatedEvidenceLedger = {
  sourceIdentity: "report.pdf",
  sourceMetadata: {},
  records: [{
    id: "C1-E001",
    subject: "Aeroflex",
    claim: "Revenue increased",
    evidenceClass: "direct",
    confidence: "high",
    sourceLocator: { label: "p. 4" },
    candidateTypes: ["claim"],
  }],
  relations: [],
  coverage: {},
  openQuestions: [],
}

describe("generateWikiPagesInBatches completeness", () => {
  beforeEach(() => {
    streamChatMock.mockReset()
    listDirectoryMock.mockReset().mockResolvedValue([])
    readFileMock.mockReset().mockResolvedValue("")
    writeFileMock.mockClear()
  })

  it("fails when a closed response silently omits a planned page", async () => {
    streamChatMock.mockImplementation(async (_cfg, _messages, callbacks) => {
      if (!callbacks) return
      callbacks.onToken("---FILE: wiki/sources/report.md---\n# Report\n---END FILE---")
      callbacks.onDone()
    })

    const result = await generateWikiPagesInBatches({
      projectPath: "/project",
      sourceSummarySlug: "report",
      sourceIdentity: "report.pdf",
      llmConfig: { provider: "openai", model: "test", apiKey: "", ollamaUrl: "", customEndpoint: "", maxContextSize: 128_000 },
      plan,
      evidenceLedger,
      schema: "schema",
      purpose: "purpose",
      index: "index",
      activityId: "activity",
    })

    expect(result.success).toBe(false)
    expect(result.totalGeneratedPages).toBe(1)
    expect(result.warnings.join("\n")).toContain("wiki/claims/revenue.md")
  })

  it("recovers a missing planned page with a focused single-page call", async () => {
    streamChatMock
      .mockImplementationOnce(async (_cfg, _messages, callbacks) => {
        callbacks?.onToken("---FILE: wiki/sources/report.md---\n# Report\n---END FILE---")
        callbacks?.onDone()
      })
      .mockImplementationOnce(async (_cfg, _messages, callbacks) => {
        callbacks?.onToken("---FILE: wiki/claims/revenue.md---\n# Revenue\n---END FILE---")
        callbacks?.onDone()
      })

    const result = await generateWikiPagesInBatches({
      projectPath: "/project",
      sourceSummarySlug: "report",
      sourceIdentity: "report.pdf",
      llmConfig: { provider: "openai", model: "test", apiKey: "", ollamaUrl: "", customEndpoint: "", maxContextSize: 128_000 },
      plan,
      evidenceLedger,
      schema: "schema",
      purpose: "purpose",
      index: "index",
      activityId: "activity",
    })

    expect(streamChatMock).toHaveBeenCalledTimes(2)
    expect(result.success).toBe(true)
    expect(result.totalGeneratedPages).toBe(2)
  })

  it("starts independent generation batches concurrently", async () => {
    const concurrentPlan: WikiPagePlan = {
      ...plan,
      batches: [
        { id: "batch-001", pagePaths: ["wiki/sources/report.md"] },
        { id: "batch-002", pagePaths: ["wiki/claims/revenue.md"] },
      ],
    }
    let active = 0
    let peakActive = 0
    streamChatMock.mockImplementation(async (_cfg, messages, callbacks) => {
      active++
      peakActive = Math.max(peakActive, active)
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
      const system = String(messages?.[0]?.content ?? "")
      const path = system.includes("wiki/claims/revenue.md") ? "wiki/claims/revenue.md" : "wiki/sources/report.md"
      callbacks?.onToken(`---FILE: ${path}---\n# Page\n---END FILE---`)
      callbacks?.onDone()
      active--
    })

    const pending = generateWikiPagesInBatches({
      projectPath: "/project", sourceSummarySlug: "report", sourceIdentity: "report.pdf",
      llmConfig: { provider: "openai", model: "test", apiKey: "", ollamaUrl: "", customEndpoint: "", maxContextSize: 128_000 },
      plan: concurrentPlan, evidenceLedger, schema: "schema", purpose: "purpose", index: "index",
      activityId: "activity", maxConcurrentBatches: 2,
    })
    expect((await pending).success).toBe(true)
    expect(peakActive).toBe(2)
    const tokenBudgets = streamChatMock.mock.calls.map((call) => call[4]?.max_tokens)
    expect(tokenBudgets).toContain(8_192)
    expect(tokenBudgets).toContain(4_096)
  })

  it("accepts a complete single expected page when DeepSeek omits only the END FILE marker", async () => {
    const singlePlan: WikiPagePlan = {
      ...plan,
      pages: [plan.pages[1]],
      batches: [{ id: "batch-001", pagePaths: ["wiki/claims/revenue.md"] }],
    }
    streamChatMock.mockImplementation(async (_cfg, _messages, callbacks) => {
      callbacks?.onToken("---FILE: wiki/claims/revenue.md---\n---\ntype: claim\n---\n# Revenue\n\n## Evidence\nComplete body without a closing transport marker.")
      callbacks?.onDone()
    })

    const result = await generateWikiPagesInBatches({
      projectPath: "/project", sourceSummarySlug: "report", sourceIdentity: "report.pdf",
      llmConfig: { provider: "openai", model: "test", apiKey: "", ollamaUrl: "", customEndpoint: "", maxContextSize: 128_000 },
      plan: singlePlan, evidenceLedger, schema: "schema", purpose: "purpose", index: "index", activityId: "activity",
    })

    expect(result.success).toBe(true)
    expect(streamChatMock).toHaveBeenCalledTimes(1)
  })

  it("reuses a valid staged page instead of regenerating it", async () => {
    const singlePlan: WikiPagePlan = {
      ...plan,
      pages: [plan.pages[1]],
      batches: [{ id: "batch-001", pagePaths: ["wiki/claims/revenue.md"] }],
    }
    listDirectoryMock.mockResolvedValue([{
      name: "revenue.md",
      path: "/project/.llm-wiki/staging/report/wiki/claims/revenue.md",
      is_dir: false,
    }])
    readFileMock.mockResolvedValue("---\ntype: claim\ntitle: Revenue\n---\n# Revenue\n\n## Evidence\nRetained content.")

    const result = await generateWikiPagesInBatches({
      projectPath: "/project", sourceSummarySlug: "report", sourceIdentity: "report.pdf",
      llmConfig: { provider: "openai", model: "test", apiKey: "", ollamaUrl: "", customEndpoint: "", maxContextSize: 128_000 },
      plan: singlePlan, evidenceLedger, schema: "schema", purpose: "purpose", index: "index", activityId: "activity",
    })

    expect(result.success).toBe(true)
    expect(streamChatMock).not.toHaveBeenCalled()
    expect(result.totalGeneratedPages).toBe(1)
  })

  it("regenerates a staged page that cites evidence absent from the current ledger", async () => {
    const singlePlan: WikiPagePlan = { ...plan, pages: [plan.pages[1]], batches: [{ id: "batch-001", pagePaths: ["wiki/claims/revenue.md"] }] }
    listDirectoryMock.mockResolvedValue([{ name: "revenue.md", path: "/project/.llm-wiki/staging/report/wiki/claims/revenue.md", is_dir: false }])
    readFileMock.mockResolvedValue("---\ntype: claim\ntitle: Revenue\nevidence_type: direct\nsource_pages: p. 9\n---\n## Evidence\nStale [C2-E007; p. 9]")
    streamChatMock.mockImplementation(async (_cfg, _messages, callbacks) => {
      callbacks?.onToken("---FILE: wiki/claims/revenue.md---\n---\ntype: claim\ntitle: Revenue\nevidence_type: direct\nsource_pages: p. 4\n---\n## Evidence\nCurrent [C1-E001; p. 4]")
      callbacks?.onDone()
    })

    const result = await generateWikiPagesInBatches({
      projectPath: "/project", sourceSummarySlug: "report", sourceIdentity: "report.pdf",
      llmConfig: { provider: "openai", model: "test", apiKey: "", ollamaUrl: "", customEndpoint: "", maxContextSize: 128_000 },
      plan: singlePlan, evidenceLedger, schema: "schema", purpose: "purpose", index: "index", activityId: "activity",
    })
    expect(result.success).toBe(true)
    expect(streamChatMock).toHaveBeenCalledTimes(1)
  })

  it("succeeds when a page-local recovery repairs an earlier failed batch", async () => {
    const singlePlan: WikiPagePlan = {
      ...plan,
      pages: [plan.pages[1]],
      batches: [{ id: "batch-001", pagePaths: ["wiki/claims/revenue.md"] }],
    }
    streamChatMock
      .mockImplementationOnce(async (_cfg, _messages, callbacks) => callbacks?.onError(new Error("temporary endpoint failure")))
      .mockImplementationOnce(async (_cfg, _messages, callbacks) => {
        callbacks?.onToken("---FILE: wiki/claims/revenue.md---\n# Revenue\n---END FILE---")
        callbacks?.onDone()
      })

    const result = await generateWikiPagesInBatches({
      projectPath: "/project", sourceSummarySlug: "report", sourceIdentity: "report.pdf",
      llmConfig: { provider: "openai", model: "test", apiKey: "", ollamaUrl: "", customEndpoint: "", maxContextSize: 128_000 },
      plan: singlePlan, evidenceLedger, schema: "schema", purpose: "purpose", index: "index", activityId: "activity",
    })

    expect(result.success).toBe(true)
    expect(result.totalGeneratedPages).toBe(1)
  })

  it("can defer the wiki commit until portfolio QA passes", async () => {
    const singlePlan: WikiPagePlan = { ...plan, pages: [plan.pages[1]], batches: [{ id: "batch-001", pagePaths: ["wiki/claims/revenue.md"] }] }
    streamChatMock.mockImplementation(async (_cfg, _messages, callbacks) => {
      callbacks?.onToken("---FILE: wiki/claims/revenue.md---\n---\ntype: claim\ntitle: Revenue\nevidence_type: direct\nsource_pages: p. 4\n---\n## Evidence\nC1-E001")
      callbacks?.onDone()
    })
    const result = await generateWikiPagesInBatches({
      projectPath: "/project", sourceSummarySlug: "report", sourceIdentity: "report.pdf",
      llmConfig: { provider: "openai", model: "test", apiKey: "", ollamaUrl: "", customEndpoint: "", maxContextSize: 128_000 },
      plan: singlePlan, evidenceLedger, schema: "schema", purpose: "purpose", index: "index", activityId: "activity", deferCommit: true,
    })
    expect(result.success).toBe(true)
    expect(result.generatedFiles?.has("wiki/claims/revenue.md")).toBe(true)
    expect(writeFileMock.mock.calls.some(([path]) => path === "/project/wiki/claims/revenue.md")).toBe(false)
  })
})
