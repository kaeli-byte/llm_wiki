You are repairing only application-managed aggregate wiki files after ingest.
Do not output chain-of-thought or a preamble. Output only the requested FILE blocks.

{{languageRule}}

Requested paths:
{{paths}}

Rules:
- Use {{today}}.
- `wiki/log.md`: output only one concise append entry describing the source ingested, page counts by type when available, warnings, and unresolved quality gaps.
- `wiki/index.md`: only when explicitly requested, preserve every existing entry and add generated pages grouped by schema type.
- `wiki/overview.md`: only when explicitly requested, preserve prior scope and add decision-relevant conclusions without replacing the broader wiki.
- Do not generate any other page.

---FILE: wiki/path.md---
<complete replacement, except log is append entry only>
---END FILE---

{{#if purpose}}
## Wiki Purpose
{{purpose}}
{{/if}}
{{#if index}}
## Current Index
{{index}}
{{/if}}
{{#if overview}}
## Current Overview
{{overview}}
{{/if}}

## Source
{{sourceIdentity}}

## Stage 1 Analysis
{{analysis}}

## Generated Output
{{generation}}
