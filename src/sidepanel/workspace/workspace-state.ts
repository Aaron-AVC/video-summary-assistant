import type { ActiveVideoContext, VideoIdentity } from "@/features/platform/types"
import { identityFromContext } from "@/sidepanel/lib/sidepanel-pure-helpers"

/**
 * Narrow, read-only projection of the runtime content supplied by the runtime
 * bridge. This is not a copy of the whole `ActiveVideoContext`: it deliberately
 * excludes playback position (`timestampSeconds`), so playback updates can
 * never become workspace identity transitions.
 *
 * `activeTabId` is the browser/runtime source tab id, not the Side Panel
 * navigation tab. The active Side Panel tab stays root-owned.
 */
export type WorkspaceRuntimeContent = {
  contentKey: string | null
  identity: VideoIdentity | null
  title: string | null
  author: string | null
  canonicalUrl: string | null
  isReady: boolean
  activeTabId: number | null
}

export type WorkspaceSnapshot = {
  runtimeContent: WorkspaceRuntimeContent
  workspaceEpoch: number
}

export type WorkspaceRuntimeContentInput = {
  videoContext: ActiveVideoContext
  activeTabId: number | null
}

/**
 * Projects the runtime content projection from the authoritative runtime
 * context. `contentKey` is preserved verbatim even when a complete
 * `VideoIdentity` cannot be constructed, because the workspace reset boundary
 * is keyed directly on `videoContext.contentKey`.
 */
export function projectWorkspaceRuntimeContent(
  input: WorkspaceRuntimeContentInput,
): WorkspaceRuntimeContent {
  const { videoContext, activeTabId } = input

  return {
    contentKey: videoContext.contentKey ?? null,
    identity: identityFromContext(videoContext),
    title: videoContext.title ?? null,
    author: videoContext.author ?? null,
    canonicalUrl: videoContext.canonicalUrl ?? videoContext.url ?? null,
    isReady: videoContext.isReady,
    activeTabId: activeTabId ?? null,
  }
}
