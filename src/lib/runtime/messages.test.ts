import { afterEach, describe, expect, it, mock } from "bun:test"

import {
  GET_ACTIVE_VIDEO_CONTEXT,
  RUNTIME_MESSAGE_NAMESPACE,
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

describe("sendRuntimeMessage validation", () => {
  it("returns the typed response when the runtime payload matches the schema", async () => {
    installChromeRuntime(async () => ({
      ok: true,
      type: GET_ACTIVE_VIDEO_CONTEXT,
      tabId: 1,
      context: {
        pageType: "watch",
        videoId: "video-1",
        url: "https://www.youtube.com/watch?v=video-1",
        canonicalUrl: "https://www.youtube.com/watch?v=video-1",
        title: "Video 1",
        channelName: "Channel",
        timestampSeconds: 0,
        isReady: true,
      },
    }))

    const response = await sendRuntimeMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: GET_ACTIVE_VIDEO_CONTEXT,
    })

    expect(response.ok).toBe(true)
    expect(isRuntimeMessageParseError(response)).toBe(false)
    if (response.ok && response.type === GET_ACTIVE_VIDEO_CONTEXT) {
      expect(response.context.videoId).toBe("video-1")
    }
  })

  it("returns a typed parse-error envelope when the response is malformed", async () => {
    // Simulates a buggy/legacy responder that returns a half-shaped payload.
    installChromeRuntime(async () => ({
      ok: true,
      type: GET_ACTIVE_VIDEO_CONTEXT,
      // Missing required fields: tabId, context.
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
