import { describe, expect, it } from "bun:test"

import {
  buildCanonicalBilibiliUrl,
  extractBvid,
  extractPageIndex,
  getBilibiliVideoUrlError,
  isSupportedBilibiliVideoUrl,
} from "@/features/platform/bilibili/bilibili-url"
import { bilibiliAdapter } from "@/features/platform/bilibili/bilibili-adapter"

const BVID = "BV1xx411c7mD"

describe("Bilibili URL and identity", () => {
  it("accepts a single-part URL with and without a trailing slash", () => {
    for (const href of [
      `https://www.bilibili.com/video/${BVID}`,
      `https://www.bilibili.com/video/${BVID}/`,
    ]) {
      expect(isSupportedBilibiliVideoUrl(href)).toBe(true)
      expect(extractBvid(href)).toBe(BVID)
      expect(extractPageIndex(href)).toBe(1)
    }
  })

  it("keeps P1 and P2 identities distinct synchronously from the URL", () => {
    const p1 = bilibiliAdapter.getVideoIdentity(new URL(`https://www.bilibili.com/video/${BVID}/`))
    const p2 = bilibiliAdapter.getVideoIdentity(new URL(`https://www.bilibili.com/video/${BVID}/?p=2`))

    expect(p1).toEqual({
      platform: "bilibili",
      videoId: BVID,
      partId: "1",
      contentKey: `bilibili:${BVID}:p:1`,
    })
    expect(p2).toEqual({
      platform: "bilibili",
      videoId: BVID,
      partId: "2",
      contentKey: `bilibili:${BVID}:p:2`,
    })
    expect(p1?.contentKey).not.toBe(p2?.contentKey)
  })

  it("rejects invalid BV IDs, invalid page indexes, and unsupported locations", () => {
    for (const href of [
      "https://www.bilibili.com/",
      "https://www.bilibili.com/video/BV123/",
      `https://www.bilibili.com/video/${BVID}/?p=0`,
      `https://www.bilibili.com/video/${BVID}/?p=1.5`,
      `https://www.bilibili.com/video/${BVID}/?p=2&p=3`,
      "https://www.bilibili.com/bangumi/play/ep123",
      `https://m.bilibili.com/video/${BVID}`,
      `https://b23.tv/${BVID}`,
      "https://www.bilibili.com/list/watchlater",
      `https://space.bilibili.com/1/video/${BVID}`,
      `http://www.bilibili.com/video/${BVID}/`,
      `https://www.bilibili.com/video/${BVID}/extra`,
    ]) {
      expect(isSupportedBilibiliVideoUrl(href)).toBe(false)
      expect(bilibiliAdapter.getVideoIdentity(new URL(href))).toBeNull()
    }

    expect(extractBvid(`https://www.bilibili.com/video/${BVID}/?p=0`)).toBe(BVID)
    expect(extractBvid("https://www.bilibili.com/video/BV123/")).toBeNull()
    expect(extractPageIndex(`https://www.bilibili.com/video/${BVID}/?p=0`)).toBeNull()
  })

  it("builds canonical URLs for P1 and later parts", () => {
    expect(buildCanonicalBilibiliUrl(BVID, 1)).toBe(`https://www.bilibili.com/video/${BVID}/`)
    expect(buildCanonicalBilibiliUrl(BVID, 2)).toBe(`https://www.bilibili.com/video/${BVID}/?p=2`)
  })

  it("classifies invalid BV IDs and page indexes without mislabeling unsupported pages", () => {
    expect(getBilibiliVideoUrlError("https://www.bilibili.com/video/BV123/")).toBe("Bilibili BV ID 无效。")
    expect(getBilibiliVideoUrlError(`https://www.bilibili.com/video/${BVID}/?p=0`))
      .toBe("Bilibili 分P编号无效。")
    expect(getBilibiliVideoUrlError("https://www.bilibili.com/bangumi/play/ep123")).toBeNull()
    expect(getBilibiliVideoUrlError(`https://m.bilibili.com/video/${BVID}/`)).toBeNull()
  })
})
