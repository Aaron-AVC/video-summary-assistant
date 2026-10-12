import { describe, expect, it } from "bun:test"

import {
  convertTranscriptDomToVtt,
  findTranscriptContainer,
  findTranscriptRows,
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
  it("queries modern row descendants of a real container without treating a row as its own root", async () => {
    const { document, container, rows } = createModernTranscriptDocument(true)
    expect(findTranscriptContainer(document)).toBe(container as unknown as Element)
    expect(findTranscriptRows(container)).toEqual(rows)
    expect(rows[0]?.querySelector("transcript-segment-view-model")).toBeNull()

    const result = await fetchTranscriptDom({ document, metadata: emptyMetadata() })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("Expected rendered transcript success")
    expect(result.rawVtt).toContain("Modern first row")
    expect(result.rawVtt).toContain("Modern second row")
  })

  it("uses a document-level modern-row fallback when no container exists", async () => {
    const { document } = createModernTranscriptDocument(false)

    const result = await fetchTranscriptDom({ document, metadata: emptyMetadata() })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("Expected document-level rendered transcript success")
    expect(result.rawVtt).toContain("Modern first row")
    expect(result.rawVtt).toContain("Modern second row")
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

function emptyMetadata() {
  return {
    videoId: "video123456",
    title: null,
    tracks: [],
    captionsAvailable: false,
    transcriptPanel: null,
  }
}

type FakeDomNode = {
  selector: string
  textContent: string
  children: FakeDomNode[]
  querySelector: (selector: string) => FakeDomNode | null
  querySelectorAll: (selector: string) => FakeDomNode[]
  closest: () => null
  getAttribute: () => null
}

function createModernTranscriptDocument(withContainer: boolean): {
  document: Document
  container: FakeDomNode | null
  rows: FakeDomNode[]
} {
  const rows = [
    createModernRow("0:07", "Modern first row"),
    createModernRow("0:12", "Modern second row"),
  ]
  const container = withContainer
    ? createFakeNode(".ytwTranscriptViewModelHost", "", rows)
    : null
  const documentRoot = createFakeNode("document", "", container ? [container] : rows)
  const document = documentRoot as unknown as Document
  return { document, container, rows }
}

function createModernRow(timestamp: string, text: string): FakeDomNode {
  return createFakeNode("transcript-segment-view-model", `${timestamp} ${text}`, [
    createFakeNode("span.ytwTranscriptSegmentViewModelTimestamp", timestamp),
    createFakeNode("span.ytAttributedStringHost[role='text']", text),
  ])
}

function createFakeNode(selector: string, textContent: string, children: FakeDomNode[] = []): FakeDomNode {
  const node: FakeDomNode = {
    selector,
    textContent,
    children,
    querySelector: (requestedSelector) => node.querySelectorAll(requestedSelector)[0] ?? null,
    querySelectorAll: (requestedSelector) => {
      const selectors = requestedSelector.split(",").map((item) => item.trim())
      const matches: FakeDomNode[] = []
      const visit = (child: FakeDomNode) => {
        if (selectors.some((item) => item === child.selector)) matches.push(child)
        for (const descendant of child.children) visit(descendant)
      }
      for (const child of children) visit(child)
      return matches
    },
    closest: () => null,
    getAttribute: () => null,
  }
  return node
}
