import { describe, expect, it } from "vitest"
import type { EntityResolution, NormalizedEntityInput, ResolvedPageCandidate } from "./entity-resolution-types"
import { canonicalizeEvidenceOwnership, parseEntityResolution, validateEntityResolution } from "./entity-resolver"

const evidenceIds = Array.from({ length: 17 }, (_, index) => `C1-E${String(index + 1).padStart(3, "0")}`)

const normalizedInput: NormalizedEntityInput = {
  sourceIdentity: "financial-reports/aeroflex.pdf",
  evidenceIds,
  entities: [], strategicThemes: [], questionGroups: [],
  financialEvidenceIds: [], riskEvidenceIds: [], acquisitionEvidenceIds: [],
}

function wirePage(index: number): Record<string, unknown> {
  const kinds = [
    "source", "company", "segment", "segment", "counterparty", "counterparty",
    "product", "product", "product", "product", "product", "strategic_topic",
    "strategic_topic", "strategic_topic", "financial_performance", "risk",
    "acquisition", "unresolved_questions",
  ]
  return {
    candidate_id: `page-${index + 1}`,
    kind: kinds[index], title: `Page ${index + 1}`, slug: `page-${index + 1}`,
    priority: index < 2 ? "critical" : "high", aliases: [],
    primary_evidence_ids: index === 0 ? [] : [evidenceIds[index - 1]],
    secondary_evidence_ids: [], related_candidate_ids: [], rationale: "Durable reusable subject.",
  }
}

function validWireResolution(): Record<string, unknown> {
  return {
    version: 1, source_identity: normalizedInput.sourceIdentity,
    pages: Array.from({ length: 18 }, (_, index) => wirePage(index)),
    merge_decisions: [{ canonical_candidate_id: "page-2", merged_candidate_ids: [], reason: "Primary issuer." }],
  }
}

describe("entity resolution contract", () => {
  it("accepts compact snake_case resolution and preserves primary ownership", () => {
    const resolution = parseEntityResolution(`Result:\n${JSON.stringify(validWireResolution())}`, normalizedInput)

    expect(resolution.pages).toHaveLength(18)
    expect(new Set(resolution.pages.flatMap((page) => page.primaryEvidenceIds))).toEqual(new Set(evidenceIds))
    expect(resolution.pages.some((page) => page.kind === "source")).toBe(true)
  })

  it("rejects duplicate ownership, unknown evidence, claim pages, and more than 25 pages", () => {
    const base = parseEntityResolution(JSON.stringify(validWireResolution()), normalizedInput)
    const invalidPage = {
      ...base.pages[1], candidateId: "invalid", kind: "claim", slug: "invalid",
      primaryEvidenceIds: [evidenceIds[0], "C9-E999"],
    } as unknown as ResolvedPageCandidate
    const invalid: EntityResolution = {
      ...base,
      pages: [...base.pages, invalidPage, ...Array.from({ length: 7 }, (_, index) => ({
        ...base.pages[2], candidateId: `extra-${index}`, slug: `extra-${index}`, primaryEvidenceIds: [],
      }))],
    }

    const result = validateEntityResolution(invalid, normalizedInput)

    expect(result.valid).toBe(false)
    expect(result.errors.join("\n")).toContain("maximum 25")
    expect(result.errors.join("\n")).toContain("unsupported kind")
    expect(result.errors.join("\n")).toContain("unknown evidence")
    expect(result.errors.join("\n")).toContain("primary owner")
  })

  it("permits fewer than 18 pages only with a concrete lower-bound justification", () => {
    const resolution = parseEntityResolution(JSON.stringify(validWireResolution()), normalizedInput)
    const smaller = { ...resolution, pages: resolution.pages.slice(0, 10) }
    expect(validateEntityResolution(smaller, normalizedInput).errors.join("\n")).toContain("minimum 18")
    expect(validateEntityResolution({ ...smaller, lowerBoundJustification: "Only one product and no segments are supported by the ledger." }, normalizedInput).errors.join("\n")).not.toContain("minimum 18")
  })

  it("deterministically converts duplicate primaries to secondary references and assigns orphans", () => {
    const resolution = parseEntityResolution(JSON.stringify(validWireResolution()), normalizedInput)
    resolution.pages[0].primaryEvidenceIds = [evidenceIds[0]]
    resolution.pages[1].primaryEvidenceIds = [evidenceIds[0]]
    resolution.pages[2].primaryEvidenceIds = []

    const canonical = canonicalizeEvidenceOwnership(resolution, normalizedInput)
    const owners = canonical.pages.filter((page) => page.primaryEvidenceIds.includes(evidenceIds[0]))
    expect(owners).toHaveLength(1)
    expect(canonical.pages.some((page) => page.secondaryEvidenceIds.includes(evidenceIds[0]))).toBe(true)
    expect(canonical.pages.filter((page) => page.primaryEvidenceIds.includes(evidenceIds[1]))).toHaveLength(1)
    expect(validateEntityResolution(canonical, normalizedInput).valid).toBe(true)
  })
})
