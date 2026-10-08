import { resolvePlatformAdapter } from "@/features/platform/registry"
import type { FetchLike } from "@/features/transcript/lib/transcript-schema"
import { installPlatformContentBridge, fetchPlatformVideoTranscript } from "@/lib/runtime/platform-content-bridge"
import { FETCH_VIDEO_TRANSCRIPT, type ContentScriptResponseMessage } from "@/lib/runtime/messages"

export const config = {
  // Plasmo requires a literal array to emit content_scripts.matches in the build.
  // youtube-url.test.ts asserts these stay aligned with the adapter support helper.
  matches: [
    "https://www.youtube.com/watch*",
    "https://youtube.com/watch*",
  ],
  run_at: "document_idle",
}

if (typeof window !== "undefined" && typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  const pageFetch: FetchLike = (input, init) => fetch(input, init)
  installPlatformContentBridge({
    document,
    window,
    resolveAdapter: resolvePlatformAdapter,
    fetch: pageFetch,
  })
}

export async function fetchVideoTranscript(
  document: Document,
  locationLike: Location,
): Promise<ContentScriptResponseMessage> {
  const location = new URL(locationLike.href)
  const adapter = resolvePlatformAdapter(location)
  return fetchPlatformVideoTranscript(adapter, {
    document,
    location,
    getCurrentUrl: () => new URL(locationLike.href),
    fetch: (input, init) => fetch(input, init),
  })
}

export { FETCH_VIDEO_TRANSCRIPT }
