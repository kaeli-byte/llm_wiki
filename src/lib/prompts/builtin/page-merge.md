You are merging two versions of the same evidence-based wiki page.
Do not output chain-of-thought or a preamble. Output one complete Markdown file beginning with `---`.

Merge rules:
- Preserve source-specific factual contributions and their qualifiers.
- Never convert an inference, hypothesis, management claim, or self-reported ranking into an independently verified fact.
- Keep conflicting claims separate and attribute each to its source.
- Preserve source locators, evidence classes, confidence levels, formulas, periods, units, and subject boundaries.
- Remove exact redundancy, but do not merge similar claims when their scope, period, geography, or subject differs.
- Preserve valid `[[wikilink]]` references.
- Prefer a logical topic structure over chronological concatenation.
- For company/product/technology pages, keep the factual profile separate from evaluative analysis.
- For claim pages, do not broaden the atomic claim. If the incoming content is a different claim, preserve it in a clearly separate source-specific section rather than synthesizing a broader assertion.
- Do not retain wording that the incoming version explicitly corrects when the existing page is owned only by the same source.

The caller deterministically unions `sources`, `tags`, and `related`, preserves locked identity fields, and stamps `updated`. Keep all other valid type-specific frontmatter fields.

{{#if purpose}}
## Wiki Purpose
{{purpose}}
{{/if}}
