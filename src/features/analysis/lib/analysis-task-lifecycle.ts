export type AnalysisTaskExecutionPolicy = {
  bypassAnalysisCache: boolean
  forceReloadTranscript: boolean
}

export function getAnalysisTaskExecutionPolicy(regenerate: boolean): AnalysisTaskExecutionPolicy {
  return {
    bypassAnalysisCache: regenerate,
    forceReloadTranscript: false,
  }
}

export function captureAnalysisCompletionTimes(
  taskStartedAt: string,
  now: () => string = () => new Date().toISOString(),
) {
  return {
    taskStartedAt,
    completedAt: now(),
  }
}

export function shouldPublishAnalysisToWorkspace(
  currentContentKey: string | null,
  taskContentKey: string,
): boolean {
  return currentContentKey === taskContentKey
}
