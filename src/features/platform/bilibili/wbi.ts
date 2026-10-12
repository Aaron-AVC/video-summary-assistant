// The published table has 64 entries. Keeping it as data makes the signing
// rule auditable and avoids any dependency on a browser crypto extension.
const MIXIN_KEY_TABLE = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
] as const

export type WbiImageUrls = {
  imgUrl: string
  subUrl: string
}

export type WbiKeys = {
  imgKey: string
  subKey: string
  mixinKey: string
}

export function extractWbiKeys(value: unknown): WbiKeys | null {
  const data = isRecord(value) && isRecord(value.data) ? value.data : null
  const wbiImg = data && isRecord(data.wbi_img) ? data.wbi_img : null
  const imgUrl = stringValue(wbiImg?.img_url)
  const subUrl = stringValue(wbiImg?.sub_url)
  if (!imgUrl || !subUrl) return null

  const imgKey = extractKey(imgUrl)
  const subKey = extractKey(subUrl)
  if (!imgKey || !subKey) return null

  return { imgKey, subKey, mixinKey: getMixinKey(imgKey, subKey) }
}

export function getMixinKey(imgKey: string, subKey: string): string {
  const raw = `${imgKey}${subKey}`
  return MIXIN_KEY_TABLE
    .map((index) => raw[index] ?? "")
    .join("")
    .slice(0, 32)
}

export function buildWbiSignedUrl(
  baseUrl: string,
  params: Record<string, string | number>,
  keys: WbiKeys,
  wts = Math.floor(Date.now() / 1_000),
): string {
  const signedParams = { ...params, wts: String(wts) }
  const canonicalQuery = Object.entries(signedParams)
    .filter(([key]) => key !== "w_rid")
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value).replace(/[!'()*]/g, ""))}`)
    .join("&")

  const url = new URL(baseUrl)
  url.search = `${canonicalQuery}&w_rid=${md5(`${canonicalQuery}${keys.mixinKey}`)}`
  return url.toString()
}

function extractKey(value: string): string | null {
  try {
    const url = new URL(value)
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || (url.port && url.port !== "443")
      || !url.hostname.endsWith(".hdslb.com")
    ) return null
    const match = url.pathname.match(/^\/bfs\/wbi\/([A-Za-z0-9]{32})\.[A-Za-z0-9]+$/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

export function md5(value: string): string {
  const bytes = new TextEncoder().encode(value)
  const words = new Uint32Array(((bytes.length + 9 + 63) >> 6) * 16)
  for (let index = 0; index < bytes.length; index += 1) {
    words[index >> 2] |= bytes[index]! << ((index & 3) * 8)
  }
  words[bytes.length >> 2] |= 0x80 << ((bytes.length & 3) * 8)
  words[words.length - 2] = bytes.length * 8

  let a = 0x67452301
  let b = 0xefcdab89
  let c = 0x98badcfe
  let d = 0x10325476
  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ]
  const k = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 2 ** 32))

  for (let offset = 0; offset < words.length; offset += 16) {
    let aa = a
    let bb = b
    let cc = c
    let dd = d
    for (let index = 0; index < 64; index += 1) {
      let f: number
      let g: number
      if (index < 16) {
        f = (bb & cc) | (~bb & dd)
        g = index
      } else if (index < 32) {
        f = (dd & bb) | (~dd & cc)
        g = (5 * index + 1) % 16
      } else if (index < 48) {
        f = bb ^ cc ^ dd
        g = (3 * index + 5) % 16
      } else {
        f = cc ^ (bb | ~dd)
        g = (7 * index) % 16
      }
      const next = dd
      dd = cc
      cc = bb
      const sum = (aa + f + k[index]! + words[offset + g]!) >>> 0
      bb = (bb + ((sum << s[index]!) | (sum >>> (32 - s[index]!)))) >>> 0
      aa = next
    }
    a = (a + aa) >>> 0
    b = (b + bb) >>> 0
    c = (c + cc) >>> 0
    d = (d + dd) >>> 0
  }

  return [a, b, c, d]
    .flatMap((word) => [0, 8, 16, 24].map((shift) => ((word >>> shift) & 0xff).toString(16).padStart(2, "0")))
    .join("")
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
