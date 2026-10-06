import { z } from "zod"

import {
  analysisKeyPointSchema,
  analysisTopicSchema
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
  apiKey: z.string().trim().min(1),
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
  transcriptSnapshotId: z.string().min(1),
  providerConfigId: z.string().min(1).nullable(),
  status: persistedRunStatusSchema,
  summary: z.string(),
  keyPoints: z.array(analysisKeyPointSchema),
  topics: z.array(analysisTopicSchema),
  errorMessage: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable()
})

export const recentVideoSchema = z.object({
  videoId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  channelTitle: z.string().trim().min(1).nullable(),
  thumbnailUrl: z.string().trim().url().nullable(),
  status: persistedRunStatusSchema.nullable(),
  updatedAt: isoDateTimeSchema,
  openedAt: isoDateTimeSchema,
  analyzedAt: isoDateTimeSchema.nullable()
})

export const persistenceExportSchema = z.object({
  providerConfigs: z.array(providerConfigExportSchema),
  transcriptSnapshots: z.array(transcriptSnapshotSchema),
  analysisRuns: z.array(analysisRunSchema),
  segmentSummaries: z.array(segmentSummarySchema),
  recentVideos: z.array(recentVideoSchema)
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
