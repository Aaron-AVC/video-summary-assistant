import {
  parseAnalysisResult,
  type AnalysisKeyPoint,
  type AnalysisMoment,
  type AnalysisResult,
  type AnalysisSegment,
  type AnalysisTopic,
  type TimestampRange
} from "@/features/analysis/lib/analysis-schema"
import type { TranscriptCue } from "@/features/transcript/lib/transcript-schema"

type RepairAnalysisOptions = {
  transcriptCues: TranscriptCue[]
}

export function repairAnalysisResult(
  input: unknown,
  options: RepairAnalysisOptions
): AnalysisResult {
  const parsed = normalizeUnknownInput(input)
  const segments = normalizeSegments(parsed.segments, options.transcriptCues)
  const moments = normalizeSegments(parsed.moments ?? parsed.segments, options.transcriptCues)
  const repaired = {
    summary: normalizeString(parsed.summary),
    keyPoints: normalizeKeyPoints(parsed.keyPoints, options.transcriptCues),
    topics: normalizeTopics(parsed.topics, options.transcriptCues),
    segments,
    moments
  }

  return parseAnalysisResult(repaired)
}

function normalizeUnknownInput(input: unknown): Record<string, unknown> {
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input) as unknown

      if (isRecord(parsed)) {
        return parsed
      }
    } catch {
      return {}
    }
  }

  return isRecord(input) ? input : {}
}

function normalizeSegments(input: unknown, transcriptCues: TranscriptCue[]): AnalysisSegment[] {
  if (!Array.isArray(input)) {
    return createFallbackSegments(transcriptCues)
  }

  const repairedSegments = input
    .map((segment, index) => normalizeSegment(segment, index, transcriptCues))
    .filter((segment): segment is AnalysisSegment => segment !== null)
    .sort((left, right) => left.startSec - right.startSec)

  return repairedSegments.length > 0 ? repairedSegments : createFallbackSegments(transcriptCues)
}

function normalizeSegment(
  segment: unknown,
  index: number,
  transcriptCues: TranscriptCue[]
) {
  if (!isRecord(segment)) {
    return null
  }

  const range = normalizeRange(segment, transcriptCues, index)

  return {
    title: normalizeString(segment.title, `Segment ${index + 1}`),
    summary: normalizeString(segment.summary, normalizeString(segment.title, "Segment summary")),
    startSec: range.startSec,
    endSec: range.endSec
  }
}

function normalizeKeyPoints(
  input: unknown,
  transcriptCues: TranscriptCue[]
): AnalysisKeyPoint[] {
  if (!Array.isArray(input)) {
    return [createFallbackKeyPoint(transcriptCues)]
  }

  const keyPoints = input
    .map((entry, index) => normalizeKeyPoint(entry, index, transcriptCues))
    .filter((entry): entry is AnalysisKeyPoint => entry !== null)

  return keyPoints.length > 0 ? keyPoints : [createFallbackKeyPoint(transcriptCues)]
}

function normalizeKeyPoint(
  input: unknown,
  index: number,
  transcriptCues: TranscriptCue[]
): AnalysisKeyPoint | null {
  const fallbackRange = getFallbackRange(transcriptCues, index)

  if (typeof input === "string") {
    return {
      text: normalizeString(input),
      startSec: fallbackRange.startSec,
      endSec: fallbackRange.endSec
    }
  }

  if (!isRecord(input)) {
    return null
  }

  const range = normalizeRange(input, transcriptCues, index)

  return {
    text: normalizeString(input.text ?? input.title ?? input.summary, `Key point ${index + 1}`),
    startSec: range.startSec,
    endSec: range.endSec
  }
}

function normalizeTopics(input: unknown, transcriptCues: TranscriptCue[]): AnalysisTopic[] {
  if (!Array.isArray(input)) {
    return [{ label: "Unavailable" }]
  }

  const topics = input
    .map((entry, index) => normalizeTopic(entry, index, transcriptCues))
    .filter((entry): entry is AnalysisTopic => entry !== null)

  return topics.length > 0 ? topics : [{ label: "Unavailable" }]
}

function normalizeTopic(
  input: unknown,
  index: number,
  transcriptCues: TranscriptCue[]
): AnalysisTopic | null {
  if (typeof input === "string") {
    return {
      label: normalizeString(input)
    }
  }

  if (!isRecord(input)) {
    return null
  }

  const label = normalizeString(input.label ?? input.name ?? input.text, `Topic ${index + 1}`)

  if (asNumber(input.startSec) === null && asNumber(input.endSec) === null) {
    return { label }
  }

  const range = normalizeRange(input, transcriptCues, index)

  return {
    label,
    startSec: range.startSec,
    endSec: range.endSec
  }
}

function createFallbackSegments(transcriptCues: TranscriptCue[]): AnalysisSegment[] {
  if (transcriptCues.length === 0) {
    return [
      {
        title: "Segment 1",
        summary: "Analysis segment unavailable.",
        startSec: 0,
        endSec: 0
      }
    ]
  }

  const firstCue = transcriptCues[0]
  const lastCue = transcriptCues[transcriptCues.length - 1]

  return [
    {
      title: "Full video",
      summary: firstCue.text,
      startSec: firstCue.startSec,
      endSec: lastCue.endSec
    }
  ]
}

function createFallbackKeyPoint(transcriptCues: TranscriptCue[]): AnalysisKeyPoint {
  const range = getFallbackRange(transcriptCues, 0)

  return {
    text: "Unavailable",
    startSec: range.startSec,
    endSec: range.endSec
  }
}

function normalizeRange(
  input: Record<string, unknown>,
  transcriptCues: TranscriptCue[],
  index: number
): TimestampRange {
  const { transcriptStart, transcriptEnd } = getTranscriptBounds(transcriptCues)
  const fallbackRange = getFallbackRange(transcriptCues, index)
  const startCandidate = asNumber(input.startSec) ?? fallbackRange.startSec
  const startSec = snapToCueBoundary(startCandidate, transcriptCues, "start")
  const endCandidate = asNumber(input.endSec) ?? fallbackRange.endSec
  const endSec = snapToCueBoundary(Math.max(startSec, endCandidate), transcriptCues, "end")

  return {
    startSec: clamp(startSec, transcriptStart, transcriptEnd),
    endSec: clamp(Math.max(startSec, endSec), transcriptStart, transcriptEnd)
  }
}

function getFallbackRange(transcriptCues: TranscriptCue[], index: number): TimestampRange {
  if (transcriptCues.length === 0) {
    return {
      startSec: 0,
      endSec: 0
    }
  }

  const cue = transcriptCues[Math.min(index, transcriptCues.length - 1)]

  return {
    startSec: cue.startSec,
    endSec: cue.endSec
  }
}

function getTranscriptBounds(transcriptCues: TranscriptCue[]) {
  const cueStarts = transcriptCues.map((cue) => cue.startSec)
  const cueEnds = transcriptCues.map((cue) => cue.endSec)
  const transcriptStart = cueStarts[0] ?? 0
  const transcriptEnd = cueEnds[cueEnds.length - 1] ?? transcriptStart

  return {
    transcriptStart,
    transcriptEnd
  }
}

function normalizeString(value: unknown, fallback = "Unavailable"): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback
}

function snapToCueBoundary(
  value: number,
  transcriptCues: TranscriptCue[],
  edge: "start" | "end"
) {
  if (transcriptCues.length === 0) {
    return Math.max(0, value)
  }

  const boundaries = transcriptCues.map((cue) => (edge === "start" ? cue.startSec : cue.endSec))
  return boundaries.reduce((closest, candidate) =>
    Math.abs(candidate - value) < Math.abs(closest - value) ? candidate : closest
  )
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value)

    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
