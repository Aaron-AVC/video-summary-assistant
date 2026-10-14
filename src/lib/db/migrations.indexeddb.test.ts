import "fake-indexeddb/auto"

import Dexie from "dexie"
import { describe, expect, it } from "bun:test"

import { MIGRATION_BLOCKS } from "@/lib/db/migrations"
import { YoutubeSummarizerDatabase } from "@/lib/db"

Dexie.dependencies.indexedDB = indexedDB
Dexie.dependencies.IDBKeyRange = IDBKeyRange

describe("Dexie v2 to v3 transcript cache migration", () => {
  it("preserves two snapshots for one video when upgrading the real IndexedDB schema", async () => {
    const name = `youtube-summarizer-migration-${crypto.randomUUID()}`
    const v1 = MIGRATION_BLOCKS.find((block) => block.version === 1)!
    const v2 = MIGRATION_BLOCKS.find((block) => block.version === 2)!
    const legacy = new Dexie(name)
    legacy.version(1).stores(v1.stores)
    legacy.version(2).stores(v2.stores)
    await legacy.open()
    await legacy.table("transcriptSnapshots").bulkPut([
      {
        id: "snapshot-a",
        videoId: "same-video",
        language: "en",
        sourceUrl: null,
        rawVtt: "WEBVTT A",
        cues: [{ startSec: 0, endSec: 1, text: "A" }],
        createdAt: "2026-10-09T00:00:00.000Z",
        updatedAt: "2026-10-09T00:00:00.000Z"
      },
      {
        id: "snapshot-b",
        videoId: "same-video",
        language: "en",
        sourceUrl: null,
        rawVtt: "WEBVTT B",
        cues: [{ startSec: 0, endSec: 1, text: "B" }],
        createdAt: "2026-10-10T00:00:00.000Z",
        updatedAt: "2026-10-10T00:00:00.000Z"
      }
    ])
    legacy.close()

    const upgraded = new YoutubeSummarizerDatabase(name)
    try {
      await upgraded.open()
      const rows = await upgraded.transcriptCache.toArray()
      expect(upgraded.verno).toBe(4)
      expect(rows).toHaveLength(2)
      expect(rows.map((row) => row.id).sort()).toEqual([
        "legacy-transcript:snapshot-a",
        "legacy-transcript:snapshot-b"
      ])
      expect(rows.every((row) => row.contentKey === "youtube:same-video")).toBe(true)
      expect(await upgraded.transcriptCache
        .where("[contentKey+updatedAt]")
        .between(["youtube:same-video", ""], ["youtube:same-video", "￿"])
        .count()).toBe(2)
      expect(await upgraded.qaThreads.count()).toBe(0)
      expect(await upgraded.qaMessages.count()).toBe(0)
    } finally {
      upgraded.close()
      await upgraded.delete()
    }
  })

  it("upgrades a real v3 database without deleting existing cache and history rows", async () => {
    const name = `youtube-summarizer-v3-migration-${crypto.randomUUID()}`
    const v3 = MIGRATION_BLOCKS.find((block) => block.version === 3)!
    const legacy = new Dexie(name)
    legacy.version(3).stores(v3.stores)
    await legacy.open()
    await legacy.table("videoRecords").put({
      contentKey: "youtube:video", platform: "youtube", videoId: "video", partId: null,
      title: "Video", channelTitle: null, thumbnailUrl: null, canonicalUrl: null,
      durationSec: 10, openedAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z", analyzedAt: null
    })
    await legacy.table("analysisRuns").put({
      id: "run", videoId: "video", platform: "youtube", contentKey: "youtube:video", partId: null,
      transcriptSnapshotId: "transcript", providerConfigId: null, transcriptFingerprint: "fp",
      analysisSchemaVersion: 1, analysisPromptVersion: "analysis-v1", analysisCacheKey: null,
      providerProfileId: null, providerBaseUrl: null, providerModel: null, status: "completed",
      summary: "summary", keyPoints: [], topics: [], errorMessage: null,
      createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z", completedAt: "2026-10-14T00:00:00.000Z"
    })
    await legacy.table("segmentSummaries").put({
      id: "segment", analysisRunId: "run", videoId: "video", contentKey: "youtube:video",
      title: "Chapter", summary: "summary", detail: "detail", startSec: 0, endSec: 1,
      createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z"
    })
    await legacy.table("recentVideos").put({
      videoId: "video", analysisRunId: "run", platform: "youtube", contentKey: "youtube:video", partId: null,
      title: "Video", channelTitle: null, thumbnailUrl: null, status: "completed",
      updatedAt: "2026-10-14T00:00:00.000Z", openedAt: "2026-10-14T00:00:00.000Z", analyzedAt: "2026-10-14T00:00:00.000Z"
    })
    await legacy.table("transcriptCache").put({
      id: "transcript", contentKey: "youtube:video", platform: "youtube", videoId: "video", partId: null,
      fingerprint: "fp", fingerprintVersion: 2, language: "en", sourceUrl: null, rawVtt: null,
      cues: [{ startSec: 0, endSec: 1, text: "hello" }], createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z"
    })
    await legacy.table("analysisCache").put({
      cacheKey: "analysis-cache", contentKey: "youtube:video", platform: "youtube", videoId: "video", partId: null,
      transcriptFingerprint: "fp", analysisSchemaVersion: 1, analysisPromptVersion: "analysis-v1",
      providerProfileId: null, providerBaseUrl: null, providerModel: null, analysisRunId: "run", analysis: null,
      createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z"
    })
    await legacy.table("qaAnswers").put({ cacheKey: "qa", contentKey: "youtube:video", analysisRunId: "run", question: "Why?", updatedAt: "2026-10-14T00:00:00.000Z" })
    legacy.close()

    const upgraded = new YoutubeSummarizerDatabase(name)
    try {
      await upgraded.open()
      expect(upgraded.verno).toBe(4)
      expect(await upgraded.videoRecords.count()).toBe(1)
      expect(await upgraded.analysisRuns.count()).toBe(1)
      expect(await upgraded.segmentSummaries.count()).toBe(1)
      expect(await upgraded.recentVideos.count()).toBe(1)
      expect(await upgraded.transcriptCache.count()).toBe(1)
      expect(await upgraded.analysisCache.count()).toBe(1)
      expect(await upgraded.qaAnswers.count()).toBe(1)
      expect(await upgraded.qaThreads.count()).toBe(0)
      expect(await upgraded.qaMessages.count()).toBe(0)
    } finally {
      upgraded.close()
      await upgraded.delete()
    }
  })
})
