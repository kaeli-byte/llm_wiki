import type {
  EntityResolution,
  NormalizedEntityInput,
  ResolutionValidationResult,
  ResolvedPageCandidate,
  ResolvedPageKind,
} from "@/lib/entity-resolution-types"

const ALLOWED_KINDS = new Set<ResolvedPageKind>([
  "source", "company", "segment", "counterparty", "product",
  "strategic_topic", "financial_performance", "risk", "acquisition",
  "unresolved_questions",
])
const PRIORITIES = new Set(["critical", "high", "medium", "low"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${path} must be a non-empty string`)
  return value.trim()
}

function extractJsonObject(text: string): Record<string, unknown> {
  const first = text.indexOf("{")
  const last = text.lastIndexOf("}")
  if (first < 0 || last <= first) throw new Error("Invalid entity resolution: no complete JSON object found")
  try {
    const value = JSON.parse(text.slice(first, last + 1)) as unknown
    if (!isRecord(value)) throw new Error("root must be an object")
    return value
  } catch (error) {
    throw new Error(`Invalid entity resolution JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function parsePage(raw: unknown, index: number): ResolvedPageCandidate {
  if (!isRecord(raw)) throw new Error(`/pages/${index} must be an object`)
  const priority = requiredString(raw.priority, `/pages/${index}/priority`)
  if (!PRIORITIES.has(priority)) throw new Error(`/pages/${index}/priority is invalid`)
  return {
    candidateId: requiredString(raw.candidate_id, `/pages/${index}/candidate_id`),
    kind: requiredString(raw.kind, `/pages/${index}/kind`) as ResolvedPageKind,
    title: requiredString(raw.title, `/pages/${index}/title`),
    slug: requiredString(raw.slug, `/pages/${index}/slug`),
    priority: priority as ResolvedPageCandidate["priority"],
    aliases: strings(raw.aliases),
    primaryEvidenceIds: strings(raw.primary_evidence_ids),
    secondaryEvidenceIds: strings(raw.secondary_evidence_ids),
    relatedCandidateIds: strings(raw.related_candidate_ids),
    rationale: requiredString(raw.rationale, `/pages/${index}/rationale`),
  }
}

function ownershipScore(page: ResolvedPageCandidate, evidenceId: string, input: NormalizedEntityInput): number {
  let score = page.primaryEvidenceIds.includes(evidenceId) ? 10 : 0
  if (page.kind === "financial_performance" && input.financialEvidenceIds.includes(evidenceId)) score += 100
  if (page.kind === "risk" && input.riskEvidenceIds.includes(evidenceId)) score += 100
  if (page.kind === "acquisition" && input.acquisitionEvidenceIds.includes(evidenceId)) score += 100
  if (page.kind === "unresolved_questions" && input.questionGroups.some((group) => group.evidenceIds.includes(evidenceId))) score += 100
  const candidates = [...input.entities, ...input.strategicThemes].filter((candidate) => candidate.evidenceIds.includes(evidenceId))
  for (const candidate of candidates) {
    const labels = [candidate.canonicalLabel, ...candidate.aliases].map((label) => label.toLocaleLowerCase())
    if (labels.some((label) => page.title.toLocaleLowerCase().includes(label) || label.includes(page.title.toLocaleLowerCase()))) score += 80
    if (page.kind === candidate.kindHint || (page.kind === "counterparty" && candidate.kindHint === "company")) score += 40
  }
  if (page.kind === "company") score += 5
  if (page.kind === "source") score -= 10
  return score
}

/** The model proposes page relevance; deterministic code owns the invariant.
 * Each evidence ID gets one best primary owner and remains secondary on every
 * other page that referenced it as primary. */
export function canonicalizeEvidenceOwnership(
  resolution: EntityResolution,
  input: NormalizedEntityInput,
): EntityResolution {
  const pages = resolution.pages.map((page) => ({
    ...page,
    primaryEvidenceIds: [...new Set(page.primaryEvidenceIds)],
    secondaryEvidenceIds: [...new Set(page.secondaryEvidenceIds)],
  }))
  const sourcePage = pages.find((page) => page.kind === "source")
  for (const evidenceId of input.evidenceIds) {
    const referenced = pages.filter((page) =>
      page.primaryEvidenceIds.includes(evidenceId) || page.secondaryEvidenceIds.includes(evidenceId))
    const candidates = referenced.length > 0 ? referenced : pages
    const owner = candidates
      .map((page, index) => ({ page, index, score: ownershipScore(page, evidenceId, input) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.page ?? sourcePage
    if (!owner) continue
    for (const page of pages) {
      const wasPrimary = page.primaryEvidenceIds.includes(evidenceId)
      page.primaryEvidenceIds = page.primaryEvidenceIds.filter((id) => id !== evidenceId)
      page.secondaryEvidenceIds = page.secondaryEvidenceIds.filter((id) => id !== evidenceId)
      if (page === owner) page.primaryEvidenceIds.push(evidenceId)
      else if (wasPrimary) page.secondaryEvidenceIds.push(evidenceId)
    }
  }
  return { ...resolution, pages }
}

export function validateEntityResolution(
  resolution: EntityResolution,
  input: NormalizedEntityInput,
): ResolutionValidationResult {
  const errors: string[] = []
  if (resolution.version !== 1) errors.push("Resolution version must equal 1")
  if (resolution.sourceIdentity !== input.sourceIdentity) errors.push("Resolution source identity does not match normalized input")
  if (resolution.pages.length > 25) errors.push(`Resolution has ${resolution.pages.length} pages; maximum 25`)
  if (resolution.pages.length < 18 && !resolution.lowerBoundJustification?.trim()) {
    errors.push(`Resolution has ${resolution.pages.length} pages; minimum 18 requires a lower-bound justification`)
  }

  const sourcePages = resolution.pages.filter((page) => page.kind === "source")
  const companyPages = resolution.pages.filter((page) => page.kind === "company")
  if (sourcePages.length !== 1) errors.push(`Resolution must contain exactly one source page; found ${sourcePages.length}`)
  if (companyPages.length !== 1) errors.push(`Resolution must contain exactly one primary company page; found ${companyPages.length}`)

  const knownIds = new Set(input.evidenceIds)
  const ownerCounts = new Map<string, number>()
  const candidateIds = new Set<string>()
  const slugs = new Set<string>()
  for (const page of resolution.pages) {
    if (!ALLOWED_KINDS.has(page.kind)) errors.push(`Page ${page.candidateId} has unsupported kind ${String(page.kind)}`)
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page.slug)) errors.push(`Page ${page.candidateId} has invalid slug ${page.slug}`)
    if (candidateIds.has(page.candidateId)) errors.push(`Duplicate candidate ID ${page.candidateId}`)
    candidateIds.add(page.candidateId)
    if (slugs.has(page.slug)) errors.push(`Duplicate page slug ${page.slug}`)
    slugs.add(page.slug)
    for (const id of page.primaryEvidenceIds) {
      if (!knownIds.has(id)) errors.push(`Page ${page.candidateId} references unknown evidence ${id}`)
      ownerCounts.set(id, (ownerCounts.get(id) ?? 0) + 1)
    }
    for (const id of page.secondaryEvidenceIds) {
      if (!knownIds.has(id)) errors.push(`Page ${page.candidateId} references unknown evidence ${id}`)
    }
  }
  for (const id of input.evidenceIds) {
    const count = ownerCounts.get(id) ?? 0
    if (count !== 1) errors.push(`Evidence ${id} must have exactly one primary owner; found ${count}`)
  }
  for (const page of resolution.pages) {
    for (const related of page.relatedCandidateIds) {
      if (!candidateIds.has(related)) errors.push(`Page ${page.candidateId} references unknown related candidate ${related}`)
    }
  }

  return { valid: errors.length === 0, errors }
}

export function parseEntityResolution(
  text: string,
  input: NormalizedEntityInput,
): EntityResolution {
  const raw = extractJsonObject(text)
  if (raw.version !== 1) throw new Error("Invalid entity resolution: version must equal 1")
  if (!Array.isArray(raw.pages)) throw new Error("Invalid entity resolution: pages must be an array")
  const mergeDecisions = Array.isArray(raw.merge_decisions)
    ? raw.merge_decisions.map((decision, index) => {
      if (!isRecord(decision)) throw new Error(`/merge_decisions/${index} must be an object`)
      return {
        canonicalCandidateId: requiredString(decision.canonical_candidate_id, `/merge_decisions/${index}/canonical_candidate_id`),
        mergedCandidateIds: strings(decision.merged_candidate_ids),
        reason: requiredString(decision.reason, `/merge_decisions/${index}/reason`),
      }
    })
    : []
  const resolution: EntityResolution = {
    version: 1,
    sourceIdentity: requiredString(raw.source_identity, "/source_identity"),
    pages: raw.pages.map(parsePage),
    mergeDecisions,
    lowerBoundJustification: typeof raw.lower_bound_justification === "string"
      ? raw.lower_bound_justification.trim() || undefined
      : undefined,
  }
  const canonical = canonicalizeEvidenceOwnership(resolution, input)
  const validation = validateEntityResolution(canonical, input)
  if (!validation.valid) throw new Error(`Invalid entity resolution: ${validation.errors.join("; ")}`)
  return canonical
}
