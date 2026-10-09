import { describe, expect, it } from "bun:test"

import {
  parseVideoAnalysis,
  parseAskVideoAnswer,
  VIDEO_ANALYSIS_PROMPT_VERSION,
  VIDEO_ANALYSIS_SCHEMA_VERSION
} from "@/features/analysis/lib/analysis-schema"

describe("VideoAnalysis schema", () => {
  const valid = {
    summary: "A concise summary.",
    keyPoints: [{ text: "Point one", startSec: 4, endSec: 18 }],
    chapters: [{
      title: "Opening",
      summary: "Introduces the topic",
      detail: "The presenter frames the problem and explains why it matters.",
      startSec: 0,
      endSec: 30
    }]
  }

  it("accepts valid structured analysis payloads", () => {
    expect(parseVideoAnalysis(valid)).toEqual(valid)
  })

  it("keeps schema v1 while versioning the Task 6 prompt/runtime", () => {
    expect(VIDEO_ANALYSIS_SCHEMA_VERSION).toBe(1)
    expect(VIDEO_ANALYSIS_PROMPT_VERSION).toBe("video-analysis-v2")
  })

  it("allows untimed key points but requires paired timestamps", () => {
    expect(parseVideoAnalysis({ ...valid, keyPoints: [{ text: "Untimed" }] }).keyPoints[0]).toEqual({ text: "Untimed" })
    expect(() => parseVideoAnalysis({ ...valid, keyPoints: [{ text: "Half", startSec: 1 }] })).toThrow()
  })

  it("rejects blank, empty, non-finite, negative, and reversed values", () => {
    expect(() => parseVideoAnalysis({ ...valid, summary: " " })).toThrow()
    expect(() => parseVideoAnalysis({ ...valid, keyPoints: [] })).toThrow()
    expect(() => parseVideoAnalysis({ ...valid, chapters: [] })).toThrow()
    expect(() => parseVideoAnalysis({ ...valid, chapters: [{ ...valid.chapters[0], detail: "" }] })).toThrow()
    expect(() => parseVideoAnalysis({ ...valid, chapters: [{ ...valid.chapters[0], startSec: Number.NaN }] })).toThrow()
    expect(() => parseVideoAnalysis({ ...valid, chapters: [{ ...valid.chapters[0], startSec: -1 }] })).toThrow()
    expect(() => parseVideoAnalysis({ ...valid, chapters: [{ ...valid.chapters[0], startSec: 30, endSec: 10 }] })).toThrow("End time must be greater than or equal to start time")
  })

  it("does not accept legacy topics, segments, or moments as canonical output", () => {
    expect(() => parseVideoAnalysis({ ...valid, topics: [], segments: valid.chapters })).toThrow()
  })

  it("accepts structured Ask AI answers with citations", () => {
    expect(parseAskVideoAnswer({
      answer: "The demo starts after the setup.",
      citations: [{ text: "Demo begins", startSec: 42, endSec: 58 }],
      suggestedJumps: [],
      followUps: []
    }).answer).toContain("demo")
  })
})
