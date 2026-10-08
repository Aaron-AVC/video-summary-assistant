import type { FetchLike } from "@/features/transcript/lib/transcript-schema"
import {
  isAllowedBilibiliResourceUrl,
  isAllowedBilibiliSubtitleUrl,
} from "@/features/platform/bilibili/bilibili-transport-policy"

export {
  isAllowedBilibiliResourceUrl,
  isAllowedBilibiliSubtitleUrl,
  isAllowedBilibiliTransport,
} from "@/features/platform/bilibili/bilibili-transport-policy"

export function normalizeBilibiliSubtitleUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null
  const raw = value.trim()
  const normalized = raw.startsWith("//") ? `https:${raw}` : raw
  return isAllowedBilibiliSubtitleUrl(normalized) ? normalized : null
}

export type BilibiliTransportResponse = {
  status: number
  body: string
}

export type BilibiliTransportRequest = (
  url: string,
) => Promise<BilibiliTransportResponse>

export async function readBilibiliResponseText(
  response: Response,
  maxBytes = 8 * 1024 * 1024,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("Bilibili resource response exceeded the size limit.")
  }

  if (!response.body) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error("Bilibili resource response exceeded the size limit.")
    }
    return text
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel()
        throw new Error("Bilibili resource response exceeded the size limit.")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

/** Creates the content-side fetch facade; the service worker owns the actual request. */
export function createBilibiliFetchTransport(request: BilibiliTransportRequest): FetchLike {
  return async (input, init) => {
    const url = String(input)
    if (!isAllowedBilibiliResourceUrl(url)) {
      throw new Error("Bilibili resource URL is not allowed.")
    }
    if (init?.method && init.method.toUpperCase() !== "GET") {
      throw new Error("Bilibili transport only permits GET requests.")
    }
    if (init?.body !== undefined || init?.headers !== undefined) {
      throw new Error("Bilibili transport does not accept request bodies or custom headers.")
    }

    const response = await request(url)
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      statusText: response.status >= 200 && response.status < 300 ? "OK" : "Request failed",
      text: async () => response.body,
    }
  }
}
