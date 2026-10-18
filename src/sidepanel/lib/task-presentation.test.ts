import { describe, expect, it } from "bun:test"

import {
  getAnalysisHeaderPresentation,
  getAnalysisTaskPresentation,
  getAskTaskPresentation,
} from "@/sidepanel/lib/task-presentation"

describe("task presentation semantics", () => {
  it("preserves Analysis task banner phase and cancellation semantics", () => {
    expect(getAnalysisTaskPresentation("loading-transcript")).toEqual({
      phaseLabelKey: "task.loadingTranscript",
      cancelDisabled: false,
      cancelling: false,
      spinnerAnimated: true,
    })
    expect(getAnalysisTaskPresentation("analyzing")).toEqual({
      phaseLabelKey: "task.analyzing",
      cancelDisabled: false,
      cancelling: false,
      spinnerAnimated: true,
    })
    expect(getAnalysisTaskPresentation("cancelling")).toEqual({
      phaseLabelKey: "task.cancelling",
      cancelDisabled: true,
      cancelling: true,
      spinnerAnimated: false,
    })
    expect(getAnalysisTaskPresentation("finalizing")).toEqual({
      phaseLabelKey: "task.savingAnalysis",
      cancelDisabled: true,
      cancelling: false,
      spinnerAnimated: true,
    })
  })

  it("preserves Ask task banner phase and cancellation semantics", () => {
    expect(getAskTaskPresentation("answering")).toEqual({
      phaseLabelKey: "task.answering",
      cancelDisabled: false,
      cancelling: false,
      spinnerAnimated: true,
    })
    expect(getAskTaskPresentation("repairing")).toEqual({
      phaseLabelKey: "task.repairing",
      cancelDisabled: false,
      cancelling: false,
      spinnerAnimated: true,
    })
    expect(getAskTaskPresentation("cancelling")).toEqual({
      phaseLabelKey: "task.cancelling",
      cancelDisabled: true,
      cancelling: true,
      spinnerAnimated: false,
    })
    expect(getAskTaskPresentation("finalizing")).toEqual({
      phaseLabelKey: "task.savingAnswer",
      cancelDisabled: true,
      cancelling: false,
      spinnerAnimated: true,
    })
  })

  it("keeps fetching ahead of every header phase", () => {
    expect(getAnalysisHeaderPresentation({
      isAnalysisFetching: true,
      phase: "error",
      hasAnalysis: false,
    })).toEqual({ statusKey: "analysis.loading" })
  })

  it("preserves header status mapping for every phase and analysis state", () => {
    const cases = [
      ["loading-transcript", false, "runtime.statusLoadingTranscript"],
      ["analyzing", false, "runtime.statusAnalyzing"],
      ["finalizing", false, "runtime.statusSaving"],
      ["cancelling", false, "runtime.statusCancelling"],
      ["error", false, "runtime.statusError"],
      ["cancelled", false, "runtime.statusCancelled"],
      ["completed", true, "runtime.statusReady"],
      ["completed", false, "runtime.statusNotAnalyzed"],
      ["idle", true, "runtime.statusReady"],
      ["idle", false, "runtime.statusNotAnalyzed"],
    ] as const

    for (const [phase, hasAnalysis, statusKey] of cases) {
      expect(getAnalysisHeaderPresentation({
        isAnalysisFetching: false,
        phase,
        hasAnalysis,
      })).toEqual({ statusKey })
    }
  })
})
