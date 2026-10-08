/**
 * Versioned Dexie migration blocks.
 *
 * Each block is the *complete* description of one schema version:
 *  - `version`: target DB version (must be a positive integer; sorted ascending)
 *  - `stores`: the Dexie stores schema in effect at this version (full layout,
 *    not a delta — Dexie applies whatever it sees here for that version)
 *  - `upgrade` (optional): callback Dexie runs to migrate row data when an
 *    existing user steps up to this version. Receives the Dexie transaction.
 *
 * Rules:
 *  1. NEVER mutate an already-shipped block — append a new one for v(N+1).
 *  2. The latest block's `stores` is the live schema (see schema.ts).
 *  3. Tests cover plug-and-play: a v1 install seeded with v1 data must reach
 *     the latest version after `registerMigrations` runs.
 */

type DexieUpgradeTransaction = {
  // Intentionally loose: the Dexie types differ between versions; we only need
  // the `table()` accessor inside upgrades and don't want to drag a heavy type
  // dependency into the migration registry.
  table: (name: string) => {
    toCollection: () => { modify: (mutator: (row: unknown) => void) => Promise<unknown> }
  }
}

export type MigrationBlock = {
  version: number
  stores: Record<string, string>
  upgrade?: (transaction: DexieUpgradeTransaction) => unknown | Promise<unknown>
}

/**
 * Append-only migration registry. Adding v2 = append a block with
 * `version: 2`, the new `stores`, and an `upgrade` callback if needed.
 */
export const MIGRATION_BLOCKS: MigrationBlock[] = [
  {
    version: 1,
    stores: {
      providerConfigs: "id, name, updatedAt",
      transcriptSnapshots: "id, videoId, updatedAt, [videoId+updatedAt]",
      analysisRuns: "id, videoId, status, updatedAt, [videoId+updatedAt]",
      segmentSummaries: "id, analysisRunId, videoId, [videoId+startSec]",
      recentVideos: "videoId, updatedAt, status"
    }
  },
  {
    version: 2,
    stores: {
      providerConfigs: "id, name, updatedAt",
      transcriptSnapshots: "id, videoId, updatedAt, [videoId+updatedAt]",
      analysisRuns: "id, videoId, status, updatedAt, [videoId+updatedAt]",
      segmentSummaries: "id, analysisRunId, videoId, [videoId+startSec]",
      recentVideos: "videoId, updatedAt, status"
    },
    upgrade: (transaction) => transaction.table("providerConfigs").toCollection().modify((row) => {
      if (row && typeof row === "object" && "apiKey" in row) {
        delete (row as { apiKey?: unknown }).apiKey
      }
    })
  }
]

type DexieLike = {
  version: (version: number) => {
    stores: (schema: Record<string, string>) => {
      upgrade?: (callback: (transaction: DexieUpgradeTransaction) => unknown) => unknown
    }
  }
}

/**
 * Registers every migration block on the supplied Dexie instance, in version
 * order. Safe to call against either the real Dexie database or a test double
 * that implements the minimal shape above.
 */
export function registerMigrations(database: DexieLike, blocks: MigrationBlock[] = MIGRATION_BLOCKS) {
  const ordered = [...blocks].sort((left, right) => left.version - right.version)

  for (const block of ordered) {
    const stage = database.version(block.version).stores(block.stores)
    if (block.upgrade && typeof stage.upgrade === "function") {
      stage.upgrade(block.upgrade)
    }
  }
}
