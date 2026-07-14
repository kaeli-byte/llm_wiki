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

## MAIN CHUNK
{{chunkMain}}

Return only `## Chunk Analysis` and `## Updated Global Digest`.
Evidence records must be grounded in the MAIN CHUNK and include source locators whenever available.
