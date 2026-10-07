export const YOUTUBE_WATCH_MATCH_PATTERNS = [
  "https://www.youtube.com/watch*",
  "https://youtube.com/watch*",
] as const

const YOUTUBE_WATCH_MATCH_BASES = YOUTUBE_WATCH_MATCH_PATTERNS.map((pattern) => {
  const wildcardIndex = pattern.indexOf("*")
  return new URL(pattern.slice(0, wildcardIndex))
})

const YOUTUBE_WATCH_HOSTS = new Set(
  YOUTUBE_WATCH_MATCH_BASES.map((url) => url.hostname),
)
const YOUTUBE_WATCH_PATH = YOUTUBE_WATCH_MATCH_BASES[0]?.pathname

export function isSupportedYouTubeWatchUrl(url: URL): boolean {
  return url.protocol === "https:"
    && YOUTUBE_WATCH_HOSTS.has(url.hostname)
    && url.pathname === YOUTUBE_WATCH_PATH
}
