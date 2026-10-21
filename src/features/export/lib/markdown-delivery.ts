/**
 * Copy and download must receive the exact same payload. Both entry points take
 * the already-built result, so the browser-facing effect can be injected in
 * tests without touching `navigator` or the DOM.
 */

export type MarkdownExportPayload = {
  markdown: string
  filename: string
}

export type MarkdownClipboardWriter = (text: string) => Promise<void>

export type MarkdownFileWriter = (filename: string, text: string) => void

export async function copyMarkdownExport(
  payload: MarkdownExportPayload,
  writeClipboard: MarkdownClipboardWriter
): Promise<void> {
  await writeClipboard(payload.markdown)
}

export function downloadMarkdownExport(
  payload: MarkdownExportPayload,
  writeFile: MarkdownFileWriter
): void {
  writeFile(payload.filename, payload.markdown)
}
