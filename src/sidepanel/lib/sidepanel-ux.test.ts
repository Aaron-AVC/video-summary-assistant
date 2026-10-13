import { describe, expect, it } from "bun:test"

import {
  INITIAL_SIDE_PANEL_TAB,
  getAnalysisAction,
  getAskRequirement,
  selectSidePanelTab,
  shouldResetVideoSpecificState
} from "@/sidepanel/lib/sidepanel-ux"

describe("Side Panel V1 state", () => {
  it("defaults to Overview and supports every requested tab", () => {
    expect(INITIAL_SIDE_PANEL_TAB).toBe("overview")
    expect(selectSidePanelTab("overview", "transcript")).toBe("transcript")
    expect(selectSidePanelTab("transcript", "ask")).toBe("ask")
    expect(selectSidePanelTab("ask", "settings")).toBe("settings")
    expect(selectSidePanelTab("settings", "invalid")).toBe("settings")
  })

  it("preserves navigation for same-identity refreshes and resets only on contentKey change", () => {
    expect(shouldResetVideoSpecificState("youtube:a", "youtube:a")).toBe(false)
    expect(shouldResetVideoSpecificState("youtube:a", "youtube:b")).toBe(true)
    expect(shouldResetVideoSpecificState("bilibili:BV1:p:1", "bilibili:BV1:p:2")).toBe(true)
    expect(selectSidePanelTab("transcript", "transcript")).toBe("transcript")
  })

  it("chooses Generate, Regenerate, Cancel, Saving, and Configure provider deterministically", () => {
    expect(getAnalysisAction({ hasProvider: false, hasAnalysis: false, isAnalyzing: false, isFinalizing: false })).toEqual({
      kind: "configure-provider",
      label: "Configure provider"
    })
    expect(getAnalysisAction({ hasProvider: true, hasAnalysis: false, isAnalyzing: false, isFinalizing: false })).toEqual({
      kind: "generate",
      label: "Generate analysis"
    })
    expect(getAnalysisAction({ hasProvider: true, hasAnalysis: true, isAnalyzing: false, isFinalizing: false })).toEqual({
      kind: "regenerate",
      label: "Regenerate"
    })
    expect(getAnalysisAction({ hasProvider: true, hasAnalysis: true, isAnalyzing: true, isFinalizing: false })).toEqual({
      kind: "cancel",
      label: "Cancel"
    })
    expect(getAnalysisAction({ hasProvider: true, hasAnalysis: true, isAnalyzing: false, isFinalizing: true })).toEqual({
      kind: "finalizing",
      label: "Saving analysis…"
    })
  })

  it("routes Ask prerequisites to useful actions", () => {
    expect(getAskRequirement({ hasProvider: false, hasAnalysis: false, hasTranscript: false })).toBe("provider")
    expect(getAskRequirement({ hasProvider: true, hasAnalysis: false, hasTranscript: false })).toBe("analysis")
    expect(getAskRequirement({ hasProvider: true, hasAnalysis: true, hasTranscript: false })).toBe("transcript")
    expect(getAskRequirement({ hasProvider: true, hasAnalysis: true, hasTranscript: true })).toBe(null)
  })
})
