import Dexie, { type Table } from "dexie"

import {
  DATABASE_NAME,
  type DatabaseSchema,
} from "@/lib/db/schema"
import { registerMigrations } from "@/lib/db/migrations"
import type {
  AnalysisRunEntity,
  ProviderConfigEntity,
  RecentVideoEntity,
  SegmentSummaryEntity,
  TranscriptSnapshotEntity
} from "@/lib/schemas/persistence"

export class YoutubeSummarizerDatabase extends Dexie {
  providerConfigs!: Table<ProviderConfigEntity, string>
  transcriptSnapshots!: Table<TranscriptSnapshotEntity, string>
  analysisRuns!: Table<AnalysisRunEntity, string>
  segmentSummaries!: Table<SegmentSummaryEntity, string>
  recentVideos!: Table<RecentVideoEntity, string>

  constructor(name = DATABASE_NAME) {
    super(name)

    registerMigrations(this)

    this.providerConfigs = this.table("providerConfigs")
    this.transcriptSnapshots = this.table("transcriptSnapshots")
    this.analysisRuns = this.table("analysisRuns")
    this.segmentSummaries = this.table("segmentSummaries")
    this.recentVideos = this.table("recentVideos")
  }
}

export const db = new YoutubeSummarizerDatabase()

export type { DatabaseSchema }
export {
  RECENT_VIDEOS_RETENTION_LIMIT,
  TRANSCRIPT_RAW_VTT_RETENTION_DAYS
} from "@/lib/db/schema"
export {
  PersistenceError,
  isQuotaExceededError,
  runWriteWithQuotaGuard,
  type PersistenceErrorReason
} from "@/lib/db/errors"

export async function withDatabaseTransaction<T>(
  mode: "r" | "rw",
  tables: (keyof DatabaseSchema)[],
  callback: () => Promise<T>
) {
  const dexieTables = tables.map((tableName) => db.table(tableName))
  return db.transaction(mode, dexieTables, callback)
}

export async function deleteDatabase() {
  await db.delete()
}
