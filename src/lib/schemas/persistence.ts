import { z } from "zod"

import {
  persistedKeyPointSchema,
  persistedTopicSchema,
  askVideoAnswerSchema,
  videoAnalysisSchema
} from "@/features/analysis/lib/analysis-schema"

export const persistedRunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed"
])

export const isoDateTimeSchema = z.string().datetime({ offset: true })

export const transcriptCueSchema = z.object({
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  text: z.string().trim().min(1)
}).refine((cue) => cue.endSec >= cue.startSec, {
  message: "End time must be greater than or equal to start time",
  path: ["endSec"]
})

export const providerConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  baseUrl: z.string().trim().url(),
  model: z.string().trim().min(1),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
})

export const providerConfigExportSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  baseUrl: z.string().trim().url(),
  model: z.string().trim().min(1),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  isDefault: z.boolean().optional(),
  hasApiKey: z.boolean()
})
export const transcriptSnapshotSchema = z.object({
  id: z.string().min(1),
  videoId: z.string().trim().min(1),
  platform: z.enum(["youtube", "bilibili"]).optional(),
  contentKey: z.string().trim().min(1).optional(),
  partId: z.string().trim().min(1).nullable().optional(),
  fingerprint: z.string().trim().min(1).nullable().optional(),
  language: z.string().trim().min(1).nullable(),
  sourceUrl: z.string().trim().url().nullable(),
  rawVtt: z.string().nullable(),
  cues: z.array(transcriptCueSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
})

export const segmentSummarySchema = z.object({
  id: z.string().min(1),
  analysisRunId: z.string().min(1),
  videoId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  detail: z.string().trim().min(1).optional(),
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
}).refine((segment) => segment.endSec >= segment.startSec, {
  message: "End time must be greater than or equal to start time",
  path: ["endSec"]
})

export const analysisRunSchema = z.object({
  id: z.string().min(1),
  videoId: z.string().trim().min(1),
  platform: z.enum(["youtube", "bilibili"]).optional(),
  contentKey: z.string().trim().min(1).optional(),
  partId: z.string().trim().min(1).nullable().optional(),
  transcriptSnapshotId: z.string().min(1),
  providerConfigId: z.string().min(1).nullable(),
  transcriptFingerprint: z.string().trim().min(1).nullable().optional(),
  analysisSchemaVersion: z.number().int().positive().nullable().optional(),
  analysisPromptVersion: z.string().trim().min(1).nullable().optional(),
  analysisCacheKey: z.string().trim().min(1).nullable().optional(),
  providerProfileId: z.string().trim().min(1).nullable().optional(),
  providerBaseUrl: z.string().trim().url().nullable().optional(),
  providerModel: z.string().trim().min(1).nullable().optional(),
  status: persistedRunStatusSchema,
  summary: z.string(),
  keyPoints: z.array(persistedKeyPointSchema),
  topics: z.array(persistedTopicSchema),
  errorMessage: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable()
})

export const recentVideoSchema = z.object({
  videoId: z.string().trim().min(1),
  platform: z.enum(["youtube", "bilibili"]).optional(),
  contentKey: z.string().trim().min(1).optional(),
  partId: z.string().trim().min(1).nullable().optional(),
  title: z.string().trim().min(1),
  channelTitle: z.string().trim().min(1).nullable(),
  thumbnailUrl: z.string().trim().url().nullable(),
  status: persistedRunStatusSchema.nullable(),
  updatedAt: isoDateTimeSchema,
  openedAt: isoDateTimeSchema,
  analyzedAt: isoDateTimeSchema.nullable()
})

export const videoRecordSchema = z.object({
  contentKey: z.string().trim().min(1),
  platform: z.enum(["youtube", "bilibili"]),
  videoId: z.string().trim().min(1),
  partId: z.string().trim().min(1).nullable(),
  title: z.string().trim().min(1),
  channelTitle: z.string().trim().min(1).nullable(),
  thumbnailUrl: z.string().trim().url().nullable(),
  canonicalUrl: z.string().trim().url().nullable(),
  durationSec: z.number().finite().min(0).nullable(),
  openedAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  analyzedAt: isoDateTimeSchema.nullable()
})

export const transcriptCacheSchema = z.object({
  id: z.string().min(1),
  contentKey: z.string().trim().min(1),
  platform: z.enum(["youtube", "bilibili"]),
  videoId: z.string().trim().min(1),
  partId: z.string().trim().min(1).nullable(),
  fingerprint: z.string().trim().min(1).nullable(),
  fingerprintVersion: z.number().int().positive().nullable().optional(),
  language: z.string().trim().min(1).nullable(),
  sourceUrl: z.string().trim().url().nullable(),
  rawVtt: z.string().nullable(),
  cues: z.array(transcriptCueSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
})

export const analysisCacheSchema = z.object({
  cacheKey: z.string().trim().min(1),
  contentKey: z.string().trim().min(1),
  platform: z.enum(["youtube", "bilibili"]),
  videoId: z.string().trim().min(1),
  partId: z.string().trim().min(1).nullable(),
  transcriptFingerprint: z.string().trim().min(1).nullable(),
  analysisSchemaVersion: z.number().int().positive().nullable(),
  analysisPromptVersion: z.string().trim().min(1).nullable(),
  providerProfileId: z.string().trim().min(1).nullable(),
  providerBaseUrl: z.string().trim().url().nullable(),
  providerModel: z.string().trim().min(1).nullable(),
  analysisRunId: z.string().min(1).nullable(),
  analysis: videoAnalysisSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
})

export const qaAnswerSchema = z.object({
  cacheKey: z.string().trim().min(1),
  contentKey: z.string().trim().min(1),
  transcriptFingerprint: z.string().trim().min(1),
  analysisRunId: z.string().min(1),
  providerProfileId: z.string().trim().min(1),
  providerBaseUrl: z.string().trim().url(),
  providerModel: z.string().trim().min(1),
  question: z.string().trim().min(1),
  schemaVersion: z.number().int().positive(),
  promptVersion: z.string().trim().min(1),
  answer: askVideoAnswerSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
})

export const persistenceExportSchema = z.object({
  providerConfigs: z.array(providerConfigExportSchema),
  transcriptSnapshots: z.array(transcriptSnapshotSchema),
  analysisRuns: z.array(analysisRunSchema),
  segmentSummaries: z.array(segmentSummarySchema),
  recentVideos: z.array(recentVideoSchema),
  videoRecords: z.array(videoRecordSchema).optional(),
  transcriptCache: z.array(transcriptCacheSchema).optional(),
  analysisCache: z.array(analysisCacheSchema).optional(),
  qaAnswers: z.array(qaAnswerSchema).optional()
})

export type PersistedRunStatus = z.infer<typeof persistedRunStatusSchema>
export type TranscriptCueEntity = z.infer<typeof transcriptCueSchema>
export type ProviderConfigEntity = z.infer<typeof providerConfigSchema>
export type ProviderConfigExportEntity = z.infer<typeof providerConfigExportSchema>
export type TranscriptSnapshotEntity = z.infer<typeof transcriptSnapshotSchema>
export type SegmentSummaryEntity = z.infer<typeof segmentSummarySchema>
export type AnalysisRunEntity = z.infer<typeof analysisRunSchema>
export type RecentVideoEntity = z.infer<typeof recentVideoSchema>
export type PersistenceExport = z.infer<typeof persistenceExportSchema>
export type VideoRecordEntity = z.infer<typeof videoRecordSchema>
export type TranscriptCacheEntity = z.infer<typeof transcriptCacheSchema>
export type AnalysisCacheEntity = z.infer<typeof analysisCacheSchema>
export type QaAnswerEntity = z.infer<typeof qaAnswerSchema>
