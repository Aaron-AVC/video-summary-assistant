import { describe, expect, it } from "bun:test"

import {
  copyMarkdownExport,
  downloadMarkdownExport,
  type MarkdownExportPayload,
} from "@/features/export/lib/markdown-delivery"
import {
  DEFAULT_MARKDOWN_EXPORT_SECTIONS,
  buildMarkdownExport,
  type MarkdownExportRequest,
} from "@/features/export/lib/markdown-export"

const PAYLOAD: MarkdownExportPayload = {
  markdown: "# Title\n\n- Platform: YouTube\n",
  filename: "Title [video-abc].md",
}

/**
 * Builds a fresh production payload on every call, mirroring the side panel
 * where Copy and Download each rebuild the Markdown from current state.
 */
function productionPayload(): MarkdownExportPayload {
  const request: MarkdownExportRequest = {
    identity: {
      contentKey: "youtube:video-abc",
      platform: "youtube",
      videoId: "video-abc",
      partId: null,
    },
    title: "Understanding Tests",
    author: "Test Author",
    canonicalUrl: "https://example.com/watch?v=video-abc",
    analysis: {
      contentKey: "youtube:video-abc",
      analysis: {
        summary: "A concise summary.",
        keyPoints: [{ text: "Point one.", startSec: 12, endSec: 20 }],
        chapters: [
          {
            title: "Opening",
            startSec: 0,
            endSec: 90,
            summary: "Sets up.",
            detail: "Details.",
          },
        ],
      },
      analysisRunId: "run-1",
      lastAnalyzedAt: "2026-01-01T00:00:00.000Z",
    },
    transcript: {
      contentKey: "youtube:video-abc",
      cues: [{ startSec: 12, endSec: 15, text: "Hello there." }],
    },
    knowledge: {
      contentKey: "youtube:video-abc",
      items: [
        {
          id: "knowledge-1",
          kind: "bookmark",
          contentKey: "youtube:video-abc",
          platform: "youtube",
          videoId: "video-abc",
          partId: null,
          videoTitle: "Understanding Tests",
          analysisRunId: null,
          startSec: 12,
          endSec: null,
          text: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
    sections: DEFAULT_MARKDOWN_EXPORT_SECTIONS,
  }

  return buildMarkdownExport(request)
}

describe("markdown export delivery", () => {
  it("copies exactly the built markdown", async () => {
    const written: string[] = []

    await copyMarkdownExport(PAYLOAD, async (text) => {
      written.push(text)
    })

    expect(written).toEqual([PAYLOAD.markdown])
  })

  it("downloads the same payload that is copied", async () => {
    let copied: string | null = null
    const downloaded: Array<{ filename: string; text: string }> = []

    await copyMarkdownExport(PAYLOAD, async (text) => {
      copied = text
    })
    downloadMarkdownExport(PAYLOAD, (filename, text) => {
      downloaded.push({ filename, text })
    })

    expect(copied).toBe(PAYLOAD.markdown)
    expect(downloaded).toEqual([{ filename: PAYLOAD.filename, text: PAYLOAD.markdown }])
  })

  it("produces identical text for two independently built payloads", async () => {
    let copied: string | null = null
    const downloaded: Array<{ filename: string; text: string }> = []

    const first = productionPayload()
    const second = productionPayload()

    await copyMarkdownExport(first, async (text) => {
      copied = text
    })
    downloadMarkdownExport(second, (filename, text) => {
      downloaded.push({ filename, text })
    })

    expect(first.markdown).toBe(second.markdown)
    expect(first.filename).toBe(second.filename)
    expect(copied).toBe(first.markdown)
    expect(downloaded).toEqual([{ filename: second.filename, text: second.markdown }])
  })

  it("propagates a clipboard failure", async () => {
    const failure = new Error("clipboard denied")

    await expect(
      copyMarkdownExport(PAYLOAD, async () => {
        throw failure
      })
    ).rejects.toBe(failure)
  })
})
