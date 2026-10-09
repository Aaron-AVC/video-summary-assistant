import { describe, expect, it } from "bun:test"

import { persistedLegacyAnalysisToVideoAnalysis } from "@/features/analysis/lib/analysis-compat"

describe("legacy analysis compatibility", () => {
  it("projects old segment rows into chapters and uses summary when detail is absent", () => {
    const result = persistedLegacyAnalysisToVideoAnalysis({
      summary: "Old summary",
      keyPoints: [{ text: "Old point" }],
      topics: [{ label: "ignored" }]
    }, [{
      id: "segment-1",
      analysisRunId: "run-1",
      videoId: "video-1",
      title: "Opening",
      summary: "Opening summary",
      startSec: 0,
      endSec: 10,
      createdAt: "2026-10-09T00:00:00.000Z",
      updatedAt: "2026-10-09T00:00:00.000Z"
    }])
    expect(result.chapters).toEqual([{
      title: "Opening",
      summary: "Opening summary",
      detail: "Opening summary",
      startSec: 0,
      endSec: 10
    }])
  })
})
