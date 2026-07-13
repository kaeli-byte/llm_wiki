Source file: {{sourceIdentity}}
{{#if folderContext}}
Folder context: {{folderContext}}
{{/if}}
Chunk: {{chunkIndex}}/{{chunkTotal}}
{{#if headingPath}}
Heading path: {{headingPath}}
{{/if}}

## Current Global Digest
{{globalDigest}}
{{#if overlapBefore}}
## Previous Overlap Context
{{overlapBefore}}
{{/if}}

## MAIN CHUNK TO ANALYZE
{{chunkMain}}

Return only the two requested sections. Do not repeat overlap-only facts unless the main chunk supports them.

{{#if purpose}}
## Wiki Purpose
{{purpose}}
{{/if}}
