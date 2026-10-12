import { describe, expect, it } from "bun:test"

import {
  convertTranscriptDomToVtt,
  fetchTranscriptDom,
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

  it("reads modern transcript-segment-view-model rows", () => {
    const root = createRoot([
      {
        timestamp: "0:07",
        text: "Modern first row",
        modern: true,
      },
      {
        timestamp: "0:12",
        text: "Modern second row",
        modern: true,
      },
    ])

    expect(readTranscriptSegments(root)).toEqual([
      { startMs: 7_000, endMs: null, text: "Modern first row" },
      { startMs: 12_000, endMs: null, text: "Modern second row" },
    ])
  })
})

describe("fetchTranscriptDom modern discovery", () => {
  it("loads rendered modern rows even when metadata has no caption tracks", async () => {
    const row = {
      textContent: "0:07 Modern row",
      querySelector: (selector: string) => selector.includes("Timestamp") || selector.includes("timestamp")
        ? { textContent: "0:07" }
        : selector.includes("Text") || selector.includes("text")
          ? { textContent: "Modern row" }
          : null,
    }
    const root = {
      querySelector: (selector: string) => selector.includes("transcript-segment-view-model") ? row : null,
      querySelectorAll: () => [row],
    }
    const document = {
      querySelector: (selector: string) => selector === "transcript-segment-view-model" ? root : null,
    } as unknown as Document

    const result = await fetchTranscriptDom({
      document,
      metadata: {
        videoId: "video123456",
        title: null,
        tracks: [],
        captionsAvailable: false,
        transcriptPanel: null,
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("Expected rendered transcript success")
    expect(result.rawVtt).toContain("Modern row")
  })
})

function createRoot(rows: Array<{ timestamp: string; text: string; modern?: boolean }>) {
  return {
    querySelectorAll: (selector: string) => rows.map((row) => ({
      textContent: `${row.timestamp} ${row.text}`,
      querySelector: (childSelector: string) => {
        if (childSelector.includes("Timestamp") || childSelector.includes("timestamp")) {
          return { textContent: row.timestamp }
        }
        if (childSelector.includes("Text") || childSelector.includes("text")) {
          return { textContent: row.text }
        }
        return null
      },
    })).filter(() => selector.includes("transcript-segment-view-model")),
  }
}

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
