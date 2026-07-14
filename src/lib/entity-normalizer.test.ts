import { describe, expect, it } from "vitest"
import type { ConsolidatedEvidenceLedger, EvidenceRecord } from "./ingest-quality-types"
import { normalizeEntityCandidates } from "./entity-normalizer"

function record(id: string, subject: string, claim: string, relatedSubjects: string[] = []): EvidenceRecord {
  return {
    id, subject, claim, relatedSubjects,
    evidenceClass: "direct", confidence: "high",
    sourceLocator: { label: `page ${id}` }, candidateTypes: ["claim"],
  }
}

function ledger(records: EvidenceRecord[]): ConsolidatedEvidenceLedger {
  return {
    sourceIdentity: "financial-reports/aeroflex.pdf",
    sourceMetadata: { issuer_or_author: "AeroFlex Mobility Systems, Inc." },
    records, relations: [], coverage: {}, openQuestions: [],
  }
}

describe("normalizeEntityCandidates", () => {
  it("merges legal-suffix and punctuation aliases without losing evidence", () => {
    const result = normalizeEntityCandidates(ledger([
      record("C1-E001", "AeroFlex Mobility Systems, Inc.", "The issuer reports revenue."),
      record("C1-E002", "Aeroflex Mobility Systems", "The issuer has two segments."),
    ]))

    expect(result.entities).toHaveLength(1)
    expect(result.entities[0]).toMatchObject({
      canonicalLabel: "AeroFlex Mobility Systems, Inc.",
      kindHint: "company",
      evidenceIds: ["C1-E001", "C1-E002"],
    })
    expect(result.entities[0].aliases).toEqual([
      "AeroFlex Mobility Systems, Inc.",
      "Aeroflex Mobility Systems",
    ])
  })

  it("keeps named products, explicit segments, strategic themes, and questions distinct", () => {
    const source = ledger([
      record("C1-E001", "AeroFlex Mobility Systems, Inc.", "The issuer operates globally."),
      record("C1-E002", "Advanced Air Mobility segment", "Segment revenue increased."),
      record("C1-E003", "FlexWing platform", "The product entered qualification."),
      record("C1-E004", "Supply-chain resilience", "Dual sourcing reduced exposure."),
      record("C1-E005", "AeroFlex Mobility Systems, Inc.", "Net income increased."),
      record("C1-E006", "AeroFlex Mobility Systems, Inc.", "Warranty exposure remains material."),
      record("C1-E007", "SkyDrive acquisition", "The acquisition closed in 2025."),
    ])
    source.relations = [{
      subject: "AeroFlex Mobility Systems, Inc.", predicate: "offers", object: "FlexWing platform",
      evidenceIds: ["C1-E003"],
    }]
    source.openQuestions = [{
      question: "Can customer concentration be independently verified?",
      whyItMatters: "Concentration affects downside risk.",
      triggerEvidenceIds: ["C1-E006"], evidenceNeeded: ["customer-level revenue"],
    }]

    const result = normalizeEntityCandidates(source)

    expect(result.entities.map((item) => item.kindHint)).toEqual(
      expect.arrayContaining(["company", "segment", "product"]),
    )
    expect(result.strategicThemes.map((item) => item.canonicalLabel)).toContain("Supply-chain resilience")
    expect(result.financialEvidenceIds).toContain("C1-E005")
    expect(result.riskEvidenceIds).toContain("C1-E006")
    expect(result.acquisitionEvidenceIds).toContain("C1-E007")
    expect(result.questionGroups).toEqual([expect.objectContaining({
      questions: ["Can customer concentration be independently verified?"],
      evidenceIds: ["C1-E006"],
    })])
    expect(new Set(result.evidenceIds)).toEqual(new Set(source.records.map((item) => item.id)))
  })

  it("uses legacy candidate types only as hints and never creates claim candidates", () => {
    const item = record("C1-E001", "FlexWing platform", "The product entered qualification.")
    item.candidateTypes = ["claim", "product"]
    const result = normalizeEntityCandidates(ledger([item]))

    expect(result.entities).toHaveLength(1)
    expect(result.entities[0].kindHint).toBe("product")
    expect(result.entities.some((candidate) => candidate.kindHint === ("claim" as never))).toBe(false)
  })
})
