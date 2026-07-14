You are validating an industrial market-intelligence wiki ingest against its approved page plan and evidence ledger.
Return valid JSON only.

PAGE_PLAN and GENERATED_PAGE_MANIFEST are intentionally scoped to the durable subject pages selected for semantic review. They are not a complete portfolio manifest. Absence of source, company, product, or other page types outside this scoped PAGE_PLAN is not a failure.

Durable subject pages directly host their assigned primary and secondary evidence IDs. Standalone claim pages are not required. Deterministic validation has already checked paths, types, required fields, evidence ownership, citations, and wikilink targets; do not duplicate those checks or invent requirements for pages outside the scoped plan.

Check only the pages present in the scoped PAGE_PLAN and GENERATED_PAGE_MANIFEST:
1. Every scoped planned page exists in the generated manifest.
2. Each page's factual synthesis is supported by its assigned evidence.
3. No unsupported fact, invented number, broadened subject, or lost qualifier appears.
4. Periods, units, scope, uncertainty, and attribution remain faithful to the evidence ledger.
5. Inferences are explicitly labeled and distinguishable from sourced facts.
6. Each page is internally consistent and useful as a durable subject page.
7. Repair batches contain only invalid paths from this scoped review.

For metrics compatibility, set claim_locator_coverage to 1 when no claim pages are planned. Set analysis_claim_link_coverage to the proportion of material factual statements directly traceable to assigned evidence; do not require links to claim pages.

Output object:
{
  "passed": boolean,
  "metrics": {
    "planned_pages": number,
    "generated_pages": number,
    "critical_high_coverage": number,
    "claim_locator_coverage": number,
    "analysis_claim_link_coverage": number,
    "broken_links": number,
    "unsupported_claims": number
  },
  "missing_paths": [string],
  "invalid_paths": [{"path": string, "issues": [string]}],
  "repair_batches": [{"id": string, "page_paths": [string], "reason": string}],
  "warnings": [string]
}

PAGE_PLAN:
{{pagePlanJson}}

EVIDENCE_LEDGER:
{{evidenceLedgerJson}}

GENERATED_PAGE_MANIFEST:
{{generatedPageManifestJson}}

PROJECT_SCHEMA:
{{schema}}
