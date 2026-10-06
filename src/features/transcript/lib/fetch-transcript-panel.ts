import {
  TranscriptUnsupportedError,
  type FetchLike,
  type FetchVttResult,
  type TranscriptPageMetadata,
  type TranscriptTrack,
} from "./transcript-schema"

import { pickTranscriptTrack } from "./fetch-vtt"

const DEFAULT_LANGUAGE = "en"
const TRANSCRIPT_FALLBACK_DURATION_MS = 1_000

type FetchTranscriptPanelOptions = {
  metadata: TranscriptPageMetadata
  pageUrl: string
  languageCode?: string
  fetchImpl?: FetchLike
}

type TranscriptPanelPayload = {
  actions?: unknown[]
}

type TranscriptSegmentRenderer = {
  startMs?: number | string
  endMs?: number | string
  snippet?: {
    simpleText?: string
    runs?: Array<{
      text?: string
    }>
  }
}

export async function fetchTranscriptPanel({
  metadata,
  pageUrl,
  languageCode,
  fetchImpl = globalThis.fetch as FetchLike,
}: FetchTranscriptPanelOptions): Promise<FetchVttResult | null> {
  const transcriptPanel = metadata.transcriptPanel

  if (!transcriptPanel?.endpointUrl || !transcriptPanel.params || !transcriptPanel.context) {
    return null
  }

  const response = await fetchImpl(transcriptPanel.endpointUrl, {
    method: "POST",
    credentials: "include",
    headers: buildTranscriptPanelHeaders(transcriptPanel.clientName, transcriptPanel.clientVersion, transcriptPanel.visitorData, pageUrl),
    body: JSON.stringify({
      context: transcriptPanel.context,
      params: transcriptPanel.params,
    }),
  })

  if (!response.ok) {
    return unsupported(
      "transcript_request_failed",
      `Transcript panel request failed: ${response.status} ${response.statusText}`,
    )
  }

  const rawPayload = await response.text()
  const rawVtt = convertTranscriptPayloadToVtt(rawPayload)

  if (!rawVtt) {
    return unsupported(
      "captions_unavailable",
      "Transcript panel returned no usable transcript segments.",
    )
  }

  return {
    ok: true,
    rawVtt,
    track: pickTranscriptTrack(metadata.tracks, languageCode) ?? createFallbackTrack(languageCode, transcriptPanel.endpointUrl),
    sourceUrl: transcriptPanel.endpointUrl,
    source: "transcript_panel",
  }
}

function buildTranscriptPanelHeaders(
  clientName: string | null,
  clientVersion: string | null,
  visitorData: string | null,
  pageUrl: string,
): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Origin: "https://www.youtube.com",
    Referer: pageUrl,
  }

  if (clientName) {
    headers["X-Youtube-Client-Name"] = clientName
  }

  if (clientVersion) {
    headers["X-Youtube-Client-Version"] = clientVersion
  }

  if (visitorData) {
    headers["X-Goog-Visitor-Id"] = visitorData
  }

  return headers
}

function convertTranscriptPayloadToVtt(rawPayload: string): string | null {
  if (!rawPayload.trim()) {
    return null
  }

  let payload: TranscriptPanelPayload

  try {
    payload = JSON.parse(rawPayload) as TranscriptPanelPayload
  } catch {
    return null
  }

  const cues = collectTranscriptSegments(payload)

  if (cues.length === 0) {
    return null
  }

  const lines = ["WEBVTT", ""]

  for (const [index, cue] of cues.entries()) {
    const nextCue = cues[index + 1]
    const fallbackEndMs = nextCue?.startMs && nextCue.startMs > cue.startMs
      ? nextCue.startMs
      : cue.startMs + TRANSCRIPT_FALLBACK_DURATION_MS
    const endMs = Math.max(cue.endMs ?? cue.startMs, fallbackEndMs)

    lines.push(String(index + 1))
    lines.push(`${formatTimestamp(cue.startMs)} --> ${formatTimestamp(endMs)}`)
    lines.push(cue.text)
    lines.push("")
  }

  return lines.join("\n")
}

function collectTranscriptSegments(payload: TranscriptPanelPayload) {
  const segments: Array<{ startMs: number; endMs: number | null; text: string }> = []

  walkForSegments(payload, segments)

  return segments.sort((left, right) => left.startMs - right.startMs)
}

function walkForSegments(
  node: unknown,
  segments: Array<{ startMs: number; endMs: number | null; text: string }>,
) {
  if (!node) {
    return
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      walkForSegments(item, segments)
    }

    return
  }

  if (typeof node !== "object") {
    return
  }

  const record = node as Record<string, unknown>

  if ("transcriptSegmentRenderer" in record) {
    const segment = createTranscriptSegment(record.transcriptSegmentRenderer as TranscriptSegmentRenderer)

    if (segment) {
      segments.push(segment)
    }
  }

  for (const value of Object.values(record)) {
    walkForSegments(value, segments)
  }
}

function createTranscriptSegment(segment: TranscriptSegmentRenderer) {
  const startMs = readMilliseconds(segment.startMs)
  const endMs = readMilliseconds(segment.endMs)
  const text = readTextRuns(segment.snippet).replace(/\s+/g, " ").trim()

  if (startMs === null || !text) {
    return null
  }

  return {
    startMs,
    endMs,
    text,
  }
}

function readTextRuns(snippet: TranscriptSegmentRenderer["snippet"]) {
  if (!snippet) {
    return ""
  }

  if (snippet.simpleText) {
    return snippet.simpleText
  }

  return (snippet.runs ?? []).map((run) => run.text ?? "").join("")
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

function createFallbackTrack(languageCode = DEFAULT_LANGUAGE, endpointUrl: string): TranscriptTrack {
  return {
    languageCode,
    baseUrl: endpointUrl,
    name: "Transcript panel",
    isAutoGenerated: false,
  }
}

function unsupported(
  reason: TranscriptUnsupportedError["reason"],
  details: string,
): FetchVttResult {
  return {
    ok: false,
    error: new TranscriptUnsupportedError(reason, details),
  }
}
