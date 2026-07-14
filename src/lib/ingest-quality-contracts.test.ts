import { describe, expect, it } from "vitest"
import { parseChunkEvidenceLedger } from "./evidence-ledger"
import { buildResolvedPagePlan, checkPlanCoverage, ensureEvidenceCoverage, enforceSourceSummaryPath, parseAndValidatePagePlan } from "./page-planner"
import type { EntityResolution } from "./entity-resolution-types"

describe("ingest quality LLM contracts", () => {
  it("normalizes validated snake_case evidence JSON into runtime types", () => {
    const ledger = parseChunkEvidenceLedger(JSON.stringify({
      source: { identity: "report.pdf", document_type: "annual-report" },
      chunk: { index: 1, total: 2, heading_path: "Revenue" },
      records: [{
        id: "C1-E001",
        subject: "Aeroflex Mobility",
        claim: "Revenue increased.",
        evidence_class: "direct",
        confidence: "high",
        source_locator: { label: "p. 4", page: 4, page_end: 5 },
        candidate_types: ["claim", "company"],
        candidate_claim_slug: "revenue-increased",
        related_subjects: ["Mobility segment"],
        quantitative_inputs: [{ name: "revenue", value: 120, unit: "USDm", period: "FY2025" }],
        formula: "120 / 100 - 1",
        management_qualified: true,
      }],
      relations: [{
        subject: "Aeroflex Mobility",
        predicate: "reports",
        object: "Revenue increased",
        evidence_ids: ["C1-E001"],
      }],
      coverage: { financial_statements: "covered" },
      open_questions: [{
        question: "Is growth organic?",
        why_it_matters: "Changes the quality assessment.",
        trigger_evidence_ids: ["C1-E001"],
        evidence_needed: ["acquisition bridge"],
      }],
    }))

    expect(ledger.records[0]).toMatchObject({
      evidenceClass: "direct",
      sourceLocator: { label: "p. 4", pageEnd: 5 },
      candidateTypes: ["claim", "company"],
      candidateClaimSlug: "revenue-increased",
      relatedSubjects: ["Mobility segment"],
      quantitativeInputs: [{ name: "revenue", value: 120, unit: "USDm", period: "FY2025" }],
      formula: "120 / 100 - 1",
      managementQualified: true,
    })
    expect(ledger.relations?.[0].evidenceIds).toEqual(["C1-E001"])
    expect(ledger.open_questions?.[0]).toMatchObject({
      whyItMatters: "Changes the quality assessment.",
      triggerEvidenceIds: ["C1-E001"],
      evidenceNeeded: ["acquisition bridge"],
    })
  })

  it("normalizes validated snake_case page-plan JSON into runtime types", () => {
    const plan = parseAndValidatePagePlan(JSON.stringify({
      version: 1,
      source_identity: "report.pdf",
      pages: [{
        path: "wiki/claims/revenue-increased.md",
        type: "claim",
        title: "Revenue increased",
        priority: "critical",
        action: "create",
        subjects: ["Aeroflex Mobility"],
        evidence_ids: ["C1-E001"],
        related_paths: ["wiki/companies/aeroflex-mobility.md"],
        required_sections: ["Evidence"],
        max_words: 400,
      }],
      batches: [{
        id: "batch-001",
        page_paths: ["wiki/claims/revenue-increased.md"],
        estimated_output_tokens: 900,
      }],
      coverage_summary: {
        evidence_records_total: 1,
        evidence_records_assigned: 1,
        critical_pages: 1,
        high_pages: 0,
        unassigned_evidence_ids: [],
        omitted_low_priority_candidates: [],
      },
    }))

    expect(plan).toMatchObject({
      sourceIdentity: "report.pdf",
      pages: [{
        evidenceIds: ["C1-E001"],
        relatedPaths: ["wiki/companies/aeroflex-mobility.md"],
        requiredSections: ["Evidence"],
        maxWords: 400,
      }],
      batches: [{
        pagePaths: ["wiki/claims/revenue-increased.md"],
        estimatedOutputTokens: 900,
      }],
      coverageSummary: {
        evidenceRecordsTotal: 1,
        evidenceRecordsAssigned: 1,
        criticalPages: 1,
      },
    })
  })

  it("rejects invalid evidence before normalization", () => {
    expect(() => parseChunkEvidenceLedger('{"records":[]}')).toThrow(/Invalid evidence ledger/)
  })

  it("treats null optional evidence fields as absent", () => {
    const ledger = parseChunkEvidenceLedger(JSON.stringify({
      source: { identity: "report.pdf", document_type: "annual-report" },
      chunk: { index: 1, total: 1 },
      records: [{
        id: "C1-E001", subject: "Aeroflex", claim: "Revenue increased.",
        evidence_class: "direct", confidence: "high",
        source_locator: { label: "p. 4", section: null },
        candidate_types: ["company"], formula: null, period: null,
      }],
      coverage: {},
    }))
    expect(ledger.records[0].formula).toBeUndefined()
    expect(ledger.records[0].period).toBeUndefined()
    expect(ledger.records[0].sourceLocator.section).toBeUndefined()
  })

  it("rewrites the planned source page and every reference to the canonical source path", () => {
    const plan = parseAndValidatePagePlan(JSON.stringify({
      version: 1, source_identity: "folder/report.pdf",
      pages: [{ path: "wiki/sources/report.md", type: "source", title: "Report", priority: "critical", action: "create", subjects: [], evidence_ids: [], related_paths: [], required_sections: [] }],
      batches: [{ id: "batch-001", page_paths: ["wiki/sources/report.md"] }],
      coverage_summary: { evidence_records_total: 0, evidence_records_assigned: 0, critical_pages: 1, high_pages: 0 },
    }))

    const normalized = enforceSourceSummaryPath(plan, "wiki/sources/canonical-report.md")
    expect(normalized.pages[0].path).toBe("wiki/sources/canonical-report.md")
    expect(normalized.batches[0].pagePaths).toEqual(["wiki/sources/canonical-report.md"])
  })

  it("assigns omitted evidence to the source summary and reconciles coverage counts", () => {
    const plan = parseAndValidatePagePlan(JSON.stringify({
      version: 1, source_identity: "report.pdf",
      pages: [
        { path: "wiki/sources/report.md", type: "source", title: "Report", priority: "critical", action: "create", subjects: [], evidence_ids: ["C1-E001"], related_paths: [], required_sections: [] },
        { path: "wiki/claims/growth.md", type: "claim", title: "Growth", priority: "high", action: "create", subjects: [], evidence_ids: ["C1-E002"], related_paths: [], required_sections: [] },
      ],
      batches: [{ id: "batch-001", page_paths: ["wiki/sources/report.md", "wiki/claims/growth.md"] }],
      coverage_summary: { evidence_records_total: 3, evidence_records_assigned: 2, critical_pages: 1, high_pages: 1, unassigned_evidence_ids: ["C1-E003"] },
    }))
    const complete = ensureEvidenceCoverage(plan, {
      sourceIdentity: "report.pdf",
      sourceMetadata: {}, relations: [], openQuestions: [], coverage: {},
      records: [
        { id: "C1-E001", subject: "A", claim: "One", evidenceClass: "direct", confidence: "high", sourceLocator: { label: "p1" }, candidateTypes: ["source"] },
        { id: "C1-E002", subject: "A", claim: "Two", evidenceClass: "direct", confidence: "high", sourceLocator: { label: "p2" }, candidateTypes: ["claim"] },
        { id: "C1-E003", subject: "A", claim: "Three", evidenceClass: "direct", confidence: "high", sourceLocator: { label: "p3" }, candidateTypes: ["source"] },
      ],
    })

    expect(complete.pages[0].evidenceIds).toEqual(["C1-E001", "C1-E003"])
    expect(complete.coverageSummary.evidenceRecordsAssigned).toBe(3)
    expect(complete.coverageSummary.unassignedEvidenceIds).toEqual([])
  })

  it("builds an 18-page durable portfolio without standalone claim pages", () => {
    const records = Array.from({ length: 17 }, (_, index) => ({
      id: `C1-E${String(index + 1).padStart(3, "0")}`,
      subject: index < 2 ? "Aeroflex Mobility" : `Supported subject ${index + 1}`,
      claim: `Evidence statement ${index + 1}`,
      evidenceClass: "direct" as const,
      confidence: "high" as const,
      sourceLocator: { label: `p.${index + 1}` },
      candidateTypes: ["claim"],
      candidateClaimSlug: `evidence-statement-${index + 1}`,
    }))
    const kinds = [
      "source", "company", "segment", "segment", "counterparty", "counterparty",
      "product", "product", "product", "product", "product", "strategic_topic",
      "strategic_topic", "strategic_topic", "financial_performance", "risk",
      "acquisition", "unresolved_questions",
    ] as const
    const resolution: EntityResolution = {
      version: 1, sourceIdentity: "report.pdf", mergeDecisions: [],
      pages: kinds.map((kind, index) => ({
        candidateId: `page-${index + 1}`, kind, title: `Page ${index + 1}`, slug: `page-${index + 1}`,
        priority: index < 2 ? "critical" : "high", aliases: [],
        primaryEvidenceIds: index === 0 ? [] : [records[index - 1].id],
        secondaryEvidenceIds: [], relatedCandidateIds: [], rationale: "Durable subject.",
      })),
    }
    const plan = buildResolvedPagePlan({
      ledger: {
        sourceIdentity: "report.pdf", sourceMetadata: {}, relations: [], coverage: {}, records,
        openQuestions: [],
      },
      resolution,
      sourceSummaryPath: "wiki/sources/report.md",
    })

    expect(plan.pages[0]).toMatchObject({ path: "wiki/sources/report.md", type: "source" })
    expect(plan.pages).toHaveLength(18)
    expect(plan.pages.some((page) => page.type === "claim")).toBe(false)
    expect(plan.pages.filter((page) => page.portfolioKind === "company")).toHaveLength(1)
    expect(plan.pages.filter((page) => page.portfolioKind === "segment")).toHaveLength(2)
    expect(new Set(plan.pages.flatMap((page) => page.primaryEvidenceIds ?? []))).toEqual(new Set(records.map((record) => record.id)))
    expect(plan.batches.every((batch) => batch.pagePaths.length === 1)).toBe(true)
    expect(plan.batches.flatMap((batch) => batch.pagePaths)).toEqual(plan.pages.map((page) => page.path))
    expect(checkPlanCoverage(plan, { sourceIdentity: "report.pdf", sourceMetadata: {}, relations: [], coverage: {}, openQuestions: [], records }).passed).toBe(true)
  })
})
