import { describe, expect, it } from "bun:test"

import {
  convertTranscriptDomToVtt,
  parseTranscriptTimestamp,
  readTranscriptSegments,
} from "./fetch-transcript-dom"

describe("parseTranscriptTimestamp", () => {
  it("parses minute-second transcript timestamps", () => {
    expect(parseTranscriptTimestamp("1:23")).toBe(83_000)
  })

  it("parses hour-minute-second transcript timestamps", () => {
    expect(parseTranscriptTimestamp("1:02:03")).toBe(3_723_000)
  })

  it("returns null for invalid transcript timestamps", () => {
    expect(parseTranscriptTimestamp("soon")).toBeNull()
  })
})

describe("readTranscriptSegments", () => {
  it("reads transcript rows from transcript segment renderers", () => {
    const root = createTranscriptRoot([
      { timestamp: "0:05", text: "Hello world" },
      { timestamp: "0:08", text: "Second line" },
      { timestamp: "bad", text: "Ignored row" },
    ])

    expect(readTranscriptSegments(root)).toEqual([
      {
        startMs: 5_000,
        endMs: null,
        text: "Hello world",
      },
      {
        startMs: 8_000,
        endMs: null,
        text: "Second line",
      },
    ])
  })
})

describe("convertTranscriptDomToVtt", () => {
  it("converts transcript rows into VTT", () => {
    const root = createTranscriptRoot([
      { timestamp: "0:05", text: "Hello world" },
      { timestamp: "0:08", text: "Second line" },
    ])

    expect(convertTranscriptDomToVtt(root)).toBe([
      "WEBVTT",
      "",
      "1",
      "00:00:05.000 --> 00:00:08.000",
      "Hello world",
      "",
      "2",
      "00:00:08.000 --> 00:00:09.000",
      "Second line",
      "",
    ].join("\n"))
  })
})

function createTranscriptRoot(rows: Array<{ timestamp: string; text: string }>) {
  const elements = rows.map((row) => ({
    querySelector: (selector: string) => {
      if (selector === ".segment-timestamp") {
        return { textContent: row.timestamp }
      }

      if (selector === ".segment-text") {
        return { textContent: row.text }
      }

      return null
    },
  }))

  return {
    querySelectorAll: () => elements,
  }
}
