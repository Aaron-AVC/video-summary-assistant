import { describe, expect, it } from "bun:test"

import { createSearchRepository } from "@/features/search/lib/search-repository"

function table(rows: unknown[]) {
  return { toArray: async () => rows }
}

function buildRun(id: string, status: "completed" | "draft") {
  return {
    id,
    videoId: "video-a",
    platform: "youtube",
    contentKey: "youtube:video-a",
    partId: null,
    transcriptSnapshotId: "snapshot-1",
    providerConfigId: null,
    status,
    summary: "summary",
    keyPoints: [{ text: "point" }],
    topics: [{ label: "topic" }],
    errorMessage: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completedAt: status === "completed" ? "2026-01-01T00:00:00.000Z" : null,
  }
}

function buildSegment(analysisRunId: string, id = `segment-${analysisRunId}`) {
  return {
    id,
    analysisRunId,
    videoId: "video-a",
    title: "segment",
    summary: "summary",
    startSec: 1,
    endSec: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

function buildMessage(id: string, threadId: string, sequence: number) {
  return {
    id,
    threadId,
    sequence,
    role: "assistant",
    content: `message ${sequence}`,
    createdAt: "2026-01-01T00:00:00.000Z",
  }
}

describe("search repository candidate loading", () => {
  it("keeps only completed analysis runs and their segments", async () => {
    const repository = createSearchRepository({
      analysisRuns: table([buildRun("completed-run", "completed"), buildRun("draft-run", "draft")]),
      segmentSummaries: table([
        buildSegment("completed-run", "segment-a"),
        buildSegment("completed-run", "segment-b"),
        buildSegment("draft-run"),
      ]),
    })

    const candidates = await repository.loadCandidates()

    expect(candidates.analysisRuns.map((run) => run.id)).toEqual(["completed-run"])
    expect(candidates.segmentsByRunId.get("completed-run")).toHaveLength(2)
    expect(candidates.segmentsByRunId.has("draft-run")).toBe(false)
  })

  it("drops rows that no longer satisfy the persisted contract", async () => {
    const repository = createSearchRepository({
      analysisRuns: table([buildRun("good-run", "completed"), { id: "broken" }]),
    })

    const candidates = await repository.loadCandidates()

    expect(candidates.analysisRuns.map((run) => run.id)).toEqual(["good-run"])
  })

  it("returns empty candidates when optional stores are absent", async () => {
    const repository = createSearchRepository({})

    const candidates = await repository.loadCandidates()

    expect(candidates.analysisRuns).toEqual([])
    expect(candidates.knowledgeItems).toEqual([])
    expect(candidates.qaThreads).toEqual([])
    expect(candidates.videoRecords).toEqual([])
    expect(candidates.segmentsByRunId.size).toBe(0)
    expect(candidates.qaMessagesByThreadId.size).toBe(0)
  })

  it("orders QA messages by their persisted sequence", async () => {
    const repository = createSearchRepository({
      qaMessages: table([
        buildMessage("m3", "thread-1", 3),
        buildMessage("m1", "thread-1", 1),
        buildMessage("m2", "thread-1", 2),
      ]),
    })

    const candidates = await repository.loadCandidates()

    expect(candidates.qaMessagesByThreadId.get("thread-1")?.map((message) => message.sequence))
      .toEqual([1, 2, 3])
  })
})
