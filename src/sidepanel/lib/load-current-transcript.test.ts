import { describe, expect, it } from "bun:test"

import {
  StaleTranscriptError,
  loadCurrentTranscript,
  resolveCurrentTranscript
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

  it("sends an explicit source tab id and accepts the response while the active tab differs", async () => {
    let request: unknown
    const result = await loadCurrentTranscript({
      requestedContentKey: "youtube:video-a",
      tabId: 11,
      isCurrent: () => true,
      sendMessage: async () => {
        request = { tabId: 11 }
        return { ...successResponse, tabId: 11 }
      }
    })
    expect(request).toEqual({ tabId: 11 })
    expect(result.video.contentKey).toBe("youtube:video-a")
  })

  it("rejects a transcript returned from a different source tab", async () => {
    await expect(loadCurrentTranscript({
      requestedContentKey: "youtube:video-a",
      tabId: 12,
      isCurrent: () => true,
      sendMessage: async () => successResponse
    })).rejects.toBeInstanceOf(StaleTranscriptError)
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

describe("resolveCurrentTranscript", () => {
  const result = {
    video: {
      platform: "youtube" as const,
      videoId: "video-1",
      contentKey: "youtube:video-1",
      title: "Video",
      canonicalUrl: "https://www.youtube.com/watch?v=video-1"
    },
    transcript: {
      segments: [{ startSec: 0, endSec: 1, text: "cached" }],
      source: "unknown" as const
    }
  }

  it("uses session or IndexedDB candidates before remote fetch", async () => {
    let remoteCalls = 0
    const session = await resolveCurrentTranscript({
      requestedContentKey: "youtube:video-1",
      isCurrent: () => true,
      sessionResult: result,
      loadRemote: async () => { remoteCalls += 1; return result }
    })
    expect(session).toBe(result)
    expect(remoteCalls).toBe(0)

    const cached = await resolveCurrentTranscript({
      requestedContentKey: "youtube:video-1",
      isCurrent: () => true,
      loadCached: async () => result,
      loadRemote: async () => { remoteCalls += 1; return result }
    })
    expect(cached).toBe(result)
    expect(remoteCalls).toBe(0)
  })

  it("forces a remote reload when explicitly requested", async () => {
    let remoteCalls = 0
    await resolveCurrentTranscript({
      requestedContentKey: "youtube:video-1",
      isCurrent: () => true,
      forceReload: true,
      sessionResult: result,
      loadCached: async () => result,
      loadRemote: async () => { remoteCalls += 1; return result }
    })
    expect(remoteCalls).toBe(1)
  })
})
