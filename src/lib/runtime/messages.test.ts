import { afterEach, describe, expect, it, mock } from "bun:test"

import {
  GET_ACTIVE_VIDEO_CONTEXT,
  RUNTIME_MESSAGE_NAMESPACE,
  isContentScriptRequestMessage,
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
})
