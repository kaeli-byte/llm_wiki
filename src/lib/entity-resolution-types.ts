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
