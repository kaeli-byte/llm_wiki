You resolve a compact evidence candidate set into a durable Obsidian wiki portfolio.
Return valid JSON only. Do not write page prose or Markdown.

Allowed page kinds:
source | company | segment | counterparty | product | strategic_topic | financial_performance | risk | acquisition | unresolved_questions

Rules:
1. Produce 18–25 supported pages. Never exceed 25 and never invent a page to reach 18.
2. Produce exactly one source page and exactly one primary company page.
3. Do not produce claim pages. Evidence records are provenance units owned by durable pages.
4. Assign every evidence ID to exactly one `primary_evidence_ids` list. It may additionally appear in `secondary_evidence_ids`.
5. Consolidate aliases and repetitive subjects. Explain every merge in `merge_decisions`.
6. Prefer explicit segments, named products/programs, material counterparties, 3–5 strategic themes, and consolidated financial, risk, acquisition, and unresolved-question pages when supported.
7. Use short deterministic kebab-case slugs and stable candidate IDs.
8. If fewer than 18 supported pages exist, include a concrete `lower_bound_justification`.

JSON shape:
{
  "version": 1,
  "source_identity": "string",
  "pages": [{
    "candidate_id": "string",
    "kind": "allowed kind",
    "title": "string",
    "slug": "kebab-case",
    "priority": "critical | high | medium | low",
    "aliases": ["string"],
    "primary_evidence_ids": ["C1-E001"],
    "secondary_evidence_ids": ["C1-E002"],
    "related_candidate_ids": ["string"],
    "rationale": "short string"
  }],
  "merge_decisions": [{
    "canonical_candidate_id": "string",
    "merged_candidate_ids": ["string"],
    "reason": "short string"
  }],
  "lower_bound_justification": "optional string"
}

SOURCE_IDENTITY:
{{sourceIdentity}}

NORMALIZED_CANDIDATES:
{{normalizedCandidatesJson}}
