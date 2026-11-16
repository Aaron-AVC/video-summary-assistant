import { describe, expect, it } from "bun:test"

import { createHistoryRepository } from "@/features/history/lib/history-repository"
import { PersistenceError } from "@/lib/db/errors"
import { MAX_TRANSCRIPT_CUES } from "@/lib/schemas/container-limits"
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
  bulkPutBatchSizes: number[] = []
  readBarrier: ((rows: T[]) => Promise<void>) | null = null

  async toArray() {
    return this.readRows(0, this.rows.length)
  }

  private async readRows(offset: number, limit: number) {
    const snapshot = this.rows.slice(offset, offset + limit)
    await this.readBarrier?.(snapshot)
    return snapshot
  }

  async put(row: T) {
    if (this.putShouldThrow) {
      throw this.putShouldThrow
    }
    const key = this.keyOf(row)
    const existingIndex = this.rows.findIndex((existing) => this.matchesKey(existing, key))
    if (existingIndex >= 0) this.rows[existingIndex] = row
    else this.rows.push(row)
  }

  async bulkPut(rows: T[]) {
    this.bulkPutBatchSizes.push(rows.length)
    for (const row of rows) {
      await this.put(row)
    }
  }

  toCollection() {
    return {
      offset: (offset: number) => ({
        limit: (limit: number) => ({
          toArray: async () => this.readRows(offset, limit)
        })
      })
    }
  }

  async bulkDelete(keys: string[]) {
    const set = new Set(keys)
    this.rows = this.rows.filter((row) => ![...set].some((key) => this.matchesKey(row, key)))
  }

  async get(key: string) {
    return this.rows.find((row) => this.matchesKey(row, key))
  }

  async delete(key: string) {
    this.rows = this.rows.filter((row) => !this.matchesKey(row, key))
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

  private keyOf(row: T) {
    const value = row as T & { cacheKey?: string; contentKey?: string }
    return (value.id ?? value.cacheKey ?? value.videoId ?? value.contentKey) as string
  }

  private matchesKey(row: T, key: string) {
    const value = row as T & { cacheKey?: string; contentKey?: string }
    return value.videoId === key || value.id === key || value.cacheKey === key || value.contentKey === key
  }
}

function buildFakeDatabase() {
  const providerConfigs = new FakeTable<Row>()
  const transcriptSnapshots = new FakeTable<TranscriptSnapshotEntity & Row>()
  const analysisRuns = new FakeTable<AnalysisRunEntity & Row>()
  const segmentSummaries = new FakeTable<SegmentSummaryEntity & Row>()
  const recentVideos = new FakeTable<RecentVideoEntity & Row>()
  const videoRecords = new FakeTable<any>()
  const transcriptCache = new FakeTable<any>()
  const analysisCache = new FakeTable<any>()
  const qaThreads = new FakeTable<any>()
  const qaMessages = new FakeTable<any>()
  const qaAnswers = new FakeTable<any>()
  const knowledgeItems = new FakeTable<any>()

  return {
    providerConfigs,
    transcriptSnapshots,
    analysisRuns,
    segmentSummaries,
    recentVideos,
    videoRecords,
    transcriptCache,
    analysisCache,
    qaThreads,
    qaMessages,
    qaAnswers,
    knowledgeItems,
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

  it("persists transcript caches and analysis snapshots without fetch URLs", async () => {
    const fake = buildFakeDatabase()
    const repo = createHistoryRepository(fake as never, {
      transcriptRawVttRetentionDays: 0,
      runTransaction: passthroughTransaction
    })
    const signedUrl = "https://www.youtube.com/api/timedtext?v=video&signature=SECRET_TEST_VALUE&pot=SECRET_TEST_TOKEN"
    const cache = await repo.saveTranscriptCache({
      id: "cache-safe",
      contentKey: "youtube:video",
      platform: "youtube",
      videoId: "video",
      partId: null,
      fingerprint: "fp-safe",
      fingerprintVersion: 2,
      language: "en",
      sourceUrl: signedUrl,
      rawVtt: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nCue",
      cues: [{ startSec: 0, endSec: 1, text: "Cue" }],
      createdAt: NOW,
      updatedAt: NOW
    })
    await repo.saveTranscriptSnapshot({
      id: "snapshot-safe",
      videoId: "video",
      platform: "youtube",
      contentKey: "youtube:video",
      partId: null,
      fingerprint: "fp-safe",
      language: "en",
      sourceUrl: signedUrl,
      rawVtt: "WEBVTT snapshot",
      cues: [{ startSec: 0, endSec: 1, text: "Cue" }],
      createdAt: NOW,
      updatedAt: NOW
    })

    expect(cache.sourceUrl).toBeNull()
    expect(fake.transcriptCache.rows[0]?.sourceUrl).toBeNull()
    expect(fake.transcriptSnapshots.rows[0]?.sourceUrl).toBeNull()
    expect(fake.transcriptCache.rows[0]?.rawVtt).toContain("Cue")
    expect(fake.transcriptSnapshots.rows[0]?.cues).toEqual([{ startSec: 0, endSec: 1, text: "Cue" }])
  })

  it("reuses old cache cues while hiding its stored fetch URL", async () => {
    const fake = buildFakeDatabase()
    fake.transcriptCache.rows.push({
      id: "cache-legacy",
      contentKey: "youtube:video",
      platform: "youtube",
      videoId: "video",
      partId: null,
      fingerprint: "fp-legacy",
      fingerprintVersion: 2,
      language: "en",
      sourceUrl: "https://www.youtube.com/api/timedtext?v=video&signature=SECRET_TEST_VALUE&pot=SECRET_TEST_TOKEN",
      rawVtt: "WEBVTT cached cue",
      cues: [{ startSec: 0, endSec: 1, text: "Cached cue" }],
      createdAt: NOW,
      updatedAt: NOW
    })
    const repo = createHistoryRepository(fake as never, { runTransaction: passthroughTransaction })

    const reused = await repo.getLatestTranscriptByContentKey("youtube:video")

    expect(reused?.sourceUrl).toBeNull()
    expect(reused?.rawVtt).toBe("WEBVTT cached cue")
    expect(reused?.cues).toEqual([{ startSec: 0, endSec: 1, text: "Cached cue" }])
  })

  it("sanitizes legacy source URLs in the export projection without mutating stored data", async () => {
    const fake = buildFakeDatabase()
    const signedUrl = "https://www.youtube.com/api/timedtext?v=video&signature=SECRET_TEST_VALUE&pot=SECRET_TEST_TOKEN"
    const snapshot: TranscriptSnapshotEntity = {
      id: "snapshot-legacy",
      videoId: "video-current",
      platform: "youtube",
      contentKey: "youtube:video-current",
      partId: null,
      fingerprint: "fp-current",
      language: "en",
      sourceUrl: signedUrl,
      rawVtt: "WEBVTT preserved snapshot",
      cues: [{ startSec: 0, endSec: 1, text: "Preserved cue" }],
      createdAt: NOW,
      updatedAt: NOW
    }
    fake.transcriptSnapshots.rows.push(snapshot)
    for (let index = 0; index < 205; index += 1) {
      fake.transcriptCache.rows.push({
        id: `cache-${index}`,
        contentKey: `youtube:video-${index}`,
        platform: "youtube",
        videoId: `video-${index}`,
        partId: null,
        fingerprint: `fp-${index}`,
        fingerprintVersion: 2,
        language: "en",
        sourceUrl: signedUrl,
        rawVtt: `WEBVTT cache ${index}`,
        cues: [{ startSec: 0, endSec: 1, text: `Cue ${index}` }],
        createdAt: NOW,
        updatedAt: NOW
      })
    }
    fake.analysisRuns.rows.push(buildAnalysisRun())
    fake.segmentSummaries.rows.push({
      id: "segment-current",
      analysisRunId: "run-current",
      videoId: "video-current",
      contentKey: "youtube:video-current",
      title: "Chapter",
      summary: "Summary",
      startSec: 0,
      endSec: 1,
      createdAt: NOW,
      updatedAt: NOW
    })
    fake.qaThreads.rows.push({
      id: "thread-current",
      contentKey: "youtube:video-current",
      platform: "youtube",
      videoId: "video-current",
      partId: null,
      title: "Question",
      analysisRunId: "run-current",
      transcriptFingerprint: "fp-current",
      providerProfileId: "provider",
      providerBaseUrl: "https://api.example.com/v1",
      providerModel: "model",
      createdAt: NOW,
      updatedAt: NOW
    })
    fake.qaMessages.rows.push({
      id: "message-current",
      threadId: "thread-current",
      sequence: 0,
      role: "user",
      content: "Question",
      createdAt: NOW
    })
    const repo = createHistoryRepository(fake as never, { runTransaction: passthroughTransaction })

    const exported = await repo.exportLocalData()
    const json = JSON.stringify(exported)

    expect(json).not.toContain("SECRET_TEST_VALUE")
    expect(json).not.toContain("SECRET_TEST_TOKEN")
    expect(exported.transcriptSnapshots[0]?.sourceUrl).toBeNull()
    expect(exported.transcriptSnapshots[0]?.rawVtt).toBe("WEBVTT preserved snapshot")
    expect(exported.transcriptCache).toHaveLength(205)
    expect(exported.transcriptCache.every((row) => row.sourceUrl === null)).toBe(true)
    expect(fake.transcriptSnapshots.rows[0]?.sourceUrl).toBe(signedUrl)
    expect(fake.transcriptCache.rows.every((row) => row.sourceUrl === signedUrl)).toBe(true)
    expect(fake.transcriptCache.bulkPutBatchSizes).toEqual([])
    expect(exported.analysisRuns).toHaveLength(1)
    expect(exported.segmentSummaries).toHaveLength(1)
    expect(exported.qaThreads).toHaveLength(1)
    expect(exported.qaMessages).toHaveLength(1)
  })

  it("does not recreate a transcript cache deleted while its sanitized export read is pending", async () => {
    const fake = buildFakeDatabase()
    const signedUrl = "https://www.youtube.com/api/timedtext?v=video&signature=SECRET_TEST_VALUE&pot=SECRET_TEST_TOKEN"
    fake.transcriptSnapshots.rows.push({
      id: "snapshot-deleted-during-export",
      videoId: "video",
      platform: "youtube",
      contentKey: "youtube:video",
      partId: null,
      fingerprint: "fp-video",
      language: "en",
      sourceUrl: signedUrl,
      rawVtt: "WEBVTT cue",
      cues: [{ startSec: 0, endSec: 1, text: "Cue" }],
      createdAt: NOW,
      updatedAt: NOW
    })
    fake.transcriptCache.rows.push({
      id: "cache-deleted-during-export",
      contentKey: "youtube:video",
      platform: "youtube",
      videoId: "video",
      partId: null,
      fingerprint: "fp-video",
      fingerprintVersion: 2,
      language: "en",
      sourceUrl: signedUrl,
      rawVtt: "WEBVTT cue",
      cues: [{ startSec: 0, endSec: 1, text: "Cue" }],
      createdAt: NOW,
      updatedAt: NOW
    })

    let signalRead!: () => void
    let releaseRead!: () => void
    const readReached = new Promise<void>((resolve) => { signalRead = resolve })
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve })
    let blockedFirstRead = false
    fake.transcriptCache.readBarrier = async () => {
      if (blockedFirstRead) return
      blockedFirstRead = true
      signalRead()
      await readGate
    }
    const repo = createHistoryRepository(fake as never, { runTransaction: passthroughTransaction })

    const exporting = repo.exportLocalData()
    await readReached
    await fake.transcriptSnapshots.clear()
    await fake.transcriptCache.clear()
    releaseRead()
    const exported = await exporting

    expect(fake.transcriptSnapshots.rows).toEqual([])
    expect(fake.transcriptCache.rows).toEqual([])
    expect(exported.transcriptSnapshots[0]?.sourceUrl).toBeNull()
    expect(exported.transcriptCache[0]?.sourceUrl).toBeNull()
    expect(JSON.stringify(exported)).not.toContain("SECRET_TEST_VALUE")
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

describe("historyRepository granular deletion", () => {
  function seedRun(
    id: string,
    contentKey: string,
    videoId: string,
    cacheKey: string,
  ): AnalysisRunEntity {
    return {
      ...buildAnalysisRun(),
      id,
      videoId,
      contentKey,
      platform: contentKey.startsWith("bilibili:") ? "bilibili" : "youtube",
      partId: contentKey.includes(":p:") ? contentKey.split(":p:")[1] ?? null : null,
      analysisCacheKey: cacheKey,
      transcriptSnapshotId: `snapshot-${id}`,
      updatedAt: id === "run-b" ? "2026-05-05T12:00:00.000Z" : NOW,
      completedAt: id === "run-b" ? "2026-05-05T12:00:00.000Z" : NOW,
    }
  }

  function seedDependentRows(fake: ReturnType<typeof buildFakeDatabase>, run: AnalysisRunEntity) {
    fake.segmentSummaries.rows.push({
      id: `segment-${run.id}`,
      analysisRunId: run.id,
      videoId: run.videoId,
      title: "Segment",
      summary: "Summary",
      startSec: 0,
      endSec: 1,
      createdAt: NOW,
      updatedAt: NOW,
    })
    fake.analysisCache.rows.push({
      cacheKey: run.analysisCacheKey,
      contentKey: run.contentKey,
      analysisRunId: run.id,
    })
    fake.qaAnswers.rows.push({
      cacheKey: `answer-${run.id}`,
      contentKey: run.contentKey,
      analysisRunId: run.id,
    })
    fake.qaThreads.rows.push({
      id: `thread-${run.id}`,
      contentKey: run.contentKey,
      analysisRunId: run.id,
    })
    fake.qaMessages.rows.push({
      id: `message-${run.id}`,
      threadId: `thread-${run.id}`,
    })
    fake.recentVideos.rows.push({
      videoId: run.videoId,
      analysisRunId: run.id,
      contentKey: run.contentKey,
      title: run.videoId,
      channelTitle: null,
      thumbnailUrl: null,
      status: "completed",
      updatedAt: run.updatedAt,
      openedAt: run.createdAt,
      analyzedAt: run.completedAt,
    })
  }

  it("deletes one run and its dependent analysis/Ask rows while preserving another run and shared transcript", async () => {
    const fake = buildFakeDatabase()
    const runA = seedRun("run-a", "youtube:video-a", "video-a", "cache-a")
    const runB = seedRun("run-b", "youtube:video-b", "video-b", "cache-b")
    fake.analysisRuns.rows.push(runA, runB)
    seedDependentRows(fake, runA)
    seedDependentRows(fake, runB)
    fake.transcriptCache.rows.push({ id: "transcript-a", contentKey: runA.contentKey, fingerprint: "fp-a" })
    fake.videoRecords.rows.push({ contentKey: runA.contentKey, videoId: runA.videoId })

    const repo = createHistoryRepository(fake as never, { runTransaction: passthroughTransaction })
    await repo.deleteAnalysisRun(runA.id)

    expect(fake.analysisRuns.rows.map((row) => row.id)).toEqual([runB.id])
    expect(fake.segmentSummaries.rows.map((row) => row.analysisRunId)).toEqual([runB.id])
    expect(fake.analysisCache.rows.map((row) => row.cacheKey)).toEqual([runB.analysisCacheKey])
    expect(fake.qaAnswers.rows.map((row) => row.analysisRunId)).toEqual([runB.id])
    expect(fake.qaThreads.rows.map((row) => row.analysisRunId)).toEqual([runB.id])
    expect(fake.qaMessages.rows.map((row) => row.threadId)).toEqual([`thread-${runB.id}`])
    expect(fake.transcriptCache.rows).toHaveLength(1)
    expect(fake.videoRecords.rows).toHaveLength(1)
  })

  it("does not resurrect a deleted run through legacy recentVideos", async () => {
    const fake = buildFakeDatabase()
    const run = seedRun("run-a", "youtube:video-a", "video-a", "cache-a")
    fake.analysisRuns.rows.push(run)
    seedDependentRows(fake, run)
    const repo = createHistoryRepository(fake as never, { runTransaction: passthroughTransaction })

    await repo.deleteAnalysisRun(run.id)

    expect(await repo.listRecentAnalyses()).toHaveLength(0)
  })

  it("deletes all data for one Bilibili part while preserving the other part", async () => {
    const fake = buildFakeDatabase()
    const part1 = seedRun("run-p1", "bilibili:BV1:p:1", "BV1", "cache-p1")
    const part2 = seedRun("run-p2", "bilibili:BV1:p:2", "BV1", "cache-p2")
    fake.analysisRuns.rows.push(part1, part2)
    seedDependentRows(fake, part1)
    seedDependentRows(fake, part2)
    fake.transcriptCache.rows.push(
      { id: "transcript-p1", contentKey: part1.contentKey },
      { id: "transcript-p2", contentKey: part2.contentKey },
    )
    fake.videoRecords.rows.push(
      { contentKey: part1.contentKey, videoId: "BV1", partId: "1" },
      { contentKey: part2.contentKey, videoId: "BV1", partId: "2" },
    )
    fake.transcriptSnapshots.rows.push(
      {
        id: "snapshot-p1",
        videoId: "BV1",
        contentKey: part1.contentKey,
        language: "zh",
        sourceUrl: null,
        rawVtt: null,
        cues: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "snapshot-p2",
        videoId: "BV1",
        contentKey: part2.contentKey,
        language: "zh",
        sourceUrl: null,
        rawVtt: null,
        cues: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    )

    const repo = createHistoryRepository(fake as never, { runTransaction: passthroughTransaction })
    await repo.deleteVideoData(part1.contentKey!)

    expect(fake.analysisRuns.rows.map((row) => row.id)).toEqual([part2.id])
    expect(fake.transcriptCache.rows.map((row) => row.contentKey)).toEqual([part2.contentKey])
    expect(fake.videoRecords.rows.map((row) => row.contentKey)).toEqual([part2.contentKey])
    expect(fake.transcriptSnapshots.rows.map((row) => row.contentKey)).toEqual([part2.contentKey])
    expect(fake.qaThreads.rows.map((row) => row.contentKey)).toEqual([part2.contentKey])
  })

  it("keeps providers and transcript cache when clearing analysis history", async () => {
    const fake = buildFakeDatabase()
    const run = seedRun("run-a", "youtube:video-a", "video-a", "cache-a")
    fake.analysisRuns.rows.push(run)
    fake.analysisCache.rows.push({ cacheKey: "cache-a" })
    fake.transcriptCache.rows.push({ id: "transcript-a", contentKey: run.contentKey })
    fake.providerConfigs.rows.push({ id: "provider-a" })

    const repo = createHistoryRepository(fake as never, { runTransaction: passthroughTransaction })
    await repo.clearAnalysisHistory()

    expect(fake.analysisRuns.rows).toHaveLength(0)
    expect(fake.analysisCache.rows).toHaveLength(0)
    expect(fake.transcriptCache.rows).toHaveLength(1)
    expect(fake.providerConfigs.rows).toHaveLength(1)
  })

  it("clears conversations and transcript cache independently", async () => {
    const fake = buildFakeDatabase()
    fake.qaAnswers.rows.push({ cacheKey: "answer-a" })
    fake.qaThreads.rows.push({ id: "thread-a" })
    fake.qaMessages.rows.push({ id: "message-a", threadId: "thread-a" })
    fake.analysisRuns.rows.push(seedRun("run-a", "youtube:video-a", "video-a", "cache-a"))
    fake.transcriptCache.rows.push({ id: "transcript-a", contentKey: "youtube:video-a" })
    const repo = createHistoryRepository(fake as never, { runTransaction: passthroughTransaction })

    await repo.clearQaData()
    expect(fake.qaAnswers.rows).toHaveLength(0)
    expect(fake.qaThreads.rows).toHaveLength(0)
    expect(fake.qaMessages.rows).toHaveLength(0)
    expect(fake.analysisRuns.rows).toHaveLength(1)

    await repo.clearTranscriptCache()
    expect(fake.transcriptCache.rows).toHaveLength(0)
    expect(fake.analysisRuns.rows).toHaveLength(1)
  })
})

describe("knowledge destructive semantics", () => {
  function seedRun(
    id: string,
    contentKey: string,
    videoId: string,
    cacheKey: string
  ): AnalysisRunEntity {
    return {
      ...buildAnalysisRun(),
      id,
      videoId,
      contentKey,
      cacheKey
    } as AnalysisRunEntity
  }

  function seedKnowledge(fake: ReturnType<typeof buildFakeDatabase>) {
    fake.knowledgeItems.rows.push({
      id: "knowledge-a",
      kind: "bookmark",
      contentKey: "youtube:video-a",
      platform: "youtube",
      videoId: "video-a",
      partId: null,
      videoTitle: "A",
      analysisRunId: null,
      startSec: 5,
      endSec: 5,
      text: null,
      createdAt: NOW,
      updatedAt: NOW
    })
    fake.knowledgeItems.rows.push({
      id: "knowledge-b",
      kind: "note",
      contentKey: "youtube:video-b",
      platform: "youtube",
      videoId: "video-b",
      partId: null,
      videoTitle: "B",
      analysisRunId: null,
      startSec: null,
      endSec: null,
      text: "keep me",
      createdAt: NOW,
      updatedAt: NOW
    })
  }

  it("preserves knowledge when deleting an analysis run", async () => {
    const fake = buildFakeDatabase()
    const run = seedRun("run-a", "youtube:video-a", "video-a", "cache-a")
    fake.analysisRuns.rows.push(run)
    seedKnowledge(fake)

    const repo = createHistoryRepository(fake as never, { runTransaction: passthroughTransaction })
    await repo.deleteAnalysisRun(run.id)

    expect(fake.analysisRuns.rows).toHaveLength(0)
    expect(fake.knowledgeItems.rows).toHaveLength(2)
  })

  it("preserves knowledge when clearing analysis history, conversations and transcript cache", async () => {
    const fake = buildFakeDatabase()
    fake.analysisRuns.rows.push(seedRun("run-a", "youtube:video-a", "video-a", "cache-a"))
    fake.qaThreads.rows.push({ id: "thread-a", contentKey: "youtube:video-a" })
    fake.transcriptCache.rows.push({ id: "transcript-a", contentKey: "youtube:video-a" })
    seedKnowledge(fake)

    const repo = createHistoryRepository(fake as never, { runTransaction: passthroughTransaction })
    await repo.clearAnalysisHistory()
    await repo.clearQaData()
    await repo.clearTranscriptCache()

    expect(fake.knowledgeItems.rows).toHaveLength(2)
  })

  it("deletes only the matching contentKey on deleteVideoData", async () => {
    const fake = buildFakeDatabase()
    seedKnowledge(fake)

    const repo = createHistoryRepository(fake as never, { runTransaction: passthroughTransaction })
    await repo.deleteVideoData("youtube:video-a")

    expect(fake.knowledgeItems.rows.map((row) => row.id)).toEqual(["knowledge-b"])
  })

  it("keeps Bilibili p2 knowledge when deleting p1", async () => {
    const fake = buildFakeDatabase()
    fake.knowledgeItems.rows.push({
      id: "knowledge-p1",
      kind: "bookmark",
      contentKey: "bilibili:BV1xx:p:1",
      platform: "bilibili",
      videoId: "BV1xx",
      partId: "1",
      videoTitle: "P1",
      analysisRunId: null,
      startSec: 1,
      endSec: 1,
      text: null,
      createdAt: NOW,
      updatedAt: NOW
    })
    fake.knowledgeItems.rows.push({
      id: "knowledge-p2",
      kind: "bookmark",
      contentKey: "bilibili:BV1xx:p:2",
      platform: "bilibili",
      videoId: "BV1xx",
      partId: "2",
      videoTitle: "P2",
      analysisRunId: null,
      startSec: 1,
      endSec: 1,
      text: null,
      createdAt: NOW,
      updatedAt: NOW
    })

    const repo = createHistoryRepository(fake as never, { runTransaction: passthroughTransaction })
    await repo.deleteVideoData("bilibili:BV1xx:p:1")

    expect(fake.knowledgeItems.rows.map((row) => row.id)).toEqual(["knowledge-p2"])
  })

  it("clears every knowledge item on clear all and exports them beforehand", async () => {
    const fake = buildFakeDatabase()
    seedKnowledge(fake)

    const repo = createHistoryRepository(fake as never, { runTransaction: passthroughTransaction })
    const exported = await repo.exportLocalData()
    expect(exported.knowledgeItems).toHaveLength(2)
    expect(exported.knowledgeItems?.[1]).toMatchObject({
      id: "knowledge-b",
      contentKey: "youtube:video-b",
      text: "keep me"
    })

    await repo.clearAll()
    expect(fake.knowledgeItems.rows).toHaveLength(0)
  })
})

describe("historyRepository transcript snapshot write validation", () => {
  function buildSnapshot(overrides: Partial<TranscriptSnapshotEntity> = {}): TranscriptSnapshotEntity {
    return {
      id: "snapshot-write-1",
      videoId: "video-write-1",
      platform: "youtube",
      contentKey: "youtube:video-write-1",
      partId: null,
      fingerprint: null,
      language: "en",
      sourceUrl: null,
      rawVtt: null,
      cues: [{ startSec: 0, endSec: 1, text: "Cue" }],
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides
    }
  }

  it("rejects a transcript snapshot whose cue count exceeds the persisted ceiling", async () => {
    const fake = buildFakeDatabase()
    const repo = createHistoryRepository(fake as never, { runTransaction: passthroughTransaction })
    const snapshot = buildSnapshot({
      cues: Array.from({ length: MAX_TRANSCRIPT_CUES + 1 }, (_unused, index) => ({
        startSec: index,
        endSec: index + 1,
        text: `Cue ${index}`
      }))
    })

    await expect(repo.saveTranscriptSnapshot(snapshot)).rejects.toThrow()
    expect(fake.transcriptSnapshots.rows).toHaveLength(0)
  })

  it("still stores a transcript snapshot that fits under the ceiling", async () => {
    const fake = buildFakeDatabase()
    const repo = createHistoryRepository(fake as never, { runTransaction: passthroughTransaction })

    await repo.saveTranscriptSnapshot(buildSnapshot())

    expect(fake.transcriptSnapshots.rows).toHaveLength(1)
    expect(fake.transcriptSnapshots.rows[0]?.cues).toHaveLength(1)
  })
})
