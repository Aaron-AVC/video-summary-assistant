import { describe, expect, it } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { ActiveAnalysisTaskBanner } from "@/features/analysis/components/active-analysis-task"
import type { ActiveAnalysisTask } from "@/features/analysis/lib/analysis-task-controller"

const snapshot: ActiveAnalysisTask["snapshot"] = {
  taskId: "task-fixture",
  sourceTabId: 10,
  platform: "youtube",
  videoId: "video-test",
  partId: null,
  contentKey: "youtube:video-test",
  title: "Test Video",
  author: null,
  canonicalUrl: null,
  providerProfileId: "provider-test",
  providerBaseUrl: "https://api.example.com/v1",
  providerModel: "test-model",
  generationTimeoutSec: 600,
  analysisPresetId: "standard",
  analysisPromptVersion: "video-analysis-v2",
  startedAt: "2026-11-18T00:00:00.000Z",
}

const render = (task: Omit<ActiveAnalysisTask, "snapshot">) =>
  renderToStaticMarkup(
    <ActiveAnalysisTaskBanner task={{ snapshot, ...task }} onCancel={() => undefined} />
  )

describe("ActiveAnalysisTaskBanner M1 progress", () => {
  it("renders counted map and reduction progress without private content", () => {
    const map = render({ phase: "analyzing", progress: { kind: "map", completed: 3, total: 5 } })
    expect(map).toContain("Analyzing transcript segments 3/5")
    expect(map).not.toContain("sk-fixture")
    const reduced = render({
      phase: "analyzing", progress: { kind: "reduction", level: 2, completed: 1, total: 3 }
    })
    expect(reduced).toContain("Combining summaries (level 2) 1/3")
  })

  it("shows final model generation as cancellable, distinct from saving", () => {
    const finalMarkup = render({ phase: "analyzing", progress: { kind: "final" } })
    expect(finalMarkup).toContain("Generating final summary")
    expect(finalMarkup).not.toContain("Saving analysis")
    // Tailwind adds "disabled:*" class names even on enabled buttons.
    // Match the actual HTML disabled attribute, not class text.
    const hasDisabledAttribute = /<button\b[^>]*\sdisabled(?:\s|=|>)/
    expect(finalMarkup).not.toMatch(hasDisabledAttribute)

    const saving = render({ phase: "finalizing" })
    expect(saving).toContain("Saving analysis")
    expect(saving).toMatch(hasDisabledAttribute)
  })

  it("suppresses progress detail in cancelling phase", () => {
    const markup = render({ phase: "cancelling", progress: { kind: "final" } })
    expect(markup).toContain("Cancelling")
    expect(markup).not.toContain("Generating final summary")
  })
})
