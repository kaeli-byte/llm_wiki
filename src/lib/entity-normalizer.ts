import type { ConsolidatedEvidenceLedger, EvidenceRecord } from "@/lib/ingest-quality-types"
import type {
  EntityKindHint,
  NormalizedCandidate,
  NormalizedEntityInput,
} from "@/lib/entity-resolution-types"

const LEGAL_SUFFIX = /(?:,?\s+)(?:incorporated|inc|corporation|corp|company|co|limited|ltd|plc|llc)\.?$/i
const FINANCIAL_TERMS = /\b(revenue|sales|income|earnings|ebit|ebitda|margin|cash flow|cashflow|profit|loss|balance sheet|debt|liquidity|capital expenditure|capex)\b/i
const RISK_TERMS = /\b(risk|exposure|contingenc|warranty|litigation|concentration|shortage|impairment|uncertain|volatil|cyber|regulatory)\b/i
const ACQUISITION_TERMS = /\b(acquisition|acquire[ds]?|merger|purchase consideration|business combination)\b/i
const STRATEGY_TERMS = /\b(strategy|strategic|resilien|decarbon|sustainab|digital|innovation|localization|dual sourcing|growth initiative|operational excellence)\b/i
const SEGMENT_TERMS = /\b(segment|division|business unit)\b/i
const PRODUCT_TERMS = /\b(platform|product|program|system|solution|series|model)\b/i

function compactWhitespace(value: string): string {
  return value.normalize("NFKC").replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, " ").trim()
}

export function canonicalSubjectKey(value: string): string {
  return compactWhitespace(value)
    .replace(LEGAL_SUFFIX, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase()
}

function stableCandidateId(prefix: string, label: string): string {
  const slug = canonicalSubjectKey(label).replace(/\s+/g, "-").slice(0, 72) || "unnamed"
  return `${prefix}-${slug}`
}

function recordText(record: EvidenceRecord): string {
  return `${record.subject} ${record.claim} ${record.scope ?? ""}`
}

function primaryCompanyKey(ledger: ConsolidatedEvidenceLedger): string {
  const issuer = ledger.sourceMetadata.issuer_or_author
    ?? ledger.sourceMetadata.issuer
    ?? ledger.sourceMetadata.author
    ?? ""
  return canonicalSubjectKey(issuer)
}

function inferKind(
  records: EvidenceRecord[],
  companyKey: string,
): EntityKindHint {
  const subject = records[0]?.subject ?? ""
  const key = canonicalSubjectKey(subject)
  const text = records.map(recordText).join(" ")
  const hints = new Set(records.flatMap((record) => record.candidateTypes.map((type) => type.toLowerCase())))
  if (companyKey && key === companyKey) return "company"
  if (SEGMENT_TERMS.test(subject) || hints.has("segment")) return "segment"
  if (PRODUCT_TERMS.test(subject) || hints.has("product") || hints.has("technology")) return "product"
  if (STRATEGY_TERMS.test(text) || hints.has("concept")) return "strategic_topic"
  if (hints.has("company") || hints.has("organization") || /\b(?:inc|corp|ltd|llc|plc)\.?$/i.test(subject)) return "counterparty"
  return "unknown"
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function relationSummaries(ledger: ConsolidatedEvidenceLedger, aliases: string[]): string[] {
  const keys = new Set(aliases.map(canonicalSubjectKey))
  return unique(ledger.relations
    .filter((relation) => keys.has(canonicalSubjectKey(relation.subject)) || keys.has(canonicalSubjectKey(relation.object)))
    .map((relation) => `${relation.subject} ${relation.predicate} ${relation.object} [${relation.evidenceIds.join(", ")}]`))
}

export function normalizeEntityCandidates(
  ledger: ConsolidatedEvidenceLedger,
): NormalizedEntityInput {
  const grouped = new Map<string, EvidenceRecord[]>()
  for (const record of ledger.records) {
    const key = canonicalSubjectKey(record.subject)
    const records = grouped.get(key) ?? []
    records.push(record)
    grouped.set(key, records)
  }

  const companyKey = primaryCompanyKey(ledger)
  const entities: NormalizedCandidate[] = []
  const strategicThemes: NormalizedCandidate[] = []
  for (const records of grouped.values()) {
    const aliases = unique(records.map((record) => compactWhitespace(record.subject)))
    const canonicalLabel = aliases[0]
    const kindHint = inferKind(records, companyKey)
    const candidate: NormalizedCandidate = {
      candidateId: stableCandidateId(kindHint === "strategic_topic" ? "theme" : "entity", canonicalLabel),
      canonicalLabel,
      aliases,
      kindHint,
      evidenceIds: unique(records.map((record) => record.id)),
      relationSummary: relationSummaries(ledger, aliases),
    }
    if (kindHint === "strategic_topic") strategicThemes.push(candidate)
    else entities.push(candidate)
  }

  const idsMatching = (pattern: RegExp): string[] => unique(ledger.records
    .filter((record) => pattern.test(recordText(record)))
    .map((record) => record.id))
  const questions = ledger.openQuestions
  const questionGroups = questions.length === 0 ? [] : [{
    candidateId: "questions-unresolved",
    questions: unique(questions.map((question) => question.question)),
    evidenceIds: unique(questions.flatMap((question) => question.triggerEvidenceIds)),
    whyItMatters: unique(questions.map((question) => question.whyItMatters)),
    evidenceNeeded: unique(questions.flatMap((question) => question.evidenceNeeded ?? [])),
  }]

  return {
    sourceIdentity: ledger.sourceIdentity,
    evidenceIds: unique(ledger.records.map((record) => record.id)),
    entities,
    financialEvidenceIds: idsMatching(FINANCIAL_TERMS),
    riskEvidenceIds: idsMatching(RISK_TERMS),
    acquisitionEvidenceIds: idsMatching(ACQUISITION_TERMS),
    strategicThemes,
    questionGroups,
  }
}
