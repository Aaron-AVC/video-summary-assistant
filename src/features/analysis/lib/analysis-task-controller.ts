import type { AnalysisPresetId } from "@/features/analysis/lib/analysis-preset"
import type { AnalysisProgressEvent } from "@/features/analysis/lib/run-analysis"
import type { VideoPlatform } from "@/features/platform/types"

export type AnalysisTaskPhase = "loading-transcript" | "analyzing" | "finalizing" | "cancelling"

export type AnalysisTaskSnapshot = {
  taskId: string
  sourceTabId: number
  platform: VideoPlatform
  videoId: string
  partId: string | null
  contentKey: string
  title: string
  author: string | null
  canonicalUrl: string | null
  providerProfileId: string
  providerBaseUrl: string
  providerModel: string
  generationTimeoutSec: number
  /** Preset captured when the task started; later settings changes never alter it. */
  analysisPresetId: AnalysisPresetId
  /** Effective prompt version for the captured preset; drives cache identity. */
  analysisPromptVersion: string
  startedAt: string
}
export type ActiveAnalysisTask = {
  snapshot: AnalysisTaskSnapshot
  phase: AnalysisTaskPhase
  /** Ephemeral metadata, never source text or generated content. */
  progress?: AnalysisProgressEvent
}
export type AnalysisTaskRunner = (input: {
  taskId: string
  signal: AbortSignal
  setPhase: (phase: AnalysisTaskPhase) => void
  setProgress: (event: AnalysisProgressEvent) => void
}) => Promise<void>

export type AnalysisTaskStartOptions = {
  taskId?: string
  startedAt?: string
}

export class AnalysisTaskAlreadyRunningError extends Error {
  constructor() {
    super("Another analysis is already running.")
    this.name = "AnalysisTaskAlreadyRunningError"
  }
}
export class AnalysisTaskController {
  private activeTask: ActiveAnalysisTask | null = null
  private activeAbortController: AbortController | null = null
  private readonly listeners = new Set<() => void>()

  getSnapshot(): ActiveAnalysisTask | null {
    return this.activeTask
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  isCurrent(taskId: string): boolean {
    return this.activeTask?.snapshot.taskId === taskId
  }

  start(
    snapshot: Omit<AnalysisTaskSnapshot, "taskId" | "startedAt">,
    runner: AnalysisTaskRunner,
    options: AnalysisTaskStartOptions = {},
  ): Promise<void> {
    if (this.activeTask) throw new AnalysisTaskAlreadyRunningError()

    const taskSnapshot: AnalysisTaskSnapshot = {
      ...snapshot,
      taskId: options.taskId ?? crypto.randomUUID(),
      startedAt: options.startedAt ?? new Date().toISOString(),
    }
    const controller = new AbortController()
    this.activeAbortController = controller
    this.activeTask = { snapshot: taskSnapshot, phase: "loading-transcript" }
    this.notify()

    return (async () => {
      try {
        await runner({
          taskId: taskSnapshot.taskId,
          signal: controller.signal,
          setPhase: (phase) => {
            if (!this.isCurrent(taskSnapshot.taskId)) return
            const progress = phase === "analyzing" ? this.activeTask?.progress : undefined
            this.activeTask = { snapshot: taskSnapshot, phase, ...(progress ? { progress } : {}) }
            this.notify()
          },
          setProgress: (event) => {
            const active = this.activeTask
            if (!this.isCurrent(taskSnapshot.taskId)
              || controller.signal.aborted
              || !active
              || active.phase !== "analyzing") return
            this.activeTask = { ...active, progress: event }
            this.notify()
          },
        })
      } finally {
        if (this.isCurrent(taskSnapshot.taskId)) {
          this.activeTask = null
          this.activeAbortController = null
          this.notify()
        }
      }
    })()
  }

  cancel(): boolean {
    if (!this.activeTask || !this.activeAbortController) return false
    if (this.activeTask.phase === "finalizing") return false
    if (this.activeTask.phase !== "cancelling") {
      this.activeTask = { snapshot: this.activeTask.snapshot, phase: "cancelling" }
      this.notify()
    }
    this.activeAbortController.abort()
    return true
  }

  private notify() {
    for (const listener of this.listeners) listener()
  }
}
