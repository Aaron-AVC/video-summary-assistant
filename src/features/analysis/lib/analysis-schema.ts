import * as z from "zod"

import {
  MAX_ANALYSIS_CHAPTERS,
  MAX_ANALYSIS_KEY_POINTS,
  MAX_ASK_CITATIONS,
  MAX_ASK_FOLLOW_UPS,
  MAX_ASK_SUGGESTED_JUMPS,
  MAX_LEGACY_ANALYSIS_KEY_POINTS,
  MAX_LEGACY_ANALYSIS_SEGMENTS,
  MAX_LEGACY_ANALYSIS_TOPICS
} from "@/lib/schemas/container-limits"

/** Bumped whenever the persisted/model-facing analysis contract changes. */
export const VIDEO_ANALYSIS_SCHEMA_VERSION = 1
export const VIDEO_ANALYSIS_PROMPT_VERSION = "video-analysis-v2"

export const timestampRangeSchema = z.object({
  startSec: z.number().finite().min(0),
  endSec: z.number().finite().min(0)
}).strict().refine((range) => range.endSec >= range.startSec, {
  message: "End time must be greater than or equal to start time",
  path: ["endSec"]
})

const optionalTimestampRangeSchema = z.object({
  startSec: z.number().finite().min(0).optional(),
  endSec: z.number().finite().min(0).optional()
}).strict().superRefine((range, context) => {
  if ((range.startSec === undefined) !== (range.endSec === undefined)) {
    context.addIssue({ code: "custom", message: "Start and end time must be provided together", path: ["endSec"] })
  }
  if (range.startSec !== undefined && range.endSec !== undefined && range.endSec < range.startSec) {
    context.addIssue({ code: "custom", message: "End time must be greater than or equal to start time", path: ["endSec"] })
  }
})

/** Canonical model-facing key point. Storage/UI identities are local concerns. */
export const videoAnalysisKeyPointSchema = z.object({
  text: z.string().trim().min(1),
  startSec: z.number().finite().min(0).optional(),
  endSec: z.number().finite().min(0).optional()
}).strict().superRefine((point, context) => {
  if ((point.startSec === undefined) !== (point.endSec === undefined)) {
    context.addIssue({ code: "custom", message: "Start and end time must be provided together", path: ["endSec"] })
  }
  if (point.startSec !== undefined && point.endSec !== undefined && point.endSec < point.startSec) {
    context.addIssue({ code: "custom", message: "End time must be greater than or equal to start time", path: ["endSec"] })
  }
})

/** Canonical model-facing chapter. */
export const videoAnalysisChapterSchema = z.object({
  title: z.string().trim().min(1),
  startSec: z.number().finite().min(0),
  endSec: z.number().finite().min(0),
  summary: z.string().trim().min(1),
  detail: z.string().trim().min(1)
}).strict().refine((chapter) => chapter.endSec >= chapter.startSec, {
  message: "End time must be greater than or equal to start time",
  path: ["endSec"]
})

export const videoAnalysisSchema = z.object({
  summary: z.string().trim().min(1),
  keyPoints: z.array(videoAnalysisKeyPointSchema).min(1).max(MAX_ANALYSIS_KEY_POINTS),
  chapters: z.array(videoAnalysisChapterSchema).min(1).max(MAX_ANALYSIS_CHAPTERS)
}).strict()

export type VideoAnalysisKeyPoint = z.infer<typeof videoAnalysisKeyPointSchema>
export type VideoAnalysisChapter = z.infer<typeof videoAnalysisChapterSchema>
export type VideoAnalysis = z.infer<typeof videoAnalysisSchema>

export function parseVideoAnalysis(input: unknown): VideoAnalysis {
  return videoAnalysisSchema.parse(input)
}

/** Ask AI remains a separate structured contract. */
export const askVideoCitationSchema = timestampRangeSchema.extend({
  text: z.string().trim().min(1).optional()
}).strict()

export const suggestedJumpSchema = timestampRangeSchema.extend({
  title: z.string().trim().min(1),
  reason: z.string().trim().min(1).optional()
}).strict()

export const askVideoAnswerSchema = z.object({
  answer: z.string().trim().min(1),
  citations: z.array(askVideoCitationSchema).min(1).max(MAX_ASK_CITATIONS),
  suggestedJumps: z.array(suggestedJumpSchema).max(MAX_ASK_SUGGESTED_JUMPS).default([]),
  followUps: z.array(z.string().trim().min(1)).max(MAX_ASK_FOLLOW_UPS).default([])
}).strict()

export type TimestampRange = z.infer<typeof timestampRangeSchema>
export type AskVideoCitation = z.infer<typeof askVideoCitationSchema>
export type SuggestedJump = z.infer<typeof suggestedJumpSchema>
export type AskVideoAnswer = z.infer<typeof askVideoAnswerSchema>

export function parseAskVideoAnswer(input: unknown): AskVideoAnswer {
  return askVideoAnswerSchema.parse(input)
}

/* Persistence-only schemas. They never parse fresh model output. */
export const persistedKeyPointSchema = z.union([
  z.string().trim().min(1).transform((text) => ({ text })),
  z.object({
    id: z.string().trim().min(1).optional(),
    text: z.string().trim().min(1),
    startSec: z.number().finite().min(0).optional(),
    endSec: z.number().finite().min(0).optional()
  }).strict().superRefine((point, context) => {
    if ((point.startSec === undefined) !== (point.endSec === undefined)) {
      context.addIssue({ code: "custom", message: "Start and end time must be provided together", path: ["endSec"] })
    }
    if (point.startSec !== undefined && point.endSec !== undefined && point.endSec < point.startSec) {
      context.addIssue({ code: "custom", message: "End time must be greater than or equal to start time", path: ["endSec"] })
    }
  })
])

export const persistedTopicSchema = z.union([
  z.string().trim().min(1).transform((label) => ({ label })),
  z.object({
    id: z.string().trim().min(1).optional(),
    label: z.string().trim().min(1),
    startSec: z.number().finite().min(0).optional(),
    endSec: z.number().finite().min(0).optional()
  }).strict()
])

export const persistedSegmentSchema = z.object({
  id: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  detail: z.string().trim().min(1).optional(),
  startSec: z.number().finite().min(0),
  endSec: z.number().finite().min(0)
}).strict().refine((segment) => segment.endSec >= segment.startSec, {
  message: "End time must be greater than or equal to start time",
  path: ["endSec"]
})

export const legacyAnalysisSchema = z.object({
  summary: z.string().trim().min(1),
  keyPoints: z.array(persistedKeyPointSchema).min(1).max(MAX_LEGACY_ANALYSIS_KEY_POINTS),
  topics: z.array(persistedTopicSchema).max(MAX_LEGACY_ANALYSIS_TOPICS).default([]),
  segments: z.array(persistedSegmentSchema).min(1).max(MAX_LEGACY_ANALYSIS_SEGMENTS).optional(),
  moments: z.array(persistedSegmentSchema).min(1).max(MAX_LEGACY_ANALYSIS_SEGMENTS).optional()
}).strict()

export type LegacyAnalysis = z.infer<typeof legacyAnalysisSchema>
export type LegacyAnalysisSegment = z.infer<typeof persistedSegmentSchema>

export function parseLegacyAnalysis(input: unknown): LegacyAnalysis {
  const parsed = legacyAnalysisSchema.parse(input)
  if (!parsed.segments && !parsed.moments) {
    throw new z.ZodError([{
      code: "custom",
      message: "Legacy analysis is missing segments",
      path: ["segments"]
    }])
  }
  return parsed
}

// Source-compatibility aliases for code that has migrated to the new contract.
export type AnalysisResult = VideoAnalysis
export type AnalysisKeyPoint = VideoAnalysisKeyPoint
export type AnalysisSegment = VideoAnalysisChapter
export type AnalysisMoment = VideoAnalysisChapter
export type AnalysisTopic = z.infer<typeof persistedTopicSchema>

export const analysisKeyPointSchema = videoAnalysisKeyPointSchema
export const analysisSegmentSchema = videoAnalysisChapterSchema
export const analysisMomentSchema = videoAnalysisChapterSchema
export const analysisTopicSchema = persistedTopicSchema

export function parseAnalysisResult(input: unknown): VideoAnalysis {
  return parseVideoAnalysis(input)
}
