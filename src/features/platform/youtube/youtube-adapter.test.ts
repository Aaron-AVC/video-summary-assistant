import { describe, expect, it, mock } from "bun:test"

import type { PlatformPageEnvironment } from "@/features/platform/adapter"
import { youtubeAdapter } from "@/features/platform/youtube/youtube-adapter"

const VIDEO_ID = "video123456"
const VIDEO_A = "videoAAAAA1"
const VIDEO_B = "videoBBBBB2"

describe("YouTubeAdapter contract", () => {
  it("handles supported desktop YouTube watch URLs", () => {
    expect(youtubeAdapter.canHandle(new URL(`https://www.youtube.com/watch?v=${VIDEO_ID}`))).toBe(true)
    expect(youtubeAdapter.canHandle(new URL(`https://youtube.com/watch?v=${VIDEO_ID}`))).toBe(true)
  })

  it("rejects home, missing-video, non-YouTube, Shorts, and unsupported mobile URLs", () => {
    for (const href of [
      "https://youtube.com/",
      "https://youtube.com/watch",
      `https://example.com/watch?v=${VIDEO_ID}`,
      `https://youtube.com/shorts/${VIDEO_ID}`,
      `https://m.youtube.com/watch?v=${VIDEO_ID}`,
    ]) {
      expect(youtubeAdapter.canHandle(new URL(href))).toBe(false)
      expect(youtubeAdapter.getVideoIdentity(new URL(href))).toBeNull()
    }
  })

  it("returns a platform-neutral stable identity", () => {
    expect(youtubeAdapter.getVideoIdentity(new URL(`https://youtube.com/watch?v=${VIDEO_ID}&list=ignored`))).toEqual({
      platform: "youtube",
      videoId: VIDEO_ID,
      contentKey: `youtube:${VIDEO_ID}`,
    })
  })

  it("reads normalized video info", async () => {
    const env = createEnvironment({
      html: createWatchHtml({ title: "Adapter video" }),
      title: "DOM title - YouTube",
      author: "Adapter channel",
      duration: 125.5,
    })

    expect(await youtubeAdapter.readVideoInfo(env)).toEqual({
      platform: "youtube",
      videoId: VIDEO_ID,
      contentKey: `youtube:${VIDEO_ID}`,
      title: "DOM title",
      author: "Adapter channel",
      durationSec: 125.5,
      thumbnailUrl: `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`,
      canonicalUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    })
  })

  it("returns normalized segments for a manual timedtext track", async () => {
    const fetchImpl = mock(async () => okText("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nManual text\n"))
    const transcript = await youtubeAdapter.getTranscript(createEnvironment({
      html: createWatchHtml({ tracks: [createTrack(false)] }),
      fetchImpl,
    }))

    expect(transcript.source).toBe("manual")
    expect(transcript.language).toBe("en")
    expect(transcript.segments).toEqual([{ startSec: 0, endSec: 2, text: "Manual text" }])
    expect(transcript.raw?.format).toBe("vtt")
  })

  it("maps an automatic timedtext track to auto", async () => {
    const transcript = await youtubeAdapter.getTranscript(createEnvironment({
      html: createWatchHtml({ tracks: [createTrack(true)] }),
      fetchImpl: async () => okText("WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nAuto text\n"),
    }))

    expect(transcript.source).toBe("auto")
    expect(transcript.segments[0]?.text).toBe("Auto text")
  })

  it("normalizes transcript-panel fallback output", async () => {
    const transcript = await youtubeAdapter.getTranscript(createEnvironment({
      html: createWatchHtml({ panel: true }),
      fetchImpl: async () => okText(JSON.stringify({
        actions: [{
          updateEngagementPanelAction: {
            content: {
              transcriptRenderer: {
                content: {
                  transcriptSearchPanelRenderer: {
                    body: {
                      transcriptSegmentListRenderer: {
                        initialSegments: [{
                          transcriptSegmentRenderer: {
                            startMs: "1000",
                            endMs: "2500",
                            snippet: { runs: [{ text: "Panel text" }] },
                          },
                        }],
                      },
                    },
                  },
                },
              },
            },
          },
        }],
      })),
    }))

    expect(transcript.source).toBe("unknown")
    expect(transcript.segments).toEqual([{ startSec: 1, endSec: 2.5, text: "Panel text" }])
  })

  it("continues to normalized DOM fallback after a rejected panel request", async () => {
    const transcript = await youtubeAdapter.getTranscript(createEnvironment({
      html: createWatchHtml({ panel: true }),
      rows: [{ timestamp: "0:05", text: "DOM text" }],
      fetchImpl: async () => { throw new Error("Panel rejected") },
    }))

    expect(transcript.source).toBe("unknown")
    expect(transcript.segments).toEqual([{ startSec: 5, endSec: 6, text: "DOM text" }])
  })

  it("does not return stale A transcript metadata for current video B", async () => {
    const fetchImpl = mock(async () => okText("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nStale A text\n"))
    const transcript = await youtubeAdapter.getTranscript(createEnvironment({
      location: `https://www.youtube.com/watch?v=${VIDEO_B}`,
      html: createWatchHtml({ videoId: VIDEO_A, tracks: [createTrack(false, VIDEO_A)] }),
      rows: [{ timestamp: "0:07", text: "Current B text" }],
      fetchImpl,
    }))

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(transcript.segments).toEqual([{ startSec: 7, endSec: 8, text: "Current B text" }])
    expect(transcript.segments.some((segment) => segment.text === "Stale A text")).toBe(false)
  })

  it("keeps transcript identity safe across an A to B SPA transition", async () => {
    const transcriptA = await youtubeAdapter.getTranscript(createEnvironment({
      location: `https://www.youtube.com/watch?v=${VIDEO_A}`,
      html: createWatchHtml({ videoId: VIDEO_A, tracks: [createTrack(false, VIDEO_A)] }),
      fetchImpl: async () => okText("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nTranscript A\n"),
    }))
    const fetchB = mock(async () => okText("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nStale A text\n"))
    const transcriptB = await youtubeAdapter.getTranscript(createEnvironment({
      location: `https://www.youtube.com/watch?v=${VIDEO_B}`,
      html: createWatchHtml({ videoId: VIDEO_A, tracks: [createTrack(false, VIDEO_A)] }),
      rows: [{ timestamp: "0:09", text: "Transcript B" }],
      fetchImpl: fetchB,
    }))

    expect(transcriptA.segments[0]?.text).toBe("Transcript A")
    expect(transcriptB.segments[0]?.text).toBe("Transcript B")
    expect(transcriptB.segments.some((segment) => segment.text === "Transcript A")).toBe(false)
    expect(transcriptB.segments.some((segment) => segment.text === "Stale A text")).toBe(false)
    expect(youtubeAdapter.getVideoIdentity(new URL(`https://www.youtube.com/watch?v=${VIDEO_B}`))).toEqual({
      platform: "youtube",
      videoId: VIDEO_B,
      contentKey: `youtube:${VIDEO_B}`,
    })
  })

  it("seeks normally and clamps negative seconds", () => {
    const video = { currentTime: 10 }
    const env = createEnvironment({ video })

    expect(youtubeAdapter.seek(env, 42.5)).toBe(true)
    expect(video.currentTime).toBe(42.5)
    expect(youtubeAdapter.seek(env, -12)).toBe(true)
    expect(video.currentTime).toBe(0)
  })

  it("rejects NaN and Infinity without writing currentTime", () => {
    const video = { currentTime: 10 }
    const env = createEnvironment({ video })

    expect(youtubeAdapter.seek(env, Number.NaN)).toBe(false)
    expect(video.currentTime).toBe(10)
    expect(youtubeAdapter.seek(env, Number.POSITIVE_INFINITY)).toBe(false)
    expect(video.currentTime).toBe(10)
  })

  it("reads a finite current playback time", () => {
    expect(youtubeAdapter.getCurrentTime(createEnvironment({ video: { currentTime: 18.75 } }))).toBe(18.75)
    expect(youtubeAdapter.getCurrentTime(createEnvironment({ video: { currentTime: Number.NaN } }))).toBe(0)
  })

  it("builds a canonical YouTube timestamp URL", () => {
    const identity = youtubeAdapter.getVideoIdentity(new URL(`https://youtube.com/watch?v=${VIDEO_ID}`))!
    expect(youtubeAdapter.buildTimestampUrl(identity, 42.9)).toBe(
      `https://www.youtube.com/watch?v=${VIDEO_ID}&t=42`,
    )
    expect(youtubeAdapter.buildTimestampUrl(identity, -10)).toBe(
      `https://www.youtube.com/watch?v=${VIDEO_ID}&t=0`,
    )
  })

  it("returns an explicit empty native-chapter boundary", async () => {
    await expect(youtubeAdapter.getNativeChapters(createEnvironment({}))).resolves.toEqual([])
  })
})

type EnvironmentOptions = {
  html?: string
  location?: string
  title?: string
  author?: string
  duration?: number
  video?: { currentTime: number }
  rows?: Array<{ timestamp: string; text: string }>
  fetchImpl?: PlatformPageEnvironment["fetch"]
}

function createEnvironment(options: EnvironmentOptions): PlatformPageEnvironment {
  const video = options.video ?? { currentTime: 0 }
  const rows = options.rows ?? []
  const rowElements = rows.map((row) => ({
    querySelector: (selector: string) => selector === ".segment-timestamp"
      ? { textContent: row.timestamp }
      : selector === ".segment-text"
        ? { textContent: row.text }
        : null,
  }))
  const transcriptRoot = {
    querySelector: () => rowElements[0] ?? null,
    querySelectorAll: () => rowElements,
  }
  const document = {
    title: options.title ?? "Adapter video - YouTube",
    documentElement: { outerHTML: options.html ?? createWatchHtml({}) },
    querySelector: (selector: string) => {
      if (selector === "video") return { ...video, duration: options.duration }
      if (selector.includes("#segments-container")) return transcriptRoot
      if (selector.includes("#owner") || selector.includes("ytd-channel-name")) {
        return options.author ? { textContent: options.author } : null
      }
      return null
    },
  } as unknown as Document

  if (options.video) {
    document.querySelector = ((selector: string) => {
      if (selector === "video") return Object.assign(options.video!, { duration: options.duration })
      if (selector.includes("#segments-container")) return transcriptRoot
      if (selector.includes("#owner") || selector.includes("ytd-channel-name")) {
        return options.author ? { textContent: options.author } : null
      }
      return null
    }) as typeof document.querySelector
  }

  return {
    document,
    location: new URL(options.location ?? `https://www.youtube.com/watch?v=${VIDEO_ID}`),
    fetch: options.fetchImpl ?? (async () => okText("")),
    diagnosticLoggingEnabled: false,
  }
}

function createTrack(auto: boolean, videoId = VIDEO_ID) {
  return {
    baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en${auto ? "&kind=asr" : ""}`,
    languageCode: "en",
    kind: auto ? "asr" : undefined,
    vssId: auto ? "a.en" : ".en",
    name: { simpleText: auto ? "English (auto-generated)" : "English" },
  }
}

function createWatchHtml({
  videoId = VIDEO_ID,
  title = "Adapter video",
  tracks = [],
  panel = false,
}: {
  videoId?: string
  title?: string
  tracks?: ReturnType<typeof createTrack>[]
  panel?: boolean
}) {
  return `<!doctype html><html><head><script>
    var ytInitialPlayerResponse = ${JSON.stringify({
      videoDetails: { videoId, title },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } },
      ...(panel ? { getTranscriptEndpoint: { params: "panel-params" } } : {}),
    })};
    var ytInitialData = {};
    var ytcfg = ${JSON.stringify(panel ? {
      INNERTUBE_API_KEY: "test-key",
      INNERTUBE_CONTEXT_CLIENT_NAME: 1,
      INNERTUBE_CONTEXT_CLIENT_VERSION: "2.20260310.01.00",
      VISITOR_DATA: "visitor-data",
      INNERTUBE_CONTEXT: { client: { clientName: "WEB", clientVersion: "2.20260310.01.00" } },
    } : {})};
  </script></head><body></body></html>`
}

function okText(text: string) {
  return { ok: true, status: 200, statusText: "OK", text: async () => text }
}
