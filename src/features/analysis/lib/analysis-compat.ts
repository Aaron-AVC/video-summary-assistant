import {
  parseLegacyAnalysis,
  parseVideoAnalysis,
  type LegacyAnalysis,
  type VideoAnalysis
} from "@/features/analysis/lib/analysis-schema"
import type { SegmentSummaryEntity } from "@/lib/schemas/persistence"

export type PersistedAnalysisProjection = {
  summary: string
  keyPoints: unknown[]
  topics?: unknown[]
  segments?: unknown[]
  moments?: unknown[]
  chapters?: unknown[]
}

/**
 * Projects old analysis rows into the canonical domain. This adapter is only
 * for persisted history; fresh provider responses must use parseVideoAnalysis.
 */
export function persistedLegacyAnalysisToVideoAnalysis(
  analysis: PersistedAnalysisProjection,
  segmentSummaries: SegmentSummaryEntity[]
): VideoAnalysis {
  const chapters = (analysis.chapters ?? segmentSummaries).map((segment) => {
    const row = segment as Record<string, unknown>
    const summary = typeof row.summary === "string" ? row.summary.trim() : ""
    const detail = typeof row.detail === "string" && row.detail.trim().length > 0
      ? row.detail.trim()
      : summary
    return {
      title: typeof row.title === "string" ? row.title : "",
      summary,
      detail,
      startSec: row.startSec,
      endSec: row.endSec
    }
  })

  return parseVideoAnalysis({
    summary: analysis.summary,
    keyPoints: analysis.keyPoints.map((point) => {
      if (typeof point === "string") return { text: point }
      const value = point as Record<string, unknown>
      return {
        text: value.text,
        ...(typeof value.startSec === "number" && typeof value.endSec === "number"
          ? { startSec: value.startSec, endSec: value.endSec }
          : {})
      }
    }),
    chapters
  })
}

export function legacyModelShapeToVideoAnalysis(input: unknown): VideoAnalysis {
  const legacy: LegacyAnalysis = parseLegacyAnalysis(input)
  const segments = legacy.moments ?? legacy.segments ?? []
  return parseVideoAnalysis({
    summary: legacy.summary,
    keyPoints: legacy.keyPoints.map((point) => {
      if (typeof point === "string") return { text: point }
      return point
    }),
    chapters: segments.map((segment) => ({
      title: segment.title,
      summary: segment.summary,
      detail: segment.detail ?? segment.summary,
      startSec: segment.startSec,
      endSec: segment.endSec
    }))
  })
}
