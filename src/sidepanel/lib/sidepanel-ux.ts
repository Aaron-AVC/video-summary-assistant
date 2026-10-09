export const SIDE_PANEL_TABS = ["overview", "transcript", "ask", "settings"] as const

export type SidePanelTab = (typeof SIDE_PANEL_TABS)[number]

export const INITIAL_SIDE_PANEL_TAB: SidePanelTab = "overview"

export type AnalysisPhase =
  | "idle"
  | "loading-transcript"
  | "analyzing"
  | "cancelling"
  | "completed"
  | "error"
  | "cancelled"

export function selectSidePanelTab(
  current: SidePanelTab,
  requested: string,
): SidePanelTab {
  return SIDE_PANEL_TABS.includes(requested as SidePanelTab)
    ? requested as SidePanelTab
    : current
}

export function shouldResetVideoSpecificState(
  previousContentKey: string | null,
  nextContentKey: string | null,
): boolean {
  return previousContentKey !== nextContentKey
}

export function getAnalysisAction({
  hasProvider,
  hasAnalysis,
  isAnalyzing,
}: {
  hasProvider: boolean
  hasAnalysis: boolean
  isAnalyzing: boolean
}) {
  if (isAnalyzing) return { kind: "cancel" as const, label: "Cancel" }
  if (!hasProvider) {
    return { kind: "configure-provider" as const, label: "Configure provider" }
  }
  if (hasAnalysis) return { kind: "regenerate" as const, label: "Regenerate" }
  return { kind: "generate" as const, label: "Generate analysis" }
}

export type AskRequirement = "provider" | "analysis" | "transcript" | null

export function getAskRequirement({
  hasProvider,
  hasAnalysis,
  hasTranscript,
}: {
  hasProvider: boolean
  hasAnalysis: boolean
  hasTranscript: boolean
}): AskRequirement {
  if (!hasProvider) return "provider"
  if (!hasAnalysis) return "analysis"
  if (!hasTranscript) return "transcript"
  return null
}

export function getAnalysisStatusLabel(phase: AnalysisPhase, hasAnalysis: boolean) {
  switch (phase) {
    case "loading-transcript":
      return "Loading transcript…"
    case "analyzing":
      return "Analyzing video…"
    case "cancelling":
      return "Cancelling…"
    case "completed":
      return "Analysis ready"
    case "error":
      return "Analysis error"
    case "cancelled":
      return "Analysis cancelled"
    default:
      return hasAnalysis ? "Analysis ready" : "Not analyzed"
  }
}
