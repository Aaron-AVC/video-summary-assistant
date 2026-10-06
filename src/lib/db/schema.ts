import type { Table } from "dexie"

import type {
  AnalysisRunEntity,
  ProviderConfigEntity,
  RecentVideoEntity,
  SegmentSummaryEntity,
  TranscriptSnapshotEntity
} from "@/lib/schemas/persistence"

import { MIGRATION_BLOCKS } from "@/lib/db/migrations"

export const DATABASE_NAME = "youtube-summarizer"

/**
 * Maximum number of `recentVideos` rows persisted at any time.
 * Older entries (by `updatedAt`) are trimmed inside `saveAnalysisRun`.
 */
export const RECENT_VIDEOS_RETENTION_LIMIT = 100

/**
 * Snapshots older than this many days have their `rawVtt` blob cleared on next
 * write, while keeping the row + cues + metadata. Cues stay because they're
 * required to render summaries; rawVtt is the heavy field we shed.
 */
export const TRANSCRIPT_RAW_VTT_RETENTION_DAYS = 30

/**
 * The current database version is the highest target version declared in the
 * migration block array. Adding a new version means appending another block to
 * `MIGRATION_BLOCKS` — no edits to existing blocks.
 */
export const DATABASE_VERSION = MIGRATION_BLOCKS.reduce(
  (highest, block) => Math.max(highest, block.version),
  0
)

/**
 * Effective store layout = the schema declared by the latest migration block.
 * Older blocks remain referenced from `MIGRATION_BLOCKS` so Dexie can play them
 * back for users upgrading from an earlier installed version.
 */
export const STORE_SCHEMAS = MIGRATION_BLOCKS.reduce<Record<string, string>>(
  (accumulator, block) => ({ ...accumulator, ...block.stores }),
  {}
)

export type DatabaseSchema = {
  providerConfigs: Table<ProviderConfigEntity, string>
  transcriptSnapshots: Table<TranscriptSnapshotEntity, string>
  analysisRuns: Table<AnalysisRunEntity, string>
  segmentSummaries: Table<SegmentSummaryEntity, string>
  recentVideos: Table<RecentVideoEntity, string>
}
