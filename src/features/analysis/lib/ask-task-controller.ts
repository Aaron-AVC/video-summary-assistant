export type AskTaskPhase = "answering" | "repairing" | "finalizing" | "cancelling"

export type AskTaskSnapshot = {
  taskId: string
  contentKey: string
  analysisRunId: string
  transcriptFingerprint: string
  threadId: string
  platform: "youtube" | "bilibili"
  videoId: string
  partId: string | null
  videoTitle: string
  question: string
  providerProfileId: string
  providerBaseUrl: string
  providerModel: string
  generationTimeoutSec: number
  startedAt: string
}

export type ActiveAskTask = {
  snapshot: AskTaskSnapshot
  phase: AskTaskPhase
}

export type AskTaskRunner = (input: {
  taskId: string
  signal: AbortSignal
  setPhase: (phase: AskTaskPhase) => void
}) => Promise<void>

export class AskTaskAlreadyRunningError extends Error {
  constructor() {
    super("Another Ask Video request is already running.")
    this.name = "AskTaskAlreadyRunningError"
  }
}

export class AskTaskController {
  private activeTask: ActiveAskTask | null = null
  private activeAbortController: AbortController | null = null
  private readonly listeners = new Set<() => void>()

  getSnapshot(): ActiveAskTask | null {
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
    snapshot: Omit<AskTaskSnapshot, "taskId" | "startedAt">,
    runner: AskTaskRunner,
  ): Promise<void> {
    if (this.activeTask) throw new AskTaskAlreadyRunningError()

    const taskSnapshot: AskTaskSnapshot = {
      ...snapshot,
      taskId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
    }
    const controller = new AbortController()
    this.activeAbortController = controller
    this.activeTask = { snapshot: taskSnapshot, phase: "answering" }
    this.notify()

    return (async () => {
      try {
        await runner({
          taskId: taskSnapshot.taskId,
          signal: controller.signal,
          setPhase: (phase) => {
            if (!this.isCurrent(taskSnapshot.taskId)) return
            this.activeTask = { snapshot: taskSnapshot, phase }
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
      this.activeTask = { ...this.activeTask, phase: "cancelling" }
      this.notify()
    }
    this.activeAbortController.abort()
    return true
  }

  private notify() {
    for (const listener of this.listeners) listener()
  }
}
