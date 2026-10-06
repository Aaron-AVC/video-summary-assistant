import { describe, expect, it } from "bun:test"

import { deriveJumpToTimestampResult } from "@/lib/providers/extension-providers"
import {
  ANALYZE_VIDEO,
  GET_ACTIVE_VIDEO_CONTEXT,
  JUMP_TO_TIMESTAMP,
  type RuntimeResponseMessage
} from "@/lib/runtime/messages"

describe("deriveJumpToTimestampResult", () => {
  it("returns ok=true with openedNewTab=false when the active tab handled the jump", () => {
    const response = {
      ok: true,
      type: JUMP_TO_TIMESTAMP,
      tabId: 1,
      timestampSeconds: 42,
      jumped: true,
      openedNewTab: false
    } satisfies RuntimeResponseMessage

    expect(deriveJumpToTimestampResult(response)).toEqual({
      ok: true,
      openedNewTab: false
    })
  })

  it("returns ok=true with openedNewTab=true when a new tab was opened", () => {
    const response = {
      ok: true,
      type: JUMP_TO_TIMESTAMP,
      tabId: 2,
      timestampSeconds: 7,
      jumped: false,
      openedNewTab: true
    } satisfies RuntimeResponseMessage

    expect(deriveJumpToTimestampResult(response)).toEqual({
      ok: true,
      openedNewTab: true
    })
  })

  it("returns ok=false when neither jumped nor openedNewTab is true", () => {
    const response = {
      ok: true,
      type: JUMP_TO_TIMESTAMP,
      tabId: 3,
      timestampSeconds: 9,
      jumped: false,
      openedNewTab: false
    } satisfies RuntimeResponseMessage

    const result = deriveJumpToTimestampResult(response)
    expect(result.ok).toBe(false)
    if (result.ok === false) {
      expect(result.error).toMatch(/active YouTube tab/i)
    }
  })

  it("returns ok=false propagating the runtime error", () => {
    const response = {
      ok: false,
      type: JUMP_TO_TIMESTAMP,
      tabId: null,
      error: "No active tab"
    } satisfies RuntimeResponseMessage

    expect(deriveJumpToTimestampResult(response)).toEqual({
      ok: false,
      error: "No active tab"
    })
  })

  it("returns ok=false when the response is not a jump-to-timestamp response", () => {
    const response = {
      ok: true,
      type: GET_ACTIVE_VIDEO_CONTEXT,
      tabId: 1,
      context: {
        pageType: "unsupported",
        videoId: null,
        url: "",
        canonicalUrl: null,
        title: null,
        channelName: null,
        timestampSeconds: 0,
        isReady: false
      }
    } satisfies RuntimeResponseMessage

    const result = deriveJumpToTimestampResult(response)
    expect(result.ok).toBe(false)
    if (result.ok === false) {
      expect(result.error).toMatch(/unexpected runtime response/i)
    }
  })

  it("narrows the discriminated union safely at the call site", () => {
    const responses: RuntimeResponseMessage[] = [
      {
        ok: true,
        type: JUMP_TO_TIMESTAMP,
        tabId: 1,
        timestampSeconds: 1,
        jumped: true,
        openedNewTab: false
      },
      {
        ok: false,
        type: ANALYZE_VIDEO,
        tabId: null,
        error: "boom"
      }
    ]

    for (const response of responses) {
      const result = deriveJumpToTimestampResult(response)
      // Force narrowing through `.ok` to make sure the type is a true
      // discriminated union (success branch should not see `.error`).
      if (result.ok === true) {
        expect(typeof result.openedNewTab).toBe("boolean")
      } else {
        expect(typeof result.error).toBe("string")
      }
    }
  })
})
