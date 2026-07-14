import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { createTempProject, realFs, writeFileRaw } from "@/test-helpers/fs-temp"
import { useActivityStore } from "@/stores/activity-store"
import { useChatStore } from "@/stores/chat-store"
import { useReviewStore } from "@/stores/review-store"
import { useWikiStore } from "@/stores/wiki-store"
import { sourceSummarySlugFromIdentity } from "./source-identity"
import { migrateSourcePath } from "./source-lifecycle"

vi.mock("@/commands/fs", () => realFs)

let sourceMarkers: string[] = []
let failLongChunksOnce = new Set<number>()
let extraReviewResponse = ""
let generationSuffix = ""
let abortDuringReview: AbortController | null = null
let interactiveGenerationOverride = ""
let mergeRequestCount = 0
let qualityReviewResponses: Array<Record<string, unknown>> = []
let invalidEntityResolutionOnce = false

vi.mock("./llm-client", () => ({
  streamChat: vi.fn(async (_cfg, messages, cb) => {
    const systemPrompt = String(messages?.[0]?.content ?? "")
    const userPrompt = String(messages?.[1]?.content ?? "")

    if (systemPrompt.startsWith("You are merging two versions")) {
      mergeRequestCount++
      const incoming = userPrompt.split("## Newly generated version")[1]?.split("---")[2]
      cb.onToken(incoming?.trim() || "---\ntitle: merged\n---\n\n# merged")
      cb.onDone()
      return
    }

    if ((systemPrompt.startsWith("You are a wiki generation assistant") || systemPrompt.startsWith("You are rendering an evidence-preserving"))
      && !systemPrompt.toLowerCase().includes("source summary at exactly")) {
      if (interactiveGenerationOverride) {
        cb.onToken(interactiveGenerationOverride)
        cb.onDone()
        return
      }
      cb.onToken([
        "---FILE: wiki/sources/config.md---",
        "---",
        'type: "source"',
        'title: "Source: config.yaml"',
        'sources: ["config.yaml"]',
        "tags: []",
        "related: []",
        "---",
        "",
        "# Source: config.yaml",
        "",
        "Configuration source generated from the chat handoff.",
        "---END FILE---",
      ].join("\n"))
      cb.onDone()
      return
    }

    if (systemPrompt.startsWith("You are extracting an append-only evidence ledger")) {
      const chunkMatch = userPrompt.match(/Chunk:\s*(\d+)\/(\d+)/)
      const chunkIndex = chunkMatch?.[1] ?? "0"
      const numericChunkIndex = Number(chunkIndex)
      if (failLongChunksOnce.has(numericChunkIndex)) {
        failLongChunksOnce.delete(numericChunkIndex)
        cb.onError(new Error(`chunk ${chunkIndex} failed once`))
        return
      }
      cb.onToken([
        "## Chunk Analysis",
        `Chunk ${chunkIndex} introduced topic ${chunkIndex}.`,
        "",
        "## Updated Global Digest",
        `Digest after chunk ${chunkIndex}: stable context ${chunkIndex}.`,
      ].join("\n"))
      cb.onDone()
      return
    }

    if (systemPrompt.startsWith("You are extracting a machine-readable evidence ledger")) {
      const chunkIndex = userPrompt.match(/"index"\s*:\s*(\d+)/)?.[1] ?? "1"
      const chunkTotal = userPrompt.match(/"total"\s*:\s*(\d+)/)?.[1] ?? "1"
      if (failLongChunksOnce.has(Number(chunkIndex))) {
        failLongChunksOnce.delete(Number(chunkIndex))
        cb.onError(new Error(`chunk ${chunkIndex} failed once`))
        return
      }
      cb.onToken(JSON.stringify({
        source: { identity: "project-a/long-report.md", document_type: "report" },
        chunk: { index: Number(chunkIndex), total: Number(chunkTotal) },
        records: [{
          id: `C${chunkIndex}-E001`,
          subject: `Topic ${chunkIndex}`,
          claim: `Chunk ${chunkIndex} contains decision-relevant evidence.`,
          evidence_class: "direct",
          confidence: chunkIndex === "1" ? "high" : "medium",
          source_locator: { label: `chunk ${chunkIndex}` },
          candidate_types: ["goal"],
        }],
        relations: [],
        coverage: { configuration: "covered" },
        open_questions: [],
      }))
      cb.onDone()
      return
    }

    if (
      systemPrompt.startsWith("You resolve a compact evidence candidate set") ||
      systemPrompt.startsWith("Repair an invalid entity-resolution JSON response")
    ) {
      if (systemPrompt.startsWith("You resolve a compact evidence candidate set") && invalidEntityResolutionOnce) {
        invalidEntityResolutionOnce = false
        cb.onToken('{"version":1,"pages":[')
        cb.onDone()
        return
      }
      const sourceIdentity = systemPrompt.match(/SOURCE_IDENTITY:\s*\n([^\n]+)/)?.[1]?.trim()
        ?? systemPrompt.match(/"sourceIdentity":"([^"]+)"/)?.[1]
        ?? "project-a/long-report.md"
      const candidateSections = systemPrompt.split("NORMALIZED_CANDIDATES:")
      const candidatePayload = candidateSections[candidateSections.length - 1] ?? systemPrompt
      const evidenceIds = [...new Set(candidatePayload.match(/C\d+-E\d{3,}/g) ?? ["C1-E001"])]
      const kinds = [
        "source", "company", "segment", "segment", "counterparty", "counterparty",
        "product", "product", "product", "product", "product", "strategic_topic",
        "strategic_topic", "strategic_topic", "financial_performance", "risk",
        "acquisition", "unresolved_questions",
      ]
      cb.onToken(JSON.stringify({
        version: 1,
        source_identity: sourceIdentity,
        pages: kinds.map((kind, index) => ({
          candidate_id: `page-${index + 1}`,
          kind,
          title: index === 1 ? "Aeroflex Mobility" : `Portfolio page ${index + 1}`,
          slug: index === 1 ? "aeroflex-mobility" : `portfolio-page-${index + 1}`,
          priority: index < 2 ? "critical" : "high",
          aliases: [],
          primary_evidence_ids: index > 0 && index <= evidenceIds.length ? [evidenceIds[index - 1]] : [],
          secondary_evidence_ids: [],
          related_candidate_ids: [],
          rationale: "Durable reusable subject.",
        })),
        merge_decisions: [],
      }))
      cb.onDone()
      return
    }

    if (systemPrompt.startsWith("You are planning a complete, evidence-preserving")) {
      cb.onToken(JSON.stringify({
        version: 1,
        source_identity: "project-a/long-report.md",
        pages: [
          {
            path: "wiki/sources/long-report.md",
            type: "source",
            title: "Long report",
            priority: "critical",
            action: "create",
            subjects: ["Long report"],
            evidence_ids: ["C1-E001"],
            related_paths: ["wiki/goals/topic-1.md"],
            required_sections: ["Summary"],
            max_words: 200,
          },
          {
            path: "wiki/goals/topic-1.md",
            type: "goal",
            title: "Topic 1",
            priority: "critical",
            action: "create",
            subjects: ["Topic 1"],
            evidence_ids: ["C1-E001"],
            related_paths: ["wiki/sources/long-report.md"],
            required_sections: ["Evidence"],
            max_words: 200,
          },
        ],
        batches: [{
          id: "batch-001",
          page_paths: ["wiki/sources/long-report.md", "wiki/goals/topic-1.md"],
        }],
        coverage_summary: {
          evidence_records_total: 1,
          evidence_records_assigned: 1,
          critical_pages: 2,
          high_pages: 0,
          unassigned_evidence_ids: [],
          omitted_low_priority_candidates: [],
        },
      }))
      cb.onDone()
      return
    }

    if (systemPrompt.startsWith("You are rendering one approved batch")) {
      const paths = [...systemPrompt.matchAll(/"path":"([^"]+)"/g)].map((match) => match[1])
      cb.onToken(paths.map((pagePath) => [
        `---FILE: ${pagePath}---`,
        `---\ntype: ${pagePath.includes("/sources/") ? "source" : "goal"}\ntitle: ${pagePath.includes("/sources/") ? "Long report" : "Topic 1"}\nsources: [project-a/long-report.md]\ntags: []\nrelated: []\n---`,
        pagePath.includes("/sources/") ? "# Long report\n\n## Summary\nEvidence map." : "# Topic 1\n\n## Evidence\nChunk evidence.",
        "---END FILE---",
      ].join("\n")).join("\n"))
      cb.onDone()
      return
    }

    if (systemPrompt.startsWith("You are validating an industrial market-intelligence")) {
      cb.onToken(JSON.stringify(qualityReviewResponses.shift() ?? {
        passed: true,
        metrics: { plannedPages: 2, generatedPages: 2, criticalHighCoverage: 1, claimLocatorCoverage: 1, analysisClaimLinkCoverage: 1, brokenLinks: 0, unsupportedClaims: 0 },
        missingPaths: [], invalidPaths: [], repairBatches: [], warnings: [],
      }))
      cb.onDone()
      return
    }

    if (systemPrompt.startsWith("You are the quality-review analyst")) {
      if (abortDuringReview) {
        abortDuringReview.abort()
        throw new Error("AbortError")
      }
      cb.onToken(extraReviewResponse)
      cb.onDone()
      return
    }

    const targetMatch = systemPrompt.match(
      /source summary at exactly [`*]+(wiki\/sources\/[^`*]+)[`*]+/i,
    )
    if (!targetMatch) {
      cb.onToken("## Analysis\nConfiguration source.")
      cb.onDone()
      return
    }

    const marker = sourceMarkers.shift() ?? "unknown project"
    const targetPath = targetMatch[1]
    const sourceIdentity =
      systemPrompt.match(/Source identity:\s*`([^`]+)`/i)?.[1] ?? "config.yaml"
    cb.onToken([
      `---FILE: ${targetPath}---`,
      "---",
      `title: "Source: ${sourceIdentity}"`,
      `sources: ["${sourceIdentity}"]`,
      "---",
      "",
      `# ${marker}`,
      "",
      `Configuration details for ${marker}.`,
      "---END FILE---",
      generationSuffix,
    ].join("\n"))
    cb.onDone()
  }),
}))

vi.mock("./mineru", () => ({
  parseWithMineru: vi.fn(),
  parseWithMineruResult: vi.fn(),
}))

import {
  autoIngest,
  buildFallbackSourceSummary,
  executeIngestWrites,
  hasMineruImageRefs,
} from "./ingest"
import { streamChat } from "./llm-client"
import { parseWithMineruResult } from "./mineru"

const mockStreamChat = vi.mocked(streamChat)
const mockParseWithMineru = vi.mocked(parseWithMineruResult)

describe("autoIngest source summary paths", () => {
  let tmp: { path: string; cleanup: () => Promise<void> } | undefined

  beforeEach(async () => {
    sourceMarkers = []
    failLongChunksOnce = new Set()
    extraReviewResponse = ""
    generationSuffix = ""
    abortDuringReview = null
    interactiveGenerationOverride = ""
    mergeRequestCount = 0
    qualityReviewResponses = []
    invalidEntityResolutionOnce = false
    mockStreamChat.mockClear()
    mockParseWithMineru.mockReset()
    tmp = await createTempProject("same-basename-sources")

    await writeFileRaw(`${tmp.path}/purpose.md`, "# Purpose\n\nTrack project config files.\n")
    await writeFileRaw(
      `${tmp.path}/schema.md`,
      "# Schema\n\nEach source needs its own source summary page.\n\n## Page Types\n| goal | wiki/goals/ | Outcomes |\n| habit | wiki/habits/ | Behaviours |",
    )
    await writeFileRaw(`${tmp.path}/wiki/index.md`, "# Index\n")
    await writeFileRaw(`${tmp.path}/wiki/overview.md`, "# Overview\n")
    await writeFileRaw(`${tmp.path}/raw/sources/project-a/config.yaml`, "name: alpha\n")
    await writeFileRaw(`${tmp.path}/raw/sources/project-b/config.yaml`, "name: beta\n")

    useReviewStore.setState({ items: [] })
    useActivityStore.setState({ items: [] })
    useChatStore.setState({
      conversations: [],
      messages: [],
      activeConversationId: null,
      mode: "chat",
      ingestSource: null,
      isStreaming: false,
      streamingContent: "",
    })
    useWikiStore.setState({
      project: {
        id: "same-basename-sources",
        name: "same-basename-sources",
        path: tmp.path,
      },
      fileTree: [],
      outputLanguage: "auto",
      multimodalConfig: {
        enabled: false,
        useMainLlm: true,
        provider: "openai",
        apiKey: "",
        model: "",
        ollamaUrl: "",
        customEndpoint: "",
        concurrency: 1,
      },
      embeddingConfig: {
        enabled: false,
        endpoint: "",
        apiKey: "",
        model: "",
      },
    })
  })

  afterEach(async () => {
    await tmp?.cleanup()
    tmp = undefined
  })

  it("detects MinerU image refs with URL-encoded source summary slugs", () => {
    expect(hasMineruImageRefs(
      "![chart](media/%E6%B1%A1%E6%B0%B4%20paper/mineru/images/chart%281%29.png)",
      "污水 paper",
    )).toBe(true)
    expect(hasMineruImageRefs(
      "![chart](media/污水 paper/mineru/images/chart.png)",
      "污水 paper",
    )).toBe(true)
    expect(hasMineruImageRefs(
      "![chart](media/other/mineru/images/chart.png)",
      "污水 paper",
    )).toBe(false)
  })

  it("preserves complete analysis in a fallback source summary", () => {
    const analysis = `begin-${"x".repeat(5000)}-end`
    const content = buildFallbackSourceSummary("long.md", analysis, "2026-07-11")
    expect(content).toContain(analysis)
    expect(content).toContain("-end")
  })

  it("keeps distinct source summaries for same-basename files in different source subdirectories", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["project-a config", "project-b config"]

    await autoIngest(
      tmp.path,
      `${tmp.path}/raw/sources/project-a/config.yaml`,
      useWikiStore.getState().llmConfig,
      undefined,
      "project-a",
    )
    await autoIngest(
      tmp.path,
      `${tmp.path}/raw/sources/project-b/config.yaml`,
      useWikiStore.getState().llmConfig,
      undefined,
      "project-b",
    )

    const sourcesDir = path.join(tmp.path, "wiki", "sources")
    const summaryFiles = (await fs.readdir(sourcesDir))
      .filter((name) => name.endsWith(".md"))
      .sort()
    const summaryContents = await Promise.all(
      summaryFiles.map((name) => fs.readFile(path.join(sourcesDir, name), "utf8")),
    )
    const allSummaries = summaryContents.join("\n\n--- summary boundary ---\n\n")

    expect(summaryFiles).toHaveLength(2)
    expect(allSummaries).toContain("project-a/config.yaml")
    expect(allSummaries).toContain("project-b/config.yaml")
  })

  it("replaces stale content when a corrected source solely owns the page", async () => {
    if (!tmp) throw new Error("missing temp project")
    const sourcePath = `${tmp.path}/raw/sources/project-a/config.yaml`
    sourceMarkers = ["obsolete wording"]
    await autoIngest(tmp.path, sourcePath, useWikiStore.getState().llmConfig)

    await writeFileRaw(sourcePath, "name: corrected\n")
    sourceMarkers = ["corrected wording"]
    await autoIngest(tmp.path, sourcePath, useWikiStore.getState().llmConfig)

    const summaryPath = `${tmp.path}/wiki/sources/${sourceSummarySlugFromIdentity("project-a/config.yaml")}.md`
    const content = await fs.readFile(summaryPath, "utf8")
    expect(content).toContain("corrected wording")
    expect(content).not.toContain("obsolete wording")
    expect(mergeRequestCount).toBe(0)
  })

  it("moves the canonical source summary and its source reference", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["movable summary"]
    const oldSource = `${tmp.path}/raw/sources/project-a/config.yaml`
    await autoIngest(tmp.path, oldSource, useWikiStore.getState().llmConfig)

    const oldIdentity = "project-a/config.yaml"
    const newIdentity = "archive/config.yaml"
    const oldSummary = `${tmp.path}/wiki/sources/${sourceSummarySlugFromIdentity(oldIdentity)}.md`
    const newSummary = `${tmp.path}/wiki/sources/${sourceSummarySlugFromIdentity(newIdentity)}.md`
    await migrateSourcePath(
      tmp.path,
      "raw/sources/project-a/config.yaml",
      "raw/sources/archive/config.yaml",
    )

    await expect(fs.access(oldSummary)).rejects.toThrow()
    const content = await fs.readFile(newSummary, "utf8")
    expect(content).toContain('sources: ["archive/config.yaml"]')
  })

  it("migrates source references for a case-only rename", async () => {
    if (!tmp) throw new Error("missing temp project")
    const pagePath = `${tmp.path}/wiki/entities/case.md`
    await writeFileRaw(pagePath, [
      "---",
      'sources: ["project-a/config.yaml"]',
      "---",
      "# Case",
    ].join("\n"))

    await migrateSourcePath(
      tmp.path,
      "raw/sources/project-a/config.yaml",
      "raw/sources/Project-A/config.yaml",
    )

    expect(await fs.readFile(pagePath, "utf8")).toContain(
      'sources: ["Project-A/config.yaml"]',
    )
  })

  it("migrates a unique legacy basename source reference", async () => {
    if (!tmp) throw new Error("missing temp project")
    // Remove the second same-basename source so the legacy shorthand is
    // unambiguous after the move.
    await fs.rm(`${tmp.path}/raw/sources/project-b/config.yaml`)
    const pagePath = `${tmp.path}/wiki/entities/legacy.md`
    await writeFileRaw(pagePath, [
      "---",
      'sources: ["config.yaml"]',
      "---",
      "# Legacy",
    ].join("\n"))

    await migrateSourcePath(
      tmp.path,
      "raw/sources/project-a/config.yaml",
      "raw/sources/archive/config.yaml",
    )

    expect(await fs.readFile(pagePath, "utf8")).toContain(
      'sources: ["archive/config.yaml"]',
    )
  })

  it("does not rewrite an ambiguous legacy basename source reference", async () => {
    if (!tmp) throw new Error("missing temp project")
    const pagePath = `${tmp.path}/wiki/entities/ambiguous.md`
    await writeFileRaw(pagePath, [
      "---",
      'sources: ["config.yaml"]',
      "---",
      "# Ambiguous",
    ].join("\n"))

    await migrateSourcePath(
      tmp.path,
      "raw/sources/project-a/config.yaml",
      "raw/sources/archive/config.yaml",
    )

    expect(await fs.readFile(pagePath, "utf8")).toContain(
      'sources: ["config.yaml"]',
    )
  })

  it("migrates a safe legacy basename source summary to the canonical nested source path", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["project-a config"]
    await fs.rm(path.join(tmp.path, "raw", "sources", "project-b", "config.yaml"))

    const legacySummaryPath = path.join(tmp.path, "wiki", "sources", "config.md")
    await writeFileRaw(
      legacySummaryPath,
      [
        "---",
        'title: "Source: config.yaml"',
        'sources: ["config.yaml"]',
        "---",
        "",
        "# Legacy config",
        "",
        "Legacy source summary body.",
      ].join("\n"),
    )

    await autoIngest(
      tmp.path,
      `${tmp.path}/raw/sources/project-a/config.yaml`,
      useWikiStore.getState().llmConfig,
      undefined,
      "project-a",
    )

    const canonicalSummary = `wiki/sources/${sourceSummarySlugFromIdentity("project-a/config.yaml")}.md`
    const canonicalSummaryPath = path.join(tmp.path, canonicalSummary)
    const content = await fs.readFile(canonicalSummaryPath, "utf8")

    await expect(fs.access(legacySummaryPath)).rejects.toThrow()
    expect(content).toContain('sources: ["project-a/config.yaml"]')
    expect(content).toContain("project-a config")
  })

  it("does not migrate a legacy basename source summary when the basename is ambiguous", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["project-a config"]

    const legacySummaryPath = path.join(tmp.path, "wiki", "sources", "config.md")
    const legacyContent = [
      "---",
      'title: "Source: config.yaml"',
      'sources: ["config.yaml"]',
      "---",
      "",
      "# Legacy config",
      "",
      "Ambiguous legacy source summary body.",
    ].join("\n")
    await writeFileRaw(legacySummaryPath, legacyContent)

    await autoIngest(
      tmp.path,
      `${tmp.path}/raw/sources/project-a/config.yaml`,
      useWikiStore.getState().llmConfig,
      undefined,
      "project-a",
    )

    const canonicalSummary = `wiki/sources/${sourceSummarySlugFromIdentity("project-a/config.yaml")}.md`
    const canonicalSummaryPath = path.join(tmp.path, canonicalSummary)

    expect(await fs.readFile(legacySummaryPath, "utf8")).toBe(legacyContent)
    expect(await fs.readFile(canonicalSummaryPath, "utf8")).toContain("project-a config")
  })

  it("analyzes oversized sources in chunks before final wiki generation", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["long source"]
    const longSourcePath = `${tmp.path}/raw/sources/project-a/long-report.md`
    await writeFileRaw(
      longSourcePath,
      [
        "# Chapter One",
        "",
        "A".repeat(9000),
        "",
        "## Chapter Two",
        "",
        "B".repeat(9000),
        "",
        "## Chapter Three",
        "",
        "C".repeat(9000),
      ].join("\n"),
    )

    await autoIngest(
      tmp.path,
      longSourcePath,
      { ...useWikiStore.getState().llmConfig, maxContextSize: 20_000 },
      undefined,
      "project-a",
    )

    const chunkCalls = mockStreamChat.mock.calls.filter(([, messages]) =>
      String(messages?.[0]?.content ?? "").startsWith("You are extracting a machine-readable evidence ledger"),
    )
    expect(chunkCalls.length).toBeGreaterThan(1)
    const chunkUserPrompt = String(chunkCalls[0][1]?.[1]?.content ?? "")
    expect(chunkUserPrompt).toContain("wiki/goals/")
    expect(chunkUserPrompt).toContain("MAIN_CHUNK")
    expect(mockStreamChat.mock.calls.some(([, messages]) =>
      String(messages?.[0]?.content ?? "").startsWith("You are planning a complete, evidence-preserving"),
    )).toBe(false)
    expect(mockStreamChat.mock.calls.filter(([, messages]) =>
      String(messages?.[0]?.content ?? "").startsWith("You resolve a compact evidence candidate set"),
    )).toHaveLength(1)
    expect(mockStreamChat.mock.calls.some(([, messages]) =>
      String(messages?.[0]?.content ?? "").startsWith("Repair an invalid entity-resolution JSON response"),
    )).toBe(false)
    expect(mockStreamChat.mock.calls.some(([, messages]) =>
      String(messages?.[0]?.content ?? "").startsWith("You are rendering one approved batch"),
    )).toBe(true)
    expect(mockStreamChat.mock.calls.some(([, messages]) =>
      String(messages?.[0]?.content ?? "").startsWith("You are a wiki generation assistant"),
    )).toBe(false)
    expect(await fs.readFile(`${tmp.path}/wiki/companies/aeroflex-mobility.md`, "utf8")).toContain("Chunk evidence")
  })

  it("repairs malformed entity resolution once before synthesizing pages", async () => {
    if (!tmp) throw new Error("missing temp project")
    invalidEntityResolutionOnce = true
    const sourcePath = `${tmp.path}/raw/sources/project-a/resolution-repair.md`
    await writeFileRaw(sourcePath, `# Report\n\n${"R".repeat(27_000)}`)

    await autoIngest(tmp.path, sourcePath, { ...useWikiStore.getState().llmConfig, maxContextSize: 20_000 }, undefined, "project-a")

    const systemPrompts = mockStreamChat.mock.calls.map(([, messages]) => String(messages?.[0]?.content ?? ""))
    expect(systemPrompts.filter((prompt) => prompt.startsWith("You resolve a compact evidence candidate set"))).toHaveLength(1)
    expect(systemPrompts.filter((prompt) => prompt.startsWith("Repair an invalid entity-resolution JSON response"))).toHaveLength(1)
    expect(systemPrompts.some((prompt) => prompt.startsWith("You are rendering one approved batch"))).toBe(true)
  })

  it("does not cache a batched ingest when semantic quality review fails", async () => {
    if (!tmp) throw new Error("missing temp project")
    qualityReviewResponses = [{
      passed: false,
      metrics: { plannedPages: 2, generatedPages: 2, criticalHighCoverage: 0, claimLocatorCoverage: 0, analysisClaimLinkCoverage: 0, brokenLinks: 0, unsupportedClaims: 1 },
      missingPaths: [], invalidPaths: [], repairBatches: [], warnings: ["unsupported claim"],
    }]
    const sourcePath = `${tmp.path}/raw/sources/project-a/quality-fail.md`
    await writeFileRaw(sourcePath, `# Report\n\n${"A".repeat(27_000)}`)

    await autoIngest(tmp.path, sourcePath, { ...useWikiStore.getState().llmConfig, maxContextSize: 20_000 }, undefined, "project-a")

    const cachePath = `${tmp.path}/.llm-wiki/ingest-cache.json`
    const cache = JSON.parse(await fs.readFile(cachePath, "utf8").catch(() => '{"entries":{}}'))
    expect(cache.entries["project-a/quality-fail.md"]).toBeUndefined()
  })

  it("repairs failed pages, re-reviews, and caches only after quality passes", async () => {
    if (!tmp) throw new Error("missing temp project")
    qualityReviewResponses = [
      {
        passed: false,
        metrics: { plannedPages: 2, generatedPages: 2, criticalHighCoverage: 1, claimLocatorCoverage: 0, analysisClaimLinkCoverage: 1, brokenLinks: 0, unsupportedClaims: 0 },
        missingPaths: [], invalidPaths: [],
        repairBatches: [{ id: "repair-001", pagePaths: ["wiki/companies/aeroflex-mobility.md"], reason: "add evidence locator" }],
        warnings: [],
      },
      {
        passed: true,
        metrics: { plannedPages: 2, generatedPages: 2, criticalHighCoverage: 1, claimLocatorCoverage: 1, analysisClaimLinkCoverage: 1, brokenLinks: 0, unsupportedClaims: 0 },
        missingPaths: [], invalidPaths: [], repairBatches: [], warnings: [],
      },
    ]
    const sourcePath = `${tmp.path}/raw/sources/project-a/quality-repair.md`
    await writeFileRaw(sourcePath, `# Report\n\n${"B".repeat(27_000)}`)

    await autoIngest(tmp.path, sourcePath, { ...useWikiStore.getState().llmConfig, maxContextSize: 20_000 }, undefined, "project-a")

    const cache = JSON.parse(await fs.readFile(`${tmp.path}/.llm-wiki/ingest-cache.json`, "utf8"))
    expect(cache.entries["project-a/quality-repair.md"].filesWritten).toContain("wiki/companies/aeroflex-mobility.md")
    const reviewCalls = mockStreamChat.mock.calls.filter(([, messages]) =>
      String(messages?.[0]?.content ?? "").startsWith("You are validating an industrial market-intelligence"),
    )
    expect(reviewCalls).toHaveLength(2)
  })

  it("resumes oversized source analysis from the persisted chunk checkpoint", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["long source"]
    failLongChunksOnce = new Set([2])
    const longSourcePath = `${tmp.path}/raw/sources/project-a/resume-report.md`
    const llmConfig = { ...useWikiStore.getState().llmConfig, maxContextSize: 20_000 }
    await writeFileRaw(
      longSourcePath,
      [
        "# Chapter One",
        "",
        "A".repeat(9000),
        "",
        "## Chapter Two",
        "",
        "B".repeat(9000),
        "",
        "## Chapter Three",
        "",
        "C".repeat(9000),
      ].join("\n"),
    )

    await expect(
      autoIngest(tmp.path, longSourcePath, llmConfig, undefined, "project-a"),
    ).rejects.toThrow("Chunk analysis stream failed")

    const progressDir = path.join(tmp.path, ".llm-wiki", "ingest-progress")
    expect((await fs.readdir(progressDir)).filter((name) => name.endsWith(".json"))).toHaveLength(1)

    mockStreamChat.mockClear()
    await autoIngest(tmp.path, longSourcePath, llmConfig, undefined, "project-a")

    const resumedChunkCalls = mockStreamChat.mock.calls.filter(([, messages]) =>
      String(messages?.[0]?.content ?? "").startsWith("You are extracting a machine-readable evidence ledger"),
    )
    expect(resumedChunkCalls.length).toBeGreaterThan(0)
    expect(String(resumedChunkCalls[0][1]?.[1]?.content ?? "")).toContain('"index":2')
    expect(String(resumedChunkCalls[0][1]?.[1]?.content ?? "")).toContain("C1-E001")
    await expect(fs.readdir(progressDir)).resolves.toEqual([])
  })

  it("adds follow-up research reviews from the dedicated review stage", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["project-a config"]
    generationSuffix = [
      "",
      "---FILE: wiki/concepts/nitrification-inhibition.md---",
      "---",
      'title: "Nitrification inhibition"',
      "---",
      "",
      "# Nitrification inhibition",
      "",
      "X".repeat(10_500),
      "---END FILE---",
    ].join("\n")
    extraReviewResponse = [
      "---REVIEW: suggestion | Research nitrification inhibition signals---",
      "Add follow-up research on early-warning indicators for nitrification inhibition.",
      "OPTIONS: Create Page | Skip",
      "SEARCH: nitrification inhibition early warning wastewater | ammonia oxidation inhibition signals | wastewater nitrification process upset indicators",
      "---END REVIEW---",
    ].join("\n")

    await autoIngest(
      tmp.path,
      `${tmp.path}/raw/sources/project-a/config.yaml`,
      useWikiStore.getState().llmConfig,
      undefined,
      "project-a",
    )

    const reviews = useReviewStore.getState().items
    expect(reviews).toHaveLength(1)
    expect(reviews[0]).toMatchObject({
      type: "suggestion",
      title: "Research nitrification inhibition signals",
    })
    expect(reviews[0].searchQueries).toEqual([
      "nitrification inhibition early warning wastewater",
      "ammonia oxidation inhibition signals",
      "wastewater nitrification process upset indicators",
    ])
  })

  it("parses generation and dedicated review-stage blocks separately", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["project-a config"]
    generationSuffix = [
      "",
      "---REVIEW: missing-page | Truncated Orphan---",
      "Partial description that got cut off",
    ].join("\n")
    extraReviewResponse = [
      "---REVIEW: suggestion | Real Follow-up---",
      "Real description that should not be swallowed by the generation orphan.",
      "OPTIONS: Create Page | Skip",
      "SEARCH: real follow up query | second query",
      "---END REVIEW---",
    ].join("\n")

    await autoIngest(
      tmp.path,
      `${tmp.path}/raw/sources/project-a/config.yaml`,
      { ...useWikiStore.getState().llmConfig, maxContextSize: 128_000 },
      undefined,
      "project-a",
    )

    const reviews = useReviewStore.getState().items
    expect(reviews).toHaveLength(1)
    expect(reviews[0]).toMatchObject({
      type: "suggestion",
      title: "Real Follow-up",
    })
    expect(reviews[0].description).not.toContain("Truncated Orphan")
  })

  it("propagates cancellation that happens during the dedicated review stage", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["project-a config"]
    generationSuffix = `${"\n"}${"X".repeat(10_500)}`
    const controller = new AbortController()
    abortDuringReview = controller

    await expect(
      autoIngest(
        tmp.path,
        `${tmp.path}/raw/sources/project-a/config.yaml`,
        { ...useWikiStore.getState().llmConfig, maxContextSize: 128_000 },
        controller.signal,
        "project-a",
      ),
    ).rejects.toThrow("Ingest cancelled")
  })

  it("falls back to built-in PDF extraction when MinerU fails for a non-cancelled ingest", async () => {
    if (!tmp) throw new Error("missing temp project")
    sourceMarkers = ["mineru fallback source"]
    await writeFileRaw(`${tmp.path}/raw/sources/project-a/report.pdf`, "pdf fallback text\n")
    useWikiStore.setState({
      mineruConfig: {
        enabled: true,
        token: "mineru-token",
        modelVersion: "vlm",
      },
    })
    mockParseWithMineru.mockRejectedValueOnce(new Error("network failure from MinerU"))
    const updateSpy = vi.spyOn(useActivityStore.getState(), "updateItem")

    const written = await autoIngest(
      tmp.path,
      `${tmp.path}/raw/sources/project-a/report.pdf`,
      useWikiStore.getState().llmConfig,
      undefined,
      "project-a",
    )

    expect(written.length).toBeGreaterThan(0)
    expect(mockParseWithMineru).toHaveBeenCalled()
    expect(
      updateSpy.mock.calls.some(([, updates]) =>
        updates.detail?.includes("falling back to built-in PDF extraction"),
      ),
    ).toBe(true)
    updateSpy.mockRestore()
  })

  it("does not fall back to built-in PDF extraction when MinerU is cancelled", async () => {
    if (!tmp) throw new Error("missing temp project")
    await writeFileRaw(`${tmp.path}/raw/sources/project-a/cancelled.pdf`, "pdf fallback text\n")
    useWikiStore.setState({
      mineruConfig: {
        enabled: true,
        token: "mineru-token",
        modelVersion: "vlm",
      },
    })
    const controller = new AbortController()
    controller.abort()
    mockParseWithMineru.mockRejectedValueOnce(new Error("MinerU parsing cancelled"))

    await expect(
      autoIngest(
        tmp.path,
        `${tmp.path}/raw/sources/project-a/cancelled.pdf`,
        useWikiStore.getState().llmConfig,
        controller.signal,
        "project-a",
      ),
    ).rejects.toThrow("Ingest cancelled")

    expect(
      useActivityStore.getState().items.some((item) =>
        item.detail?.includes("falling back to built-in PDF extraction"),
      ),
    ).toBe(false)
  })

  it("canonicalizes interactive source summary paths and sources frontmatter", async () => {
    if (!tmp) throw new Error("missing temp project")

    const conversationId = "conv-interactive-source"
    useChatStore.setState({
      activeConversationId: conversationId,
      conversations: [
        {
          id: conversationId,
          title: "Interactive source summary",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      ingestSource: `${tmp.path}/raw/sources/project-a/config.yaml`,
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "Please save the source summary.",
          timestamp: Date.now(),
          conversationId,
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Ready to create the source summary.",
          timestamp: Date.now(),
          conversationId,
        },
      ],
    })

    const writtenPaths = await executeIngestWrites(
      tmp.path,
      useWikiStore.getState().llmConfig,
    )

    const canonicalSummary = `wiki/sources/${sourceSummarySlugFromIdentity("project-a/config.yaml")}.md`
    const canonicalSummaryPath = path.join(tmp.path, canonicalSummary).replace(/\\/g, "/")
    const staleSummaryPath = path.join(tmp.path, "wiki", "sources", "config.md")
    const content = await fs.readFile(canonicalSummaryPath, "utf8")

    expect(writtenPaths.map((p) => p.replace(/\\/g, "/"))).toEqual([canonicalSummaryPath])
    await expect(fs.access(staleSummaryPath)).rejects.toThrow()
    expect(content).toContain('sources: ["project-a/config.yaml"]')
  })

  it("rejects unsafe and application-managed paths from interactive writes", async () => {
    if (!tmp) throw new Error("missing temp project")
    interactiveGenerationOverride = [
      "---FILE: wiki/INDEX.md---\n# hostile index\n---END FILE---",
      "---FILE: wiki\\overview.MD---\n# hostile overview\n---END FILE---",
      "---FILE: ../escape.md---\n# escape\n---END FILE---",
    ].join("\n")
    useChatStore.setState({ ingestSource: `${tmp.path}/raw/sources/project-a/config.yaml` })

    const written = await executeIngestWrites(tmp.path, useWikiStore.getState().llmConfig)

    expect(written).toEqual([])
    await expect(fs.access(path.join(tmp.path, "escape.md"))).rejects.toThrow()
  })
})
