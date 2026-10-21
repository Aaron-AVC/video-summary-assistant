import type { AnalysisExecutionPublication } from "@/sidepanel/analysis/analysis-controller"
import type { WorkspaceDisplaySelection } from "@/sidepanel/workspace/workspace-state"

export type CompletedAnalysisPublicationEffects = {
  publishAnalysisView: (publication: AnalysisExecutionPublication & { errorMessage: null }) => void
  readSelectedQaThreadId: () => string | null
  syncDisplaySelection: (selection: WorkspaceDisplaySelection) => void
}

/**
 * Publishes a completed analysis result (cached or freshly produced) and
 * records the resulting display ownership in one uninterrupted synchronous
 * segment.
 *
 * Publishing replaces the displayed analysis without starting a workspace
 * load, so the load generation cannot observe it. Writing the display
 * selection here is what lets an in-flight History restore notice that its
 * captured ownership is gone before it commits a stale identity.
 */
export function publishCompletedAnalysis(
  publication: AnalysisExecutionPublication,
  effects: CompletedAnalysisPublicationEffects,
): void {
  effects.publishAnalysisView({
    ...publication,
    errorMessage: null,
  })
  effects.syncDisplaySelection({
    analysis: {
      contentKey: publication.contentKey,
      analysisRunId: publication.analysisRunId,
    },
    qaThreadId: effects.readSelectedQaThreadId(),
  })
}
