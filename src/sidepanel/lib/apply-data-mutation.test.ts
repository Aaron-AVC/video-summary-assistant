import { describe, expect, it } from "bun:test"

import { applySidepanelDataMutation } from "@/sidepanel/lib/apply-data-mutation"

function createWorkspace(overrides: Partial<Parameters<typeof applySidepanelDataMutation>[1]> = {}) {
  return {
    analysisRunId: "run-current",
    analysisContentKey: "youtube:current",
    hasPersistedAnalysis: true,
    transcriptContentKey: "youtube:current",
    videoContextContentKey: "youtube:current",
    ...overrides,
  }
}

function createEffects() {
  const calls: string[] = []
  return {
    calls,
    effects: {
      invalidateWorkspace: (clearTranscript: boolean) => calls.push(`invalidate:${clearTranscript}`),
      clearAnalysis: () => calls.push("analysis"),
      setAnalysisIdle: () => calls.push("idle"),
      clearAskWorkspace: () => calls.push("ask"),
      clearTranscriptWorkspace: () => calls.push("transcript"),
      refreshRecentAnalyses: () => { calls.push("recent") },
      refreshProvider: () => { calls.push("provider") },
    },
  }
}

describe("Side Panel destructive mutation handling", () => {
  it("deleting the current run clears analysis and Ask but preserves transcript", async () => {
    const { calls, effects } = createEffects()
    await applySidepanelDataMutation({ type: "delete-analysis-run", analysisRunId: "run-current" }, createWorkspace(), effects)
    expect(calls).toEqual(["invalidate:false", "analysis", "idle", "ask", "recent"])
  })

  it("deleting a non-current run only refreshes history", async () => {
    const { calls, effects } = createEffects()
    await applySidepanelDataMutation({ type: "delete-analysis-run", analysisRunId: "run-other" }, createWorkspace(), effects)
    expect(calls).toEqual(["recent"])
  })

  it("deleting a matching video identity clears transcript, analysis, and Ask", async () => {
    const { calls, effects } = createEffects()
    await applySidepanelDataMutation({ type: "delete-video-data", contentKey: "youtube:current" }, createWorkspace({
      analysisContentKey: null,
      hasPersistedAnalysis: false,
    }), effects)
    expect(calls).toEqual(["invalidate:true", "analysis", "idle", "ask", "transcript", "recent"])
  })

  it("clearing conversations preserves analysis and transcript", async () => {
    const { calls, effects } = createEffects()
    await applySidepanelDataMutation({ type: "clear-conversations" }, createWorkspace(), effects)
    expect(calls).toEqual(["ask"])
  })

  it("clearing analysis history clears saved analysis and Ask but keeps transcript", async () => {
    const { calls, effects } = createEffects()
    await applySidepanelDataMutation({ type: "clear-analysis-history" }, createWorkspace(), effects)
    expect(calls).toEqual(["invalidate:false", "analysis", "idle", "ask", "recent"])
  })

  it("keeps non-persisted in-memory analysis on analysis-history clear", async () => {
    const { calls, effects } = createEffects()
    await applySidepanelDataMutation({ type: "clear-analysis-history" }, createWorkspace({ hasPersistedAnalysis: false }), effects)
    expect(calls).toEqual(["invalidate:false", "ask", "recent"])
  })

  it("does not evict loaded transcript for transcript-cache clear", async () => {
    const { calls, effects } = createEffects()
    await applySidepanelDataMutation({ type: "clear-transcript-cache" }, createWorkspace(), effects)
    expect(calls).toEqual([])
  })

  it("clears full workspace and refreshes providers after clear all", async () => {
    const { calls, effects } = createEffects()
    await applySidepanelDataMutation({ type: "clear-all" }, createWorkspace(), effects)
    expect(calls).toEqual(["invalidate:true", "analysis", "idle", "ask", "transcript", "provider", "recent"])
  })
})
