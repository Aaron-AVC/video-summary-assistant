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
  it("rejects a chapter whose range is completely outside transcript evidence", () => {
    expect(() => normalizeVideoAnalysis(parseVideoAnalysis({
      summary: "Summary",
      keyPoints: [{ text: "Point" }],
      chapters: [chapter(100, 110)]
    }), { transcriptCues: cues })).toThrow("chapters.0")
    expect(() => normalizeVideoAnalysis(parseVideoAnalysis({
      summary: "Summary",
      keyPoints: [{ text: "Point" }],
      chapters: [chapter(100, 110)]
    }), { transcriptCues: cues })).toThrow("does not overlap transcript evidence")
  })

  it("rejects an untethered timestamped key point", () => {
    expect(() => normalizeVideoAnalysis(parseVideoAnalysis({
      summary: "Summary",
      keyPoints: [{ text: "Point", startSec: 100, endSec: 110 }],
      chapters: [chapter(0, 10)]
    }), { transcriptCues: cues })).toThrow("keyPoints.0")
  })

  it("rejects ranges entirely inside a transcript gap", () => {
    const gappedCues = [
      { startSec: 0, endSec: 10, text: "one" },
      { startSec: 100, endSec: 110, text: "two" }
    ]
    expect(() => normalizeVideoAnalysis(parseVideoAnalysis({
      summary: "Summary",
      keyPoints: [{ text: "Point" }],
      chapters: [chapter(40, 50)]
    }), { transcriptCues: gappedCues })).toThrow("chapters.0")
  })

  it("allows partial overlap but clamps only to the effective duration", () => {
    const normalized = normalizeVideoAnalysis(parseVideoAnalysis({
      summary: "Summary",
      keyPoints: [{ text: "Point" }],
      chapters: [chapter(25, 40)]
    }), { transcriptCues: [{ startSec: 0, endSec: 30, text: "one" }] })
    expect(normalized.chapters[0].endSec).toBe(30)
  })

  it("rejects a range in transcript text beyond the video duration", () => {
    expect(() => normalizeVideoAnalysis(parseVideoAnalysis({
      summary: "Summary",
      keyPoints: [{ text: "Point" }],
      chapters: [chapter(20, 30)]
    }), {
      transcriptCues: [{ startSec: 0, endSec: 30, text: "one" }],
      durationSec: 15
    })).toThrow("does not overlap transcript evidence")
  })

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
