import type {
  VideoAnalysis,
} from "@/features/analysis/lib/analysis-schema"
import {
  resolveAnalysisPresetStrategy,
  type AnalysisPresetStrategy,
} from "@/features/analysis/lib/analysis-preset"
import {
  VIDEO_ANALYSIS_SCHEMA_VERSION,
} from "@/features/analysis/lib/analysis-schema"
import type { AnalysisTaskPhase, AnalysisTaskSnapshot } from "@/features/analysis/lib/analysis-task-controller"
import {
  captureAnalysisCompletionTimes,
  type AnalysisTaskExecutionPolicy,
} from "@/features/analysis/lib/analysis-task-lifecycle"
import { DEFAULT_ANALYSIS_BUDGET_POLICY } from "@/features/analysis/lib/analysis-budget"
import {
  FINAL_CHECKPOINT_PLANNING_VERSION,
  type FinalCheckpointCandidateAttempt,
  type FinalCheckpointContext,
  type FinalResumeCheckpointController,
} from "@/features/analysis/lib/final-resume-checkpoint"
import type { RunAnalysisOptions, RunAnalysisResult, AnalysisProgressEvent } from "@/features/analysis/lib/run-analysis"
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
  onProgress?: (event: AnalysisProgressEvent) => void
  ensureTaskCurrent: () => void
  /** Per-Side-Panel in-memory checkpoint; absence preserves the pre-M2 execution path. */
  finalCheckpoint?: {
    controller: FinalResumeCheckpointController
    workspaceEpoch: number
  }
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
  credentialRevision: string
  /** Non-secret storage revision used to close the metadata-update race. */
  profileUpdatedAt: string
  /** Execution metadata is compared directly because timestamps may share a millisecond. */
  profileBaseUrl: string
  profileModel: string
  profileGenerationTimeoutSec: number
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
  /**
   * The single completion persistence used by a one-shot success and by a
   * Final-only resume. Both paths must produce identical rows in the same order.
   */
  persistCompletedAnalysis: (input: CompletedAnalysisPersistenceInput) => Promise<CompletedAnalysisPersistenceResult>
}

export type CompletedAnalysisPersistenceInput = {
  taskSnapshot: AnalysisTaskSnapshot
  sourceVideo: VideoInfo
  transcript: VideoTranscript
  transcriptFingerprint: string
  analysis: VideoAnalysis
  /** Exact analysis cache identity for this completion. */
  cacheKey: string
  analysisPromptVersion: string
  transcriptCapturedAt: string
  taskStartedAt: string
  completedAt: string
  analysisRunId: string
  transcriptSnapshotId: string
}

export type CompletedAnalysisPersistenceResult = {
  analysisRunId: string
}

export function createAnalysisController(
  dependencies: AnalysisControllerDependencies,
): AnalysisController {
  const now = dependencies.now ?? (() => new Date().toISOString())
  const randomUUID = dependencies.randomUUID ?? (() => crypto.randomUUID())

  const persistCompletedAnalysis = async (
    input: CompletedAnalysisPersistenceInput,
  ): Promise<CompletedAnalysisPersistenceResult> => {
    const {
      taskSnapshot,
      sourceVideo,
      transcript,
      transcriptFingerprint,
      analysis,
      cacheKey,
      analysisPromptVersion,
      transcriptCapturedAt,
      taskStartedAt,
      completedAt,
      analysisRunId,
      transcriptSnapshotId,
    } = input

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
          analysisPromptVersion,
          analysisCacheKey: cacheKey,
          providerProfileId: taskSnapshot.providerProfileId,
          providerBaseUrl: taskSnapshot.providerBaseUrl,
          providerModel: taskSnapshot.providerModel,
          status: "completed",
          summary: analysis.summary,
          keyPoints: analysis.keyPoints,
          topics: [],
          errorMessage: null,
          createdAt: taskStartedAt,
          updatedAt: completedAt,
          completedAt,
        },
        segments: analysis.chapters.map((chapter) => ({
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
        analysisPromptVersion,
        providerProfileId: taskSnapshot.providerProfileId,
        providerBaseUrl: taskSnapshot.providerBaseUrl,
        providerModel: taskSnapshot.providerModel,
        analysisRunId,
        analysis,
        createdAt: taskStartedAt,
        updatedAt: completedAt,
      })
    })

    return { analysisRunId }
  }

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

    /**
     * The preset strategy and effective prompt version come from the task
     * snapshot captured at task start, never from the current global setting, so
     * a mid-flight preference change cannot alter this task's prompt or cache
     * identity.
     */
    const preset: AnalysisPresetStrategy = resolveAnalysisPresetStrategy(taskSnapshot.analysisPresetId)
    const analysisPromptVersion = taskSnapshot.analysisPromptVersion
    const providerMatchesFrozenExecution = (provider: AnalysisProviderSecret): boolean =>
      provider.profileBaseUrl === taskSnapshot.providerBaseUrl
      && provider.profileModel === taskSnapshot.providerModel
      && provider.profileGenerationTimeoutSec === taskSnapshot.generationTimeoutSec

    const resolvedProvider = await dependencies.resolveProvider(taskSnapshot.providerProfileId)
    ensureTaskCurrent()
    if (!providerMatchesFrozenExecution(resolvedProvider)) {
      request.finalCheckpoint?.controller.invalidate("provider-changed")
      throw new Error("Provider configuration changed before analysis startup")
    }

    const cacheKey = await computeAnalysisCacheKey({
      contentKey: taskSnapshot.contentKey,
      transcriptFingerprint,
      providerProfileId: taskSnapshot.providerProfileId,
      baseUrl: taskSnapshot.providerBaseUrl,
      model: taskSnapshot.providerModel,
      promptVersion: analysisPromptVersion,
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
        analysisPromptVersion,
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

    const checkpointRequest = request.finalCheckpoint
    let finalCheckpointHooks: RunAnalysisOptions["finalCheckpoint"]
    if (checkpointRequest) {
      const { controller, workspaceEpoch } = checkpointRequest
      let candidateAttempt: FinalCheckpointCandidateAttempt | null = null
      const providerIsCurrent = async (): Promise<boolean> => {
        ensureTaskCurrent()
        const current = await dependencies.resolveProvider(taskSnapshot.providerProfileId)
        ensureTaskCurrent()
        return providerMatchesFrozenExecution(current)
          && current.apiKey === resolvedProvider.apiKey
          && current.credentialRevision === resolvedProvider.credentialRevision
          && current.profileUpdatedAt === resolvedProvider.profileUpdatedAt
          && current.profileBaseUrl === resolvedProvider.profileBaseUrl
          && current.profileModel === resolvedProvider.profileModel
          && current.profileGenerationTimeoutSec === resolvedProvider.profileGenerationTimeoutSec
      }
      const checkpointContext = (): FinalCheckpointContext => ({
        source: {
          taskId: taskSnapshot.taskId,
          workspaceEpoch,
          sourceTabId: taskSnapshot.sourceTabId,
          platform: taskSnapshot.platform,
          videoId: taskSnapshot.videoId,
          partId: taskSnapshot.partId,
          contentKey: taskSnapshot.contentKey,
          title: sourceVideo.title,
          durationSec: sourceVideo.durationSec ?? null,
        },
        transcript: { fingerprint: transcriptFingerprint, cues: transcript.segments },
        provider: {
          profileId: taskSnapshot.providerProfileId,
          baseUrl: taskSnapshot.providerBaseUrl,
          model: taskSnapshot.providerModel,
          timeoutMs: taskSnapshot.generationTimeoutSec * 1000,
          credentialRevision: resolvedProvider.credentialRevision,
        },
        preset,
        schemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
        planningVersion: FINAL_CHECKPOINT_PLANNING_VERSION,
        budgetPolicy: { ...DEFAULT_ANALYSIS_BUDGET_POLICY },
      })
      finalCheckpointHooks = {
        prepareFinalCandidate: async (candidate) => {
          candidateAttempt = null
          if (!await providerIsCurrent()) {
            controller.invalidate("provider-changed")
            return false
          }
          candidateAttempt = await controller.beginCandidate({
            context: checkpointContext(),
            execution: { videoId: sourceVideo.videoId, ...candidate },
          })
          if (!candidateAttempt) return false
          if (!await providerIsCurrent()) {
            candidateAttempt.discard("provider-changed")
            return false
          }
          return candidateAttempt.validate()
        },
        promoteFinalFailure: async (error) => {
          if (!candidateAttempt) return false
          if (!await providerIsCurrent()) {
            controller.invalidate("provider-changed")
            return false
          }
          const published = await candidateAttempt.promoteFinalFailure(error)
          // A cross-panel key replacement may have raced the asynchronous digest.
          if (!await providerIsCurrent()) {
            controller.invalidate("provider-changed")
            return false
          }
          return published
        },
        discardFinalCandidate: () => {
          candidateAttempt?.discard("final-response")
          candidateAttempt = null
        },
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
      preset,
      signal,
      ...(request.onProgress ? { onProgress: request.onProgress } : {}),
      ...(finalCheckpointHooks ? { finalCheckpoint: finalCheckpointHooks } : {}),
    })
    ensureTaskCurrent()
    setPhase("finalizing")

    const { completedAt, taskStartedAt } = captureAnalysisCompletionTimes(taskSnapshot.startedAt, now)
    const analysisRunId = randomUUID()
    const transcriptSnapshotId = randomUUID()

    await persistCompletedAnalysis({
      taskSnapshot,
      sourceVideo,
      transcript,
      transcriptFingerprint,
      analysis: completed.analysis,
      cacheKey,
      analysisPromptVersion,
      transcriptCapturedAt,
      taskStartedAt,
      completedAt,
      analysisRunId,
      transcriptSnapshotId,
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
        analysisPromptVersion,
        lastAnalyzedAt: completedAt,
      },
    }
  }

  return { runExecutionTask, persistCompletedAnalysis }
}
