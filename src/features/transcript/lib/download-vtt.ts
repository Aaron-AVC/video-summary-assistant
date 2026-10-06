import type {
  DownloadTranscriptFn,
  DownloadTranscriptOptions,
  DownloadTranscriptPayload,
} from "./transcript-schema"

const MIME_TYPE = "text/vtt;charset=utf-8"
const OBJECT_URL_REVOKE_DELAY_MS = 1000

export async function downloadRawVtt({
  rawVtt,
  videoId,
  title,
  downloadImpl = browserDownload,
}: DownloadTranscriptOptions): Promise<DownloadTranscriptPayload> {
  const payload = createDownloadPayload(rawVtt, videoId, title)

  await downloadImpl(payload)

  return payload
}

export function createDownloadPayload(
  rawVtt: string,
  videoId: string,
  title?: string | null,
): DownloadTranscriptPayload {
  return {
    filename: buildTranscriptFilename(videoId, title),
    rawVtt,
    mimeType: MIME_TYPE,
  }
}

export function buildTranscriptFilename(
  videoId: string,
  title?: string | null,
): string {
  const slug = (title ?? videoId)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return `${slug || videoId}-${videoId}.vtt`
}

const browserDownload: DownloadTranscriptFn = async ({ filename, rawVtt, mimeType }) => {
  const blob = new Blob([rawVtt], { type: mimeType })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement("a")

  anchor.href = objectUrl
  anchor.download = filename
  anchor.click()

  // Defer revoke so the browser has time to start the download.
  // Revoking synchronously can race the navigation and produce empty files.
  setTimeout(() => URL.revokeObjectURL(objectUrl), OBJECT_URL_REVOKE_DELAY_MS)
}
