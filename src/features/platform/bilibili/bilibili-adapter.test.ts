import { describe, expect, it, mock } from "bun:test"

import type { PlatformPageEnvironment } from "@/features/platform/adapter"
import { bilibiliAdapter, BilibiliAdapterError } from "@/features/platform/bilibili/bilibili-adapter"
import type { FetchLike } from "@/features/transcript/lib/transcript-schema"

const BVID = "BV1xx411c7mD"
const P1_URL = `https://www.bilibili.com/video/${BVID}/`
const P2_URL = `${P1_URL}?p=2`

const metadata = {
  code: 0,
  data: {
    aid: 9001,
    bvid: BVID,
    title: "Collection title",
    owner: { name: "Uploader" },
    duration: 999,
    pic: "https://i0.hdslb.com/bfs/archive/cover.jpg",
    cid: 111,
    pages: [
      { cid: 111, page: 1, part: "Part one", duration: 120 },
      { cid: 222, page: 2, part: "Part two", duration: 300 },
    ],
  },
}

describe("BilibiliAdapter metadata and multi-part resolution", () => {
  it("reads metadata and resolves the current part's cid and duration", async () => {
    const fetchImpl = jsonFetch([metadata])
    const env = createEnvironment(P2_URL, fetchImpl)

    await expect(bilibiliAdapter.readVideoInfo(env)).resolves.toEqual({
      platform: "bilibili",
      videoId: BVID,
      partId: "2",
      contentKey: `bilibili:${BVID}:p:2`,
      title: "Collection title — Part two",
      author: "Uploader",
      durationSec: 300,
      thumbnailUrl: "https://i0.hdslb.com/bfs/archive/cover.jpg",
      canonicalUrl: P2_URL,
    })
    expect(String((fetchImpl as ReturnType<typeof mock>).mock.calls[0]?.[0]))
      .toContain("/x/web-interface/view?bvid=")
  })

  it("resolves P1 to its page entry instead of the collection cid shortcut", async () => {
    const fetchImpl = mock(async (input: string | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/view")) return jsonResponse(metadata)
      if (url.pathname.endsWith("/v2")) return jsonResponse({
        code: 0,
        data: { subtitle: { subtitles: [track(1, "zh-CN", "manual", "//aisubtitle.hdslb.com/bfs/subtitle/p1.json")] } },
      })
      return jsonResponse({ body: [{ from: 1, to: 2, content: "P1 caption" }] })
    })
    const transcript = await bilibiliAdapter.getTranscript(createEnvironment(P1_URL, fetchImpl))

    const playerRequest = fetchImpl.mock.calls.map(([input]) => new URL(String(input)))
      .find((url) => url.pathname.endsWith("/wbi/v2"))
    expect(playerRequest?.searchParams.get("cid")).toBe("111")
    expect(transcript.segments[0]?.text).toBe("P1 caption")
  })

  it("uses P2 cid for P2 subtitles and exposes no Bilibili raw track fields", async () => {
    const fetchImpl = mock(async (input: string | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/view")) return jsonResponse(metadata)
      if (url.pathname.endsWith("/wbi/v2")) return jsonResponse({
        code: 0,
        data: { subtitle: { subtitles: [track(2, "zh-CN", "manual", "https://aisubtitle.hdslb.com/bfs/subtitle/p2.json")] } },
      })
      return jsonResponse({ body: [{ from: 1, to: 2, content: "P2 caption" }] })
    })
    const transcript = await bilibiliAdapter.getTranscript(createEnvironment(P2_URL, fetchImpl))
    const playerRequest = fetchImpl.mock.calls.map(([input]) => new URL(String(input)))
      .find((url) => url.pathname.endsWith("/wbi/v2"))

    expect(playerRequest?.searchParams.get("aid")).toBe("9001")
    expect(playerRequest?.searchParams.get("cid")).toBe("222")
    expect(playerRequest?.searchParams.get("bvid")).toBe(BVID)
    expect(transcript.segments).toEqual([{ startSec: 1, endSec: 2, text: "P2 caption" }])
    expect(transcript).not.toHaveProperty("subtitle_url")
    expect(transcript).not.toHaveProperty("cid")
  })

  it("fails out-of-range parts without falling back to data.cid or P1", async () => {
    const fetchImpl = jsonFetch([metadata])
    await expect(bilibiliAdapter.readVideoInfo(
      createEnvironment(`${P1_URL}?p=3`, fetchImpl),
    )).rejects.toMatchObject({ code: "current_part_cid_missing" })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("shares the resolved page metadata when info and transcript run together", async () => {
    const fetchImpl = mock(async (input: string | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/view")) return jsonResponse(metadata)
      if (url.pathname.endsWith("/wbi/v2")) return jsonResponse({
        code: 0,
        data: { subtitle: { subtitles: [track(1, "en", "manual", "https://aisubtitle.hdslb.com/bfs/subtitle/a.json")] } },
      })
      return jsonResponse({ body: [{ from: 0, to: 1, content: "Caption" }] })
    })
    const env = createEnvironment(P2_URL, fetchImpl)

    const [video, transcript] = await Promise.all([
      bilibiliAdapter.readVideoInfo(env),
      bilibiliAdapter.getTranscript(env),
    ])

    expect(video.contentKey).toBe(`bilibili:${BVID}:p:2`)
    expect(transcript.segments[0]?.text).toBe("Caption")
    expect(fetchImpl.mock.calls.filter(([input]) => String(input).includes("/x/web-interface/view")))
      .toHaveLength(1)
  })
})

describe("Bilibili subtitle discovery and normalization", () => {
  it("chooses Chinese manual, Chinese AI, English manual, English AI, then other", async () => {
    const cases = [
      { expected: "zh manual", tracks: [
        track(4, "ai-en", "en AI", "https://aisubtitle.hdslb.com/bfs/subtitle/en-ai.json"),
        track(3, "en", "en manual", "https://aisubtitle.hdslb.com/bfs/subtitle/en.json"),
        track(2, "ai-zh", "zh AI", "https://aisubtitle.hdslb.com/bfs/subtitle/zh-ai.json"),
        track(1, "zh-CN", "zh manual", "https://aisubtitle.hdslb.com/bfs/subtitle/zh.json"),
      ] },
      { expected: "zh AI", tracks: [
        track(4, "ai-en", "en AI", "https://aisubtitle.hdslb.com/bfs/subtitle/en-ai.json"),
        track(3, "en", "en manual", "https://aisubtitle.hdslb.com/bfs/subtitle/en.json"),
        track(2, "ai-zh", "zh AI", "https://aisubtitle.hdslb.com/bfs/subtitle/zh-ai.json"),
      ] },
      { expected: "en manual", tracks: [
        track(4, "ai-en", "en AI", "https://aisubtitle.hdslb.com/bfs/subtitle/en-ai.json"),
        track(3, "en", "en manual", "https://aisubtitle.hdslb.com/bfs/subtitle/en.json"),
      ] },
      { expected: "en AI", tracks: [
        track(4, "ai-en", "en AI", "https://aisubtitle.hdslb.com/bfs/subtitle/en-ai.json"),
      ] },
    ]

    for (const testCase of cases) {
      const fetchImpl = fetchWithTracks(testCase.tracks, [{ from: 0, to: 1, content: testCase.expected }])
      const transcript = await bilibiliAdapter.getTranscript(createEnvironment(P1_URL, fetchImpl))
      expect(transcript.segments[0]?.text).toBe(testCase.expected)
    }
  })

  it("uses player-v2 only when the preferred WBI request fails", async () => {
    const requests: string[] = []
    const fetchImpl = mock(async (input: string | URL) => {
      const url = new URL(String(input))
      requests.push(url.pathname)
      if (url.pathname.endsWith("/view")) return jsonResponse(metadata)
      if (url.pathname.endsWith("/wbi/v2")) throw new Error("network unavailable")
      if (url.pathname.endsWith("/player/v2")) return jsonResponse({
        code: 0,
        data: { subtitle: { subtitles: [track(1, "zh", "manual", "https://aisubtitle.hdslb.com/bfs/subtitle/fallback.json")] } },
      })
      return jsonResponse({ body: [{ from: 0, to: 1, content: "Fallback caption" }] })
    })

    const transcript = await bilibiliAdapter.getTranscript(createEnvironment(P1_URL, fetchImpl))
    expect(requests).toContain("/x/player/v2")
    expect(transcript.segments[0]?.text).toBe("Fallback caption")
  })

  it("does not fall back when WBI succeeds with no subtitles", async () => {
    const paths: string[] = []
    const fetchImpl = mock(async (input: string | URL) => {
      const url = new URL(String(input))
      paths.push(url.pathname)
      if (url.pathname.endsWith("/view")) return jsonResponse(metadata)
      return jsonResponse({ code: 0, data: { subtitle: { subtitles: [] } } })
    })

    await expect(bilibiliAdapter.getTranscript(createEnvironment(P1_URL, fetchImpl)))
      .rejects.toMatchObject({ code: "no_subtitle_tracks" })
    expect(paths).not.toContain("/x/player/v2")
  })

  it("normalizes finite subtitle entries, trims text, filters invalid rows, and sorts", async () => {
    const transcript = await bilibiliAdapter.getTranscript(createEnvironment(
      P1_URL,
      fetchWithTracks([track(1, "zh", "manual", "https://aisubtitle.hdslb.com/bfs/subtitle/subtitle.json")], [
        { from: 8, to: 9, content: "  later  " },
        { from: 1, to: 2, content: "first" },
        { from: Number.NaN, to: 2, content: "NaN" },
        { from: 4, to: 3, content: "reversed" },
        { from: -1, to: 2, content: "negative" },
        { from: 2, to: 2, content: "   " },
        { from: 3, to: Number.POSITIVE_INFINITY, content: "infinite" },
      ]),
    ))

    expect(transcript.segments).toEqual([
      { startSec: 1, endSec: 2, text: "first" },
      { startSec: 8, endSec: 9, text: "later" },
    ])
    expect(transcript.source).toBe("manual")
    expect(transcript.language).toBe("zh")
  })

  it("returns captions_unavailable when the selected body is empty or wholly invalid", async () => {
    for (const body of [[], [{ from: Number.NaN, to: 2, content: "invalid" }]]) {
      await expect(bilibiliAdapter.getTranscript(createEnvironment(
        P1_URL,
        fetchWithTracks([track(1, "zh", "manual", "https://aisubtitle.hdslb.com/bfs/subtitle/subtitle.json")], body),
      ))).rejects.toMatchObject({ code: "captions_unavailable" })
    }
  })

  it("maps source from Bilibili AI track metadata without leaking raw language labels", async () => {
    const transcript = await bilibiliAdapter.getTranscript(createEnvironment(
      P1_URL,
      fetchWithTracks([track(1, "ai-zh-CN", "中文（自动生成）", "https://aisubtitle.hdslb.com/bfs/subtitle/ai.json")], [
        { from: 1, to: 2, content: "AI caption" },
      ]),
    ))
    expect(transcript.source).toBe("auto")
    expect(transcript.language).toBe("zh")
  })
})

describe("Bilibili chapters, seeking, timestamps, and stale requests", () => {
  it("maps and sorts official view_points, drops invalid and duplicate points", async () => {
    const fetchImpl = jsonFetch([metadata, {
      code: 0,
      data: { view_points: [
        { title: "Later", start: 15, end: 20 },
        { content: "Earlier", from: 4, to: 10 },
        { label: "Earlier", start_time: 4, end_time: 7 },
        { title: "Invalid", from: Number.NaN },
        { title: "   ", from: 2 },
        { title: "Negative", from: -1 },
        { title: "No end", from: 30, to: Number.POSITIVE_INFINITY },
      ] },
    }])

    await expect(bilibiliAdapter.getNativeChapters(createEnvironment(P1_URL, fetchImpl))).resolves.toEqual([
      { id: "bilibili-chapter-4", title: "Earlier", startSec: 4, endSec: 10, source: "bilibili" },
      { id: "bilibili-chapter-15", title: "Later", startSec: 15, endSec: 20, source: "bilibili" },
      { id: "bilibili-chapter-30", title: "No end", startSec: 30, source: "bilibili" },
    ])
  })

  it("returns no chapters when the official endpoint has none and does not invent any", async () => {
    await expect(bilibiliAdapter.getNativeChapters(createEnvironment(
      P1_URL,
      jsonFetch([metadata, { code: 0, data: { view_points: [] } }]),
    ))).resolves.toEqual([])
  })

  it("seeks with the standard video element, clamps negatives, and rejects non-finite values", () => {
    const video = { currentTime: 10 }
    const env = createEnvironment(P1_URL, jsonFetch([]), video)
    expect(bilibiliAdapter.seek(env, 42.5)).toBe(true)
    expect(video.currentTime).toBe(42.5)
    expect(bilibiliAdapter.seek(env, -3)).toBe(true)
    expect(video.currentTime).toBe(0)
    expect(bilibiliAdapter.seek(env, Number.NaN)).toBe(false)
    expect(bilibiliAdapter.seek(env, Number.POSITIVE_INFINITY)).toBe(false)
    expect(video.currentTime).toBe(0)
  })

  it("builds P1/P2 timestamp URLs and preserves the current part", () => {
    const p1 = bilibiliAdapter.getVideoIdentity(new URL(P1_URL))!
    const p2 = bilibiliAdapter.getVideoIdentity(new URL(P2_URL))!
    expect(bilibiliAdapter.buildTimestampUrl(p1, 42.6)).toBe(`${P1_URL}?t=43`)
    expect(bilibiliAdapter.buildTimestampUrl(p2, 42.4)).toBe(`${P1_URL}?p=2&t=42`)
    expect(bilibiliAdapter.buildTimestampUrl(p2, -2)).toBe(`${P1_URL}?p=2&t=0`)
    expect(() => bilibiliAdapter.buildTimestampUrl(p2, Number.NaN)).toThrow(BilibiliAdapterError)
  })

  it("discards a P1 subtitle response that arrives after the page changes to P2", async () => {
    let currentUrl = P1_URL
    let releaseBody!: (response: Awaited<ReturnType<typeof jsonResponse>>) => void
    let bodyRequested!: () => void
    const bodyReady = new Promise<void>((resolve) => { bodyRequested = resolve })
    const body = new Promise<Awaited<ReturnType<typeof jsonResponse>>>((resolve) => { releaseBody = resolve })
    const env = createEnvironment(P1_URL, async (input) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/view")) return jsonResponse(metadata)
      if (url.pathname.endsWith("/wbi/v2")) return jsonResponse({
        code: 0,
        data: { subtitle: { subtitles: [track(1, "zh", "manual", "https://aisubtitle.hdslb.com/bfs/subtitle/p1.json")] } },
      })
      bodyRequested()
      return body
    }, undefined, () => new URL(currentUrl))

    const pending = bilibiliAdapter.getTranscript(env)
    await bodyReady
    currentUrl = P2_URL
    releaseBody(jsonResponse({ body: [{ from: 0, to: 2, content: "Stale P1 caption" }] }))

    await expect(pending).rejects.toMatchObject({ code: "stale_part_request" })
  })
})

describe("Bilibili API failure classification", () => {
  it("distinguishes metadata fetch, API, player, and missing-cid errors", async () => {
    await expect(bilibiliAdapter.readVideoInfo(createEnvironment(P1_URL, async () => {
      throw new Error("network failure")
    }))).rejects.toMatchObject({ code: "metadata_fetch_failed" })

    await expect(bilibiliAdapter.readVideoInfo(createEnvironment(P1_URL, jsonFetch([
      { code: -101, message: "not logged in", data: null },
    ])))).rejects.toMatchObject({ code: "bilibili_session_restricted" })

    const missingCid = { ...metadata, data: { ...metadata.data, pages: [
      { cid: 0, page: 1, part: "Missing cid", duration: 100 },
    ] } }
    await expect(bilibiliAdapter.readVideoInfo(createEnvironment(P1_URL, jsonFetch([missingCid]))))
      .rejects.toMatchObject({ code: "current_part_cid_missing" })
  })

  it("does not include request URLs, headers, or credentials in transport errors", async () => {
    const env = createEnvironment(P1_URL, async () => { throw new Error("request failed") })
    try {
      await bilibiliAdapter.readVideoInfo(env)
    } catch (error) {
      expect((error as Error).message).not.toContain("api.bilibili.com")
      expect((error as Error).message).not.toContain("Cookie")
      expect((error as Error).message).not.toContain("SESSDATA")
    }
  })
})

function track(id: number, lan: string, lanDoc: string, subtitleUrl: string) {
  return { id, lan, lan_doc: lanDoc, subtitle_url: subtitleUrl }
}

function createEnvironment(
  href: string,
  fetchImpl: FetchLike,
  video?: { currentTime: number },
  getCurrentUrl?: () => URL,
): PlatformPageEnvironment {
  const document = {
    title: "Bilibili page",
    querySelector: (selector: string) => selector === "video" ? (video ?? null) : null,
  } as unknown as Document
  return {
    document,
    location: new URL(href),
    getCurrentUrl,
    fetch: fetchImpl,
  }
}

function jsonFetch(payloads: unknown[]): FetchLike {
  let index = 0
  return mock(async () => jsonResponse(payloads[index++]))
}

function fetchWithTracks(tracks: unknown[], body: unknown[]): FetchLike {
  return mock(async (input: string | URL) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith("/view")) return jsonResponse(metadata)
    if (url.pathname.endsWith("/wbi/v2")) {
      return jsonResponse({ code: 0, data: { subtitle: { subtitles: tracks } } })
    }
    return jsonResponse({ body })
  })
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    text: async () => JSON.stringify(payload),
  }
}
