/**
 * Page planner — validates wiki page plans, checks batch constraints,
 * and verifies coverage against the evidence ledger.
 *
 * Release B of the improved ingest pipeline.
 */

import type { WikiPagePlan, ConsolidatedEvidenceLedger, PlannedPage } from "@/lib/ingest-quality-types"
import type { EntityResolution, ResolvedPageKind } from "@/lib/entity-resolution-types"

const RESOLVED_PAGE_ROUTING: Record<ResolvedPageKind, { directory: string; type: string }> = {
  source: { directory: "sources", type: "source" },
  company: { directory: "companies", type: "company" },
  segment: { directory: "entities", type: "entity" },
  counterparty: { directory: "companies", type: "company" },
  product: { directory: "products", type: "product" },
  strategic_topic: { directory: "analyses", type: "analysis" },
  financial_performance: { directory: "analyses", type: "analysis" },
  risk: { directory: "analyses", type: "analysis" },
  acquisition: { directory: "analyses", type: "analysis" },
  unresolved_questions: { directory: "queries", type: "query" },
}

const REQUIRED_SECTIONS: Record<ResolvedPageKind, string[]> = {
  source: ["Source", "Executive summary", "Evidence map", "Limitations"],
  company: ["Overview", "Operations", "Evidence", "Uncertainty"],
  segment: ["Overview", "Performance", "Evidence", "Uncertainty"],
  counterparty: ["Relationship", "Evidence", "Materiality", "Uncertainty"],
  product: ["Overview", "Status", "Evidence", "Uncertainty"],
  strategic_topic: ["Thesis", "Evidence", "Inference", "Implications", "Uncertainty"],
  financial_performance: ["Performance", "Drivers", "Evidence", "Uncertainty"],
  risk: ["Risk", "Exposure", "Evidence", "Mitigants", "Uncertainty"],
  acquisition: ["Transaction", "Strategic rationale", "Evidence", "Integration risks"],
  unresolved_questions: ["Open questions", "Why they matter", "Evidence needed"],
}

export interface BuildResolvedPagePlanOptions {
  ledger: ConsolidatedEvidenceLedger
  resolution: EntityResolution
  sourceSummaryPath: string
}

/** Convert a validated semantic resolution into filesystem-authoritative page contracts. */
export function buildResolvedPagePlan({
  ledger,
  resolution,
  sourceSummaryPath,
}: BuildResolvedPagePlanOptions): WikiPagePlan {
  const pathByCandidate = new Map<string, string>()
  for (const candidate of resolution.pages) {
    const route = RESOLVED_PAGE_ROUTING[candidate.kind]
    pathByCandidate.set(candidate.candidateId, candidate.kind === "source"
      ? sourceSummaryPath
      : `wiki/${route.directory}/${candidate.slug}.md`)
  }
  const pages: PlannedPage[] = resolution.pages.map((candidate) => {
    const route = RESOLVED_PAGE_ROUTING[candidate.kind]
    const primaryEvidenceIds = [...new Set(candidate.primaryEvidenceIds)]
    const secondaryEvidenceIds = [...new Set(candidate.secondaryEvidenceIds)]
    return {
      path: pathByCandidate.get(candidate.candidateId)!,
      type: route.type,
      portfolioKind: candidate.kind,
      title: candidate.title,
      priority: candidate.priority,
      action: "create",
      purpose: candidate.rationale,
      subjects: [...new Set([candidate.title, ...candidate.aliases])],
      evidenceIds: [...new Set([...primaryEvidenceIds, ...secondaryEvidenceIds])],
      primaryEvidenceIds,
      secondaryEvidenceIds,
      relatedPaths: candidate.relatedCandidateIds
        .map((id) => pathByCandidate.get(id))
        .filter((path): path is string => Boolean(path)),
      requiredSections: REQUIRED_SECTIONS[candidate.kind],
      maxWords: candidate.kind === "source" ? 900 : candidate.kind === "unresolved_questions" ? 350 : 600,
    }
  })
  const assigned = new Set(pages.flatMap((page) => page.primaryEvidenceIds ?? []))
  const unassignedEvidenceIds = ledger.records.map((record) => record.id).filter((id) => !assigned.has(id))
  return {
    version: 1,
    sourceIdentity: resolution.sourceIdentity,
    pages,
    batches: pages.map((page, index) => ({
      id: `batch-${String(index + 1).padStart(3, "0")}`,
      pagePaths: [page.path],
      estimatedOutputTokens: Math.ceil((page.maxWords ?? 600) * 1.3 + 230),
    })),
    coverageSummary: {
      evidenceRecordsTotal: ledger.records.length,
      evidenceRecordsAssigned: ledger.records.length - unassignedEvidenceIds.length,
      criticalPages: pages.filter((page) => page.priority === "critical").length,
      highPages: pages.filter((page) => page.priority === "high").length,
      unassignedEvidenceIds,
      omittedLowPriorityCandidates: [],
    },
    portfolioLowerBoundJustification: resolution.lowerBoundJustification,
  }
}

const TYPE_DIRECTORIES: Record<string, string> = {
  company: "companies", organization: "organizations", product: "products",
  technology: "technologies", market: "markets", industry: "industries",
  concept: "concepts", person: "people", regulation: "regulations",
  standard: "standards",
}

function slugify(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "untitled"
}

function uniquePath(preferred: string, used: Set<string>): string {
  if (!used.has(preferred)) { used.add(preferred); return preferred }
  const extension = preferred.endsWith(".md") ? ".md" : ""
  const stem = extension ? preferred.slice(0, -3) : preferred
  let suffix = 2
  while (used.has(`${stem}-${suffix}${extension}`)) suffix++
  const path = `${stem}-${suffix}${extension}`
  used.add(path)
  return path
}

export interface DeterministicPagePlanOptions {
  ledger: ConsolidatedEvidenceLedger
  sourceSummaryPath: string
  maxPagesPerBatch?: number
  claimEvidencePerPage?: number
}

/**
 * Produce the complete page-generation contract locally. The LLM is a renderer,
 * not the authority deciding whether evidence becomes a page.
 */
export function buildDeterministicPagePlan({
  ledger,
  sourceSummaryPath,
  maxPagesPerBatch = 8,
  claimEvidencePerPage = 4,
}: DeterministicPagePlanOptions): WikiPagePlan {
  const usedPaths = new Set<string>()
  usedPaths.add(sourceSummaryPath)
  const allEvidenceIds = ledger.records.map((record) => record.id)
  const pages: PlannedPage[] = [{
    path: sourceSummaryPath,
    type: "source",
    title: ledger.sourceMetadata.title || ledger.sourceIdentity.split("/").pop()?.replace(/\.[^.]+$/, "") || ledger.sourceIdentity,
    priority: "critical",
    action: "create",
    purpose: "Authoritative source summary, evidence map, limitations, and links to generated pages.",
    subjects: [...new Set(ledger.records.map((record) => record.subject))],
    evidenceIds: allEvidenceIds,
    relatedPaths: [],
    requiredSections: ["Source", "Executive summary", "Evidence map", "Limitations"],
    maxWords: 900,
  }]

  const typedPageByKey = new Map<string, PlannedPage>()
  for (const record of ledger.records) {
    for (const type of record.candidateTypes) {
      const directory = TYPE_DIRECTORIES[type]
      if (!directory) continue
      const key = `${type}\u0000${record.subject.toLowerCase()}`
      let page = typedPageByKey.get(key)
      if (!page) {
        page = {
          path: uniquePath(`wiki/${directory}/${slugify(record.subject)}.md`, usedPaths),
          type,
          title: record.subject,
          priority: record.confidence === "high" ? "high" : "medium",
          action: "create",
          purpose: `Evidence-backed ${type} profile derived from ${ledger.sourceIdentity}.`,
          subjects: [record.subject], evidenceIds: [], relatedPaths: [sourceSummaryPath],
          requiredSections: ["Overview", "Evidence", "Uncertainty"], maxWords: 500,
        }
        typedPageByKey.set(key, page)
        pages.push(page)
      }
      if (!page.evidenceIds.includes(record.id)) page.evidenceIds.push(record.id)
    }
  }

  const recordsBySubject = new Map<string, typeof ledger.records>()
  for (const record of ledger.records) {
    const current = recordsBySubject.get(record.subject) ?? []
    current.push(record)
    recordsBySubject.set(record.subject, current)
  }
  for (const [subject, subjectRecords] of recordsBySubject) {
    for (let offset = 0; offset < subjectRecords.length; offset += claimEvidencePerPage) {
      const group = subjectRecords.slice(offset, offset + claimEvidencePerPage)
      const first = group[0]
      const baseSlug = first.candidateClaimSlug || `${slugify(subject)}-${Math.floor(offset / claimEvidencePerPage) + 1}`
      const relatedPaths = [...typedPageByKey.entries()]
        .filter(([key]) => key.endsWith(`\u0000${subject.toLowerCase()}`))
        .map(([, page]) => page.path)
      pages.push({
        path: uniquePath(`wiki/claims/${slugify(baseSlug)}.md`, usedPaths),
        type: "claim",
        title: group.length === 1 ? first.claim : `${subject}: ${first.claim}`,
        priority: group.some((record) => record.confidence === "high") ? "high" : "medium",
        action: "create",
        purpose: `Atomic evidence group with ${group.length} closely scoped record${group.length === 1 ? "" : "s"}.`,
        subjects: [subject], evidenceIds: group.map((record) => record.id),
        relatedPaths: [sourceSummaryPath, ...relatedPaths],
        requiredSections: ["Claim", "Evidence", "Source locator", "Confidence"], maxWords: 420,
      })
    }
  }

  for (const question of ledger.openQuestions) {
    pages.push({
      path: uniquePath(`wiki/queries/${slugify(question.question)}.md`, usedPaths),
      type: "query", title: question.question, priority: "medium", action: "create",
      purpose: question.whyItMatters, subjects: [], evidenceIds: question.triggerEvidenceIds,
      relatedPaths: [sourceSummaryPath], requiredSections: ["Question", "Why it matters", "Evidence needed"], maxWords: 300,
    })
  }

  const related = pages.slice(1).map((page) => page.path)
  pages[0] = { ...pages[0], relatedPaths: related }
  const batchSize = Math.max(1, Math.min(12, maxPagesPerBatch))
  const batches = Array.from({ length: Math.ceil(pages.length / batchSize) }, (_, index) => ({
    id: `batch-${String(index + 1).padStart(3, "0")}`,
    pagePaths: pages.slice(index * batchSize, (index + 1) * batchSize).map((page) => page.path),
    estimatedOutputTokens: pages.slice(index * batchSize, (index + 1) * batchSize)
      .reduce((total, page) => total + Math.ceil((page.maxWords ?? 300) * 1.3 + 230), 0),
  }))

  return {
    version: 1, sourceIdentity: ledger.sourceIdentity, pages, batches,
    coverageSummary: {
      evidenceRecordsTotal: ledger.records.length,
      evidenceRecordsAssigned: ledger.records.length,
      criticalPages: pages.filter((page) => page.priority === "critical").length,
      highPages: pages.filter((page) => page.priority === "high").length,
      unassignedEvidenceIds: [], omittedLowPriorityCandidates: [],
    },
  }
}

// ── Schema ──

let pagePlanSchemaCache: object | null = null

export function getPagePlanSchema(): object {
  if (!pagePlanSchemaCache) {
    pagePlanSchemaCache = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "Wiki Page Plan",
      type: "object",
      required: ["version", "source_identity", "pages", "batches", "coverage_summary"],
      properties: {
        version: { const: 1 },
        source_identity: { type: "string", minLength: 1 },
        pages: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: [
              "path", "type", "title", "priority", "action",
              "evidence_ids", "related_paths", "required_sections",
            ],
            properties: {
              path: { type: "string", pattern: "^wiki/.+\\.md$" },
              type: { type: "string", minLength: 1 },
              title: { type: "string", minLength: 1 },
              priority: { enum: ["critical", "high", "medium", "low"] },
              action: { enum: ["create", "update"] },
              purpose: { type: "string" },
              subjects: { type: "array", items: { type: "string" } },
              evidence_ids: { type: "array", items: { type: "string" } },
              related_paths: {
                type: "array",
                items: { type: "string", pattern: "^wiki/.+\\.md$" },
              },
              required_sections: { type: "array", items: { type: "string" } },
              max_words: { type: "integer", minimum: 50, maximum: 1500 },
            },
            additionalProperties: false,
          },
        },
        batches: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "page_paths"],
            properties: {
              id: { type: "string", pattern: "^batch-[0-9]{3,}$" },
              page_paths: {
                type: "array",
                minItems: 1,
                maxItems: 12,
                items: { type: "string", pattern: "^wiki/.+\\.md$" },
              },
              estimated_output_tokens: { type: "integer", minimum: 1 },
            },
            additionalProperties: false,
          },
        },
        coverage_summary: {
          type: "object",
          required: [
            "evidence_records_total", "evidence_records_assigned",
            "critical_pages", "high_pages",
          ],
          properties: {
            evidence_records_total: { type: "integer", minimum: 0 },
            evidence_records_assigned: { type: "integer", minimum: 0 },
            critical_pages: { type: "integer", minimum: 0 },
            high_pages: { type: "integer", minimum: 0 },
            unassigned_evidence_ids: {
              type: "array",
              items: { type: "string" },
            },
            omitted_low_priority_candidates: {
              type: "array",
              items: { type: "string" },
            },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    }
  }
  return pagePlanSchemaCache!
}

// ── Validation ──

export interface PlanValidationResult {
  valid: boolean
  errors: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, path: string, errors: string[], pattern?: RegExp): void {
  if (typeof value !== "string" || value.length === 0) errors.push(`${path} must be a non-empty string`)
  else if (pattern && !pattern.test(value)) errors.push(`${path} has invalid format`)
}

function stringArray(value: unknown, path: string, errors: string[], minItems = 0, maxItems = Infinity, pattern?: RegExp): void {
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems || value.some((item) => typeof item !== "string" || (pattern && !pattern.test(item)))) {
    errors.push(`${path} must be a valid array of strings`)
  }
}

function nonNegativeInteger(value: unknown, path: string, errors: string[]): void {
  if (!Number.isInteger(value) || (value as number) < 0) errors.push(`${path} must be a non-negative integer`)
}

export function validatePagePlan(json: unknown): PlanValidationResult {
  const errors: string[] = []
  if (!isRecord(json)) return { valid: false, errors: ["root must be an object"] }
  if (json.version !== 1) errors.push("/version must equal 1")
  requireString(json.source_identity, "/source_identity", errors)

  const wikiPath = /^wiki\/.+\.md$/
  if (!Array.isArray(json.pages) || json.pages.length === 0) {
    errors.push("/pages must be a non-empty array")
  } else json.pages.forEach((item, index) => {
    const path = `/pages/${index}`
    if (!isRecord(item)) { errors.push(`${path} must be an object`); return }
    requireString(item.path, `${path}/path`, errors, wikiPath)
    requireString(item.type, `${path}/type`, errors)
    requireString(item.title, `${path}/title`, errors)
    if (!["critical", "high", "medium", "low"].includes(String(item.priority))) errors.push(`${path}/priority is invalid`)
    if (!["create", "update"].includes(String(item.action))) errors.push(`${path}/action is invalid`)
    if (item.purpose !== undefined && typeof item.purpose !== "string") errors.push(`${path}/purpose must be a string`)
    if (item.subjects !== undefined) stringArray(item.subjects, `${path}/subjects`, errors)
    stringArray(item.evidence_ids, `${path}/evidence_ids`, errors)
    stringArray(item.related_paths, `${path}/related_paths`, errors, 0, Infinity, wikiPath)
    stringArray(item.required_sections, `${path}/required_sections`, errors)
    if (item.max_words !== undefined && (!Number.isInteger(item.max_words) || (item.max_words as number) < 50 || (item.max_words as number) > 1500)) errors.push(`${path}/max_words must be an integer from 50 to 1500`)
  })

  if (!Array.isArray(json.batches)) {
    errors.push("/batches must be an array")
  } else json.batches.forEach((item, index) => {
    const path = `/batches/${index}`
    if (!isRecord(item)) { errors.push(`${path} must be an object`); return }
    requireString(item.id, `${path}/id`, errors, /^batch-[0-9]{3,}$/)
    stringArray(item.page_paths, `${path}/page_paths`, errors, 1, 12, wikiPath)
    if (item.estimated_output_tokens !== undefined && (!Number.isInteger(item.estimated_output_tokens) || (item.estimated_output_tokens as number) < 1)) errors.push(`${path}/estimated_output_tokens must be a positive integer`)
  })

  if (!isRecord(json.coverage_summary)) {
    errors.push("/coverage_summary must be an object")
  } else {
    const coverage = json.coverage_summary
    for (const key of ["evidence_records_total", "evidence_records_assigned", "critical_pages", "high_pages"]) nonNegativeInteger(coverage[key], `/coverage_summary/${key}`, errors)
    if (coverage.unassigned_evidence_ids !== undefined) stringArray(coverage.unassigned_evidence_ids, "/coverage_summary/unassigned_evidence_ids", errors)
    if (coverage.omitted_low_priority_candidates !== undefined) stringArray(coverage.omitted_low_priority_candidates, "/coverage_summary/omitted_low_priority_candidates", errors)
  }

  return { valid: errors.length === 0, errors }
}

// ── Deterministic plan checks ──

export interface PlanCoverageCheck {
  passed: boolean
  issues: string[]
}

export function checkPlanCoverage(
  plan: WikiPagePlan,
  ledger: ConsolidatedEvidenceLedger,
): PlanCoverageCheck {
  const issues: string[] = []
  const allEvidenceIds = new Set(ledger.records.map((r) => r.id))
  const assignedIds = new Set<string>()
  const usesPrimaryOwnership = plan.pages.some((page) => page.primaryEvidenceIds !== undefined)
  const primaryOwnerCounts = new Map<string, number>()

  for (const page of plan.pages) {
    for (const id of page.evidenceIds) {
      assignedIds.add(id)
      if (!allEvidenceIds.has(id)) {
        issues.push(`Page ${page.path} references evidence ${id} not in ledger`)
      }
    }
    for (const id of page.primaryEvidenceIds ?? []) {
      primaryOwnerCounts.set(id, (primaryOwnerCounts.get(id) ?? 0) + 1)
    }
  }

  // Check critical/high evidence is assigned
  const criticalHighIds = ledger.records
    .filter((r) => r.confidence === "high")
    .map((r) => r.id)
  for (const id of criticalHighIds) {
    if (!assignedIds.has(id)) {
      issues.push(`High-confidence evidence ${id} is not assigned to any page`)
    }
  }

  // Check for duplicate paths
  const paths = plan.pages.map((p) => p.path)
  const dupes = paths.filter((p, i) => paths.indexOf(p) !== i)
  for (const d of [...new Set(dupes)]) {
    issues.push(`Duplicate path: ${d}`)
  }

  // Check claim pages have evidence IDs
  for (const page of plan.pages) {
    if (page.type === "claim" && page.evidenceIds.length === 0) {
      issues.push(`Claim page ${page.path} has no evidence IDs`)
    }
  }

  if (usesPrimaryOwnership) {
    for (const id of allEvidenceIds) {
      const count = primaryOwnerCounts.get(id) ?? 0
      if (count !== 1) issues.push(`Evidence ${id} must have exactly one primary owner; found ${count}`)
    }
    if (plan.pages.some((page) => page.type === "claim" || page.portfolioKind === ("claim" as never))) {
      issues.push("Durable portfolio must not contain standalone claim pages")
    }
    const sourceCount = plan.pages.filter((page) => page.portfolioKind === "source").length
    const primaryCompanyCount = plan.pages.filter((page) => page.portfolioKind === "company").length
    if (sourceCount !== 1) issues.push(`Durable portfolio must contain exactly one source page; found ${sourceCount}`)
    if (primaryCompanyCount !== 1) issues.push(`Durable portfolio must contain exactly one primary company page; found ${primaryCompanyCount}`)
    if (plan.pages.length > 25) issues.push(`Durable portfolio has ${plan.pages.length} pages; maximum 25`)
    if (plan.pages.length < 18 && !plan.portfolioLowerBoundJustification?.trim()) {
      issues.push(`Durable portfolio has ${plan.pages.length} pages; minimum 18 requires justification`)
    }
  }

  return { passed: issues.length === 0, issues }
}

/**
 * Reconcile an otherwise-valid model plan with the authoritative ledger.
 * Evidence omitted from every specialized page is still required on the
 * source summary, so the strict coverage gate remains meaningful without
 * forcing an expensive full-pipeline retry for a repair we can do exactly.
 */
export function ensureEvidenceCoverage(
  plan: WikiPagePlan,
  ledger: ConsolidatedEvidenceLedger,
): WikiPagePlan {
  const assigned = new Set(plan.pages.flatMap((page) => page.evidenceIds))
  const missing = ledger.records.map((record) => record.id).filter((id) => !assigned.has(id))
  if (missing.length === 0) return plan

  const sourceIndex = plan.pages.findIndex((page) => page.type === "source")
  if (sourceIndex < 0) throw new Error("Invalid page plan: missing source summary page")
  const pages = plan.pages.map((page, index) => index === sourceIndex
    ? { ...page, evidenceIds: [...page.evidenceIds, ...missing] }
    : page)
  const assignedAfter = new Set(pages.flatMap((page) => page.evidenceIds))
  const unassignedEvidenceIds = ledger.records
    .map((record) => record.id)
    .filter((id) => !assignedAfter.has(id))

  return {
    ...plan,
    pages,
    coverageSummary: {
      ...plan.coverageSummary,
      evidenceRecordsTotal: ledger.records.length,
      evidenceRecordsAssigned: ledger.records.length - unassignedEvidenceIds.length,
      unassignedEvidenceIds,
    },
  }
}

export function validateBatchConstraints(
  plan: WikiPagePlan,
  maxPagesPerBatch: number = 12,
): PlanCoverageCheck {
  const issues: string[] = []
  const allPaths = new Set(plan.pages.map((p) => p.path))
  const batchedPaths = new Set<string>()

  for (const batch of plan.batches) {
    if (batch.pagePaths.length > maxPagesPerBatch) {
      issues.push(
        `Batch ${batch.id} has ${batch.pagePaths.length} pages (max ${maxPagesPerBatch})`,
      )
    }
    for (const path of batch.pagePaths) {
      if (batchedPaths.has(path)) {
        issues.push(`Path ${path} appears in multiple batches`)
      }
      batchedPaths.add(path)
      if (!allPaths.has(path)) {
        issues.push(`Batch ${batch.id} references unplanned path ${path}`)
      }
    }
  }

  // Check all planned paths are in a batch
  for (const path of allPaths) {
    if (!batchedPaths.has(path)) {
      issues.push(`Planned path ${path} is not assigned to any batch`)
    }
  }

  return { passed: issues.length === 0, issues }
}

// ── Serialization ──

export function planToJson(plan: WikiPagePlan): string {
  return JSON.stringify(plan, null, 2)
}

export function parsePlanJson(json: string): WikiPagePlan | null {
  try {
    return JSON.parse(json) as WikiPagePlan
  } catch {
    return null
  }
}

/** Validate the prompt-facing snake_case plan and normalize it for runtime consumers. */
export function parseAndValidatePagePlan(text: string): WikiPagePlan {
  const firstBrace = text.indexOf("{")
  const lastBrace = text.lastIndexOf("}")
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("Invalid page plan: no JSON object found")
  }

  let raw: Record<string, any>
  try {
    raw = JSON.parse(text.slice(firstBrace, lastBrace + 1)) as Record<string, any>
  } catch (err) {
    throw new Error(`Invalid page plan JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  const validation = validatePagePlan(raw)
  if (!validation.valid) throw new Error(`Invalid page plan: ${validation.errors.join("; ")}`)

  return {
    version: 1,
    sourceIdentity: raw.source_identity,
    pages: raw.pages.map((page: Record<string, any>): PlannedPage => ({
      path: page.path,
      type: page.type,
      title: page.title,
      priority: page.priority,
      action: page.action,
      purpose: page.purpose,
      subjects: page.subjects ?? [],
      evidenceIds: page.evidence_ids,
      relatedPaths: page.related_paths,
      requiredSections: page.required_sections,
      maxWords: page.max_words,
    })),
    batches: raw.batches.map((batch: Record<string, any>) => ({
      id: batch.id,
      pagePaths: batch.page_paths,
      estimatedOutputTokens: batch.estimated_output_tokens,
    })),
    coverageSummary: {
      evidenceRecordsTotal: raw.coverage_summary.evidence_records_total,
      evidenceRecordsAssigned: raw.coverage_summary.evidence_records_assigned,
      criticalPages: raw.coverage_summary.critical_pages,
      highPages: raw.coverage_summary.high_pages,
      unassignedEvidenceIds: raw.coverage_summary.unassigned_evidence_ids ?? [],
      omittedLowPriorityCandidates: raw.coverage_summary.omitted_low_priority_candidates ?? [],
    },
  }
}

export function enforceSourceSummaryPath(plan: WikiPagePlan, canonicalPath: string): WikiPagePlan {
  const sourcePage = plan.pages.find((page) => page.type === "source")
  if (!sourcePage) throw new Error("Invalid page plan: missing source summary page")
  const oldPath = sourcePage.path
  if (oldPath === canonicalPath) return plan
  const rewrite = (path: string) => path === oldPath ? canonicalPath : path
  return {
    ...plan,
    pages: plan.pages.map((page) => ({
      ...page,
      path: page === sourcePage ? canonicalPath : page.path,
      relatedPaths: page.relatedPaths.map(rewrite),
    })),
    batches: plan.batches.map((batch) => ({
      ...batch,
      pagePaths: batch.pagePaths.map(rewrite),
    })),
  }
}
