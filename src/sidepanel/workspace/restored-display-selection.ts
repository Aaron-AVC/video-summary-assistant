import type { WorkspaceDisplaySelection } from "@/sidepanel/workspace/workspace-state"
import type { WorkspaceRestoredAnalysisIdentity } from "@/sidepanel/workspace/workspace-controller"

export type RestoredDisplayedAnalysis = {
  contentKey: string
  analysisRunId: string | null
}

export type RestoredDisplaySelectionEffects = {
  isLoadGenerationCurrent: (generation: number) => boolean
  readDisplayedAnalysis: () => RestoredDisplayedAnalysis | null
  readDisplayGeneration: () => number
  readSelectedQaThreadId: () => string | null
  syncDisplaySelection: (selection: WorkspaceDisplaySelection) => void
}

export type CommitRestoredDisplaySelectionInput = {
  generation: number
  /**
   * Display generation captured when this restore started. Any competing
   * publication that replaced the displayed analysis in the meantime advanced
   * it, even when it never touched the load generation.
   */
  displayGeneration: number
  restored: WorkspaceRestoredAnalysisIdentity | null
  effects: RestoredDisplaySelectionEffects
}

/**
 * Publishes a completed history restore as the displayed analysis selection.
 *
 * A restore can finish long after a newer workspace load already began, and
 * `publishHistoryRestore` has no rollback: effects it already applied stay
 * applied even when a newer owner took the display while the restore was
 * awaiting. The restore result alone is therefore not evidence that the request
 * is still current: publishing it would overwrite a newer selection and
 * invalidate the newer Search opening.
 *
 * Two independent ownership signals are checked:
 * 1. The load generation, which every History load and destructive mutation
 *    advances.
 * 2. The display generation, which also advances on ordinary analysis
 *    publication — the path that replaces the displayed analysis without
 *    starting a workspace load.
 *
 * A restore that already owns the displayed analysis (the publication it
 * started is still what the workspace shows) may commit even though its own
 * publish step moved the display generation. Anything else must still hold the
 * token it captured, which fails as soon as a competing publication wins.
 *
 * All checks and the synchronous selection update stay in one uninterrupted
 * synchronous segment, so no await may be introduced between them. Returns the
 * identity that was committed, or null when this request is stale and must not
 * report success.
 */
export function commitRestoredDisplaySelection(
  input: CommitRestoredDisplaySelectionInput,
): WorkspaceRestoredAnalysisIdentity | null {
  const { effects, restored } = input

  if (!effects.isLoadGenerationCurrent(input.generation)) return null
  if (!restored) return null

  const displayed = effects.readDisplayedAnalysis()
  const alreadyDisplayed = displayed !== null
    && displayed.contentKey === restored.contentKey
    && displayed.analysisRunId === restored.analysisRunId

  if (!alreadyDisplayed && effects.readDisplayGeneration() !== input.displayGeneration) {
    return null
  }

  effects.syncDisplaySelection({
    // Historical restores publish content that may differ from the runtime
    // video, so the displayed analysis identity is recorded independently of
    // runtime content identity.
    analysis: {
      contentKey: restored.contentKey,
      analysisRunId: restored.analysisRunId,
    },
    qaThreadId: effects.readSelectedQaThreadId(),
  })

  return restored
}
