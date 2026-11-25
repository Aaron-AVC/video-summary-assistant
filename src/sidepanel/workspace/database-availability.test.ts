import { describe, expect, it } from "bun:test"

import {
  DatabaseAvailabilityController,
  type DatabaseAvailabilityStatus,
} from "@/sidepanel/workspace/database-availability"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe("Side Panel database availability", () => {
  it("publishes available only after the read-only probe succeeds", async () => {
    const probe = deferred<void>()
    const controller = new DatabaseAvailabilityController({ probe: () => probe.promise })
    const states: DatabaseAvailabilityStatus[] = []
    controller.subscribe((snapshot) => states.push(snapshot.status))
    const opening = controller.initialize()
    expect(controller.getSnapshot().status).toBe("initializing")
    probe.resolve()
    await expect(opening).resolves.toBe("available")
    expect(states).toEqual(["initializing", "available"])
  })

  it("distinguishes database failure from an empty history result", async () => {
    const controller = new DatabaseAvailabilityController({
      probe: async () => { throw new DOMException("closed", "UnknownError") },
    })
    await expect(controller.initialize()).resolves.toBe("unavailable")
    expect(controller.getSnapshot().status).toBe("unavailable")
  })

  it("shares concurrent manual retries and retries only once", async () => {
    let attempts = 0
    const retryProbe = deferred<void>()
    const controller = new DatabaseAvailabilityController({
      probe: async () => {
        attempts += 1
        if (attempts === 1) throw new Error("initial failure")
        await retryProbe.promise
      },
    })
    await controller.initialize()
    const first = controller.retry()
    const second = controller.retry()
    expect(first).toBe(second)
    expect(controller.getSnapshot().status).toBe("retrying")
    expect(attempts).toBe(1)
    await Promise.resolve()
    expect(attempts).toBe(2)
    retryProbe.resolve()
    await expect(first).resolves.toBe("available")
  })

  it("remains unavailable after a failed retry", async () => {
    let attempts = 0
    const controller = new DatabaseAvailabilityController({
      probe: async () => { throw new Error(`failure ${++attempts}`) },
    })
    await controller.initialize()
    await expect(controller.retry()).resolves.toBe("unavailable")
    expect(controller.getSnapshot()).toMatchObject({
      status: "unavailable",
      errorMessage: "failure 2",
    })
  })

  it("lets a runtime database failure revoke readiness", async () => {
    const controller = new DatabaseAvailabilityController({ probe: async () => {} })
    await controller.initialize()
    controller.markUnavailable(
      new Error("runtime DatabaseClosedError"),
      controller.captureFailureGeneration(),
    )
    expect(controller.getSnapshot()).toMatchObject({
      status: "unavailable",
      errorMessage: "runtime DatabaseClosedError",
    })
  })

  it("does not let a stale readiness result override a runtime failure", async () => {
    const probe = deferred<void>()
    const controller = new DatabaseAvailabilityController({ probe: () => probe.promise })
    const opening = controller.initialize()
    controller.markUnavailable(
      new Error("database closed during probe"),
      controller.captureFailureGeneration(),
    )
    probe.resolve()
    await expect(opening).resolves.toBe("unavailable")
    expect(controller.getSnapshot().status).toBe("unavailable")
  })

  it("does not let an operation failure from before a successful retry revoke readiness", async () => {
    const oldOperation = deferred<void>()
    const controller = new DatabaseAvailabilityController({ probe: async () => {} })
    await controller.initialize()

    const oldFailureGeneration = controller.captureFailureGeneration()
    const oldOperationRead = oldOperation.promise.catch((error: unknown) => {
      controller.markUnavailable(error, oldFailureGeneration)
    })
    controller.markUnavailable(
      new DOMException("current failure", "DatabaseClosedError"),
      controller.captureFailureGeneration(),
    )
    await expect(controller.retry()).resolves.toBe("available")

    oldOperation.reject(new DOMException("late old failure", "DatabaseClosedError"))
    await oldOperationRead

    expect(controller.getSnapshot().status).toBe("available")
  })

  it("still accepts a database failure reported by the current generation after recovery", async () => {
    const controller = new DatabaseAvailabilityController({ probe: async () => {} })
    await controller.initialize()
    controller.markUnavailable(
      new DOMException("first failure", "DatabaseClosedError"),
      controller.captureFailureGeneration(),
    )
    await expect(controller.retry()).resolves.toBe("available")

    const accepted = controller.markUnavailable(
      new DOMException("new failure", "DatabaseClosedError"),
      controller.captureFailureGeneration(),
    )

    expect(accepted).toBe(true)
    expect(controller.getSnapshot().status).toBe("unavailable")
    expect(controller.getSnapshot().errorMessage).toBe("new failure")
  })
})
