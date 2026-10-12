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
const TRANSCRIPT_ROW_SELECTOR = [
  "ytd-transcript-segment-renderer",
  "transcript-segment-view-model",
  "ytm-transcript-segment-renderer",
].join(", ")
const TRANSCRIPT_CONTAINER_SELECTORS = [
  "#segments-container",
  ".ytwTranscriptViewModelHost",
  "[class*='TranscriptViewModelHost']",
  "ytd-transcript-renderer",
  "ytd-transcript-search-panel-renderer",
  "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-searchable-transcript']",
  "ytd-engagement-panel-section-list-renderer[target-id*='transcript']",
  "transcript-view-model",
]

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
  textContent?: string | null
  closest?: (selectors: string) => { getAttribute: (name: string) => string | null } | null
}

type TranscriptTextNodeLike = {
  textContent: string | null
}

type TranscriptQueryRootLike = {
  querySelectorAll: (selector: string) => Iterable<TranscriptSegmentElementLike>
}

type FetchTranscriptDomOptions = {
  document: Document
  metadata: TranscriptPageMetadata
  videoId?: string
  languageCode?: string
}

export async function fetchTranscriptDom({
  document,
  metadata,
  videoId = metadata.videoId,
  languageCode,
}: FetchTranscriptDomOptions): Promise<FetchVttResult> {
  const container = findTranscriptContainer(document)
  let rows = findTranscriptRows(container ?? document, videoId)
  if (rows.length === 0 && container) rows = findTranscriptRows(document, videoId)

  if (rows.length === 0) {
    openTranscriptPanel(document)
    rows = await waitForTranscriptRows(document, videoId)
  }

  if (rows.length === 0) {
    return unsupported(
      "captions_unavailable",
      "Unable to open or read the rendered YouTube transcript panel.",
    )
  }

  const rawVtt = convertTranscriptDomToVtt(createTranscriptRowsRoot(rows))

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
  const elements = findTranscriptRows(root)
  const segments: TranscriptSegment[] = []

  for (const element of elements) {
    const timestampText = firstText(element, [
      ".segment-timestamp",
      "span.ytwTranscriptSegmentViewModelTimestamp",
      ".ytwTranscriptSegmentViewModelTimestamp",
      "[class*='TranscriptSegmentViewModelTimestamp']",
      "[data-timestamp]",
    ])
    const text = firstText(element, [
      ".segment-text",
      "span.ytAttributedStringHost[role='text']",
      ".ytwTranscriptSegmentViewModelText",
      "[class*='TranscriptSegmentViewModelText']",
      "[data-text]",
    ])
      || (element.textContent ?? "").replace(timestampText, "").replace(/\s+/g, " ").trim()
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

export function findTranscriptContainer(document: Document): Element | null {
  let firstCandidate: Element | null = null
  for (const selector of TRANSCRIPT_CONTAINER_SELECTORS) {
    for (const candidate of Array.from(document.querySelectorAll(selector))) {
      firstCandidate ??= candidate
      if (findTranscriptRows(candidate).length > 0) return candidate
    }
  }
  return firstCandidate
}

export function findTranscriptRows(container: TranscriptQueryRootLike, videoId?: string): TranscriptSegmentElementLike[] {
  const rows = Array.from(container.querySelectorAll(TRANSCRIPT_ROW_SELECTOR))
  return videoId ? rows.filter((row) => rowMatchesVideo(row, videoId)) : rows
}

function openTranscriptPanel(document: Document) {
  const trigger = document.querySelector<HTMLElement>(
    [
      "ytd-video-description-transcript-section-renderer button",
      "ytd-video-description-transcript-section-renderer tp-yt-paper-button",
      "ytd-video-description-transcript-section-renderer [role='button']",
      "button[aria-label*='ranscript' i]",
      "[role='button'][aria-label*='ranscript' i]",
      "[aria-controls*='transcript' i]",
    ].join(", "),
  )

  trigger?.click()
}

function firstText(element: TranscriptSegmentElementLike, selectors: string[]): string {
  for (const selector of selectors) {
    const candidate = element.querySelector(selector)
    const text = candidate?.textContent?.replace(/\s+/g, " ").trim() ?? ""
    if (text) return text
  }
  return ""
}

async function waitForTranscriptRows(document: Document, videoId: string): Promise<TranscriptSegmentElementLike[]> {
  const deadline = Date.now() + TRANSCRIPT_PANEL_TIMEOUT_MS

  while (Date.now() < deadline) {
    const container = findTranscriptContainer(document)
    let rows = findTranscriptRows(container ?? document, videoId)
    if (rows.length === 0 && container) rows = findTranscriptRows(document, videoId)
    if (rows.length > 0) return rows

    await delay(TRANSCRIPT_PANEL_POLL_MS)
  }

  const container = findTranscriptContainer(document)
  let rows = findTranscriptRows(container ?? document, videoId)
  if (rows.length === 0 && container) rows = findTranscriptRows(document, videoId)
  return rows
}

function rowMatchesVideo(row: TranscriptSegmentElementLike, videoId: string): boolean {
  if (!videoId) return true
  const owner = row.closest?.("ytd-watch-flexy[video-id], ytd-player[video-id]")
  const ownerId = owner?.getAttribute("video-id")
  return !ownerId || ownerId === videoId
}

function createTranscriptRowsRoot(rows: TranscriptSegmentElementLike[]): TranscriptSegmentRootLike {
  return {
    querySelectorAll: () => rows as TranscriptSegmentElementLike[],
  }
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
