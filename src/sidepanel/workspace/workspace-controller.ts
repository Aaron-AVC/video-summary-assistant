import type {
  TranscriptSegment,
  VideoIdentity,
} from "@/features/platform/types"
import type {
  HistoryAnalysisSnapshot,
  HistoryRestoreSnapshot,
} from "@/sidepanel/history/history-controller"
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
 * Owns the runtime-content projection and the workspace epoch.
 *
 * The workspace epoch advances once for the initial observation and once for
 * every runtime `contentKey` change. It does not advance for same-content
 * metadata refreshes. This controller does not own feature state, publication,
 * task lifecycle, React state, repositories, or browser APIs; it only decides
 * whether a runtime-content transition is identity-changing.
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
}
