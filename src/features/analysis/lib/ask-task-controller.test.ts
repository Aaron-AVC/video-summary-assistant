import { describe, expect, it } from "bun:test"

import {
  AskTaskAlreadyRunningError,
  AskTaskController,
  type AskTaskSnapshot,
} from "@/features/analysis/lib/ask-task-controller"

const snapshot: Omit<AskTaskSnapshot, "taskId" | "startedAt"> = {
  contentKey: "youtube:video-a",
  analysisRunId: "run-a",
  transcriptFingerprint: "fp-a",
  threadId: "thread-a",
  platform: "youtube",
  videoId: "video-a",
  partId: null,
  videoTitle: "Video A",
  question: "What happened?",
  providerProfileId: "provider-a",
  providerBaseUrl: "https://api.example.com/v1",
  providerModel: "model-a",
  generationTimeoutSec: 600,
}

describe("AskTaskController", () => {
  it("owns one task, exposes phases, and releases after completion", async () => {
    const controller = new AskTaskController()
    const phases: string[] = []
    controller.subscribe(() => phases.push(controller.getSnapshot()?.phase ?? "released"))
    let finish!: () => void
    const promise = controller.start(snapshot, async ({ setPhase }) => {
      setPhase("repairing")
      await new Promise<void>((resolve) => { finish = resolve })
      setPhase("finalizing")
    })

    expect(controller.getSnapshot()?.snapshot.contentKey).toBe("youtube:video-a")
    expect(() => controller.start(snapshot, async () => undefined)).toThrow(AskTaskAlreadyRunningError)
    finish()
    await promise
    expect(controller.getSnapshot()).toBeNull()
    expect(phases).toEqual(["answering", "repairing", "finalizing", "released"])
  })

  it("cancels the signal but refuses cancellation during finalizing", async () => {
    const controller = new AskTaskController()
    let signal!: AbortSignal
    let finish!: () => void
    const promise = controller.start(snapshot, async ({ signal: taskSignal, setPhase }) => {
      signal = taskSignal
      setPhase("finalizing")
      await new Promise<void>((resolve) => { finish = resolve })
    })

    expect(controller.cancel()).toBe(false)
    expect(signal.aborted).toBe(false)
    expect(controller.getSnapshot()?.phase).toBe("finalizing")
    finish()
    await promise
  })

  it("aborts an answering task and releases it after cancellation", async () => {
    const controller = new AskTaskController()
    let resolveAbort!: () => void
    const promise = controller.start(snapshot, async ({ signal }) => {
      await new Promise<void>((resolve) => {
        resolveAbort = resolve
        signal.addEventListener("abort", () => resolve(), { once: true })
      })
      throw new DOMException("The Ask Video request was cancelled.", "AbortError")
    })

    expect(controller.cancel()).toBe(true)
    expect(controller.getSnapshot()?.phase).toBe("cancelling")
    resolveAbort()
    await expect(promise).rejects.toMatchObject({ name: "AbortError" })
    expect(controller.getSnapshot()).toBeNull()
  })

  it("keeps a running task independent of external workspace identity", async () => {
    const controller = new AskTaskController()
    let finish!: () => void
    const promise = controller.start(snapshot, async () => {
      await new Promise<void>((resolve) => { finish = resolve })
    })
    expect(controller.isCurrent(controller.getSnapshot()!.snapshot.taskId)).toBe(true)
    finish()
    await promise
    expect(controller.getSnapshot()).toBeNull()
  })
})
