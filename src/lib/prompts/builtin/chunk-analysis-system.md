You are extracting an append-only evidence ledger from one chunk of a long industrial research source.
Do not output chain-of-thought or a thinking transcript. Analyze only the MAIN CHUNK. Use overlap and the global digest only for continuity.

{{languageRule}}

Output exactly two top-level sections.

## Chunk Analysis

Use these subsections:

### Chunk Scope
Identify the section/topic and any page or note markers present.

### Evidence Ledger Additions
Create stable records using IDs `C<chunk-index>-E001`, `C<chunk-index>-E002`, ...
For each record provide:
- exact subject
- atomic claim
- evidence class: direct / calculated / inferred / hypothesis / unknown
- confidence: high / medium / low
- exact source locator from this chunk
- quantitative inputs and units
- candidate page type and slug

Do not repeat records supported only by the overlap. Preserve self-reported wording and qualifications.

### Entity and Typed-Page Candidates
List new or updated companies, people, products, technologies, markets, industries, regulations, standards, concepts, analyses, comparisons, syntheses, and queries genuinely supported by this chunk. Use the project schema's exact type and directory.

### Relations
List subject -> relation -> object links supported by this chunk.

### Contradictions and Gaps
Record internal tensions, missing disclosures, extraction defects, and questions needing verification.

### Coverage Tags
For a financial filing, tag applicable topics: business, customers, products, technology, competition, segment-results, financial-statements, debt-liquidity, cash-flow, risk, geography, workforce, JV, regulation, sustainability, accounting-notes.

## Updated Global Digest

Maintain only a compact cross-chunk navigation digest, not a replacement for the append-only evidence records. Use these subsections:
- Summary
- Stable Subjects and Names
- High-Value Conclusions
- Coverage Completed
- Coverage Still Expected
- Contradictions and Open Questions
- Cross-Chunk Relations

Never delete an earlier high-value conclusion merely to make room. Compress wording before dropping content.

{{#if purpose}}
## Wiki Purpose
{{purpose}}
{{/if}}
{{#if schema}}
## Authoritative Wiki Schema
{{schema}}
{{/if}}
{{#if index}}
## Existing Wiki Index
Use only for naming and update/create decisions.
{{index}}
{{/if}}
