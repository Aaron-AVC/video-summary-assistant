import { afterEach, describe, expect, it, mock } from "bun:test"

import { FETCH_VIDEO_TRANSCRIPT } from "@/lib/runtime/messages"
import type { VideoInfo, VideoTranscript } from "@/features/platform/types"
import { fetchVideoTranscript } from "./youtube-watch"

type TranscriptResponse = Awaited<ReturnType<typeof fetchVideoTranscript>>
type TranscriptSuccessResponse = {
  ok: true
  type: typeof FETCH_VIDEO_TRANSCRIPT
  video: VideoInfo
  transcript: VideoTranscript
}
type TranscriptFailureResponse = {
  ok: false
  type: typeof FETCH_VIDEO_TRANSCRIPT
  error: string
}

const originalFetch = globalThis.fetch
const originalChrome = globalThis.chrome

describe("fetchVideoTranscript fallback isolation", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
    globalThis.chrome = originalChrome
  })

  it("continues to DOM fallback after a rejected panel fetch", async () => {
    const fetchImpl = mock(async () => {
      throw new Error("Panel request rejected")
    })
    globalThis.fetch = fetchImpl as unknown as typeof fetch
    installChromeRuntime()

    const response = await fetchVideoTranscript(
      createTranscriptDocument([{ timestamp: "0:00", text: "DOM text" }]),
      createLocation("https://www.youtube.com/watch?v=video123456"),
    )
    const success = expectTranscriptSuccess(response)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(success.transcript.raw?.text).toContain("DOM text")
    expect(success.transcript.source).toBe("unknown")
    expect(success.transcript.segments).toEqual([{ startSec: 0, endSec: 1, text: "DOM text" }])
  })

  it("does not invoke a native helper after panel rejection and DOM failure", async () => {
    const fetchImpl = mock(async () => {
      throw new Error("Panel request rejected")
    })
    const sendMessage = mock(async () => ({
      ok: false,
      type: FETCH_VIDEO_TRANSCRIPT,
      error: "Native helper should not be called",
      tabId: null,
    }))
    globalThis.fetch = fetchImpl as unknown as typeof fetch
    installChromeRuntime(sendMessage)

    const response = await fetchVideoTranscript(
      createTranscriptDocument([{ timestamp: "bad", text: "Ignored text" }]),
      createLocation("https://www.youtube.com/watch?v=video123456"),
    )
    const failure = expectTranscriptFailure(response)

    expect(sendMessage).toHaveBeenCalledTimes(0)
    expect(failure.error).toContain("No caption tracks found.")
    expect(failure.error).toContain("Panel: fetchTranscriptPanel failed: Panel request rejected")
    expect(failure.error).toContain("DOM: The rendered YouTube transcript panel contained no usable transcript rows.")
    expect(failure.error).not.toContain("Helper")
  })

  it("returns details from each failed fallback after panel rejection", async () => {
    const fetchImpl = mock(async () => {
      throw new Error("Panel request rejected")
    })
    const sendMessage = mock(async () => {
      throw new Error("Native helper should not be called")
    })
    globalThis.fetch = fetchImpl as unknown as typeof fetch
    installChromeRuntime(sendMessage)

    const response = await fetchVideoTranscript(
      createTranscriptDocument([{ timestamp: "bad", text: "Ignored text" }]),
      createLocation("https://www.youtube.com/watch?v=video123456"),
    )
    const failure = expectTranscriptFailure(response)

    expect(failure.error).toContain("No caption tracks found.")
    expect(failure.error).toContain("Panel: fetchTranscriptPanel failed: Panel request rejected")
    expect(failure.error).toContain("DOM: The rendered YouTube transcript panel contained no usable transcript rows.")
    expect(sendMessage).toHaveBeenCalledTimes(0)
    expect(failure.error).not.toContain("Helper")
  })
})

function expectTranscriptSuccess(response: TranscriptResponse): TranscriptSuccessResponse {
  expect(response.ok).toBe(true)
  expect(response.type).toBe(FETCH_VIDEO_TRANSCRIPT)

  if (!response.ok || response.type !== FETCH_VIDEO_TRANSCRIPT) {
    throw new Error("Expected a transcript success response")
  }

  return response
}

function expectTranscriptFailure(response: TranscriptResponse): TranscriptFailureResponse {
  expect(response.ok).toBe(false)
  expect(response.type).toBe(FETCH_VIDEO_TRANSCRIPT)

  if (response.ok || response.type !== FETCH_VIDEO_TRANSCRIPT) {
    throw new Error("Expected a transcript failure response")
  }

  return response as unknown as TranscriptFailureResponse
}

function createTranscriptDocument(rows: Array<{ timestamp: string; text: string }>): Document {
  const elements = rows.map((row) => ({
    querySelector: (selector: string) => {
      if (selector === ".segment-timestamp") {
        return { textContent: row.timestamp }
      }

      if (selector === ".segment-text") {
        return { textContent: row.text }
      }

      return null
    },
  }))
  const root = {
    querySelector: (selector: string) => (
      selector === "ytd-transcript-segment-renderer"
        ? elements[0] ?? null
        : null
    ),
    querySelectorAll: () => elements,
  }

  return {
    title: "Video 1 - YouTube",
    documentElement: {
      outerHTML: createWatchHtml(),
    },
    querySelector: (selector: string) => (
      selector.includes("#segments-container")
        ? root
        : null
    ),
  } as Document
}

function createWatchHtml(): string {
  return `<!doctype html>
    <html>
      <head>
        <script>
          var ytInitialPlayerResponse = {
            "videoDetails": {
              "videoId": "video123456",
              "title": "Video 1"
            },
            "captions": {
              "playerCaptionsTracklistRenderer": {
                "captionTracks": []
              }
            },
            "getTranscriptEndpoint": {
              "params": "transcript-params"
            }
          };
          var ytInitialData = {};
          var ytcfg = {
            "INNERTUBE_API_KEY": "test-key",
            "INNERTUBE_CONTEXT_CLIENT_NAME": 1,
            "INNERTUBE_CONTEXT_CLIENT_VERSION": "2.20260310.01.00",
            "VISITOR_DATA": "visitor-data",
            "INNERTUBE_CONTEXT": {
              "client": {
                "clientName": "WEB",
                "clientVersion": "2.20260310.01.00",
                "visitorData": "visitor-data"
              }
            }
          };
        </script>
      </head>
      <body></body>
    </html>`
}

function createLocation(href: string): Location {
  return { href } as Location
}

function installChromeRuntime(sendMessage: unknown = mock(async () => {
  throw new Error("Native helper should not be called")
})) {
  globalThis.chrome = {
    runtime: {
      sendMessage,
    },
    storage: {
      local: {
        get: async () => ({}),
      },
    },
  } as unknown as typeof chrome
}
