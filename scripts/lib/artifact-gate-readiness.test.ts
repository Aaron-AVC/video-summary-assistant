import { describe, expect, it } from "bun:test"

import {
  isNormalApplicationReady,
  runStableSidePanelReadinessGate,
} from "./artifact-gate-readiness"

describe("normal database readiness", () => {
  it("requires both application mount and an explicitly available database", () => {
    const base = { readyState: "complete", rootChildCount: 1, bodyChildCount: 2 }
    expect(isNormalApplicationReady({ ...base, databaseStatus: "available" })).toBe(true)
    expect(isNormalApplicationReady({ ...base, databaseStatus: "initializing" })).toBe(false)
    expect(isNormalApplicationReady({ ...base, databaseStatus: "unavailable" })).toBe(false)
    expect(isNormalApplicationReady({ ...base, databaseStatus: "retrying" })).toBe(false)
    expect(isNormalApplicationReady({ ...base, databaseStatus: null })).toBe(false)
    expect(isNormalApplicationReady({ ...base, rootChildCount: 0, databaseStatus: "available" })).toBe(false)
  })
})

describe("stable Side Panel readiness gate", () => {
  it("does not pass when the database becomes unavailable during the stability window", async () => {
    let databaseStatus: "available" | "unavailable" = "available"
    let sidePanelPassed = false
    const unavailableSnapshot = {
      readyState: "complete",
      rootChildCount: 1,
      bodyChildCount: 2,
      databaseStatus: "unavailable",
    }

    await expect(runStableSidePanelReadinessGate({
      waitForMount: async () => {},
      stabilityWindow: async () => {
        databaseStatus = "unavailable"
      },
      hasFatal: () => false,
      failOnFatal: () => { throw new Error("fatal runtime exception") },
      readSnapshot: async () => ({
        ...unavailableSnapshot,
        databaseStatus,
      }),
      isReady: (snapshot) => snapshot.databaseStatus === "available",
      failOnNotReady: (snapshot) => {
        throw new Error(`Side Panel unavailable: ${snapshot.databaseStatus}`)
      },
    }).then(() => {
      sidePanelPassed = true
    })).rejects.toThrow("Side Panel unavailable: unavailable")

    expect(sidePanelPassed).toBe(false)
  })
})
