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
  /**
   * ISO timestamp of the moment this transcript was actually acquired. It is
   * carried through to the persisted Transcript Snapshot so a resumed write
   * keeps the ordinary-run audit semantics instead of recording the save time.
   */
  capturedAt: string
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
    /** Real transcript acquisition time, never the save completion time. */
    transcriptCapturedAt: string
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

/** One real re-capture of everything the Final request and the write depend on. */
type FinalResumeCapture = {
  live: FinalResumeLiveSource
  transcript: FinalResumeTranscript
  provider: FinalResumeProvider
  context: FinalCheckpointContext
}

/**
 * Compares the provider execution target that was frozen when the resume was
 * admitted against a freshly re-read one. Endpoint, model, timeout, credential
 * revision and the legacy API key must all be identical: a profile id alone
 * cannot prove the key or endpoint was not replaced while an await was running.
 */
function executionTargetMatches(
  frozen: FinalResumeProvider,
  current: FinalResumeProvider,
): boolean {
  return current.profileBaseUrl === frozen.profileBaseUrl
    && current.profileModel === frozen.profileModel
    && current.profileGenerationTimeoutSec === frozen.profileGenerationTimeoutSec
    && current.credentialRevision === frozen.credentialRevision
    && current.apiKey === frozen.apiKey
}

/**
 * Orchestrates a manual Final-only resume.
 *
 * The order is deliberately fixed: live source / transcript / provider capture,
 * then the single checkpoint lease (it owns identity, integrity and TTL), then
 * the exact analysis cache, then one more real re-capture with
 * `lease.validate(freshContext)` immediately before the model request, and
 * again immediately before persistence. Any mismatch fails closed with zero
 * further model requests, and the cache fast path only runs after the lease
 * proved the checkpoint belongs to this live request.
 */
export function createFinalResumeCoordinator(
  dependencies: FinalResumeCoordinatorDependencies,
): FinalResumeCoordinator {
  const now = dependencies.now ?? (() => new Date().toISOString())
  const randomUUID = dependencies.randomUUID ?? (() => crypto.randomUUID())

  const resume = async (request: FinalResumeRequest): Promise<FinalResumeResult> => {
    const { signal, setPhase } = request
    const metadata = request.checkpointMetadata()
    if (metadata.state !== "available") {
      return { kind: metadata.state === "leased" ? "lease-unavailable" : "unavailable" }
    }
    if (signal.aborted) return { kind: "cancelled" }

    const guard = createExecutionGuard(request.ensureTaskCurrent)
    if (!guard.isCurrent()) return { kind: "execution-superseded" }

    // 1. Current preset, prompt, schema and planning versions.
    const preset: AnalysisPresetStrategy = resolveAnalysisPresetStrategy(
      request.taskSnapshot.analysisPresetId,
    )

    const buildContext = (capture: Omit<FinalResumeCapture, "context">): FinalCheckpointContext => ({
      source: {
        taskId: request.taskSnapshot.taskId,
        workspaceEpoch: request.workspaceEpoch,
        sourceTabId: capture.live.taskSnapshot.sourceTabId,
        platform: capture.live.sourceVideo.platform,
        videoId: capture.live.sourceVideo.videoId,
        partId: capture.live.sourceVideo.partId ?? null,
        contentKey: capture.live.sourceVideo.contentKey,
        title: capture.live.sourceVideo.title,
        durationSec: capture.live.sourceVideo.durationSec ?? null,
      },
      transcript: {
        fingerprint: capture.transcript.fingerprint,
        cues: capture.transcript.transcript.segments,
      },
      provider: {
        profileId: request.taskSnapshot.providerProfileId,
        baseUrl: request.taskSnapshot.providerBaseUrl,
        model: request.taskSnapshot.providerModel,
        timeoutMs: request.taskSnapshot.generationTimeoutSec * 1000,
        credentialRevision: capture.provider.credentialRevision,
      },
      preset,
      schemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
      planningVersion: FINAL_CHECKPOINT_PLANNING_VERSION,
      budgetPolicy: { ...DEFAULT_ANALYSIS_BUDGET_POLICY },
    })

    /**
     * A real, independent re-capture. Never reuses an earlier object: the tab,
     * video identity, transcript and provider are all read again so an await
     * cannot hide a rotation behind a stale snapshot.
     */
    const recapture = async (): Promise<FinalResumeCapture> => {
      const live = await dependencies.readLiveSource()
      requireCurrent(guard, signal)
      const transcript = await dependencies.loadTranscript(live)
      requireCurrent(guard, signal)
      const provider = await dependencies.resolveProvider(request.taskSnapshot.providerProfileId)
      requireCurrent(guard, signal)
      const capture = { live, transcript, provider }
      return { ...capture, context: buildContext(capture) }
    }

    // 2. First live capture.
    let admission: FinalResumeCapture
    try {
      admission = await recapture()
    } catch (error) {
      return abortOrSupersede(error, signal)
    }

    // 3. The live provider must still be the frozen execution target.
    if (admission.provider.profileBaseUrl !== request.taskSnapshot.providerBaseUrl
      || admission.provider.profileModel !== request.taskSnapshot.providerModel
      || admission.provider.profileGenerationTimeoutSec !== request.taskSnapshot.generationTimeoutSec) {
      return { kind: "identity-mismatch" }
    }

    // 4. The single lease, acquired BEFORE any cache lookup. Acquisition alone
    //    proves live identity, integrity, TTL, ownership and admission, so a
    //    cached publication can never be borrowed from another checkpoint.
    const acquisition = await request.checkpoint.acquireForResume({
      context: admission.context,
      isCurrentExecution: guard.isCurrent,
    })
    if (acquisition.kind !== "acquired") return { kind: acquisition.kind }
    const { lease } = acquisition

    const frozenProvider = admission.provider
    let terminal = false

    const destroyAnd = (result: FinalResumeResult): FinalResumeResult => {
      terminal = true
      lease.destroy()
      return result
    }

    /**
     * Settles a post-acquisition capture failure. Cancellation and
     * supersession are ordinary results; anything unexpected still destroys
     * the lease before it propagates so the checkpoint can never fall back to
     * a clickable "available" state through the `finally` release.
     */
    const settleCaptureFailure = (error: unknown): FinalResumeResult => {
      if (signal.aborted || error instanceof AnalysisAbortedError) {
        return destroyAnd({ kind: "cancelled" })
      }
      if (error instanceof ExecutionSupersededError) {
        return destroyAnd({ kind: "execution-superseded" })
      }
      terminal = true
      lease.destroy()
      throw error
    }

    const validateLease = async (context: FinalCheckpointContext): Promise<boolean> => {
      try {
        return await lease.validate(context)
      } catch {
        return false
      }
    }

    const cacheHit = (cached: AnalysisCacheEntity): FinalResumeResult => ({
      kind: "cached",
      publication: {
        platform: admission.live.sourceVideo.platform,
        videoId: admission.live.sourceVideo.videoId,
        partId: admission.live.sourceVideo.partId ?? null,
        contentKey: admission.live.sourceVideo.contentKey,
        title: admission.live.sourceVideo.title,
        analysis: cached.analysis!,
        // A cache row may predate Analysis Run ids; null stays nullable.
        analysisRunId: cached.analysisRunId,
        transcriptFingerprint: admission.transcript.fingerprint,
        providerProfileId: cached.providerProfileId ?? null,
        providerBaseUrl: cached.providerBaseUrl ?? null,
        providerModel: cached.providerModel ?? null,
        analysisSchemaVersion: cached.analysisSchemaVersion ?? null,
        analysisPromptVersion: cached.analysisPromptVersion ?? null,
        lastAnalyzedAt: cached.updatedAt,
      },
    })

    try {
      // 5. Exact Analysis Cache, only now that the checkpoint proved itself.
      let cached: AnalysisCacheEntity | null
      try {
        const cacheKey = await computeAnalysisCacheKey({
          contentKey: admission.live.sourceVideo.contentKey,
          transcriptFingerprint: admission.transcript.fingerprint,
          providerProfileId: request.taskSnapshot.providerProfileId,
          baseUrl: request.taskSnapshot.providerBaseUrl,
          model: request.taskSnapshot.providerModel,
          promptVersion: request.taskSnapshot.analysisPromptVersion,
        })
        requireCurrent(guard, signal)
        cached = await dependencies.getAnalysisCache(cacheKey)
        requireCurrent(guard, signal)
      } catch (error) {
        return settleCaptureFailure(error)
      }

      if (cached?.analysis && isExactCurrentAnalysis({
        contentKey: cached.contentKey,
        transcriptFingerprint: cached.transcriptFingerprint,
        providerProfileId: cached.providerProfileId,
        baseUrl: cached.providerBaseUrl,
        model: cached.providerModel,
        analysisSchemaVersion: cached.analysisSchemaVersion,
        analysisPromptVersion: cached.analysisPromptVersion,
      }, {
        contentKey: admission.live.sourceVideo.contentKey,
        transcriptFingerprint: admission.transcript.fingerprint,
        providerProfileId: request.taskSnapshot.providerProfileId,
        baseUrl: request.taskSnapshot.providerBaseUrl,
        model: request.taskSnapshot.providerModel,
        analysisSchemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
        analysisPromptVersion: request.taskSnapshot.analysisPromptVersion,
      })) {
        // A satisfied cache hit ends the resume opportunity. Destroying the
        // lease (not releasing it) is what removes the checkpoint, so it can
        // never stay clickable after a request was fulfilled without a model.
        return destroyAnd(cacheHit(cached))
      }

      // 6. Real re-capture immediately before the Final request.
      let preFinal: FinalResumeCapture
      try {
        preFinal = await recapture()
      } catch (error) {
        return settleCaptureFailure(error)
      }
      if (!executionTargetMatches(frozenProvider, preFinal.provider)) {
        return destroyAnd({ kind: "identity-mismatch" })
      }
      // Compares the freshly captured context, never the admission-time object.
      if (!await validateLease(preFinal.context)) {
        return destroyAnd({ kind: "identity-mismatch" })
      }

      setPhase("analyzing")
      let responseReceived = false
      let execution: { analysis: VideoAnalysis }
      try {
        execution = await dependencies.runFinalOnlyAnalysis({
          provider: {
            baseUrl: request.taskSnapshot.providerBaseUrl,
            apiKey: preFinal.provider.apiKey,
            model: request.taskSnapshot.providerModel,
            generationTimeoutSec: request.taskSnapshot.generationTimeoutSec,
          },
          transcript: {
            videoId: preFinal.live.sourceVideo.videoId,
            title: preFinal.live.sourceVideo.title,
            cues: preFinal.transcript.transcript.segments,
            durationSec: preFinal.live.sourceVideo.durationSec ?? null,
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
        // B. User cancellation: no persistence, no stale UI write.
        if (signal.aborted || error instanceof AnalysisAbortedError) {
          return destroyAnd({ kind: "cancelled" })
        }
        // C. A returned response whose structure failed is not a network fault.
        if (responseReceived) {
          return destroyAnd({ kind: "structured-output-failed", error })
        }
        // D. Identity, auth, rate-limit or other ineligible failures end resume.
        if (!isFinalFailureEligibleForCheckpoint(error)) {
          return destroyAnd({ kind: "fatal-failure", error })
        }
        // A. Another qualified transient failure keeps the original TTL and
        // still requires an explicit new click.
        terminal = true
        lease.release()
        return { kind: "final-retryable", error }
      }

      // 7. Last guards immediately before the write.
      if (!guard.isCurrent()) return destroyAnd({ kind: "execution-superseded" })
      if (signal.aborted) return destroyAnd({ kind: "cancelled" })

      // 8. Real re-capture again immediately before persistence, with the same
      //    provider target comparison and a fresh-context lease validation.
      let prePersist: FinalResumeCapture
      try {
        prePersist = await recapture()
      } catch (error) {
        return settleCaptureFailure(error)
      }
      if (!executionTargetMatches(frozenProvider, prePersist.provider)) {
        return destroyAnd({ kind: "identity-mismatch" })
      }
      if (!await validateLease(prePersist.context)) {
        return destroyAnd({ kind: "identity-mismatch" })
      }

      setPhase("finalizing")
      const completedAt = now()
      const analysisRunId = randomUUID()
      const transcriptSnapshotId = randomUUID()
      let persisted: FinalResumePersistence
      try {
        persisted = await dependencies.persistCompletedAnalysis({
          taskSnapshot: request.taskSnapshot,
          sourceVideo: prePersist.live.sourceVideo,
          transcript: prePersist.transcript.transcript,
          transcriptFingerprint: prePersist.transcript.fingerprint,
          // The acquisition time of the transcript this resume actually used,
          // not the save time, so the audit trail matches an ordinary run.
          transcriptCapturedAt: prePersist.transcript.capturedAt,
          analysis: execution.analysis,
          completedAt,
          taskStartedAt: request.taskSnapshot.startedAt,
          analysisRunId,
          transcriptSnapshotId,
        })
      } catch (error) {
        // E. A save failure is never reported as a provider fault and never
        // re-calls the model.
        return destroyAnd({ kind: "persistence-failed", error })
      }

      terminal = true
      lease.destroy()
      return {
        kind: "completed",
        publication: {
          platform: prePersist.live.sourceVideo.platform,
          videoId: prePersist.live.sourceVideo.videoId,
          partId: prePersist.live.sourceVideo.partId ?? null,
          contentKey: prePersist.live.sourceVideo.contentKey,
          title: prePersist.live.sourceVideo.title,
          analysis: execution.analysis,
          analysisRunId: persisted.analysisRunId,
          transcriptFingerprint: prePersist.transcript.fingerprint,
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
