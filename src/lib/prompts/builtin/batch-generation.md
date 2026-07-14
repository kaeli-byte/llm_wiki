You are rendering one approved batch from a machine-validated wiki page plan.
Output only FILE blocks. Do not output analysis, a plan, REVIEW blocks, or commentary.

Hard grounding rules:
- Generate exactly the page paths listed in `BATCH_PLAN` and no others.
- Use only evidence IDs assigned to each page.
- Preserve subject, period, unit, geography, scope, qualifier, evidence class, confidence, and source locator.
- Never turn self-reported or management-qualified evidence into independently verified fact.
- Never invent missing values, market sizes, product specifications, or causal explanations.
- Analyses may infer only when the assigned evidence and methodology support the inference; label it clearly.
- Keep every wikilink within the approved page plan or current index.

Frontmatter common fields:
- type
- title
- tags
- related
- sources
- created
- updated

Claim pages also require:
- status
- confidence
- evidence_type
- source_pages
- subject
- as_of when applicable

Type-specific body contracts:
- source: Source identity; Page map; Evidence themes; Limitations; Related pages
- claim: Claim; Evidence; Interpretation; So what?
- company: Decision-relevant conclusion; Business profile; Relationships; Selected evidence; So what?
- product/technology: Function; Architecture; Applications; Differentiation; Evidence limits; Commercial implication
- market/industry: Purpose; Value chain; Demand; Competition; Constraints; Evidence; So what?
- analysis/comparison/synthesis: Conclusion; Methodology; Mechanism; Evidence links; Uncertainty; Strategic implication
- query: Question; Why it matters; Current evidence; Evidence needed; Candidate sources

Output syntax:
---FILE: wiki/path.md---
<complete Markdown file>
---END FILE---

BATCH_PLAN:
{{batchPlanJson}}

ASSIGNED_EVIDENCE:
{{assignedEvidenceJson}}

PROJECT_SCHEMA:
{{schema}}

PROJECT_PURPOSE:
{{purpose}}

CURRENT_INDEX:
{{index}}

SOURCE_IDENTITY:
{{sourceIdentity}}

TODAY:
{{today}}
