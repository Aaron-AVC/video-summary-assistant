export type YouTubeLiveCaptionTrack = {
  languageCode: string
  languageName?: string | null
  displayName?: string | null
  kind?: string | null
  vssId?: string | null
}

export type YouTubeCurrentCaptionTrack = {
  languageCode: string
  kind?: string | null
  vssId?: string | null
}

export type YouTubeTimedtextCandidate = {
  url: string
  videoId: string
  languageCode: string
  format: string | null
  startTime: number
}

export type YouTubeLivePlayerState = {
  videoId: string
  title: string | null
  author: string | null
  captionTracks: YouTubeLiveCaptionTrack[]
  subtitlesOn: boolean | null
  currentCaptionTrack: YouTubeCurrentCaptionTrack | null
  timedtextCandidates: YouTubeTimedtextCandidate[]
}

const ALLOWED_TIMEDTEXT_HOSTS = new Set(["youtube.com", "www.youtube.com"])
const MAX_TIMEDTEXT_CANDIDATES = 100
const MAX_LIVE_TEXT_LENGTH = 512

/**
 * This function is passed directly to chrome.scripting.executeScript. Keep it
 * self-contained so Chrome can serialize it into the page's MAIN world.
 */
export function readYouTubeLivePlayerStateInMainWorld(
  expectedVideoId: string,
): YouTubeLivePlayerState | null {
  const allowedHosts = new Set(["youtube.com", "www.youtube.com"])
  const maxCandidates = 100
  const maxTextLength = 512
  const readMainText = (value: unknown): string | null => {
    if (typeof value !== "string") return null
    const text = value.trim()
    return text && text.length <= maxTextLength ? text : null
  }
  const readMainTrackArray = (value: unknown): unknown[] => {
    if (Array.isArray(value)) return value
    if (
      typeof value === "object"
      && value !== null
      && "captionTracks" in value
      && Array.isArray((value as { captionTracks?: unknown }).captionTracks)
    ) return (value as { captionTracks: unknown[] }).captionTracks
    return []
  }

  try {
    const pageUrl = new URL(globalThis.location.href)
    if (pageUrl.searchParams.get("v") !== expectedVideoId) return null

    const player = document.getElementById("movie_player") as (HTMLElement & {
      getVideoData?: () => Record<string, unknown> | null
      getOption?: (category: string, option: string) => unknown
      isSubtitlesOn?: () => unknown
    }) | null
    const videoData = player?.getVideoData?.()
    if (!videoData || typeof videoData !== "object") return null

    const playerVideoId = readMainText(videoData.videoId) ?? readMainText(videoData.video_id)
    if (playerVideoId !== expectedVideoId) return null

    const rawTracks = readMainTrackArray(player?.getOption?.("captions", "tracklist"))
    const captionTracks = rawTracks
      .slice(0, maxCandidates)
      .flatMap((track) => {
        if (!track || typeof track !== "object") return []
        const value = track as Record<string, unknown>
        const languageCode = readMainText(value.languageCode)
        if (!languageCode || !/^[a-zA-Z0-9_-]{1,64}$/.test(languageCode)) return []
        return [{
          languageCode,
          languageName: readMainText(value.languageName),
          displayName: readMainText(value.displayName),
          kind: readMainText(value.kind),
          vssId: readMainText(value.vssId) ?? readMainText(value.vss_id),
        }]
      })

    const rawCurrentTrack = player?.getOption?.("captions", "track")
    const currentCaptionTrack = (() => {
      if (!rawCurrentTrack || typeof rawCurrentTrack !== "object") return null
      const value = rawCurrentTrack as Record<string, unknown>
      const languageCode = readMainText(value.languageCode)
      if (!languageCode || !/^[a-zA-Z0-9_-]{1,64}$/.test(languageCode)) return null
      return {
        languageCode,
        kind: readMainText(value.kind),
        vssId: readMainText(value.vssId) ?? readMainText(value.vss_id),
      }
    })()
    const subtitlesOnValue = player?.isSubtitlesOn?.()
    const subtitlesOn = typeof subtitlesOnValue === "boolean" ? subtitlesOnValue : null

    const timedtextCandidates: YouTubeTimedtextCandidate[] = []
    for (const entry of performance.getEntriesByType("resource")) {
      if (timedtextCandidates.length >= maxCandidates) break
      if (typeof entry.name !== "string") continue
      const urlText = entry.name
      if (typeof urlText !== "string" || urlText.length === 0 || urlText.length > 16_384) continue

      try {
        const resourceUrl = new URL(urlText)
        const languageCode = resourceUrl.searchParams.get("lang")?.trim() ?? ""
        const videoId = resourceUrl.searchParams.get("v")
        if (
          resourceUrl.protocol !== "https:"
          || !allowedHosts.has(resourceUrl.hostname.toLowerCase())
          || resourceUrl.pathname !== "/api/timedtext"
          || videoId !== expectedVideoId
          || !languageCode
          || !/^[a-zA-Z0-9_-]{1,64}$/.test(languageCode)
        ) continue

        const startTime = Number.isFinite(entry.startTime) && entry.startTime >= 0
          ? entry.startTime
          : 0
        timedtextCandidates.push({
          url: urlText,
          videoId,
          languageCode,
          format: resourceUrl.searchParams.get("fmt"),
          startTime,
        })
      } catch {
        // A page may contain arbitrary resource names; ignore malformed entries.
      }
    }

    return {
      videoId: playerVideoId,
      title: readMainText(videoData.title),
      author: readMainText(videoData.author),
      captionTracks,
      subtitlesOn,
      currentCaptionTrack,
      timedtextCandidates,
    }
  } catch {
    return null
  }
}

export function normalizeYouTubeLivePlayerState(
  value: unknown,
  expectedVideoId: string,
): YouTubeLivePlayerState | null {
  if (!isRecord(value) || value.videoId !== expectedVideoId) return null

  const rawTracks = Array.isArray(value.captionTracks) ? value.captionTracks : []
  const captionTracks = rawTracks
    .slice(0, MAX_TIMEDTEXT_CANDIDATES)
    .flatMap((rawTrack) => {
      if (!isRecord(rawTrack)) return []
      const languageCode = readSafeLanguage(rawTrack.languageCode)
      if (!languageCode) return []
      return [{
        languageCode,
        languageName: readOptionalText(rawTrack.languageName),
        displayName: readOptionalText(rawTrack.displayName),
        kind: readOptionalText(rawTrack.kind),
        vssId: readOptionalText(rawTrack.vssId) ?? readOptionalText(rawTrack.vss_id),
      }]
    })

  const rawCandidates = Array.isArray(value.timedtextCandidates) ? value.timedtextCandidates : []
  const timedtextCandidates = rawCandidates
    .slice(0, MAX_TIMEDTEXT_CANDIDATES)
    .flatMap((rawCandidate) => {
      if (!isRecord(rawCandidate) || typeof rawCandidate.url !== "string") return []
      const urlText = rawCandidate.url
      if (urlText.length === 0 || urlText.length > 16_384) return []

      try {
        const url = new URL(urlText)
        const videoId = url.searchParams.get("v")
        const languageCode = readSafeLanguage(url.searchParams.get("lang"))
        const format = url.searchParams.get("fmt")
        if (
          url.protocol !== "https:"
          || (url.username !== "" || url.password !== "")
          || !ALLOWED_TIMEDTEXT_HOSTS.has(url.hostname.toLowerCase())
          || url.pathname !== "/api/timedtext"
          || videoId !== expectedVideoId
          || !languageCode
          || (rawCandidate.videoId !== null
            && rawCandidate.videoId !== undefined
            && rawCandidate.videoId !== videoId)
          || (rawCandidate.languageCode !== null
            && rawCandidate.languageCode !== undefined
            && rawCandidate.languageCode !== languageCode)
          || (rawCandidate.format !== null
            && rawCandidate.format !== undefined
            && rawCandidate.format !== format)
        ) return []

        const startTime = typeof rawCandidate.startTime === "number"
          && Number.isFinite(rawCandidate.startTime)
          && rawCandidate.startTime >= 0
          ? rawCandidate.startTime
          : 0
        return [{ url: urlText, videoId, languageCode, format, startTime }]
      } catch {
        return []
      }
    })

  return {
    videoId: expectedVideoId,
    title: readOptionalText(value.title),
    author: readOptionalText(value.author),
    captionTracks,
    subtitlesOn: typeof value.subtitlesOn === "boolean" ? value.subtitlesOn : null,
    currentCaptionTrack: normalizeCurrentCaptionTrack(value.currentCaptionTrack),
    timedtextCandidates,
  }
}

export function normalizeYouTubeTimedtextCandidate(
  value: unknown,
  expectedVideoId: string,
): YouTubeTimedtextCandidate | null {
  const normalized = normalizeYouTubeLivePlayerState({
    videoId: expectedVideoId,
    title: null,
    author: null,
    captionTracks: [],
    subtitlesOn: null,
    currentCaptionTrack: null,
    timedtextCandidates: [value],
  }, expectedVideoId)
  return normalized?.timedtextCandidates[0] ?? null
}

/**
 * This function is passed directly to chrome.scripting.executeScript. Keep it
 * self-contained so Chrome can serialize it into the page's MAIN world.
 */
export async function refreshYouTubeCaptionResourceInMainWorld(
  expectedVideoId: string,
  previousStartTime: number,
): Promise<YouTubeTimedtextCandidate | null> {
  const allowedHosts = new Set(["youtube.com", "www.youtube.com"])
  const maxWaitMs = 3_000
  const pollIntervalMs = 100
  const readMainText = (value: unknown): string | null => {
    if (typeof value !== "string") return null
    const text = value.trim()
    return text && text.length <= 512 ? text : null
  }
  const readCurrentCaptionTrack = (value: unknown): { languageCode: string; kind: string | null; vssId: string | null } | null => {
    if (!value || typeof value !== "object") return null
    const record = value as Record<string, unknown>
    const languageCode = readMainText(record.languageCode)
    if (!languageCode || !/^[a-zA-Z0-9_-]{1,64}$/.test(languageCode)) return null
    return {
      languageCode,
      kind: readMainText(record.kind),
      vssId: readMainText(record.vssId) ?? readMainText(record.vss_id),
    }
  }
  const readCandidate = (entry: PerformanceResourceTiming, languageCode: string): YouTubeTimedtextCandidate | null => {
    if (typeof entry.name !== "string" || entry.name.length === 0 || entry.name.length > 16_384) return null
    try {
      const url = new URL(entry.name)
      const entryVideoId = url.searchParams.get("v")
      const entryLanguageCode = url.searchParams.get("lang")?.trim() ?? ""
      if (
        url.protocol !== "https:"
        || !allowedHosts.has(url.hostname.toLowerCase())
        || url.username !== ""
        || url.password !== ""
        || url.pathname !== "/api/timedtext"
        || entryVideoId !== expectedVideoId
        || entryLanguageCode !== languageCode
        || !/^[a-zA-Z0-9_-]{1,64}$/.test(entryLanguageCode)
      ) return null
      const startTime = Number.isFinite(entry.startTime) && entry.startTime >= 0 ? entry.startTime : 0
      if (!(startTime > previousStartTime)) return null
      return {
        url: entry.name,
        videoId: entryVideoId,
        languageCode: entryLanguageCode,
        format: url.searchParams.get("fmt"),
        startTime,
      }
    } catch {
      return null
    }
  }
  const findNewCandidate = (languageCode: string): YouTubeTimedtextCandidate | null => {
    const candidates: YouTubeTimedtextCandidate[] = []
    for (const entry of performance.getEntriesByType("resource")) {
      const candidate = readCandidate(entry as PerformanceResourceTiming, languageCode)
      if (candidate) candidates.push(candidate)
    }
    return candidates.sort((left, right) => {
      const formatPriority = Number(right.format === "json3") - Number(left.format === "json3")
      if (formatPriority !== 0) return formatPriority
      return right.startTime - left.startTime
    })[0] ?? null
  }

  try {
    const pageUrl = new URL(globalThis.location.href)
    if (pageUrl.searchParams.get("v") !== expectedVideoId) return null

    const player = document.getElementById("movie_player") as (HTMLElement & {
      getVideoData?: () => Record<string, unknown> | null
      getOption?: (category: string, option: string) => unknown
      isSubtitlesOn?: () => unknown
      setOption?: (category: string, option: string, value: unknown) => void
    }) | null
    const videoData = player?.getVideoData?.()
    const playerVideoId = videoData && typeof videoData === "object"
      ? readMainText(videoData.videoId) ?? readMainText(videoData.video_id)
      : null
    if (!playerVideoId || playerVideoId !== expectedVideoId) return null
    if (player?.isSubtitlesOn?.() !== true) return null

    const currentCaptionTrack = readCurrentCaptionTrack(player?.getOption?.("captions", "track"))
    if (!currentCaptionTrack || typeof player?.setOption !== "function") return null

    player.setOption("captions", "reload", true)
    const immediate = findNewCandidate(currentCaptionTrack.languageCode)
    if (immediate) return immediate

    const deadline = Date.now() + maxWaitMs
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
      const candidate = findNewCandidate(currentCaptionTrack.languageCode)
      if (candidate) return candidate
    }
    return null
  } catch {
    return null
  }
}

export function selectYouTubeTimedtextCandidate(
  candidates: YouTubeTimedtextCandidate[],
  preferredLanguageCode = "en",
): YouTubeTimedtextCandidate | null {
  const normalizedPreference = preferredLanguageCode.trim().toLowerCase()
  const preferredBaseLanguage = normalizedPreference.split("-")[0] ?? normalizedPreference

  return [...candidates].sort((left, right) => {
    const languagePriority = languageMatchPriority(left.languageCode, normalizedPreference, preferredBaseLanguage)
      - languageMatchPriority(right.languageCode, normalizedPreference, preferredBaseLanguage)
    if (languagePriority !== 0) return languagePriority

    const formatPriority = Number(right.format === "json3") - Number(left.format === "json3")
    if (formatPriority !== 0) return formatPriority

    return right.startTime - left.startTime
  })[0] ?? null
}

export function describeYouTubeLiveTimedtextStrategy(
  candidate: YouTubeTimedtextCandidate,
  videoId: string,
): string {
  const url = new URL(candidate.url)
  const languageCode = safeDiagnosticValue(candidate.languageCode)
  const format = url.searchParams.get("fmt")
  const safeFormat = format && /^[a-zA-Z0-9_-]{1,20}$/.test(format) ? format : "unknown"
  return `strategy=live_timedtext videoId=${safeDiagnosticValue(videoId)} lang=${languageCode} fmt=${safeFormat} hasPot=${url.searchParams.has("pot")} hasPotc=${url.searchParams.has("potc")}`
}

export function describeYouTubeCaptionReloadStrategy(
  candidate: YouTubeTimedtextCandidate | null,
  videoId: string,
  fallbackLanguageCode: string | null,
  refreshLatencyMs: number,
): string {
  const url = candidate ? new URL(candidate.url) : null
  const languageCode = safeDiagnosticValue(candidate?.languageCode ?? fallbackLanguageCode ?? "unknown")
  const format = url?.searchParams.get("fmt")
  const safeFormat = format && /^[a-zA-Z0-9_-]{1,20}$/.test(format) ? format : "unknown"
  const safeLatency = Number.isFinite(refreshLatencyMs) && refreshLatencyMs >= 0
    ? Math.round(refreshLatencyMs)
    : 0
  return `strategy=caption_reload videoId=${safeDiagnosticValue(videoId)} lang=${languageCode} fmt=${safeFormat} hasPot=${url?.searchParams.has("pot") === true} hasPotc=${url?.searchParams.has("potc") === true} refreshLatencyMs=${safeLatency}`
}

function languageMatchPriority(languageCode: string, exactPreference: string, basePreference: string): number {
  const normalized = languageCode.trim().toLowerCase()
  if (normalized === exactPreference) return 0
  if (normalized === basePreference || normalized.startsWith(`${basePreference}-`)) return 1
  return 2
}

function readTrackArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (isRecord(value) && Array.isArray(value.captionTracks)) return value.captionTracks
  return []
}

function readText(value: unknown): string | null {
  if (typeof value !== "string") return null
  const text = value.trim()
  if (!text || text.length > MAX_LIVE_TEXT_LENGTH) return null
  return text
}

function readOptionalText(value: unknown): string | null {
  return readText(value)
}

function normalizeCurrentCaptionTrack(value: unknown): YouTubeCurrentCaptionTrack | null {
  if (!isRecord(value)) return null
  const languageCode = readSafeLanguage(value.languageCode)
  if (!languageCode) return null
  return {
    languageCode,
    kind: readOptionalText(value.kind),
    vssId: readOptionalText(value.vssId) ?? readOptionalText(value.vss_id),
  }
}

function readSafeLanguage(value: unknown): string | null {
  const text = readText(value)
  return text && /^[a-zA-Z0-9_-]{1,64}$/.test(text) ? text : null
}

function safeDiagnosticValue(value: string): string {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : "unknown"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
