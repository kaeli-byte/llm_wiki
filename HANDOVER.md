# HANDOVER — Ingest Pipeline Quality Investigation

## 2026-07-14 Hybrid Resolver Roadmap (Current Authority)

The original Release B/C approach below has been superseded by an approved hybrid entity-resolution architecture. Atomic evidence records remain provenance units; they no longer become pages directly.

Authoritative documents:

- Approved design: `docs/superpowers/specs/2026-07-14-hybrid-entity-resolution-ingest-design.md`
- Complete implementation roadmap: `docs/superpowers/plans/2026-07-14-hybrid-entity-resolution-ingest.md`

The roadmap records every test-first step, exact file boundary, command, expected result, commit boundary, and real-condition acceptance check. Its seven tasks are:

1. Define and normalize compact entity candidates.
2. Parse and validate the compact hybrid resolution.
3. Convert the resolution into an 18–25-page durable portfolio.
4. Integrate resolver repair and resumable artifacts into ingest.
5. Make concurrent single-page synthesis exact and resumable.
6. Enforce ownership, targeted QA, truthful cache, and truthful manifests.
7. Run the regression suite, desktop build, and Aeroflex acceptance trial.

Approved output architecture:

```text
PDF → chunk evidence extraction → consolidated evidence ledger
    → deterministic entity normalization → compact LLM entity resolution
    → deterministic 18–25-page plan → concurrent single-page synthesis
    → cross-link/citation/ownership validation → transactional commit/cache
```

Verified real-trial result (2026-07-14):

- Project: `/Users/hafid/Documents/Industry-v2`
- Source: `raw/sources/financial-reports/aeroflex_mobility_2025_mock_annual_report.pdf`
- Final run: `.llm-wiki/runs/financial-reports_aeroflex_mobility_2025-2026-07-14T07-33-14-228Z/`
- Result: 19 durable planned pages: 1 source, 6 company (1 primary company plus subsidiaries/counterparties), 5 product, 4 analysis, 2 segment/entity, and 1 unresolved-question page.
- Evidence: 184 consolidated evidence IDs; 184 primary owners; zero missing, duplicate, or unknown primary IDs.
- Filesystem: all 19 planned paths exist. The manifest verifies 21 written paths including `wiki/index.md` and `wiki/log.md`; none are absent.
- Quality/cache/queue: semantic quality passed, cache paths match disk, the ingest checkpoint was cleared after cache save, and `ingest-queue.json` is empty.
- Calls: the final checkpoint resume needed one 3.97-second QA call (85 output tokens), no new resolver call, no page-planning call, and no whole-portfolio regeneration. The originating synthesis run used one resolver call and 14 single-page synthesis calls, including two page-local recoveries, with concurrency of three.
- Timing: final resume started at `07:33:14Z`, cached by approximately `07:33:24Z`, and finalized at `07:40:43Z` (7m29s total). Roughly 7m19s was sequential post-cache embedding/indexing, now the dominant remaining speed bottleneck.
- Verification: `npm run test:mocks` passes 120 files / 1675 tests; typecheck passes; the debug `.app` bundle was rebuilt successfully.

Acceptance evidence achieved:

- [x] 18–25 committed wiki pages and no default standalone claim pages.
- [x] One source page and one primary company page, plus supported subsidiary/counterparty pages.
- [x] Supported segment, product/program, strategic-topic, financial, risk, acquisition, counterparty, and unresolved-question pages.
- [x] All 184 evidence IDs have exactly one primary owner.
- [x] Zero missing planned paths and zero unknown evidence IDs.
- [x] Cache paths equal verified files on disk.
- [x] Queue completed, quality passed, and manifest counts match the pipeline log and filesystem.
- [x] No large LLM page-planning call and no whole-portfolio regeneration after a page-local failure.

Future optimization / resume instructions:

1. Preserve the verified hybrid architecture and deterministic ownership checks.
2. Optimize the sequential embedding loop after cache save; use bounded concurrency or move indexing out of the queue-critical completion path, with tests for partial embedding failures.
3. Keep cache and manifest disk-authoritative and never mark a partial generation as successful.
4. Re-run the Task 7 audit after any ingestion or embedding change.

**Date:** 2026-07-14
**Status:** Hybrid ingest fix verified; sequential post-ingest embedding remains a performance follow-up

---

## The Problem

When ingesting a financial document (e.g., Aeroflex Mobility 10-K mock, 32KB / 10 pages), **only 1 page is generated: the source summary page.** No claims, companies, concepts, products, analyses, or queries are created — despite the source page containing a detailed "Generation Queue" listing 47 pages it wants to produce.

### Observable symptoms

1. **Single page output** — Only `wiki/sources/<source-slug>.md` appears. The wiki/claims/, wiki/companies/, wiki/concepts/ directories remain empty.

2. **The source page is excellent** — 17KB of high-quality markdown with 118 evidence records, 10 decision-relevant conclusions, 3 full analyses, a knowledge map with wikilinks, and a prioritized "Generation Queue" of 47 pages. The LLM clearly understands the document and wants to create more pages.

3. **No errors surfaced** — The ingest completes "successfully" with a green checkmark. The activity panel shows "Step 2/2: Generating wiki pages..." then completes.

4. **Cache lies** — `ingest-cache.json` records the generated paths, but most don't exist on disk. The Cooper Standard entry listed 35 files with 33 missing from the filesystem.

5. **Manifest data is garbage** — `manifest.json` shows `totalLlmCalls: 0`, `totalOutputTokens: 0`, `totalPagesGenerated: 0` — despite the pipeline actually running.

6. **No real-time logs** — `console.log` from TypeScript goes to the webview DevTools console, not the terminal. There's no tail-able log file to follow during ingestion.

---

## Root Cause Chain

```
PDF (32KB, 10 pages)
  → extracted by pdfium → ~19K chars of text
  → budget check: 19K < sourceBudget → SINGLE-PASS PATH (no chunking)
  → analysis LLM call: produces detailed analysis text
  → generation LLM call: produces ONE brilliant source page → runs out of tokens
  → parseFileBlocks: finds 1 FILE block
  → cache: saves 1 file
  → every future run: cache hit → returns 1 file instantly
```

**The single-pass generation is fundamentally bottlenecked.** The new generation prompt (`generation.md` from the quality pack) instructs the model to produce an evidence-preserving wiki with ordered generation:
1. Source summary page (first)
2. Critical/high priority claim pages
3. Company/organization pages
4. Product/technology pages
5. Markets, industries, concepts
6. Analyses, comparisons, syntheses
7. Query pages

The model produces an EXCELLENT step 1 — a 17KB source page with evidence ledger, conclusions, and a generation queue — but exhausts all output tokens before reaching step 2. The 47 queued pages are listed but never generated.

---

## What We've Built (Releases A, B, C)

### Release A — Prompt resolution & correctness fixes
- ✅ `src/lib/prompts/resolver.ts` — Complete rewrite: auto-injects `today`, `languageRule`, `knownTypes`, reports source, rejects missing variables
- ✅ `src/lib/prompts/builtin/*.md` — 7 replacement prompts (analysis, generation, chunk-analysis-*, review-suggestion, aggregate-repair, page-merge)
- ✅ `src/lib/ingest.ts` — All `resolvePrompt` calls pass `{ projectPath }` and `today`
- ✅ Fixed schema/purpose path mismatch: `startIngest`/`executeIngestWrites` read from project root, not `wiki/`
- ✅ Generation `max_tokens` doubled
- ✅ Cache save blocked on truncation

### Release B — Evidence ledger & page planning
- ✅ `src/lib/ingest-quality-types.ts` — TypeScript interfaces for EvidenceRecord, WikiPagePlan, etc.
- ✅ `src/lib/evidence-ledger.ts` — JSON Schema validation, deterministic consolidation, dedup
- ✅ `src/lib/page-planner.ts` — Plan validation, batch constraint checking
- ✅ `src/lib/run-artifacts.ts` — Artifact persistence under `.llm-wiki/runs/<run-id>/`
- ✅ New prompts: evidence-extraction-system, evidence-extraction-user, page-plan, batch-generation, quality-review
- ⚠️ `analyzeLongSourceInChunks` in ingest.ts modified to use evidence-extraction prompts → **LOST when ingest.ts was restored from clean immediate version**

### Release C — Batch rendering & repair (current work)
- ✅ `src/lib/generation-batcher.ts` — Token-aware batch generation, staging, truncation continuation
- ✅ `src/lib/page-validator.ts` — Deterministic frontmatter/routing/wikilink validation
- ✅ `src/lib/quality-review.ts` — Model-based semantic QA, repair batch generation
- ⚠️ Batch generation wiring in ingest.ts → **LOST when ingest.ts was restored**

### Observability
- ✅ `src/lib/pipeline-logger.ts` — Structured stage/LLM tracking, artifact saving
- ⚠️ Integrated into ingest.ts → **LOST when ingest.ts was restored**
- `console.log` with `[pipeline]` prefix works → visible in DevTools Console (Cmd+Opt+I)

### Budget thresholds (applied to current ingest.ts)
- ✅ `LONG_SOURCE_MIN_BUDGET: 8,000 → 4,000`
- ✅ `LONG_SOURCE_CHUNK_MIN: 12,000 → 6,000`
- ✅ `LONG_SOURCE_CHUNK_MAX: 60,000 → 40,000`
- ✅ `LONG_SOURCE_MAX_SINGLE_PASS_BUDGET: 300,000 → 200,000`
- ✅ `LONG_SOURCE_DIGEST_MAX: 15,000 → 10,000`

### Cache fixes
- ✅ `src/lib/ingest-cache.ts` — Cleans up stale entries when cached files are missing from disk
- ✅ Both Cooper Standard and Aeroflex stale entries manually cleared

---

## Current State of ingest.ts

The file at `src/lib/ingest.ts` was restored from `llm-wiki-financial-ingest-quality-pack/immediate/src/ingest.ts` (the Release A version) after repeated Python patches corrupted it.

**What's in the current ingest.ts:**
- ✅ Budget thresholds lowered
- ✅ Schema/purpose path fixes
- ✅ Release A prompt resolution fixes
- ✅ Pipeline logger initialization (basic)
- ❌ Evidence extraction wiring (chunk analysis uses old free-text prompts, not JSON evidence extraction)
- ❌ Batch generation wiring (no `generateWikiPagesInBatches` call)
- ❌ Page plan generation step
- ❌ Quality review step
- ❌ Tracked LLM calls

**What needs to be restored in ingest.ts:**
1. In `analyzeLongSourceInChunks`: use evidence-extraction-system/user prompts instead of chunk-analysis-*
2. After chunk loop: consolidate evidence ledgers → generate page plan
3. In generation step: route to batched generation when pagePlan exists
4. After batch generation: run quality review + repair batches
5. Gate cache save on quality pass
6. Wire pipeline logger `createCall()` / `onComplete()` into streamChat invocations

---

## Hypotheses for Investigation

### H1: Budget threshold still too high (MOST LIKELY)
The 19K char Aeroflex PDF may still fall below the source budget even with MIN_BUDGET=4,000. The `computeIngestSourceBudget` function subtracts schema, purpose, index, overview lengths plus various reserves. With a 128K context model, the available budget might still be >19K chars.

**Test:** Add a `console.log` of `sourceBudget` and `sourceContent.length` right before the chunking check. If `sourceContent.length <= sourceBudget`, the document goes single-pass.

### H2: Evidence-extraction prompts not loaded
The prompt references were changed from "chunk-analysis-system" to "evidence-extraction-system" in a previous version of ingest.ts. If the clean ingest.ts still uses "chunk-analysis-system", the evidence extraction won't work even if chunking triggers.

**Test:** Check what `analyzeLongSourceInChunks` uses for `resolvePrompt` name. If it's "chunk-analysis-system", the evidence extraction isn't wired.

### H3: Single-pass generation prompt is too verbose
The new `generation.md` prompt produces excellent but extremely detailed source pages. A 17KB source page consumes ~4,000-5,000 output tokens. Even with 32K token budget, only ~8-10 detailed pages fit in one pass.

**Potential fix:** Make the source page more concise in the prompt, or remove the evidence-ledger table from the source page (keep it in the analysis context instead).

### H4: Token budget still insufficient despite doubling
`INGEST_GENERATION_TOKENS_512K = 32,768` was doubled to `65,536` but for models with 128K context, the effective budget is `16,384 * 2 = 32,768`. The source page consumed approximately 17,000 chars ≈ ~4,250 tokens, leaving ~28,500 tokens. This should be enough for 30+ short claim pages, suggesting the issue is NOT token budget but prompt design.

### H5: Cache re-population race
After clearing the cache, if the user re-imports without fixing the underlying issue, the same 1-page result gets cached again. The cache clearing needs to be paired with a working pipeline.

### H6: Vite/OXC parser issue
The build error shows `[PARSE_ERROR]` from Vite's OXC parser. This suggests the TypeScript may have syntax that tsc accepts but Vite/OXC rejects. The app may not be picking up changes if the build fails at the Vite level but passes at the tsc level.

---

## Next Steps (Priority Order)

1. **Verify budget triggers chunking** — Add diagnostic logging showing `sourceContent.length` vs `sourceBudget` at the chunking check point.

2. **Wire evidence extraction prompts** — In `analyzeLongSourceInChunks`, change prompt names from "chunk-analysis-system/user" to "evidence-extraction-system/user".

3. **Wire batch generation** — Add the `generatePagePlan` → `generateWikiPagesInBatches` → `runQualityReview` flow after evidence consolidation.

4. **Test with lowered thresholds** — Force re-ingest Aeroflex and verify it goes through the evidence → plan → batch path.

5. **Add streaming log file** — Write a `.llm-wiki/pipeline.log` file that appends to in real-time (workaround: Tauri `writeFile` doesn't support append, so buffer and flush periodically or read + rewrite).

6. **Fix manifest data accuracy** — Ensure `totalLlmCalls`, `outputTokensActual`, and `totalPagesGenerated` reflect actual values by wiring `createCall()`/`onComplete()` into streamChat invocations.

---

# Release Definitions

## Release A — Make Current Behavior Honest

**Goal:** Fix prompt loading, missing variables, cache correctness, and token budgets so the existing two-stage pipeline (analysis → generation) produces honest results instead of silently rendering broken prompts.

### Files created

| File | Purpose |
|------|---------|
| `src/lib/prompts/resolver.ts` (rewritten) | Auto-injects `today`, `languageRule`, `knownTypes`. Reports prompt source (override/builtin/fallback). Rejects missing template variables. Maps `sourceSummaryPath` to `summaryPath`. |
| `src/lib/prompts/builtin-content.ts` (updated) | Bundles the new prompt templates |
| `src/lib/prompts/builtin/*.md` (7 files replaced) | `analysis.md`, `generation.md`, `chunk-analysis-system.md`, `chunk-analysis-user.md`, `review-suggestion.md`, `aggregate-repair.md`, `page-merge.md` — all replaced with evidence-preserving versions from the quality pack |

### Files modified

| File | Changes |
|------|---------|
| `src/lib/ingest.ts` | All `resolvePrompt` calls pass `{ projectPath }` and `today`. Analysis `max_tokens` raised from 4,096 to `computeIngestAnalysisMaxTokens()` (8,192–16,384). Generation `max_tokens` doubled. Cache save blocked when generation is truncated. Long-source `sourceContext` no longer duplicates chunk analysis notes. Page merger receives `projectPath`. **Bug fix:** `startIngest` and `executeIngestWritesImpl` read `schema.md`/`purpose.md` from project root, not `wiki/` subdirectory. |

### Key behaviors
- Prompt resolution is observable: logs show which source was selected
- Missing required template variables cause an error before LLM call
- Truncated generations are not cached as successful
- Schema/purpose are read from the correct location for ALL code paths

---

## Release B — Evidence Ledger and Page Plan

**Goal:** Replace free-text chunk analysis with structured JSON evidence extraction. Build deterministic consolidation and page planning so the pipeline knows WHAT to generate before generating anything.

### Files created

| File | Purpose |
|------|---------|
| `src/lib/ingest-quality-types.ts` | TypeScript interfaces: `EvidenceRecord`, `ConsolidatedEvidenceLedger`, `WikiPagePlan`, `PlannedPage`, `GenerationBatch`, `QualityReviewResult` |
| `src/lib/evidence-ledger.ts` | JSON Schema validation via `ajv`. Deterministic consolidation (dedup by subject+claim+class+period+geography+scope fingerprint). JSON block extraction from LLM responses. Serialization. |
| `src/lib/page-planner.ts` | JSON Schema validation for wiki page plans. Deterministic plan coverage checks (unassigned high-confidence evidence, duplicate paths, claim-without-evidence). Batch constraint validation. |
| `src/lib/run-artifacts.ts` | `RunContext` class that persists evidence ledgers, page plans, prompts, and manifests under `.llm-wiki/runs/<run-id>/` |
| `src/lib/prompts/builtin/evidence-extraction-system.md` | Structured JSON evidence ledger extraction prompt |
| `src/lib/prompts/builtin/evidence-extraction-user.md` | User prompt with chunk metadata, digest, overlap context, and schema |
| `src/lib/prompts/builtin/page-plan.md` | Plans wiki pages from consolidated evidence ledger |
| `src/lib/prompts/builtin/batch-generation.md` | Renders one approved batch from a validated plan (used by Release C) |
| `src/lib/prompts/builtin/quality-review.md` | Semantic QA against plan and evidence ledger (used by Release C) |

### Files modified

| File | Changes |
|------|---------|
| `src/lib/ingest.ts` | `analyzeLongSourceInChunks` uses evidence-extraction prompts instead of free-text chunk analysis. After chunk processing, evidence ledgers are consolidated via `consolidateEvidenceLedgers()` and persisted as run artifacts. The consolidated evidence ledger is formatted as markdown and passed as `analysis` context to the generation stage. |
| `package.json` | Added `ajv` dependency for JSON Schema validation |

### Key behaviors
- Long sources (> budget threshold) are chunked and each chunk produces a JSON evidence ledger
- Evidence records are deduplicated across chunks by fingerprint (subject + claim + class + period + geography + scope)
- Run artifacts are persisted for inspection and regression testing
- The evidence ledger is passed as context to the generation stage

---

## Release C — Batch Rendering and Repair

**Goal:** Replace single-pass generation with token-aware batched generation. Add semantic QA, repair loops, transactional wiki commit, and quality-gated cache saves. Eliminate the single-response ceiling.

### Files created

| File | Purpose |
|------|---------|
| `src/lib/generation-batcher.ts` | Token-aware batch generation. Estimates output tokens per batch from `maxWords`. Generates to staging directory. Commits to wiki transactionally. Handles truncation with one continuation attempt per batch. |
| `src/lib/page-validator.ts` | Deterministic validation: frontmatter correctness, type/routing match, wikilink resolution, evidence contract checks, required sections presence. |
| `src/lib/quality-review.ts` | Model-based semantic QA using `quality-review.md` prompt. Generates repair batches (capped at 2 rounds). Parses structured JSON results. |

### Files modified

| File | Changes |
|------|---------|
| `src/lib/ingest.ts` | Added page plan generation step after evidence consolidation. Step 2 (Generation) routes to `generateWikiPagesInBatches()` when `pagePlan` + `evidenceLedger` exist; otherwise falls back to single-pass generation. Added quality review call after batch generation with repair loops. Cache save gated on `qualityGateOk`. |
| `src/lib/pipeline-logger.ts` | Created for observability. Tracks stage transitions with timing, LLM calls with prompt info and output stats, saves resolved prompts and LLM call artifacts. Writes `manifest.json` per run. |

### Key behaviors
- **No more truncation:** Pages generated in bounded batches (6-12 per batch), eliminating the single-pass token ceiling
- **Staging + commit:** Files staged under `.llm-wiki/staging/` and committed atomically
- **Truncation recovery:** If a FILE block is unclosed, the batch is retried for remaining pages only
- **Semantic QA:** Model reviews all generated pages against the plan and evidence ledger
- **Repair loops:** Max 2 repair rounds for issues found by QA
- **Cache gating:** Results cached only when QA passes

---

## Evidence Extraction Pipeline (target architecture, Release B+C combined)

```
Long source (> source budget):
  PDF → pdfium text → semantic chunks
    → evidence-extraction-system/user prompts → JSON per chunk
    → validate against evidence-ledger.schema.json
    → consolidateEvidenceLedgers() — dedup, merge
    → resolvePrompt("page-plan") → WikiPagePlan JSON
    → validate against page-plan.schema.json
    → generateWikiPagesInBatches()
        → for each batch: resolvePrompt("batch-generation") → streamChat → parseFileBlocks
        → if truncated: continueTruncatedBatch() → retry remaining pages
        → writeStagedFile() → staging dir
    → validateGeneratedPages() per batch
    → runQualityReview() → repair batches (max 2 rounds)
    → commitStagedToWiki() → transactional wiki commit
    → saveIngestCache() only if qualityPassed

Short source (< source budget):
  PDF → pdfium text → analysis prompt → generation prompt → single-pass FILE blocks → write → cache
```

---

## What Was Lost When ingest.ts Was Restored

On 2026-07-14, the `src/lib/ingest.ts` file was restored from the quality pack's `immediate/src/ingest.ts` (Release A version) because repeated Python patching had corrupted it with syntax errors.

**Preserved (Release A):**
- Budget thresholds lowered
- Schema/purpose path fixes
- Prompt resolution fixes
- Token budget doubling
- Pipeline logger initialization

**Lost (Release B+C wiring):**
- Evidence-extraction prompt references in `analyzeLongSourceInChunks`
- Evidence consolidation + page plan generation after chunk loop
- Batch generation routing in Step 2
- Quality review + repair batch integration
- Cache quality gate
- Tracked LLM calls via `createCall()`/`onComplete()`

**Still exists (separate modules, just not wired into ingest.ts):**
- `src/lib/evidence-ledger.ts` — fully functional
- `src/lib/page-planner.ts` — fully functional
- `src/lib/generation-batcher.ts` — fully functional
- `src/lib/page-validator.ts` — fully functional
- `src/lib/quality-review.ts` — fully functional
- `src/lib/run-artifacts.ts` — fully functional
- `src/lib/pipeline-logger.ts` — partially wired (init + stage transitions)
- All prompt templates in `src/lib/prompts/builtin/` — fully functional
- `src/lib/ingest-cache.ts` — cache cleanup on stale entries
