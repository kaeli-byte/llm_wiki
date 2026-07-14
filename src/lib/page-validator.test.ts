import { describe, expect, it } from "vitest"
import { validateGeneratedPages } from "./page-validator"
import type { ConsolidatedEvidenceLedger, WikiPagePlan } from "./ingest-quality-types"

const ledger: ConsolidatedEvidenceLedger = {
  sourceIdentity: "report.pdf",
  sourceMetadata: {},
  records: [
    { id: "E-001", subject: "Aeroflex", claim: "Revenue grew", evidenceClass: "direct", confidence: "high", sourceLocator: { label: "p. 3", page: 3 }, candidateTypes: [] },
    { id: "E-002", subject: "Aeroflex", claim: "Risk increased", evidenceClass: "direct", confidence: "high", sourceLocator: { label: "p. 8", page: 8 }, candidateTypes: [] },
  ],
  relations: [],
  coverage: {},
  openQuestions: [],
}

function plan(): WikiPagePlan {
  return {
    version: 1,
    sourceIdentity: "report.pdf",
    pages: [
      { path: "wiki/companies/aeroflex.md", type: "company", title: "Aeroflex", priority: "critical", action: "create", subjects: ["Aeroflex"], evidenceIds: ["E-001"], primaryEvidenceIds: ["E-001"], secondaryEvidenceIds: [], relatedPaths: ["wiki/analyses/risk.md"], requiredSections: [] },
      { path: "wiki/analyses/risk.md", type: "analysis", title: "Risk", priority: "medium", action: "create", subjects: ["Risk"], evidenceIds: ["E-002"], primaryEvidenceIds: ["E-002"], secondaryEvidenceIds: [], portfolioKind: "risk", relatedPaths: ["wiki/companies/aeroflex.md"], requiredSections: [] },
    ],
    batches: [],
    coverageSummary: { evidenceRecordsTotal: 2, evidenceRecordsAssigned: 2, criticalPages: 1, highPages: 0, unassignedEvidenceIds: [], omittedLowPriorityCandidates: [] },
  }
}

const page = (type: string, title: string, body = "") => `---\ntype: ${type}\ntitle: ${title}\n---\n${body}`

describe("validateGeneratedPages", () => {
  it("fails when any planned page is missing regardless of priority", () => {
    const generated = new Map([["wiki/companies/aeroflex.md", page("company", "Aeroflex")]])
    const result = validateGeneratedPages(generated, plan(), ledger)
    expect(result.passed).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({ path: "wiki/analyses/risk.md", severity: "error" }))
  })

  it("fails duplicate primary ownership and unknown secondary evidence", () => {
    const input = plan()
    input.pages[1].primaryEvidenceIds = ["E-001", "E-002"]
    input.pages[1].secondaryEvidenceIds = ["E-999"]
    const generated = new Map(input.pages.map((p) => [p.path, page(p.type, p.title)]))
    const result = validateGeneratedPages(generated, input, ledger)
    expect(result.passed).toBe(false)
    expect(result.issues.map((issue) => issue.message).join("\n")).toMatch(/E-001.*primary owner|Unknown secondary evidence ID E-999/)
  })

  it("flags unsupported evidence citations", () => {
    const input = plan()
    const generated = new Map(input.pages.map((p) => [p.path, page(p.type, p.title, "Evidence: [E-999; p. 9]")]))
    const result = validateGeneratedPages(generated, input, ledger)
    expect(result.passed).toBe(false)
    expect(result.issues.map((issue) => issue.message).join("\n")).toContain("Unsupported evidence citation E-999")
  })

  it("fails planned relationships that target no portfolio page", () => {
    const input = plan()
    input.pages[0].relatedPaths.push("wiki/products/missing.md")
    const generated = new Map(input.pages.map((p) => [p.path, page(p.type, p.title)]))
    const result = validateGeneratedPages(generated, input, ledger)
    expect(result.passed).toBe(false)
    expect(result.issues.map((issue) => issue.message).join("\n")).toContain("Unknown related path wiki/products/missing.md")
  })
})
