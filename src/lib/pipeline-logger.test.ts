import { describe, expect, it, vi } from "vitest"
import fs from "node:fs/promises"
import { createTempProject, realFs } from "@/test-helpers/fs-temp"

vi.mock("@/commands/fs", () => realFs)

import { PipelineLogger } from "./pipeline-logger"

describe("PipelineLogger", () => {
  it("persists accurate tracked-call and generated-page totals", async () => {
    const tmp = await createTempProject("pipeline-logger")
    try {
      const logger = new PipelineLogger(tmp.path, "report.pdf", "/report.pdf", 100, "hash", 80)
      await logger.ensureDirectories()
      logger.startStage("analysis")
      const call = logger.createCall("analysis", "analyze", "analysis", "builtin", "prompt-hash", "openai", "test")
      call.onToken("response")
      call.onComplete(8, 2)
      logger.completeStage("analysis")
      logger.setTotalPagesGenerated(3)
      logger.setVerifiedFilesWritten(["wiki/a.md", "wiki/b.md"])
      await logger.finalize()

      const manifest = JSON.parse(await fs.readFile(`${logger.getBasePath()}/manifest.json`, "utf8"))
      expect(manifest.summary).toMatchObject({ totalLlmCalls: 1, totalOutputTokens: 2, totalPagesGenerated: 3, verifiedFilesWritten: 2 })
      expect(manifest.verifiedWrittenPaths).toEqual(["wiki/a.md", "wiki/b.md"])
      expect(await fs.readFile(`${tmp.path}/.llm-wiki/pipeline.log`, "utf8")).toContain("call-001-analysis")
    } finally {
      await tmp.cleanup()
    }
  })
})
