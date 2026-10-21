import type { WorkspaceDisplaySelection } from "@/sidepanel/workspace/workspace-state"
import type { WorkspaceRestoredAnalysisIdentity } from "@/sidepanel/workspace/workspace-controller"

export type RestoredDisplaySelectionEffects = {
  isLoadGenerationCurrent: (generation: number) => boolean
  readSelectedQaThreadId: () => string | null
  syncDisplaySelection: (selection: WorkspaceDisplaySelection) => void
}

export type CommitRestoredDisplaySelectionInput = {
  generation: number
  restored: WorkspaceRestoredAnalysisIdentity | null
  effects: RestoredDisplaySelectionEffects
}

/**
 * Publishes a completed history restore as the displayed analysis selection.
 *
 * A restore can finish long after a newer workspace load already began, and
 * `publishHistoryRestore` deliberately does not re-check currentness once it
 * has started (there is no rollback). The restore result alone is therefore not
 * evidence that the request is still current: publishing it would overwrite a
 * newer restore's selection and invalidate the newer Search opening.
 *
 * The generation check and the synchronous selection update must stay in one
 * uninterrupted synchronous segment, so no await may be introduced between
 * them. Returns the identity that was committed, or null when this request is
 * stale and must not report success.
 */
export function commitRestoredDisplaySelection(
  input: CommitRestoredDisplaySelectionInput,
): WorkspaceRestoredAnalysisIdentity | null {
  if (!input.effects.isLoadGenerationCurrent(input.generation)) return null

  const restored = input.restored

  if (!restored) return null

  input.effects.syncDisplaySelection({
    // Historical restores publish content that may differ from the runtime
    // video, so the displayed analysis identity is recorded independently of
    // runtime content identity.
    analysis: {
      contentKey: restored.contentKey,
      analysisRunId: restored.analysisRunId,
    },
    qaThreadId: input.effects.readSelectedQaThreadId(),
  })

  return restored
}
