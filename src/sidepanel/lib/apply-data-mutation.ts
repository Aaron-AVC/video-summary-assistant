import type {
  DestructiveMutation
} from "@/features/history/lib/destructive-operation-coordinator"

export type SidepanelMutationWorkspace = {
  analysisRunId: string | null
  analysisContentKey: string | null
  hasPersistedAnalysis: boolean
  transcriptContentKey: string | null
  videoContextContentKey: string | null
}

export type SidepanelMutationEffects = {
  invalidateWorkspace: (clearTranscript: boolean) => void
  clearAnalysis: () => void
  setAnalysisIdle: () => void
  clearAskWorkspace: () => void
  clearTranscriptWorkspace: () => void
  refreshRecentAnalyses: () => void | Promise<void>
  refreshProvider: () => void | Promise<void>
}

export async function applySidepanelDataMutation(
  mutation: DestructiveMutation,
  workspace: SidepanelMutationWorkspace,
  effects: SidepanelMutationEffects,
): Promise<void> {
  if (mutation.type === "delete-analysis-run") {
    if (workspace.analysisRunId === mutation.analysisRunId) {
      effects.invalidateWorkspace(false)
      effects.clearAnalysis()
      effects.setAnalysisIdle()
      effects.clearAskWorkspace()
    }
    await effects.refreshRecentAnalyses()
    return
  }

  if (mutation.type === "delete-video-data") {
    const matchesWorkspace = workspace.analysisContentKey === mutation.contentKey
      || workspace.transcriptContentKey === mutation.contentKey
      || workspace.videoContextContentKey === mutation.contentKey
    if (matchesWorkspace) {
      effects.invalidateWorkspace(true)
      effects.clearAnalysis()
      effects.setAnalysisIdle()
      effects.clearAskWorkspace()
      effects.clearTranscriptWorkspace()
    }
    await effects.refreshRecentAnalyses()
    return
  }

  if (mutation.type === "clear-conversations") {
    effects.clearAskWorkspace()
    return
  }

  if (mutation.type === "clear-analysis-history") {
    effects.invalidateWorkspace(false)
    if (workspace.hasPersistedAnalysis) {
      effects.clearAnalysis()
      effects.setAnalysisIdle()
    }
    effects.clearAskWorkspace()
    await effects.refreshRecentAnalyses()
    return
  }

  if (mutation.type === "clear-all") {
    effects.invalidateWorkspace(true)
    effects.clearAnalysis()
    effects.setAnalysisIdle()
    effects.clearAskWorkspace()
    effects.clearTranscriptWorkspace()
    await Promise.all([effects.refreshProvider(), effects.refreshRecentAnalyses()])
    return
  }

  // Transcript-cache and diagnostics mutations do not invalidate loaded workspace state.
}
