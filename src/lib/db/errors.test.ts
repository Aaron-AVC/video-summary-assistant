import { describe, expect, it } from "bun:test"

import { isDatabaseUnavailableError } from "@/lib/db/errors"

describe("database availability error classification", () => {
  it("recognizes Dexie close and IndexedDB open failures through wrappers", () => {
    expect(isDatabaseUnavailableError({ name: "DatabaseClosedError" })).toBe(true)
    expect(isDatabaseUnavailableError({
      name: "PersistenceError",
      cause: { name: "UnknownError" },
    })).toBe(true)
    expect(isDatabaseUnavailableError({ name: "TypeError", message: "bad request" })).toBe(false)
  })

  it("handles cyclic nested error causes", () => {
    const error: { name: string; cause?: unknown } = { name: "Error" }
    error.cause = error
    expect(isDatabaseUnavailableError(error)).toBe(false)
  })
})
