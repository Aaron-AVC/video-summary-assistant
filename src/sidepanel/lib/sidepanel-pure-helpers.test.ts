import { describe, expect, it } from "bun:test"

import { parseContentKey } from "@/features/platform/content-key"
import type { ActiveVideoContext } from "@/features/platform/types"
import {
  formatTimestamp,
  historyContextIdentityFromContentKey,
  identityFromAnalysis,
  identityFromContext,
} from "@/sidepanel/lib/sidepanel-pure-helpers"

function context(overrides: Partial<ActiveVideoContext> = {}): ActiveVideoContext {
  return {
    pageType: "video",
    platform: "youtube",
    videoId: "video-id",
    partId: null,
    contentKey: "youtube:video-id",
    url: "https://www.youtube.com/watch?v=video-id",
    canonicalUrl: "https://www.youtube.com/watch?v=video-id",
    title: "Video",
    author: "Author",
    timestampSeconds: 0,
    isReady: true,
    ...overrides,
  }
}

describe("Side Panel pure helpers", () => {
  it("preserves timestamp formatting and Math.round behavior", () => {
    expect(formatTimestamp(0)).toBe("0:00")
    expect(formatTimestamp(125)).toBe("2:05")
    expect(formatTimestamp(3661)).toBe("1:01:01")
    expect(formatTimestamp(1.5)).toBe("0:02")
    expect(formatTimestamp(59.5)).toBe("1:00")
    expect(formatTimestamp(3599.5)).toBe("1:00:00")
  })

  it("returns the canonical YouTube identity from a valid context", () => {
    expect(identityFromContext(context())).toEqual({
      platform: "youtube",
      videoId: "video-id",
      contentKey: "youtube:video-id",
    })
  })

  it("preserves distinct canonical Bilibili part identities", () => {
    const partOne = identityFromContext(context({
      platform: "bilibili",
      videoId: "BV-test",
      partId: "1",
      contentKey: "bilibili:BV-test:p:1",
    }))
    const partTwo = identityFromContext(context({
      platform: "bilibili",
      videoId: "BV-test",
      partId: "2",
      contentKey: "bilibili:BV-test:p:2",
    }))

    expect(partOne).toEqual({
      platform: "bilibili",
      videoId: "BV-test",
      partId: "1",
      contentKey: "bilibili:BV-test:p:1",
    })
    expect(partTwo).toEqual({
      platform: "bilibili",
      videoId: "BV-test",
      partId: "2",
      contentKey: "bilibili:BV-test:p:2",
    })
    expect(partOne).not.toEqual(partTwo)
  })

  it("returns null when a context identity component is missing", () => {
    expect(identityFromContext(context({ platform: null }))).toBeNull()
    expect(identityFromContext(context({ videoId: null }))).toBeNull()
    expect(identityFromContext(context({ contentKey: null }))).toBeNull()
  })

  it("projects only identity fields from analysis sources", () => {
    expect(identityFromAnalysis({
      platform: "youtube",
      videoId: "video-id",
      contentKey: "youtube:video-id",
      partId: null,
    })).toEqual({
      platform: "youtube",
      videoId: "video-id",
      contentKey: "youtube:video-id",
    })

    expect(identityFromAnalysis({
      platform: "bilibili",
      videoId: "BV-test",
      partId: "2",
      contentKey: "bilibili:BV-test:p:2",
    })).toEqual({
      platform: "bilibili",
      videoId: "BV-test",
      partId: "2",
      contentKey: "bilibili:BV-test:p:2",
    })
  })
})

describe("historyContextIdentityFromContentKey", () => {
  const validBvid = "BV1xx411c7mD"

  it("projects a canonical YouTube key without a part", () => {
    expect(historyContextIdentityFromContentKey("youtube:dQw4w9WgXcQ")).toEqual({
      platform: "youtube",
      partId: null,
    })
  })

  it("projects a canonical Bilibili key onto its canonical part id", () => {
    expect(historyContextIdentityFromContentKey(`bilibili:${validBvid}:p:1`)).toEqual({
      platform: "bilibili",
      partId: "1",
    })
    expect(historyContextIdentityFromContentKey(`bilibili:${validBvid}:p:42`)).toEqual({
      platform: "bilibili",
      partId: "42",
    })
  })

  it("keeps the projected part id identical to the parsed page index", () => {
    const contentKey = `bilibili:${validBvid}:p:7`
    const parsed = parseContentKey(contentKey)
    if (!parsed || parsed.platform !== "bilibili") {
      throw new Error(`expected a canonical Bilibili parse for ${contentKey}`)
    }
    expect(historyContextIdentityFromContentKey(contentKey)).toEqual({
      platform: parsed.platform,
      partId: parsed.partId,
    })
    expect(parsed.partId).toBe(String(parsed.pageIndex))
  })

  it("rejects unknown providers and malformed keys instead of guessing a platform", () => {
    const rejected = [
      "",
      "dQw4w9WgXcQ",
      "vimeo:12345",
      "youtube:",
      "youtube:id:extra",
      `bilibili:${validBvid}`,
      `bilibili:${validBvid}:p`,
      `bilibili:${validBvid}:p:`,
      `bilibili:${validBvid}:p:0`,
      `bilibili:${validBvid}:p:-1`,
      `bilibili:${validBvid}:p:01`,
      `bilibili:${validBvid}:p:1.0`,
      `bilibili:${validBvid}:p:abc`,
      `bilibili:${validBvid}:q:1`,
      `bilibili:${validBvid}:p:1:extra`,
      "bilibili:not-a-bvid:p:1",
    ]

    for (const contentKey of rejected) {
      expect(historyContextIdentityFromContentKey(contentKey)).toBeNull()
    }
  })

  it("rejects keys whose identity is only valid after trimming", () => {
    const padded = [
      " youtube:dQw4w9WgXcQ",
      "youtube:dQw4w9WgXcQ ",
      "youtube: dQw4w9WgXcQ",
      "youtube:dQw4w9WgXcQ\t",
      ` bilibili:${validBvid}:p:1`,
      `bilibili:${validBvid}:p:1 `,
      `bilibili:${validBvid}:p: 1`,
      `bilibili: ${validBvid}:p:1`,
    ]

    for (const contentKey of padded) {
      expect(historyContextIdentityFromContentKey(contentKey)).toBeNull()
    }
  })
})
