import {
  getYouTubeWatchPage,
  isYouTubeWatchPage,
  normalizeWatchUrl
} from "@/lib/runtime/page-detection"

export const CURRENT_VIDEO_REQUEST = "YT_SUMMARIZER_REQUEST_CURRENT_VIDEO"
export const CURRENT_VIDEO_EVENT = "yt-summarizer:current-video"
export const CURRENT_VIDEO_RESPONSE = "YT_SUMMARIZER_CURRENT_VIDEO"

export type CurrentVideoContext = {
  pageType: "watch" | "unsupported"
  videoId: string | null
  url: string
  canonicalUrl: string | null
  title: string | null
  channelName: string | null
  timestampSeconds: number
  isReady: boolean
}

export type CurrentVideoRequestMessage = {
  source: "yt-summarizer"
  type: typeof CURRENT_VIDEO_REQUEST
  requestId: string
}

export type CurrentVideoResponseMessage = {
  source: "yt-summarizer"
  type: typeof CURRENT_VIDEO_RESPONSE
  requestId: string
  payload: CurrentVideoContext
}

type CurrentVideoBridgeOptions = {
  document: Document
  window: Window
}

export function readCurrentVideoContext(
  document: Document,
  locationLike: Location | URL
): CurrentVideoContext {
  const url = locationLike instanceof URL ? locationLike : new URL(locationLike.href)
  const page = getYouTubeWatchPage(url)

  if (!page.isWatchPage) {
    return {
      pageType: "unsupported",
      videoId: null,
      url: url.href,
      canonicalUrl: null,
      title: null,
      channelName: null,
      timestampSeconds: 0,
      isReady: false
    }
  }

  const videoElement = document.querySelector("video")
  const title =
    readText(document, "ytd-watch-metadata h1") ??
    readText(document, "h1.ytd-watch-metadata") ??
    (document.title.replace(/ - YouTube$/, "") || null)

  return {
    pageType: "watch",
    videoId: page.videoId,
    url: url.href,
    canonicalUrl: readCanonicalUrl(document) ?? normalizeWatchUrl(url),
    title,
    channelName:
      readText(document, "#owner a.yt-simple-endpoint") ??
      readText(document, "ytd-channel-name a") ??
      null,
    timestampSeconds: Math.floor(videoElement?.currentTime ?? 0),
    isReady: Boolean(page.videoId && title)
  }
}

export function createCurrentVideoBridge({
  document,
  window
}: CurrentVideoBridgeOptions) {
  let previousSerialized = ""

  const publishContext = () => {
    const snapshot = readCurrentVideoContext(document, window.location)
    const serialized = JSON.stringify(snapshot)

    if (serialized === previousSerialized) {
      return
    }

    previousSerialized = serialized

    window.dispatchEvent(
      new CustomEvent<CurrentVideoContext>(CURRENT_VIDEO_EVENT, {
        detail: snapshot
      })
    )
  }

  const respondToRequests = (event: MessageEvent<CurrentVideoRequestMessage>) => {
    if (event.source !== window) {
      return
    }

    if (event.data?.source !== "yt-summarizer" || event.data.type !== CURRENT_VIDEO_REQUEST) {
      return
    }

    const message: CurrentVideoResponseMessage = {
      source: "yt-summarizer",
      type: CURRENT_VIDEO_RESPONSE,
      requestId: event.data.requestId,
      payload: readCurrentVideoContext(document, window.location)
    }

    window.postMessage(message, window.location.origin)
  }

  const titleObserver = new MutationObserver(() => publishContext())
  const pageObserver = new MutationObserver(() => publishContext())

  window.addEventListener("message", respondToRequests)
  window.addEventListener("yt-navigate-finish", publishContext as EventListener)
  window.addEventListener("popstate", publishContext)
  window.addEventListener("hashchange", publishContext)

  if (document.title) {
    const titleElement = document.querySelector("title")

    if (titleElement) {
      titleObserver.observe(titleElement, {
        childList: true,
        subtree: true,
        characterData: true
      })
    }
  }

  pageObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href", "title"]
  })

  publishContext()

  return () => {
    window.removeEventListener("message", respondToRequests)
    window.removeEventListener("yt-navigate-finish", publishContext as EventListener)
    window.removeEventListener("popstate", publishContext)
    window.removeEventListener("hashchange", publishContext)
    titleObserver.disconnect()
    pageObserver.disconnect()
  }
}

export function isSupportedCurrentVideoPage(locationLike: Location | URL): boolean {
  const url = locationLike instanceof URL ? locationLike : new URL(locationLike.href)

  return isYouTubeWatchPage(url)
}

export function jumpToVideoTimestamp(
  document: Document,
  timestampSeconds: number
): boolean {
  const videoElement = document.querySelector<HTMLVideoElement>("video")

  if (!videoElement || isNaN(timestampSeconds)) {
    return false
  }

  videoElement.currentTime = Math.max(0, timestampSeconds)

  return true
}

function readCanonicalUrl(document: Document): string | null {
  return document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null
}

function readText(document: Document, selector: string): string | null {
  const text = document.querySelector<HTMLElement>(selector)?.textContent?.trim()

  return text ? text : null
}
