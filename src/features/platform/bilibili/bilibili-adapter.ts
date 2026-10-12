import type { PlatformPageEnvironment } from "@/features/platform/adapter"
import type { VideoPlatformAdapter } from "@/features/platform/adapter"
import type {
  NativeChapter,
  VideoIdentity,
  VideoInfo,
  VideoTranscript,
} from "@/features/platform/types"
import {
  buildBilibiliContentKey,
  buildCanonicalBilibiliUrl,
  extractBvid,
  extractPageIndex,
  isSupportedBilibiliVideoUrl,
  isValidBvid,
} from "@/features/platform/bilibili/bilibili-url"
import { normalizeBilibiliSubtitleUrl } from "@/features/platform/bilibili/bilibili-transport"
import { buildWbiSignedUrl, extractWbiKeys } from "@/features/platform/bilibili/wbi"
import { decodeSubtitleViewTracks, type SubtitleViewTrack } from "@/features/platform/bilibili/subtitle-view"
import type { WbiKeys } from "@/features/platform/bilibili/wbi"
import { createLogCollector } from "@/features/transcript/lib/transcript-log"

export type BilibiliErrorCode =
  | "unsupported_bilibili_url"
  | "invalid_bv"
  | "invalid_page_index"
  | "invalid_timestamp"
  | "metadata_fetch_failed"
  | "metadata_api_rejected"
  | "current_part_cid_missing"
  | "player_api_failed"
  | "player_api_rejected"
  | "no_subtitle_tracks"
  | "subtitle_cdn_failed"
  | "captions_unavailable"
  | "stale_part_request"
  | "bilibili_session_restricted"

export class BilibiliAdapterError extends Error {
  constructor(readonly code: BilibiliErrorCode, message: string) {
    super(message)
    this.name = "BilibiliAdapterError"
  }
}

type BilibiliPage = {
  cid: string
  page: number
  part: string
  duration: number | null
}

type BilibiliMetadata = {
  aid: string
  bvid: string
  title: string
  author: string | null
  duration: number | null
  thumbnailUrl: string | null
  defaultCid: string | null
  pages: BilibiliPage[]
  pagesProvided: boolean
}

type BilibiliPageContext = {
  identity: VideoIdentity
  pageIndex: number
  cid: string
  pageTitle: string
  duration: number | null
  metadata: BilibiliMetadata
}

type SubtitleTrack = {
  id: string
  language: string
  label: string
  url: string
  source: "manual" | "auto" | "unknown"
  order: number
}

const metadataByDocument = new WeakMap<Document, Map<string, Promise<BilibiliMetadata>>>()
const API_BASE = "https://api.bilibili.com"
const MAX_BODY_LENGTH = 8 * 1024 * 1024
const WBI_KEY_TTL_MS = 10 * 60 * 1_000
let cachedWbiKeys: { keys: WbiKeys; expiresAt: number } | null = null
let pendingWbiKeys: Promise<WbiKeys> | null = null

export function resetWbiKeyCacheForTests(): void {
  cachedWbiKeys = null
  pendingWbiKeys = null
}

export const bilibiliAdapter: VideoPlatformAdapter = {
  platform: "bilibili",

  canHandle(url) {
    return isSupportedBilibiliVideoUrl(url)
  },

  getVideoIdentity(url) {
    if (!isSupportedBilibiliVideoUrl(url)) return null
    const bvid = extractBvid(url)
    const pageIndex = extractPageIndex(url)
    if (!bvid || pageIndex === null) return null

    return {
      platform: "bilibili",
      videoId: bvid,
      partId: String(pageIndex),
      contentKey: buildBilibiliContentKey(bvid, pageIndex),
    }
  },

  async readVideoInfo(env) {
    const context = await resolveBilibiliPageContext(env)
    assertCurrentPage(env, context)
    const partSuffix = context.pageTitle ? ` — ${context.pageTitle}` : ""

    return {
      ...context.identity,
      title: `${context.metadata.title}${partSuffix}`,
      author: context.metadata.author,
      durationSec: context.duration,
      thumbnailUrl: context.metadata.thumbnailUrl,
      canonicalUrl: buildCanonicalBilibiliUrl(context.identity.videoId, context.pageIndex),
    }
  },

  async getTranscript(env) {
    const context = await resolveBilibiliPageContext(env)
    assertCurrentPage(env, context)
    const collector = env.diagnosticLoggingEnabled
      ? createLogCollector(context.identity.videoId, env.location.href)
      : null
    const requestDetails = `endpoint=/x/player/wbi/v2; requested_bvid=${context.identity.videoId}; requested_cid=${context.cid}`
    const playerData = collector
      ? await collector.logStep("bilibili.wbi", () => fetchSignedPlayerData(env, context), requestDetails)
      : await fetchSignedPlayerData(env, context)
    assertCurrentPage(env, context)

    let tracks = mapSubtitleTracks(playerData.subtitle?.subtitles)
    let selectedStrategy = "signed_wbi"
    let modernDiscovery: ModernSubtitleDiscovery = { tracks: [], httpStatus: null, apiCode: null }
    if (tracks.length === 0) {
      modernDiscovery = collector
        ? await collector.logStep(
          "bilibili.subtitle_view",
          () => fetchModernSubtitleTracks(env, context),
          `endpoint=/x/v2/subtitle/web/view; requested_bvid=${context.identity.videoId}; requested_cid=${context.cid}`,
        )
        : await fetchModernSubtitleTracks(env, context)
      assertCurrentPage(env, context)
      tracks = modernDiscovery.tracks.map((track) => ({ ...track, order: track.order }))
      selectedStrategy = "modern_subtitle_view"
    }
    if (collector) {
      await collector.logStep(
        "bilibili.discovery.result",
        async () => true,
        `wbi_http_status=${playerData.httpStatus}; wbi_api_code=${playerData.apiCode ?? "n/a"}; modern_http_status=${modernDiscovery.httpStatus ?? "n/a"}; modern_api_code=${modernDiscovery.apiCode ?? "n/a"}; requested_bvid=${context.identity.videoId}; requested_cid=${context.cid}; returned_bvid=${playerData.identity.bvid ?? ""}; returned_cid=${playerData.identity.cid ?? ""}; subtitle_track_count=${tracks.length}; need_login_subtitle=${String(playerData.needLoginSubtitle ?? false)}; selected_strategy=${tracks.length > 0 ? selectedStrategy : "none"}`,
      )
    }
    if (tracks.length === 0) {
      collector?.finalize("all_failed")
      throw new BilibiliAdapterError("no_subtitle_tracks", "当前视频没有可用字幕。")
    }

    const selected = [...tracks].sort(compareSubtitleTracks)[0]
    if (!selected) {
      collector?.finalize("all_failed")
      throw new BilibiliAdapterError("no_subtitle_tracks", "当前视频没有可用字幕。")
    }
    let subtitleResponse
    try {
      subtitleResponse = await env.fetch(selected.url, { method: "GET", credentials: "include", cache: "no-store" })
    } catch {
      throw new BilibiliAdapterError("subtitle_cdn_failed", "Bilibili 字幕服务暂时无法读取字幕。")
    }
    if (!subtitleResponse.ok) {
      throw new BilibiliAdapterError(
        "subtitle_cdn_failed",
        `Bilibili 字幕服务请求失败（HTTP ${subtitleResponse.status}）。`,
      )
    }

    let payload: unknown
    try {
      const text = await subtitleResponse.text()
      if (text.length > MAX_BODY_LENGTH) {
        throw new Error("response too large")
      }
      payload = JSON.parse(text)
    } catch {
      throw new BilibiliAdapterError("captions_unavailable", "字幕内容为空或格式无效。")
    }

    const segments = normalizeSubtitleBody((payload as { body?: unknown } | null)?.body)
    if (segments.length === 0) {
      collector?.finalize("all_failed")
      throw new BilibiliAdapterError("captions_unavailable", "当前视频没有可用字幕。")
    }

    assertCurrentPage(env, context)
    collector?.finalize("success", selectedStrategy === "signed_wbi" ? "bilibili.wbi" : "bilibili.subtitle_view")
    return {
      segments,
      language: normalizeLanguage(selected.language),
      source: selected.source,
    }
  },

  async getNativeChapters(env) {
    const context = await resolveBilibiliPageContext(env)
    assertCurrentPage(env, context)
    const playerData = await fetchSignedPlayerData(env, context)
    assertCurrentPage(env, context)
    return mapNativeChapters(playerData.view_points)
  },

  getCurrentTime(env) {
    const video = env.document.querySelector("video") as HTMLVideoElement | null
    const currentTime = Number(video?.currentTime)
    return Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0
  },

  seek(env, seconds) {
    if (!Number.isFinite(seconds)) return false
    const video = env.document.querySelector("video") as HTMLVideoElement | null
    if (!video) return false
    try {
      video.currentTime = Math.max(0, seconds)
      return true
    } catch {
      return false
    }
  },

  buildTimestampUrl(video, seconds) {
    if (!Number.isFinite(seconds)) {
      throw new BilibiliAdapterError("invalid_timestamp", "Timestamp must be a finite number.")
    }
    const pageIndex = Number(video.partId ?? "1")
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 1) {
      throw new BilibiliAdapterError("invalid_page_index", "Bilibili 分P编号无效。")
    }
    const canonical = buildCanonicalBilibiliUrl(video.videoId, pageIndex)
    const timestamp = Math.max(0, Math.round(seconds))
    return `${canonical}${pageIndex === 1 ? "?" : "&"}t=${timestamp}`
  },
}

export async function resolveBilibiliPageContext(
  env: PlatformPageEnvironment,
): Promise<BilibiliPageContext> {
  return readPageContext(env)
}

async function readPageContext(env: PlatformPageEnvironment): Promise<BilibiliPageContext> {
  const bvid = extractBvid(env.location)
  if (!bvid) {
    const hasBvidPath = env.location.protocol === "https:"
      && env.location.hostname === "www.bilibili.com"
      && /^\/video\/[^/]+\/?$/.test(env.location.pathname)
    if (hasBvidPath) {
      throw new BilibiliAdapterError("invalid_bv", "Bilibili BV ID 无效。")
    }
    throw new BilibiliAdapterError("unsupported_bilibili_url", "不支持此 Bilibili 页面。")
  }

  const pageIndex = extractPageIndex(env.location)
  if (pageIndex === null) {
    throw new BilibiliAdapterError("invalid_page_index", "Bilibili 分P编号无效。")
  }

  const identity = bilibiliAdapter.getVideoIdentity(env.location)
  if (!identity) {
    throw new BilibiliAdapterError("unsupported_bilibili_url", "不支持此 Bilibili 页面。")
  }

  const metadata = await getCachedMetadata(env, identity.videoId)
  const selectedPage = metadata.pages.find((page) => page.page === pageIndex)

  let cid = selectedPage?.cid ?? ""
  if (!cid && !metadata.pagesProvided && pageIndex === 1) {
    cid = metadata.defaultCid ?? ""
  }
  if (!cid) {
    throw new BilibiliAdapterError(
      "current_part_cid_missing",
      `无法解析当前视频第 ${pageIndex} P 的 CID。`,
    )
  }

  const context: BilibiliPageContext = {
    identity,
    pageIndex,
    cid,
    pageTitle: selectedPage?.part ?? "",
    duration: selectedPage?.duration ?? (!metadata.pagesProvided ? metadata.duration : null),
    metadata,
  }
  assertCurrentPage(env, context)
  return context
}

function getCachedMetadata(
  env: PlatformPageEnvironment,
  bvid: string,
): Promise<BilibiliMetadata> {
  let metadataByBvid = metadataByDocument.get(env.document)
  if (!metadataByBvid) {
    metadataByBvid = new Map()
    metadataByDocument.set(env.document, metadataByBvid)
  }

  const cached = metadataByBvid.get(bvid)
  if (cached) return cached

  const pending = fetchMetadata(env, bvid)
  metadataByBvid.set(bvid, pending)
  void pending.catch(() => {
    if (metadataByBvid?.get(bvid) === pending) metadataByBvid.delete(bvid)
  })
  return pending
}

async function fetchMetadata(env: PlatformPageEnvironment, bvid: string): Promise<BilibiliMetadata> {
  const url = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`
  let payload: unknown
  try {
    payload = await fetchJson(env, url, "metadata_fetch_failed", "metadata_api_rejected")
  } catch (error) {
    if (error instanceof BilibiliAdapterError) throw error
    throw new BilibiliAdapterError("metadata_fetch_failed", "无法读取 Bilibili 视频信息。")
  }

  const data = (payload as { data?: Record<string, unknown> } | null)?.data
  if (!data || !isValidBvid(data.bvid) || data.bvid !== bvid) {
    throw new BilibiliAdapterError("metadata_api_rejected", "Bilibili 视频信息与当前页面不匹配。")
  }

  const pages = Array.isArray(data.pages) ? data.pages.map(parsePage).filter(isPage) : []
  const pagesProvided = Array.isArray(data.pages) && data.pages.length > 0
  const owner = data.owner as { name?: unknown } | null | undefined
  const title = textValue(data.title)
  if (!title) {
    throw new BilibiliAdapterError("metadata_api_rejected", "Bilibili 视频信息缺少标题。")
  }

  const overallDuration = finiteNonnegative(data.duration)
  const pic = secureUrl(data.pic)
  return {
    aid: positiveIntegerString(data.aid) ?? "",
    bvid: data.bvid,
    title,
    author: textValue(owner?.name) || null,
    duration: overallDuration,
    thumbnailUrl: pic,
    defaultCid: positiveIntegerString(data.cid),
    pages,
    pagesProvided,
  }
}

async function fetchSignedPlayerData(
  env: PlatformPageEnvironment,
  context: BilibiliPageContext,
): Promise<{
  subtitle?: { subtitles?: unknown }
  view_points?: unknown
  identity: { aid?: string; bvid?: string; cid?: string }
  needLoginSubtitle?: boolean
  httpStatus: number
  apiCode: string | null
}> {
  if (!context.metadata.aid) {
    throw new BilibiliAdapterError("player_api_failed", "Bilibili 视频信息缺少 aid，无法读取字幕。")
  }
  const keys = await getWbiKeys(env)
  const url = buildWbiSignedUrl(
    `${API_BASE}/x/player/wbi/v2`,
    { aid: context.metadata.aid, cid: context.cid, bvid: context.identity.videoId },
    keys,
  )
  const { payload, status, apiCode } = await fetchJsonWithMetadata(
    env,
    url,
    "player_api_failed",
    "player_api_rejected",
  )
  const parsed = parsePlayerData(payload)
  validatePlayerIdentity(parsed.identity, context)
  return {
    ...parsed.data,
    identity: parsed.identity,
    needLoginSubtitle: parsed.needLoginSubtitle,
    httpStatus: status,
    apiCode,
  }
}

async function getWbiKeys(env: PlatformPageEnvironment): Promise<WbiKeys> {
  if (cachedWbiKeys && cachedWbiKeys.expiresAt > Date.now()) return cachedWbiKeys.keys
  if (pendingWbiKeys) return pendingWbiKeys
  pendingWbiKeys = (async () => {
    const navPayload = await fetchJson(
      env,
      `${API_BASE}/x/web-interface/nav`,
      "player_api_failed",
      "player_api_rejected",
    )
    const keys = extractWbiKeys(navPayload)
    if (!keys) throw new BilibiliAdapterError("player_api_rejected", "Bilibili WBI 签名信息不可用。")
    cachedWbiKeys = { keys, expiresAt: Date.now() + WBI_KEY_TTL_MS }
    return keys
  })()
  try {
    return await pendingWbiKeys
  } finally {
    pendingWbiKeys = null
  }
}

function parsePlayerData(payload: unknown): {
  data: { subtitle?: { subtitles?: unknown }; view_points?: unknown }
  identity: { aid?: string; bvid?: string; cid?: string }
  needLoginSubtitle?: boolean
} {
  const data = (payload as { data?: unknown } | null)?.data
  if (!isRecord(data)) {
    throw new BilibiliAdapterError("player_api_rejected", "Bilibili 播放器 API 返回了无效数据。")
  }
  const subtitle = data.subtitle as { subtitles?: unknown } | null | undefined
  return {
    data: {
      subtitle: isRecord(subtitle) ? subtitle : undefined,
      view_points: data.view_points,
    },
    identity: parsePlayerIdentity(data),
    needLoginSubtitle: data.need_login_subtitle === true || data.needLoginSubtitle === true,
  }
}

function parsePlayerIdentity(data: Record<string, unknown>): { aid?: string; bvid?: string; cid?: string } {
  const identity: { aid?: string; bvid?: string; cid?: string } = {}
  for (const key of ["aid", "bvid", "cid"] as const) {
    if (!(key in data)) continue
    const value = key === "bvid"
      ? (isValidBvid(data[key]) ? data[key] : null)
      : positiveIntegerString(data[key])
    if (!value) {
      throw new BilibiliAdapterError("player_api_rejected", "Bilibili 播放器返回了无效的视频身份。")
    }
    identity[key] = value
  }
  return identity
}

function validatePlayerIdentity(
  returned: { aid?: string; bvid?: string; cid?: string },
  context: BilibiliPageContext,
): void {
  if (returned.aid && returned.aid !== context.metadata.aid) {
    throw new BilibiliAdapterError("player_api_rejected", "Bilibili 播放器返回了不匹配的视频。")
  }
  if (returned.bvid && returned.bvid !== context.identity.videoId) {
    throw new BilibiliAdapterError("player_api_rejected", "Bilibili 播放器返回了不匹配的视频。")
  }
  if (returned.cid && returned.cid !== context.cid) {
    throw new BilibiliAdapterError("player_api_rejected", "Bilibili 播放器返回了不匹配的分P。")
  }
}

async function fetchModernSubtitleTracks(
  env: PlatformPageEnvironment,
  context: BilibiliPageContext,
): Promise<ModernSubtitleDiscovery> {
  const url = new URL(`${API_BASE}/x/v2/subtitle/web/view`)
  url.searchParams.set("oid", context.cid)
  url.searchParams.set("pid", context.metadata.aid)
  url.searchParams.set("context_ext", JSON.stringify({ video_type: 1 }))
  url.searchParams.set("type", "1")
  url.searchParams.set("cur_production_type", "0")
  let response
  try {
    response = await env.fetch(url.toString(), { method: "GET", credentials: "include", cache: "no-store" })
  } catch {
    return { tracks: [], httpStatus: null, apiCode: null }
  }
  if (!response.ok) return { tracks: [], httpStatus: response.status, apiCode: null }
  try {
    const bytes = response.arrayBuffer
      ? await response.arrayBuffer()
      : new TextEncoder().encode(await response.text()).buffer
    return {
      tracks: decodeSubtitleViewTracks(bytes),
      httpStatus: response.status,
      apiCode: readApiCode(bytes),
    }
  } catch {
    return { tracks: [], httpStatus: response.status, apiCode: null }
  }
}

type ModernSubtitleDiscovery = {
  tracks: SubtitleViewTrack[]
  httpStatus: number | null
  apiCode: string | null
}

async function fetchJson(
  env: PlatformPageEnvironment,
  url: string,
  fetchErrorCode: "metadata_fetch_failed" | "player_api_failed",
  apiErrorCode: "metadata_api_rejected" | "player_api_rejected",
): Promise<unknown> {
  return (await fetchJsonWithMetadata(env, url, fetchErrorCode, apiErrorCode)).payload
}

async function fetchJsonWithMetadata(
  env: PlatformPageEnvironment,
  url: string,
  fetchErrorCode: "metadata_fetch_failed" | "player_api_failed",
  apiErrorCode: "metadata_api_rejected" | "player_api_rejected",
): Promise<{ payload: unknown; status: number; apiCode: string | null }> {
  let response
  try {
    response = await env.fetch(url, { method: "GET", credentials: "include", cache: "no-store" })
  } catch {
    throw new BilibiliAdapterError(fetchErrorCode, "Bilibili 请求失败，请稍后重试。")
  }
  if (!response.ok) {
    throw new BilibiliAdapterError(fetchErrorCode, `Bilibili 请求失败（HTTP ${response.status}）。`)
  }

  let payload: unknown
  try {
    const body = await response.text()
    if (body.length > MAX_BODY_LENGTH) throw new Error("response too large")
    payload = JSON.parse(body)
  } catch {
    throw new BilibiliAdapterError(apiErrorCode, "Bilibili API 返回内容为空或格式无效。")
  }

  const code = (payload as { code?: unknown } | null)?.code
  const apiCode = typeof code === "string" || (typeof code === "number" && Number.isFinite(code))
    ? String(code)
    : null
  if (code !== 0) {
    if (code === -101 || code === -412 || code === -352) {
      throw new BilibiliAdapterError(
        "bilibili_session_restricted",
        `Bilibili 登录状态或接口访问限制（错误码 ${String(code)}）。`,
      )
    }
    throw new BilibiliAdapterError(apiErrorCode, `Bilibili API 拒绝了请求（错误码 ${String(code)}）。`)
  }
  return { payload, status: response.status, apiCode }
}

function readApiCode(buffer: ArrayBuffer): string | null {
  const text = new TextDecoder().decode(buffer).trimStart()
  if (!text.startsWith("{") && !text.startsWith("[")) return null
  try {
    const payload = JSON.parse(text) as { code?: unknown }
    const code = payload?.code
    return typeof code === "string" || (typeof code === "number" && Number.isFinite(code))
      ? String(code)
      : null
  } catch {
    return null
  }
}

function mapSubtitleTracks(value: unknown): SubtitleTrack[] {
  if (!Array.isArray(value)) return []
  const tracks: SubtitleTrack[] = []

  value.forEach((candidate, order) => {
    if (!isRecord(candidate)) return
    const url = normalizeBilibiliSubtitleUrl(candidate.subtitle_url ?? candidate.subtitleUrl)
    if (!url) return
    const language = textValue(candidate.lan).toLowerCase().replaceAll("_", "-")
    tracks.push({
      id: textValue(candidate.id),
      language,
      label: textValue(candidate.lan_doc ?? candidate.lanDoc),
      url,
      source: language.startsWith("ai-") ? "auto" : language ? "manual" : "unknown",
      order,
    })
  })

  return tracks
}

function compareSubtitleTracks(left: SubtitleTrack, right: SubtitleTrack): number {
  const rank = (track: SubtitleTrack) => {
    const language = track.language.replace(/^ai-/, "")
    const label = track.label.toLowerCase()
    const isChinese = language.startsWith("zh") || label.includes("中文") || label.includes("chinese")
    const isEnglish = language.startsWith("en") || label.includes("英文") || label.includes("英语") || label.includes("english")
    const autoOffset = track.source === "auto" ? 1 : 0
    if (isChinese) return autoOffset
    if (isEnglish) return 2 + autoOffset
    return 4 + autoOffset
  }
  return rank(left) - rank(right) || left.order - right.order
}

function normalizeSubtitleBody(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return []
    const startSec = finiteNonnegative(candidate.from)
    const endSec = finiteNonnegative(candidate.to)
    const text = textValue(candidate.content)
    if (startSec === null || endSec === null || endSec < startSec || !text) return []
    return [{ startSec, endSec, text }]
  }).sort((left, right) => left.startSec - right.startSec)
}

function mapNativeChapters(value: unknown): NativeChapter[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const chapters = value.flatMap((candidate) => {
    if (!isRecord(candidate)) return []
    const title = textValue(candidate.content ?? candidate.title ?? candidate.label)
    const startSec = finiteNonnegative(candidate.from ?? candidate.start ?? candidate.start_time)
    if (!title || startSec === null) return []
    const end = finiteNonnegative(candidate.to ?? candidate.end ?? candidate.end_time)
    const endSec = end !== null && end >= startSec ? end : undefined
    const duplicateKey = `${startSec}|${title.toLowerCase()}`
    if (seen.has(duplicateKey)) return []
    seen.add(duplicateKey)
    return [{
      id: `bilibili-chapter-${startSec}`,
      title,
      startSec,
      ...(endSec === undefined ? {} : { endSec }),
      source: "bilibili" as const,
    }]
  })
  return chapters.sort((left, right) => left.startSec - right.startSec)
}

function assertCurrentPage(env: PlatformPageEnvironment, context: BilibiliPageContext): void {
  let currentUrl: URL
  try {
    currentUrl = env.getCurrentUrl?.() ?? env.location
  } catch {
    throw new BilibiliAdapterError("stale_part_request", "Bilibili 分P已切换，已丢弃过期请求。")
  }
  const currentIdentity = bilibiliAdapter.getVideoIdentity(currentUrl)
  const resolvedCidStillBelongsToPart = !context.metadata.pagesProvided
    ? context.pageIndex === 1 && context.cid === context.metadata.defaultCid
    : context.metadata.pages.some((page) => page.page === context.pageIndex && page.cid === context.cid)
  if (
    currentIdentity?.contentKey !== context.identity.contentKey
    || !resolvedCidStillBelongsToPart
  ) {
    throw new BilibiliAdapterError("stale_part_request", "Bilibili 分P已切换，已丢弃过期请求。")
  }
}

function parsePage(value: unknown): BilibiliPage | null {
  if (!isRecord(value)) return null
  const page = positiveInteger(value.page)
  const cid = positiveIntegerString(value.cid)
  if (page === null || !cid) return null
  return {
    page,
    cid,
    part: textValue(value.part),
    duration: finiteNonnegative(value.duration),
  }
}

function isPage(value: BilibiliPage | null): value is BilibiliPage {
  return value !== null
}

function positiveInteger(value: unknown): number | null {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function positiveIntegerString(value: unknown): string | null {
  const number = positiveInteger(value)
  return number === null ? null : String(number)
}

function finiteNonnegative(value: unknown): number | null {
  const number = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN
  return Number.isFinite(number) && number >= 0 ? number : null
}

function secureUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" ? url.toString() : null
  } catch {
    return null
  }
}

function textValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : ""
}

function normalizeLanguage(language: string): string | null {
  const normalized = language.replace(/^ai-/, "").toLowerCase()
  if (!normalized) return null
  if (normalized.startsWith("zh")) return "zh"
  if (normalized.startsWith("en")) return "en"
  return normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
