import { describe, expect, it } from "bun:test"

import {
  AnalysisTaskAlreadyRunningError,
  AnalysisTaskController,
  type AnalysisTaskSnapshot,
} from "@/features/analysis/lib/analysis-task-controller"

const snapshot: Omit<AnalysisTaskSnapshot, "taskId" | "startedAt"> = {
  sourceTabId: 11,
  platform: "youtube",
  videoId: "video-a",
  partId: null,
  contentKey: "youtube:video-a",
  title: "Video A",
  author: "Author A",
  canonicalUrl: "https://www.youtube.com/watch?v=video-a",
  providerProfileId: "provider-a",
  providerBaseUrl: "https://api.example.com/v1",
  providerModel: "model-a",
  generationTimeoutSec: 600,
  analysisPresetId: "standard",
  analysisPromptVersion: "video-analysis-v2",
}

describe("AnalysisTaskController", () => {
  it("owns one task, exposes phase changes, and releases after completion", async () => {
    const controller = new AnalysisTaskController()
    const phases: string[] = []
    const unsubscribe = controller.subscribe(() => {
      const task = controller.getSnapshot()
      phases.push(task?.phase ?? "released")
    })

    let finish!: () => void
    const promise = controller.start(snapshot, async ({ setPhase }) => {
      setPhase("analyzing")
      await new Promise<void>((resolve) => { finish = resolve })
    })

    expect(controller.getSnapshot()?.snapshot.contentKey).toBe("youtube:video-a")
    await expect(() => controller.start(snapshot, async () => undefined)).toThrow(AnalysisTaskAlreadyRunningError)
    finish()
    await promise
    expect(controller.getSnapshot()).toBeNull()
    expect(phases).toEqual(["loading-transcript", "analyzing", "released"])
    unsubscribe()
  })


  it("keeps typed progress private to the active task and clears it before saving", async () => {
    const controller = new AnalysisTaskController()
    let finish!: () => void
    let lateProgress!: (event: { kind: "final" }) => void
    const promise = controller.start(snapshot, async ({ setPhase, setProgress }) => {
      lateProgress = setProgress
      setPhase("analyzing")
      setProgress({ kind: "map", completed: 0, total: 2 })
      expect(controller.getSnapshot()?.progress).toEqual({ kind: "map", completed: 0, total: 2 })
      setProgress({ kind: "final" })
      expect(controller.getSnapshot()?.phase).toBe("analyzing")
      expect(controller.cancel()).toBe(true)
      setProgress({ kind: "repair" })
      expect(controller.getSnapshot()?.phase).toBe("cancelling")
      expect(controller.getSnapshot()?.progress).toBeUndefined()
      await new Promise<void>((resolve) => { finish = resolve })
    })
    finish()
    await promise
    lateProgress({ kind: "final" })
    expect(controller.getSnapshot()).toBeNull()
  })

  it("does not confuse the final provider call with non-cancellable persistence", async () => {
    const controller = new AnalysisTaskController()
    let finish!: () => void
    const promise = controller.start(snapshot, async ({ setPhase, setProgress }) => {
      setPhase("analyzing")
      setProgress({ kind: "final" })
      expect(controller.getSnapshot()?.phase).toBe("analyzing")
      setPhase("finalizing")
      expect(controller.getSnapshot()?.progress).toBeUndefined()
      expect(controller.cancel()).toBe(false)
      await new Promise<void>((resolve) => { finish = resolve })
    })
    finish()
    await promise
  })


  it("freezes the provider generation timeout in the task snapshot", async () => {
    const controller = new AnalysisTaskController()
    let finish!: () => void
    const promise = controller.start({ ...snapshot, generationTimeoutSec: 1800 }, async () => {
      await new Promise<void>((resolve) => { finish = resolve })
    })
    expect(controller.getSnapshot()?.snapshot.generationTimeoutSec).toBe(1800)
    finish()
    await promise
  })

  it("aborts the runner and reports cancelling", async () => {
    const controller = new AnalysisTaskController()
    let signal!: AbortSignal
    let rejectRunner!: (error: Error) => void
    const promise = controller.start(snapshot, async (input) => {
      signal = input.signal
      await new Promise<void>((_resolve, reject) => { rejectRunner = reject })
    })

    expect(controller.cancel()).toBe(true)
    expect(controller.getSnapshot()?.phase).toBe("cancelling")
    expect(signal.aborted).toBe(true)
    rejectRunner(new Error("cancelled"))
    await expect(promise).rejects.toThrow("cancelled")
    expect(controller.getSnapshot()).toBeNull()
  })

  it("does not abort a task once final persistence has started", async () => {
    const controller = new AnalysisTaskController()
    let finish!: () => void
    const promise = controller.start(snapshot, async ({ setPhase }) => {
      setPhase("finalizing")
      await new Promise<void>((resolve) => { finish = resolve })
    })

    expect(controller.cancel()).toBe(false)
    expect(controller.getSnapshot()?.phase).toBe("finalizing")
    finish()
    await promise
    expect(controller.getSnapshot()).toBeNull()
  })
})
