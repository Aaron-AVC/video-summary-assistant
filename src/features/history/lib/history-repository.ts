import { db, withDatabaseTransaction } from "@/lib/db"
import { runWriteWithQuotaGuard } from "@/lib/db/errors"
import type { DatabaseSchema } from "@/lib/db/schema"
import {
  RECENT_VIDEOS_RETENTION_LIMIT,
  TRANSCRIPT_RAW_VTT_RETENTION_DAYS
} from "@/lib/db/schema"
import {
  analysisRunSchema,
  segmentSummarySchema
} from "@/lib/schemas/persistence"
import type {
  AnalysisRunEntity,
  PersistenceExport,
  RecentVideoEntity,
  SegmentSummaryEntity,
  TranscriptSnapshotEntity
} from "@/lib/schemas/persistence"

export type SaveAnalysisRunInput = {
  analysisRun: AnalysisRunEntity
  segments: SegmentSummaryEntity[]
  recentVideo: Omit<RecentVideoEntity, "updatedAt"> & {
    updatedAt?: string
  }
}

export type RunRepositoryTransaction = <T>(
  mode: "r" | "rw",
  tables: (keyof DatabaseSchema)[],
  callback: () => Promise<T>
) => Promise<T>

export type HistoryRepositoryOptions = {
  recentVideosRetentionLimit?: number
  transcriptRawVttRetentionDays?: number
  now?: () => Date
  runTransaction?: RunRepositoryTransaction
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

function byNewest<T extends { updatedAt: string }>(items: T[]) {
  return [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

function normalizeAnalysisRun(analysisRun: AnalysisRunEntity) {
  return analysisRunSchema.parse(analysisRun)
}

function normalizeSegments(segments: SegmentSummaryEntity[]) {
  return segments.map((segment) => segmentSummarySchema.parse(segment))
}

export function createHistoryRepository(database = db, options: HistoryRepositoryOptions = {}) {
  const recentVideosRetentionLimit =
    options.recentVideosRetentionLimit ?? RECENT_VIDEOS_RETENTION_LIMIT
  const transcriptRawVttRetentionDays =
    options.transcriptRawVttRetentionDays ?? TRANSCRIPT_RAW_VTT_RETENTION_DAYS
  const now = options.now ?? (() => new Date())
  const runTransaction: RunRepositoryTransaction =
    options.runTransaction ?? withDatabaseTransaction

  async function trimRecentVideos() {
    const allRecent = byNewest(await database.recentVideos.toArray())
    if (allRecent.length <= recentVideosRetentionLimit) {
      return
    }
    const stale = allRecent.slice(recentVideosRetentionLimit)
    const staleIds = stale.map((entry) => entry.videoId)
    await database.recentVideos.bulkDelete(staleIds)
  }

  async function shedOldRawVtt() {
    if (transcriptRawVttRetentionDays <= 0) {
      return
    }
    const cutoff = new Date(now().getTime() - transcriptRawVttRetentionDays * MILLISECONDS_PER_DAY)
    const cutoffIso = cutoff.toISOString()
    const allSnapshots = await database.transcriptSnapshots.toArray()
    const stale = allSnapshots.filter(
      (snapshot) => snapshot.rawVtt !== null && snapshot.updatedAt < cutoffIso
    )
    if (stale.length === 0) {
      return
    }
    await database.transcriptSnapshots.bulkPut(
      stale.map((snapshot) => ({ ...snapshot, rawVtt: null }))
    )
  }

  return {
    async saveTranscriptSnapshot(snapshot: TranscriptSnapshotEntity) {
      return runWriteWithQuotaGuard(async () => {
        await database.transcriptSnapshots.put(snapshot)
        await shedOldRawVtt()
        return snapshot
      })
    },
    async saveAnalysisRun(input: SaveAnalysisRunInput) {
      return runWriteWithQuotaGuard(async () => {
        const updatedAt = input.recentVideo.updatedAt ?? input.analysisRun.updatedAt
        const analysisRun = normalizeAnalysisRun(input.analysisRun)
        const segments = normalizeSegments(input.segments)

        await runTransaction(
          "rw",
          ["analysisRuns", "segmentSummaries", "recentVideos"],
          async () => {
            await database.analysisRuns.put(analysisRun)
            await database.segmentSummaries.bulkPut(segments)
            await database.recentVideos.put({
              ...input.recentVideo,
              updatedAt
            })
          }
        )

        await trimRecentVideos()

        return {
          ...analysisRun,
          segments,
          recentVideo: {
            ...input.recentVideo,
            updatedAt
          }
        }
      })
    },
    /**
     * Returns the most recently-updated transcript snapshot for a video, or
     * null if none exist. Uses the [videoId+updatedAt] compound index so the
     * sort happens inside Dexie / IndexedDB rather than after a full
     * .toArray() into JS memory. Falls back gracefully to a JS sort when the
     * test fake (or any future stand-in) doesn't expose the indexed query.
     */
    async getLatestTranscriptSnapshotByVideoId(
      videoId: string
    ): Promise<TranscriptSnapshotEntity | null> {
      const collection = database.transcriptSnapshots
        .where("[videoId+updatedAt]")
      const indexedQuery: unknown = (
        collection as unknown as {
          between?: (lower: unknown[], upper: unknown[]) => {
            reverse: () => { first: () => Promise<TranscriptSnapshotEntity | undefined> }
          }
        }
      ).between
      if (typeof indexedQuery === "function") {
        const result = await database.transcriptSnapshots
          .where("[videoId+updatedAt]")
          .between([videoId, ""], [videoId, "￿"])
          .reverse()
          .first()
        return result ?? null
      }

      // Fallback for the test fake which only implements where().equals().toArray().
      const matching = await database.transcriptSnapshots
        .where("videoId")
        .equals(videoId)
        .toArray()
      const sorted = matching
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      return sorted[0] ?? null
    },
    async getCurrentAnalysisByVideoId(videoId: string) {
      const analysisRuns = await database.analysisRuns
        .where("videoId")
        .equals(videoId)
        .toArray()
      const latestRun = byNewest(analysisRuns.map(normalizeAnalysisRun))[0]

      if (!latestRun) {
        return null
      }

      const segments = await database.segmentSummaries
        .where("analysisRunId")
        .equals(latestRun.id)
        .toArray()

      return {
        ...latestRun,
        segments: normalizeSegments(segments).sort((left, right) => left.startSec - right.startSec)
      }
    },
    async listRecentAnalyses(limit = 10) {
      const recentVideos = byNewest(await database.recentVideos.toArray()).slice(0, limit)

      return Promise.all(
        recentVideos.map(async (recentVideo) => ({
          recentVideo,
          analysis: await this.getCurrentAnalysisByVideoId(recentVideo.videoId)
        }))
      )
    },
    async exportLocalData(): Promise<PersistenceExport> {
      const [providerConfigs, transcriptSnapshots, analysisRuns, segmentSummaries, recentVideos] =
        await Promise.all([
          database.providerConfigs.toArray(),
          database.transcriptSnapshots.toArray(),
          database.analysisRuns.toArray(),
          database.segmentSummaries.toArray(),
          database.recentVideos.toArray()
        ])

      return {
        providerConfigs,
        transcriptSnapshots,
        analysisRuns: analysisRuns.map(normalizeAnalysisRun),
        segmentSummaries: normalizeSegments(segmentSummaries),
        recentVideos
      }
    },
    async clearAll() {
      await runTransaction(
        "rw",
        [
          "providerConfigs",
          "transcriptSnapshots",
          "analysisRuns",
          "segmentSummaries",
          "recentVideos"
        ],
        async () => {
          await Promise.all([
            database.providerConfigs.clear(),
            database.transcriptSnapshots.clear(),
            database.analysisRuns.clear(),
            database.segmentSummaries.clear(),
            database.recentVideos.clear()
          ])
        }
      )
    }
  }
}

export const historyRepository = createHistoryRepository()
