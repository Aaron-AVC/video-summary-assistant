import { DEFAULT_ANALYSIS_BUDGET_POLICY } from "@/features/analysis/lib/analysis-budget"
import type { VideoAnalysis } from "@/features/analysis/lib/analysis-schema"
import { VIDEO_ANALYSIS_SCHEMA_VERSION } from "@/features/analysis/lib/analysis-schema"
import {
  resolveAnalysisPresetStrategy,
  type AnalysisPresetStrategy,
} from "@/features/analysis/lib/analysis-preset"
import type { AnalysisTaskPhase, AnalysisTaskSnapshot } from "@/features/analysis/lib/analysis-task-controller"
import {
  FINAL_CHECKPOINT_PLANNING_VERSION,
  isFinalFailureEligibleForCheckpoint,
  type FinalCheckpointContext,
  type FinalCheckpointMetadata,
  type FinalResumeCheckpointController,
} from "@/features/analysis/lib/final-resume-checkpoint"
import {
  AnalysisAbortedError,
  type AnalysisProgressEvent,
} from "@/features/analysis/lib/structured-analysis"
import type { RunFinalOnlyAnalysisOptions } from "@/features/analysis/lib/run-final-only-analysis"
import type { AnalysisExecutionPublication } from "@/sidepanel/analysis/analysis-controller"
import type { VideoInfo, VideoTranscript } from "@/features/platform/types"
import { computeAnalysisCacheKey, isExactCurrentAnalysis } from "@/lib/persistence/cache-identity"
import type { AnalysisCacheEntity } from "@/lib/schemas/persistence"

export type FinalResumeLiveSource = {
  taskSnapshot: AnalysisTaskSnapshot
  sourceVideo: VideoInfo
  workspaceEpoch: number
}

export type FinalResumeTranscript = {
  transcript: VideoTranscript
  fingerprint: string
}

export type FinalResumeProvider = {
  apiKey: string
  credentialRevision: string
  profileUpdatedAt: string
  profileBaseUrl: string
  profileModel: string
  profileGenerationTimeoutSec: number
}

export type FinalResumePersistence = {
  analysisRunId: string
}

export type FinalResumeRequest = {
  /** Snapshot of the *new* resume task; its taskId is not the checkpoint source. */
  taskSnapshot: AnalysisTaskSnapshot
  workspaceEpoch: number
  signal: AbortSignal
  setPhase: (phase: AnalysisTaskPhase) => void
  onProgress?: (event: AnalysisProgressEvent) => void
  ensureTaskCurrent: () => void
  checkpoint: FinalResumeCheckpointController
  /** Read synchronously so the caller can decide before starting a task. */
  checkpointMetadata: () => FinalCheckpointMetadata
}

export type FinalResumeResult =
  | { kind: "completed"; publication: AnalysisExecutionPublication }
  | { kind: "cached"; publication: AnalysisExecutionPublication }
  | { kind: "final-retryable"; error: unknown }
  | { kind: "cancelled" }
  | { kind: "persistence-failed"; error: unknown }
  | { kind: "structured-output-failed"; error: unknown }
  | { kind: "fatal-failure"; error: unknown }
  | {
      kind:
        | "unavailable"
        | "lease-unavailable"
        | "expired"
        | "identity-mismatch"
        | "integrity-failed"
        | "invalidated"
        | "destroyed"
        | "execution-superseded"
    }

export type FinalResumeCoordinatorDependencies = {
  /** Re-reads the live tab, video identity and the running task snapshot. */
  readLiveSource: () => Promise<FinalResumeLiveSource>
  /** Re-acquires and re-fingerprints the live transcript for this source. */
  loadTranscript: (source: FinalResumeLiveSource) => Promise<FinalResumeTranscript>
  resolveProvider: (providerId: string) => Promise<FinalResumeProvider>
  getAnalysisCache: (cacheKey: string) => Promise<AnalysisCacheEntity | null>
  /** Final-only model execution; it must never re-run Map or Reduction. */
  runFinalOnlyAnalysis: (options: RunFinalOnlyAnalysisOptions) => Promise<{
    analysis: VideoAnalysis
    repairAttempted: boolean
    rawResponse: string
  }>
  /**
   * The completion persistence a normal run also uses. It owns Video Record,
   * Transcript Snapshot, Analysis Run, Segments, Recent Analysis and Analysis
   * Cache writes, so a resumed result and a one-shot success cannot diverge.
   */
  persistCompletedAnalysis: (input: {
    taskSnapshot: AnalysisTaskSnapshot
    sourceVideo: VideoInfo
    transcript: VideoTranscript
    transcriptFingerprint: string
    analysis: VideoAnalysis
    completedAt: string
    taskStartedAt: string
    analysisRunId: string
    transcriptSnapshotId: string
  }) => Promise<FinalResumePersistence>
  now?: () => string
  randomUUID?: () => string
}

export type FinalResumeCoordinator = {
  resume: (request: FinalResumeRequest) => Promise<FinalResumeResult>
}

/**
 * Orchestrates a manual Final-only resume.
 *
 * The order is deliberately fixed: current execution admission, live source
 * identity, re-loaded transcript, provider configuration, checkpoint identity,
 * exact analysis cache, the single checkpoint lease, then one more live guard
 * immediately before the model request and again before persistence. Any
 * mismatch fails closed with zero model requests.
 */
export function createFinalResumeCoordinator(
  dependencies: FinalResumeCoordinatorDependencies,
): FinalResumeCoordinator {
  const now = dependencies.now ?? (() => new Date().toISOString())
  const randomUUID = dependencies.randomUUID ?? (() => crypto.randomUUID())

  const resume = async (request: FinalResumeRequest): Promise<FinalResumeResult> => {
    const { signal, setPhase, ensureTaskCurrent } = request
    const metadata = request.checkpointMetadata()
    if (metadata.state !== "available") {
      return { kind: metadata.state === "leased" ? "lease-unavailable" : "unavailable" }
    }
    if (signal.aborted) return { kind: "cancelled" }

    const guard = createExecutionGuard(ensureTaskCurrent)
    if (!guard.isCurrent()) return { kind: "execution-superseded" }

    let live: FinalResumeLiveSource
    let transcript: FinalResumeTranscript
    let provider: FinalResumeProvider
    try {
      // 3/4/5. Live tab, video identity, Bilibili part, title and duration.
      live = await dependencies.readLiveSource()
      requireCurrent(guard, signal)
      transcript = await dependencies.loadTranscript(live)
      requireCurrent(guard, signal)
      // 6. Current provider execution configuration, key and credential revision.
      provider = await dependencies.resolveProvider(request.taskSnapshot.providerProfileId)
      requireCurrent(guard, signal)
    } catch (error) {
      return abortOrSupersede(error, signal)
    }

    // The live provider must still be the frozen execution target. Endpoint,
    // model, timeout and credential revision are compared directly because a
    // profile id alone cannot prove the key or endpoint was not replaced.
    if (provider.profileBaseUrl !== request.taskSnapshot.providerBaseUrl
      || provider.profileModel !== request.taskSnapshot.providerModel
      || provider.profileGenerationTimeoutSec !== request.taskSnapshot.generationTimeoutSec) {
      return { kind: "identity-mismatch" }
    }

    // 7. Current preset, prompt, schema and planning versions.
    const preset: AnalysisPresetStrategy = resolveAnalysisPresetStrategy(
      request.taskSnapshot.analysisPresetId,
    )
    const context: FinalCheckpointContext = {
      source: {
        taskId: request.taskSnapshot.taskId,
        workspaceEpoch: request.workspaceEpoch,
        sourceTabId: live.taskSnapshot.sourceTabId,
        platform: live.sourceVideo.platform,
        videoId: live.sourceVideo.videoId,
        partId: live.sourceVideo.partId ?? null,
        contentKey: live.sourceVideo.contentKey,
        title: live.sourceVideo.title,
        durationSec: live.sourceVideo.durationSec ?? null,
      },
      transcript: {
        fingerprint: transcript.fingerprint,
        cues: transcript.transcript.segments,
      },
      provider: {
        profileId: request.taskSnapshot.providerProfileId,
        baseUrl: request.taskSnapshot.providerBaseUrl,
        model: request.taskSnapshot.providerModel,
        timeoutMs: request.taskSnapshot.generationTimeoutSec * 1000,
        credentialRevision: provider.credentialRevision,
      },
      preset,
      schemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
      planningVersion: FINAL_CHECKPOINT_PLANNING_VERSION,
      budgetPolicy: { ...DEFAULT_ANALYSIS_BUDGET_POLICY },
    }

    // 9/10. An exact completed analysis satisfies the request with zero requests.
    const cacheKey = await computeAnalysisCacheKey({
      contentKey: live.sourceVideo.contentKey,
      transcriptFingerprint: transcript.fingerprint,
      providerProfileId: request.taskSnapshot.providerProfileId,
      baseUrl: request.taskSnapshot.providerBaseUrl,
      model: request.taskSnapshot.providerModel,
      promptVersion: request.taskSnapshot.analysisPromptVersion,
    })
    if (!guard.isCurrent()) return { kind: "execution-superseded" }
    if (signal.aborted) return { kind: "cancelled" }

    const cached = await dependencies.getAnalysisCache(cacheKey)
    if (!guard.isCurrent()) return { kind: "execution-superseded" }
    if (signal.aborted) return { kind: "cancelled" }

    if (cached?.analysis && isExactCurrentAnalysis({
      contentKey: cached.contentKey,
      transcriptFingerprint: cached.transcriptFingerprint,
      providerProfileId: cached.providerProfileId,
      baseUrl: cached.providerBaseUrl,
      model: cached.providerModel,
      analysisSchemaVersion: cached.analysisSchemaVersion,
      analysisPromptVersion: cached.analysisPromptVersion,
    }, {
      contentKey: live.sourceVideo.contentKey,
      transcriptFingerprint: transcript.fingerprint,
      providerProfileId: request.taskSnapshot.providerProfileId,
      baseUrl: request.taskSnapshot.providerBaseUrl,
      model: request.taskSnapshot.providerModel,
      analysisSchemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
      analysisPromptVersion: request.taskSnapshot.analysisPromptVersion,
    })) {
      // A satisfied cache hit ends the resume opportunity: the checkpoint must
      // not stay clickable after the request was fulfilled without a model.
      request.checkpoint.invalidate("cache-satisfied")
      return {
        kind: "cached",
        publication: {
          platform: live.sourceVideo.platform,
          videoId: live.sourceVideo.videoId,
          partId: live.sourceVideo.partId ?? null,
          contentKey: live.sourceVideo.contentKey,
          title: live.sourceVideo.title,
          analysis: cached.analysis,
          analysisRunId: cached.analysisRunId,
          transcriptFingerprint: transcript.fingerprint,
          providerProfileId: cached.providerProfileId ?? null,
          providerBaseUrl: cached.providerBaseUrl ?? null,
          providerModel: cached.providerModel ?? null,
          analysisSchemaVersion: cached.analysisSchemaVersion ?? null,
          analysisPromptVersion: cached.analysisPromptVersion ?? null,
          lastAnalyzedAt: cached.updatedAt,
        },
      }
    }

    // 11. The single lease. The checkpoint re-verifies integrity and identity.
    const acquisition = await request.checkpoint.acquireForResume({
      context,
      isCurrentExecution: guard.isCurrent,
    })
    if (acquisition.kind !== "acquired") return { kind: acquisition.kind }
    const { lease } = acquisition

    let responseReceived = false
    let terminal = false
    try {
      setPhase("analyzing")
      let execution: { analysis: VideoAnalysis }
      try {
        execution = await dependencies.runFinalOnlyAnalysis({
          provider: {
            baseUrl: request.taskSnapshot.providerBaseUrl,
            apiKey: provider.apiKey,
            model: request.taskSnapshot.providerModel,
            generationTimeoutSec: request.taskSnapshot.generationTimeoutSec,
          },
          transcript: {
            videoId: live.sourceVideo.videoId,
            title: live.sourceVideo.title,
            cues: transcript.transcript.segments,
            durationSec: live.sourceVideo.durationSec ?? null,
          },
          preset,
          budgetPolicy: { ...DEFAULT_ANALYSIS_BUDGET_POLICY },
          signal,
          ...(request.onProgress ? { onProgress: request.onProgress } : {}),
          execution: {
            strategy: "map-reduce",
            initialChunkCount: lease.payload.initialChunkCount,
            reductionLevels: lease.payload.reductionLevels,
            chunkSummaries: lease.payload.chunkSummaries,
            finalPrompt: lease.payload.finalPrompt,
          },
          onFinalResponseReceived: () => {
            responseReceived = true
          },
        })
      } catch (error) {
        terminal = true
        // B. User cancellation: no persistence, no stale UI write.
        if (signal.aborted || error instanceof AnalysisAbortedError) {
          lease.destroy()
          return { kind: "cancelled" }
        }
        // C. A returned response whose structure failed is not a network fault.
        if (responseReceived) {
          lease.destroy()
          return { kind: "structured-output-failed", error }
        }
        // D. Identity, auth, rate-limit or other ineligible failures end resume.
        if (!isFinalFailureEligibleForCheckpoint(error)) {
          lease.destroy()
          return { kind: "fatal-failure", error }
        }
        // A. Another qualified transient failure keeps the original TTL and
        // still requires an explicit new click.
        lease.release()
        return { kind: "final-retryable", error }
      }

      // 12. Last guards immediately before the write and publication.
      if (!guard.isCurrent()) {
        terminal = true
        lease.destroy()
        return { kind: "execution-superseded" }
      }
      if (signal.aborted) {
        terminal = true
        lease.destroy()
        return { kind: "cancelled" }
      }
      if (!await lease.validate(context)) {
        terminal = true
        return { kind: "identity-mismatch" }
      }

      setPhase("finalizing")
      const completedAt = now()
      const analysisRunId = randomUUID()
      const transcriptSnapshotId = randomUUID()
      let persisted: FinalResumePersistence
      try {
        persisted = await dependencies.persistCompletedAnalysis({
          taskSnapshot: request.taskSnapshot,
          sourceVideo: live.sourceVideo,
          transcript: transcript.transcript,
          transcriptFingerprint: transcript.fingerprint,
          analysis: execution.analysis,
          completedAt,
          taskStartedAt: request.taskSnapshot.startedAt,
          analysisRunId,
          transcriptSnapshotId,
        })
      } catch (error) {
        // E. A save failure is never reported as a provider fault and never
        // re-calls the model.
        terminal = true
        lease.destroy()
        return { kind: "persistence-failed", error }
      }

      terminal = true
      lease.destroy()
      return {
        kind: "completed",
        publication: {
          platform: live.sourceVideo.platform,
          videoId: live.sourceVideo.videoId,
          partId: live.sourceVideo.partId ?? null,
          contentKey: live.sourceVideo.contentKey,
          title: live.sourceVideo.title,
          analysis: execution.analysis,
          analysisRunId: persisted.analysisRunId,
          transcriptFingerprint: transcript.fingerprint,
          providerProfileId: request.taskSnapshot.providerProfileId,
          providerBaseUrl: request.taskSnapshot.providerBaseUrl,
          providerModel: request.taskSnapshot.providerModel,
          analysisSchemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
          analysisPromptVersion: request.taskSnapshot.analysisPromptVersion,
          lastAnalyzedAt: completedAt,
        },
      }
    } finally {
      // Every branch above already settled the lease; this only covers an
      // unexpected throw so a stale lease cannot block the next manual resume.
      if (!terminal) lease.release()
    }
  }

  return { resume }
}

type ExecutionGuard = {
  isCurrent: () => boolean
}

function createExecutionGuard(ensureTaskCurrent: () => void): ExecutionGuard {
  return {
    isCurrent: () => {
      try {
        ensureTaskCurrent()
        return true
      } catch {
        return false
      }
    },
  }
}

function requireCurrent(guard: ExecutionGuard, signal: AbortSignal) {
  if (signal.aborted) throw new AnalysisAbortedError()
  if (!guard.isCurrent()) throw new ExecutionSupersededError()
}

export class ExecutionSupersededError extends Error {
  constructor() {
    super("The resume execution is no longer admitted.")
    this.name = "ExecutionSupersededError"
  }
}

function abortOrSupersede(error: unknown, signal: AbortSignal): FinalResumeResult {
  if (signal.aborted || error instanceof AnalysisAbortedError) return { kind: "cancelled" }
  if (error instanceof ExecutionSupersededError) return { kind: "execution-superseded" }
  throw error
}
