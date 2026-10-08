import { isSupportedBilibiliVideoUrl } from "@/features/platform/bilibili/bilibili-url"

const PLAYER_API_PATHS = new Set([
  "/x/web-interface/view",
  "/x/player/wbi/v2",
  "/x/player/v2",
])
const API_QUERY_KEYS: Record<string, ReadonlySet<string>> = {
  "/x/web-interface/view": new Set(["bvid"]),
  "/x/player/wbi/v2": new Set(["aid", "cid", "bvid"]),
  "/x/player/v2": new Set(["aid", "cid", "bvid"]),
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
      return keys.length === 3
        && ["aid", "cid"].every((key) => /^\d+$/.test(url.searchParams.get(key) ?? ""))
        && Boolean(url.searchParams.get("bvid") && /^BV[A-Za-z0-9]{10}$/.test(url.searchParams.get("bvid") ?? ""))
    }

    return url.hostname.endsWith(".hdslb.com")
      && url.pathname.startsWith("/bfs/subtitle/")
      && url.pathname.toLowerCase().endsWith(".json")
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
    return url.hostname.endsWith(".hdslb.com")
      && url.pathname.startsWith("/bfs/subtitle/")
      && url.pathname.toLowerCase().endsWith(".json")
  } catch {
    return false
  }
}
