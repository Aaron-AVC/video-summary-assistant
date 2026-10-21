import { z } from "zod"

import {
  persistedKeyPointSchema,
  persistedTopicSchema,
  askVideoAnswerSchema,
  videoAnalysisSchema
} from "@/features/analysis/lib/analysis-schema"
import {
  DEFAULT_PROVIDER_GENERATION_TIMEOUT_SEC,
  MAX_PROVIDER_GENERATION_TIMEOUT_SEC,
  MIN_PROVIDER_GENERATION_TIMEOUT_SEC,
} from "@/features/settings/lib/provider-schema"

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
  generationTimeoutSec: z.number().int().min(MIN_PROVIDER_GENERATION_TIMEOUT_SEC).max(MAX_PROVIDER_GENERATION_TIMEOUT_SEC).default(DEFAULT_PROVIDER_GENERATION_TIMEOUT_SEC),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
})

export const providerConfigExportSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  baseUrl: z.string().trim().url(),
  model: z.string().trim().min(1),
  generationTimeoutSec: z.number().int().min(MIN_PROVIDER_GENERATION_TIMEOUT_SEC).max(MAX_PROVIDER_GENERATION_TIMEOUT_SEC).default(DEFAULT_PROVIDER_GENERATION_TIMEOUT_SEC),
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
  contentKey: z.string().trim().min(1).optional(),
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
  analysisRunId: z.string().min(1).optional(),
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

export const qaThreadSchema = z.object({
  id: z.string().min(1),
  contentKey: z.string().trim().min(1),
  platform: z.enum(["youtube", "bilibili"]),
  videoId: z.string().trim().min(1),
  partId: z.string().trim().min(1).nullable(),
  title: z.string().trim().min(1),
  analysisRunId: z.string().min(1),
  transcriptFingerprint: z.string().trim().min(1),
  providerProfileId: z.string().trim().min(1),
  providerBaseUrl: z.string().trim().url(),
  providerModel: z.string().trim().min(1),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
})

export const qaMessageCitationSchema = z.object({
  text: z.string().optional(),
  startSec: z.number().min(0),
  endSec: z.number().min(0).optional()
}).refine((citation) => citation.endSec === undefined || citation.endSec >= citation.startSec, {
  message: "Citation end must be greater than or equal to its start",
  path: ["endSec"]
})

export const qaMessageSuggestedJumpSchema = z.object({
  title: z.string().trim().min(1),
  reason: z.string().trim().min(1).optional(),
  startSec: z.number().min(0),
  endSec: z.number().min(0)
}).refine((jump) => jump.endSec >= jump.startSec, {
  message: "Suggested jump end must be greater than or equal to its start",
  path: ["endSec"]
})

export const qaMessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1),
  citations: z.array(qaMessageCitationSchema).optional(),
  suggestedJumps: z.array(qaMessageSuggestedJumpSchema).optional(),
  followUps: z.array(z.string().trim().min(1)).optional(),
  createdAt: isoDateTimeSchema
})

export const knowledgeItemKindSchema = z.enum(["bookmark", "note"])

export const MAX_KNOWLEDGE_NOTE_LENGTH = 10000

/**
 * Canonical Bookmark / Note row. `contentKey` is the authoritative identity so
 * Bilibili `p1` and `p2` never collapse into one another; a bare `videoId` is
 * only carried for presentation and export readability.
 *
 * Kind invariants:
 *  - `bookmark` is a point anchor created by the UI: `startSec === endSec` and
 *    `text` is null.
 *  - `note` carries trimmed text and either has no anchor at all or a complete
 *    range; a one-sided range is never valid.
 */
export const knowledgeItemSchema = z.object({
  id: z.string().min(1),
  kind: knowledgeItemKindSchema,
  contentKey: z.string().trim().min(1),
  platform: z.enum(["youtube", "bilibili"]),
  videoId: z.string().trim().min(1),
  partId: z.string().trim().min(1).nullable(),
  videoTitle: z.string().trim().min(1),
  analysisRunId: z.string().min(1).nullable(),
  startSec: z.number().finite().min(0).nullable(),
  endSec: z.number().finite().min(0).nullable(),
  text: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
}).strict().superRefine((item, context) => {
  const hasStart = item.startSec !== null
  const hasEnd = item.endSec !== null
  if (hasStart !== hasEnd) {
    context.addIssue({
      code: "custom",
      message: "Knowledge anchors must declare both start and end seconds",
      path: ["endSec"]
    })
    return
  }
  if (hasStart && hasEnd && item.endSec! < item.startSec!) {
    context.addIssue({
      code: "custom",
      message: "End time must be greater than or equal to start time",
      path: ["endSec"]
    })
  }
  if (item.kind === "bookmark") {
    if (!hasStart) {
      context.addIssue({
        code: "custom",
        message: "Bookmarks must record a timestamp",
        path: ["startSec"]
      })
    } else if (item.startSec !== item.endSec) {
      context.addIssue({
        code: "custom",
        message: "UI-created bookmarks are point anchors",
        path: ["endSec"]
      })
    }
    if (item.text !== null) {
      context.addIssue({
        code: "custom",
        message: "Bookmarks cannot carry note text",
        path: ["text"]
      })
    }
    return
  }
  const trimmedText = item.text?.trim() ?? ""
  if (!trimmedText) {
    context.addIssue({
      code: "custom",
      message: "Notes require non-empty text",
      path: ["text"]
    })
    return
  }
  if (trimmedText.length > MAX_KNOWLEDGE_NOTE_LENGTH) {
    context.addIssue({
      code: "custom",
      message: `Notes cannot exceed ${MAX_KNOWLEDGE_NOTE_LENGTH} characters`,
      path: ["text"]
    })
  }
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
  qaAnswers: z.array(qaAnswerSchema).optional(),
  qaThreads: z.array(qaThreadSchema).optional(),
  qaMessages: z.array(qaMessageSchema).optional(),
  // Optional so exports produced before V1.1 Bookmark + Notes still validate.
  knowledgeItems: z.array(knowledgeItemSchema).optional()
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
export type QaThreadEntity = z.infer<typeof qaThreadSchema>
export type QaMessageCitation = z.infer<typeof qaMessageCitationSchema>
export type QaMessageSuggestedJump = z.infer<typeof qaMessageSuggestedJumpSchema>
export type QaMessageEntity = z.infer<typeof qaMessageSchema>
export type KnowledgeItemKind = z.infer<typeof knowledgeItemKindSchema>
export type KnowledgeItemEntity = z.infer<typeof knowledgeItemSchema>
