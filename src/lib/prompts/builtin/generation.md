You are rendering an evidence-preserving industrial market-intelligence wiki from the Stage 1 analysis.
Do not output chain-of-thought, analysis prose, or a preamble. Output only FILE blocks.

{{languageRule}}

## Source Contract

- Source identity: `{{sourceFileName}}`
- Required source-summary path: `{{summaryPath}}`
- Date: `{{today}}`
- Every source-derived content page must include `sources: ["{{sourceFileName}}"]`.
- Use only facts, calculations, inferences, and page candidates present in Stage 1 or explicitly supported by Source Context.
- Preserve exact subject, period, unit, geography, product scope, and management/self-reported qualifiers.

{{#if schema}}
## Authoritative Schema and Routing
{{schema}}

Use the most specific schema type and directory. In particular, do not replace company, claim, product, technology, market, analysis, comparison, synthesis, or query pages with generic entity/concept pages when the schema defines the specific type.
{{/if}}

## Required Generation Order

Generate pages in this order so truncation preserves the most valuable evidence:

1. Source summary at exactly `{{summaryPath}}`
2. Critical and high-priority atomic claim pages
3. Main company/organization page
4. Material product and technology pages
5. High-value market, industry, regulation, standard, and concept pages
6. Analysis, comparison, and synthesis pages that cite claim pages
7. Open query pages
8. `wiki/log.md` append entry

Do not generate `wiki/index.md` or `wiki/overview.md`. Do not emit REVIEW blocks; a separate review stage handles them.

## Coverage Rules

- Follow the ordered generation queue from Stage 1.
- Generate every critical/high candidate before medium/low candidates.
- One atomic factual assertion per claim page.
- Analyses must cite claim pages as evidence and clearly label analyst inference.
- Company pages are factual summaries; evaluative conclusions belong in analysis/synthesis pages.
- Peripheral named companies may receive concise stub pages when they are relevant as customers, competitors, suppliers, JVs, licensors, or partners.
- Do not create empty or generic filler pages.

## Type-Specific Page Contracts

### Source page
Include:
- source identity and evidence rank
- reporting/publication period
- page/section map
- key evidence themes
- extraction and evidence limitations
- links to major company, claim, analysis, and synthesis pages

### Claim page
Frontmatter must also include:
- `status: supported | refuted | unverified`
- `confidence: high | medium | low`
- `evidence_type: direct | calculated | inferred | hypothesis | unknown`
- `source_pages: "page, range, note, section, or locator unavailable"`

Body must contain:
- `## Claim`
- `## Evidence`
- `## Interpretation`
- `## So what?`

For calculated claims, show the formula and disclosed inputs. For self-reported market positions, say explicitly that the statement is self-reported.

### Company page
Include:
- `## Decision-relevant conclusion`
- `## Business profile`
- `## Relationships and position`
- `## Headquarters`
- `## Facilities`
- `## Management`
- `## Strategy`
- `## Acquisitions`
- `## Financial Performance`
- `## Customer relationships`
- `## Risk exposure`
- `## Operational footprint`
- `## Selected evidence`
- `## So what?`

### Product or technology page
Include:
- customer problem/function
- architecture or operating principle when disclosed
- applications
- owning company
- differentiation and evidence limitations
- implications for content, qualification, switching, or growth

### Analysis / comparison / synthesis page
Include:
- `## Conclusion`
- `## Mechanism`
- `## Evidence` linking to claim pages
- `## Uncertainty`
- `## Strategic implication`

Do not make unsupported factual assertions inline. Convert material facts into claim pages and link them.

### Query page
Include:
- exact unresolved question
- why it matters
- evidence currently available
- evidence needed to resolve it
- likely source types

## Frontmatter

Every non-log page starts on the first line with valid YAML:

---
type: <schema type>
title: "Human-readable title"
tags: [tag-one, tag-two]
related: [directory/slug, directory/other-slug]
sources: ["{{sourceFileName}}"]
created: {{today}}
updated: {{today}}
---

Use bare wiki targets without `wiki/`, `.md`, or `[[...]]` inside `related`. Use `[[directory/slug]]` links in the body.
Add type-specific fields required by the schema.

## Writing Standard

- Lead with the decision-relevant conclusion.
- Use concise technical-commercial language.
- Explain mechanisms, not promotional narratives.
- Quantify where supported.
- Label uncertainty instead of hiding it.
- Include a meaningful `So what?` where appropriate.
- Keep atomic claims concise enough to maximize coverage.

## Exact Output Format

Your first characters must be `---FILE:`.

---FILE: wiki/path/to/page.md---
<complete file content>
---END FILE---

Use blank lines only between FILE blocks. No markdown fences, preamble, commentary, or trailing text.

{{#if purpose}}
## Wiki Purpose
{{purpose}}
{{/if}}
{{#if index}}
## Existing Wiki Index
Use only for naming, deduplication, and create/update decisions. Do not reproduce or update it.
{{index}}
{{/if}}
{{#if overview}}
## Existing Overview
Use only as background. Do not reproduce or update it.
{{overview}}
{{/if}}
