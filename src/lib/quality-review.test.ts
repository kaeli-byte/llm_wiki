import { describe, expect, it } from "vitest"
import { parseQualityReviewResult, selectSemanticReviewPlan } from "./quality-review"
import type { WikiPagePlan } from "./ingest-quality-types"
import { readFileSync } from "node:fs"

describe("quality review contract", () => {
  it("normalizes the prompt-facing snake_case result", () => {
    const result = parseQualityReviewResult(JSON.stringify({
      passed: false,
      metrics: {
        planned_pages: 4,
        generated_pages: 4,
        critical_high_coverage: 1,
        claim_locator_coverage: 0.75,
        analysis_claim_link_coverage: 0.5,
        broken_links: 1,
        unsupported_claims: 0,
      },
      missing_paths: [],
      invalid_paths: [{ path: "wiki/claims/revenue.md", issues: ["missing locator"] }],
      repair_batches: [{ id: "repair-001", page_paths: ["wiki/claims/revenue.md"], reason: "Add locator" }],
      warnings: ["review warning"],
    }))

    expect(result).toMatchObject({
      metrics: { plannedPages: 4, claimLocatorCoverage: 0.75, brokenLinks: 1 },
      invalidPaths: [{ path: "wiki/claims/revenue.md", issues: ["missing locator"] }],
      repairBatches: [{ id: "repair-001", pagePaths: ["wiki/claims/revenue.md"], reason: "Add locator" }],
      warnings: ["review warning"],
    })
  })

  it("rejects a malformed quality result instead of crashing downstream", () => {
    expect(() => parseQualityReviewResult('{"passed":false}')).toThrow(/Invalid quality review/)
  })

  it("reviews only synthesis pages plus deterministic failures", () => {
    const pages = [
      { path: "wiki/sources/report.md", portfolioKind: "source" },
      { path: "wiki/companies/aeroflex.md", portfolioKind: "company" },
      { path: "wiki/analyses/strategy.md", portfolioKind: "strategic_topic" },
      { path: "wiki/analyses/financials.md", portfolioKind: "financial_performance" },
      { path: "wiki/products/flexwing.md", portfolioKind: "product" },
    ].map((page, index) => ({ ...page, type: "analysis", title: page.path, priority: "medium" as const, action: "create" as const, subjects: [], evidenceIds: [], relatedPaths: [], requiredSections: [], primaryEvidenceIds: [`E-${index}`] }))
    const plan = { version: 1, sourceIdentity: "report.pdf", pages, batches: [], coverageSummary: { evidenceRecordsTotal: 5, evidenceRecordsAssigned: 5, criticalPages: 0, highPages: 0, unassignedEvidenceIds: [], omittedLowPriorityCandidates: [] } } as WikiPagePlan
    const scoped = selectSemanticReviewPlan(plan, ["wiki/products/flexwing.md"])
    expect(scoped.pages.map((page) => page.path)).toEqual([
      "wiki/analyses/strategy.md",
      "wiki/analyses/financials.md",
      "wiki/products/flexwing.md",
    ])
  })

  it("defines a scoped durable-page QA contract without requiring claim pages", () => {
    const prompt = readFileSync(new URL("./prompts/builtin/quality-review.md", import.meta.url), "utf8")
    expect(prompt).toContain("intentionally scoped")
    expect(prompt).toContain("durable subject pages")
    expect(prompt).not.toContain("Every claim page")
    expect(prompt).not.toContain("linked to a claim page")
  })
})
