import { describe, expect, it } from "bun:test"

import { createHistoryRepository } from "@/features/history/lib/history-repository"
import type {
  AnalysisCacheEntity,
  AnalysisRunEntity,
  QaAnswerEntity,
  SegmentSummaryEntity,
  TranscriptCacheEntity,
  VideoRecordEntity
} from "@/lib/schemas/persistence"

class Table<T extends { [key: string]: unknown }> {
  rows: T[] = []
  async put(row: T) {
    const key = (row.cacheKey ?? row.id ?? row.contentKey) as string
    this.rows = this.rows.filter((item) => ((item.cacheKey ?? item.id ?? item.contentKey) as string) !== key)
    this.rows.push(row)
  }
  async bulkPut(rows: T[]) { for (const row of rows) await this.put(row) }
  async toArray() { return [...this.rows] }
  async get(key: string) {
    return this.rows.find((row) => ((row.cacheKey ?? row.id ?? row.contentKey) as string) === key)
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

const passthroughTransaction = async <T,>(
  _mode: "r" | "rw",
  _tables: unknown[],
  callback: () => Promise<T>
) => callback()

function run(id: string, model: string, updatedAt: string, contentKey = "youtube:video"): AnalysisRunEntity {
  return {
    id,
    videoId: contentKey.startsWith("bilibili:") ? "BV" : "video",
    platform: contentKey.startsWith("bilibili:") ? "bilibili" : "youtube",
    contentKey,
    partId: contentKey.includes(":p:") ? contentKey.split(":p:")[1] : null,
    transcriptSnapshotId: `transcript-${id}`,
    providerConfigId: "provider",
    transcriptFingerprint: `fingerprint-${id}`,
    analysisSchemaVersion: 1,
    analysisPromptVersion: "video-analysis-v2",
    analysisCacheKey: `cache-${id}`,
    providerProfileId: "provider",
    providerBaseUrl: "https://api.example.com/v1",
    providerModel: model,
    status: "completed",
    summary: `Summary ${id}`,
    keyPoints: [{ text: `Point ${id}` }],
    topics: [],
    errorMessage: null,
    createdAt: updatedAt,
    updatedAt,
    completedAt: updatedAt
  }
}

function segment(runId: string, contentKey = "youtube:video"): SegmentSummaryEntity {
  return {
    id: `segment-${runId}`,
    analysisRunId: runId,
    videoId: contentKey.startsWith("bilibili:") ? "BV" : "video",
    contentKey,
    title: `Chapter ${runId}`,
    summary: `Chapter summary ${runId}`,
    detail: `Chapter detail ${runId}`,
    startSec: 0,
    endSec: 1,
    createdAt: time,
    updatedAt: time
  }
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

  it("keeps distinct transcript fingerprints and reuses the same fingerprint row", async () => {
    const fake = database()
    const repo = createHistoryRepository(fake as never, { transcriptRawVttRetentionDays: 0 })
    const base = {
      contentKey: "youtube:video", platform: "youtube" as const, videoId: "video", partId: null,
      language: "en", sourceUrl: null, rawVtt: null,
      createdAt: time, updatedAt: time
    }
    await repo.saveTranscriptCache({ ...base, id: "a", fingerprint: "fp-a", cues: [{ startSec: 0, endSec: 1, text: "A" }] })
    await repo.saveTranscriptCache({ ...base, id: "b", fingerprint: "fp-b", cues: [{ startSec: 0, endSec: 1, text: "B" }] })
    await repo.saveTranscriptCache({ ...base, id: "a-replacement", fingerprint: "fp-a", cues: [{ startSec: 0, endSec: 1, text: "A2" }] })

    expect(fake.transcriptCache.rows).toHaveLength(2)
    expect(fake.transcriptCache.rows.find((row) => row.fingerprint === "fp-a")?.cues[0]?.text).toBe("A2")
    expect(fake.transcriptCache.rows.find((row) => row.fingerprint === "fp-b")?.cues[0]?.text).toBe("B")
  })

  it("retains cached cues while clearing only stale raw VTT", async () => {
    const fake = database()
    const repo = createHistoryRepository(fake as never, {
      transcriptRawVttRetentionDays: 30,
      now: () => new Date("2026-10-10T00:00:00.000Z")
    })
    await repo.saveTranscriptCache({
      id: "old", contentKey: "youtube:old", platform: "youtube", videoId: "old", partId: null,
      fingerprint: "fp-old", language: "en", sourceUrl: null, rawVtt: "WEBVTT",
      cues: [{ startSec: 0, endSec: 1, text: "keep me" }],
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z"
    })
    await repo.saveTranscriptCache({
      id: "new", contentKey: "youtube:new", platform: "youtube", videoId: "new", partId: null,
      fingerprint: "fp-new", language: "en", sourceUrl: null, rawVtt: "WEBVTT new",
      cues: [{ startSec: 0, endSec: 1, text: "new" }],
      createdAt: time, updatedAt: time
    })

    expect(fake.transcriptCache.rows.find((row) => row.id === "old")?.rawVtt).toBeNull()
    expect(fake.transcriptCache.rows.find((row) => row.id === "old")?.cues[0]?.text).toBe("keep me")
  })

  it("ignores corrupt QA rows so the caller can re-request", async () => {
    const fake = database()
    fake.qaAnswers.rows.push({ cacheKey: "bad", answer: { answer: "missing citations" } } as never)
    const repo = createHistoryRepository(fake as never)
    expect(await repo.getQaAnswer("bad")).toBeNull()
  })

  it("lists and reopens every canonical run without writing legacy recentVideos", async () => {
    const fake = database()
    const repo = createHistoryRepository(fake as never, { runTransaction: passthroughTransaction })
    await repo.saveVideoRecord({
      contentKey: "youtube:video", platform: "youtube", videoId: "video", partId: null,
      title: "Video", channelTitle: "Channel", thumbnailUrl: null,
      canonicalUrl: "https://www.youtube.com/watch?v=video", durationSec: 10,
      openedAt: time, updatedAt: time, analyzedAt: time
    })
    for (const entry of [
      run("m1-r1", "model-1", "2026-10-10T00:00:01.000Z"),
      run("m1-r2", "model-1", "2026-10-10T00:00:02.000Z"),
      run("m2", "model-2", "2026-10-10T00:00:03.000Z")
    ]) {
      await repo.saveAnalysisRun({
        analysisRun: entry,
        segments: [segment(entry.id)],
        recentVideo: {
          videoId: "video", analysisRunId: entry.id, contentKey: "youtube:video",
          title: "Video", channelTitle: "Channel", thumbnailUrl: null,
          status: "completed", openedAt: entry.createdAt, analyzedAt: entry.completedAt
        }
      })
    }

    expect(fake.recentVideos.rows).toHaveLength(0)
    const recent = await repo.listRecentAnalyses(10)
    expect(recent.map((entry) => entry.recentVideo.analysisRunId)).toEqual(["m2", "m1-r2", "m1-r1"])
    expect((await repo.getAnalysisRunById("m1-r1"))?.summary).toBe("Summary m1-r1")
    expect((await repo.getAnalysisRunById("m1-r2"))?.segments[0]?.detail).toBe("Chapter detail m1-r2")
  })

  it("restores Bilibili parts by exact run and content identity", async () => {
    const fake = database()
    const repo = createHistoryRepository(fake as never, { runTransaction: passthroughTransaction })
    for (const [runId, contentKey, partId] of [
      ["p1-run", "bilibili:BV:p:1", "1"],
      ["p2-run", "bilibili:BV:p:2", "2"]
    ] as const) {
      await repo.saveVideoRecord({
        contentKey, platform: "bilibili", videoId: "BV", partId, title: `Part ${partId}`,
        channelTitle: "Uploader", thumbnailUrl: null, canonicalUrl: `https://www.bilibili.com/video/BV?p=${partId}`,
        durationSec: 10, openedAt: time, updatedAt: time, analyzedAt: time
      })
      await repo.saveAnalysisRun({
        analysisRun: run(runId, "model", time, contentKey),
        segments: [segment(runId, contentKey)],
        recentVideo: {
          videoId: "BV", analysisRunId: runId, contentKey, partId, platform: "bilibili",
          title: `Part ${partId}`, channelTitle: "Uploader", thumbnailUrl: null,
          status: "completed", openedAt: time, analyzedAt: time
        }
      })
    }
    expect((await repo.getAnalysisRunById("p1-run"))?.contentKey).toBe("bilibili:BV:p:1")
    expect((await repo.getAnalysisRunById("p2-run"))?.contentKey).toBe("bilibili:BV:p:2")
    expect((await repo.listRecentAnalyses(10)).map((entry) => entry.recentVideo.contentKey).sort()).toEqual([
      "bilibili:BV:p:1",
      "bilibili:BV:p:2"
    ])
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
