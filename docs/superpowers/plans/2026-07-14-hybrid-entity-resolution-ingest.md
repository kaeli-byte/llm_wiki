# Hybrid Entity Resolution Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the atomic evidence ledger into a validated 18–25-page durable wiki portfolio, then synthesize every page reliably and prove completion with the Aeroflex real-condition trial.

**Architecture:** Deterministic normalization compacts ledger subjects and themes before one constrained LLM entity-resolution call. Local code validates evidence ownership and portfolio rules, then generates one page per request with concurrency three, retains valid staged pages, and commits/cache-saves only a complete validated portfolio.

**Tech Stack:** TypeScript, Vitest, React/Tauri filesystem commands, existing OpenAI-compatible `streamChat`, Markdown prompt templates, JSON structural validation.

## Global Constraints

- Evidence records remain atomic provenance units and do not directly become pages.
- The Aeroflex portfolio target is 18–25 useful pages; more than 25 is invalid.
- Every material evidence record has exactly one primary owner page.
- No standalone claim pages are created by default.
- Entity resolution uses one compact LLM call plus at most one focused repair call.
- Page synthesis uses one expected page per request with concurrency three.
- Valid staged pages survive targeted retries and interrupted-run resume.
- Commit, cache, and success status require every planned path and deterministic validation to pass.
- Every shell command is prefixed with `rtk` per `AGENTS.md`.

---

## File Structure

- Create `src/lib/entity-resolution-types.ts`: normalized candidates, resolver wire contract, and validated resolution types.
- Create `src/lib/entity-normalizer.ts`: deterministic aliases, candidate aggregation, compact descriptors, and ownership inputs.
- Create `src/lib/entity-resolver.ts`: JSON parsing, structural validation, repair diagnostics, and normalization to runtime types.
- Create `src/lib/prompts/builtin/entity-resolution.md`: compact resolver system prompt.
- Create `src/lib/prompts/builtin/entity-resolution-repair.md`: one-shot correction prompt.
- Create `src/lib/entity-normalizer.test.ts` and `src/lib/entity-resolver.test.ts`: focused unit contracts.
- Modify `src/lib/page-planner.ts`: replace evidence-to-claim grouping with resolution-to-portfolio planning.
- Modify `src/lib/ingest-quality-contracts.test.ts`: portfolio, ownership, and page-cap contracts.
- Modify `src/lib/ingest.ts`: run/resume normalization, resolver, plan, generation, validation, and checkpoint stages.
- Modify `src/lib/prompts/resolver.ts`: register the two resolver prompts.
- Modify `src/lib/generation-batcher.ts`: exact single-page fallback, retained staging state, and targeted retries.
- Modify `src/lib/generation-batcher.test.ts`: transport-marker and retained-page tests.
- Modify `src/lib/page-validator.ts`: primary evidence ownership and portfolio validation.
- Modify `src/lib/quality-review.ts`: restrict semantic review to analytical pages and deterministic failures.
- Modify `src/lib/pipeline-logger.ts`: accurate resolution, synthesis, retry, page, and completion metrics.
- Modify `src/lib/ingest-cache.ts`: cache only paths verified on disk after commit.
- Modify `src/lib/ingest-source-path-collision.test.ts`: end-to-end mocked hybrid path.
- Modify `HANDOVER.md`: record the final architecture and real-trial evidence after acceptance.

---

### Task 1: Define and normalize compact entity candidates

**Files:**
- Create: `src/lib/entity-resolution-types.ts`
- Create: `src/lib/entity-normalizer.ts`
- Create: `src/lib/entity-normalizer.test.ts`

**Interfaces:**
- Consumes: `ConsolidatedEvidenceLedger` from `src/lib/ingest-quality-types.ts`.
- Produces: `normalizeEntityCandidates(ledger): NormalizedEntityInput`.
- Produces: stable `candidateId`, aliases, evidence IDs, relation summaries, and open-question groups.

- [ ] **Step 1: Write failing normalization tests**

```ts
it("merges legal-suffix and punctuation aliases without losing evidence", () => {
  const result = normalizeEntityCandidates(ledgerWithSubjects([
    ["AeroFlex Mobility Systems, Inc.", "C1-E001"],
    ["Aeroflex Mobility Systems", "C1-E002"],
  ]))
  expect(result.entities).toHaveLength(1)
  expect(result.entities[0].evidenceIds).toEqual(["C1-E001", "C1-E002"])
})

it("keeps named products, explicit segments, strategic themes, and questions distinct", () => {
  const result = normalizeEntityCandidates(aeroflexNormalizationFixture())
  expect(result.entities.map((item) => item.kindHint)).toEqual(
    expect.arrayContaining(["company", "segment", "product", "strategic_topic"]),
  )
  expect(result.questionGroups).toHaveLength(1)
})
```

- [ ] **Step 2: Run tests and verify the missing-module failure**

Run: `rtk npx vitest run src/lib/entity-normalizer.test.ts`

Expected: FAIL because `entity-normalizer.ts` does not exist.

- [ ] **Step 3: Add exact runtime types**

```ts
export type ResolvedPageKind =
  | "source" | "company" | "segment" | "counterparty" | "product"
  | "strategic_topic" | "financial_performance" | "risk"
  | "acquisition" | "unresolved_questions"

export interface NormalizedCandidate {
  candidateId: string
  canonicalLabel: string
  aliases: string[]
  kindHint: Exclude<ResolvedPageKind, "source" | "financial_performance" | "risk" | "acquisition" | "unresolved_questions"> | "unknown"
  evidenceIds: string[]
  relationSummary: string[]
}

export interface NormalizedEntityInput {
  sourceIdentity: string
  evidenceIds: string[]
  entities: NormalizedCandidate[]
  financialEvidenceIds: string[]
  riskEvidenceIds: string[]
  acquisitionEvidenceIds: string[]
  strategicThemes: NormalizedCandidate[]
  questionGroups: Array<{ candidateId: string; questions: string[]; evidenceIds: string[] }>
}
```

- [ ] **Step 4: Implement deterministic normalization**

Implement `canonicalSubjectKey()` using Unicode normalization, punctuation collapse, case folding, and removal of terminal legal suffixes only. Aggregate records and relations by canonical key. Classify explicit segment/product/theme hints from subject text, relations, and evidence descriptors without using legacy `candidateTypes` as authoritative page creation.

- [ ] **Step 5: Run focused tests**

Run: `rtk npx vitest run src/lib/entity-normalizer.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the normalization boundary**

```bash
rtk git add src/lib/entity-resolution-types.ts src/lib/entity-normalizer.ts src/lib/entity-normalizer.test.ts
rtk git commit -m "feat: normalize evidence entity candidates"
```

---

### Task 2: Parse and validate compact hybrid resolution

**Files:**
- Create: `src/lib/entity-resolver.ts`
- Create: `src/lib/entity-resolver.test.ts`
- Create: `src/lib/prompts/builtin/entity-resolution.md`
- Create: `src/lib/prompts/builtin/entity-resolution-repair.md`
- Modify: `src/lib/prompts/resolver.ts`

**Interfaces:**
- Consumes: `NormalizedEntityInput`.
- Produces: `parseEntityResolution(text, input): EntityResolution`.
- Produces: `validateEntityResolution(resolution, input): ResolutionValidationResult`.

- [ ] **Step 1: Write failing resolver-contract tests**

```ts
it("accepts compact snake_case resolution and preserves primary ownership", () => {
  const resolution = parseEntityResolution(JSON.stringify(validWireResolution()), normalizedInput)
  expect(resolution.pages).toHaveLength(20)
  expect(new Set(resolution.pages.flatMap((page) => page.primaryEvidenceIds))).toEqual(
    new Set(normalizedInput.evidenceIds),
  )
})

it("rejects duplicate ownership, unknown evidence, claim pages, and more than 25 pages", () => {
  const result = validateEntityResolution(invalidResolution(), normalizedInput)
  expect(result.errors).toEqual(expect.arrayContaining([
    expect.stringContaining("primary owner"),
    expect.stringContaining("unknown evidence"),
    expect.stringContaining("unsupported kind"),
    expect.stringContaining("maximum 25"),
  ]))
})
```

- [ ] **Step 2: Verify tests fail**

Run: `rtk npx vitest run src/lib/entity-resolver.test.ts`

Expected: FAIL because resolver exports are missing.

- [ ] **Step 3: Implement structural parsing and validation**

Define `EntityResolution` with `pages`, `aliases`, `mergeDecisions`, and `lowerBoundJustification`. Parse the first complete JSON object, normalize snake_case fields, and validate:

```ts
const allowedKinds = new Set<ResolvedPageKind>([
  "source", "company", "segment", "counterparty", "product",
  "strategic_topic", "financial_performance", "risk", "acquisition",
  "unresolved_questions",
])
```

Require 18–25 pages unless a non-empty lower-bound justification explains unsupported categories. Require exactly one source and one primary company. Require each known evidence ID exactly once across `primaryEvidenceIds`; allow repetition only in `secondaryEvidenceIds`.

- [ ] **Step 4: Add compact prompts and resolver registration**

The system prompt must request JSON only, prohibit page prose and claim pages, list exact allowed kinds, require merge decisions, and state the 18–25 target. The repair prompt receives the invalid JSON, compact candidate input, and exact validation errors.

- [ ] **Step 5: Run resolver and prompt tests**

Run: `rtk npx vitest run src/lib/entity-resolver.test.ts src/lib/prompts/resolver.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit compact resolution**

```bash
rtk git add src/lib/entity-resolver.ts src/lib/entity-resolver.test.ts src/lib/prompts/builtin/entity-resolution.md src/lib/prompts/builtin/entity-resolution-repair.md src/lib/prompts/resolver.ts
rtk git commit -m "feat: validate compact entity resolution"
```

---

### Task 3: Convert resolution into a durable page portfolio

**Files:**
- Modify: `src/lib/page-planner.ts`
- Modify: `src/lib/ingest-quality-types.ts`
- Modify: `src/lib/ingest-quality-contracts.test.ts`

**Interfaces:**
- Consumes: `buildResolvedPagePlan({ ledger, resolution, sourceSummaryPath }): WikiPagePlan`.
- Produces: 18–25 `PlannedPage` records with one page per generation batch and exact evidence ownership.

- [ ] **Step 1: Replace the claim-explosion test with portfolio tests**

```ts
it("builds durable Aeroflex pages without standalone claim pages", () => {
  const plan = buildResolvedPagePlan({ ledger, resolution, sourceSummaryPath })
  expect(plan.pages.length).toBeGreaterThanOrEqual(18)
  expect(plan.pages.length).toBeLessThanOrEqual(25)
  expect(plan.pages.some((page) => page.type === "claim")).toBe(false)
  expect(plan.pages.filter((page) => page.type === "source")).toHaveLength(1)
  expect(plan.pages.filter((page) => page.type === "company" && page.priority === "critical")).toHaveLength(1)
  expect(plan.batches.every((batch) => batch.pagePaths.length === 1)).toBe(true)
})
```

- [ ] **Step 2: Verify the old planner fails the new contract**

Run: `rtk npx vitest run src/lib/ingest-quality-contracts.test.ts`

Expected: FAIL because the current planner creates grouped claim pages and ignores resolution.

- [ ] **Step 3: Implement resolution-owned planning**

Map resolver kinds to project directories, assign deterministic collision-safe slugs, populate `primaryEvidenceIds` and `secondaryEvidenceIds`, construct related paths from aliases/relations, and set required sections per kind. Remove `buildDeterministicPagePlan` evidence chunking into claims.

- [ ] **Step 4: Add deterministic portfolio checks**

Extend `checkPlanCoverage()` to verify one primary owner per record, no claim pages, exact source/company cardinality, page-count bounds, and supported routing. Preserve the justified-below-18 exception; never permit above 25.

- [ ] **Step 5: Run planner tests**

Run: `rtk npx vitest run src/lib/ingest-quality-contracts.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit portfolio planning**

```bash
rtk git add src/lib/page-planner.ts src/lib/ingest-quality-types.ts src/lib/ingest-quality-contracts.test.ts
rtk git commit -m "feat: plan durable evidence-owned pages"
```

---

### Task 4: Integrate resolver repair and resumable artifacts

**Files:**
- Modify: `src/lib/ingest.ts`
- Modify: `src/lib/run-artifacts.ts`
- Modify: `src/lib/ingest-source-path-collision.test.ts`

**Interfaces:**
- Consumes: completed evidence checkpoint and `NormalizedEntityInput`.
- Produces: saved `entity-resolution.json`, `page-plan.json`, and checkpoint stage metadata.

- [ ] **Step 1: Write failing integration tests**

Add a mocked long-source test asserting call order: evidence extraction, compact entity resolution, page synthesis, targeted semantic review. Assert no `page-plan` prompt call occurs. Add a malformed-resolution case asserting exactly one repair call and no synthesis before a valid resolution exists.

- [ ] **Step 2: Verify integration tests fail**

Run: `rtk npx vitest run src/lib/ingest-source-path-collision.test.ts`

Expected: FAIL because ingest currently calls the provisional deterministic claim planner.

- [ ] **Step 3: Add resolver execution to long-source ingest**

After evidence consolidation, call `normalizeEntityCandidates()`, resolve `entity-resolution`, stream with reasoning off and a bounded 12,288-token output, validate, and issue at most one `entity-resolution-repair` call. Pass the validated resolution to `buildResolvedPagePlan()`.

- [ ] **Step 4: Persist and resume resolver artifacts**

Extend the checkpoint with optional `normalizedInput`, `entityResolution`, and `pagePlan`. Save each only after validation. On compatible restart, skip completed stages. Preserve the existing four Aeroflex evidence analyses.

- [ ] **Step 5: Run ingest integration tests**

Run: `rtk npx vitest run src/lib/ingest-source-path-collision.test.ts src/lib/ingest.prompt.test.ts`

Expected: PASS with zero LLM page-planning calls.

- [ ] **Step 6: Commit hybrid ingest integration**

```bash
rtk git add src/lib/ingest.ts src/lib/run-artifacts.ts src/lib/ingest-source-path-collision.test.ts
rtk git commit -m "feat: integrate resumable entity resolution"
```

---

### Task 5: Make single-page synthesis exact and resumable

**Files:**
- Modify: `src/lib/generation-batcher.ts`
- Modify: `src/lib/generation-batcher.test.ts`

**Interfaces:**
- Consumes: one-path batches and existing staged-path state.
- Produces: complete validated staged files with concurrency three and path-local retry.

- [ ] **Step 1: Write failing transport and resume tests**

```ts
it("accepts an exact expected single page missing only its closing marker", async () => {
  const result = await generateWikiPagesInBatches(singlePageContext(unclosedExactResponse))
  expect(result.success).toBe(true)
})

it("does not regenerate valid staged pages during targeted retry", async () => {
  const result = await generateWikiPagesInBatches(contextWithRetainedPages(["wiki/products/flexwing.md"]))
  expect(requestedPaths()).not.toContain("wiki/products/flexwing.md")
  expect(result.totalGeneratedPages).toBe(result.totalPlannedPages)
})
```

- [ ] **Step 2: Verify tests fail**

Run: `rtk npx vitest run src/lib/generation-batcher.test.ts`

Expected: FAIL because unclosed exact pages are discarded and staging is recreated as an empty run.

- [ ] **Step 3: Implement safe exact-path fallback**

Add `extractExpectedSinglePageAtEof(raw, expectedPath)`. Accept only one exact safe opener, reject any competing opener/path, remove an optional closer, require a non-empty body and structural frontmatter, then pass it through normal validation.

- [ ] **Step 4: Retain and inventory staged pages**

Load existing staged files that match planned paths, validate them, and exclude valid paths from new calls. Generate pending paths in groups of three. Retry only invalid paths once with doubled output allowance. Do not let a recovered path leave its earlier batch status permanently invalid.

- [ ] **Step 5: Run batcher tests**

Run: `rtk npx vitest run src/lib/generation-batcher.test.ts`

Expected: PASS, including peak concurrency three and no whole-plan retry.

- [ ] **Step 6: Commit reliable synthesis**

```bash
rtk git add src/lib/generation-batcher.ts src/lib/generation-batcher.test.ts
rtk git commit -m "fix: retain and retry single-page synthesis"
```

---

### Task 6: Enforce ownership, targeted QA, truthful cache, and manifests

**Files:**
- Modify: `src/lib/page-validator.ts`
- Modify: `src/lib/quality-review.ts`
- Modify: `src/lib/quality-review.test.ts`
- Modify: `src/lib/ingest-cache.ts`
- Modify: `src/lib/pipeline-logger.ts`
- Modify: `src/lib/pipeline-logger.test.ts`
- Modify: `src/lib/ingest-source-path-collision.test.ts`

**Interfaces:**
- Consumes: resolution, plan, staged page map, and ledger.
- Produces: deterministic completion report and cache/manifest records derived from verified disk paths.

- [ ] **Step 1: Write failing completion tests**

Assert duplicate primary ownership fails; unsupported citations fail; semantic QA receives only strategic/synthesis pages plus deterministic failures; cache refuses a missing disk path; manifest reports actual resolver, repair, synthesis, retry, and page counts.

- [ ] **Step 2: Verify tests fail**

Run: `rtk npx vitest run src/lib/quality-review.test.ts src/lib/pipeline-logger.test.ts src/lib/ingest-source-path-collision.test.ts`

Expected: FAIL on ownership, QA scope, or inaccurate completion metrics.

- [ ] **Step 3: Implement deterministic ownership/link/citation validation**

Validate every primary evidence ID once, secondary IDs against the ledger, source locators on cited evidence sections, required page relationships, and internal links against planned plus existing pages.

- [ ] **Step 4: Restrict semantic QA**

Build the semantic review manifest from `strategic_topic`, `financial_performance`, `risk`, and `acquisition` pages plus deterministic failures. Repair only returned paths and rerun deterministic checks before the focused semantic re-review.

- [ ] **Step 5: Make cache and manifest disk-authoritative**

Before cache save, verify each committed path exists. Record the exact verified set. Finalize the manifest after commit with actual call entries, retries, generated count, verified written count, ownership metrics, quality status, and errors.

- [ ] **Step 6: Run focused completion tests**

Run: `rtk npx vitest run src/lib/quality-review.test.ts src/lib/pipeline-logger.test.ts src/lib/ingest-source-path-collision.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit truthful completion gates**

```bash
rtk git add src/lib/page-validator.ts src/lib/quality-review.ts src/lib/quality-review.test.ts src/lib/ingest-cache.ts src/lib/pipeline-logger.ts src/lib/pipeline-logger.test.ts src/lib/ingest-source-path-collision.test.ts
rtk git commit -m "fix: gate ingest completion on verified portfolio"
```

---

### Task 7: Regression suite, desktop build, and Aeroflex acceptance trial

**Files:**
- Modify after verified results: `HANDOVER.md`

**Interfaces:**
- Consumes: `/Users/hafid/Documents/Industry-v2/.llm-wiki/ingest-progress/17-financial-reports--36-aeroflexmobility2025mockannualreport--wb60cn-de27de3ee762d5fd.json`.
- Produces: real filesystem, cache, queue, manifest, and evidence-ownership proof.

- [x] **Step 1: Run the complete sandbox-safe test suite**

Run: `rtk npm run test:mocks`

Expected: all test files and tests pass.

- [x] **Step 2: Typecheck and build the desktop bundle**

Run: `rtk npm run typecheck`

Expected: exit 0.

Run: `rtk npm run tauri -- build --debug --bundles app`

Expected: debug application bundle created successfully.

- [x] **Step 3: Launch the exact debug bundle and retry Aeroflex**

Launch `/Users/hafid/Documents/llm_wiki/src-tauri/target/debug/bundle/macos/LLM Wiki.app`, retry the pending Aeroflex task, and confirm the log contains entity resolution followed by concurrent single-page synthesis without a page-planning call.

- [x] **Step 4: Verify the committed portfolio on disk**

Inspect the generated paths and assert:

```text
18 <= committed wiki paths <= 25
source pages == 1
primary company pages == 1
claim pages == 0
missing planned paths == 0
unknown evidence IDs == 0
duplicate primary owners == 0
```

- [x] **Step 5: Verify cache, queue, checkpoint, and manifest**

Confirm queue status is completed, cache paths all exist, the manifest call/page counts match the log and filesystem, quality passed, and the evidence checkpoint is cleared only after successful commit/cache.

- [x] **Step 6: Update the handover with measured evidence**

Record final page counts by type, wall time, resolver/synthesis call counts, ownership coverage, cache/manifest verification, and the obsolete architecture that was replaced.

- [x] **Step 7: Run final diff and verification checks**

Run: `rtk git diff --check`

Expected: no whitespace errors.

Run: `rtk git status --short`

Expected: only intentional implementation and handover changes.

- [x] **Step 8: Commit verified acceptance evidence**

```bash
rtk git add HANDOVER.md
rtk git commit -m "docs: record verified Aeroflex ingest acceptance"
```

---

## Completion Audit

Do not declare success from tests or UI status alone. Completion requires all of the following authoritative evidence from the same Aeroflex run:

- validated resolution and page-plan artifacts;
- 18–25 committed files with no default claim pages;
- all 117 evidence IDs assigned exactly one primary owner;
- every planned path present on disk;
- cache file list equal to the verified committed set;
- queue completion without hidden retry failure;
- manifest metrics equal to the pipeline log and filesystem;
- no page-planning LLM call;
- no whole-portfolio regeneration after an individual page failure.
