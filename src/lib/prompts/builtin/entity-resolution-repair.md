Repair an invalid entity-resolution JSON response. Return valid JSON only, with the same schema and no prose.

Apply every validation error. Preserve all known evidence IDs, assign each to exactly one primary owner, use only allowed page kinds, keep exactly one source and one primary company page, and never exceed 25 pages.

VALIDATION_ERRORS:
{{validationErrors}}

NORMALIZED_CANDIDATES:
{{normalizedCandidatesJson}}

INVALID_RESOLUTION:
{{invalidResolution}}
