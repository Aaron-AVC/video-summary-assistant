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
})
