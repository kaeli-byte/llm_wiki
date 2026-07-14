export type ResolvedPageKind =
  | "source"
  | "company"
  | "segment"
  | "counterparty"
  | "product"
  | "strategic_topic"
  | "financial_performance"
  | "risk"
  | "acquisition"
  | "unresolved_questions"

export type EntityKindHint =
  | "company"
  | "segment"
  | "counterparty"
  | "product"
  | "strategic_topic"
  | "unknown"

export interface NormalizedCandidate {
  candidateId: string
  canonicalLabel: string
  aliases: string[]
  kindHint: EntityKindHint
  evidenceIds: string[]
  relationSummary: string[]
}

export interface NormalizedQuestionGroup {
  candidateId: string
  questions: string[]
  evidenceIds: string[]
  whyItMatters: string[]
  evidenceNeeded: string[]
}

export interface NormalizedEntityInput {
  sourceIdentity: string
  evidenceIds: string[]
  entities: NormalizedCandidate[]
  financialEvidenceIds: string[]
  riskEvidenceIds: string[]
  acquisitionEvidenceIds: string[]
  strategicThemes: NormalizedCandidate[]
  questionGroups: NormalizedQuestionGroup[]
}

export interface ResolvedPageCandidate {
  candidateId: string
  kind: ResolvedPageKind
  title: string
  slug: string
  priority: "critical" | "high" | "medium" | "low"
  aliases: string[]
  primaryEvidenceIds: string[]
  secondaryEvidenceIds: string[]
  relatedCandidateIds: string[]
  rationale: string
}

export interface EntityResolution {
  version: 1
  sourceIdentity: string
  pages: ResolvedPageCandidate[]
  mergeDecisions: Array<{
    canonicalCandidateId: string
    mergedCandidateIds: string[]
    reason: string
  }>
  lowerBoundJustification?: string
}

export interface ResolutionValidationResult {
  valid: boolean
  errors: string[]
}
