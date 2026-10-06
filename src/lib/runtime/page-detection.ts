export type YouTubeWatchPage = {
  href: string
  pathname: string
  search: string
  videoId: string | null
  isWatchPage: boolean
}

export function getYouTubeVideoId(urlLike: URL | string): string | null {
  const url = typeof urlLike === "string" ? new URL(urlLike) : urlLike

  if (!isYouTubeHost(url.hostname)) {
    return null
  }

  if (url.pathname === "/watch") {
    return url.searchParams.get("v")
  }

  if (url.pathname.indexOf("/shorts/") === 0) {
    return url.pathname.split("/").filter(Boolean)[1] ?? null
  }

  return null
}

export function getYouTubeWatchPage(urlLike: URL | string): YouTubeWatchPage {
  const url = typeof urlLike === "string" ? new URL(urlLike) : urlLike
  const videoId = getYouTubeVideoId(url)

  return {
    href: url.href,
    pathname: url.pathname,
    search: url.search,
    videoId,
    isWatchPage: Boolean(videoId)
  }
}

export function isYouTubeWatchPage(urlLike: URL | string): boolean {
  return getYouTubeWatchPage(urlLike).isWatchPage
}

export function normalizeWatchUrl(urlLike: URL | string): string | null {
  const url = typeof urlLike === "string" ? new URL(urlLike) : urlLike
  const videoId = getYouTubeVideoId(url)

  if (!videoId) {
    return null
  }

  return new URL(`/watch?v=${videoId}`, url.origin).toString()
}

function isYouTubeHost(hostname: string): boolean {
  return hostname === "www.youtube.com" || hostname === "youtube.com"
}
