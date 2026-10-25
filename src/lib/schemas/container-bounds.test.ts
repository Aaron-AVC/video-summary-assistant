import { afterEach, describe, expect, it } from "bun:test"
import * as z from "zod"

import {
  askVideoAnswerSchema,
  videoAnalysisSchema
} from "@/features/analysis/lib/analysis-schema"
import {
  MAX_ANALYSIS_CHAPTERS,
  MAX_ANALYSIS_KEY_POINTS,
  MAX_ASK_CITATIONS,
  MAX_ASK_FOLLOW_UPS,
  MAX_ASK_SUGGESTED_JUMPS,
  MAX_TRANSCRIPT_CUES
} from "@/lib/schemas/container-limits"
import {
  FETCH_VIDEO_TRANSCRIPT,
  sendRuntimeMessage
} from "@/lib/runtime/messages"

const originalChrome = globalThis.chrome

afterEach(() => {
  globalThis.chrome = originalChrome
})

function installChromeRuntime(sendMessage: (...args: unknown[]) => unknown) {
  globalThis.chrome = {
    runtime: { sendMessage }
  } as unknown as typeof chrome
}

function repeat<T>(count: number, make: (index: number) => T): T[] {
  return Array.from({ length: count }, (_unused, index) => make(index))
}

const validAnalysis = {
  summary: "A concise summary.",
  keyPoints: [{ text: "Point one" }],
  chapters: [{
    title: "Opening",
    summary: "Introduces the topic",
    detail: "The presenter frames the problem.",
    startSec: 0,
    endSec: 30
  }]
}

const validAnswer = {
  answer: "The answer.",
  citations: [{ startSec: 0, endSec: 10 }],
  suggestedJumps: [{ startSec: 0, endSec: 10, title: "Opening" }],
  followUps: ["What happens next?"]
}

/**
 * GHSA-mrhx-c7xc-m3w5 regression: bounded containers must reject an oversized
 * payload *before* element validation, so issue accumulation cannot scale with
 * attacker-controlled input.
 */
describe("bounded zod containers reject oversized input before element validation", () => {
  it("does not validate any element of an oversized bounded array", () => {
    let validations = 0
    const countedElement = z.any().superRefine(() => {
      validations += 1
    })
    const bounded = z.array(countedElement).max(5)

    validations = 0
    const result = bounded.safeParse(new Array(500).fill({}))

    expect(result.success).toBe(false)
    expect(validations).toBe(0)
  })

  it("control: the same counter does fire for an unbounded array", () => {
    // Without this control the previous assertion could pass simply because the
    // counter never ran at all.
    let validations = 0
    const countedElement = z.any().superRefine(() => {
      validations += 1
    })

    validations = 0
    const result = z.array(countedElement).safeParse(new Array(500).fill({}))

    expect(result.success).toBe(true)
    expect(validations).toBe(500)
  })
})

describe("Z1 — analysis provider output collection bounds", () => {
  it("accepts exactly the maximum number of key points", () => {
    const payload = {
      ...validAnalysis,
      keyPoints: repeat(MAX_ANALYSIS_KEY_POINTS, (index) => ({ text: `point ${index}` }))
    }
    expect(videoAnalysisSchema.safeParse(payload).success).toBe(true)
  })

  it("rejects one key point over the maximum without per-element issues", () => {
    const payload = {
      ...validAnalysis,
      keyPoints: repeat(MAX_ANALYSIS_KEY_POINTS + 1, (index) => ({ text: `point ${index}` }))
    }
    const result = videoAnalysisSchema.safeParse(payload)

    expect(result.success).toBe(false)
    expect(result.error?.issues).toHaveLength(1)
    expect(result.error?.issues[0]?.code).toBe("too_big")
  })

  it("accepts exactly the maximum number of chapters", () => {
    const payload = {
      ...validAnalysis,
      chapters: repeat(MAX_ANALYSIS_CHAPTERS, (index) => ({
        title: `Chapter ${index}`,
        summary: "Summary",
        detail: "Detail",
        startSec: 0,
        endSec: 30
      }))
    }
    expect(videoAnalysisSchema.safeParse(payload).success).toBe(true)
  })

  it("rejects one chapter over the maximum", () => {
    const payload = {
      ...validAnalysis,
      chapters: repeat(MAX_ANALYSIS_CHAPTERS + 1, (index) => ({
        title: `Chapter ${index}`,
        summary: "Summary",
        detail: "Detail",
        startSec: 0,
        endSec: 30
      }))
    }
    const result = videoAnalysisSchema.safeParse(payload)

    expect(result.success).toBe(false)
    expect(result.error?.issues).toHaveLength(1)
    expect(result.error?.issues[0]?.code).toBe("too_big")
  })
})

describe("Z2 — ask provider output collection bounds", () => {
  it("accepts exactly the maximum number of citations", () => {
    const payload = {
      ...validAnswer,
      citations: repeat(MAX_ASK_CITATIONS, () => ({ startSec: 0, endSec: 10 }))
    }
    expect(askVideoAnswerSchema.safeParse(payload).success).toBe(true)
  })

  it("rejects one citation over the maximum", () => {
    const payload = {
      ...validAnswer,
      citations: repeat(MAX_ASK_CITATIONS + 1, () => ({ startSec: 0, endSec: 10 }))
    }
    const result = askVideoAnswerSchema.safeParse(payload)

    expect(result.success).toBe(false)
    expect(result.error?.issues).toHaveLength(1)
    expect(result.error?.issues[0]?.code).toBe("too_big")
  })

  it("accepts exactly the maximum number of suggested jumps", () => {
    const payload = {
      ...validAnswer,
      suggestedJumps: repeat(MAX_ASK_SUGGESTED_JUMPS, (index) => ({
        startSec: 0,
        endSec: 10,
        title: `Jump ${index}`
      }))
    }
    expect(askVideoAnswerSchema.safeParse(payload).success).toBe(true)
  })

  it("rejects one suggested jump over the maximum", () => {
    const payload = {
      ...validAnswer,
      suggestedJumps: repeat(MAX_ASK_SUGGESTED_JUMPS + 1, (index) => ({
        startSec: 0,
        endSec: 10,
        title: `Jump ${index}`
      }))
    }
    const result = askVideoAnswerSchema.safeParse(payload)

    expect(result.success).toBe(false)
    expect(result.error?.issues).toHaveLength(1)
    expect(result.error?.issues[0]?.code).toBe("too_big")
  })

  it("accepts exactly the maximum number of follow-ups", () => {
    const payload = {
      ...validAnswer,
      followUps: repeat(MAX_ASK_FOLLOW_UPS, (index) => `Question ${index}?`)
    }
    expect(askVideoAnswerSchema.safeParse(payload).success).toBe(true)
  })

  it("rejects one follow-up over the maximum", () => {
    const payload = {
      ...validAnswer,
      followUps: repeat(MAX_ASK_FOLLOW_UPS + 1, (index) => `Question ${index}?`)
    }
    const result = askVideoAnswerSchema.safeParse(payload)

    expect(result.success).toBe(false)
    expect(result.error?.issues).toHaveLength(1)
    expect(result.error?.issues[0]?.code).toBe("too_big")
  })
})

describe("Z3 — runtime transcript segment bounds", () => {
  const video = {
    platform: "youtube" as const,
    videoId: "dQw4w9WgXcQ",
    contentKey: "youtube:dQw4w9WgXcQ",
    title: "A video",
    canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  }

  function transcriptResponse(segmentCount: number) {
    return {
      ok: true as const,
      type: FETCH_VIDEO_TRANSCRIPT,
      tabId: 1,
      video,
      transcript: {
        segments: repeat(segmentCount, () => ({ startSec: 0, endSec: 1, text: "hello" })),
        source: "manual" as const
      }
    }
  }

  it("accepts exactly the maximum number of transcript segments", async () => {
    installChromeRuntime(async () => transcriptResponse(MAX_TRANSCRIPT_CUES))

    const response = await sendRuntimeMessage({ channel: "video-summary-assistant/runtime", type: FETCH_VIDEO_TRANSCRIPT })

    expect(response.ok).toBe(true)
  })

  it("rejects one segment over the maximum at the runtime boundary", async () => {
    installChromeRuntime(async () => transcriptResponse(MAX_TRANSCRIPT_CUES + 1))

    const response = await sendRuntimeMessage({ channel: "video-summary-assistant/runtime", type: FETCH_VIDEO_TRANSCRIPT })

    // The discriminated union reports a flattened `<root>: Invalid input`, so the
    // segment count is the only variable between this case and the accepted one
    // above — that pair is what attributes the rejection to the bound.
    expect(response.ok).toBe(false)
    expect(response.type).toBe("runtime-message-parse-error")
  })
})
