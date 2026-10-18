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
    toArray?: () => Promise<unknown[]>
    bulkPut?: (rows: unknown[]) => Promise<unknown>
    put?: (row: unknown) => Promise<unknown>
    clear?: () => Promise<unknown>
  }
}

async function readMigrationRows(table: ReturnType<DexieUpgradeTransaction["table"]>) {
  if (table.toArray) return (await table.toArray()) as Record<string, unknown>[]
  const rows: Record<string, unknown>[] = []
  await table.toCollection().modify((row) => {
    if (row && typeof row === "object") rows.push({ ...(row as Record<string, unknown>) })
  })
  return rows
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
  },
  {
    version: 3,
    stores: {
      providerConfigs: "id, name, updatedAt",
      transcriptSnapshots: "id, videoId, updatedAt, [videoId+updatedAt]",
      analysisRuns: "id, videoId, status, updatedAt, [videoId+updatedAt]",
      segmentSummaries: "id, analysisRunId, videoId, [videoId+startSec]",
      recentVideos: "videoId, updatedAt, status",
      videoRecords: "&contentKey, platform, videoId, updatedAt, [platform+updatedAt]",
      transcriptCache: "id, contentKey, fingerprint, updatedAt, [contentKey+fingerprint], [contentKey+updatedAt]",
      analysisCache: "&cacheKey, contentKey, transcriptFingerprint, providerProfileId, updatedAt, [contentKey+updatedAt]",
      qaAnswers: "&cacheKey, contentKey, analysisRunId, question, updatedAt, [contentKey+updatedAt]"
    },
    upgrade: async (transaction) => {
      const recentTable = transaction.table("recentVideos")
      const recentRows = await readMigrationRows(recentTable)
      const records = recentRows.flatMap((row) => {
        const videoId = typeof row.videoId === "string" ? row.videoId : ""
        if (!videoId) return []
        const contentKey = `youtube:${videoId}`
        return [{
            contentKey,
            platform: "youtube",
            videoId,
            partId: null,
            title: typeof row.title === "string" && row.title.trim() ? row.title : videoId,
            channelTitle: typeof row.channelTitle === "string" ? row.channelTitle : null,
            thumbnailUrl: typeof row.thumbnailUrl === "string" ? row.thumbnailUrl : null,
            canonicalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
            durationSec: null,
            openedAt: row.openedAt,
            updatedAt: row.updatedAt,
            analyzedAt: row.analyzedAt ?? null
        }]
      })
      const videoRecords = transaction.table("videoRecords")
      if (videoRecords.bulkPut && records.length > 0) await videoRecords.bulkPut(records)

      const snapshotRows = await readMigrationRows(transaction.table("transcriptSnapshots"))
      const transcriptCacheRows = snapshotRows.flatMap((row) => {
        const videoId = typeof row.videoId === "string" ? row.videoId : ""
        if (!videoId) return []
        return [{
          id: `legacy-transcript:${String(row.id ?? videoId)}`,
          contentKey: `youtube:${videoId}`,
          platform: "youtube",
          videoId,
          partId: null,
          fingerprint: null,
          fingerprintVersion: null,
          language: row.language ?? null,
          sourceUrl: row.sourceUrl ?? null,
          rawVtt: row.rawVtt ?? null,
          cues: row.cues ?? [],
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        }]
      })
      const transcriptCache = transaction.table("transcriptCache")
      if (transcriptCache.bulkPut && transcriptCacheRows.length > 0) {
        await transcriptCache.bulkPut(transcriptCacheRows)
      }

      const analysisRows = await readMigrationRows(transaction.table("analysisRuns"))
      const analysisCacheRows = analysisRows.flatMap((row) => {
        const videoId = typeof row.videoId === "string" ? row.videoId : ""
        const runId = typeof row.id === "string" ? row.id : ""
        if (!videoId || !runId) return []
        return [{
          cacheKey: `legacy-analysis:${runId}`,
          contentKey: `youtube:${videoId}`,
          platform: "youtube",
          videoId,
          partId: null,
          transcriptFingerprint: null,
          analysisSchemaVersion: null,
          analysisPromptVersion: null,
          providerProfileId: null,
          providerBaseUrl: null,
          providerModel: null,
          analysisRunId: runId,
          analysis: null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        }]
      })
      const analysisCache = transaction.table("analysisCache")
      if (analysisCache.bulkPut && analysisCacheRows.length > 0) {
        await analysisCache.bulkPut(analysisCacheRows)
      }

      const addLegacyIdentity = async (tableName: string, extra: Record<string, unknown> = {}) => {
        await transaction.table(tableName).toCollection().modify((row) => {
          if (!row || typeof row !== "object") return
          const value = row as Record<string, unknown>
          if (typeof value.videoId !== "string" || value.videoId.length === 0) return
          value.platform = "youtube"
          value.contentKey = `youtube:${value.videoId}`
          value.partId = null
          Object.assign(value, extra)
        })
      }
      await addLegacyIdentity("transcriptSnapshots", { fingerprint: null, fingerprintVersion: null })
      await addLegacyIdentity("analysisRuns", {
        transcriptFingerprint: null,
        analysisSchemaVersion: null,
        analysisPromptVersion: null,
        analysisCacheKey: null,
        providerProfileId: null,
        providerBaseUrl: null,
        providerModel: null
      })
      await addLegacyIdentity("segmentSummaries")
      await addLegacyIdentity("recentVideos")

      // Legacy rows remain authoritative for compatibility. They are not
      // deleted during v3 so a failed/partial copy cannot destroy history.
    }
  },
  {
    version: 4,
    stores: {
      providerConfigs: "id, name, updatedAt",
      transcriptSnapshots: "id, videoId, updatedAt, [videoId+updatedAt]",
      analysisRuns: "id, videoId, status, updatedAt, [videoId+updatedAt]",
      segmentSummaries: "id, analysisRunId, videoId, [videoId+startSec]",
      recentVideos: "videoId, updatedAt, status",
      videoRecords: "&contentKey, platform, videoId, updatedAt, [platform+updatedAt]",
      transcriptCache: "id, contentKey, fingerprint, updatedAt, [contentKey+fingerprint], [contentKey+updatedAt]",
      analysisCache: "&cacheKey, contentKey, transcriptFingerprint, providerProfileId, updatedAt, [contentKey+updatedAt]",
      qaAnswers: "&cacheKey, contentKey, analysisRunId, question, updatedAt, [contentKey+updatedAt]",
      qaThreads: "&id, contentKey, analysisRunId, updatedAt, [contentKey+updatedAt], [contentKey+analysisRunId]",
      qaMessages: "&id, threadId, sequence, [threadId+sequence], createdAt"
    }
  },
  {
    version: 5,
    stores: {
      providerConfigs: "id, name, updatedAt",
      transcriptSnapshots: "id, videoId, updatedAt, [videoId+updatedAt]",
      analysisRuns: "id, videoId, status, updatedAt, [videoId+updatedAt]",
      segmentSummaries: "id, analysisRunId, videoId, [videoId+startSec]",
      recentVideos: "videoId, updatedAt, status",
      videoRecords: "&contentKey, platform, videoId, updatedAt, [platform+updatedAt]",
      transcriptCache: "id, contentKey, fingerprint, updatedAt, [contentKey+fingerprint], [contentKey+updatedAt]",
      analysisCache: "&cacheKey, contentKey, transcriptFingerprint, providerProfileId, updatedAt, [contentKey+updatedAt]",
      qaAnswers: "&cacheKey, contentKey, analysisRunId, question, updatedAt, [contentKey+updatedAt]",
      qaThreads: "&id, contentKey, analysisRunId, updatedAt, [contentKey+updatedAt], [contentKey+analysisRunId]",
      qaMessages: "&id, threadId, sequence, [threadId+sequence], createdAt"
    },
    upgrade: async (transaction) => {
      for (const tableName of ["transcriptSnapshots", "transcriptCache"]) {
        await transaction.table(tableName).toCollection().modify((row) => {
          if (!row || typeof row !== "object") return
          const value = row as Record<string, unknown>
          if (value.sourceUrl !== null) value.sourceUrl = null
        })
      }
    }
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
