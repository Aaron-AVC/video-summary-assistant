import { resolvePlatformAdapter } from "@/features/platform/registry"
import type { FetchLike } from "@/features/transcript/lib/transcript-schema"
import { createBilibiliFetchTransport } from "@/features/platform/bilibili/bilibili-transport"
import { installPlatformContentBridge, fetchPlatformVideoTranscript } from "@/lib/runtime/platform-content-bridge"
import {
  FETCH_BILIBILI_RESOURCE,
  RUNTIME_MESSAGE_NAMESPACE,
  sendRuntimeMessage,
  type ContentScriptResponseMessage,
} from "@/lib/runtime/messages"

export const config = {
  matches: ["https://www.bilibili.com/video/*"],
  run_at: "document_idle",
}

const bilibiliFetch = createBilibiliFetchTransport(async (url) => {
  const response = await sendRuntimeMessage({
    channel: RUNTIME_MESSAGE_NAMESPACE,
    type: FETCH_BILIBILI_RESOURCE,
    url,
  })
  if (response.ok === false) throw new Error(response.error)
  if (response.type !== FETCH_BILIBILI_RESOURCE) {
    throw new Error("Unexpected Bilibili transport response.")
  }
  return { status: response.status, body: response.body }
})

if (typeof window !== "undefined" && typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  installPlatformContentBridge({
    document,
    window,
    resolveAdapter: resolvePlatformAdapter,
    fetch: bilibiliFetch,
  })
}

export async function fetchBilibiliVideoTranscript(
  document: Document,
  locationLike: Location,
  fetchImpl: FetchLike = bilibiliFetch,
): Promise<ContentScriptResponseMessage> {
  const location = new URL(locationLike.href)
  const adapter = resolvePlatformAdapter(location)
  return fetchPlatformVideoTranscript(adapter, {
    document,
    location,
    getCurrentUrl: () => new URL(locationLike.href),
    fetch: fetchImpl,
  })
}
