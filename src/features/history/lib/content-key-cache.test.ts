import { describe, expect, it } from "bun:test"

import { createHistoryRepository } from "@/features/history/lib/history-repository"
import type {
  AnalysisCacheEntity,
  QaAnswerEntity,
  TranscriptCacheEntity,
  VideoRecordEntity
} from "@/lib/schemas/persistence"

class Table<T extends { [key: string]: unknown }> {
  rows: T[] = []
  async put(row: T) {
    const key = (row.cacheKey ?? row.contentKey ?? row.id) as string
    this.rows = this.rows.filter((item) => ((item.cacheKey ?? item.contentKey ?? item.id) as string) !== key)
    this.rows.push(row)
  }
  async toArray() { return [...this.rows] }
  async get(key: string) {
    return this.rows.find((row) => ((row.cacheKey ?? row.contentKey ?? row.id) as string) === key)
  }
  async clear() { this.rows = [] }
  where(field: string) {
    return { equals: (value: unknown) => ({ toArray: async () => this.rows.filter((row) => row[field] === value) }) }
  }
}

function database() {
  return {
    providerConfigs: new Table(),
    transcriptSnapshots: new Table(),
    analysisRuns: new Table(),
    segmentSummaries: new Table(),
    recentVideos: new Table(),
    videoRecords: new Table<VideoRecordEntity>(),
    transcriptCache: new Table<TranscriptCacheEntity>(),
    analysisCache: new Table<AnalysisCacheEntity>(),
    qaAnswers: new Table<QaAnswerEntity>(),
    transaction: async (_mode: string, _tables: unknown[], callback: () => Promise<unknown>) => callback()
  }
}

const time = "2026-10-10T00:00:00.000Z"
const analysis = {
  summary: "Summary",
  keyPoints: [{ text: "Point" }],
  chapters: [{ title: "Start", startSec: 0, endSec: 2, summary: "Short", detail: "Detail" }]
}

describe("content-key persistence repository", () => {
  it("isolates transcript and analysis cache rows by content key", async () => {
    const fake = database()
    const repo = createHistoryRepository(fake as never, { transcriptRawVttRetentionDays: 0 })
    await repo.saveTranscriptCache({
      id: "t-p1", contentKey: "bilibili:BV:p:1", platform: "bilibili", videoId: "BV", partId: "1",
      fingerprint: "fp-1", language: "zh", sourceUrl: null, rawVtt: null,
      cues: [{ startSec: 0, endSec: 1, text: "P1" }], createdAt: time, updatedAt: time
    })
    await repo.saveTranscriptCache({
      id: "t-p2", contentKey: "bilibili:BV:p:2", platform: "bilibili", videoId: "BV", partId: "2",
      fingerprint: "fp-2", language: "zh", sourceUrl: null, rawVtt: null,
      cues: [{ startSec: 0, endSec: 1, text: "P2" }], createdAt: time, updatedAt: time
    })
    expect((await repo.getLatestTranscriptByContentKey("bilibili:BV:p:1"))?.cues[0]?.text).toBe("P1")
    expect((await repo.getLatestTranscriptByContentKey("bilibili:BV:p:2"))?.cues[0]?.text).toBe("P2")

    const base: Omit<AnalysisCacheEntity, "cacheKey"> = {
      contentKey: "bilibili:BV:p:1", platform: "bilibili", videoId: "BV", partId: "1",
      transcriptFingerprint: "fp-1", analysisSchemaVersion: 1, analysisPromptVersion: "video-analysis-v2",
      providerProfileId: "provider", providerBaseUrl: "https://api.example.com/v1", providerModel: "model",
      analysisRunId: "run-1", analysis, createdAt: time, updatedAt: time
    }
    await repo.saveAnalysisCache({ ...base, cacheKey: "cache-p1" })
    await repo.saveAnalysisCache({ ...base, cacheKey: "cache-p2", contentKey: "bilibili:BV:p:2", partId: "2", analysisRunId: "run-2" })
    expect((await repo.getCurrentAnalysisByContentKey("bilibili:BV:p:1"))?.contentKey).toBe("bilibili:BV:p:1")
    expect((await repo.getCurrentAnalysisByContentKey("bilibili:BV:p:2"))?.contentKey).toBe("bilibili:BV:p:2")
  })

  it("ignores corrupt QA rows so the caller can re-request", async () => {
    const fake = database()
    fake.qaAnswers.rows.push({ cacheKey: "bad", answer: { answer: "missing citations" } } as never)
    const repo = createHistoryRepository(fake as never)
    expect(await repo.getQaAnswer("bad")).toBeNull()
  })

  it("keeps legacy YouTube rows readable through the contentKey authority", async () => {
    const fake = database()
    fake.transcriptSnapshots.rows.push({
      id: "legacy-transcript", videoId: "youtube-legacy", language: "en", sourceUrl: null,
      rawVtt: null, cues: [{ startSec: 0, endSec: 1, text: "legacy" }],
      createdAt: time, updatedAt: time
    })
    fake.analysisRuns.rows.push({
      id: "legacy-run", videoId: "youtube-legacy", transcriptSnapshotId: "legacy-transcript",
      providerConfigId: null, status: "completed", summary: "Legacy summary", keyPoints: [{ text: "Point" }],
      topics: [], errorMessage: null, createdAt: time, updatedAt: time, completedAt: time
    })
    const repo = createHistoryRepository(fake as never)
    expect((await repo.getLatestTranscriptByContentKey("youtube:youtube-legacy"))?.contentKey)
      .toBe("youtube:youtube-legacy")
    expect((await repo.getCurrentAnalysisByContentKey("youtube:youtube-legacy"))?.contentKey)
      .toBe("youtube:youtube-legacy")
  })
})
