import { describe, expect, it } from "bun:test"

import {
  normalizeYouTubeLivePlayerState,
  refreshYouTubeCaptionResourceInMainWorld,
  readYouTubeLivePlayerStateInMainWorld,
  selectYouTubeTimedtextCandidate,
  describeYouTubeLiveTimedtextStrategy,
} from "@/features/platform/youtube/youtube-live-state"

const VIDEO_ID = "video123456"
const SIGNED = "signature=secret-value&pot=pot-value&potc=potc-value&expire=123"

describe("YouTube live player state", () => {
  it("accepts matching live metadata and only current-video timedtext candidates", () => {
    const state = normalizeYouTubeLivePlayerState({
      videoId: VIDEO_ID,
      title: "Live title",
      author: "投机实验室",
      captionTracks: [{ languageCode: "zh-Hans", languageName: "中文（简体）", vss_id: ".zh-Hans" }],
      subtitlesOn: true,
      currentCaptionTrack: { languageCode: "zh-Hans", kind: null, vssId: ".zh-Hans" },
      timedtextCandidates: [
        makeCandidate(VIDEO_ID, "zh-Hans", "json3", 12),
        makeCandidate("videoAAAAA1", "en", "json3", 13),
      ],
    }, VIDEO_ID)

    expect(state?.videoId).toBe(VIDEO_ID)
    expect(state?.title).toBe("Live title")
    expect(state?.author).toBe("投机实验室")
    expect(state?.subtitlesOn).toBe(true)
    expect(state?.currentCaptionTrack).toEqual({ languageCode: "zh-Hans", kind: null, vssId: ".zh-Hans" })
    expect(state?.captionTracks).toEqual([{
      languageCode: "zh-Hans",
      languageName: "中文（简体）",
      displayName: null,
      kind: null,
      vssId: ".zh-Hans",
    }])
    expect(state?.timedtextCandidates).toHaveLength(1)
    expect(state?.timedtextCandidates[0]?.url).toContain(SIGNED)
  })

  it("rejects live state whose player videoId does not match the page", () => {
    expect(normalizeYouTubeLivePlayerState({
      videoId: "videoAAAAA1",
      title: "Stale A",
      author: "Stale author",
      captionTracks: [],
      timedtextCandidates: [makeCandidate("videoAAAAA1", "en", "json3", 1)],
    }, VIDEO_ID)).toBeNull()
  })

  it("rejects malformed, non-YouTube, non-HTTPS, wrong-path, and wrong-video resource URLs", () => {
    const state = normalizeYouTubeLivePlayerState({
      videoId: VIDEO_ID,
      captionTracks: [],
      timedtextCandidates: [
        { ...makeCandidate(VIDEO_ID, "en", "json3", 1), url: "%%%" },
        { ...makeCandidate(VIDEO_ID, "en", "json3", 2), url: `https://example.com/api/timedtext?v=${VIDEO_ID}&lang=en&fmt=json3` },
        { ...makeCandidate(VIDEO_ID, "en", "json3", 3), url: `http://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=en&fmt=json3` },
        { ...makeCandidate(VIDEO_ID, "en", "json3", 4), url: `https://www.youtube.com/youtubei/v1/player?v=${VIDEO_ID}&lang=en&fmt=json3` },
        { ...makeCandidate("videoAAAAA1", "en", "json3", 5) },
        { ...makeCandidate(VIDEO_ID, "", "json3", 6) },
      ],
    }, VIDEO_ID)

    expect(state?.timedtextCandidates).toEqual([])
  })

  it("prefers the current caption language, then json3, then the newest entry", () => {
    const candidates = [
      makeCandidate(VIDEO_ID, "fr", "json3", 100),
      makeCandidate(VIDEO_ID, "en", "vtt", 500),
      makeCandidate(VIDEO_ID, "en", "json3", 200),
      makeCandidate(VIDEO_ID, "en", "json3", 300),
    ]

    expect(selectYouTubeTimedtextCandidate(candidates, "en")?.startTime).toBe(300)
    expect(selectYouTubeTimedtextCandidate([
      makeCandidate(VIDEO_ID, "en", "json3", 100),
      makeCandidate(VIDEO_ID, "zh-Hans", "vtt", 50),
    ], "zh-Hans")?.languageCode).toBe("zh-Hans")
  })

  it("reads only the bounded current MAIN-world player state and resource entries", () => {
    withMainWorld({
      href: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      player: {
        getVideoData: () => ({ video_id: VIDEO_ID, title: "Live title", author: "投机实验室" }),
        isSubtitlesOn: () => true,
        getOption: (_category: string, option: string) => option === "track"
          ? { languageCode: "zh-Hans", kind: null, vss_id: ".zh-Hans" }
          : [{ languageCode: "zh-Hans", languageName: "中文（简体）", displayName: "中文（简体）", vss_id: ".zh-Hans" }],
      },
      resources: [{
        name: `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=zh-Hans&fmt=json3&${SIGNED}`,
        startTime: 42,
      }],
    }, () => {
      expect(readYouTubeLivePlayerStateInMainWorld(VIDEO_ID)).toMatchObject({
        videoId: VIDEO_ID,
        title: "Live title",
        author: "投机实验室",
        captionTracks: [{ languageCode: "zh-Hans", languageName: "中文（简体）" }],
        subtitlesOn: true,
        currentCaptionTrack: { languageCode: "zh-Hans", kind: null, vssId: ".zh-Hans" },
      })
    })
  })

  it("reloads captions and returns only a new current-language timedtext entry", async () => {
    const resources = [{
      name: `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=zh-Hans&fmt=json3&signature=old`,
      startTime: 10,
    }]
    let reloadCalls = 0

    await withMainWorldAsync({
      href: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      player: {
        getVideoData: () => ({ video_id: VIDEO_ID }),
        isSubtitlesOn: () => true,
        getOption: (_category: string, option: string) => option === "track"
          ? { languageCode: "zh-Hans", kind: null, vss_id: ".zh-Hans" }
          : [],
        setOption: (category: string, option: string, value: unknown) => {
          expect([category, option, value]).toEqual(["captions", "reload", true])
          reloadCalls += 1
          resources.push({
            name: `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=zh-Hans&fmt=json3&signature=new`,
            startTime: 100,
          })
        },
      },
      resources,
    }, async () => {
      await expect(refreshYouTubeCaptionResourceInMainWorld(VIDEO_ID, 10)).resolves.toMatchObject({
        languageCode: "zh-Hans",
        format: "json3",
        startTime: 100,
      })
    })

    expect(reloadCalls).toBe(1)
  })

  it("does not mutate captions when subtitles are off", async () => {
    let reloadCalls = 0

    await withMainWorldAsync({
      href: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      player: {
        getVideoData: () => ({ video_id: VIDEO_ID }),
        isSubtitlesOn: () => false,
        getOption: () => ({ languageCode: "zh-Hans" }),
        setOption: () => { reloadCalls += 1 },
      },
      resources: [],
    }, async () => {
      await expect(refreshYouTubeCaptionResourceInMainWorld(VIDEO_ID, 0)).resolves.toBeNull()
    })

    expect(reloadCalls).toBe(0)
  })

  it("returns null after the bounded reload wait when no new entry appears", async () => {
    const originalNow = Date.now
    const originalSetTimeout = globalThis.setTimeout
    let now = 0
    Date.now = () => {
      now += 100
      return now
    }
    Object.defineProperty(globalThis, "setTimeout", {
      configurable: true,
      value: (callback: () => void) => {
        callback()
        return 0
      },
    })

    try {
      await withMainWorldAsync({
        href: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
        player: {
          getVideoData: () => ({ video_id: VIDEO_ID }),
          isSubtitlesOn: () => true,
          getOption: (_category: string, option: string) => option === "track"
            ? { languageCode: "zh-Hans" }
            : [],
          setOption: () => undefined,
        },
        resources: [],
      }, async () => {
        await expect(refreshYouTubeCaptionResourceInMainWorld(VIDEO_ID, 0)).resolves.toBeNull()
      })
    } finally {
      Date.now = originalNow
      Object.defineProperty(globalThis, "setTimeout", {
        configurable: true,
        value: originalSetTimeout,
      })
    }
  })

  it("does not return MAIN-world metadata after the URL changes to another video", () => {
    withMainWorld({
      href: "https://www.youtube.com/watch?v=videoBBBBB2",
      player: { getVideoData: () => ({ video_id: VIDEO_ID, title: "A", author: "A" }) },
      resources: [{
        name: `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=en&fmt=json3`,
        startTime: 20,
      }],
    }, () => {
      expect(readYouTubeLivePlayerStateInMainWorld(VIDEO_ID)).toBeNull()
    })
  })

  it("records only approved timedtext diagnostic fields, never the signed URL", () => {
    const candidate = makeCandidate(VIDEO_ID, "zh-Hans", "json3", 1)
    const details = describeYouTubeLiveTimedtextStrategy(candidate, VIDEO_ID)

    expect(details).toBe(`strategy=live_timedtext videoId=${VIDEO_ID} lang=zh-Hans fmt=json3 hasPot=true hasPotc=true`)
    expect(details).not.toContain("https://")
    expect(details).not.toContain("secret-value")
    expect(details).not.toContain("pot-value")
  })
})

function makeCandidate(videoId: string, languageCode: string, format: string, startTime: number) {
  return {
    url: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${languageCode}&fmt=${format}&${SIGNED}`,
    videoId,
    languageCode,
    format,
    startTime,
  }
}

function withMainWorld<T>(
  options: {
    href: string
    player: Record<string, unknown>
    resources: Array<{ name: string; startTime: number }>
  },
  run: () => T,
): T {
  const keys = ["location", "document", "performance"] as const
  const previous = new Map<string, PropertyDescriptor | undefined>(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  )
  Object.defineProperty(globalThis, "location", { configurable: true, value: { href: options.href } })
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { getElementById: () => options.player },
  })
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: { getEntriesByType: () => options.resources },
  })

  try {
    return run()
  } finally {
    for (const key of keys) {
      const descriptor = previous.get(key)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}

async function withMainWorldAsync<T>(
  options: {
    href: string
    player: Record<string, unknown>
    resources: Array<{ name: string; startTime: number }>
  },
  run: () => Promise<T>,
): Promise<T> {
  const keys = ["location", "document", "performance"] as const
  const previous = new Map<string, PropertyDescriptor | undefined>(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  )
  Object.defineProperty(globalThis, "location", { configurable: true, value: { href: options.href } })
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { getElementById: () => options.player },
  })
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: { getEntriesByType: () => options.resources },
  })

  try {
    return await run()
  } finally {
    for (const key of keys) {
      const descriptor = previous.get(key)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}
