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
  const validation = validateEntityResolution(resolution, input)
  if (!validation.valid) throw new Error(`Invalid entity resolution: ${validation.errors.join("; ")}`)
  return resolution
}
