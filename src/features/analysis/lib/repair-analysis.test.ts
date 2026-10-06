import { describe, expect, it } from "bun:test"

import { repairAnalysisResult } from "@/features/analysis/lib/repair-analysis"

const TRANSCRIPT_CUES = [
  { startSec: 0, endSec: 10, text: "Intro" },
  { startSec: 10, endSec: 20, text: "Body" },
  { startSec: 20, endSec: 30, text: "Close" }
]

describe("repairAnalysisResult", () => {
  it("repairs string payloads and snaps segments to cue boundaries", () => {
    const repaired = repairAnalysisResult(
      JSON.stringify({
        summary: "  Overall summary  ",
        keyPoints: [" First key point "],
        topics: [],
        segments: [
          {
            title: " Opening ",
            summary: " Starts the topic ",
            startSec: 1,
            endSec: 18
          }
        ]
      }),
      {
        transcriptCues: TRANSCRIPT_CUES
      }
    )

    expect(repaired.summary).toBe("Overall summary")
    expect(repaired.keyPoints).toEqual([
      {
        text: "First key point",
        startSec: 0,
        endSec: 10
      }
    ])
    expect(repaired.topics).toEqual([{ label: "Unavailable" }])
    expect(repaired.segments).toEqual([
      {
        title: "Opening",
        summary: "Starts the topic",
        startSec: 0,
        endSec: 20
      }
    ])
    expect(repaired.moments).toEqual(repaired.segments)
  })

  it("creates a fallback segment when structured segments are missing", () => {
    const repaired = repairAnalysisResult(
      {
        summary: "Summary",
        keyPoints: ["Point"],
        topics: ["Topic"]
      },
      {
        transcriptCues: TRANSCRIPT_CUES
      }
    )

    expect(repaired.segments).toEqual([
      {
        title: "Full video",
        summary: "Intro",
        startSec: 0,
        endSec: 30
      }
    ])
  })

  it("repairs near-valid timestamped key points and moments", () => {
    const repaired = repairAnalysisResult(
      {
        summary: "Summary",
        keyPoints: [
          {
            text: "Demo begins",
            startSec: 1,
            endSec: 9
          },
          {
            title: "Closing point",
            startSec: 28,
            endSec: 21
          }
        ],
        topics: [
          {
            label: "Demo",
            startSec: 11,
            endSec: 19
          }
        ],
        moments: [
          {
            title: "Example",
            summary: "Shows the example",
            startSec: 11,
            endSec: 19
          }
        ]
      },
      {
        transcriptCues: TRANSCRIPT_CUES
      }
    )

    expect(repaired.keyPoints).toEqual([
      {
        text: "Demo begins",
        startSec: 0,
        endSec: 10
      },
      {
        text: "Closing point",
        startSec: 20,
        endSec: 20
      }
    ])
    expect(repaired.topics).toEqual([
      {
        label: "Demo",
        startSec: 10,
        endSec: 20
      }
    ])
    expect(repaired.moments).toEqual([
      {
        title: "Example",
        summary: "Shows the example",
        startSec: 10,
        endSec: 20
      }
    ])
  })
})
