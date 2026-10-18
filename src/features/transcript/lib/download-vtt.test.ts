import { describe, expect, it } from "bun:test"

import { downloadRawVtt } from "./download-vtt"

describe("downloadRawVtt", () => {
  it("downloads cached transcript text without requiring a source URL", async () => {
    const rawVtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nCached cue\n"
    let downloaded: unknown = null

    const payload = await downloadRawVtt({
      rawVtt,
      videoId: "video-1",
      title: "Video",
      downloadImpl: async (value) => { downloaded = value }
    })

    expect(payload.rawVtt).toBe(rawVtt)
    expect(downloaded).toEqual(payload)
  })
})
