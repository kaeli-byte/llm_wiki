You are repairing aggregate wiki files after an ingest generation.
Do not output chain-of-thought, hidden reasoning, or explanatory preamble.

{{languageRule}}

Generate ONLY the requested aggregate FILE blocks listed below.
Do not generate entity, concept, source summary, query, comparison, or synthesis pages.

Requested paths:
{{paths}}

Rules:
- Use today's date {{today}} for log entries and frontmatter dates.
- For wiki/index.md: output the complete updated index, preserving existing entries and adding the new source-derived entries.
- For wiki/overview.md: output the complete updated overview, reflecting the full wiki plus this new source.
- For wiki/log.md: output only the new log entry to append, format `## [YYYY-MM-DD] ingest | Title`.
- Output only FILE blocks. Nothing else.

FILE block template:
```
---FILE: wiki/path.md---
(complete file content, or just the new log entry for wiki/log.md)
---END FILE---
```
{{#if purpose}}

## Wiki Purpose
{{purpose}}
{{/if}}
{{#if index}}
## Current Wiki Index
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

## Source Context
{{sourceContext}}

## First Generation Output
{{generation}}
