import {
  TranscriptUnsupportedError,
  type FetchVttResult,
  type TranscriptPageMetadata,
  type TranscriptTrack,
} from "./transcript-schema"

import { pickTranscriptTrack } from "./fetch-vtt"

const TRANSCRIPT_PANEL_SOURCE_URL = "youtube-ui://transcript-panel"
const TRANSCRIPT_PANEL_TIMEOUT_MS = 5_000
const TRANSCRIPT_PANEL_POLL_MS = 100
const TRANSCRIPT_FALLBACK_DURATION_MS = 1_000

type TranscriptSegment = {
  startMs: number
  endMs: number | null
  text: string
}

type TranscriptSegmentRootLike = {
  querySelectorAll: (selector: string) => Iterable<TranscriptSegmentElementLike>
}

type TranscriptSegmentElementLike = {
  querySelector: (selector: string) => TranscriptTextNodeLike | null
}

type TranscriptTextNodeLike = {
  textContent: string | null
}

type FetchTranscriptDomOptions = {
  document: Document
  metadata: TranscriptPageMetadata
  languageCode?: string
}

export async function fetchTranscriptDom({
  document,
  metadata,
  languageCode,
}: FetchTranscriptDomOptions): Promise<FetchVttResult> {
  let root = findTranscriptSegmentsRoot(document)

  if (!hasTranscriptSegments(root)) {
    openTranscriptPanel(document)
    root = await waitForTranscriptSegmentsRoot(document)
  }

  if (!root || !hasTranscriptSegments(root)) {
    return unsupported(
      "captions_unavailable",
      "Unable to open or read the rendered YouTube transcript panel.",
    )
  }

  const rawVtt = convertTranscriptDomToVtt(root)

  if (!rawVtt) {
    return unsupported(
      "captions_unavailable",
      "The rendered YouTube transcript panel contained no usable transcript rows.",
    )
  }

  return {
    ok: true,
    rawVtt,
    track:
      pickTranscriptTrack(metadata.tracks, languageCode)
      ?? createFallbackTrack(languageCode),
    sourceUrl: TRANSCRIPT_PANEL_SOURCE_URL,
    source: "in_page",
  }
}

export function convertTranscriptDomToVtt(root: TranscriptSegmentRootLike): string | null {
  const segments = readTranscriptSegments(root)

  if (segments.length === 0) {
    return null
  }

  const lines = ["WEBVTT", ""]

  for (const [index, segment] of segments.entries()) {
    const nextSegment = segments[index + 1]
    const fallbackEndMs = nextSegment?.startMs && nextSegment.startMs > segment.startMs
      ? nextSegment.startMs
      : segment.startMs + TRANSCRIPT_FALLBACK_DURATION_MS
    const endMs = Math.max(segment.endMs ?? segment.startMs, fallbackEndMs)

    lines.push(String(index + 1))
    lines.push(`${formatTimestamp(segment.startMs)} --> ${formatTimestamp(endMs)}`)
    lines.push(segment.text)
    lines.push("")
  }

  return lines.join("\n")
}

export function readTranscriptSegments(root: TranscriptSegmentRootLike): TranscriptSegment[] {
  const elements = Array.from(
    root.querySelectorAll("ytd-transcript-segment-renderer, ytd-transcript-segment-list-renderer ytd-transcript-segment-renderer"),
  )
  const segments: TranscriptSegment[] = []

  for (const element of elements) {
    const timestampText = element.querySelector(".segment-timestamp")?.textContent?.trim() ?? ""
    const text = element.querySelector(".segment-text")?.textContent?.replace(/\s+/g, " ").trim() ?? ""
    const startMs = parseTranscriptTimestamp(timestampText)

    if (startMs === null || !text) {
      continue
    }

    segments.push({
      startMs,
      endMs: null,
      text,
    })
  }

  return segments
}

export function parseTranscriptTimestamp(timestampText: string): number | null {
  const parts = timestampText
    .trim()
    .split(":")
    .map((part) => Number(part))

  if (parts.length < 2 || parts.some((part) => !Number.isFinite(part) || part < 0)) {
    return null
  }

  const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, parts[0] ?? 0, parts[1] ?? 0]

  return ((hours * 60 * 60) + (minutes * 60) + seconds) * 1_000
}

function findTranscriptSegmentsRoot(document: Document) {
  return document.querySelector<HTMLElement>(
    '#segments-container, .ytd-transcript-search-panel-renderer #segments-container',
  )
}

function hasTranscriptSegments(root: Element | null) {
  return Boolean(root?.querySelector("ytd-transcript-segment-renderer"))
}

function openTranscriptPanel(document: Document) {
  const trigger = document.querySelector<HTMLElement>(
    [
      "ytd-video-description-transcript-section-renderer button",
      "ytd-video-description-transcript-section-renderer tp-yt-paper-button",
      "ytd-video-description-transcript-section-renderer [role='button']",
    ].join(", "),
  )

  trigger?.click()
}

async function waitForTranscriptSegmentsRoot(document: Document) {
  const deadline = Date.now() + TRANSCRIPT_PANEL_TIMEOUT_MS

  while (Date.now() < deadline) {
    const root = findTranscriptSegmentsRoot(document)

    if (hasTranscriptSegments(root)) {
      return root
    }

    await delay(TRANSCRIPT_PANEL_POLL_MS)
  }

  return findTranscriptSegmentsRoot(document)
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
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

function createFallbackTrack(languageCode = "en"): TranscriptTrack {
  return {
    languageCode,
    baseUrl: TRANSCRIPT_PANEL_SOURCE_URL,
    name: "Rendered transcript panel",
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
