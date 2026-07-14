/**
 * Prompt template resolver for the LLM Wiki ingest pipeline.
 *
 * Lookup order:
 *   1. Project override: <project>/.llm-wiki/prompts/<name>.md
 *   2. Built-in template bundled by Vite
 *   3. Source-tree fallback used by tests/development
 *
 * This version also:
 *   - injects common variables (`today`, `languageRule`, `knownTypes`)
 *   - supports the legacy `sourceSummaryPath` variable as `summaryPath`
 *   - reports which template source was selected
 *   - rejects unresolved template placeholders instead of silently rendering blanks
 */

import { readFile } from "@/commands/fs"
import { buildLanguageDirective } from "@/lib/output-language"
import { GENERATION_WIKI_TYPES } from "@/lib/wiki-page-types"
import { BUILTIN_TEMPLATES } from "@/lib/prompts/builtin-content"

const BUILTIN_DIR = "src/lib/prompts/builtin"
const BUILTIN_CACHE: Record<string, string> = {}

function currentWikiDate(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

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
  return BUILTIN_TEMPLATES[name] ?? null
}

function applyConditionals(
  template: string,
  vars: Record<string, string>,
): string {
  let result = template
  const ifRegex = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g
  let previous = ""
  while (previous !== result) {
    previous = result
    result = result.replace(ifRegex, (_match, varName: string, body: string) => {
      return (vars[varName] ?? "").trim() ? body : ""
    })
  }
  return result
}

function requiredPlaceholderNames(template: string): string[] {
  return [...new Set(
    Array.from(template.matchAll(/\{\{(\w+)\}\}/g)).map((match) => match[1]),
  )]
}

export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return applyConditionals(template, vars).replace(
    /\{\{(\w+)\}\}/g,
    (_match, varName: string) => vars[varName] ?? "",
  )
}

export interface ResolvePromptOptions {
  projectPath?: string
  /** Throw when a placeholder is unresolved. Default: true. */
  strict?: boolean
  /** Optional diagnostics sink for tests or UI logging. */
  onResolved?: (info: { name: string; source: "override" | "builtin" | "fallback" }) => void
}

function missingRequiredVariables(
  template: string,
  vars: Record<string, string>,
): string[] {
  const afterConditionals = applyConditionals(template, vars)
  return requiredPlaceholderNames(afterConditionals).filter(
    (name) => !(name in vars),
  )
}

export async function resolvePrompt(
  name: string,
  vars: Record<string, string>,
  options: ResolvePromptOptions = {},
): Promise<string | null> {
  const resolvedVars: Record<string, string> = { ...vars }

  if (!resolvedVars.languageRule) {
    resolvedVars.languageRule = buildLanguageDirective(resolvedVars.sourceContent ?? "")
  }
  if (!resolvedVars.knownTypes) {
    resolvedVars.knownTypes = GENERATION_WIKI_TYPES.join(" | ")
  }
  if (!resolvedVars.today) {
    resolvedVars.today = currentWikiDate()
  }
  if (!resolvedVars.summaryPath && resolvedVars.sourceSummaryPath) {
    resolvedVars.summaryPath = resolvedVars.sourceSummaryPath
  }

  let template: string | null = null
  let source: "override" | "builtin" | "fallback" | null = null

  if (options.projectPath) {
    template = await loadUserTemplate(options.projectPath, name)
    if (template) source = "override"
  }
  if (!template) {
    template = getBuiltinContent(name)
    if (template) source = "builtin"
  }
  if (!template) {
    template = await loadBuiltinFallback(name)
    if (template) source = "fallback"
  }
  if (!template || !source) return null

  const missing = missingRequiredVariables(template, resolvedVars)
  if (missing.length > 0) {
    const message = `Prompt "${name}" is missing required variables: ${missing.join(", ")}`
    if (options.strict !== false) throw new Error(message)
    console.warn(`[prompts] ${message}`)
  }

  const rendered = renderTemplate(template, resolvedVars)
  options.onResolved?.({ name, source })
  console.debug(`[prompts] resolved "${name}" from ${source}`)
  return rendered
}
