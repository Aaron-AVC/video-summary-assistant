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
}
