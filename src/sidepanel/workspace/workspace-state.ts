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

/**
 * The selected analysis a display is showing.
 *
 * This is a reference only: it deliberately carries no analysis payload, title,
 * transcript, provider metadata, or error/loading flags. `analysisRunId` keeps
 * the raw persisted run identity, including `null`, which is exactly what
 * `AnalysisView.analysisRunId` and the cache/analysis-run schemas allow.
 * The Ask compatibility projection (`analysisRunId ?? "legacy"`) is applied
 * only at the Ask identity boundary, never in stored workspace state.
 */
export type WorkspaceAnalysisSelection = {
  contentKey: string
  analysisRunId: string | null
}

/**
 * Cross-feature display selection references. Historical display selection is
 * valid, so the selected analysis `contentKey` may legitimately differ from
 * `WorkspaceRuntimeContent.contentKey`.
 */
export type WorkspaceDisplaySelection = {
  analysis: WorkspaceAnalysisSelection | null
  qaThreadId: string | null
}

export type WorkspaceSnapshot = {
  runtimeContent: WorkspaceRuntimeContent
  displaySelection: WorkspaceDisplaySelection
  workspaceEpoch: number
}

export type WorkspaceRuntimeContentInput = {
  videoContext: ActiveVideoContext
  activeTabId: number | null
}

/**
 * Defensive copy of a display selection, including the nested analysis
 * reference, so a returned snapshot can never mutate controller-owned state.
 */
export function cloneWorkspaceDisplaySelection(
  selection: WorkspaceDisplaySelection,
): WorkspaceDisplaySelection {
  return {
    analysis: selection.analysis ? { ...selection.analysis } : null,
    qaThreadId: selection.qaThreadId,
  }
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
