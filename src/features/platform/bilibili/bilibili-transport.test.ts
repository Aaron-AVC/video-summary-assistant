import { describe, expect, it } from "bun:test"

import {
  isAllowedBilibiliResourceUrl,
  isAllowedBilibiliTransport,
  normalizeBilibiliSubtitleUrl,
  readBilibiliResponseBytes,
} from "@/features/platform/bilibili/bilibili-transport"

const VIDEO_URL = "https://www.bilibili.com/video/BV1xx411c7mD/?p=2"

describe("Bilibili background transport allowlist", () => {
  it("reads binary endpoint bodies within a strict byte limit", async () => {
    const response = new Response(new Uint8Array([1, 2, 3, 4]))
    await expect(readBilibiliResponseBytes(response, 4)).resolves.toEqual(new Uint8Array([1, 2, 3, 4]))

    await expect(readBilibiliResponseBytes(
      new Response(new Uint8Array([1, 2, 3, 4, 5])),
      4,
    )).rejects.toThrow("size limit")
    await expect(readBilibiliResponseBytes(
      new Response(new Uint8Array([1]), { headers: { "content-length": "5" } }),
      4,
    )).rejects.toThrow("size limit")
  })

  it("allows only the required HTTPS Bilibili API endpoints and subtitle CDN hosts", () => {
    for (const url of [
      "https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD",
      "https://api.bilibili.com/x/web-interface/nav",
      "https://api.bilibili.com/x/player/wbi/v2?aid=1&cid=2&bvid=BV1xx411c7mD&wts=1700000000&w_rid=0123456789abcdef0123456789abcdef",
      "https://api.bilibili.com/x/player/v2?aid=1&cid=2&bvid=BV1xx411c7mD",
      "https://api.bilibili.com/x/v2/subtitle/web/view?oid=2&pid=9001&context_ext=%7B%22video_type%22%3A1%7D&type=1&cur_production_type=0",
      "https://aisubtitle.hdslb.com/bfs/subtitle/test.json",
      "https://i0.hdslb.com/bfs/subtitle/test.json",
      "https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/11671464575180438961942083e762ac3b67f0743d3aff84578f36f1d5",
    ]) {
      expect(isAllowedBilibiliResourceUrl(url)).toBe(true)
      expect(isAllowedBilibiliTransport(url, VIDEO_URL)).toBe(true)
    }
  })

  it("rejects arbitrary endpoints, suffix-confusion hosts, non-HTTPS schemes, and unsafe senders", () => {
    for (const url of [
      "https://api.bilibili.com/x/v2/reply/main?oid=1",
      "https://api.bilibili.com/x/player/wbi/v2?aid=1&cid=2&bvid=BV1xx411c7mD",
      "https://api.bilibili.com.evil.example/x/player/v2",
      "https://evil-hdslb.com/subtitle.json",
      "https://hdslb.com/subtitle.json",
      "https://aisubtitle.hdslb.com:8443/subtitle.json",
      "http://api.bilibili.com/x/player/v2",
      "file:///C:/private.txt",
      "data:application/json,{}",
      "javascript:alert(1)",
      "https://user:pass@api.bilibili.com/x/player/v2",
    ]) {
      expect(isAllowedBilibiliResourceUrl(url)).toBe(false)
    }

    expect(isAllowedBilibiliTransport(
      "https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD",
      "https://www.bilibili.com/video/",
    )).toBe(false)
    expect(isAllowedBilibiliTransport(
      "https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD",
      "https://m.bilibili.com/video/BV1xx411c7mD",
    )).toBe(false)
  })

  it("normalizes protocol-relative CDN URLs and rejects unsafe subtitle URLs", () => {
    expect(normalizeBilibiliSubtitleUrl("//aisubtitle.hdslb.com/bfs/subtitle/a.json"))
      .toBe("https://aisubtitle.hdslb.com/bfs/subtitle/a.json")
    expect(normalizeBilibiliSubtitleUrl("https://aisubtitle.hdslb.com/bfs/subtitle/a.json"))
      .toBe("https://aisubtitle.hdslb.com/bfs/subtitle/a.json")
    expect(normalizeBilibiliSubtitleUrl(
      "//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/11671464575180438961942083e762ac3b67f0743d3aff84578f36f1d5",
    )).toBe("https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/11671464575180438961942083e762ac3b67f0743d3aff84578f36f1d5")
    for (const url of [
      "http://aisubtitle.hdslb.com/a.json",
      "javascript:alert(1)",
      "data:application/json,{}",
      "https://evil.example/a.json",
      "//api.bilibili.com/x/player/v2",
      "https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/",
      "https://aisubtitle.hdslb.com/bfs/ai_subtitle/dev/opaque-id",
      "https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/../opaque-id",
      "https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/%2e%2e/opaque-id",
      "https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/opaque%2Fid",
      "https://aisubtitle.hdslb.com/bfs/arbitrary/prod/opaque-id",
      "https://hdslb.com/bfs/ai_subtitle/prod/opaque-id",
    ]) {
      expect(normalizeBilibiliSubtitleUrl(url)).toBeNull()
      if (url.startsWith("https://")) expect(isAllowedBilibiliResourceUrl(url)).toBe(false)
    }
  })
})
