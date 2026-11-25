import { describe, expect, it } from "bun:test"
import {
  actWhenSmokeReady,
  waitForSmokeOutcome,
} from "./smoke-condition"

type ClearButtonState = {
  present: boolean
  disabled: boolean
  inventoryReady: boolean
}

type ClearOutcome = {
  kind: "success" | "error"
  text: string
}

function createTestClock() {
  let now = 0
  const sleeps: number[] = []
  return {
    sleeps,
    now: () => now,
    sleep: async (milliseconds: number) => {
      sleeps.push(milliseconds)
      now += milliseconds
    },
  }
}

describe("Smoke condition synchronization", () => {
  it("does not click a visible clear button until inventory is ready and the button is enabled", async () => {
    const states: ClearButtonState[] = [
      { present: true, disabled: true, inventoryReady: false },
      { present: true, disabled: true, inventoryReady: true },
      { present: true, disabled: false, inventoryReady: true },
    ]
    const clock = createTestClock()
    let reads = 0
    let clicks = 0

    const result = await actWhenSmokeReady(
      async () => states[Math.min(reads++, states.length - 1)],
      (state: ClearButtonState) => state.present && !state.disabled && state.inventoryReady,
      async () => {
        clicks += 1
        return "clicked once"
      },
      "ready clear button",
      { timeoutMs: 100, intervalMs: 10, clock },
    )

    expect(result.observation.disabled).toBe(false)
    expect(result.observation.inventoryReady).toBe(true)
    expect(result.result).toBe("clicked once")
    expect(clicks).toBe(1)
    expect(reads).toBe(3)
    expect(clock.sleeps).toEqual([10, 10])
  })

  it("waits for clear feedback before returning the completed outcome", async () => {
    const clock = createTestClock()
    const outcomes: Array<ClearOutcome | null> = [
      null,
      null,
      { kind: "success", text: "Clear analysis history completed" },
    ]
    let reads = 0

    const outcome = await waitForSmokeOutcome(
      async () => outcomes[Math.min(reads++, outcomes.length - 1)],
      (value: ClearOutcome | null): value is ClearOutcome => value !== null,
      (value: ClearOutcome) => value.kind === "success",
      "analysis history clear",
      (value: ClearOutcome) => value.text,
      { timeoutMs: 100, intervalMs: 5, clock },
    )

    expect(outcome.kind).toBe("success")
    expect(reads).toBe(3)
    expect(clock.sleeps).toEqual([5, 5])
  })

  it("fails explicitly when the clear operation reports an error", async () => {
    await expect(waitForSmokeOutcome(
      async () => ({ kind: "error", text: "IndexedDB transaction failed" } satisfies ClearOutcome),
      (value: ClearOutcome | null): value is ClearOutcome => value !== null,
      (value: ClearOutcome) => value.kind === "success",
      "analysis history clear",
      (value: ClearOutcome) => value.text,
      { timeoutMs: 100, intervalMs: 5, clock: createTestClock() },
    )).rejects.toThrow("analysis history clear returned an unexpected outcome: IndexedDB transaction failed")
  })

  it("fails explicitly when no clear feedback arrives before the bounded timeout", async () => {
    const clock = createTestClock()
    await expect(waitForSmokeOutcome(
      async () => null,
      (value: ClearOutcome | null): value is ClearOutcome => value !== null,
      (value: ClearOutcome) => value.kind === "success",
      "analysis history clear feedback",
      (value: ClearOutcome) => value.text,
      { timeoutMs: 12, intervalMs: 5, clock },
    )).rejects.toThrow("timed out waiting for analysis history clear feedback")
    expect(clock.sleeps).toEqual([5, 5, 2])
  })
})
