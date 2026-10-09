import { describe, expect, it } from "bun:test"

import {
  StaleTranscriptError,
  loadCurrentTranscript
} from "@/sidepanel/lib/load-current-transcript"
import { FETCH_VIDEO_TRANSCRIPT } from "@/lib/runtime/messages"

const successResponse = {
  ok: true as const,
  type: "fetch-video-transcript" as const,
  tabId: 1,
  video: {
    platform: "youtube" as const,
    videoId: "video-a",
    contentKey: "youtube:video-a",
    title: "Video A",
    canonicalUrl: "https://www.youtube.com/watch?v=video-a"
  },
  transcript: {
    segments: [{ startSec: 0, endSec: 5, text: "Hello" }],
    source: "manual" as const,
    raw: { format: "vtt" as const, text: "WEBVTT" }
  }
}

describe("loadCurrentTranscript", () => {
  it("returns normalized transcript data for the captured identity", async () => {
    const result = await loadCurrentTranscript({
      requestedContentKey: "youtube:video-a",
      isCurrent: () => true,
      sendMessage: async () => successResponse
    })
    expect(result.transcript.segments[0].text).toBe("Hello")
    expect(result.transcript.raw?.text).toBe("WEBVTT")
  })

  it("rejects a stale response before callers can display it", async () => {
    await expect(loadCurrentTranscript({
      requestedContentKey: "youtube:video-b",
      isCurrent: () => true,
      sendMessage: async () => successResponse
    })).rejects.toBeInstanceOf(StaleTranscriptError)

    await expect(loadCurrentTranscript({
      requestedContentKey: "youtube:video-a",
      isCurrent: () => false,
      sendMessage: async () => successResponse
    })).rejects.toBeInstanceOf(StaleTranscriptError)
  })

  it("surfaces runtime transcript errors without starting analysis", async () => {
    await expect(loadCurrentTranscript({
      requestedContentKey: "youtube:video-a",
      isCurrent: () => true,
      sendMessage: async () => ({
        ok: false,
        type: FETCH_VIDEO_TRANSCRIPT,
        tabId: 1,
        error: "captions_unavailable"
      })
    })).rejects.toThrow("captions_unavailable")
  })
})
