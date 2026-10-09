import { describe, expect, it } from "bun:test"

import { repairAnalysisResult } from "@/features/analysis/lib/repair-analysis"

const CUES = [
  { startSec: 0, endSec: 10, text: "Intro" },
  { startSec: 10, endSec: 20, text: "Body" },
  { startSec: 20, endSec: 30, text: "Close" }
]

describe("strict analysis parse and normalization", () => {
  it("trims, snaps, sorts, and deduplicates without synthesizing fields", () => {
    const result = repairAnalysisResult({
      summary: " Summary ",
      keyPoints: [
        { text: " Point ", startSec: 1, endSec: 18 },
        { text: "Point", startSec: 1, endSec: 18 },
        { text: "Untimed" }
      ],
      chapters: [
        { title: "Later", summary: "S2", detail: "D2", startSec: 19, endSec: 29 },
        { title: "Opening", summary: "S1", detail: "D1", startSec: 1, endSec: 8 },
        { title: "Opening", summary: "S1", detail: "D1", startSec: 1, endSec: 8 }
      ]
    }, { transcriptCues: CUES, durationSec: 25 })

    expect(result.summary).toBe("Summary")
    expect(result.keyPoints).toEqual([
      { text: "Point", startSec: 0, endSec: 20 },
      { text: "Untimed" }
    ])
    expect(result.chapters.map((chapter) => chapter.title)).toEqual(["Opening", "Later"])
    expect(result.chapters[1].endSec).toBeLessThanOrEqual(25)
  })

  it("rejects missing required chapters instead of creating Full video", () => {
    expect(() => repairAnalysisResult({ summary: "Summary", keyPoints: [{ text: "Point" }] }, { transcriptCues: CUES })).toThrow()
  })
})
