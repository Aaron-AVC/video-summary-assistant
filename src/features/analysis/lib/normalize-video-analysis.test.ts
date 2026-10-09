import { describe, expect, it } from "bun:test"

import { parseVideoAnalysis } from "@/features/analysis/lib/analysis-schema"
import { normalizeVideoAnalysis } from "@/features/analysis/lib/normalize-video-analysis"

const cues = [
  { startSec: 0, endSec: 10, text: "one" },
  { startSec: 10, endSec: 20, text: "two" },
  { startSec: 20, endSec: 30, text: "three" }
]

const chapter = (startSec: number, endSec: number, title = "Chapter") => ({
  title,
  startSec,
  endSec,
  summary: "Short summary",
  detail: "Longer transcript-grounded detail"
})

describe("normalizeVideoAnalysis", () => {
  it("grounds ranges to cue boundaries and sorts chapters", () => {
    const normalized = normalizeVideoAnalysis(parseVideoAnalysis({
      summary: "Summary",
      keyPoints: [{ text: "Point", startSec: 1, endSec: 18 }],
      chapters: [chapter(19, 29, "Later"), chapter(1, 18, "Opening")]
    }), { transcriptCues: cues })
    expect(normalized.keyPoints[0]).toEqual({ text: "Point", startSec: 0, endSec: 20 })
    expect(normalized.chapters.map((item) => item.title)).toEqual(["Opening", "Later"])
  })

  it("clamps to duration and ignores non-finite duration", () => {
    const input = parseVideoAnalysis({
      summary: "Summary",
      keyPoints: [{ text: "Point", startSec: 1, endSec: 29 }],
      chapters: [chapter(1, 29)]
    })
    expect(normalizeVideoAnalysis(input, { transcriptCues: cues, durationSec: 15 }).chapters[0].endSec).toBeLessThanOrEqual(15)
    expect(normalizeVideoAnalysis(input, { transcriptCues: cues, durationSec: Number.POSITIVE_INFINITY }).chapters[0].endSec).toBe(30)
  })

  it("deduplicates chapters and key points while retaining untimed points", () => {
    const normalized = normalizeVideoAnalysis(parseVideoAnalysis({
      summary: "Summary",
      keyPoints: [{ text: " Point ", startSec: 1, endSec: 8 }, { text: "Point", startSec: 1, endSec: 8 }, { text: "No time" }],
      chapters: [chapter(1, 8), chapter(1, 8)]
    }), { transcriptCues: cues })
    expect(normalized.keyPoints).toHaveLength(2)
    expect(normalized.keyPoints[1]).toEqual({ text: "No time" })
    expect(normalized.chapters).toHaveLength(1)
  })
})
