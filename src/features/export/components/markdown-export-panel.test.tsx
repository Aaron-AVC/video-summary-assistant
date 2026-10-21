import { describe, expect, it } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { MarkdownExportPanel } from "@/features/export/components/markdown-export-panel"

describe("MarkdownExportPanel", () => {
  it("explains that export needs supported runtime content", () => {
    const html = renderToStaticMarkup(
      <MarkdownExportPanel
        isAvailable={false}
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
    expect(html).not.toContain('disabled=""')
  })

  it("disables both actions when no section is selected", () => {
    const html = renderToStaticMarkup(
      <MarkdownExportPanel
        isAvailable
        sections={{ analysis: false, transcript: false, knowledge: false }}
        onSectionsChange={() => {}}
        onCopy={() => {}}
        onDownload={() => {}}
      />
    )

    expect(html).toContain("disabled=\"\"")

    const disabledCount = html.split("disabled=\"\"").length - 1
    expect(disabledCount).toBe(2)
  })
})
