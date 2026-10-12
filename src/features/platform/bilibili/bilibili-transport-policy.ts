import { isSupportedBilibiliVideoUrl } from "@/features/platform/bilibili/bilibili-url"

const PLAYER_API_PATHS = new Set([
  "/x/web-interface/view",
  "/x/web-interface/nav",
  "/x/player/wbi/v2",
  "/x/player/v2",
  "/x/v2/subtitle/web/view",
])
const API_QUERY_KEYS: Record<string, ReadonlySet<string>> = {
  "/x/web-interface/view": new Set(["bvid"]),
  "/x/web-interface/nav": new Set(),
  "/x/player/wbi/v2": new Set(["aid", "cid", "bvid", "wts", "w_rid"]),
  "/x/player/v2": new Set(["aid", "cid", "bvid"]),
  "/x/v2/subtitle/web/view": new Set(["oid", "pid", "context_ext", "type", "cur_production_type"]),
}

export function isAllowedBilibiliResourceUrl(value: unknown): boolean {
  if (typeof value !== "string") return false

  try {
    const url = new URL(value)
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || (url.port && url.port !== "443")
      || hasPathTraversal(value)
    ) return false

    if (url.hostname === "api.bilibili.com") {
      const allowedKeys = API_QUERY_KEYS[url.pathname]
      if (!allowedKeys || !PLAYER_API_PATHS.has(url.pathname)) return false
      const keys = [...url.searchParams.keys()]
      if (keys.some((key) => !allowedKeys.has(key))) return false
      if (keys.some((key) => url.searchParams.getAll(key).length !== 1)) return false
      if (url.pathname === "/x/web-interface/view") {
        const bvid = url.searchParams.get("bvid")
        return keys.length === 1 && Boolean(bvid && /^BV[A-Za-z0-9]{10}$/.test(bvid))
      }
      if (url.pathname === "/x/web-interface/nav") return keys.length === 0
      if (url.pathname === "/x/v2/subtitle/web/view") {
        return keys.length === 5
          && ["oid", "pid"].every((key) => /^\d+$/.test(url.searchParams.get(key) ?? ""))
          && url.searchParams.get("type") === "1"
          && url.searchParams.get("cur_production_type") === "0"
          && url.searchParams.get("context_ext") === '{"video_type":1}'
      }
      if (url.pathname === "/x/player/v2") {
        return keys.length === 3
          && ["aid", "cid"].every((key) => /^\d+$/.test(url.searchParams.get(key) ?? ""))
          && Boolean(url.searchParams.get("bvid") && /^BV[A-Za-z0-9]{10}$/.test(url.searchParams.get("bvid") ?? ""))
      }
      return keys.length === 5
        && ["aid", "cid"].every((key) => /^\d+$/.test(url.searchParams.get(key) ?? ""))
        && Boolean(url.searchParams.get("bvid") && /^BV[A-Za-z0-9]{10}$/.test(url.searchParams.get("bvid") ?? ""))
        && /^\d+$/.test(url.searchParams.get("wts") ?? "")
        && /^[a-f0-9]{32}$/i.test(url.searchParams.get("w_rid") ?? "")
    }

    return isAllowedSubtitleCdnPath(url)
  } catch {
    return false
  }
}

export function isAllowedBilibiliTransport(resourceUrl: unknown, senderUrl: unknown): boolean {
  return isAllowedBilibiliResourceUrl(resourceUrl)
    && typeof senderUrl === "string"
    && isSupportedBilibiliVideoUrl(senderUrl)
}

export function isAllowedBilibiliSubtitleUrl(value: unknown): value is string {
  if (typeof value !== "string" || !isAllowedBilibiliResourceUrl(value)) return false
  try {
    const url = new URL(value)
    return isAllowedSubtitleCdnPath(url)
  } catch {
    return false
  }
}

function isAllowedSubtitleCdnPath(url: URL): boolean {
  if (!url.hostname.endsWith(".hdslb.com")) return false
  const segments = url.pathname.split("/").slice(1)
  if (segments.length < 3 || segments.some((segment) => !segment)) return false

  if (segments[0] === "bfs" && segments[1] === "subtitle") {
    return /^\/bfs\/subtitle\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/i.test(url.pathname)
  }

  if (segments[0] === "bfs" && segments[1] === "ai_subtitle" && segments[2] === "prod") {
    return segments.length >= 4
      && segments.slice(3).every((segment) => /^[A-Za-z0-9_-]+$/.test(segment))
  }

  return false
}

function hasPathTraversal(value: string): boolean {
  const match = value.match(/^https:\/\/[^/?#]*(\/[^?#]*)?/i)
  const rawPath = match?.[1] ?? "/"
  for (const rawSegment of rawPath.split("/")) {
    let segment = rawSegment
    for (let pass = 0; pass < 3; pass += 1) {
      try {
        const decoded = decodeURIComponent(segment)
        if (decoded === segment) break
        segment = decoded
      } catch {
        return true
      }
    }
    if (segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\")) return true
  }
  return false
}
