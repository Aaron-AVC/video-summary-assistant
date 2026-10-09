import { describe, expect, it } from "bun:test"

import { parseStructuredJsonObject, parseVideoAnalysisPayload } from "@/features/analysis/lib/parse-video-analysis"

const valid = JSON.stringify({
  summary: "Summary",
  keyPoints: [{ text: "Point" }],
  chapters: [{ title: "Opening", startSec: 0, endSec: 10, summary: "Short", detail: "Detailed" }]
})

describe("structured video analysis parser", () => {
  it("accepts a single JSON fence and rejects arrays/non-JSON", () => {
    expect(parseVideoAnalysisPayload(`\n\`\`\`json\n${valid}\n\`\`\`\n`).summary).toBe("Summary")
    expect(() => parseStructuredJsonObject("[]")).toThrow()
    expect(() => parseStructuredJsonObject("not json")).toThrow()
  })

  it("does not guess JSON fragments or synthesize missing fields", () => {
    expect(() => parseVideoAnalysisPayload(`${valid} trailing`)).toThrow()
    expect(() => parseVideoAnalysisPayload({ summary: "Summary" })).toThrow()
  })
})
