import { resolvePlatformAdapter } from "@/features/platform/registry"
import type {
  ActiveVideoContext,
  VideoInfo,
} from "@/features/platform/types"
import type { FetchLike } from "@/features/transcript/lib/transcript-schema"

export const ACTIVE_VIDEO_REQUEST = "VIDEO_SUMMARY_ASSISTANT_REQUEST_ACTIVE_VIDEO"
export const ACTIVE_VIDEO_EVENT = "video-summary-assistant:active-video"
export const ACTIVE_VIDEO_RESPONSE = "VIDEO_SUMMARY_ASSISTANT_ACTIVE_VIDEO"

export type ActiveVideoRequestMessage = {
  source: "video-summary-assistant"
  type: typeof ACTIVE_VIDEO_REQUEST
  requestId: string
}

export type ActiveVideoResponseMessage = {
  source: "video-summary-assistant"
  type: typeof ACTIVE_VIDEO_RESPONSE
  requestId: string
  payload: ActiveVideoContext
}

type ActiveVideoBridgeOptions = {
  document: Document
  window: Window
  fetch?: FetchLike
}

export function createUnsupportedVideoContext(url = ""): ActiveVideoContext {
  return {
    pageType: "unsupported",
    platform: null,
    videoId: null,
    partId: null,
    contentKey: null,
    url,
    canonicalUrl: null,
    title: null,
    author: null,
    timestampSeconds: 0,
    isReady: false,
  }
}

export async function readActiveVideoContext(
  document: Document,
  locationLike: Location | URL,
  fetchImpl: FetchLike = globalThis.fetch as FetchLike,
  getCurrentUrl?: () => URL,
): Promise<ActiveVideoContext> {
  const url = locationLike instanceof URL ? locationLike : new URL(locationLike.href)
  const adapter = resolvePlatformAdapter(url)
  if (!adapter) {
    return createUnsupportedVideoContext(url.href)
  }

  const env = { document, location: url, fetch: fetchImpl, getCurrentUrl }
  let video: VideoInfo
  try {
    video = await adapter.readVideoInfo(env)
  } catch {
    const identity = adapter.getVideoIdentity(url)
    if (!identity) {
      return createUnsupportedVideoContext(url.href)
    }
    return {
      pageType: "video",
      ...identity,
      partId: identity.partId ?? null,
      url: url.href,
      canonicalUrl: url.href,
      title: document.title.trim() || null,
      author: null,
      timestampSeconds: adapter.getCurrentTime(env),
      isReady: false,
    }
  }

  return {
    pageType: "video",
    platform: video.platform,
    videoId: video.videoId,
    partId: video.partId ?? null,
    contentKey: video.contentKey,
    url: url.href,
    canonicalUrl: video.canonicalUrl,
    title: video.title,
    author: video.author ?? null,
    timestampSeconds: adapter.getCurrentTime(env),
    isReady: Boolean(video.videoId && video.title),
  }
}

export function createActiveVideoBridge({
  document,
  window,
  fetch: fetchImpl = globalThis.fetch as FetchLike,
}: ActiveVideoBridgeOptions) {
  let previousSerialized = ""
  let publishGeneration = 0
  let lastObservedUrl = window.location.href

  const publishContext = () => {
    const generation = ++publishGeneration
    void readActiveVideoContext(
      document,
      window.location,
      fetchImpl,
      () => new URL(window.location.href),
    ).then((snapshot) => {
      if (generation !== publishGeneration) return
      const serialized = JSON.stringify(snapshot)
      if (serialized === previousSerialized) return
      previousSerialized = serialized
      window.dispatchEvent(
        new CustomEvent<ActiveVideoContext>(ACTIVE_VIDEO_EVENT, { detail: snapshot }),
      )
    })
  }

  const respondToRequests = (event: MessageEvent<ActiveVideoRequestMessage>) => {
    if (event.source !== window) return
    if (
      event.data?.source !== "video-summary-assistant"
      || event.data.type !== ACTIVE_VIDEO_REQUEST
    ) return

    void readActiveVideoContext(
      document,
      window.location,
      fetchImpl,
      () => new URL(window.location.href),
    ).then((payload) => {
      const message: ActiveVideoResponseMessage = {
        source: "video-summary-assistant",
        type: ACTIVE_VIDEO_RESPONSE,
        requestId: event.data.requestId,
        payload,
      }
      window.postMessage(message, window.location.origin)
    })
  }

  const titleObserver = new MutationObserver(publishContext)
  const pageObserver = new MutationObserver(publishContext)
  const titleElement = document.querySelector("title")
  if (titleElement) {
    titleObserver.observe(titleElement, {
      childList: true,
      subtree: true,
      characterData: true,
    })
  }
  if (document.body) {
    pageObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "title"],
    })
  }

  window.addEventListener("message", respondToRequests)
  window.addEventListener("yt-navigate-finish", publishContext as EventListener)
  window.addEventListener("popstate", publishContext)
  window.addEventListener("hashchange", publishContext)
  const urlPoll = window.setInterval(() => {
    if (window.location.href === lastObservedUrl) return
    lastObservedUrl = window.location.href
    publishContext()
  }, 500)
  publishContext()

  return () => {
    window.removeEventListener("message", respondToRequests)
    window.removeEventListener("yt-navigate-finish", publishContext as EventListener)
    window.removeEventListener("popstate", publishContext)
    window.removeEventListener("hashchange", publishContext)
    window.clearInterval(urlPoll)
    titleObserver.disconnect()
    pageObserver.disconnect()
  }
}
