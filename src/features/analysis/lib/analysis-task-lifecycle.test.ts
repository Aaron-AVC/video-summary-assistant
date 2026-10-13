import { describe, expect, it } from "bun:test"

import {
  captureAnalysisCompletionTimes,
  getAnalysisTaskExecutionPolicy,
  shouldPublishAnalysisToWorkspace,
} from "@/features/analysis/lib/analysis-task-lifecycle"

describe("analysis task lifecycle policy", () => {
  it("separates regenerate cache bypass from transcript reload", () => {
    expect(getAnalysisTaskExecutionPolicy(false)).toEqual({
      bypassAnalysisCache: false,
      forceReloadTranscript: false,
    })
    expect(getAnalysisTaskExecutionPolicy(true)).toEqual({
      bypassAnalysisCache: true,
      forceReloadTranscript: false,
    })
  })

  it("captures completion time after the task start time", () => {
    expect(captureAnalysisCompletionTimes(
      "2026-10-14T04:00:00.000Z",
      () => "2026-10-14T04:07:00.000Z",
    )).toEqual({
      taskStartedAt: "2026-10-14T04:00:00.000Z",
      completedAt: "2026-10-14T04:07:00.000Z",
    })
  })

  it("publishes only when the workspace still shows the task source", () => {
    expect(shouldPublishAnalysisToWorkspace("youtube:a", "youtube:a")).toBe(true)
    expect(shouldPublishAnalysisToWorkspace("youtube:b", "youtube:a")).toBe(false)
    expect(shouldPublishAnalysisToWorkspace(null, "youtube:a")).toBe(false)
  })
})
