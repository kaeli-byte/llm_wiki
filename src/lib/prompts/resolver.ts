/**
 * Prompt template resolver for LLM Wiki ingest pipeline.
 *
 * Renders templates with {{var}} for substitution and
 * {{#if var}}...{{/if}} for conditional blocks.
 *
 * Template lookup order:
 *   1. User override: {projectPath}/.llm-wiki/prompts/{name}.md
 *   2. Built-in:     bundled into JS at build time (builtin-content.ts)
 *   3. Filesystem fallback: src/lib/prompts/builtin/{name}.md (tests only)
 *
 * Dynamic values should be pre-computed by the caller and passed as vars:
 *   - languageRule → buildLanguageDirective(sourceContent)
 *   - today        → currentWikiDate()
 *   - knownTypes   → GENERATION_WIKI_TYPES.join(" | ")
 *   - Content trimming → applied before passing vars
 *
 * The resolver will auto-inject languageRule (from sourceContent) and
 * knownTypes when not provided, but does NOT do content trimming.
 */

import { readFile } from "@/commands/fs"
import { buildLanguageDirective } from "@/lib/output-language"
import { GENERATION_WIKI_TYPES } from "@/lib/wiki-page-types"
import { BUILTIN_TEMPLATES } from "@/lib/prompts/builtin-content"

const BUILTIN_DIR = "src/lib/prompts/builtin"
const BUILTIN_CACHE: Record<string, string> = {}

async function loadBuiltinFallback(name: string): Promise<string | null> {
  if (BUILTIN_CACHE[name]) return BUILTIN_CACHE[name]
  try {
    const content = await readFile(`${BUILTIN_DIR}/${name}.md`)
    BUILTIN_CACHE[name] = content
    return content
  } catch {
    return null
  }
}

async function loadUserTemplate(
  projectPath: string | undefined,
  name: string,
): Promise<string | null> {
  if (!projectPath) return null
  try {
    return await readFile(`${projectPath}/.llm-wiki/prompts/${name}.md`)
  } catch {
    return null
  }
}

function getBuiltinContent(name: string): string | null {
  // Primary: bundled at build time via import.meta.glob
  if (BUILTIN_TEMPLATES[name]) return BUILTIN_TEMPLATES[name]
  return null
}

/**
 * Render a template string: substitute {{var}} and process {{#if var}}...{{/if}}.
 * Conditional blocks are included only when the variable is non-empty.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  let result = template
  const ifRegex = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g
  let prev = ""
  while (prev !== result) {
    prev = result
    result = result.replace(ifRegex, (_match, varName: string, body: string) => {
      return (vars[varName] ?? "").trim() ? body : ""
    })
  }
  result = result.replace(/\{\{(\w+)\}\}/g, (_match, varName: string) => {
    return vars[varName] ?? ""
  })
  return result
}

export interface ResolvePromptOptions {
  projectPath?: string
}

/**
 * Load and render a prompt template.
 *
 * Auto-injects languageRule (from sourceContent if present) and knownTypes.
 * Content trimming and date formatting must be done by the caller.
 */
export async function resolvePrompt(
  name: string,
  vars: Record<string, string>,
  options: ResolvePromptOptions = {},
): Promise<string | null> {
  const resolvedVars = { ...vars }
  if (!resolvedVars.languageRule) {
    resolvedVars.languageRule = buildLanguageDirective(
      resolvedVars.sourceContent ?? "",
    )
  }
  if (!resolvedVars.knownTypes) {
    resolvedVars.knownTypes = GENERATION_WIKI_TYPES.join(" | ")
  }

  // 1. User override
  let template: string | null = null
  if (options.projectPath) {
    template = await loadUserTemplate(options.projectPath, name)
  }
  // 2. Built-in (bundled at build time)
  if (!template) {
    template = getBuiltinContent(name)
  }
  // 3. Filesystem fallback (tests, dev environment)
  if (!template) {
    template = await loadBuiltinFallback(name)
  }
  if (!template) return null

  return renderTemplate(template, resolvedVars)
}
