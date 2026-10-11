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
      expect(upgraded.verno).toBe(3)
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
    } finally {
      upgraded.close()
      await upgraded.delete()
    }
  })
})
