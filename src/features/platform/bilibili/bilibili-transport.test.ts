import { describe, expect, it } from "bun:test"

import {
  isAllowedBilibiliResourceUrl,
  isAllowedBilibiliTransport,
  normalizeBilibiliSubtitleUrl,
} from "@/features/platform/bilibili/bilibili-transport"

const VIDEO_URL = "https://www.bilibili.com/video/BV1xx411c7mD/?p=2"

describe("Bilibili background transport allowlist", () => {
  it("allows only the required HTTPS Bilibili API endpoints and subtitle CDN hosts", () => {
    for (const url of [
      "https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD",
      "https://api.bilibili.com/x/player/wbi/v2?aid=1&cid=2&bvid=BV1xx411c7mD",
      "https://api.bilibili.com/x/player/v2?aid=1&cid=2&bvid=BV1xx411c7mD",
      "https://aisubtitle.hdslb.com/bfs/subtitle/test.json",
      "https://i0.hdslb.com/bfs/subtitle/test.json",
    ]) {
      expect(isAllowedBilibiliResourceUrl(url)).toBe(true)
      expect(isAllowedBilibiliTransport(url, VIDEO_URL)).toBe(true)
    }
  })

  it("rejects arbitrary endpoints, suffix-confusion hosts, non-HTTPS schemes, and unsafe senders", () => {
    for (const url of [
      "https://api.bilibili.com/x/v2/reply/main?oid=1",
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
    for (const url of [
      "http://aisubtitle.hdslb.com/a.json",
      "javascript:alert(1)",
      "data:application/json,{}",
      "https://evil.example/a.json",
      "//api.bilibili.com/x/player/v2",
    ]) {
      expect(normalizeBilibiliSubtitleUrl(url)).toBeNull()
    }
  })
})
