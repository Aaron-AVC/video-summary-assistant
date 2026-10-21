import { describe, expect, it } from "bun:test"

import {
  copyMarkdownExport,
  downloadMarkdownExport,
  type MarkdownExportPayload,
} from "@/features/export/lib/markdown-delivery"

const PAYLOAD: MarkdownExportPayload = {
  markdown: "# Title\n\n- Platform: YouTube\n",
  filename: "Title [video-abc].md",
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

  it("propagates a clipboard failure", async () => {
    const failure = new Error("clipboard denied")

    await expect(
      copyMarkdownExport(PAYLOAD, async () => {
        throw failure
      })
    ).rejects.toBe(failure)
  })
})
