import { describe, expect, it, mock } from "bun:test"

import type { PlatformPageEnvironment } from "@/features/platform/adapter"
import type { YouTubeLivePlayerState } from "@/features/platform/youtube/youtube-live-state"
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

  it("prefers matching live player title and author over an unrelated channel DOM node", async () => {
    const info = await youtubeAdapter.readVideoInfo(createEnvironment({
      title: "Document title - YouTube",
      watchTitle: "Current watch metadata title",
      unrelatedAuthor: "Mrs. GREEN APPLE",
      liveState: {
        videoId: VIDEO_ID,
        title: "Current player title",
        author: "投机实验室",
        captionTracks: [],
        subtitlesOn: null,
        currentCaptionTrack: null,
        timedtextCandidates: [],
      },
    }))

    expect(info.title).toBe("Current player title")
    expect(info.author).toBe("投机实验室")
  })

  it("ignores stale live metadata and uses only current-watch DOM authors", async () => {
    const info = await youtubeAdapter.readVideoInfo(createEnvironment({
      location: `https://www.youtube.com/watch?v=${VIDEO_B}`,
      title: "Current B title - YouTube",
      watchTitle: "Current B watch title",
      author: "Current B author",
      unrelatedAuthor: "Mrs. GREEN APPLE",
      liveState: {
        videoId: VIDEO_A,
        title: "Stale A title",
        author: "Stale A author",
        captionTracks: [],
        subtitlesOn: null,
        currentCaptionTrack: null,
        timedtextCandidates: [],
      },
    }))

    expect(info.videoId).toBe(VIDEO_B)
    expect(info.title).toBe("Current B watch title")
    expect(info.author).toBe("Current B author")
  })

  it("does not use an unrelated global channel node as the author fallback", async () => {
    const info = await youtubeAdapter.readVideoInfo(createEnvironment({
      title: "Current video - YouTube",
      unrelatedAuthor: "Mrs. GREEN APPLE",
    }))

    expect(info.author).toBeNull()
  })

  it("refreshes live player state for every transcript request", async () => {
    let liveReads = 0
    const env = createEnvironment({
      html: createWatchHtml({ tracks: [] }),
      rows: [{ timestamp: "0:08", text: "DOM fallback" }],
      readLivePlayerState: async () => {
        liveReads += 1
        return null
      },
    })

    await youtubeAdapter.getTranscript(env)
    await youtubeAdapter.getTranscript(env)

    expect(liveReads).toBe(2)
  })

  it("reloads the current caption resource before opening transcript fallbacks", async () => {
    const signedUrl = `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=zh-Hans&fmt=json3&signature=reload-secret&pot=reload-pot&potc=reload-potc`
    let refreshCalls = 0
    const fetchImpl = mock(async (input, init) => {
      expect(String(input)).toBe(signedUrl)
      expect(init?.credentials).toBe("include")
      return okText(JSON.stringify({
        events: [{ tStartMs: 0, dDurationMs: 1200, segs: [{ utf8: "Reloaded caption" }] }],
      }))
    })
    const transcript = await youtubeAdapter.getTranscript(createEnvironment({
      html: createWatchHtml({ tracks: [] }),
      rows: [],
      liveState: {
        videoId: VIDEO_ID,
        title: "Live title",
        author: "Live author",
        captionTracks: [{ languageCode: "zh-Hans", languageName: "中文（简体）" }],
        subtitlesOn: true,
        currentCaptionTrack: { languageCode: "zh-Hans", kind: null, vssId: ".zh-Hans" },
        timedtextCandidates: [],
      },
      refreshCaptionResource: async (videoId, previousStartTime) => {
        refreshCalls += 1
        expect(videoId).toBe(VIDEO_ID)
        expect(previousStartTime).toBe(0)
        return {
          url: signedUrl,
          videoId: VIDEO_ID,
          languageCode: "zh-Hans",
          format: "json3",
          startTime: 100,
        }
      },
      fetchImpl,
    }))

    expect(refreshCalls).toBe(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(transcript.segments[0]?.text).toBe("Reloaded caption")
  })

  it("keeps caption reload diagnostics URL-free", async () => {
    const signedUrl = `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=zh-Hans&fmt=json3&signature=reload-secret&pot=reload-pot&potc=reload-potc&expire=123`
    const storedLogs: unknown[] = []
    const previousChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome")
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        storage: {
          local: {
            get: async () => ({ "yt-summarizer.transcript-log": [] }),
            set: async (value: Record<string, unknown>) => {
              storedLogs.push(value["yt-summarizer.transcript-log"])
            },
          },
        },
      },
    })

    try {
      await youtubeAdapter.getTranscript(createEnvironment({
        html: createWatchHtml({ tracks: [] }),
        rows: [],
        liveState: {
          videoId: VIDEO_ID,
          title: "Live title",
          author: "Live author",
          captionTracks: [{ languageCode: "zh-Hans", languageName: "中文（简体）" }],
          subtitlesOn: true,
          currentCaptionTrack: { languageCode: "zh-Hans", kind: null, vssId: ".zh-Hans" },
          timedtextCandidates: [],
        },
        refreshCaptionResource: async () => ({
          url: signedUrl,
          videoId: VIDEO_ID,
          languageCode: "zh-Hans",
          format: "json3",
          startTime: 100,
        }),
        fetchImpl: async () => okText(JSON.stringify({
          events: [{ tStartMs: 0, dDurationMs: 1200, segs: [{ utf8: "Private reload" }] }],
        })),
        diagnosticLoggingEnabled: true,
      }))
      await new Promise((resolve) => setTimeout(resolve, 0))

      const persisted = JSON.stringify(storedLogs)
      expect(persisted).toContain("strategy=caption_reload")
      expect(persisted).toContain("refreshLatencyMs=")
      expect(persisted).not.toContain("https://www.youtube.com/api/timedtext")
      expect(persisted).not.toContain("reload-secret")
      expect(persisted).not.toContain("reload-pot")
      expect(persisted).not.toContain("expire=123")
    } finally {
      if (previousChrome) Object.defineProperty(globalThis, "chrome", previousChrome)
      else Reflect.deleteProperty(globalThis, "chrome")
    }
  })

  it("does not attempt caption reload when subtitles are off and continues fallback", async () => {
    let refreshCalls = 0
    const transcript = await youtubeAdapter.getTranscript(createEnvironment({
      html: createWatchHtml({ tracks: [] }),
      rows: [{ timestamp: "0:08", text: "DOM fallback" }],
      liveState: {
        videoId: VIDEO_ID,
        title: "Live title",
        author: "Live author",
        captionTracks: [{ languageCode: "zh-Hans", languageName: "中文（简体）" }],
        subtitlesOn: false,
        currentCaptionTrack: { languageCode: "zh-Hans", kind: null, vssId: ".zh-Hans" },
        timedtextCandidates: [],
      },
      refreshCaptionResource: async () => {
        refreshCalls += 1
        return null
      },
    }))

    expect(refreshCalls).toBe(0)
    expect(transcript.segments[0]?.text).toBe("DOM fallback")
  })

  it("uses the current caption language before an older English json3 entry", async () => {
    const zhUrl = `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=zh-Hans&fmt=vtt&signature=zh`
    const enUrl = `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=en&fmt=json3&signature=en`
    const requests: string[] = []
    const transcript = await youtubeAdapter.getTranscript(createEnvironment({
      html: createWatchHtml({ tracks: [] }),
      rows: [],
      liveState: {
        videoId: VIDEO_ID,
        title: "Live title",
        author: "Live author",
        captionTracks: [{ languageCode: "zh-Hans", languageName: "中文（简体）" }],
        subtitlesOn: true,
        currentCaptionTrack: { languageCode: "zh-Hans", kind: null, vssId: ".zh-Hans" },
        timedtextCandidates: [
          { url: enUrl, videoId: VIDEO_ID, languageCode: "en", format: "json3", startTime: 100 },
          { url: zhUrl, videoId: VIDEO_ID, languageCode: "zh-Hans", format: "vtt", startTime: 50 },
        ],
      },
      fetchImpl: async (input) => {
        requests.push(String(input))
        return requests[0] === zhUrl
          ? okText("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n中文字幕\n")
          : okText("")
      },
    }))

    expect(requests[0]).toBe(zhUrl)
    expect(transcript.segments[0]?.text).toBe("中文字幕")
  })

  it("continues to rendered DOM after one caption reload timeout", async () => {
    let refreshCalls = 0
    const transcript = await youtubeAdapter.getTranscript(createEnvironment({
      html: createWatchHtml({ tracks: [] }),
      rows: [{ timestamp: "0:09", text: "After timeout" }],
      liveState: {
        videoId: VIDEO_ID,
        title: "Live title",
        author: "Live author",
        captionTracks: [{ languageCode: "zh-Hans", languageName: "中文（简体）" }],
        subtitlesOn: true,
        currentCaptionTrack: { languageCode: "zh-Hans", kind: null, vssId: ".zh-Hans" },
        timedtextCandidates: [],
      },
      refreshCaptionResource: async () => {
        refreshCalls += 1
        return null
      },
    }))

    expect(refreshCalls).toBe(1)
    expect(transcript.segments[0]?.text).toBe("After timeout")
  })

  it("discards a caption reload result after a YouTube SPA identity change", async () => {
    let resolveRefresh!: (candidate: {
      url: string
      videoId: string
      languageCode: string
      format: string
      startTime: number
    } | null) => void
    let currentUrl = new URL(`https://www.youtube.com/watch?v=${VIDEO_A}`)
    const env = createEnvironment({
      location: currentUrl.href,
      html: createWatchHtml({ videoId: VIDEO_A, tracks: [] }),
      getCurrentUrl: () => currentUrl,
      liveState: {
        videoId: VIDEO_A,
        title: "A title",
        author: "A author",
        captionTracks: [{ languageCode: "zh-Hans", languageName: "中文（简体）" }],
        subtitlesOn: true,
        currentCaptionTrack: { languageCode: "zh-Hans", kind: null, vssId: ".zh-Hans" },
        timedtextCandidates: [],
      },
      refreshCaptionResource: () => new Promise((resolve) => { resolveRefresh = resolve }),
    })
    const transcriptPromise = youtubeAdapter.getTranscript(env)
    await new Promise((resolve) => setTimeout(resolve, 0))
    currentUrl = new URL(`https://www.youtube.com/watch?v=${VIDEO_B}`)
    resolveRefresh({
      url: `https://www.youtube.com/api/timedtext?v=${VIDEO_A}&lang=zh-Hans&fmt=json3&signature=stale`,
      videoId: VIDEO_A,
      languageCode: "zh-Hans",
      format: "json3",
      startTime: 100,
    })

    await expect(transcriptPromise).rejects.toThrow("video changed")
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

  it("fetches a current live JSON3 timedtext URL unchanged when panel and legacy tracks are unavailable", async () => {
    const signedUrl = `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=zh-Hans&fmt=json3&signature=secret-value&pot=pot-value&potc=potc-value&expire=123`
    const fetchImpl = mock(async (input, init) => {
      expect(input).toBe(signedUrl)
      expect(init?.credentials).toBe("include")
      return okText(JSON.stringify({
        events: [{ tStartMs: 0, dDurationMs: 1200, segs: [{ utf8: "Live caption" }] }],
      }))
    })
    const transcript = await youtubeAdapter.getTranscript(createEnvironment({
      html: createWatchHtml({ tracks: [] }),
      rows: [],
      liveState: {
        videoId: VIDEO_ID,
        title: "Live title",
        author: "投机实验室",
        captionTracks: [{ languageCode: "zh-Hans", languageName: "中文（简体）" }],
        subtitlesOn: true,
        currentCaptionTrack: { languageCode: "zh-Hans", kind: null, vssId: ".zh-Hans" },
        timedtextCandidates: [{
          url: signedUrl,
          videoId: VIDEO_ID,
          languageCode: "zh-Hans",
          format: "json3",
          startTime: 42,
        }],
      },
      fetchImpl,
    }))

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(transcript.segments).toEqual([{ startSec: 0, endSec: 1.2, text: "Live caption" }])
    expect(transcript.raw?.sourceUrl).toBeNull()
  })

  it("does not persist a signed live URL in transcript output or diagnostic logs", async () => {
    const signedUrl = `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=en&fmt=json3&signature=SECRET_TEST_VALUE&pot=SECRET_TEST_TOKEN&potc=SECRET_TEST_POTC`
    const storedLogs: unknown[] = []
    const previousChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome")
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        storage: {
          local: {
            get: async () => ({ "yt-summarizer.transcript-log": [] }),
            set: async (value: Record<string, unknown>) => {
              storedLogs.push(value["yt-summarizer.transcript-log"])
            },
          },
        },
      },
    })

    try {
      const transcript = await youtubeAdapter.getTranscript(createEnvironment({
        html: createWatchHtml({ tracks: [] }),
        liveState: {
          videoId: VIDEO_ID,
          title: "Live title",
          author: "Live author",
          captionTracks: [{ languageCode: "en", languageName: "English" }],
          subtitlesOn: null,
          currentCaptionTrack: null,
          timedtextCandidates: [{
            url: signedUrl,
            videoId: VIDEO_ID,
            languageCode: "en",
            format: "json3",
            startTime: 42,
          }],
        },
        fetchImpl: async () => okText(JSON.stringify({
          events: [{ tStartMs: 0, dDurationMs: 1200, segs: [{ utf8: "Private URL test" }] }],
        })),
        diagnosticLoggingEnabled: true,
      }))
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(transcript.raw?.sourceUrl).toBeNull()
      const persisted = JSON.stringify(storedLogs)
      expect(persisted).toContain("strategy=live_timedtext")
      expect(persisted).not.toContain("https://www.youtube.com/api/timedtext")
      expect(persisted).not.toContain("SECRET_TEST_VALUE")
      expect(persisted).not.toContain("SECRET_TEST_TOKEN")
      expect(persisted).not.toContain("SECRET_TEST_POTC")
    } finally {
      if (previousChrome) Object.defineProperty(globalThis, "chrome", previousChrome)
      else Reflect.deleteProperty(globalThis, "chrome")
    }
  })

  it("continues to legacy tracks when the live timedtext request fails", async () => {
    const liveUrl = `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=en&fmt=json3&signature=secret-value`
    const legacyUrl = `${createTrack(false).baseUrl}&signature=SECRET_TEST_VALUE&pot=SECRET_TEST_TOKEN`
    const requests: string[] = []
    const transcript = await youtubeAdapter.getTranscript(createEnvironment({
      html: createWatchHtml({ tracks: [{ ...createTrack(false), baseUrl: legacyUrl }] }),
      liveState: {
        videoId: VIDEO_ID,
        title: "Live title",
        author: "Live author",
        captionTracks: [],
        subtitlesOn: null,
        currentCaptionTrack: null,
        timedtextCandidates: [{
          url: liveUrl,
          videoId: VIDEO_ID,
          languageCode: "en",
          format: "json3",
          startTime: 42,
        }],
      },
      fetchImpl: async (input) => {
        const requestedUrl = String(input)
        requests.push(requestedUrl)
        if (requestedUrl === liveUrl) {
          return { ok: false, status: 403, statusText: "Forbidden", text: async () => "" }
        }
        return requestedUrl.includes("fmt=vtt")
          ? okText("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nLegacy fallback\n")
          : okText("")
      },
    }))

    expect(requests).toEqual([liveUrl, legacyUrl, `${legacyUrl}&fmt=vtt`])
    expect(transcript.segments[0]?.text).toBe("Legacy fallback")
    expect(transcript.raw?.sourceUrl).toBeNull()
    expect(transcript.raw?.text).toContain("Legacy fallback")
    expect(JSON.stringify(transcript)).not.toContain("SECRET_TEST_VALUE")
    expect(JSON.stringify(transcript)).not.toContain("SECRET_TEST_TOKEN")
  })

  it("uses rendered DOM without activating captions when Resource Timing has no candidate", async () => {
    const fetchImpl = mock(async () => okText(""))
    const transcript = await youtubeAdapter.getTranscript(createEnvironment({
      html: createWatchHtml({ tracks: [] }),
      rows: [{ timestamp: "0:08", text: "DOM fallback" }],
      liveState: {
        videoId: VIDEO_ID,
        title: "Live title",
        author: "Live author",
        captionTracks: [{ languageCode: "en", languageName: "English" }],
        subtitlesOn: null,
        currentCaptionTrack: null,
        timedtextCandidates: [],
      },
      fetchImpl,
    }))

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(transcript.segments[0]?.text).toBe("DOM fallback")
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

  it("discards an asynchronously returned A live state after the page changes to B", async () => {
    let resolveLiveState!: (state: YouTubeLivePlayerState | null) => void
    let currentUrl = new URL(`https://www.youtube.com/watch?v=${VIDEO_A}`)
    const fetchImpl = mock(async () => okText("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nStale A\n"))
    const env = createEnvironment({
      location: currentUrl.href,
      html: createWatchHtml({ videoId: VIDEO_A }),
      fetchImpl,
      getCurrentUrl: () => currentUrl,
      readLivePlayerState: () => new Promise((resolve) => { resolveLiveState = resolve }),
    })
    const transcriptPromise = youtubeAdapter.getTranscript(env)
    currentUrl = new URL(`https://www.youtube.com/watch?v=${VIDEO_B}`)
    resolveLiveState({
      videoId: VIDEO_A,
      title: "A title",
      author: "A author",
      captionTracks: [],
      subtitlesOn: null,
      currentCaptionTrack: null,
      timedtextCandidates: [{
        url: `https://www.youtube.com/api/timedtext?v=${VIDEO_A}&lang=en&fmt=json3&signature=secret-value`,
        videoId: VIDEO_A,
        languageCode: "en",
        format: "json3",
        startTime: 99,
      }],
    })

    await expect(transcriptPromise).rejects.toThrow("video changed")
    expect(fetchImpl).not.toHaveBeenCalled()
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
  watchTitle?: string
  author?: string
  unrelatedAuthor?: string
  duration?: number
  video?: { currentTime: number }
  rows?: Array<{ timestamp: string; text: string }>
  fetchImpl?: PlatformPageEnvironment["fetch"]
  liveState?: YouTubeLivePlayerState | null
  readLivePlayerState?: PlatformPageEnvironment["readYouTubeLivePlayerState"]
  refreshCaptionResource?: PlatformPageEnvironment["refreshYouTubeCaptionResource"]
  getCurrentUrl?: PlatformPageEnvironment["getCurrentUrl"]
  diagnosticLoggingEnabled?: boolean
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
    querySelectorAll: (selector: string) => selector === "#segments-container" ? [transcriptRoot] : [],
    querySelector: (selector: string) => {
      if (selector === "video") return { ...video, duration: options.duration }
      if (selector === "ytd-watch-metadata h1") {
        return options.watchTitle ? { textContent: options.watchTitle } : null
      }
      if (selector === "ytd-watch-metadata #owner a.yt-simple-endpoint"
        || selector === "ytd-watch-metadata ytd-channel-name a") {
        return options.author ? { textContent: options.author } : null
      }
      if (selector === "ytd-channel-name a") {
        return options.unrelatedAuthor ? { textContent: options.unrelatedAuthor } : null
      }
      if (selector.includes("#segments-container")) return transcriptRoot
      return null
    },
  } as unknown as Document

  if (options.video) {
    document.querySelector = ((selector: string) => {
      if (selector === "video") return Object.assign(options.video!, { duration: options.duration })
      if (selector === "ytd-watch-metadata h1") {
        return options.watchTitle ? { textContent: options.watchTitle } : null
      }
      if (selector === "ytd-watch-metadata #owner a.yt-simple-endpoint"
        || selector === "ytd-watch-metadata ytd-channel-name a") {
        return options.author ? { textContent: options.author } : null
      }
      if (selector === "ytd-channel-name a") {
        return options.unrelatedAuthor ? { textContent: options.unrelatedAuthor } : null
      }
      if (selector.includes("#segments-container")) return transcriptRoot
      return null
    }) as typeof document.querySelector
  }

  return {
    document,
    location: new URL(options.location ?? `https://www.youtube.com/watch?v=${VIDEO_ID}`),
    fetch: options.fetchImpl ?? (async () => okText("")),
    ...(options.getCurrentUrl ? { getCurrentUrl: options.getCurrentUrl } : {}),
    ...(options.readLivePlayerState
      ? { readYouTubeLivePlayerState: options.readLivePlayerState }
      : options.liveState !== undefined
        ? { readYouTubeLivePlayerState: async () => options.liveState ?? null }
        : {}),
    ...(options.refreshCaptionResource
      ? { refreshYouTubeCaptionResource: options.refreshCaptionResource }
      : {}),
    diagnosticLoggingEnabled: options.diagnosticLoggingEnabled ?? false,
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
