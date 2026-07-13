import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { RotateCcw, Save } from "lucide-react"
import { readFile, writeFile, deleteFile, fileExists, createDirectory } from "@/commands/fs"
import { Button } from "@/components/ui/button"
import { useWikiStore } from "@/stores/wiki-store"
import { BUILTIN_TEMPLATES } from "@/lib/prompts/builtin-content"

// ── Template registry ──────────────────────────────────────────────────────

const PROMPT_TEMPLATES = [
  { id: "analysis", label: "Stage 1 — Analysis" },
  { id: "generation", label: "Stage 2 — Generation" },
  { id: "review-suggestion", label: "Review Suggestions" },
  { id: "aggregate-repair", label: "Aggregate Repair" },
  { id: "chunk-analysis-system", label: "Chunk Analysis (System)" },
  { id: "chunk-analysis-user", label: "Chunk Analysis (User)" },
  { id: "page-merge", label: "Page Merge" },
]

// ── Component ──────────────────────────────────────────────────────────────

export function PromptsSection() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [userContent, setUserContent] = useState("")
  const [builtinContent, setBuiltinContent] = useState("")
  const [draftContent, setDraftContent] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hasOverride, setHasOverride] = useState(false)

  const pp = project?.path ?? ""

  const loadTemplate = useCallback(
    async (templateId: string) => {
      if (!pp) return
      setLoading(true)
      setError(null)
      setStatusMsg(null)
      try {
        const userPath = `${pp}/.llm-wiki/prompts/${templateId}.md`
        const builtin = BUILTIN_TEMPLATES[templateId] ?? ""
        const user = await readFile(userPath).catch(() => "")
        const exists = user !== ""
        setHasOverride(exists)
        setUserContent(exists ? user : "")
        setBuiltinContent(builtin)
        setDraftContent(exists ? user : builtin)
        setStatusMsg(exists ? null : t("settings.prompts.usingDefault", "Using built-in default."))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [pp],
  )

  useEffect(() => {
    if (selectedId) {
      loadTemplate(selectedId)
    } else {
      setUserContent("")
      setBuiltinContent("")
      setDraftContent("")
      setHasOverride(false)
      setStatusMsg(null)
      setError(null)
    }
  }, [selectedId, loadTemplate])

  const handleSave = useCallback(async () => {
    if (!pp || !selectedId) return
    setSaving(true)
    setError(null)
    setStatusMsg(null)
    try {
      const dir = `${pp}/.llm-wiki/prompts`
      await createDirectory(dir).catch(() => {}) // no-op if exists
      await writeFile(`${dir}/${selectedId}.md`, draftContent)
      setHasOverride(true)
      setUserContent(draftContent)
      setStatusMsg(t("settings.prompts.saved", "Saved."))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [pp, selectedId, draftContent, t])

  const handleReset = useCallback(async () => {
    if (!pp || !selectedId) return
    setError(null)
    setStatusMsg(null)
    try {
      const path = `${pp}/.llm-wiki/prompts/${selectedId}.md`
      if (await fileExists(path)) {
        await deleteFile(path)
      }
      setHasOverride(false)
      setDraftContent(builtinContent)
      setUserContent("")
      setStatusMsg(t("settings.prompts.reset", "Reset to built-in default."))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [pp, selectedId, builtinContent, t])

  // ── Render ────────────────────────────────────────────────────────────

  if (!project) {
    return (
      <div className="p-6 text-muted-foreground text-sm">
        {t("settings.prompts.noProject", "Open a project to manage prompt templates.")}
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Template list sidebar */}
      <div className="w-56 border-r border-border shrink-0 overflow-y-auto p-2">
        <div className="text-xs font-medium text-muted-foreground px-2 py-1 mb-1">
          {t("settings.prompts.templates", "Templates")}
        </div>
        {PROMPT_TEMPLATES.map((template) => (
          <button
            key={template.id}
            onClick={() => setSelectedId(template.id)}
            className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors
              ${selectedId === template.id
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent/50 text-foreground"
              }`}
          >
            {template.label}
          </button>
        ))}
      </div>

      {/* Editor area */}
      <div className="flex-1 flex flex-col min-w-0 p-4 gap-3">
        {!selectedId ? (
          <div className="text-sm text-muted-foreground p-4">
            {t("settings.prompts.selectHint", "Select a template from the list to edit.")}
          </div>
        ) : loading ? (
          <div className="text-sm text-muted-foreground p-4">Loading...</div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-sm font-medium">
                  {PROMPT_TEMPLATES.find((t) => t.id === selectedId)?.label ?? selectedId}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {hasOverride
                    ? t("settings.prompts.customized", "Custom override active")
                    : t("settings.prompts.builtinLabel", "Using built-in default")}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  disabled={!hasOverride}
                  title={t("settings.prompts.resetTooltip", "Delete override, restore built-in default")}
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1" />
                  {t("settings.prompts.reset", "Reset")}
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleSave}
                  disabled={saving || draftContent === userContent}
                >
                  <Save className="w-3.5 h-3.5 mr-1" />
                  {saving ? t("settings.prompts.saving", "Saving...") : t("settings.prompts.save", "Save")}
                </Button>
              </div>
            </div>

            {/* Status / error */}
            {statusMsg && (
              <div className="text-xs text-green-600 dark:text-green-400">{statusMsg}</div>
            )}
            {error && (
              <div className="text-xs text-destructive">{error}</div>
            )}

            {/* Editor */}
            <textarea
              className="flex-1 min-h-0 w-full resize-none rounded border border-border bg-background p-3 font-mono text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring"
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              spellCheck={false}
            />

            {/* Built-in reference */}
            <details className="shrink-0">
              <summary className="text-xs text-muted-foreground cursor-pointer select-none">
                {t("settings.prompts.showBuiltin", "Show built-in default for reference")}
              </summary>
              <pre className="mt-2 p-3 rounded border border-border bg-muted text-xs font-mono leading-relaxed max-h-64 overflow-auto whitespace-pre-wrap">
                {builtinContent || t("settings.prompts.noBuiltin", "(not available)")}
              </pre>
            </details>
          </>
        )}
      </div>
    </div>
  )
}
