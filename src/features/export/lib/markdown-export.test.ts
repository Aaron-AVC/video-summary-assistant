import { describe, expect, it } from "bun:test"

import type { VideoAnalysis } from "@/features/analysis/lib/analysis-schema"
import {
  DEFAULT_MARKDOWN_EXPORT_SECTIONS,
  buildMarkdownExport,
  formatExportTimestamp,
  sanitizeMarkdownFilename,
  type MarkdownExportIdentity,
  type MarkdownExportRequest,
} from "@/features/export/lib/markdown-export"
import { en } from "@/lib/i18n/en"
import { zhCN } from "@/lib/i18n/zh-CN"
import type { KnowledgeItemEntity } from "@/lib/schemas/persistence"

const YOUTUBE: MarkdownExportIdentity = {
  contentKey: "youtube:video-abc",
  platform: "youtube",
  videoId: "video-abc",
  partId: null,
}

const BILI_P1: MarkdownExportIdentity = {
  contentKey: "bilibili:BV1test:p:1",
  platform: "bilibili",
  videoId: "BV1test",
  partId: "1",
}

const BILI_P2: MarkdownExportIdentity = {
  contentKey: "bilibili:BV1test:p:2",
  platform: "bilibili",
  videoId: "BV1test",
  partId: "2",
}

function analysisFixture(overrides: Partial<VideoAnalysis> = {}): VideoAnalysis {
  return {
    summary: "A concise summary of the video.",
    keyPoints: [
      { text: "First point.", startSec: 12, endSec: 20 },
      { text: "Second point without a range." },
    ],
    chapters: [
      {
        title: "Opening",
        startSec: 0,
        endSec: 90,
        summary: "Sets up the topic.",
        detail: "Explains the setup in detail.",
      },
    ],
    ...overrides,
  }
}

function knowledgeItem(overrides: Partial<KnowledgeItemEntity> = {}): KnowledgeItemEntity {
  return {
    id: "knowledge-1",
    kind: "bookmark",
    contentKey: YOUTUBE.contentKey,
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
    ...overrides,
  }
}

function request(overrides: Partial<MarkdownExportRequest> = {}): MarkdownExportRequest {
  return {
    identity: YOUTUBE,
    title: "Understanding Tests",
    canonicalUrl: "https://example.com/watch?v=video-abc",
    analysis: {
      contentKey: YOUTUBE.contentKey,
      analysis: analysisFixture(),
      analysisRunId: "run-1",
      lastAnalyzedAt: "2026-01-01T00:00:00.000Z",
    },
    transcript: {
      contentKey: YOUTUBE.contentKey,
      cues: [
        { startSec: 12, endSec: 15, text: "Hello there." },
        { startSec: 16, endSec: 18, text: "Second line." },
      ],
    },
    knowledge: {
      contentKey: YOUTUBE.contentKey,
      items: [knowledgeItem()],
    },
    sections: DEFAULT_MARKDOWN_EXPORT_SECTIONS,
    generatedAt: "2026-02-02T10:00:00.000Z",
    ...overrides,
  }
}

describe("markdown export formatter", () => {
  it("writes the header with the canonical runtime identity", () => {
    const result = buildMarkdownExport(request())

    expect(result.markdown).toContain("# Understanding Tests")
    expect(result.markdown).toContain("- Platform: YouTube")
    expect(result.markdown).toContain("- Video ID: video-abc")
    expect(result.markdown).toContain("- Content key: `youtube:video-abc`")
    expect(result.markdown).toContain("- URL: https://example.com/watch?v=video-abc")
    expect(result.markdown).toContain("- Exported: 2026-02-02T10:00:00.000Z")
    expect(result.markdown).not.toContain("- Part:")
  })

  it("writes sections in a stable order", () => {
    const { markdown } = buildMarkdownExport(request())

    const order = ["## Summary", "## Key points", "## Chapters", "## Transcript", "## Bookmarks and notes"]
    const positions = order.map((heading) => markdown.indexOf(heading))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((left, right) => left - right)).toEqual(positions)
  })

  it("renders point and range timestamps without locale formatting", () => {
    const { markdown } = buildMarkdownExport(request())

    expect(markdown).toContain("- **0:12 – 0:20** — First point.")
    expect(markdown).toContain("- Second point without a range.")
    expect(markdown).toContain("### 0:00 – 1:30 Opening")
    expect(markdown).toContain("- **[0:12 – 0:15]** Hello there.")
    expect(markdown).toContain("- **Bookmark** at 0:12")
    expect(formatExportTimestamp(3661)).toBe("1:01:01")
  })

  it("renders anchored and unanchored notes", () => {
    const { markdown } = buildMarkdownExport(
      request({
        knowledge: {
          contentKey: YOUTUBE.contentKey,
          items: [
            knowledgeItem({
              id: "note-anchored",
              kind: "note",
              startSec: 30,
              text: "Anchored note.",
            }),
            knowledgeItem({
              id: "note-free",
              kind: "note",
              startSec: null,
              text: "Unanchored note.",
            }),
          ],
        },
      })
    )

    expect(markdown).toContain("- **Note** at 0:30 — Anchored note.")
    expect(markdown).toContain("- **Note** — Unanchored note.")
    expect(markdown.indexOf("Anchored note.")).toBeLessThan(markdown.indexOf("Unanchored note."))
  })

  it("keeps transcript cues in order and skips blank text", () => {
    const { markdown } = buildMarkdownExport(
      request({
        transcript: {
          contentKey: YOUTUBE.contentKey,
          cues: [
            { startSec: 1, endSec: 2, text: "One." },
            { startSec: 3, endSec: 4, text: "   " },
            { startSec: 5, endSec: 6, text: "Two." },
          ],
        },
      })
    )

    expect(markdown).toContain("- **[0:01 – 0:02]** One.")
    expect(markdown).toContain("- **[0:05 – 0:06]** Two.")
    expect(markdown.indexOf("One.")).toBeLessThan(markdown.indexOf("Two."))
  })

  it("drops sections whose contentKey does not match the runtime identity", () => {
    const { markdown, includedSections } = buildMarkdownExport(
      request({
        analysis: {
          contentKey: "youtube:other-video",
          analysis: analysisFixture({ summary: "Leaked summary." }),
          analysisRunId: null,
          lastAnalyzedAt: null,
        },
      })
    )

    expect(markdown).not.toContain("Leaked summary.")
    expect(markdown).not.toContain("## Summary")
    expect(includedSections).not.toContain("analysis")
    expect(includedSections).toEqual(["transcript", "knowledge"])
  })

  it("never mixes data across a video switch", () => {
    const otherIdentity: MarkdownExportIdentity = {
      contentKey: "youtube:video-other",
      platform: "youtube",
      videoId: "video-other",
      partId: null,
    }
    const { markdown, includedSections } = buildMarkdownExport(
      request({ identity: otherIdentity })
    )

    expect(markdown).not.toContain("A concise summary of the video.")
    expect(markdown).not.toContain("Hello there.")
    expect(markdown).not.toContain("First point.")
    expect(markdown).not.toContain("- **Bookmark**")
    expect(includedSections).toEqual([])
    expect(markdown.startsWith("# Understanding Tests")).toBe(true)
  })

  it("keeps Bilibili parts isolated", () => {
    const { markdown, includedSections } = buildMarkdownExport(
      request({
        identity: BILI_P1,
        title: "Part one",
        analysis: {
          contentKey: BILI_P2.contentKey,
          analysis: analysisFixture({ summary: "Part two summary." }),
          analysisRunId: null,
          lastAnalyzedAt: null,
        },
        transcript: {
          contentKey: BILI_P2.contentKey,
          cues: [{ startSec: 0, endSec: 1, text: "Part two transcript." }],
        },
        knowledge: {
          contentKey: BILI_P1.contentKey,
          items: [
            knowledgeItem({
              id: "p1-note",
              kind: "note",
              contentKey: BILI_P1.contentKey,
              platform: "bilibili",
              videoId: "BV1test",
              partId: "1",
              startSec: null,
              text: "Part one note.",
            }),
            knowledgeItem({
              id: "p2-note",
              kind: "note",
              contentKey: BILI_P2.contentKey,
              platform: "bilibili",
              videoId: "BV1test",
              partId: "2",
              startSec: null,
              text: "Part two note.",
            }),
          ],
        },
      })
    )

    expect(markdown).toContain("- Platform: Bilibili")
    expect(markdown).toContain("- Part: 1")
    expect(markdown).toContain("Part one note.")
    expect(markdown).not.toContain("Part two note.")
    expect(markdown).not.toContain("Part two summary.")
    expect(markdown).not.toContain("Part two transcript.")
    expect(includedSections).toEqual(["knowledge"])
  })

  it("honours user-selected sections", () => {
    const { markdown, includedSections } = buildMarkdownExport(
      request({ sections: { analysis: false, transcript: false, knowledge: true } })
    )

    expect(markdown).toContain("## Bookmarks and notes")
    expect(markdown).not.toContain("## Summary")
    expect(markdown).not.toContain("## Transcript")
    expect(includedSections).toEqual(["knowledge"])
  })

  it("omits everything when no section is selected", () => {
    const { includedSections } = buildMarkdownExport(
      request({ sections: { analysis: false, transcript: false, knowledge: false } })
    )

    expect(includedSections).toEqual([])
  })

  it("is deterministic for identical input", () => {
    const first = buildMarkdownExport(request())
    const second = buildMarkdownExport(request())

    expect(second).toEqual(first)

    const later = buildMarkdownExport(request({ generatedAt: "2026-03-03T10:00:00.000Z" }))
    expect(later.markdown).not.toBe(first.markdown)
    expect(later.markdown).toContain("2026-03-03T10:00:00.000Z")
  })

  it("sanitizes filenames while preserving CJK characters", () => {
    expect(sanitizeMarkdownFilename("中文标题", YOUTUBE)).toBe("中文标题 [video-abc].md")
    expect(sanitizeMarkdownFilename('a/b:c*d?e"f<g>h|i', YOUTUBE)).toBe(
      "a-b-c-d-e-f-g-h-i [video-abc].md"
    )
    expect(sanitizeMarkdownFilename("   ", YOUTUBE)).toContain(".md")
    expect(sanitizeMarkdownFilename("Line\u0000break", YOUTUBE)).toBe(
      "Line break [video-abc].md"
    )
  })

  it("keeps Bilibili part filenames distinct even for long titles", () => {
    const longTitle = "很长很长的标题".repeat(20)
    const first = sanitizeMarkdownFilename(longTitle, BILI_P1)
    const second = sanitizeMarkdownFilename(longTitle, BILI_P2)

    expect(first).not.toBe(second)
    expect(first).toContain("[BV1test-p1]")
    expect(second).toContain("[BV1test-p2]")
    expect(first.length).toBeLessThanOrEqual(84)
  })
})

describe("markdown export i18n parity", () => {
  it("defines every export key in both locales", () => {
    const exportKeys = Object.keys(en)
      .filter((key) => key.startsWith("export."))
      .sort()
    const zhExportKeys = Object.keys(zhCN)
      .filter((key) => key.startsWith("export."))
      .sort()

    expect(exportKeys.length).toBeGreaterThan(0)
    expect(zhExportKeys).toEqual(exportKeys)
  })
})
