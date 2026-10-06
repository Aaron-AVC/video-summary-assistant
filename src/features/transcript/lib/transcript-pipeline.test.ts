import { describe, expect, it } from "bun:test"

import { buildTranscriptFilename, downloadRawVtt } from "./download-vtt"
import { normalizeCues } from "./normalize-cues"
import { parseTimestamp, parseVtt } from "./parse-vtt"

const RAW_VTT = `WEBVTT

1
00:00:00.000 --> 00:00:02.000
<v Speaker>Hello &amp; welcome</v>

2
00:00:02.500 --> 00:00:05.250
Second line`

describe("parseTimestamp", () => {
  it("parses hour and minute based timestamps", () => {
    expect(parseTimestamp("00:01:02.500")).toBe(62.5)
    expect(parseTimestamp("01:02.500")).toBe(62.5)
  })
})

describe("parseVtt", () => {
  it("parses VTT cues with identifiers", () => {
    const cues = parseVtt(RAW_VTT)

    expect(cues).toEqual([
      {
        identifier: "1",
        startSec: 0,
        endSec: 2,
        text: "<v Speaker>Hello &amp; welcome</v>",
      },
      {
        identifier: "2",
        startSec: 2.5,
        endSec: 5.25,
        text: "Second line",
      },
    ])
  })
})

describe("normalizeCues", () => {
  it("keeps cue timing while normalizing text", () => {
    expect(normalizeCues(parseVtt(RAW_VTT))).toEqual([
      {
        startSec: 0,
        endSec: 2,
        text: "Hello & welcome",
      },
      {
        startSec: 2.5,
        endSec: 5.25,
        text: "Second line",
      },
    ])
  })
})

describe("downloadRawVtt", () => {
  it("builds a stable filename and forwards the payload", async () => {
    let capturedFilename = ""

    const payload = await downloadRawVtt({
      rawVtt: RAW_VTT,
      videoId: "abc123",
      title: "My Great Video!",
      downloadImpl: async ({ filename }) => {
        capturedFilename = filename
      },
    })

    expect(capturedFilename).toBe("my-great-video-abc123.vtt")
    expect(payload.filename).toBe(buildTranscriptFilename("abc123", "My Great Video!"))
    expect(payload.rawVtt).toContain("WEBVTT")
  })
})
