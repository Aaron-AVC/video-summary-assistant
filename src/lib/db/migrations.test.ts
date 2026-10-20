import { describe, expect, it } from "bun:test"

import {
  MIGRATION_BLOCKS,
  registerMigrations,
  type MigrationBlock
} from "@/lib/db/migrations"

type RecordedCall = {
  version: number
  stores: Record<string, string>
  hasUpgrade: boolean
}

function createDexieDouble() {
  const calls: RecordedCall[] = []

  function version(targetVersion: number) {
    return {
      stores(schema: Record<string, string>) {
        const record: RecordedCall = {
          version: targetVersion,
          stores: schema,
          hasUpgrade: false
        }
        calls.push(record)

        return {
          upgrade(
            _callback: (transaction: {
              table: (name: string) => {
                toCollection: () => {
                  modify: (mutator: (row: unknown) => void) => Promise<unknown>
                }
              }
            }) => unknown
          ) {
            record.hasUpgrade = true
            return record
          }
        }
      }
    }
  }

  return { version, calls }
}

describe("registerMigrations", () => {
  it("declares the v1 schema", () => {
    const dexie = createDexieDouble()
    registerMigrations(dexie)

    expect(dexie.calls).toHaveLength(MIGRATION_BLOCKS.length)
    const v1 = dexie.calls.find((call) => call.version === 1)
    expect(v1).toBeDefined()
    expect(v1?.stores).toMatchObject({
      providerConfigs: "id, name, updatedAt",
      transcriptSnapshots: "id, videoId, updatedAt, [videoId+updatedAt]",
      recentVideos: "videoId, updatedAt, status"
    })
  })

  it("plays back blocks in ascending version order even if registered out of order", () => {
    const dexie = createDexieDouble()

    const blocks: MigrationBlock[] = [
      {
        // Pretend a future v2 is appended that needs an upgrade callback.
        version: 2,
        stores: {
          providerConfigs: "id, name, updatedAt, lastUsedAt",
          transcriptSnapshots: "id, videoId, updatedAt, [videoId+updatedAt]",
          analysisRuns: "id, videoId, status, updatedAt, [videoId+updatedAt]",
          segmentSummaries: "id, analysisRunId, videoId, [videoId+startSec]",
          recentVideos: "videoId, updatedAt, status"
        },
        upgrade: () => undefined
      },
      // Intentionally registered after v2 to prove the registry sorts.
      {
        version: 1,
        stores: {
          providerConfigs: "id, name, updatedAt",
          transcriptSnapshots: "id, videoId, updatedAt, [videoId+updatedAt]",
          analysisRuns: "id, videoId, status, updatedAt, [videoId+updatedAt]",
          segmentSummaries: "id, analysisRunId, videoId, [videoId+startSec]",
          recentVideos: "videoId, updatedAt, status"
        }
      }
    ]

    registerMigrations(dexie, blocks)

    expect(dexie.calls.map((call) => call.version)).toEqual([1, 2])
    expect(dexie.calls[0].hasUpgrade).toBe(false)
    expect(dexie.calls[1].hasUpgrade).toBe(true)
    expect(dexie.calls[1].stores.providerConfigs).toContain("lastUsedAt")
  })

  it("simulates a v2 migration on a v1 database without mutating v1", () => {
    // Pre-existing v1 block: should be replayed unchanged for users on v1.
    const v1: MigrationBlock = {
      version: 1,
      stores: {
        providerConfigs: "id, name, updatedAt",
        transcriptSnapshots: "id, videoId, updatedAt, [videoId+updatedAt]",
        analysisRuns: "id, videoId, status, updatedAt, [videoId+updatedAt]",
        segmentSummaries: "id, analysisRunId, videoId, [videoId+startSec]",
        recentVideos: "videoId, updatedAt, status"
      }
    }

    let upgradeRan = false
    const v2: MigrationBlock = {
      version: 2,
      stores: {
        ...v1.stores,
        providerConfigs: "id, name, updatedAt, lastUsedAt"
      },
      upgrade: () => {
        upgradeRan = true
      }
    }

    const dexie = createDexieDouble()
    registerMigrations(dexie, [v1, v2])

    expect(dexie.calls).toHaveLength(2)
    // v1 block was registered exactly as-is.
    expect(dexie.calls[0]).toMatchObject({ version: 1, hasUpgrade: false })
    expect(dexie.calls[0].stores).toEqual(v1.stores)
    // v2 was layered on top with an upgrade callback wired through.
    expect(dexie.calls[1]).toMatchObject({ version: 2, hasUpgrade: true })

    // Invoke the upgrade callback to prove the registry actually wires it.
    const v2Stage = dexie.calls[1]
    expect(v2Stage.hasUpgrade).toBe(true)
    // The double records `hasUpgrade`; trigger the real callback via blocks[1]
    // to assert the user-supplied function runs.
    void v2.upgrade?.({
      table: () => ({ toCollection: () => ({ modify: async () => undefined }) })
    })
    expect(upgradeRan).toBe(true)
  })

  it("appends a metadata-only provider migration that scrubs legacy apiKey fields", async () => {
    const v2 = MIGRATION_BLOCKS.find((block) => block.version === 2)
    expect(v2).toBeDefined()
    expect(v2?.stores.providerConfigs).toBe("id, name, updatedAt")

    const row: Record<string, unknown> = {
      id: "legacy",
      name: "Legacy",
      baseUrl: "https://example.com/v1",
      model: "model",
      apiKey: "sk-secret",
    }
    await v2?.upgrade?.({
      table: (name) => ({
        toCollection: () => ({
          modify: async (mutator) => {
            expect(name).toBe("providerConfigs")
            mutator(row)
          }
        })
      })
    })
    expect(row).not.toHaveProperty("apiKey")
  })

  it("appends v3 content-key stores and preserves legacy rows while copying them", async () => {
    const v3 = MIGRATION_BLOCKS.find((block) => block.version === 3)
    expect(v3?.stores.videoRecords).toContain("contentKey")
    expect(v3?.stores.transcriptCache).toContain("fingerprint")
    expect(v3?.stores.analysisCache).toContain("cacheKey")
    expect(v3?.stores.qaAnswers).toContain("analysisRunId")

    const recentRows = [{
      videoId: "youtube-1", title: "Video", channelTitle: null, thumbnailUrl: null,
      openedAt: "2026-10-10T00:00:00.000Z", updatedAt: "2026-10-10T00:00:00.000Z", analyzedAt: null
    }]
    const copied: Record<string, unknown[]> = { videoRecords: [] }
    const table = (name: string) => ({
      toArray: async () => name === "recentVideos" ? recentRows : [],
      toCollection: () => ({ modify: async () => undefined }),
      bulkPut: async (rows: unknown[]) => { copied[name] = rows }
    })
    await v3?.upgrade?.({ table })
    expect(copied.videoRecords).toHaveLength(1)
    expect(copied.videoRecords[0]).toMatchObject({ contentKey: "youtube:youtube-1", platform: "youtube" })
    expect(recentRows).toHaveLength(1)
  })

  it("copies multiple v2 transcript snapshots for one video without collapsing them", async () => {
    const v3 = MIGRATION_BLOCKS.find((block) => block.version === 3)
    const recentRows = [{
      videoId: "youtube-1", title: "Video", channelTitle: null, thumbnailUrl: null,
      openedAt: "2026-10-10T00:00:00.000Z", updatedAt: "2026-10-10T00:00:00.000Z", analyzedAt: null
    }]
    const snapshots = [
      {
        id: "snapshot-a", videoId: "youtube-1", language: "en", sourceUrl: null, rawVtt: "a",
        cues: [{ startSec: 0, endSec: 1, text: "A" }], createdAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z"
      },
      {
        id: "snapshot-b", videoId: "youtube-1", language: "en", sourceUrl: null, rawVtt: "b",
        cues: [{ startSec: 0, endSec: 1, text: "B" }], createdAt: "2026-10-10T00:00:00.000Z", updatedAt: "2026-10-10T00:00:00.000Z"
      }
    ]
    const copied: Record<string, unknown[]> = { transcriptCache: [] }
    const table = (name: string) => ({
      toArray: async () => {
        if (name === "recentVideos") return recentRows
        if (name === "transcriptSnapshots") return snapshots
        return []
      },
      toCollection: () => ({ modify: async () => undefined }),
      bulkPut: async (rows: unknown[]) => { copied[name] = rows }
    })

    await v3?.upgrade?.({ table })

    expect(copied.transcriptCache).toHaveLength(2)
    expect(copied.transcriptCache?.map((row) => (row as { id: string }).id)).toEqual([
      "legacy-transcript:snapshot-a",
      "legacy-transcript:snapshot-b"
    ])
    expect(v3?.stores.transcriptCache).toContain("[contentKey+fingerprint]")
    expect(v3?.stores.transcriptCache).not.toContain("&contentKey")
  })

  it("appends v6 with a knowledgeItems store without touching v1-v5", () => {
    expect(MIGRATION_BLOCKS.map((block) => block.version)).toEqual([1, 2, 3, 4, 5, 6])

    const v5 = MIGRATION_BLOCKS.find((block) => block.version === 5)!
    const v6 = MIGRATION_BLOCKS.find((block) => block.version === 6)!
    expect(v6).toBeDefined()
    expect(v6.upgrade).toBeUndefined()
    expect(v6.stores.knowledgeItems).toBe(
      "&id, contentKey, kind, analysisRunId, updatedAt, [contentKey+updatedAt], [contentKey+kind]"
    )

    // Every v5 store is re-declared verbatim so the Dexie version chain keeps
    // the existing tables (and their data) intact.
    for (const [table, declaration] of Object.entries(v5.stores)) {
      expect(v6.stores[table]).toBe(declaration)
    }
    expect(Object.keys(v6.stores).sort()).toEqual(
      [...Object.keys(v5.stores), "knowledgeItems"].sort()
    )
  })

  it("keeps every historical migration block immutable and append-only", () => {
    const versions = MIGRATION_BLOCKS.map((block) => block.version)
    expect(new Set(versions).size).toBe(versions.length)
    expect([...versions].sort((left, right) => left - right)).toEqual(versions)

    // v5 is a data-only cleanup on the v4 schema; v4 added the QA stores.
    const v3 = MIGRATION_BLOCKS.find((block) => block.version === 3)!
    const v4 = MIGRATION_BLOCKS.find((block) => block.version === 4)!
    const v5 = MIGRATION_BLOCKS.find((block) => block.version === 5)!
    expect(v5.stores).toEqual(v4.stores)
    expect(Object.keys(v3.stores)).toContain("analysisCache")
    expect(Object.keys(v3.stores)).toContain("qaAnswers")
    expect(Object.keys(v3.stores)).not.toContain("qaThreads")
    expect(Object.keys(v4.stores)).toContain("qaThreads")
    expect(Object.keys(v5.stores)).not.toContain("knowledgeItems")
    expect(Object.keys(MIGRATION_BLOCKS.find((block) => block.version === 1)!.stores)).toEqual([
      "providerConfigs",
      "transcriptSnapshots",
      "analysisRuns",
      "segmentSummaries",
      "recentVideos"
    ])
  })

  it("appends a schema-compatible cleanup for stored transcript fetch URLs", async () => {
    const v4 = MIGRATION_BLOCKS.find((block) => block.version === 4)
    const v5 = MIGRATION_BLOCKS.find((block) => block.version === 5)
    expect(v5?.stores).toEqual(v4?.stores)

    const signedUrl = "https://www.youtube.com/api/timedtext?v=video&signature=SECRET_TEST_VALUE&pot=SECRET_TEST_TOKEN"
    const snapshot = {
      id: "snapshot",
      sourceUrl: signedUrl,
      rawVtt: "WEBVTT preserved",
      cues: [{ startSec: 0, endSec: 1, text: "Preserved cue" }]
    }
    const cache = {
      id: "cache",
      sourceUrl: signedUrl,
      contentKey: "youtube:video",
      fingerprint: "fp"
    }
    await v5?.upgrade?.({
      table: (name) => ({
        toCollection: () => ({
          modify: async (mutator) => {
            if (name === "transcriptSnapshots") mutator(snapshot)
            if (name === "transcriptCache") mutator(cache)
          }
        })
      })
    })

    expect(snapshot).toMatchObject({
      sourceUrl: null,
      rawVtt: "WEBVTT preserved",
      cues: [{ startSec: 0, endSec: 1, text: "Preserved cue" }]
    })
    expect(cache).toMatchObject({
      sourceUrl: null,
      contentKey: "youtube:video",
      fingerprint: "fp"
    })
  })
})
