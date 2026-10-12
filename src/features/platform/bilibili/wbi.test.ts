import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"

import { buildWbiSignedUrl, extractWbiKeys, getMixinKey } from "./wbi"

describe("Bilibili WBI signing", () => {
  it("extracts image keys and derives the mixin key", () => {
    const keys = extractWbiKeys({
      code: 0,
      data: {
        wbi_img: {
          img_url: "https://i0.hdslb.com/bfs/wbi/abcdef1234567890abcdef1234567890.png",
          sub_url: "https://i0.hdslb.com/bfs/wbi/1234567890abcdef1234567890abcdef.png",
        },
      },
    })
    expect(keys?.imgKey).toBe("abcdef1234567890abcdef1234567890")
    expect(keys?.subKey).toBe("1234567890abcdef1234567890abcdef")
    expect(keys?.mixinKey).toHaveLength(32)
  })

  it("builds a deterministic signed query with wts and w_rid", () => {
    const keys = {
      imgKey: "abcdef1234567890abcdef1234567890",
      subKey: "1234567890abcdef1234567890abcdef",
      mixinKey: getMixinKey("abcdef1234567890abcdef1234567890", "1234567890abcdef1234567890abcdef"),
    }
    const first = new URL(buildWbiSignedUrl(
      "https://api.bilibili.com/x/player/wbi/v2",
      { aid: 1, cid: 2, bvid: "BV1xx411c7mD" },
      keys,
      1_700_000_000,
    ))
    const second = new URL(buildWbiSignedUrl(
      "https://api.bilibili.com/x/player/wbi/v2",
      { aid: 1, cid: 2, bvid: "BV1xx411c7mD" },
      keys,
      1_700_000_000,
    ))
    expect(first.searchParams.get("wts")).toBe("1700000000")
    const canonicalQuery = "aid=1&bvid=BV1xx411c7mD&cid=2&wts=1700000000"
    const expectedSignature = createHash("md5")
      .update(`${canonicalQuery}${keys.mixinKey}`)
      .digest("hex")
    expect(first.searchParams.get("w_rid")).toBe(expectedSignature)
    expect(first.search).toBe(second.search)
  })
})
