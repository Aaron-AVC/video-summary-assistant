import { db, withDatabaseTransaction } from "@/lib/db"
import { runWriteWithQuotaGuard } from "@/lib/db/errors"
import { sanitizeProviderConfigForExport } from "@/lib/export/provider-config-export"
import type { DatabaseSchema } from "@/lib/db/schema"
import {
  RECENT_VIDEOS_RETENTION_LIMIT,
  TRANSCRIPT_RAW_VTT_RETENTION_DAYS
} from "@/lib/db/schema"
import {
  analysisRunSchema,
  segmentSummarySchema,
  analysisCacheSchema,
  qaAnswerSchema,
  transcriptCacheSchema,
  videoRecordSchema
} from "@/lib/schemas/persistence"
import type {
  AnalysisCacheEntity,
  QaAnswerEntity,
  TranscriptCacheEntity,
  VideoRecordEntity
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
    async saveTranscriptCache(input: TranscriptCacheEntity) {
      const parsed = transcriptCacheSchema.parse(input)
      const cacheTable = (database as typeof database & { transcriptCache?: typeof database.transcriptSnapshots }).transcriptCache
      if (!cacheTable) return parsed
      return runWriteWithQuotaGuard(async () => {
        await cacheTable.put(parsed)
        return parsed
      })
    },
    async getLatestTranscriptByContentKey(contentKey: string) {
      const cacheTable = (database as typeof database & { transcriptCache?: typeof database.transcriptSnapshots }).transcriptCache
      const parsed = cacheTable
        ? (await cacheTable.toArray())
          .filter((row) => (row as TranscriptCacheEntity).contentKey === contentKey)
          .flatMap((row) => {
            try { return [transcriptCacheSchema.parse(row)] } catch { return [] }
          })
        : []
      const cached = byNewest(parsed)[0]
      if (cached) return cached
      if (contentKey.startsWith("youtube:")) {
        const videoId = contentKey.slice("youtube:".length)
        const legacy = await this.getLatestTranscriptSnapshotByVideoId(videoId)
        if (legacy) {
          return {
            ...legacy,
            platform: "youtube" as const,
            contentKey,
            partId: null,
            fingerprint: null
          }
        }
      }
      return null
    },
    async saveVideoRecord(input: VideoRecordEntity) {
      const parsed = videoRecordSchema.parse(input)
      const table = (database as typeof database & { videoRecords?: typeof database.recentVideos }).videoRecords
      if (!table) return parsed
      return runWriteWithQuotaGuard(async () => { await table.put(parsed); return parsed })
    },
    async saveAnalysisCache(input: AnalysisCacheEntity) {
      const parsed = analysisCacheSchema.parse(input)
      const table = (database as typeof database & { analysisCache?: typeof database.analysisRuns }).analysisCache
      if (!table) return parsed
      return runWriteWithQuotaGuard(async () => { await table.put(parsed); return parsed })
    },
    async getAnalysisCache(cacheKey: string) {
      const table = (database as typeof database & { analysisCache?: typeof database.analysisRuns }).analysisCache
      if (!table) return null
      const row = await table.get(cacheKey)
      if (!row) return null
      try { return analysisCacheSchema.parse(row) } catch { return null }
    },
    async saveQaAnswer(input: QaAnswerEntity) {
      const parsed = qaAnswerSchema.parse(input)
      const table = (database as typeof database & { qaAnswers?: typeof database.analysisRuns }).qaAnswers
      if (!table) return parsed
      return runWriteWithQuotaGuard(async () => { await table.put(parsed); return parsed })
    },
    async getQaAnswer(cacheKey: string) {
      const table = (database as typeof database & { qaAnswers?: typeof database.analysisRuns }).qaAnswers
      if (!table) return null
      const row = await table.get(cacheKey)
      if (!row) return null
      try { return qaAnswerSchema.parse(row) } catch { return null }
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
    async getCurrentAnalysisByContentKey(contentKey: string) {
      const analysisRuns = (await database.analysisRuns.toArray()).filter(
        (row) => (row as AnalysisRunEntity & { contentKey?: string }).contentKey === contentKey
      )
      if (analysisRuns.length > 0) {
        const latestRun = byNewest(analysisRuns.map(normalizeAnalysisRun))[0]
        if (!latestRun) return null
        const segments = await database.segmentSummaries
          .where("analysisRunId")
          .equals(latestRun.id)
          .toArray()
        return { ...latestRun, segments: normalizeSegments(segments).sort((left, right) => left.startSec - right.startSec) }
      }
      const table = (database as typeof database & { analysisCache?: typeof database.analysisRuns }).analysisCache
      if (!table) {
        if (contentKey.startsWith("youtube:")) {
          const legacy = await this.getCurrentAnalysisByVideoId(contentKey.slice("youtube:".length))
          return legacy ? {
            ...legacy,
            platform: "youtube" as const,
            contentKey,
            partId: null
          } : null
        }
        return null
      }
      const rows = (await table.toArray()).filter(
        (row) => (row as AnalysisCacheEntity).contentKey === contentKey
      )
      const parsed = rows.flatMap((row) => {
        try { return [analysisCacheSchema.parse(row)] } catch { return [] }
      })
      const latest = byNewest(parsed).find((row) => row.analysis)
      if (!latest?.analysis && contentKey.startsWith("youtube:")) {
        const legacy = await this.getCurrentAnalysisByVideoId(contentKey.slice("youtube:".length))
        return legacy ? {
          ...legacy,
          platform: "youtube" as const,
          contentKey,
          partId: null
        } : null
      }
      return latest?.analysis ? {
        id: latest.analysisRunId ?? latest.cacheKey,
        videoId: latest.videoId,
        contentKey: latest.contentKey,
        platform: latest.platform,
        partId: latest.partId,
        summary: latest.analysis.summary,
        keyPoints: latest.analysis.keyPoints,
        topics: [],
        segments: latest.analysis.chapters.map((chapter, index) => ({
          id: `${latest.cacheKey}:chapter:${index}`,
          analysisRunId: latest.analysisRunId ?? latest.cacheKey,
          videoId: latest.videoId,
          title: chapter.title,
          summary: chapter.summary,
          detail: chapter.detail,
          startSec: chapter.startSec,
          endSec: chapter.endSec,
          createdAt: latest.createdAt,
          updatedAt: latest.updatedAt
        })),
        transcriptSnapshotId: "",
        providerConfigId: latest.providerProfileId,
        status: "completed" as const,
        errorMessage: null,
        createdAt: latest.createdAt,
        updatedAt: latest.updatedAt,
        completedAt: latest.updatedAt
      } : null
    },
    async listRecentAnalyses(limit = 10) {
      const recentVideos = byNewest(await database.recentVideos.toArray()).slice(0, limit)
      const legacyEntries = await Promise.all(
        recentVideos.map(async (recentVideo) => ({
          recentVideo,
          analysis: await this.getCurrentAnalysisByVideoId(recentVideo.videoId)
        }))
      )
      const recordsTable = (database as typeof database & { videoRecords?: typeof database.recentVideos }).videoRecords
      const cacheTable = (database as typeof database & { analysisCache?: typeof database.analysisRuns }).analysisCache
      if (!recordsTable || !cacheTable) return legacyEntries
      const records = await recordsTable.toArray()
      const caches = (await cacheTable.toArray()).flatMap((row) => {
        try { return [analysisCacheSchema.parse(row)] } catch { return [] }
      })
      const canonicalEntries = records.flatMap((record) => {
        const parsedRecord = (() => { try { return videoRecordSchema.parse(record) } catch { return null } })()
        if (!parsedRecord) return []
        const analysis = byNewest(caches.filter((row) => row.contentKey === parsedRecord.contentKey && row.analysis))[0]
        if (!analysis?.analysis) return []
        return [{
          recentVideo: {
            videoId: parsedRecord.videoId,
            contentKey: parsedRecord.contentKey,
            platform: parsedRecord.platform,
            partId: parsedRecord.partId,
            title: parsedRecord.title,
            channelTitle: parsedRecord.channelTitle,
            thumbnailUrl: parsedRecord.thumbnailUrl,
            status: "completed" as const,
            updatedAt: parsedRecord.updatedAt,
            openedAt: parsedRecord.openedAt,
            analyzedAt: parsedRecord.analyzedAt
          },
          analysis: {
            ...analysis,
            summary: analysis.analysis.summary,
            videoId: parsedRecord.videoId,
            contentKey: parsedRecord.contentKey,
            platform: parsedRecord.platform
          }
        }]
      })
      return [...legacyEntries, ...canonicalEntries]
        .sort((left, right) => right.recentVideo.updatedAt.localeCompare(left.recentVideo.updatedAt))
        .slice(0, limit)
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

      const optionalRows = async (name: string) => {
        const table = (database as unknown as Record<string, { toArray: () => Promise<unknown[]> }>)[name]
        return table ? await table.toArray() : []
      }
      const videoRecords = (await optionalRows("videoRecords")).flatMap((row) => {
        try { return [videoRecordSchema.parse(row)] } catch { return [] }
      })
      const transcriptCache = (await optionalRows("transcriptCache")).flatMap((row) => {
        try { return [transcriptCacheSchema.parse(row)] } catch { return [] }
      })
      const analysisCache = (await optionalRows("analysisCache")).flatMap((row) => {
        try { return [analysisCacheSchema.parse(row)] } catch { return [] }
      })
      const qaAnswers = (await optionalRows("qaAnswers")).flatMap((row) => {
        try { return [qaAnswerSchema.parse(row)] } catch { return [] }
      })
      return {
        providerConfigs: providerConfigs.map(sanitizeProviderConfigForExport),
        transcriptSnapshots,
        analysisRuns: analysisRuns.map(normalizeAnalysisRun),
        segmentSummaries: normalizeSegments(segmentSummaries),
        recentVideos,
        videoRecords,
        transcriptCache,
        analysisCache,
        qaAnswers
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
          ,"videoRecords", "transcriptCache", "analysisCache", "qaAnswers"
        ],
        async () => {
          await Promise.all([
            database.providerConfigs.clear(),
            database.transcriptSnapshots.clear(),
            database.analysisRuns.clear(),
            database.segmentSummaries.clear(),
            database.recentVideos.clear()
            ,(database as typeof database & { videoRecords?: typeof database.recentVideos }).videoRecords?.clear()
            ,(database as typeof database & { transcriptCache?: typeof database.transcriptSnapshots }).transcriptCache?.clear()
            ,(database as typeof database & { analysisCache?: typeof database.analysisRuns }).analysisCache?.clear()
            ,(database as typeof database & { qaAnswers?: typeof database.analysisRuns }).qaAnswers?.clear()
          ])
        }
      )
    }
  }
}

export const historyRepository = createHistoryRepository()
