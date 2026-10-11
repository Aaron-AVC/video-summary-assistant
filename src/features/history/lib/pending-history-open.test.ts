import { describe, expect, it } from "bun:test"

import { isPendingHistoryOpenPayload } from "@/features/history/lib/pending-history-open"

describe("pending history open identity", () => {
  it("accepts an exact analysisRunId alongside platform content identity", () => {
    expect(isPendingHistoryOpenPayload({
      videoId: "BV",
      contentKey: "bilibili:BV:p:2",
      analysisRunId: "run-p2",
      requestedAt: Date.now()
    })).toBe(true)
  })

  it("rejects malformed run identities", () => {
    expect(isPendingHistoryOpenPayload({
      videoId: "video",
      analysisRunId: 42,
      requestedAt: Date.now()
    })).toBe(false)
  })
})
