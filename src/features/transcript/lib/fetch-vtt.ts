import {
  TranscriptUnsupportedError,
  type FetchLike,
  type FetchVttOptions,
  type FetchVttResult,
  type TranscriptTrack,
} from "./transcript-schema"
import { redactTranscriptFetchUrls } from "./transcript-url-sanitizer"

const DEFAULT_LANGUAGE = "en"
const SUPPORTED_TIMEDTEXT_FORMATS = ["vtt", "json3"] as const
const JSON3_FALLBACK_DURATION_MS = 1_000

type TimedtextFormat = (typeof SUPPORTED_TIMEDTEXT_FORMATS)[number]

type Json3Payload = {
  events?: Json3Event[]
}

type Json3Event = {
  tStartMs?: number | string
  dDurationMs?: number | string
  segs?: Array<{
    utf8?: string
  }>
}

export function buildRawVttUrl(baseUrl: string): string {
  return buildTranscriptUrl(baseUrl, "vtt")
}

function buildTranscriptUrl(baseUrl: string, format: TimedtextFormat): string {
  const url = new URL(baseUrl)

  url.searchParams.set("fmt", format)

  return url.toString()
}

export function pickTranscriptTrack(
  tracks: TranscriptTrack[],
  languageCode = DEFAULT_LANGUAGE,
): TranscriptTrack | null {
  if (tracks.length === 0) {
    return null
  }

  const normalizedLanguage = normalizeLanguageCode(languageCode)
  const exact = tracks.find(
    (track) => normalizeLanguageCode(track.languageCode) === normalizedLanguage,
  )

  if (exact) {
    return exact
  }

  const baseLanguage = normalizedLanguage.split("-")[0]
  const languageMatch = tracks.find((track) =>
    normalizeLanguageCode(track.languageCode).startsWith(`${baseLanguage}-`),
  )

  if (languageMatch) {
    return languageMatch
  }

  return [...tracks].sort(compareTrackPriority)[0] ?? null
}

export async function fetchVtt({
  tracks,
  languageCode,
  fetchImpl = globalThis.fetch as FetchLike,
}: FetchVttOptions): Promise<FetchVttResult> {
  if (!tracks?.length) {
    return unsupported("captions_unavailable", "No caption tracks found.")
  }

  const candidateTracks = rankTranscriptTracks(tracks, languageCode)

  if (candidateTracks.length === 0) {
    return unsupported("captions_unavailable", "No matching caption track found.")
  }

  const failedRequests: string[] = []
  let attemptedRequests = 0

  for (const track of candidateTracks) {
    const transcriptUrls = [
      track.baseUrl,
      ...SUPPORTED_TIMEDTEXT_FORMATS.map((format) => buildTranscriptUrl(track.baseUrl, format)),
    ]

    for (const sourceUrl of transcriptUrls) {
      attemptedRequests += 1

      const response = await fetchImpl(sourceUrl, { credentials: "include" })

      if (!response.ok) {
        failedRequests.push(
          `${track.languageCode}/${describeTranscriptUrl(sourceUrl)}: ${response.status} ${response.statusText}`,
        )
        continue
      }

      const rawTranscript = await response.text()
      const rawVtt = convertTimedtextToVtt(sourceUrl, rawTranscript)

      if (!rawVtt) {
        continue
      }

      return {
        ok: true,
        rawVtt,
        track,
        sourceUrl,
        source: "in_page",
      }
    }
  }

  if (failedRequests.length === attemptedRequests) {
    return unsupported(
      "transcript_request_failed",
      `Transcript requests failed for all supported formats (${failedRequests.join(", ")}).`,
    )
  }

  return unsupported(
    "captions_unavailable",
    "YouTube exposed caption tracks, but returned no usable transcript cues for any track via raw timedtext, VTT, or JSON3.",
  )
}

/** Fetch a player-observed URL exactly as-is; never rebuild its signed parameters. */
export async function fetchExactTimedtext({
  url,
  track,
  fetchImpl = globalThis.fetch as FetchLike,
}: {
  url: string
  track: TranscriptTrack
  fetchImpl?: FetchLike
}): Promise<FetchVttResult> {
  try {
    const response = await fetchImpl(url, {
      credentials: "include",
      redirect: "error",
    })

    if (!response.ok) {
      return unsupported(
        "transcript_request_failed",
        `Live timedtext request failed with HTTP ${response.status}.`,
      )
    }

    const rawVtt = convertTimedtextToVtt(url, await response.text())
    if (!rawVtt) {
      return unsupported("captions_unavailable", "Live timedtext returned no usable cues.")
    }

    return {
      ok: true,
      rawVtt,
      track,
      sourceUrl: "",
      source: "in_page",
    }
  } catch {
    return unsupported("transcript_request_failed", "Live timedtext request failed.")
  }
}

function rankTranscriptTracks(
  tracks: TranscriptTrack[],
  languageCode = DEFAULT_LANGUAGE,
): TranscriptTrack[] {
  const normalizedLanguage = normalizeLanguageCode(languageCode)
  const baseLanguage = normalizedLanguage.split("-")[0]
  const exactMatches = tracks.filter(
    (track) => normalizeLanguageCode(track.languageCode) === normalizedLanguage,
  )
  const regionalMatches = tracks.filter((track) => {
    const normalizedTrackLanguage = normalizeLanguageCode(track.languageCode)

    return (
      normalizedTrackLanguage !== normalizedLanguage
      && normalizedTrackLanguage.startsWith(`${baseLanguage}-`)
    )
  })
  const remainingTracks = tracks.filter((track) => !exactMatches.includes(track) && !regionalMatches.includes(track))

  return [...exactMatches, ...regionalMatches, ...remainingTracks].sort(compareTrackPriority)
}

function normalizeLanguageCode(languageCode: string): string {
  return languageCode.trim().toLowerCase()
}

function compareTrackPriority(left: TranscriptTrack, right: TranscriptTrack): number {
  const leftScore = scoreTrack(left)
  const rightScore = scoreTrack(right)

  if (leftScore !== rightScore) {
    return rightScore - leftScore
  }

  return left.languageCode.localeCompare(right.languageCode)
}

function scoreTrack(track: TranscriptTrack): number {
  const hasLabel = track.name?.trim() ? 2 : 0
  const isManual = track.isAutoGenerated ? 0 : 4
  const isDefaultLanguage = normalizeLanguageCode(track.languageCode) === DEFAULT_LANGUAGE ? 1 : 0

  return hasLabel + isManual + isDefaultLanguage
}

function unsupported(
  reason: TranscriptUnsupportedError["reason"],
  details: string,
): FetchVttResult {
  return {
    ok: false,
    error: new TranscriptUnsupportedError(reason, redactTranscriptFetchUrls(details)),
  }
}

function convertTimedtextToVtt(sourceUrl: string, rawTranscript: string): string | null {
  if (!rawTranscript.trim()) {
    return null
  }

  const format = new URL(sourceUrl).searchParams.get("fmt")

  if (format === "json3") {
    return convertJson3ToVtt(rawTranscript)
  }

  if (format === "vtt") {
    return rawTranscript
  }

  return convertXmlTimedtextToVtt(rawTranscript)
}

function convertJson3ToVtt(rawTranscript: string): string | null {
  if (!rawTranscript.trim()) {
    return null
  }

  let payload: Json3Payload

  try {
    payload = JSON.parse(rawTranscript) as Json3Payload
  } catch {
    return null
  }

  const cues = (payload.events ?? [])
    .map((event) => {
      const startMs = readMilliseconds(event.tStartMs)
      const durationMs = readMilliseconds(event.dDurationMs)
      const text = (event.segs ?? [])
        .map((segment) => segment.utf8 ?? "")
        .join("")
        .trim()

      if (startMs === null || !text) {
        return null
      }

      return {
        startMs,
        durationMs,
        text,
      }
    })
    .filter((cue): cue is { startMs: number; durationMs: number | null; text: string } => cue !== null)

  if (cues.length === 0) {
    return null
  }

  const lines = ["WEBVTT", ""]

  for (const [index, cue] of cues.entries()) {
    const nextCue = cues[index + 1]
    const fallbackEndMs = nextCue?.startMs && nextCue.startMs > cue.startMs
      ? nextCue.startMs
      : cue.startMs + JSON3_FALLBACK_DURATION_MS
    const endMs = Math.max(cue.startMs + (cue.durationMs ?? 0), fallbackEndMs)

    lines.push(String(index + 1))
    lines.push(`${formatTimestamp(cue.startMs)} --> ${formatTimestamp(endMs)}`)
    lines.push(cue.text)
    lines.push("")
  }

  return lines.join("\n")
}

function readMilliseconds(value: number | string | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)

    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

function formatTimestamp(milliseconds: number) {
  const totalSeconds = Math.max(milliseconds, 0) / 1_000
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${seconds
    .toFixed(3)
    .padStart(6, "0")}`
}

function convertXmlTimedtextToVtt(rawTranscript: string): string | null {
  const textCueMatches = [...rawTranscript.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)]
  const paragraphCueMatches = [...rawTranscript.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)]
  const cues = [
    ...textCueMatches.map((match) => createXmlCue(match[1] ?? "", match[2] ?? "")),
    ...paragraphCueMatches.map((match) => createXmlCue(match[1] ?? "", match[2] ?? "")),
  ].filter(
    (cue): cue is { startMs: number; endMs: number; text: string } => cue !== null,
  )

  if (cues.length === 0) {
    return null
  }

  const lines = ["WEBVTT", ""]

  for (const [index, cue] of cues.entries()) {
    lines.push(String(index + 1))
    lines.push(`${formatTimestamp(cue.startMs)} --> ${formatTimestamp(cue.endMs)}`)
    lines.push(cue.text)
    lines.push("")
  }

  return lines.join("\n")
}

function createXmlCue(attributesText: string, textContent: string) {
  const startMs = readMilliseconds(readXmlAttribute(attributesText, ["t", "start"], 1_000))

  if (startMs === null) {
    return null
  }

  const durationMs = readMilliseconds(readXmlAttribute(attributesText, ["d", "dur"], 1_000))
  const text = stripXmlTags(decodeXmlEntities(textContent)).replace(/\s+/g, " ").trim()

  if (!text) {
    return null
  }

  return {
    startMs,
    endMs: Math.max(startMs + (durationMs ?? JSON3_FALLBACK_DURATION_MS), startMs + 1),
    text,
  }
}

function readXmlAttribute(attributesText: string, names: string[], multiplier: number) {
  for (const name of names) {
    const match = attributesText.match(new RegExp(`${name}="([^"]+)"`))

    if (!match?.[1]) {
      continue
    }

    const parsed = Number(match[1])

    if (Number.isFinite(parsed)) {
      return parsed * multiplier
    }
  }

  return undefined
}

function stripXmlTags(text: string) {
  return text.replace(/<[^>]+>/g, " ")
}

function decodeXmlEntities(text: string) {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

function describeTranscriptUrl(sourceUrl: string) {
  const format = new URL(sourceUrl).searchParams.get("fmt")

  return format ? format.toUpperCase() : "RAW"
}
