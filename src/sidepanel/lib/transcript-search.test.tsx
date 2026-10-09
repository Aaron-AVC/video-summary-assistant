import { describe, expect, it } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import {
  HighlightedTranscriptText,
  filterTranscriptSegments,
  splitTranscriptHighlight
} from "@/sidepanel/components/transcript-tab"

const segments = [
  { startSec: 0, endSec: 5, text: "Alpha introduction" },
  { startSec: 5, endSec: 10, text: "BETA demonstration" },
  { startSec: 10, endSec: 15, text: "Closing notes" }
]

describe("transcript search", () => {
  it("returns all rows for an empty query and matches case-insensitively", () => {
    expect(filterTranscriptSegments(segments, "")).toEqual(segments)
    expect(filterTranscriptSegments(segments, "beta")).toEqual([segments[1]])
    expect(filterTranscriptSegments(segments, "ALPHA")).toEqual([segments[0]])
    expect(filterTranscriptSegments(segments, "missing")).toEqual([])
  })

  it("splits every plain-text occurrence for safe semantic highlighting", () => {
    expect(splitTranscriptHighlight("Beta beta", "BETA")).toEqual([
      { text: "Beta", isMatch: true },
      { text: " ", isMatch: false },
      { text: "beta", isMatch: true }
    ])
  })

  it("escapes transcript and query text instead of injecting HTML", () => {
    const markup = renderToStaticMarkup(
      <HighlightedTranscriptText
        text={'<img src=x onerror="alert(1)"> Alpha'}
        query={'<img'}
      />
    )
    expect(markup).toContain("<mark")
    expect(markup).toContain("&lt;img")
    expect(markup).not.toContain("<img src=")
    expect(markup).not.toContain("dangerouslySetInnerHTML")
  })
})
