import { describe, expect, it } from "bun:test"

import { loadWorkspaceBranches } from "@/sidepanel/workspace/workspace-bootstrap"

describe("Side Panel workspace bootstrap", () => {
  it("preserves fulfilled Settings reads when history rejects", async () => {
    const result = await loadWorkspaceBranches({
      loadProvider: async () => ["provider-a"],
      loadRecent: async () => { throw new DOMException("closed", "UnknownError") },
      loadPreset: async () => "focused",
    })
    expect(result.provider).toEqual({ status: "fulfilled", value: ["provider-a"] })
    expect(result.recent.status).toBe("rejected")
    expect(result.preset).toEqual({ status: "fulfilled", value: "focused" })
  })

  it("keeps an empty history as a successful result", async () => {
    const result = await loadWorkspaceBranches({
      loadProvider: async () => [],
      loadRecent: async () => [],
      loadPreset: async () => "default",
    })
    expect(result.recent).toEqual({ status: "fulfilled", value: [] })
  })

  it("reports a current IndexedDB failure to the database availability owner", async () => {
    const databaseError = new DOMException("closed", "UnknownError")
    const databaseFailures: unknown[] = []
    const historyFailures: unknown[] = []
    const result = await loadWorkspaceBranches({
      loadProvider: async () => [],
      loadRecent: async () => { throw databaseError },
      loadPreset: async () => "default",
    }, {
      isRecentCurrent: () => true,
      onDatabaseFailure: (error: unknown) => databaseFailures.push(error),
      onHistoryFailure: (error: unknown) => historyFailures.push(error),
    })

    expect(result.recent.status).toBe("rejected")
    expect(databaseFailures).toEqual([databaseError])
    expect(historyFailures).toEqual([])
  })

  it("does not report unrelated history read failures as database outages", async () => {
    const historyError = new TypeError("invalid repository response")
    const databaseFailures: unknown[] = []
    const historyFailures: unknown[] = []
    const result = await loadWorkspaceBranches({
      loadProvider: async () => [],
      loadRecent: async () => { throw historyError },
      loadPreset: async () => "default",
    }, {
      isRecentCurrent: () => true,
      onDatabaseFailure: (error: unknown) => databaseFailures.push(error),
      onHistoryFailure: (error: unknown) => historyFailures.push(error),
    })

    expect(result.recent.status).toBe("rejected")
    expect(databaseFailures).toEqual([])
    expect(historyFailures).toEqual([historyError])
  })

  it("does not report a database failure after its workspace generation becomes stale", async () => {
    const databaseError = new DOMException("closed", "UnknownError")
    const failures: unknown[] = []
    let isCurrent = true
    const result = await loadWorkspaceBranches({
      loadProvider: async () => [],
      loadRecent: async () => {
        isCurrent = false
        throw databaseError
      },
      loadPreset: async () => "default",
    }, {
      isRecentCurrent: () => isCurrent,
      onDatabaseFailure: (error: unknown) => failures.push(error),
      onHistoryFailure: (error: unknown) => failures.push(error),
    })

    expect(result.recent.status).toBe("rejected")
    expect(failures).toEqual([])
  })
})
