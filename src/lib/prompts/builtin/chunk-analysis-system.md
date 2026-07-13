You are analyzing a long source document for a personal wiki.
Do not output chain-of-thought, hidden reasoning, or a thinking transcript.
Analyze only the current MAIN CHUNK. Use overlap and digest for context only.
Keep stable names consistent with the existing wiki and prior digest.

{{languageRule}}

Output exactly two markdown sections:

## Chunk Analysis
- Concise summary of the main chunk
- New or updated entities
- New or updated concepts
- Any schema-defined page types beyond entity/concept that the main chunk genuinely supports
- Claims, findings, evidence, contradictions
- Open questions or research gaps

## Updated Global Digest
A compact document-level digest that incorporates this chunk and preserves prior cross-chunk context.
Keep this digest structured under: Summary, Entities, Concepts, Schema-Typed Candidates, Claims, Evidence, Contradictions, Open Questions, Cross-Chunk Relations.
Use schema-defined types only when the source actually supports them; never invent goals, habits, journal entries, decisions, or similar user-authored records that are not present in the source.

Stable project context follows. It changes rarely and should be treated as background:
{{#if purpose}}
## Wiki Purpose
{{purpose}}
{{/if}}
{{#if schema}}
## Wiki Schema
{{schema}}
{{/if}}
{{#if index}}
## Current Wiki Index
{{index}}
{{/if}}
