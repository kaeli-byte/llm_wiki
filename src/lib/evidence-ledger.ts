/**
 * Evidence ledger — JSON Schema validation, deterministic consolidation,
 * and deduplication of chunk-level evidence records.
 *
 * Release B of the improved ingest pipeline (llm-wiki-financial-ingest-quality-pack).
 */

import type {
  EvidenceRecord,
  EvidenceRelation,
  OpenQuestion,
  ConsolidatedEvidenceLedger,
} from "@/lib/ingest-quality-types"

// ── Schema loading ──

let evidenceSchemaCache: object | null = null

export function getEvidenceLedgerSchema(): object {
  if (!evidenceSchemaCache) {
    evidenceSchemaCache = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "Evidence Ledger",
      type: "object",
      required: ["source", "chunk", "records", "coverage"],
      properties: {
        source: {
          type: "object",
          required: ["identity", "document_type"],
          properties: {
            identity: { type: "string", minLength: 1 },
            document_type: { type: "string", minLength: 1 },
            issuer_or_author: { type: "string" },
            reporting_period: { type: "string" },
            publication_date: { type: "string" },
            evidence_rank: { type: "string" },
          },
          additionalProperties: false,
        },
        chunk: {
          type: "object",
          required: ["index", "total"],
          properties: {
            index: { type: "integer", minimum: 1 },
            total: { type: "integer", minimum: 1 },
            heading_path: { type: "string" },
            page_start: { type: ["integer", "null"], minimum: 1 },
            page_end: { type: ["integer", "null"], minimum: 1 },
          },
          additionalProperties: false,
        },
        records: {
          type: "array",
          items: {
            type: "object",
            required: [
              "id", "subject", "claim", "evidence_class",
              "confidence", "source_locator", "candidate_types",
            ],
            properties: {
              id: { type: "string", pattern: "^C[0-9]+-E[0-9]{3,}$" },
              subject: { type: "string", minLength: 1 },
              claim: { type: "string", minLength: 1 },
              evidence_class: {
                enum: ["direct", "calculated", "inferred", "hypothesis", "unknown"],
              },
              confidence: { enum: ["high", "medium", "low"] },
              source_locator: {
                type: "object",
                required: ["label"],
                properties: {
                  label: { type: "string", minLength: 1 },
                  page: { type: ["integer", "null"], minimum: 1 },
                  page_end: { type: ["integer", "null"], minimum: 1 },
                  section: { type: "string" },
                  note: { type: "string" },
                  table: { type: "string" },
                },
                additionalProperties: false,
              },
              period: { type: "string" },
              geography: { type: "string" },
              scope: { type: "string" },
              candidate_types: {
                type: "array",
                minItems: 1,
                items: { type: "string" },
              },
              candidate_claim_slug: { type: "string" },
              related_subjects: {
                type: "array",
                items: { type: "string" },
              },
              quantitative_inputs: {
                type: "array",
                items: {
                  type: "object",
                  required: ["name", "value"],
                  properties: {
                    name: { type: "string" },
                    value: { type: ["number", "string"] },
                    unit: { type: "string" },
                    period: { type: "string" },
                  },
                  additionalProperties: false,
                },
              },
              formula: { type: "string" },
              management_qualified: { type: "boolean" },
            },
            additionalProperties: false,
          },
        },
        relations: {
          type: "array",
          items: {
            type: "object",
            required: ["subject", "predicate", "object", "evidence_ids"],
            properties: {
              subject: { type: "string" },
              predicate: { type: "string" },
              object: { type: "string" },
              evidence_ids: { type: "array", items: { type: "string" } },
            },
            additionalProperties: false,
          },
        },
        coverage: {
          type: "object",
          additionalProperties: {
            enum: ["covered", "not_applicable", "missing_from_extraction", "expected_later"],
          },
        },
        open_questions: {
          type: "array",
          items: {
            type: "object",
            required: ["question", "why_it_matters", "trigger_evidence_ids"],
            properties: {
              question: { type: "string" },
              why_it_matters: { type: "string" },
              trigger_evidence_ids: { type: "array", items: { type: "string" } },
              evidence_needed: { type: "array", items: { type: "string" } },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    }
  }
  return evidenceSchemaCache!
}

// ── Validation ──

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, path: string, errors: string[]): Record<string, unknown> | null {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return null
  }
  return value
}

function requireString(value: unknown, path: string, errors: string[], nonEmpty = false): void {
  if (typeof value !== "string" || (nonEmpty && value.length === 0)) {
    errors.push(`${path} must be ${nonEmpty ? "a non-empty " : "a "}string`)
  }
}

function optionalString(value: unknown, path: string, errors: string[]): void {
  if (value !== undefined && value !== null && typeof value !== "string") errors.push(`${path} must be a string`)
}

function optionalStringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function stringArray(value: unknown, path: string, errors: string[], minItems = 0): void {
  if (!Array.isArray(value) || value.length < minItems || value.some((item) => typeof item !== "string")) {
    errors.push(`${path} must be an array of strings${minItems ? ` with at least ${minItems} item` : ""}`)
  }
}

function positiveIntegerOrNull(value: unknown, path: string, errors: string[], optional = true): void {
  if (value === undefined && optional) return
  if (value !== null && (!Number.isInteger(value) || (value as number) < 1)) {
    errors.push(`${path} must be a positive integer or null`)
  }
}

export function validateChunkEvidenceLedger(json: unknown): ValidationResult {
  const errors: string[] = []
  const root = requireRecord(json, "root", errors)
  if (!root) return { valid: false, errors }

  const source = requireRecord(root.source, "/source", errors)
  if (source) {
    requireString(source.identity, "/source/identity", errors, true)
    requireString(source.document_type, "/source/document_type", errors, true)
    for (const key of ["issuer_or_author", "reporting_period", "publication_date", "evidence_rank"]) {
      optionalString(source[key], `/source/${key}`, errors)
    }
  }

  const chunk = requireRecord(root.chunk, "/chunk", errors)
  if (chunk) {
    positiveIntegerOrNull(chunk.index, "/chunk/index", errors, false)
    positiveIntegerOrNull(chunk.total, "/chunk/total", errors, false)
    optionalString(chunk.heading_path, "/chunk/heading_path", errors)
    positiveIntegerOrNull(chunk.page_start, "/chunk/page_start", errors)
    positiveIntegerOrNull(chunk.page_end, "/chunk/page_end", errors)
  }

  if (!Array.isArray(root.records)) {
    errors.push("/records must be an array")
  } else {
    root.records.forEach((item, index) => {
      const path = `/records/${index}`
      const record = requireRecord(item, path, errors)
      if (!record) return
      requireString(record.id, `${path}/id`, errors, true)
      if (typeof record.id === "string" && !/^C[0-9]+-E[0-9]{3,}$/.test(record.id)) errors.push(`${path}/id has invalid format`)
      requireString(record.subject, `${path}/subject`, errors, true)
      requireString(record.claim, `${path}/claim`, errors, true)
      if (!["direct", "calculated", "inferred", "hypothesis", "unknown"].includes(String(record.evidence_class))) errors.push(`${path}/evidence_class is invalid`)
      if (!["high", "medium", "low"].includes(String(record.confidence))) errors.push(`${path}/confidence is invalid`)
      stringArray(record.candidate_types, `${path}/candidate_types`, errors, 1)
      const locator = requireRecord(record.source_locator, `${path}/source_locator`, errors)
      if (locator) {
        requireString(locator.label, `${path}/source_locator/label`, errors, true)
        positiveIntegerOrNull(locator.page, `${path}/source_locator/page`, errors)
        positiveIntegerOrNull(locator.page_end, `${path}/source_locator/page_end`, errors)
        for (const key of ["section", "note", "table"]) optionalString(locator[key], `${path}/source_locator/${key}`, errors)
      }
      for (const key of ["period", "geography", "scope", "candidate_claim_slug", "formula"]) optionalString(record[key], `${path}/${key}`, errors)
      if (record.related_subjects !== undefined) stringArray(record.related_subjects, `${path}/related_subjects`, errors)
      if (record.management_qualified !== undefined && typeof record.management_qualified !== "boolean") errors.push(`${path}/management_qualified must be a boolean`)
      if (record.quantitative_inputs !== undefined) {
        if (!Array.isArray(record.quantitative_inputs)) errors.push(`${path}/quantitative_inputs must be an array`)
        else record.quantitative_inputs.forEach((input, inputIndex) => {
          const inputPath = `${path}/quantitative_inputs/${inputIndex}`
          const entry = requireRecord(input, inputPath, errors)
          if (!entry) return
          requireString(entry.name, `${inputPath}/name`, errors)
          if (typeof entry.value !== "string" && typeof entry.value !== "number") errors.push(`${inputPath}/value must be a string or number`)
          optionalString(entry.unit, `${inputPath}/unit`, errors)
          optionalString(entry.period, `${inputPath}/period`, errors)
        })
      }
    })
  }

  if (!isRecord(root.coverage)) errors.push("/coverage must be an object")
  else for (const [key, value] of Object.entries(root.coverage)) {
    if (!["covered", "not_applicable", "missing_from_extraction", "expected_later"].includes(String(value))) errors.push(`/coverage/${key} is invalid`)
  }

  if (root.relations !== undefined) {
    if (!Array.isArray(root.relations)) errors.push("/relations must be an array")
    else root.relations.forEach((item, index) => {
      const path = `/relations/${index}`
      const relation = requireRecord(item, path, errors)
      if (!relation) return
      requireString(relation.subject, `${path}/subject`, errors)
      requireString(relation.predicate, `${path}/predicate`, errors)
      requireString(relation.object, `${path}/object`, errors)
      stringArray(relation.evidence_ids, `${path}/evidence_ids`, errors)
    })
  }

  if (root.open_questions !== undefined) {
    if (!Array.isArray(root.open_questions)) errors.push("/open_questions must be an array")
    else root.open_questions.forEach((item, index) => {
      const path = `/open_questions/${index}`
      const question = requireRecord(item, path, errors)
      if (!question) return
      requireString(question.question, `${path}/question`, errors)
      requireString(question.why_it_matters, `${path}/why_it_matters`, errors)
      stringArray(question.trigger_evidence_ids, `${path}/trigger_evidence_ids`, errors)
      if (question.evidence_needed !== undefined) stringArray(question.evidence_needed, `${path}/evidence_needed`, errors)
    })
  }

  return { valid: errors.length === 0, errors }
}

// ── JSON repair (lightweight) ──

export function extractJsonBlock(text: string): string | null {
  // Try extracting from ```json ... ``` fence
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (fenceMatch) return fenceMatch[1].trim()

  // Try extracting from first { to last }
  const firstBrace = text.indexOf("{")
  const lastBrace = text.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim()
  }

  return null
}

// ── Deterministic consolidation ──

export interface ChunkEvidenceLedger {
  source: { identity: string }
  chunk: { index: number; total: number; heading_path?: string }
  records: EvidenceRecord[]
  relations?: EvidenceRelation[]
  coverage?: Record<string, string>
  open_questions?: OpenQuestion[]
}

interface RawChunkEvidenceLedger {
  source: { identity: string; document_type?: string }
  chunk: { index: number; total: number; heading_path?: string }
  records: Array<Record<string, unknown>>
  relations?: Array<Record<string, unknown>>
  coverage?: Record<string, string>
  open_questions?: Array<Record<string, unknown>>
}

/** Validate the LLM-facing snake_case schema and normalize it at the boundary. */
export function parseChunkEvidenceLedger(text: string): ChunkEvidenceLedger {
  const json = extractJsonBlock(text)
  if (!json) throw new Error("Invalid evidence ledger: no JSON object found")

  let raw: RawChunkEvidenceLedger
  try {
    raw = JSON.parse(json) as RawChunkEvidenceLedger
  } catch (err) {
    throw new Error(`Invalid evidence ledger JSON: ${err instanceof Error ? err.message : String(err)}`)
  }

  const validation = validateChunkEvidenceLedger(raw)
  if (!validation.valid) {
    throw new Error(`Invalid evidence ledger: ${validation.errors.join("; ")}`)
  }

  return {
    source: raw.source,
    chunk: {
      index: raw.chunk.index,
      total: raw.chunk.total,
      heading_path: raw.chunk.heading_path,
    },
    records: raw.records.map((record) => ({
      id: String(record.id),
      subject: String(record.subject),
      claim: String(record.claim),
      evidenceClass: record.evidence_class as EvidenceRecord["evidenceClass"],
      confidence: record.confidence as EvidenceRecord["confidence"],
      sourceLocator: (() => {
        const locator = record.source_locator as Record<string, unknown>
        return {
          label: String(locator.label),
          page: locator.page as number | null | undefined,
          pageEnd: locator.page_end as number | null | undefined,
          section: optionalStringValue(locator.section),
          note: optionalStringValue(locator.note),
          table: optionalStringValue(locator.table),
        }
      })(),
      period: optionalStringValue(record.period),
      geography: optionalStringValue(record.geography),
      scope: optionalStringValue(record.scope),
      candidateTypes: record.candidate_types as string[],
      candidateClaimSlug: optionalStringValue(record.candidate_claim_slug),
      relatedSubjects: record.related_subjects as string[] | undefined,
      quantitativeInputs: record.quantitative_inputs as EvidenceRecord["quantitativeInputs"],
      formula: optionalStringValue(record.formula),
      managementQualified: record.management_qualified as boolean | undefined,
    })),
    relations: raw.relations?.map((relation) => ({
      subject: String(relation.subject),
      predicate: String(relation.predicate),
      object: String(relation.object),
      evidenceIds: relation.evidence_ids as string[],
    })),
    coverage: raw.coverage,
    open_questions: raw.open_questions?.map((question) => ({
      question: String(question.question),
      whyItMatters: String(question.why_it_matters),
      triggerEvidenceIds: question.trigger_evidence_ids as string[],
      evidenceNeeded: question.evidence_needed as string[] | undefined,
    })),
  }
}

function evidenceFingerprint(record: EvidenceRecord): string {
  return [
    record.subject.trim().toLowerCase(),
    record.claim.trim().toLowerCase(),
    record.evidenceClass,
    record.period ?? "",
    record.geography ?? "",
    record.scope ?? "",
  ].join("||")
}

export function consolidateEvidenceLedgers(
  sourceIdentity: string,
  chunkLedgers: ChunkEvidenceLedger[],
): ConsolidatedEvidenceLedger {
  const merged: EvidenceRecord[] = []
  const seen = new Set<string>()
  const sourceMetadata: Record<string, string> = {}

  // Preserve source metadata from first ledger
  const first = chunkLedgers[0]
  if (first?.source) {
    if ((first.source as any).document_type) sourceMetadata.document_type = (first.source as any).document_type
  }

  // Merge records with deterministic deduplication
  for (const ledger of chunkLedgers) {
    for (const record of ledger.records) {
      const fp = evidenceFingerprint(record)
      if (seen.has(fp)) continue
      seen.add(fp)
      merged.push(record)
    }
  }

  // Merge relations
  const relations: EvidenceRelation[] = []
  const relSeen = new Set<string>()
  for (const ledger of chunkLedgers) {
    for (const rel of ledger.relations ?? []) {
      const key = `${rel.subject}|${rel.predicate}|${rel.object}`
      if (relSeen.has(key)) {
        // Add evidence IDs to existing relation
        const existing = relations.find(
          (r) => r.subject === rel.subject && r.predicate === rel.predicate && r.object === rel.object,
        )
        if (existing) {
          for (const id of rel.evidenceIds) {
            if (!existing.evidenceIds.includes(id)) existing.evidenceIds.push(id)
          }
        }
        continue
      }
      relSeen.add(key)
      relations.push({ ...rel })
    }
  }

  // Merge coverage
  const coverage: Record<string, "covered" | "not_applicable" | "missing_from_extraction" | "expected_later"> = {}
  for (const ledger of chunkLedgers) {
    if (ledger.coverage) {
      for (const [key, value] of Object.entries(ledger.coverage)) {
        if (
          [
            "covered",
            "not_applicable",
            "missing_from_extraction",
            "expected_later",
          ].includes(value)
        ) {
          coverage[key] = value as typeof coverage[string]
        }
      }
    }
  }

  // Merge open questions
  const openQuestions: OpenQuestion[] = []
  for (const ledger of chunkLedgers) {
    for (const q of ledger.open_questions ?? []) {
      openQuestions.push(q)
    }
  }

  return {
    sourceIdentity,
    sourceMetadata,
    records: merged,
    relations,
    coverage,
    openQuestions,
  }
}

// ── Serialization ──

export function ledgerToJson(ledger: ConsolidatedEvidenceLedger): string {
  return JSON.stringify(ledger, null, 2)
}

export function parseLedgerJson(json: string): ConsolidatedEvidenceLedger | null {
  try {
    return JSON.parse(json) as ConsolidatedEvidenceLedger
  } catch {
    return null
  }
}
