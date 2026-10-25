import { describe, expect, it } from "bun:test"

import { buildBilibiliContentKey } from "@/features/platform/bilibili/bilibili-url"
import {
  parseContentKey,
  type ParsedBilibiliContentKey,
  type ParsedYouTubeContentKey,
} from "@/features/platform/content-key"

/** Shape accepted by the existing `BVID_PATTERN` / `isValidBvid` validator. */
const VALID_BVID = "BV1xx411c7mD"

describe("parseContentKey: YouTube", () => {
  it("parses a canonical YouTube key", () => {
    expect(parseContentKey("youtube:dQw4w9WgXcQ")).toEqual({
      platform: "youtube",
      videoId: "dQw4w9WgXcQ",
      contentKey: "youtube:dQw4w9WgXcQ",
    })
  })

  it("preserves the exact canonical contentKey and omits partId", () => {
    const contentKey = "youtube:video-id_123"
    const parsed = parseContentKey(contentKey) as ParsedYouTubeContentKey

    expect(parsed.platform).toBe("youtube")
    expect(parsed.contentKey).toBe(contentKey)
    expect("partId" in parsed).toBe(false)
    expect("pageIndex" in parsed).toBe(false)
  })

  it("rejects leading and trailing whitespace inside the videoId", () => {
    // Rejected, not repaired: these keys are not the canonical form an adapter
    // would have produced, so the parse fails instead of trimming the videoId
    // into acceptance. The whitespace below sits in the videoId, after the
    // `youtube:` separator.
    expect(parseContentKey("youtube: dQw4w9WgXcQ")).toBeNull()
    expect(parseContentKey("youtube:dQw4w9WgXcQ ")).toBeNull()
    expect(parseContentKey("youtube:\tdQw4w9WgXcQ")).toBeNull()
    expect(parseContentKey("youtube:dQw4w9WgXcQ\t")).toBeNull()
    expect(parseContentKey("youtube:\ndQw4w9WgXcQ")).toBeNull()
    expect(parseContentKey("youtube:dQw4w9WgXcQ\n")).toBeNull()
    expect(parseContentKey("youtube: ")).toBeNull()
  })

  it("accepts only the canonical key among whitespace variants", () => {
    expect(parseContentKey("youtube:dQw4w9WgXcQ")).not.toBeNull()
    expect(parseContentKey("youtube:dQw4w9WgXcQ ")).toBeNull()
    expect(parseContentKey("youtube: dQw4w9WgXcQ")).toBeNull()
    expect(parseContentKey(" youtube:dQw4w9WgXcQ")).toBeNull()
  })

  it("returns null for an empty videoId", () => {
    expect(parseContentKey("youtube:")).toBeNull()
  })

  it("returns null for an unknown platform", () => {
    expect(parseContentKey("vimeo:dQw4w9WgXcQ")).toBeNull()
    expect(parseContentKey("bilibili:dQw4w9WgXcQ")).toBeNull()
  })

  it("returns null for extra segments", () => {
    expect(parseContentKey("youtube:dQw4w9WgXcQ:extra")).toBeNull()
    expect(parseContentKey("youtube:dQw4w9WgXcQ:p:1")).toBeNull()
  })

  it("returns null for non-exact platform casing", () => {
    expect(parseContentKey("YouTube:dQw4w9WgXcQ")).toBeNull()
    expect(parseContentKey("YOUTUBE:dQw4w9WgXcQ")).toBeNull()
    expect(parseContentKey("youTube:dQw4w9WgXcQ")).toBeNull()
  })

  it("returns null when leading whitespace breaks the platform segment", () => {
    // Not a trim: the leading space becomes part of the platform token, so the
    // platform is no longer exactly `youtube` and nothing can be parsed.
    expect(parseContentKey(" youtube:dQw4w9WgXcQ")).toBeNull()
    expect(parseContentKey("\tyoutube:dQw4w9WgXcQ")).toBeNull()
  })

  it("returns null for empty input and malformed separators", () => {
    expect(parseContentKey("")).toBeNull()
    expect(parseContentKey(":")).toBeNull()
    expect(parseContentKey("youtube")).toBeNull()
    expect(parseContentKey("youtube::")).toBeNull()
    expect(parseContentKey("::")).toBeNull()
    expect(parseContentKey("youtube:dQw4w9WgXcQ:")).toBeNull()
  })
})

describe("parseContentKey: Bilibili", () => {
  it("parses a canonical Bilibili key", () => {
    expect(parseContentKey(`bilibili:${VALID_BVID}:p:1`)).toEqual({
      platform: "bilibili",
      videoId: VALID_BVID,
      partId: "1",
      pageIndex: 1,
      contentKey: `bilibili:${VALID_BVID}:p:1`,
    })
  })

  it("parses canonical keys across page indexes", () => {
    for (const pageIndex of [1, 2, 10, 42, 999, 123456]) {
      const contentKey = buildBilibiliContentKey(VALID_BVID, pageIndex)
      const parsed = parseContentKey(contentKey) as ParsedBilibiliContentKey

      expect(parsed.platform).toBe("bilibili")
      expect(parsed.videoId).toBe(VALID_BVID)
      expect(parsed.pageIndex).toBe(pageIndex)
      expect(parsed.partId).toBe(String(pageIndex))
      expect(parsed.contentKey).toBe(contentKey)
    }
  })

  it("round-trips accepted keys through buildBilibiliContentKey", () => {
    for (const pageIndex of [1, 3, 77]) {
      const contentKey = buildBilibiliContentKey(VALID_BVID, pageIndex)
      const parsed = parseContentKey(contentKey) as ParsedBilibiliContentKey

      expect(parsed).not.toBeNull()
      expect(
        buildBilibiliContentKey(parsed.videoId, parsed.pageIndex),
      ).toBe(contentKey)
    }
  })

  it("returns null for a BVID rejected by the shared validator", () => {
    expect(parseContentKey("bilibili:xxx:p:1")).toBeNull()
    expect(parseContentKey("bilibili:BV123:p:1")).toBeNull()
    expect(parseContentKey(`bilibili:${VALID_BVID}D:p:1`)).toBeNull()
    expect(parseContentKey("bilibili:bv1xx411c7md:p:1")).toBeNull()
    expect(parseContentKey("bilibili::p:1")).toBeNull()
  })

  it("returns null when the p segment is missing", () => {
    expect(parseContentKey(`bilibili:${VALID_BVID}`)).toBeNull()
    expect(parseContentKey(`bilibili:${VALID_BVID}:p`)).toBeNull()
  })

  it("returns null for a wrong literal part segment", () => {
    expect(parseContentKey(`bilibili:${VALID_BVID}:q:1`)).toBeNull()
    expect(parseContentKey(`bilibili:${VALID_BVID}:P:1`)).toBeNull()
    expect(parseContentKey(`bilibili:${VALID_BVID}::1`)).toBeNull()
    expect(parseContentKey(`bilibili:${VALID_BVID}:page:1`)).toBeNull()
  })

  it("returns null for empty, zero, negative pages", () => {
    expect(parseContentKey(`bilibili:${VALID_BVID}:p:`)).toBeNull()
    expect(parseContentKey(`bilibili:${VALID_BVID}:p:0`)).toBeNull()
    expect(parseContentKey(`bilibili:${VALID_BVID}:p:-1`)).toBeNull()
    expect(parseContentKey(`bilibili:${VALID_BVID}:p:+1`)).toBeNull()
  })

  it("returns null for non-canonical integer notation", () => {
    expect(parseContentKey(`bilibili:${VALID_BVID}:p:01`)).toBeNull()
    expect(parseContentKey(`bilibili:${VALID_BVID}:p:001`)).toBeNull()
    expect(parseContentKey(`bilibili:${VALID_BVID}:p:1.0`)).toBeNull()
    expect(parseContentKey(`bilibili:${VALID_BVID}:p:1e3`)).toBeNull()
    expect(parseContentKey(`bilibili:${VALID_BVID}:p:0x10`)).toBeNull()
  })

  it("returns null for non-numeric pages", () => {
    expect(parseContentKey(`bilibili:${VALID_BVID}:p:abc`)).toBeNull()
    expect(parseContentKey(`bilibili:${VALID_BVID}:p:1a`)).toBeNull()
    expect(parseContentKey(`bilibili:${VALID_BVID}:p: `)).toBeNull()
  })

  it("returns null for page indexes beyond the safe integer range", () => {
    expect(
      parseContentKey(`bilibili:${VALID_BVID}:p:9007199254740993`),
    ).toBeNull()
    expect(
      parseContentKey(`bilibili:${VALID_BVID}:p:99999999999999999999`),
    ).toBeNull()
  })

  it("returns null for extra segments", () => {
    expect(parseContentKey(`bilibili:${VALID_BVID}:p:1:extra`)).toBeNull()
    expect(parseContentKey(`bilibili:${VALID_BVID}:p:1:2`)).toBeNull()
    expect(parseContentKey(`bilibili:${VALID_BVID}:p:1:`)).toBeNull()
  })

  it("returns null when the whole key carries surrounding whitespace", () => {
    expect(parseContentKey(` bilibili:${VALID_BVID}:p:1`)).toBeNull()
    expect(parseContentKey(`bilibili:${VALID_BVID}:p:1 `)).toBeNull()
    expect(parseContentKey(`bilibili:${VALID_BVID}:p: 1`)).toBeNull()
    expect(parseContentKey(`bilibili:${VALID_BVID}:p:1\t`)).toBeNull()
  })

  it("returns null for an unknown platform in Bilibili shape", () => {
    expect(parseContentKey(`vimeo:${VALID_BVID}:p:1`)).toBeNull()
    expect(parseContentKey(`Bilibili:${VALID_BVID}:p:1`)).toBeNull()
  })
})

describe("parseContentKey: failure semantics", () => {
  const invalidInputs = [
    "",
    ":",
    "::",
    "youtube",
    "youtube:",
    "youtube:id:extra",
    "youtube::id",
    "youtube: id",
    "youtube:id ",
    " youtube:id",
    "youtube:\tid",
    `bilibili:${VALID_BVID}`,
    `bilibili:${VALID_BVID}:p`,
    `bilibili:${VALID_BVID}:p:`,
    `bilibili:${VALID_BVID}:p:0`,
    `bilibili:${VALID_BVID}:p:-1`,
    `bilibili:${VALID_BVID}:p:abc`,
    `bilibili:${VALID_BVID}:q:1`,
    `bilibili:${VALID_BVID}:p:1:extra`,
    "bilibili:xxx:p:1",
    "unknown:value",
  ]

  it("returns null instead of throwing for every malformed key", () => {
    for (const value of invalidInputs) {
      expect(() => parseContentKey(value)).not.toThrow()
      expect(parseContentKey(value)).toBeNull()
    }
  })
})
