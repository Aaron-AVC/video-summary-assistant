import type {
  TranscriptSegment,
  VideoIdentity,
} from "@/features/platform/types"
import type {
  HistoryAnalysisSnapshot,
  HistoryRestoreSnapshot,
} from "@/sidepanel/history/history-controller"
import {
  matchesAskRequestWorkspaceIdentity,
} from "@/sidepanel/lib/ask-transcript-identity"
import {
  shouldPublishAnalysisToWorkspace,
} from "@/features/analysis/lib/analysis-task-lifecycle"
import {
  projectWorkspaceRuntimeContent,
  type WorkspaceRuntimeContent,
  type WorkspaceRuntimeContentInput,
  type WorkspaceSnapshot,
} from "@/sidepanel/workspace/workspace-state"

/**
 * The runtime-content transition kinds that the root reset boundary can observe.
 *
 * - `initial`: the first observation after construction. It always resets,
 *   because the React reset effect also runs once on mount.
 * - `same-content`: the runtime `contentKey` is unchanged. Metadata may have
 *   been refreshed, but no reset and no epoch advance is required.
 * - `identity-changed`: the runtime `contentKey` changed. The epoch advances
 *   exactly once and the root must run its reset sequence.
 */
export type WorkspaceRuntimeTransitionKind =
  | "initial"
  | "same-content"
  | "identity-changed"

export type WorkspaceRuntimeTransition = {
  kind: WorkspaceRuntimeTransitionKind
  shouldReset: boolean
  previousContentKey: string | null
  currentContentKey: string | null
  snapshot: WorkspaceSnapshot
}

/**
 * The three History restore modes. They are not interchangeable: the
 * transcript-error policy differs between `current-context` and the other two.
 */
export type WorkspaceHistoryRestoreMode =
  | "legacy-video"
  | "current-context"
  | "saved-run"

export type WorkspaceHistoryTranscriptPublication = {
  cues: TranscriptSegment[]
  identity: VideoIdentity | null
  title: string
  fingerprint: string | null
  rawVtt: string | null
}

/**
 * The publication side effects, supplied by the root. The workspace controller
 * decides *whether*, *when*, and *in which order* they run; the root owns the
 * React setters and feature-controller calls behind them.
 */
export type WorkspaceHistoryPublicationEffects = {
  publishTranscript: (publication: WorkspaceHistoryTranscriptPublication) => void

  clearTranscriptError: () => void

  clearAnalysis: () => void
  setAnalysisIdle: () => void

  publishAnalysis: (analysis: HistoryAnalysisSnapshot) => void

  setAnalysisCompleted: () => void

  clearAskWorkspace: () => void

  restoreQaConversation: (input: {
    contentKey: string
    analysisRunId: string | null
    transcriptFingerprint: string | null
  }) => Promise<void>
}

export type WorkspaceHistoryPublicationRequest = {
  mode: WorkspaceHistoryRestoreMode

  snapshot: HistoryRestoreSnapshot

  /** Captured at restore-request start; never recaptured after the await. */
  workspaceEpoch: number

  /** The caller's existing request generation / currentness predicate. */
  isRequestCurrent: () => boolean

  effects: WorkspaceHistoryPublicationEffects
}

export type WorkspaceHistoryPublicationResult =
  | { kind: "stale" }
  | {
      kind: "published"
      analysisPublished: boolean
    }

/**
 * The Ask identity the completed task was prepared against.
 */
export type WorkspaceAskRequestedIdentity = {
  contentKey: string
  analysisRunId: string
  threadId: string | null
  transcriptFingerprint: string
}

/**
 * The Ask identity the workspace currently displays. Historical display
 * selection is valid, so `contentKey` may legitimately differ from the runtime
 * content key.
 */
export type WorkspaceAskCurrentIdentity = {
  contentKey: string | null
  analysisRunId: string
  threadId: string | null
  transcriptFingerprint: string | null
}

/**
 * The Ask result publication side effects, supplied by the root. The root
 * closures capture the persisted assistant message and the projected answer so
 * that no persistence row or React data type crosses this boundary.
 */
export type WorkspaceAskPublicationEffects = {
  publishAssistantMessage: () => void
  publishAnswer: () => void
}

export type WorkspaceAskPublicationRequest = {
  /** Captured before thread/provider preparation; never recaptured after the await. */
  workspaceEpoch: number

  requested: WorkspaceAskRequestedIdentity

  current: WorkspaceAskCurrentIdentity

  effects: WorkspaceAskPublicationEffects
}

export type WorkspaceAskPublicationResult =
  | { kind: "stale" }
  | { kind: "published" }

/**
 * The Analysis publication target an analysis task was captured against.
 *
 * `currentContentKey` is supplied by the caller instead of being read from
 * `runtimeContent` on purpose: the React `videoContextRef` updates with render
 * before the runtime observation effect necessarily runs, so the live
 * current-content guard must stay able to reject publication during that
 * window.
 */
export type WorkspaceAnalysisPublicationTarget = {
  /** Captured once when the analysis task snapshot is built. */
  workspaceEpoch: number
  taskContentKey: string
  currentContentKey: string | null
}

export type WorkspaceAnalysisTranscriptPublicationEffects = {
  publishTranscript: () => void
}

export type WorkspaceAnalysisResultPublicationEffects = {
  publishAnalysis: () => void
  setAnalysisCompleted: () => void
  restoreQaConversation: () => Promise<void>
}

export type WorkspaceAnalysisCancelledPublicationEffects = {
  clearAnalysisError: () => void
  setAnalysisCancelled: () => void
}

export type WorkspaceAnalysisErrorPublicationEffects = {
  publishAnalysisError: () => void
  setAnalysisErrorPhase: () => void
  markDisplayedAnalysisError: () => void
}

export type WorkspaceAnalysisPublicationResult =
  | { kind: "stale" }
  | { kind: "published" }

/**
 * Owns the runtime-content projection, the workspace epoch, and the
 * cross-feature workspace publication eligibility/sequencing decisions.
 *
 * The workspace epoch advances once for the initial observation and once for
 * every runtime `contentKey` change. It does not advance for same-content
 * metadata refreshes. This controller still does not own React state,
 * repositories, task lifecycle, feature state, or browser APIs; it only decides
 * whether a runtime-content transition is identity-changing and whether a
 * feature result may still be published into the current workspace.
 *
 * Task 6A intentionally has no `subscribe()`: the root does not render from the
 * workspace snapshot yet, so a React mirror would be redundant.
 */
export class WorkspaceController {
  private runtimeContent: WorkspaceRuntimeContent = {
    contentKey: null,
    identity: null,
    title: null,
    author: null,
    canonicalUrl: null,
    isReady: false,
    activeTabId: null,
  }

  private workspaceEpoch = 0

  private hasObserved = false

  getSnapshot(): WorkspaceSnapshot {
    return {
      runtimeContent: { ...this.runtimeContent },
      workspaceEpoch: this.workspaceEpoch,
    }
  }

  /**
   * Observes the authoritative runtime content and classifies the transition.
   *
   * The first observation is always `initial` + `shouldReset`, including when
   * both the previous and the current `contentKey` are `null`, so the mount
   * reset is never suppressed.
   */
  observeRuntimeContent(input: WorkspaceRuntimeContentInput): WorkspaceRuntimeTransition {
    const nextContent = projectWorkspaceRuntimeContent(input)

    if (!this.hasObserved) {
      this.hasObserved = true
      const previousContentKey = this.runtimeContent.contentKey
      this.runtimeContent = nextContent
      this.workspaceEpoch += 1

      return {
        kind: "initial",
        shouldReset: true,
        previousContentKey,
        currentContentKey: nextContent.contentKey,
        snapshot: this.getSnapshot(),
      }
    }

    const previousContentKey = this.runtimeContent.contentKey
    const currentContentKey = nextContent.contentKey
    const isSameContent = previousContentKey === currentContentKey

    // Same-content metadata refreshes must still update the projection, but
    // they must not reset feature state or advance the epoch.
    this.runtimeContent = nextContent

    if (isSameContent) {
      return {
        kind: "same-content",
        shouldReset: false,
        previousContentKey,
        currentContentKey,
        snapshot: this.getSnapshot(),
      }
    }

    this.workspaceEpoch += 1

    return {
      kind: "identity-changed",
      shouldReset: true,
      previousContentKey,
      currentContentKey,
      snapshot: this.getSnapshot(),
    }
  }

  captureEpoch(): number {
    return this.workspaceEpoch
  }

  isEpochCurrent(epoch: number): boolean {
    return epoch === this.workspaceEpoch
  }

  /**
   * Runs the History restore publication/reset sequence for an already-loaded
   * historical snapshot.
   *
   * The stale decision is made exactly once, before any side effect, from the
   * captured workspace epoch plus the caller's existing request-generation
   * predicate. No further currentness check happens once publication starts:
   * runtime/generation invalidation independently resets feature state if the
   * workspace changes while `restoreQaConversation` is awaiting, so this
   * command deliberately has no transactional rollback semantics.
   *
   * Historical publication is display selection, not a new authoritative
   * runtime video: `runtimeContent` is never mutated here, and the historical
   * source identity is allowed to differ from the current runtime content.
   *
   * The transcript-error asymmetry is a contract, not an oversight:
   * `current-context` preserves the existing transcript error, while
   * `legacy-video` and `saved-run` clear it.
   *
   * `saved-run` is guaranteed by HistoryController to carry an analysis, so the
   * no-analysis branch is unreachable for that mode.
   */
  async publishHistoryRestore(
    request: WorkspaceHistoryPublicationRequest,
  ): Promise<WorkspaceHistoryPublicationResult> {
    const { mode, snapshot, workspaceEpoch, isRequestCurrent, effects } = request

    if (!this.isEpochCurrent(workspaceEpoch) || !isRequestCurrent()) {
      return { kind: "stale" }
    }

    effects.publishTranscript({
      cues: snapshot.transcript.cues,
      identity: snapshot.transcript.identity,
      title: snapshot.transcript.title,
      fingerprint: snapshot.transcript.fingerprint,
      rawVtt: snapshot.transcript.rawVtt,
    })

    if (mode !== "current-context") {
      effects.clearTranscriptError()
    }

    const analysis = snapshot.analysis

    if (!analysis) {
      effects.clearAnalysis()
      effects.setAnalysisIdle()
      effects.clearAskWorkspace()
      return { kind: "published", analysisPublished: false }
    }

    effects.publishAnalysis(analysis)
    effects.setAnalysisCompleted()

    await effects.restoreQaConversation({
      contentKey: analysis.contentKey,
      analysisRunId: analysis.analysisRunId,
      transcriptFingerprint: snapshot.transcript.fingerprint,
    })

    return { kind: "published", analysisPublished: true }
  }

  /**
   * Publishes a completed Ask result into the current workspace.
   *
   * This is the final successful-result publication guard only: preparation
   * currentness, the transcript load epoch, and the task lifecycle stay in the
   * root. The stale decision is made exactly once, before any effect, from the
   * captured workspace epoch plus the existing Ask requested/current identity
   * matcher. Once publication starts there is no second epoch check, no second
   * identity match, and no rollback.
   *
   * The runtime content key is deliberately not compared against
   * `requested.contentKey`: publishing into a historical display selection is
   * valid. `runtimeContent` is never mutated here.
   */
  publishAskResult(
    request: WorkspaceAskPublicationRequest,
  ): WorkspaceAskPublicationResult {
    const { workspaceEpoch, requested, current, effects } = request

    if (
      !this.isEpochCurrent(workspaceEpoch)
      || !matchesAskRequestWorkspaceIdentity(requested, current)
    ) {
      return { kind: "stale" }
    }

    effects.publishAssistantMessage()
    effects.publishAnswer()

    return { kind: "published" }
  }

  /**
   * The single Analysis publication eligibility policy.
   *
   * In addition to the reused current-content/task-content policy, the captured
   * workspace epoch must still be current. That makes a workspace epoch stale
   * after *any* runtime `contentKey` identity transition, so an A -> B -> A
   * round trip no longer lets the original A task publish UI state even though
   * the runtime content key reads A again.
   */
  private canPublishAnalysis(
    target: WorkspaceAnalysisPublicationTarget,
  ): boolean {
    return this.isEpochCurrent(target.workspaceEpoch)
      && shouldPublishAnalysisToWorkspace(
        target.currentContentKey,
        target.taskContentKey,
      )
  }

  /**
   * Publishes the transcript captured for a still-current analysis task.
   *
   * The publication payload is supplied by the root closure so no transcript
   * data type crosses this boundary.
   */
  publishAnalysisTranscript(
    request: WorkspaceAnalysisPublicationTarget & {
      effects: WorkspaceAnalysisTranscriptPublicationEffects
    },
  ): WorkspaceAnalysisPublicationResult {
    if (!this.canPublishAnalysis(request)) return { kind: "stale" }

    request.effects.publishTranscript()

    return { kind: "published" }
  }

  /**
   * Publishes a completed analysis result, shared by the cache-hit and the
   * fresh-completion paths because the workspace policy is identical.
   *
   * The decision is made exactly once, before any effect. A rejection from
   * `restoreQaConversation` propagates unchanged after the earlier effects ran;
   * they are deliberately not rolled back.
   */
  async publishAnalysisResult(
    request: WorkspaceAnalysisPublicationTarget & {
      effects: WorkspaceAnalysisResultPublicationEffects
    },
  ): Promise<WorkspaceAnalysisPublicationResult> {
    const { effects } = request
    if (!this.canPublishAnalysis(request)) return { kind: "stale" }

    effects.publishAnalysis()
    effects.setAnalysisCompleted()
    await effects.restoreQaConversation()

    return { kind: "published" }
  }

  /**
   * Publishes the cancelled analysis state into the current workspace.
   */
  publishAnalysisCancelled(
    request: WorkspaceAnalysisPublicationTarget & {
      effects: WorkspaceAnalysisCancelledPublicationEffects
    },
  ): WorkspaceAnalysisPublicationResult {
    const { effects } = request
    if (!this.canPublishAnalysis(request)) return { kind: "stale" }

    effects.clearAnalysisError()
    effects.setAnalysisCancelled()

    return { kind: "published" }
  }

  /**
   * Publishes the failed analysis state into the current workspace.
   */
  publishAnalysisError(
    request: WorkspaceAnalysisPublicationTarget & {
      effects: WorkspaceAnalysisErrorPublicationEffects
    },
  ): WorkspaceAnalysisPublicationResult {
    const { effects } = request
    if (!this.canPublishAnalysis(request)) return { kind: "stale" }

    effects.publishAnalysisError()
    effects.setAnalysisErrorPhase()
    effects.markDisplayedAnalysisError()

    return { kind: "published" }
  }
}
