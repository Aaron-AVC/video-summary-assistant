import { afterEach, describe, expect, it, mock } from "bun:test"

import {
  ACTIVE_VIDEO_CONTEXT_CHANGED,
  CONTENT_VIDEO_CONTEXT_CHANGED,
  FETCH_BILIBILI_RESOURCE,
  GET_ACTIVE_VIDEO_CONTEXT,
  REFRESH_YOUTUBE_CAPTION_RESOURCE,
  READ_YOUTUBE_LIVE_PLAYER_STATE,
  RUNTIME_MESSAGE_NAMESPACE,
  isActiveVideoContextChangedMessage,
  isContentVideoContextChangedMessage,
  isContentScriptRequestMessage,
  isRuntimeRequestMessage,
  isRuntimeMessageParseError,
  sendRuntimeMessage,
} from "@/lib/runtime/messages"

const originalChrome = globalThis.chrome

afterEach(() => {
  globalThis.chrome = originalChrome
})

function installChromeRuntime(sendMessage: (...args: unknown[]) => unknown) {
  globalThis.chrome = {
    runtime: { sendMessage },
  } as unknown as typeof chrome
}

function createNeutralContext() {
  return {
    pageType: "video",
    platform: "youtube",
    videoId: "video-1",
    partId: null,
    contentKey: "youtube:video-1",
    url: "https://www.youtube.com/watch?v=video-1",
    canonicalUrl: "https://www.youtube.com/watch?v=video-1",
    title: "Video 1",
    author: "Channel",
    timestampSeconds: 0,
    isReady: true,
  }
}

function createBilibiliContext(partId = "2") {
  const bvid = "BV1xx411c7mD"
  return {
    pageType: "video",
    platform: "bilibili",
    videoId: bvid,
    partId,
    contentKey: `bilibili:${bvid}:p:${partId}`,
    url: `https://www.bilibili.com/video/${bvid}/?p=${partId}`,
    canonicalUrl: `https://www.bilibili.com/video/${bvid}/?p=${partId}`,
    title: `Part ${partId}`,
    author: "Uploader",
    timestampSeconds: 0,
    isReady: true,
  }
}

describe("runtime message boundaries", () => {
  it("does not route background-only messages into the content script", () => {
    expect(isContentScriptRequestMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: "open-sidepanel",
    })).toBe(false)

    expect(isContentScriptRequestMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: GET_ACTIVE_VIDEO_CONTEXT,
    })).toBe(true)
  })

  it("accepts only allowlisted Bilibili resource requests", () => {
    const base = { channel: RUNTIME_MESSAGE_NAMESPACE, type: FETCH_BILIBILI_RESOURCE }
    expect(isRuntimeRequestMessage({
      ...base,
      url: "https://api.bilibili.com/x/player/wbi/v2?aid=1&cid=2&bvid=BV1xx411c7mD&wts=1700000000&w_rid=0123456789abcdef0123456789abcdef",
    })).toBe(true)
    for (const url of [
      "https://example.com/private",
      "https://api.bilibili.com/x/player/v2?cid=2&url=https://example.com",
      "http://api.bilibili.com/x/player/v2?aid=1&cid=2&bvid=BV1xx411c7mD",
    ]) {
      expect(isRuntimeRequestMessage({ ...base, url })).toBe(false)
    }
  })

  it("validates the bounded YouTube live-player request", () => {
    expect(isRuntimeRequestMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: READ_YOUTUBE_LIVE_PLAYER_STATE,
      videoId: "video-1",
    })).toBe(true)
    expect(isRuntimeRequestMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: READ_YOUTUBE_LIVE_PLAYER_STATE,
      videoId: "video id with spaces",
    })).toBe(false)
    expect(isContentScriptRequestMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: READ_YOUTUBE_LIVE_PLAYER_STATE,
      videoId: "video-1",
    })).toBe(false)

    expect(isRuntimeRequestMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: REFRESH_YOUTUBE_CAPTION_RESOURCE,
      videoId: "video-1",
      previousStartTime: 10,
    })).toBe(true)
    expect(isRuntimeRequestMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: REFRESH_YOUTUBE_CAPTION_RESOURCE,
      videoId: "video-1",
      previousStartTime: -1,
    })).toBe(false)
    expect(isContentScriptRequestMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: REFRESH_YOUTUBE_CAPTION_RESOURCE,
      videoId: "video-1",
      previousStartTime: 10,
    })).toBe(false)
  })

  it("validates content context announcements for extension relay", () => {
    expect(isContentVideoContextChangedMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: CONTENT_VIDEO_CONTEXT_CHANGED,
      context: createBilibiliContext(),
    })).toBe(true)
    expect(isContentVideoContextChangedMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: CONTENT_VIDEO_CONTEXT_CHANGED,
      context: { ...createBilibiliContext(), contentKey: "bilibili:wrong:p:2" },
    })).toBe(false)
    expect(isActiveVideoContextChangedMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: ACTIVE_VIDEO_CONTEXT_CHANGED,
      tabId: 7,
      context: createBilibiliContext(),
    })).toBe(true)
    expect(isActiveVideoContextChangedMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: ACTIVE_VIDEO_CONTEXT_CHANGED,
      tabId: -1,
      context: createBilibiliContext(),
    })).toBe(false)
  })
})
describe("active video context string bounds", () => {
  const CANONICAL_URL_PREFIX = "https://www.youtube.com/watch?v="
  const BILIBILI_BVID = "BV1xx411c7mD"

  function asciiText(length: number): string {
    return "a".repeat(length)
  }

  function canonicalUrlWithLength(length: number): string {
    return CANONICAL_URL_PREFIX + "a".repeat(length - CANONICAL_URL_PREFIX.length)
  }

  function contentAnnouncement(context: Record<string, unknown>) {
    return {
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: CONTENT_VIDEO_CONTEXT_CHANGED,
      context,
    }
  }

  function activeAnnouncement(context: Record<string, unknown>) {
    return {
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: ACTIVE_VIDEO_CONTEXT_CHANGED,
      tabId: 7,
      context,
    }
  }

  type BoundedFieldCase = {
    field: string
    limit: number
    build: (length: number) => Record<string, unknown>
  }

  // Each builder keeps every other field legal so a rejection is attributable to
  // the field under test: YouTube contexts keep contentKey in sync with videoId,
  // Bilibili contexts keep the derived `bilibili:<bvid>:p:<partId>` key in sync,
  // and the contentKey case stays platform-neutral so identity rules cannot fire.
  const boundedFieldCases: BoundedFieldCase[] = [
    {
      field: "videoId",
      limit: 128,
      build: (length) => {
        const videoId = asciiText(length)
        return { ...createNeutralContext(), videoId, contentKey: `youtube:${videoId}` }
      },
    },
    {
      field: "partId",
      limit: 16,
      build: (length) => createBilibiliContext(asciiText(length)),
    },
    {
      field: "contentKey",
      limit: 256,
      build: (length) => ({
        ...createNeutralContext(),
        platform: null,
        videoId: null,
        partId: null,
        contentKey: asciiText(length),
      }),
    },
    {
      field: "url",
      limit: 16_384,
      build: (length) => ({ ...createNeutralContext(), url: canonicalUrlWithLength(length) }),
    },
    {
      field: "canonicalUrl",
      limit: 16_384,
      build: (length) => ({ ...createNeutralContext(), canonicalUrl: canonicalUrlWithLength(length) }),
    },
    {
      field: "title",
      limit: 4_096,
      build: (length) => ({ ...createNeutralContext(), title: asciiText(length) }),
    },
    {
      field: "author",
      limit: 4_096,
      build: (length) => ({ ...createNeutralContext(), author: asciiText(length) }),
    },
  ]

  for (const { field, limit, build } of boundedFieldCases) {
    it(`bounds ${field} at ${limit} characters on both relay boundaries`, () => {
      const atLimit = build(limit)
      expect(isContentVideoContextChangedMessage(contentAnnouncement(atLimit))).toBe(true)
      expect(isActiveVideoContextChangedMessage(activeAnnouncement(atLimit))).toBe(true)

      const overLimit = build(limit + 1)
      expect(isContentVideoContextChangedMessage(contentAnnouncement(overLimit))).toBe(false)
      expect(isActiveVideoContextChangedMessage(activeAnnouncement(overLimit))).toBe(false)
    })
  }

  it("keeps normal YouTube and Bilibili contexts valid", () => {
    expect(isContentVideoContextChangedMessage(contentAnnouncement(createNeutralContext()))).toBe(true)
    expect(isActiveVideoContextChangedMessage(activeAnnouncement(createNeutralContext()))).toBe(true)

    expect(isContentVideoContextChangedMessage(contentAnnouncement(createBilibiliContext()))).toBe(true)
    expect(isActiveVideoContextChangedMessage(activeAnnouncement(createBilibiliContext("12")))).toBe(true)

    // Derived Bilibili identity for the real 12-character bvid stays far below the cap.
    expect(createBilibiliContext("12").contentKey).toBe(`bilibili:${BILIBILI_BVID}:p:12`)
  })

  it("counts astral characters as one code point at the title limit", () => {
    // Zod's `.max()` measures Unicode code points, not UTF-16 code units, so a
    // 4096-character emoji title (8192 code units) is still within the limit
    // while 4097 code points are rejected. ASCII-only cases cannot show this.
    const emojiAtLimit = "😀".repeat(4_096)
    expect(emojiAtLimit.length).toBe(8_192)
    expect(isContentVideoContextChangedMessage(contentAnnouncement({
      ...createNeutralContext(),
      title: emojiAtLimit,
    }))).toBe(true)
    expect(isActiveVideoContextChangedMessage(activeAnnouncement({
      ...createNeutralContext(),
      title: emojiAtLimit,
    }))).toBe(true)

    expect(isContentVideoContextChangedMessage(contentAnnouncement({
      ...createNeutralContext(),
      title: "😀".repeat(4_097),
    }))).toBe(false)
    expect(isActiveVideoContextChangedMessage(activeAnnouncement({
      ...createNeutralContext(),
      title: "😀".repeat(4_097),
    }))).toBe(false)
  })

  it("counts CJK characters at the author limit", () => {
    // BMP characters count the same under code points and UTF-16 code units, so
    // a CJK author exactly at the limit must pass and one over must be rejected.
    const cjkAtLimit = "中".repeat(4_096)
    expect(cjkAtLimit.length).toBe(4_096)
    expect(isContentVideoContextChangedMessage(contentAnnouncement({
      ...createNeutralContext(),
      author: cjkAtLimit,
    }))).toBe(true)
    expect(isActiveVideoContextChangedMessage(activeAnnouncement({
      ...createNeutralContext(),
      author: cjkAtLimit,
    }))).toBe(true)
    expect(isContentVideoContextChangedMessage(contentAnnouncement({
      ...createNeutralContext(),
      author: "中".repeat(4_097),
    }))).toBe(false)
    expect(isActiveVideoContextChangedMessage(activeAnnouncement({
      ...createNeutralContext(),
      author: "中".repeat(4_097),
    }))).toBe(false)
  })

  it("keeps null identity and empty url semantics for unsupported contexts", () => {
    const unsupportedContext = {
      pageType: "unsupported",
      platform: null,
      videoId: null,
      partId: null,
      contentKey: null,
      url: "",
      canonicalUrl: null,
      title: null,
      author: null,
      timestampSeconds: 0,
      isReady: false,
    }

    expect(isContentVideoContextChangedMessage(contentAnnouncement(unsupportedContext))).toBe(true)
    expect(isActiveVideoContextChangedMessage(activeAnnouncement(unsupportedContext))).toBe(true)
  })

  it("still rejects inconsistent identities after the bounds were added", () => {
    expect(isContentVideoContextChangedMessage(contentAnnouncement({
      ...createBilibiliContext("2"),
      contentKey: "bilibili:wrong:p:2",
    }))).toBe(false)
    expect(isContentVideoContextChangedMessage(contentAnnouncement({
      ...createNeutralContext(),
      contentKey: "youtube:someone-else",
    }))).toBe(false)
  })
})

describe("sendRuntimeMessage validation", () => {
  it("accepts a platform-neutral active video context", async () => {
    installChromeRuntime(async () => ({
      ok: true,
      type: GET_ACTIVE_VIDEO_CONTEXT,
      tabId: 1,
      context: createNeutralContext(),
    }))

    const response = await sendRuntimeMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: GET_ACTIVE_VIDEO_CONTEXT,
    })

    expect(response.ok).toBe(true)
    expect(isRuntimeMessageParseError(response)).toBe(false)
    if (response.ok && response.type === GET_ACTIVE_VIDEO_CONTEXT) {
      expect(response.context).toMatchObject({
        pageType: "video",
        platform: "youtube",
        videoId: "video-1",
        contentKey: "youtube:video-1",
      })
    }
  })

  it("accepts a validated live-player response without exposing arbitrary response data", async () => {
    installChromeRuntime(async () => ({
      ok: true,
      type: READ_YOUTUBE_LIVE_PLAYER_STATE,
      tabId: 1,
      playerState: {
        videoId: "video-1",
        title: "Live title",
        author: "Live author",
        captionTracks: [{
          languageCode: "zh-Hans",
          languageName: "中文（简体）",
          displayName: null,
          kind: null,
          vssId: ".zh-Hans",
        }],
        timedtextCandidates: [],
      },
    }))

    const response = await sendRuntimeMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: READ_YOUTUBE_LIVE_PLAYER_STATE,
      videoId: "video-1",
    })

    expect(response).toMatchObject({
      ok: true,
      type: READ_YOUTUBE_LIVE_PLAYER_STATE,
      playerState: { videoId: "video-1", author: "Live author" },
    })
  })

  it("accepts a bounded caption refresh response with a current signed candidate", async () => {
    installChromeRuntime(async () => ({
      ok: true,
      type: REFRESH_YOUTUBE_CAPTION_RESOURCE,
      tabId: 1,
      candidate: {
        url: "https://www.youtube.com/api/timedtext?v=video-1&lang=zh-Hans&fmt=json3&signature=secret",
        videoId: "video-1",
        languageCode: "zh-Hans",
        format: "json3",
        startTime: 100,
      },
    }))

    const response = await sendRuntimeMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: REFRESH_YOUTUBE_CAPTION_RESOURCE,
      videoId: "video-1",
      previousStartTime: 10,
    })

    expect(response).toMatchObject({
      ok: true,
      type: REFRESH_YOUTUBE_CAPTION_RESOURCE,
      candidate: { languageCode: "zh-Hans", startTime: 100 },
    })
  })

  it("rejects a legacy context that omits platform and contentKey", async () => {
    const { platform: _platform, contentKey: _contentKey, ...legacyContext } = createNeutralContext()
    installChromeRuntime(async () => ({
      ok: true,
      type: GET_ACTIVE_VIDEO_CONTEXT,
      tabId: 1,
      context: legacyContext,
    }))

    const response = await sendRuntimeMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: GET_ACTIVE_VIDEO_CONTEXT,
    })

    expect(isRuntimeMessageParseError(response)).toBe(true)
    if (isRuntimeMessageParseError(response)) {
      expect(response.error).toContain("failed validation")
    }
  })

  it("returns a typed parse-error envelope when the response is malformed", async () => {
    installChromeRuntime(async () => ({
      ok: true,
      type: GET_ACTIVE_VIDEO_CONTEXT,
    }))

    const response = await sendRuntimeMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: GET_ACTIVE_VIDEO_CONTEXT,
    })

    expect(response.ok).toBe(false)
    expect(isRuntimeMessageParseError(response)).toBe(true)
    if (isRuntimeMessageParseError(response)) {
      expect(response.type).toBe("runtime-message-parse-error")
      expect(response.error).toContain("failed validation")
      expect(response.tabId).toBeNull()
    }
  })

  it("wraps transport errors as a typed parse-error envelope", async () => {
    const sendMessage = mock(async () => {
      throw new Error("Could not establish connection")
    })
    installChromeRuntime(sendMessage)

    const response = await sendRuntimeMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: GET_ACTIVE_VIDEO_CONTEXT,
    })

    expect(isRuntimeMessageParseError(response)).toBe(true)
    if (isRuntimeMessageParseError(response)) {
      expect(response.error).toContain("Could not establish connection")
    }
  })

  it("rejects normalized transcripts with reversed ranges or blank text", async () => {
    for (const segment of [
      { startSec: 2, endSec: 1, text: "reversed" },
      { startSec: 0, endSec: 1, text: "  " },
    ]) {
      installChromeRuntime(async () => ({
        ok: true,
        type: "fetch-video-transcript",
        tabId: 7,
        video: {
          platform: "bilibili",
          videoId: "BV1xx411c7mD",
          partId: "2",
          contentKey: "bilibili:BV1xx411c7mD:p:2",
          title: "Part 2",
          canonicalUrl: "https://www.bilibili.com/video/BV1xx411c7mD/?p=2",
        },
        transcript: { segments: [segment], source: "manual" },
      }))
      const response = await sendRuntimeMessage({
        channel: RUNTIME_MESSAGE_NAMESPACE,
        type: GET_ACTIVE_VIDEO_CONTEXT,
      })
      expect(isRuntimeMessageParseError(response)).toBe(true)
    }
  })
})
