import { z } from "zod"

export const timestampRangeSchema = z.object({
  startSec: z.number().finite().min(0),
  endSec: z.number().finite().min(0)
}).refine((range) => range.endSec >= range.startSec, {
  message: "End time must be greater than or equal to start time",
  path: ["endSec"]
})

const optionalTimestampRangeSchema = z.object({
  startSec: z.number().finite().min(0).optional(),
  endSec: z.number().finite().min(0).optional()
}).refine(
  (range) => (range.startSec === undefined) === (range.endSec === undefined),
  {
    message: "Start and end time must be provided together",
    path: ["endSec"]
  }
).refine(
  (range) =>
    range.startSec === undefined ||
    range.endSec === undefined ||
    range.endSec >= range.startSec,
  {
    message: "End time must be greater than or equal to start time",
    path: ["endSec"]
  }
)

export const timestampedTextSchema = timestampRangeSchema.extend({
  id: z.string().trim().min(1).optional(),
  text: z.string().trim().min(1)
})

const legacyKeyPointSchema = z.string().trim().min(1).transform((text) => ({
  text
}))

export const analysisKeyPointSchema = z.union([
  timestampedTextSchema,
  legacyKeyPointSchema
])

const legacyTopicSchema = z.string().trim().min(1).transform((label) => ({
  label
}))

export const analysisTopicSchema = z.union([
  optionalTimestampRangeSchema.extend({
    id: z.string().trim().min(1).optional(),
    label: z.string().trim().min(1)
  }),
  legacyTopicSchema
])

export const analysisSegmentSchema = timestampRangeSchema.extend({
  id: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1)
})

export const analysisMomentSchema = analysisSegmentSchema

export const analysisResultSchema = z.object({
  summary: z.string().trim().min(1),
  keyPoints: z.array(analysisKeyPointSchema).min(1),
  topics: z.array(analysisTopicSchema).default([]),
  segments: z.array(analysisSegmentSchema).min(1),
  moments: z.array(analysisMomentSchema).optional()
}).transform((result) => ({
  ...result,
  moments: result.moments?.length ? result.moments : result.segments
}))

export const askVideoCitationSchema = timestampRangeSchema.extend({
  id: z.string().trim().min(1).optional(),
  text: z.string().trim().min(1).optional()
})

export const suggestedJumpSchema = timestampRangeSchema.extend({
  id: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1),
  reason: z.string().trim().min(1).optional()
})

export const askVideoAnswerSchema = z.object({
  answer: z.string().trim().min(1),
  citations: z.array(askVideoCitationSchema).min(1),
  suggestedJumps: z.array(suggestedJumpSchema).default([]),
  followUps: z.array(z.string().trim().min(1)).default([])
})

export type TimestampRange = z.infer<typeof timestampRangeSchema>
export type TimestampedText = z.infer<typeof timestampedTextSchema>
export type AnalysisKeyPoint = z.infer<typeof analysisKeyPointSchema>
export type AnalysisTopic = z.infer<typeof analysisTopicSchema>
export type AnalysisSegment = z.infer<typeof analysisSegmentSchema>
export type AnalysisMoment = z.infer<typeof analysisMomentSchema>
export type AnalysisResult = z.infer<typeof analysisResultSchema>
export type AskVideoCitation = z.infer<typeof askVideoCitationSchema>
export type SuggestedJump = z.infer<typeof suggestedJumpSchema>
export type AskVideoAnswer = z.infer<typeof askVideoAnswerSchema>

export function parseAnalysisResult(input: unknown): AnalysisResult {
  return analysisResultSchema.parse(input)
}

export function parseAskVideoAnswer(input: unknown): AskVideoAnswer {
  return askVideoAnswerSchema.parse(input)
}
