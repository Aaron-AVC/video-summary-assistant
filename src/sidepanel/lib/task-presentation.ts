import type { AnalysisTaskPhase } from "@/features/analysis/lib/analysis-task-controller"
import type { AskTaskPhase } from "@/features/analysis/lib/ask-task-controller"
import type { TranslationKey } from "@/lib/i18n/en"
import type { AnalysisPhase } from "@/sidepanel/lib/sidepanel-ux"

export type TaskPresentation = {
  phaseLabelKey: TranslationKey
  cancelDisabled: boolean
  cancelling: boolean
  spinnerAnimated: boolean
}

export type AnalysisHeaderPresentation = {
  statusKey: TranslationKey
}

export function getAnalysisTaskPresentation(phase: AnalysisTaskPhase): TaskPresentation {
  const cancelling = phase === "cancelling"
  const finalizing = phase === "finalizing"

  return {
    phaseLabelKey: phase === "loading-transcript"
      ? "task.loadingTranscript"
      : cancelling
        ? "task.cancelling"
        : finalizing
          ? "task.savingAnalysis"
          : "task.analyzing",
    cancelDisabled: cancelling || finalizing,
    cancelling,
    spinnerAnimated: !cancelling,
  }
}

export function getAskTaskPresentation(phase: AskTaskPhase): TaskPresentation {
  const cancelling = phase === "cancelling"
  const finalizing = phase === "finalizing"

  return {
    phaseLabelKey: cancelling
      ? "task.cancelling"
      : finalizing
        ? "task.savingAnswer"
        : phase === "repairing"
          ? "task.repairing"
          : "task.answering",
    cancelDisabled: cancelling || finalizing,
    cancelling,
    spinnerAnimated: !cancelling,
  }
}

export function getAnalysisHeaderPresentation({
  isAnalysisFetching,
  phase,
  hasAnalysis,
}: {
  isAnalysisFetching: boolean
  phase: AnalysisPhase
  hasAnalysis: boolean
}): AnalysisHeaderPresentation {
  if (isAnalysisFetching) return { statusKey: "analysis.loading" }

  const statusKey = phase === "loading-transcript" ? "runtime.statusLoadingTranscript"
    : phase === "analyzing" ? "runtime.statusAnalyzing"
      : phase === "finalizing" ? "runtime.statusSaving"
        : phase === "cancelling" ? "runtime.statusCancelling"
          : phase === "error" ? "runtime.statusError"
            : phase === "cancelled" ? "runtime.statusCancelled"
              : hasAnalysis ? "runtime.statusReady" : "runtime.statusNotAnalyzed"

  return { statusKey }
}
