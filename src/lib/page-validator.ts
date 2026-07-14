/**
 * Deterministic page validator — frontmatter, routing, wikilinks,
 * and evidence contract checks for each batch of generated pages.
 *
 * Release C of the improved ingest pipeline.
 */

import type { WikiPagePlan, EvidenceRecord } from "@/lib/ingest-quality-types"

export interface PageValidationIssue {
  path: string
  severity: "error" | "warning"
  message: string
}

export interface BatchValidationResult {
  passed: boolean
  issues: PageValidationIssue[]
  generatedPaths: string[]
  missingPaths: string[]
}

/**
 * Validate a set of generated page contents against the plan.
 */
export function validateGeneratedPages(
  generated: Map<string, string>,
  plan: WikiPagePlan,
  evidenceLedger?: { records: EvidenceRecord[] },
): BatchValidationResult {
  const issues: PageValidationIssue[] = []
  const generatedPaths = [...generated.keys()]
  const plannedPaths = new Set(plan.pages.map((p) => p.path))

  // A portfolio is transactional: every planned page must exist, regardless
  // of its display priority.
  for (const page of plan.pages) {
    if (!generated.has(page.path)) {
      issues.push({
        path: page.path,
        severity: "error",
        message: `Missing ${page.priority} page: ${page.path}`,
      })
    }
    for (const relatedPath of page.relatedPaths) {
      if (!plannedPaths.has(relatedPath)) {
        issues.push({ path: page.path, severity: "error", message: `Unknown related path ${relatedPath}` })
      }
    }
  }

  if (evidenceLedger) {
    const knownIds = new Set(evidenceLedger.records.map((record) => record.id))
    const owners = new Map<string, string[]>()
    const hasExplicitOwnership = plan.pages.some((page) => page.primaryEvidenceIds !== undefined)
    for (const page of plan.pages) {
      for (const id of page.primaryEvidenceIds ?? []) {
        owners.set(id, [...(owners.get(id) ?? []), page.path])
      }
      for (const id of page.secondaryEvidenceIds ?? []) {
        if (!knownIds.has(id)) issues.push({ path: page.path, severity: "error", message: `Unknown secondary evidence ID ${id}` })
      }
    }
    if (hasExplicitOwnership) {
      for (const id of knownIds) {
        const paths = owners.get(id) ?? []
        if (paths.length !== 1) {
          issues.push({ path: paths[0] ?? "portfolio", severity: "error", message: `Evidence ${id} must have exactly one primary owner; found ${paths.length}` })
        }
      }
      for (const id of owners.keys()) {
        if (!knownIds.has(id)) issues.push({ path: owners.get(id)?.[0] ?? "portfolio", severity: "error", message: `Unknown primary evidence ID ${id}` })
      }
    }
  }

  // Check generated pages match plan types and have valid frontmatter
  for (const [path, content] of generated) {
    if (!plannedPaths.has(path)) {
      issues.push({
        path,
        severity: "warning",
        message: `Generated page not in plan: ${path}`,
      })
      continue
    }

    const planned = plan.pages.find((p) => p.path === path)!
    const frontmatter = parseFrontmatterBasic(content)

    if (!frontmatter.type) {
      issues.push({ path, severity: "error", message: "Missing type in frontmatter" })
    } else if (frontmatter.type !== planned.type) {
      issues.push({
        path,
        severity: "error",
        message: `Type mismatch: expected ${planned.type}, got ${frontmatter.type}`,
      })
    }

    if (!frontmatter.title || frontmatter.title.trim().length === 0) {
      issues.push({ path, severity: "error", message: "Missing title in frontmatter" })
    }

    if (evidenceLedger) {
      const knownIds = new Set(evidenceLedger.records.map((record) => record.id))
      const citedIds = content.match(/\b(?:C\d+-)?E-?\d+\b/g) ?? []
      for (const id of new Set(citedIds)) {
        if (!knownIds.has(id)) issues.push({ path, severity: "error", message: `Unsupported evidence citation ${id}` })
      }
    }

    // Claim pages must have evidence metadata
    if (planned.type === "claim") {
      if (!frontmatter.evidence_type && !frontmatter.evidenceType) {
        issues.push({ path, severity: "error", message: "Claim page missing evidence_type" })
      }
      if (!frontmatter.source_pages && !frontmatter.sourcePages) {
        issues.push({ path, severity: "error", message: "Claim page missing source_pages locator" })
      }
    }

    // Check required sections
    for (const section of planned.requiredSections) {
      const heading = section.replace(/^##\s*/, "").toLowerCase()
      if (!content.toLowerCase().includes(`## ${heading}`) && !content.toLowerCase().includes(`# ${heading}`)) {
        issues.push({
          path,
          severity: "warning",
          message: `Missing required section: ${section}`,
        })
      }
    }

    // Check wikilinks resolve to planned pages
    const wikilinks = extractWikilinks(content)
    for (const link of wikilinks) {
      const normalizedLink = link.replace(/\.md$/, "")
      const candidates = [
        `${normalizedLink}.md`,
        `wiki/${normalizedLink}.md`,
        ...[...plannedPaths].filter((path) => path.replace(/^wiki\//, "").replace(/\.md$/, "") === normalizedLink),
      ]
      const linkTarget = candidates.find((candidate) => plannedPaths.has(candidate) || generated.has(candidate))
      if (!linkTarget) {
        // Allow links to existing index pages
        const aggregateTarget = `wiki/${normalizedLink}.md`
        const isAggregate = aggregateTarget === "wiki/index.md" || aggregateTarget === "wiki/overview.md" || aggregateTarget === "wiki/log.md"
        if (!isAggregate) {
          issues.push({
            path,
            severity: "warning",
            message: `Wikilink targets unplanned page: ${link}`,
          })
        }
      }
    }
  }

  // Find planned but missing pages
  const missingPaths = [...plannedPaths].filter((p) => !generated.has(p))

  return {
    passed: issues.filter((i) => i.severity === "error").length === 0,
    issues,
    generatedPaths,
    missingPaths,
  }
}

interface FrontmatterFields {
  type?: string
  title?: string
  sources?: string[]
  status?: string
  confidence?: string
  evidence_type?: string
  evidenceType?: string
  source_pages?: string
  sourcePages?: string
  [key: string]: unknown
}

function parseFrontmatterBasic(content: string): FrontmatterFields {
  const fm = content.match(/^---\n([\s\S]*?)\n---/)
  if (!fm) return {}
  const fields: FrontmatterFields = {}
  for (const line of fm[1].split("\n")) {
    const match = line.match(/^(\w[\w_]*):\s*(.+)$/)
    if (match) {
      const key = match[1]
      let value: unknown = match[2].trim()
      // Parse arrays
      if (value && typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
        value = value.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""))
      } else if (value && typeof value === "string") {
        value = value.replace(/^["']|["']$/g, "")
      }
      fields[key] = value
    }
  }
  return fields
}

function extractWikilinks(content: string): string[] {
  const links: string[] = []
  const regex = /\[\[([^\]]+)\]\]/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    const target = match[1].split("|")[0] // Handle [[target|label]]
    links.push(target)
  }
  return links
}

/**
 * Summarize validation results for logging and manifests.
 */
export function validationSummary(result: BatchValidationResult): string {
  const errors = result.issues.filter((i) => i.severity === "error")
  const warnings = result.issues.filter((i) => i.severity === "warning")
  return [
    `Generated: ${result.generatedPaths.length}, Missing: ${result.missingPaths.length}`,
    `Errors: ${errors.length}, Warnings: ${warnings.length}`,
    ...errors.map((e) => `  ERROR: ${e.path} — ${e.message}`),
    ...warnings.slice(0, 10).map((w) => `  WARN: ${w.path} — ${w.message}`),
  ].join("\n")
}
