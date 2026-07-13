# Repository Guidelines

## Project Structure & Module Organization

```
src/                  # React/TypeScript frontend (Vite)
  components/         # UI: chat, layout, settings, graph, search, project
  lib/                # Core logic: ingest, prompts, search, LLM providers, wiki types
  stores/             # Zustand state: chat, wiki, review, lint, file-sync
  i18n/               # English + Chinese translations
  commands/           # Tauri IPC command wrappers
src-tauri/            # Rust/Tauri backend
  src/agent/          # LLM chat runtime, tools, skills, sessions
  src/commands/       # Tauri commands: FS, search, file history, extract
extension/            # Chrome web clipper extension
mcp-server/           # MCP server for external agent integration
```

Tests are colocated with source, named `*.test.ts` or `*.test.tsx`.

## Build, Test, and Development Commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start Vite dev server for frontend-only work |
| `npm run typecheck` | TypeScript compilation check |
| `npm run build` | Typecheck + Vite production build |
| `npm run build:desktop` | Full build: MCP server + frontend + Tauri |
| `npm run test` | Run all test suites (mock + real LLM) |
| `npm run test:mocks` | Unit and integration tests only (no LLM calls) |
| `npm run test:llm` | Real-LLM integration tests (`real-llm --no-file-parallelism`) |
| `npm run tauri` | Tauri CLI (e.g., `npm run tauri -- dev`) |

For full desktop development, use `npm run tauri -- dev` — this starts Vite + the Rust backend together.

## Coding Style & Naming Conventions

- TypeScript with strict mode; path alias `@/` maps to `src/`
- Naming: kebab-case filenames (`chat-panel.tsx`), PascalCase components, camelCase functions/variables
- Template literals (backticks) for multi-line strings and schema content
- Backend Rust modules use `snake_case` files and module naming
- No ESLint or Prettier config — follow existing patterns in the codebase

## Testing Guidelines

- Framework: **Vitest** with `@testing-library/react` for component tests
- Tests colocated with source: `src/lib/foo.ts` → `src/lib/foo.test.ts`
- Two test tiers: `test:mocks` for all unit/integration tests (default CI), `test:llm` for real LLM integration tests (manual, local only)
- Real-LLM tests use `--no-file-parallelism` — they share a single LLM connection
- Mock API responses when testing ingest pipelines, use `src/test-helpers/` for shared fixtures

## Commit & Pull Request Guidelines

Conventional commit prefixes preferred: `feat:`, `fix:`, `perf:`, `release:`, `merge:`.

PRs should include a clear description of the change, reference related issues when applicable, and ensure `npm run typecheck` and `npm run test:mocks` pass before requesting review.
