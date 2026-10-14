import { describe, expect, it } from "bun:test"

import { createHistoryRepository } from "@/features/history/lib/history-repository"
import { PersistenceError } from "@/lib/db/errors"
import type {
  AnalysisRunEntity,
  RecentVideoEntity,
  SegmentSummaryEntity,
  TranscriptSnapshotEntity
} from "@/lib/schemas/persistence"

const passthroughTransaction = async <T,>(
  _mode: "r" | "rw",
  _tables: unknown[],
  callback: () => Promise<T>
) => callback()

type Row = { videoId?: string; id?: string; updatedAt?: string; rawVtt?: string | null }

class FakeTable<T extends Row> {
  rows: T[] = []
  putShouldThrow: unknown = null

  async toArray() {
    return [...this.rows]
  }

  async put(row: T) {
    if (this.putShouldThrow) {
      throw this.putShouldThrow
    }
    const key = (row.videoId ?? row.id) as string
    this.rows = this.rows.filter((existing) => (existing.videoId ?? existing.id) !== key)
    this.rows.push(row)
  }

  async bulkPut(rows: T[]) {
    for (const row of rows) {
      await this.put(row)
    }
  }

  async bulkDelete(keys: string[]) {
    const set = new Set(keys)
    this.rows = this.rows.filter((row) => !set.has((row.videoId ?? row.id) as string))
  }

  async clear() {
    this.rows = []
  }

  where(field: string = "videoId") {
    return {
      equals: (value: unknown) => ({
        toArray: async () =>
          this.rows.filter((row) => (row as Record<string, unknown>)[field] === value)
      })
    }
  }
}

function buildFakeDatabase() {
  const providerConfigs = new FakeTable<Row>()
  const transcriptSnapshots = new FakeTable<TranscriptSnapshotEntity & Row>()
  const analysisRuns = new FakeTable<AnalysisRunEntity & Row>()
  const segmentSummaries = new FakeTable<SegmentSummaryEntity & Row>()
  const recentVideos = new FakeTable<RecentVideoEntity & Row>()
  const qaThreads = new FakeTable<any>()
  const qaMessages = new FakeTable<any>()
  const qaAnswers = new FakeTable<any>()

  return {
    providerConfigs,
    transcriptSnapshots,
    analysisRuns,
    segmentSummaries,
    recentVideos,
    qaThreads,
    qaMessages,
    qaAnswers,
    transaction: async (
      _mode: string,
      _tables: unknown[],
      callback: () => Promise<unknown>
    ) => callback()
  }
}

const NOW = "2026-05-04T12:00:00.000Z"

function buildAnalysisRun(): AnalysisRunEntity {
  return {
    id: "run-current",
    videoId: "video-current",
    transcriptSnapshotId: "snapshot-current",
    providerConfigId: "provider-1",
    status: "completed",
    summary: "summary",
    keyPoints: [],
    topics: [],
    errorMessage: null,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: NOW
  }
}

function buildRecentVideoSeed(index: number): RecentVideoEntity {
  // Older entries get older ISO timestamps so byNewest sorts deterministically.
  const updatedAt = new Date(2026, 0, 1, 0, 0, index).toISOString()
  return {
    videoId: `seed-${index.toString().padStart(4, "0")}`,
    title: `Seed ${index}`,
    channelTitle: "Channel",
    thumbnailUrl: null,
    status: "completed",
    updatedAt,
    openedAt: updatedAt,
    analyzedAt: updatedAt
  }
}

describe("historyRepository.saveAnalysisRun retention", () => {
  it("trims oldest recent videos beyond the configured limit", async () => {
    const fake = buildFakeDatabase()
    // Seed 200 dummy entries.
    for (let i = 0; i < 200; i += 1) {
      fake.recentVideos.rows.push(buildRecentVideoSeed(i))
    }

    const repo = createHistoryRepository(fake as never, {
      recentVideosRetentionLimit: 100,
      transcriptRawVttRetentionDays: 0,
      runTransaction: passthroughTransaction
    })

    await repo.saveAnalysisRun({
      analysisRun: buildAnalysisRun(),
      segments: [],
      recentVideo: {
        videoId: "video-current",
        title: "Current",
        channelTitle: null,
        thumbnailUrl: null,
        status: "completed",
        openedAt: NOW,
        analyzedAt: NOW
      }
    })

    expect(fake.recentVideos.rows).toHaveLength(100)
    // The just-saved entry must survive (it's the newest).
    expect(
      fake.recentVideos.rows.some((row) => row.videoId === "video-current")
    ).toBe(true)
    // The oldest seed (index 0) must have been evicted.
    expect(
      fake.recentVideos.rows.some((row) => row.videoId === "seed-0000")
    ).toBe(false)
  })
})

describe("historyRepository quota error surfacing", () => {
  it("surfaces QuotaExceededError as a structured PersistenceError on saveAnalysisRun", async () => {
    const fake = buildFakeDatabase()
    const quota = new DOMException("quota", "QuotaExceededError")
    fake.analysisRuns.putShouldThrow = quota

    const repo = createHistoryRepository(fake as never, {
      recentVideosRetentionLimit: 100,
      transcriptRawVttRetentionDays: 0,
      runTransaction: passthroughTransaction
    })

    let caught: unknown
    try {
      await repo.saveAnalysisRun({
        analysisRun: buildAnalysisRun(),
        segments: [],
        recentVideo: {
          videoId: "video-current",
          title: "Current",
          channelTitle: null,
          thumbnailUrl: null,
          status: "completed",
          openedAt: NOW,
          analyzedAt: NOW
        }
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(PersistenceError)
    expect((caught as PersistenceError).reason).toBe("quota_exceeded")
    expect((caught as PersistenceError).cause).toBe(quota)
  })

  it("surfaces QuotaExceededError on saveTranscriptSnapshot", async () => {
    const fake = buildFakeDatabase()
    const quota = new DOMException("quota", "QuotaExceededError")
    fake.transcriptSnapshots.putShouldThrow = quota

    const repo = createHistoryRepository(fake as never, {
      recentVideosRetentionLimit: 100,
      transcriptRawVttRetentionDays: 0,
      runTransaction: passthroughTransaction
    })

    let caught: unknown
    try {
      await repo.saveTranscriptSnapshot({
        id: "snap-1",
        videoId: "video-current",
        language: "en",
        sourceUrl: "https://www.youtube.com/watch?v=abc",
        rawVtt: "WEBVTT",
        cues: [{ startSec: 0, endSec: 1, text: "hi" }],
        createdAt: NOW,
        updatedAt: NOW
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(PersistenceError)
    expect((caught as PersistenceError).reason).toBe("quota_exceeded")
  })

  it("wraps non-quota errors as write_failed", async () => {
    const fake = buildFakeDatabase()
    fake.analysisRuns.putShouldThrow = new Error("disk gremlins")

    const repo = createHistoryRepository(fake as never, {
      recentVideosRetentionLimit: 100,
      transcriptRawVttRetentionDays: 0,
      runTransaction: passthroughTransaction
    })

    let caught: unknown
    try {
      await repo.saveAnalysisRun({
        analysisRun: buildAnalysisRun(),
        segments: [],
        recentVideo: {
          videoId: "video-current",
          title: "Current",
          channelTitle: null,
          thumbnailUrl: null,
          status: "completed",
          openedAt: NOW,
          analyzedAt: NOW
        }
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(PersistenceError)
    expect((caught as PersistenceError).reason).toBe("write_failed")
  })
})

describe("historyRepository.getLatestTranscriptSnapshotByVideoId", () => {
  it("returns the snapshot with the most recent updatedAt for the videoId", async () => {
    const fake = buildFakeDatabase()
    fake.transcriptSnapshots.rows.push(
      {
        id: "snap-old",
        videoId: "video-1",
        language: "en",
        sourceUrl: "https://example.com/old",
        rawVtt: "old",
        cues: [{ startSec: 0, endSec: 1, text: "hi" }],
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z"
      },
      {
        id: "snap-new",
        videoId: "video-1",
        language: "en",
        sourceUrl: "https://example.com/new",
        rawVtt: "new",
        cues: [{ startSec: 0, endSec: 1, text: "hi" }],
        createdAt: "2026-05-04T00:00:00.000Z",
        updatedAt: "2026-05-04T00:00:00.000Z"
      },
      {
        id: "snap-other-video",
        videoId: "video-2",
        language: "en",
        sourceUrl: "https://example.com/other",
        rawVtt: "other",
        cues: [{ startSec: 0, endSec: 1, text: "hi" }],
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z"
      }
    )

    const repo = createHistoryRepository(fake as never, {
      runTransaction: passthroughTransaction
    })

    const result = await repo.getLatestTranscriptSnapshotByVideoId("video-1")

    expect(result?.id).toBe("snap-new")
    expect(result?.rawVtt).toBe("new")
  })

  it("returns null when no snapshot matches the videoId", async () => {
    const fake = buildFakeDatabase()
    const repo = createHistoryRepository(fake as never, {
      runTransaction: passthroughTransaction
    })

    expect(await repo.getLatestTranscriptSnapshotByVideoId("missing")).toBeNull()
  })

  it("uses the [videoId+updatedAt] indexed query when available", async () => {
    // A fake that exposes the indexed between/reverse/first surface so we can
    // assert the repository takes the indexed path instead of falling back to
    // the full scan + JS sort.
    const calls: { lower: unknown; upper: unknown; reversed: boolean }[] = []
    const indexedFake = {
      transcriptSnapshots: {
        where: (index: string) => {
          if (index !== "[videoId+updatedAt]") {
            throw new Error(`Unexpected index: ${index}`)
          }
          return {
            between: (lower: unknown[], upper: unknown[]) => ({
              reverse: () => ({
                first: async () => {
                  calls.push({ lower, upper, reversed: true })
                  return {
                    id: "snap-indexed",
                    videoId: "video-1",
                    language: "en",
                    sourceUrl: "https://example.com/indexed",
                    rawVtt: "indexed",
                    cues: [],
                    createdAt: "2026-05-04T00:00:00.000Z",
                    updatedAt: "2026-05-04T00:00:00.000Z"
                  }
                }
              })
            })
          }
        }
      }
    }

    const repo = createHistoryRepository(indexedFake as never, {
      runTransaction: passthroughTransaction
    })

    const result = await repo.getLatestTranscriptSnapshotByVideoId("video-1")

    expect(result?.id).toBe("snap-indexed")
    expect(calls).toHaveLength(1)
    expect(calls[0]?.reversed).toBe(true)
    expect((calls[0]?.lower as unknown[])[0]).toBe("video-1")
    expect((calls[0]?.upper as unknown[])[0]).toBe("video-1")
  })
})

describe("historyRepository.saveTranscriptSnapshot rawVtt retention", () => {
  it("clears rawVtt for snapshots older than the retention window", async () => {
    const fake = buildFakeDatabase()
    const oldUpdatedAt = "2025-01-01T00:00:00.000Z"
    fake.transcriptSnapshots.rows.push({
      id: "snap-old",
      videoId: "video-old",
      language: "en",
      sourceUrl: "https://www.youtube.com/watch?v=old",
      rawVtt: "WEBVTT old",
      cues: [{ startSec: 0, endSec: 1, text: "hi" }],
      createdAt: oldUpdatedAt,
      updatedAt: oldUpdatedAt
    })

    const repo = createHistoryRepository(fake as never, {
      recentVideosRetentionLimit: 100,
      transcriptRawVttRetentionDays: 30,
      now: () => new Date("2026-05-04T00:00:00.000Z"),
      runTransaction: passthroughTransaction
    })

    await repo.saveTranscriptSnapshot({
      id: "snap-new",
      videoId: "video-new",
      language: "en",
      sourceUrl: "https://www.youtube.com/watch?v=new",
      rawVtt: "WEBVTT new",
      cues: [{ startSec: 0, endSec: 1, text: "hi" }],
      createdAt: "2026-05-04T00:00:00.000Z",
      updatedAt: "2026-05-04T00:00:00.000Z"
    })

    const oldSnapshot = fake.transcriptSnapshots.rows.find((row) => row.id === "snap-old")
    const newSnapshot = fake.transcriptSnapshots.rows.find((row) => row.id === "snap-new")

    expect(oldSnapshot).toBeDefined()
    expect(oldSnapshot?.rawVtt).toBeNull()
    // Cues remain intact so previously-saved analyses keep rendering.
    expect(oldSnapshot?.cues).toEqual([{ startSec: 0, endSec: 1, text: "hi" }])
    expect(newSnapshot?.rawVtt).toBe("WEBVTT new")
  })
})

describe("historyRepository Ask Video persistence", () => {
  it("exports and clears qaThreads and qaMessages without leaving cache rows", async () => {
    const fake = buildFakeDatabase()
    fake.qaThreads.rows.push({
      id: "thread-1",
      contentKey: "youtube:video",
      platform: "youtube",
      videoId: "video",
      partId: null,
      title: "Why?",
      analysisRunId: "run-1",
      transcriptFingerprint: "fp-1",
      providerProfileId: "provider",
      providerBaseUrl: "https://api.example.com/v1",
      providerModel: "model",
      createdAt: NOW,
      updatedAt: NOW
    })
    fake.qaMessages.rows.push({
      id: "message-1",
      threadId: "thread-1",
      sequence: 0,
      role: "user",
      content: "Why?",
      createdAt: NOW
    })
    fake.qaAnswers.rows.push({
      cacheKey: "qa-1",
      contentKey: "youtube:video",
      transcriptFingerprint: "fp-1",
      analysisRunId: "run-1",
      providerProfileId: "provider",
      providerBaseUrl: "https://api.example.com/v1",
      providerModel: "model",
      question: "Why?",
      schemaVersion: 1,
      promptVersion: "video-qa-v2",
      answer: {
        answer: "Because.",
        citations: [{ text: "Evidence", startSec: 1, endSec: 2 }],
        suggestedJumps: [],
        followUps: []
      },
      createdAt: NOW,
      updatedAt: NOW
    })

    const repo = createHistoryRepository(fake as never, { runTransaction: passthroughTransaction })
    const exported = await repo.exportLocalData()
    expect(exported.qaThreads).toHaveLength(1)
    expect(exported.qaMessages).toHaveLength(1)

    await repo.clearAll()
    expect(fake.qaThreads.rows).toHaveLength(0)
    expect(fake.qaMessages.rows).toHaveLength(0)
    expect(fake.qaAnswers.rows).toHaveLength(0)
  })
})
