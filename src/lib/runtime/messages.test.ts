import { afterEach, describe, expect, it, mock } from "bun:test"

import {
  ACTIVE_VIDEO_CONTEXT_CHANGED,
  CONTENT_VIDEO_CONTEXT_CHANGED,
  FETCH_BILIBILI_RESOURCE,
  GET_ACTIVE_VIDEO_CONTEXT,
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
