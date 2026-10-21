import { describe, expect, it } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { MarkdownExportPanel } from "@/features/export/components/markdown-export-panel"
import type { MarkdownExportAvailability } from "@/features/export/lib/markdown-export"

const ALL_AVAILABLE: MarkdownExportAvailability = {
  analysis: true,
  transcript: true,
  knowledge: true,
}

const NONE_AVAILABLE: MarkdownExportAvailability = {
  analysis: false,
  transcript: false,
  knowledge: false,
}

function disabledCount(html: string): number {
  // `data-disabled=""` also contains `disabled=""`, so match a real attribute.
  return (html.match(/\sdisabled=""/g) ?? []).length
}

describe("MarkdownExportPanel", () => {
  it("explains that export needs supported runtime content", () => {
    const html = renderToStaticMarkup(
      <MarkdownExportPanel
        isAvailable={false}
        availability={ALL_AVAILABLE}
        sections={{ analysis: true, transcript: true, knowledge: true }}
        onSectionsChange={() => {}}
        onCopy={() => {}}
        onDownload={() => {}}
      />
    )

    expect(html).toContain("Open a supported video to export Markdown.")
    expect(html).not.toContain("Copy Markdown")
  })

  it("renders the three section toggles and both actions", () => {
    const html = renderToStaticMarkup(
      <MarkdownExportPanel
        isAvailable
        availability={ALL_AVAILABLE}
        sections={{ analysis: true, transcript: true, knowledge: true }}
        onSectionsChange={() => {}}
        onCopy={() => {}}
        onDownload={() => {}}
      />
    )

    expect(html).toContain("Analysis")
    expect(html).toContain("Transcript")
    expect(html).toContain("Bookmarks &amp; notes")
    expect(html).toContain("Copy Markdown")
    expect(html).toContain("Download .md")
    expect(disabledCount(html)).toBe(0)
  })

  it("disables both actions when no section is selected", () => {
    const html = renderToStaticMarkup(
      <MarkdownExportPanel
        isAvailable
        availability={ALL_AVAILABLE}
        sections={{ analysis: false, transcript: false, knowledge: false }}
        onSectionsChange={() => {}}
        onCopy={() => {}}
        onDownload={() => {}}
      />
    )

    expect(disabledCount(html)).toBe(2)
  })

  it("disables an unavailable section control", () => {
    const html = renderToStaticMarkup(
      <MarkdownExportPanel
        isAvailable
        availability={{ analysis: false, transcript: true, knowledge: true }}
        sections={{ analysis: true, transcript: true, knowledge: true }}
        onSectionsChange={() => {}}
        onCopy={() => {}}
        onDownload={() => {}}
      />
    )

    // One disabled toggle, while both actions stay usable through the other
    // still-available sections.
    expect(disabledCount(html)).toBe(1)
    expect(html).toContain('aria-label="Analysis"')
  })

  it("disables both actions when no section has available content", () => {
    const html = renderToStaticMarkup(
      <MarkdownExportPanel
        isAvailable
        availability={NONE_AVAILABLE}
        sections={{ analysis: true, transcript: true, knowledge: true }}
        onSectionsChange={() => {}}
        onCopy={() => {}}
        onDownload={() => {}}
      />
    )

    expect(html).toContain("No selected section has content for this video.")
    // Three disabled toggles plus both disabled actions.
    expect(disabledCount(html)).toBe(5)
  })
})
