/**
 * Built-in prompt template content, bundled at build time via Vite's
 * import.meta.glob so the templates are always available regardless
 * of runtime filesystem state (dev, production, Tauri distribution).
 *
 * Each entry is keyed by template name (e.g. "analysis") and maps to
 * the full template text.
 */

const templateModules = import.meta.glob('./builtin/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Map of template name → content for all built-in prompt templates. */
export const BUILTIN_TEMPLATES: Record<string, string> = {}

for (const [path, content] of Object.entries(templateModules)) {
  // Extract template name from path: "./builtin/analysis.md" → "analysis"
  const name = path.replace(/^\.\/builtin\//, '').replace(/\.md$/, '')
  BUILTIN_TEMPLATES[name] = content as string
}
