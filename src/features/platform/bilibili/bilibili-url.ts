const BVID_PATTERN = /^BV[A-Za-z0-9]{10}$/
const VIDEO_PATH_PATTERN = /^\/video\/(BV[A-Za-z0-9]{10})\/?$/

function parseUrl(value: URL | string): URL | null {
  try {
    return value instanceof URL ? value : new URL(value)
  } catch {
    return null
  }
}

function isBilibiliOrigin(url: URL): boolean {
  return url.protocol === "https:"
    && url.hostname === "www.bilibili.com"
    && !url.username
    && !url.password
    && !url.port
}

export function extractBvid(value: URL | string): string | null {
  const url = parseUrl(value)
  if (!url || !isBilibiliOrigin(url)) return null
  const match = url.pathname.match(VIDEO_PATH_PATTERN)
  return match && BVID_PATTERN.test(match[1] ?? "") ? match[1] : null
}

export function extractPageIndex(value: URL | string): number | null {
  const url = parseUrl(value)
  if (!url) return null

  const values = url.searchParams.getAll("p")
  if (values.length === 0) return 1
  if (values.length !== 1 || !/^\d+$/.test(values[0] ?? "")) return null

  const pageIndex = Number(values[0])
  return Number.isSafeInteger(pageIndex) && pageIndex >= 1 ? pageIndex : null
}

export function isSupportedBilibiliVideoUrl(value: URL | string): boolean {
  const url = parseUrl(value)
  if (!url || !isBilibiliOrigin(url) || extractPageIndex(url) === null) return false
  const match = url.pathname.match(VIDEO_PATH_PATTERN)
  return Boolean(match && BVID_PATTERN.test(match[1] ?? ""))
}

export function buildCanonicalBilibiliUrl(bvid: string, pageIndex = 1): string {
  if (!BVID_PATTERN.test(bvid)) throw new Error("Invalid Bilibili BV ID.")
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 1) {
    throw new Error("Invalid Bilibili page index.")
  }

  const base = `https://www.bilibili.com/video/${bvid}/`
  return pageIndex === 1 ? base : `${base}?p=${pageIndex}`
}

export function buildBilibiliContentKey(bvid: string, pageIndex: number): string {
  if (!BVID_PATTERN.test(bvid) || !Number.isSafeInteger(pageIndex) || pageIndex < 1) {
    throw new Error("Cannot build identity for an invalid Bilibili part.")
  }
  return `bilibili:${bvid}:p:${pageIndex}`
}

export function isValidBvid(value: unknown): value is string {
  return typeof value === "string" && BVID_PATTERN.test(value)
}

/** Returns a specific user-facing classification only for Bilibili video URL candidates. */
export function getBilibiliVideoUrlError(value: URL | string): string | null {
  const url = parseUrl(value)
  if (!url || !isBilibiliOrigin(url)) return null
  const match = url.pathname.match(/^\/video\/([^/]+)\/?$/)
  if (!match) return null
  if (!BVID_PATTERN.test(match[1] ?? "")) return "Bilibili BV ID 无效。"
  if (extractPageIndex(url) === null) return "Bilibili 分P编号无效。"
  return null
}
