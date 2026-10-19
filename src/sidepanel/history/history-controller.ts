import type { VideoAnalysis } from "@/features/analysis/lib/analysis-schema"
import { persistedLegacyAnalysisToVideoAnalysis } from "@/features/analysis/lib/analysis-compat"
import { projectPersistedVideoIdentity } from "@/features/platform/persistence-compat"
import type {
  TranscriptSegment,
  VideoIdentity,
  VideoPlatform,
} from "@/features/platform/types"
import type {
  AnalysisRunEntity,
  RecentVideoEntity,
  SegmentSummaryEntity,
  TranscriptCacheEntity,
  TranscriptSnapshotEntity,
  VideoRecordEntity,
} from "@/lib/schemas/persistence"
import type { ActiveVideoContext } from "@/features/platform/types"
import { resolveAskTranscriptFingerprint } from "@/sidepanel/lib/ask-transcript-identity"

type SavedAnalysisRunAggregate = {
  analysisRun: AnalysisRunEntity
  segments: SegmentSummaryEntity[]
  transcript: TranscriptSnapshotEntity | TranscriptCacheEntity | null
  videoRecord: VideoRecordEntity | null
}

export type HistoryRecentEntry = {
  recentVideo: Pick<
    RecentVideoEntity,
    "videoId" | "analysisRunId" | "contentKey" | "platform" | "partId" | "title" | "channelTitle" | "status" | "updatedAt"
  >
  analysis: unknown | null
}

export type HistoryRecentAnalysisItem = {
  videoId: string
  analysisRunId?: string
  contentKey?: string
  partId?: string | null
  platform?: VideoPlatform
  title: string
  channelTitle: string | null
  status: string | null
  updatedAt: string
}

export type HistoryContext = Pick<
  ActiveVideoContext,
  "platform" | "videoId" | "partId" | "contentKey" | "title"
> & {
  platform: VideoPlatform
  videoId: string
  contentKey: string
}

type HistoricalAnalysisRecord = AnalysisRunEntity & {
  segments: SegmentSummaryEntity[]
}

type HistoricalTranscriptRecord = TranscriptSnapshotEntity | TranscriptCacheEntity
type ExecutionMetadataMode = "persisted" | "legacy-null"

export type HistoryControllerDependencies = {
  listRecentAnalyses: (limit: number) => Promise<HistoryRecentEntry[]>
  getCurrentAnalysisByVideoId: (videoId: string) => Promise<HistoricalAnalysisRecord | null>
  getLatestTranscriptSnapshotByVideoId: (videoId: string) => Promise<TranscriptSnapshotEntity | null>
  getCurrentAnalysisByContentKey: (contentKey: string) => Promise<HistoricalAnalysisRecord | null>
  getLatestTranscriptByContentKey: (contentKey: string) => Promise<HistoricalTranscriptRecord | null>
  getSavedAnalysisRunById: (analysisRunId: string) => Promise<SavedAnalysisRunAggregate | null>
}

export type HistoryTranscriptSnapshot = {
  exists: boolean
  cues: TranscriptSegment[]
  identity: VideoIdentity | null
  title: string
  fingerprint: string | null
  rawVtt: string | null
}

export type HistoryAnalysisSnapshot = {
  platform: VideoPlatform
  videoId: string
  partId: string | null
  contentKey: string
  title: string
  analysis: VideoAnalysis
  analysisRunId: string | null
  transcriptFingerprint: string | null
  providerProfileId: string | null
  providerBaseUrl: string | null
  providerModel: string | null
  analysisSchemaVersion: number | null
  analysisPromptVersion: string | null
  lastAnalyzedAt: string | null
  errorMessage: string | null
}

export type HistoryRestoreSnapshot = {
  sourceIdentity: VideoIdentity
  transcript: HistoryTranscriptSnapshot
  analysis: HistoryAnalysisSnapshot | null
}

export type HistoryRestoreResult =
  | { kind: "stale" }
  | { kind: "ready"; snapshot: HistoryRestoreSnapshot }

export type HistoryController = {
  listRecentAnalyses: (limit: number) => Promise<HistoryRecentAnalysisItem[]>
  loadLegacyVideoRestore: (input: {
    videoId: string
    isCurrent: () => boolean
  }) => Promise<HistoryRestoreResult>
  loadCurrentContextRestore: (input: {
    context: HistoryContext
    isCurrent: () => boolean
  }) => Promise<HistoryRestoreResult>
  loadSavedRunRestore: (input: {
    analysisRunId: string
    isCurrent: () => boolean
  }) => Promise<HistoryRestoreResult>
}

function toRecentAnalysisItem(entry: HistoryRecentEntry): HistoryRecentAnalysisItem {
  return {
    videoId: entry.recentVideo.videoId,
    analysisRunId: entry.recentVideo.analysisRunId,
    contentKey: entry.recentVideo.contentKey,
    platform: entry.recentVideo.platform,
    partId: entry.recentVideo.partId,
    title: entry.recentVideo.title,
    channelTitle: entry.recentVideo.channelTitle,
    status: entry.recentVideo.status,
    updatedAt: entry.recentVideo.updatedAt,
  }
}

function toTranscriptSnapshot({
  record,
  identity,
  title,
  fingerprint,
}: {
  record: HistoricalTranscriptRecord | null
  identity: VideoIdentity | null
  title: string
  fingerprint: string | null
}): HistoryTranscriptSnapshot {
  return {
    exists: Boolean(record),
    cues: record?.cues ?? [],
    identity,
    title,
    fingerprint,
    rawVtt: record?.rawVtt ?? null,
  }
}

function toAnalysisSnapshot({
  analysis,
  platform,
  videoId,
  partId,
  contentKey,
  title,
  analysisRunId,
  executionMetadataMode = "persisted",
}: {
  analysis: HistoricalAnalysisRecord
  platform: VideoPlatform
  videoId: string
  partId: string | null
  contentKey: string
  title: string
  analysisRunId: string | null
  executionMetadataMode?: ExecutionMetadataMode
}): HistoryAnalysisSnapshot {
  return {
    platform,
    videoId,
    partId,
    contentKey,
    title,
    analysis: persistedLegacyAnalysisToVideoAnalysis(analysis, analysis.segments),
    analysisRunId,
    transcriptFingerprint: analysis.transcriptFingerprint ?? null,
    providerProfileId: executionMetadataMode === "legacy-null" ? null : analysis.providerProfileId ?? null,
    providerBaseUrl: executionMetadataMode === "legacy-null" ? null : analysis.providerBaseUrl ?? null,
    providerModel: executionMetadataMode === "legacy-null" ? null : analysis.providerModel ?? null,
    analysisSchemaVersion: executionMetadataMode === "legacy-null" ? null : analysis.analysisSchemaVersion ?? null,
    analysisPromptVersion: executionMetadataMode === "legacy-null" ? null : analysis.analysisPromptVersion ?? null,
    lastAnalyzedAt: analysis.completedAt,
    errorMessage: analysis.errorMessage,
  }
}

function ready(snapshot: HistoryRestoreSnapshot): HistoryRestoreResult {
  return { kind: "ready", snapshot }
}

function stale(): HistoryRestoreResult {
  return { kind: "stale" }
}

export function createHistoryController(
  dependencies: HistoryControllerDependencies,
): HistoryController {
  return {
    async listRecentAnalyses(limit) {
      const entries = await dependencies.listRecentAnalyses(limit)
      return entries
        .filter((entry) => Boolean(entry.analysis))
        .map(toRecentAnalysisItem)
    },

    async loadLegacyVideoRestore({ videoId, isCurrent }) {
      const [analysis, transcript, recent] = await Promise.all([
        dependencies.getCurrentAnalysisByVideoId(videoId),
        dependencies.getLatestTranscriptSnapshotByVideoId(videoId),
        dependencies.listRecentAnalyses(25),
      ])
      if (!isCurrent()) return stale()

      const sourceIdentity = projectPersistedVideoIdentity(videoId)
      const title = recent.find((entry) => entry.recentVideo.videoId === videoId)?.recentVideo.title ?? videoId
      const fingerprint = await resolveAskTranscriptFingerprint({
        currentFingerprint: transcript?.fingerprint ?? null,
        transcriptCues: transcript?.cues ?? [],
      })
      if (!isCurrent()) return stale()

      return ready({
        sourceIdentity,
        transcript: toTranscriptSnapshot({
          record: transcript,
          identity: transcript ? sourceIdentity : null,
          title,
          fingerprint,
        }),
        analysis: analysis
          ? toAnalysisSnapshot({
              analysis,
              platform: "youtube",
              videoId,
              partId: null,
              contentKey: sourceIdentity.contentKey,
              title,
              analysisRunId: analysis.id,
              executionMetadataMode: "legacy-null",
            })
          : null,
      })
    },

    async loadCurrentContextRestore({ context, isCurrent }) {
      const [analysis, transcript] = await Promise.all([
        dependencies.getCurrentAnalysisByContentKey(context.contentKey),
        dependencies.getLatestTranscriptByContentKey(context.contentKey),
      ])
      if (!isCurrent()) return stale()

      const title = context.title ?? context.videoId
      const fingerprint = await resolveAskTranscriptFingerprint({
        currentFingerprint: transcript?.fingerprint ?? null,
        transcriptCues: transcript?.cues ?? [],
      })
      if (!isCurrent()) return stale()

      const transcriptIdentity = transcript ? {
        platform: transcript.platform ?? context.platform,
        videoId: transcript.videoId,
        contentKey: transcript.contentKey ?? context.contentKey,
        ...(transcript.partId ?? context.partId
          ? { partId: transcript.partId ?? context.partId! }
          : {}),
      } : null

      return ready({
        sourceIdentity: {
          platform: context.platform,
          videoId: context.videoId,
          contentKey: context.contentKey,
          ...(context.partId ? { partId: context.partId } : {}),
        },
        transcript: toTranscriptSnapshot({
          record: transcript,
          identity: transcriptIdentity,
          title,
          fingerprint,
        }),
        analysis: analysis
          ? toAnalysisSnapshot({
              analysis,
              platform: context.platform,
              videoId: context.videoId,
              partId: context.partId,
              contentKey: context.contentKey,
              title,
              analysisRunId: analysis.id ?? null,
            })
          : null,
      })
    },

    async loadSavedRunRestore({ analysisRunId, isCurrent }) {
      const aggregate = await dependencies.getSavedAnalysisRunById(analysisRunId)
      if (!aggregate) throw new Error("Saved analysis run was not found in local history.")

      const { analysisRun, segments, transcript, videoRecord } = aggregate
      const contentKey = videoRecord?.contentKey ?? analysisRun.contentKey
      if (!contentKey) throw new Error("Saved analysis run has no persisted content identity.")
      const platform = videoRecord?.platform ?? analysisRun.platform ?? "youtube"
      const videoId = videoRecord?.videoId ?? analysisRun.videoId
      const partId = videoRecord?.partId ?? analysisRun.partId ?? null
      const title = videoRecord?.title ?? videoId
      if (!isCurrent()) return stale()

      const fingerprint = await resolveAskTranscriptFingerprint({
        currentFingerprint: transcript?.fingerprint ?? analysisRun.transcriptFingerprint ?? null,
        transcriptCues: transcript?.cues ?? [],
      })
      if (!isCurrent()) return stale()

      const transcriptIdentity = transcript ? {
        platform,
        videoId: transcript.videoId,
        contentKey: transcript.contentKey ?? contentKey,
        ...(transcript.partId ?? partId
          ? { partId: transcript.partId ?? partId }
          : {}),
      } : null

      const historicalAnalysis: HistoricalAnalysisRecord = {
        ...analysisRun,
        segments,
      }
      return ready({
        sourceIdentity: {
          platform,
          videoId,
          contentKey,
          ...(partId ? { partId } : {}),
        },
        transcript: toTranscriptSnapshot({
          record: transcript,
          identity: transcriptIdentity,
          title,
          fingerprint,
        }),
        analysis: toAnalysisSnapshot({
          analysis: historicalAnalysis,
          platform,
          videoId,
          partId,
          contentKey,
          title,
          analysisRunId: analysisRun.id,
        }),
      })
    },
  }
}
