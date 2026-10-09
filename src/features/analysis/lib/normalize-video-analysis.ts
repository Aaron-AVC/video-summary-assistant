import {
  parseVideoAnalysis,
  type VideoAnalysis,
  type VideoAnalysisChapter,
  type VideoAnalysisKeyPoint
} from "@/features/analysis/lib/analysis-schema"
import type { TranscriptCue } from "@/features/transcript/lib/transcript-schema"

export type VideoAnalysisNormalizationOptions = {
  transcriptCues: TranscriptCue[]
  durationSec?: number | null
}

type Bounds = {
  startSec: number
  endSec: number
}

/**
 * Deterministic, semantic-preserving normalization after schema validation.
 * It never invents text, chapters, or timestamps for an untimed key point.
 */
export function normalizeVideoAnalysis(
  analysis: VideoAnalysis,
  options: VideoAnalysisNormalizationOptions
): VideoAnalysis {
  const bounds = getBounds(options.transcriptCues, options.durationSec)
  const chapters = dedupeChapters(
    analysis.chapters
      .map((chapter) => normalizeChapter(chapter, options.transcriptCues, bounds))
      .sort((left, right) => left.startSec - right.startSec || left.endSec - right.endSec)
  )
  const keyPoints = dedupeKeyPoints(
    analysis.keyPoints.map((point) => normalizeKeyPoint(point, options.transcriptCues, bounds))
  )

  // The input schema guarantees non-empty arrays. Keep that invariant explicit
  // rather than silently synthesizing fallback content.
  return parseVideoAnalysis({
    summary: analysis.summary.trim(),
    keyPoints,
    chapters
  })
}

export function getTranscriptBounds(transcriptCues: TranscriptCue[]): Bounds {
  if (transcriptCues.length === 0) return { startSec: 0, endSec: 0 }
  return {
    startSec: Math.min(...transcriptCues.map((cue) => cue.startSec)),
    endSec: Math.max(...transcriptCues.map((cue) => cue.endSec))
  }
}

function getBounds(transcriptCues: TranscriptCue[], durationSec?: number | null): Bounds {
  const transcript = getTranscriptBounds(transcriptCues)
  const hasDuration = typeof durationSec === "number" && Number.isFinite(durationSec) && durationSec >= 0
  const endSec = hasDuration ? Math.min(transcript.endSec, durationSec as number) : transcript.endSec
  return {
    startSec: Math.min(transcript.startSec, endSec),
    endSec: Math.max(0, endSec)
  }
}

function normalizeChapter(
  chapter: VideoAnalysisChapter,
  transcriptCues: TranscriptCue[],
  bounds: Bounds
): VideoAnalysisChapter {
  const startSec = snapStart(clamp(chapter.startSec, bounds), transcriptCues, bounds)
  const endSec = snapEnd(clamp(Math.max(startSec, chapter.endSec), bounds), transcriptCues, bounds)
  return {
    title: chapter.title.trim(),
    summary: chapter.summary.trim(),
    detail: chapter.detail.trim(),
    startSec,
    endSec: Math.max(startSec, endSec)
  }
}

function normalizeKeyPoint(
  point: VideoAnalysisKeyPoint,
  transcriptCues: TranscriptCue[],
  bounds: Bounds
): VideoAnalysisKeyPoint {
  if (point.startSec === undefined || point.endSec === undefined) {
    return { text: point.text.trim() }
  }
  const startSec = snapStart(clamp(point.startSec, bounds), transcriptCues, bounds)
  const endSec = snapEnd(clamp(Math.max(startSec, point.endSec), bounds), transcriptCues, bounds)
  return {
    text: point.text.trim(),
    startSec,
    endSec: Math.max(startSec, endSec)
  }
}

function snapStart(value: number, cues: TranscriptCue[], bounds: Bounds) {
  if (cues.length === 0) return value
  const candidates = cues.map((cue) => cue.startSec).filter((candidate) => candidate <= bounds.endSec)
  if (candidates.length === 0) return value
  return clamp(nearest(value, candidates), bounds)
}

function snapEnd(value: number, cues: TranscriptCue[], bounds: Bounds) {
  if (cues.length === 0) return value
  const candidates = cues.map((cue) => cue.endSec).filter((candidate) => candidate >= bounds.startSec)
  if (candidates.length === 0) return value
  return clamp(nearest(value, candidates), bounds)
}

function nearest(value: number, candidates: number[]) {
  return candidates.reduce((closest, candidate) =>
    Math.abs(candidate - value) < Math.abs(closest - value) ? candidate : closest
  )
}

function clamp(value: number, bounds: Bounds) {
  return Math.min(bounds.endSec, Math.max(bounds.startSec, value))
}

function dedupeKeyPoints(points: VideoAnalysisKeyPoint[]) {
  const seen = new Set<string>()
  const timestamped: VideoAnalysisKeyPoint[] = []
  const untimed: VideoAnalysisKeyPoint[] = []
  for (const point of points) {
    const text = normalizeIdentityText(point.text)
    const range = point.startSec === undefined ? "untimed" : `${point.startSec}:${point.endSec}`
    const key = `${text}|${range}`
    if (seen.has(key)) continue
    seen.add(key)
    if (point.startSec === undefined) untimed.push(point)
    else timestamped.push(point)
  }
  timestamped.sort((left, right) => (left.startSec ?? 0) - (right.startSec ?? 0))
  return [...timestamped, ...untimed]
}

function dedupeChapters(chapters: VideoAnalysisChapter[]) {
  const seen = new Set<string>()
  return chapters.filter((chapter) => {
    const key = `${normalizeIdentityText(chapter.title)}|${chapter.startSec}:${chapter.endSec}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeIdentityText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase()
}
