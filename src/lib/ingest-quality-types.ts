export type EvidenceClass = "direct" | "calculated" | "inferred" | "hypothesis" | "unknown"
export type Confidence = "high" | "medium" | "low"
export type PagePriority = "critical" | "high" | "medium" | "low"

export interface EvidenceLocator {
  label: string
  page?: number | null
  pageEnd?: number | null
  section?: string
  note?: string
  table?: string
}

export interface QuantitativeInput {
  name: string
  value: number | string
  unit?: string
  period?: string
}

export interface EvidenceRecord {
  id: string
  subject: string
  claim: string
  evidenceClass: EvidenceClass
  confidence: Confidence
  sourceLocator: EvidenceLocator
  period?: string
  geography?: string
  scope?: string
  quantitativeInputs?: QuantitativeInput[]
  formula?: string
  managementQualified?: boolean
  candidateTypes: string[]
  candidateClaimSlug?: string
  relatedSubjects?: string[]
}

export interface EvidenceRelation {
  subject: string
  predicate: string
  object: string
  evidenceIds: string[]
}

export interface OpenQuestion {
  question: string
  whyItMatters: string
  triggerEvidenceIds: string[]
  evidenceNeeded?: string[]
}

export interface ConsolidatedEvidenceLedger {
  sourceIdentity: string
  sourceMetadata: Record<string, string>
  records: EvidenceRecord[]
  relations: EvidenceRelation[]
  coverage: Record<string, "covered" | "not_applicable" | "missing_from_extraction" | "expected_later">
  openQuestions: OpenQuestion[]
}

export interface PlannedPage {
  path: string
  type: string
  title: string
  priority: PagePriority
  action: "create" | "update"
  purpose?: string
  subjects: string[]
  evidenceIds: string[]
  primaryEvidenceIds?: string[]
  secondaryEvidenceIds?: string[]
  portfolioKind?: import("@/lib/entity-resolution-types").ResolvedPageKind
  relatedPaths: string[]
  requiredSections: string[]
  frontmatterFields?: Record<string, unknown>
  maxWords?: number
}

export interface GenerationBatch {
  id: string
  pagePaths: string[]
  estimatedOutputTokens?: number
}

export interface WikiPagePlan {
  version: 1
  sourceIdentity: string
  pages: PlannedPage[]
  batches: GenerationBatch[]
  coverageSummary: {
    evidenceRecordsTotal: number
    evidenceRecordsAssigned: number
    criticalPages: number
    highPages: number
    unassignedEvidenceIds: string[]
    omittedLowPriorityCandidates: string[]
  }
  portfolioLowerBoundJustification?: string
}

export interface QualityReviewResult {
  passed: boolean
  metrics: {
    plannedPages: number
    generatedPages: number
    criticalHighCoverage: number
    claimLocatorCoverage: number
    analysisClaimLinkCoverage: number
    brokenLinks: number
    unsupportedClaims: number
  }
  missingPaths: string[]
  invalidPaths: Array<{ path: string; issues: string[] }>
  repairBatches: Array<{ id: string; pagePaths: string[]; reason: string }>
  warnings: string[]
}
