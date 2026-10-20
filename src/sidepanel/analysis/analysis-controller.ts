import type {
  VideoAnalysis,
} from "@/features/analysis/lib/analysis-schema"
import {
  VIDEO_ANALYSIS_PROMPT_VERSION,
  VIDEO_ANALYSIS_SCHEMA_VERSION,
} from "@/features/analysis/lib/analysis-schema"
import type { AnalysisTaskPhase, AnalysisTaskSnapshot } from "@/features/analysis/lib/analysis-task-controller"
import {
  captureAnalysisCompletionTimes,
  type AnalysisTaskExecutionPolicy,
} from "@/features/analysis/lib/analysis-task-lifecycle"
import type { RunAnalysisOptions, RunAnalysisResult } from "@/features/analysis/lib/run-analysis"
import type { SaveAnalysisRunInput } from "@/features/history/lib/history-repository"
import { persistIfSupportedPlatform } from "@/features/platform/persistence-compat"
import type { VideoInfo, VideoPlatform, VideoTranscript } from "@/features/platform/types"
import type { SaveTaskCacheInput } from "@/sidepanel/transcript/transcript-controller"
import {
  computeAnalysisCacheKey,
  isExactCurrentAnalysis,
} from "@/lib/persistence/cache-identity"
import type {
  AnalysisCacheEntity,
  TranscriptSnapshotEntity,
  VideoRecordEntity,
} from "@/lib/schemas/persistence"

/** Execution request for the post-transcript-finalization analysis workflow. */
export type AnalysisExecutionRequest = {
  taskSnapshot: AnalysisTaskSnapshot
  sourceVideo: VideoInfo
  transcript: VideoTranscript
  transcriptFingerprint: string
  executionPolicy: AnalysisTaskExecutionPolicy
  signal: AbortSignal
  setPhase: (phase: AnalysisTaskPhase) => void
  ensureTaskCurrent: () => void
}

/**
 * Everything root needs to build the AnalysisView and the QA restore identity.
 * Never carries `errorMessage` or any provider secret.
 *
 * `analysisRunId` mirrors the persistence schema: a freshly completed run always
 * carries a generated id, while an exact cache hit preserves the cache row,
 * whose `analysisRunId` is nullable.
 */
export type AnalysisExecutionPublication = {
  platform: VideoPlatform
  videoId: string
  partId: string | null
  contentKey: string
  title: string
  analysis: VideoAnalysis
  analysisRunId: string | null
  transcriptFingerprint: string
  providerProfileId: string | null
  providerBaseUrl: string | null
  providerModel: string | null
  analysisSchemaVersion: number | null
  analysisPromptVersion: string | null
  lastAnalyzedAt: string
}

export type AnalysisExecutionResult =
  | { kind: "cached"; publication: AnalysisExecutionPublication }
  | { kind: "completed"; publication: AnalysisExecutionPublication }

export type AnalysisProviderSecret = {
  apiKey: string
}

export type AnalysisControllerDependencies = {
  resolveProvider: (providerId: string) => Promise<AnalysisProviderSecret>
  saveTaskTranscriptCache: (input: SaveTaskCacheInput) => Promise<void>
  getAnalysisCache: (cacheKey: string) => Promise<AnalysisCacheEntity | null>
  saveVideoRecord: (input: VideoRecordEntity) => Promise<unknown>
  saveTranscriptSnapshot: (input: TranscriptSnapshotEntity) => Promise<unknown>
  saveAnalysisRun: (input: SaveAnalysisRunInput) => Promise<unknown>
  saveAnalysisCache: (input: AnalysisCacheEntity) => Promise<unknown>
  runAnalysis: (options: RunAnalysisOptions) => Promise<RunAnalysisResult>
  now?: () => string
  randomUUID?: () => string
}

export type AnalysisController = {
  runExecutionTask: (request: AnalysisExecutionRequest) => Promise<AnalysisExecutionResult>
}

export function createAnalysisController(
  dependencies: AnalysisControllerDependencies,
): AnalysisController {
  const now = dependencies.now ?? (() => new Date().toISOString())
  const randomUUID = dependencies.randomUUID ?? (() => crypto.randomUUID())

  const runExecutionTask = async (
    request: AnalysisExecutionRequest,
  ): Promise<AnalysisExecutionResult> => {
    const {
      taskSnapshot,
      sourceVideo,
      transcript,
      transcriptFingerprint,
      executionPolicy,
      signal,
      setPhase,
      ensureTaskCurrent,
    } = request

    setPhase("analyzing")

    const resolvedProvider = await dependencies.resolveProvider(taskSnapshot.providerProfileId)
    ensureTaskCurrent()

    const cacheKey = await computeAnalysisCacheKey({
      contentKey: taskSnapshot.contentKey,
      transcriptFingerprint,
      providerProfileId: taskSnapshot.providerProfileId,
      baseUrl: taskSnapshot.providerBaseUrl,
      model: taskSnapshot.providerModel,
    })

    const transcriptCapturedAt = now()
    await dependencies.saveTaskTranscriptCache({
      sourceVideo,
      transcript,
      taskContentKey: taskSnapshot.contentKey,
      fingerprint: transcriptFingerprint,
      now: transcriptCapturedAt,
    })

    if (!executionPolicy.bypassAnalysisCache) {
      const cached = await dependencies.getAnalysisCache(cacheKey)
      if (cached?.analysis && isExactCurrentAnalysis({
        contentKey: cached.contentKey,
        transcriptFingerprint: cached.transcriptFingerprint,
        providerProfileId: cached.providerProfileId,
        baseUrl: cached.providerBaseUrl,
        model: cached.providerModel,
        analysisSchemaVersion: cached.analysisSchemaVersion,
        analysisPromptVersion: cached.analysisPromptVersion,
      }, {
        contentKey: taskSnapshot.contentKey,
        transcriptFingerprint,
        providerProfileId: taskSnapshot.providerProfileId,
        baseUrl: taskSnapshot.providerBaseUrl,
        model: taskSnapshot.providerModel,
        analysisSchemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
        analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
      })) {
        ensureTaskCurrent()
        return {
          kind: "cached",
          publication: {
            platform: sourceVideo.platform,
            videoId: sourceVideo.videoId,
            partId: sourceVideo.partId ?? null,
            contentKey: sourceVideo.contentKey,
            title: sourceVideo.title,
            analysis: cached.analysis,
            analysisRunId: cached.analysisRunId,
            transcriptFingerprint,
            providerProfileId: cached.providerProfileId ?? null,
            providerBaseUrl: cached.providerBaseUrl ?? null,
            providerModel: cached.providerModel ?? null,
            analysisSchemaVersion: cached.analysisSchemaVersion ?? null,
            analysisPromptVersion: cached.analysisPromptVersion ?? null,
            lastAnalyzedAt: cached.updatedAt,
          },
        }
      }
    }

    const completed = await dependencies.runAnalysis({
      provider: {
        baseUrl: taskSnapshot.providerBaseUrl,
        apiKey: resolvedProvider.apiKey,
        model: taskSnapshot.providerModel,
        generationTimeoutSec: taskSnapshot.generationTimeoutSec,
      },
      transcript: {
        videoId: sourceVideo.videoId,
        title: sourceVideo.title,
        cues: transcript.segments,
        durationSec: sourceVideo.durationSec,
      },
      signal,
    })
    ensureTaskCurrent()
    setPhase("finalizing")

    const { completedAt, taskStartedAt } = captureAnalysisCompletionTimes(taskSnapshot.startedAt, now)
    const analysisRunId = randomUUID()
    const transcriptSnapshotId = randomUUID()

    await persistIfSupportedPlatform(sourceVideo, async () => {
      await dependencies.saveVideoRecord({
        contentKey: taskSnapshot.contentKey,
        platform: taskSnapshot.platform,
        videoId: taskSnapshot.videoId,
        partId: taskSnapshot.partId,
        title: sourceVideo.title,
        channelTitle: sourceVideo.author,
        thumbnailUrl: sourceVideo.thumbnailUrl ?? null,
        canonicalUrl: sourceVideo.canonicalUrl || null,
        durationSec: sourceVideo.durationSec ?? null,
        openedAt: taskStartedAt,
        updatedAt: completedAt,
        analyzedAt: completedAt,
      })
      await dependencies.saveTranscriptSnapshot({
        id: transcriptSnapshotId,
        videoId: taskSnapshot.videoId,
        platform: taskSnapshot.platform,
        contentKey: taskSnapshot.contentKey,
        partId: taskSnapshot.partId,
        language: transcript.language ?? null,
        sourceUrl: transcript.raw?.sourceUrl ?? null,
        rawVtt: transcript.raw?.text ?? null,
        cues: transcript.segments,
        createdAt: transcriptCapturedAt,
        updatedAt: transcriptCapturedAt,
      })
      await dependencies.saveAnalysisRun({
        analysisRun: {
          id: analysisRunId,
          videoId: taskSnapshot.videoId,
          platform: taskSnapshot.platform,
          contentKey: taskSnapshot.contentKey,
          partId: taskSnapshot.partId,
          transcriptSnapshotId,
          providerConfigId: taskSnapshot.providerProfileId,
          transcriptFingerprint,
          analysisSchemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
          analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
          analysisCacheKey: cacheKey,
          providerProfileId: taskSnapshot.providerProfileId,
          providerBaseUrl: taskSnapshot.providerBaseUrl,
          providerModel: taskSnapshot.providerModel,
          status: "completed",
          summary: completed.analysis.summary,
          keyPoints: completed.analysis.keyPoints,
          topics: [],
          errorMessage: null,
          createdAt: taskStartedAt,
          updatedAt: completedAt,
          completedAt,
        },
        segments: completed.analysis.chapters.map((chapter) => ({
          id: randomUUID(),
          analysisRunId,
          videoId: taskSnapshot.videoId,
          contentKey: taskSnapshot.contentKey,
          title: chapter.title,
          summary: chapter.summary,
          detail: chapter.detail,
          startSec: chapter.startSec,
          endSec: chapter.endSec,
          createdAt: taskStartedAt,
          updatedAt: completedAt,
        })),
        recentVideo: {
          videoId: taskSnapshot.videoId,
          analysisRunId,
          contentKey: taskSnapshot.contentKey,
          title: sourceVideo.title,
          channelTitle: sourceVideo.author,
          thumbnailUrl: sourceVideo.thumbnailUrl ?? null,
          status: "completed",
          openedAt: taskStartedAt,
          analyzedAt: completedAt,
          updatedAt: completedAt,
        },
      })
      await dependencies.saveAnalysisCache({
        cacheKey,
        contentKey: taskSnapshot.contentKey,
        platform: taskSnapshot.platform,
        videoId: taskSnapshot.videoId,
        partId: taskSnapshot.partId,
        transcriptFingerprint,
        analysisSchemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
        analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
        providerProfileId: taskSnapshot.providerProfileId,
        providerBaseUrl: taskSnapshot.providerBaseUrl,
        providerModel: taskSnapshot.providerModel,
        analysisRunId,
        analysis: completed.analysis,
        createdAt: taskStartedAt,
        updatedAt: completedAt,
      })
    })

    return {
      kind: "completed",
      publication: {
        platform: taskSnapshot.platform,
        videoId: taskSnapshot.videoId,
        partId: taskSnapshot.partId,
        contentKey: taskSnapshot.contentKey,
        title: sourceVideo.title,
        analysis: completed.analysis,
        analysisRunId,
        transcriptFingerprint,
        providerProfileId: taskSnapshot.providerProfileId,
        providerBaseUrl: taskSnapshot.providerBaseUrl,
        providerModel: taskSnapshot.providerModel,
        analysisSchemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
        analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
        lastAnalyzedAt: completedAt,
      },
    }
  }

  return { runExecutionTask }
}
