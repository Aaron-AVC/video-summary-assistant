import { describe, expect, it } from "bun:test"

import { buildWbiSignedUrl, extractWbiKeys, md5 } from "./wbi"

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
    expect(keys?.mixinKey).toBe("efcc63210350add46bf224ad87987708")
  })

  it("matches an independent fixed WBI signing vector with encoded and sanitized values", () => {
    const keys = extractWbiKeys({
      data: { wbi_img: {
        img_url: "https://i0.hdslb.com/bfs/wbi/abcdef1234567890abcdef1234567890.png",
        sub_url: "https://i0.hdslb.com/bfs/wbi/1234567890abcdef1234567890abcdef.png",
      } },
    })!
    const signed = new URL(buildWbiSignedUrl(
      "https://api.bilibili.com/x/player/wbi/v2",
      { aid: 1, cid: 2, bvid: "BV1xx411c7mD", special: "a/b?c&d='()*!" },
      keys,
      1_700_000_000,
    ))
    const expectedCanonicalQuery = "aid=1&bvid=BV1xx411c7mD&cid=2&special=a%2Fb%3Fc%26d%3D&wts=1700000000"
    expect(keys.mixinKey).toBe("efcc63210350add46bf224ad87987708")
    expect(signed.search.slice(1, signed.search.lastIndexOf("&w_rid="))).toBe(expectedCanonicalQuery)
    expect(signed.searchParams.get("wts")).toBe("1700000000")
    expect(signed.searchParams.get("w_rid")).toBe("4fc255577be756438dd7c557f360259b")
  })

  it("matches RFC 1321 MD5 known vectors", () => {
    expect(md5("")).toBe("d41d8cd98f00b204e9800998ecf8427e")
    expect(md5("a")).toBe("0cc175b9c0f1b6a831c399e269772661")
    expect(md5("abc")).toBe("900150983cd24fb0d6963f7d28e17f72")
  })
})
