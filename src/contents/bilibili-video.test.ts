import { describe, expect, it } from "bun:test"

import { fetchBilibiliVideoTranscript, config } from "@/contents/bilibili-video"
import { FETCH_VIDEO_TRANSCRIPT } from "@/lib/runtime/messages"
import type { FetchLike } from "@/features/transcript/lib/transcript-schema"

const BVID = "BV1xx411c7mD"
const P2_URL = `https://www.bilibili.com/video/${BVID}/?p=2`

describe("Bilibili content-script wiring", () => {
  it("registers only the supported www video-path match", () => {
    expect(config.matches).toEqual(["https://www.bilibili.com/video/*"])
  })

  it("returns generic VideoInfo and normalized TranscriptSegment data for the active part", async () => {
    const fetchImpl: FetchLike = async (input) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/view")) {
        return jsonResponse({ code: 0, data: {
          aid: 9001,
          bvid: BVID,
          title: "Collection",
          owner: { name: "Uploader" },
          cid: 111,
          duration: 999,
          pages: [
            { cid: 111, page: 1, part: "P1", duration: 120 },
            { cid: 222, page: 2, part: "P2", duration: 300 },
          ],
        } })
      }
      if (url.pathname.endsWith("/wbi/v2")) {
        expect(url.searchParams.get("cid")).toBe("222")
        return jsonResponse({ code: 0, data: { subtitle: { subtitles: [
          { id: 1, lan: "zh-CN", lan_doc: "中文", subtitle_url: "//aisubtitle.hdslb.com/bfs/subtitle/p2.json" },
        ] } } })
      }
      return jsonResponse({ body: [{ from: 2, to: 4, content: "Part two only" }] })
    }

    const result = await fetchBilibiliVideoTranscript(createDocument(), createLocation(P2_URL), fetchImpl)
    expect(result.ok).toBe(true)
    expect(result.type).toBe(FETCH_VIDEO_TRANSCRIPT)
    if (!result.ok || result.type !== FETCH_VIDEO_TRANSCRIPT) throw new Error("Expected transcript success")
    expect(result.video).toMatchObject({
      platform: "bilibili",
      videoId: BVID,
      partId: "2",
      contentKey: `bilibili:${BVID}:p:2`,
      durationSec: 300,
      canonicalUrl: P2_URL,
    })
    expect(result.transcript.segments).toEqual([
      { startSec: 2, endSec: 4, text: "Part two only" },
    ])
    expect(JSON.stringify(result)).not.toContain("subtitle_url")
    expect(JSON.stringify(result)).not.toContain("cid")
    expect(JSON.stringify(result)).not.toContain("aid")
  })
})

function createDocument(): Document {
  return { title: "Bilibili" } as unknown as Document
}

function createLocation(href: string): Location {
  return { href } as Location
}

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify(payload),
  }
}
