import { db } from "@/lib/db"
import {
  analysisRunSchema,
  knowledgeItemSchema,
  qaMessageSchema,
  qaThreadSchema,
  segmentSummarySchema,
  videoRecordSchema,
  type AnalysisRunEntity,
  type KnowledgeItemEntity,
  type QaMessageEntity,
  type QaThreadEntity,
  type SegmentSummaryEntity,
  type VideoRecordEntity,
} from "@/lib/schemas/persistence"

/**
 * Read-only search source. Provider configs, API credentials, caches and
 * transcript stores are deliberately absent: they are either secret or not
 * part of the user-visible knowledge domain.
 */
export type SearchRepositoryCandidates = {
  analysisRuns: AnalysisRunEntity[]
  segmentsByRunId: Map<string, SegmentSummaryEntity[]>
  videoRecords: VideoRecordEntity[]
  knowledgeItems: KnowledgeItemEntity[]
  qaThreads: QaThreadEntity[]
  qaMessagesByThreadId: Map<string, QaMessageEntity[]>
}

export type SearchRepository = {
  loadCandidates: () => Promise<SearchRepositoryCandidates>
}

type SearchDatabase = {
  analysisRuns?: { toArray: () => Promise<unknown[]> }
  segmentSummaries?: { toArray: () => Promise<unknown[]> }
  videoRecords?: { toArray: () => Promise<unknown[]> }
  knowledgeItems?: { toArray: () => Promise<unknown[]> }
  qaThreads?: { toArray: () => Promise<unknown[]> }
  qaMessages?: { toArray: () => Promise<unknown[]> }
}

async function readRows(table: SearchDatabase[keyof SearchDatabase]): Promise<unknown[]> {
  if (!table) return []
  return table.toArray()
}

/** Drops rows that no longer satisfy the persisted contract. */
function parseAll<T>(
  rows: unknown[],
  parse: (row: unknown) => T | null,
): T[] {
  const parsed: T[] = []

  for (const row of rows) {
    const value = parse(row)
    if (value) parsed.push(value)
  }

  return parsed
}

function parseWith<T>(schema: { safeParse: (row: unknown) => { success: boolean; data?: T } }) {
  return (row: unknown): T | null => {
    const result = schema.safeParse(row)
    return result.success && result.data ? result.data : null
  }
}

/**
 * Loads every searchable source. The caller decides whether a query is worth
 * a scan; an empty query never reaches this boundary.
 */
export function createSearchRepository(database: SearchDatabase = db as SearchDatabase): SearchRepository {
  return {
    async loadCandidates(): Promise<SearchRepositoryCandidates> {
      const [analysisRuns, segmentSummaries, videoRecords, knowledgeItems, qaThreads, qaMessages] =
        await Promise.all([
          readRows(database.analysisRuns),
          readRows(database.segmentSummaries),
          readRows(database.videoRecords),
          readRows(database.knowledgeItems),
          readRows(database.qaThreads),
          readRows(database.qaMessages),
        ])

      const completedRuns = parseAll(analysisRuns, parseWith<AnalysisRunEntity>(analysisRunSchema))
        .filter((run) => run.status === "completed")

      const completedRunIds = new Set(completedRuns.map((run) => run.id))

      const segmentsByRunId = new Map<string, SegmentSummaryEntity[]>()
      for (const segment of parseAll(
        segmentSummaries,
        parseWith<SegmentSummaryEntity>(segmentSummarySchema),
      )) {
        if (!completedRunIds.has(segment.analysisRunId)) continue
        const bucket = segmentsByRunId.get(segment.analysisRunId) ?? []
        bucket.push(segment)
        segmentsByRunId.set(segment.analysisRunId, bucket)
      }

      const qaMessagesByThreadId = new Map<string, QaMessageEntity[]>()
      for (const message of parseAll(qaMessages, parseWith<QaMessageEntity>(qaMessageSchema))) {
        const bucket = qaMessagesByThreadId.get(message.threadId) ?? []
        bucket.push(message)
        qaMessagesByThreadId.set(message.threadId, bucket)
      }

      for (const bucket of qaMessagesByThreadId.values()) {
        bucket.sort((left, right) => left.sequence - right.sequence)
      }

      return {
        analysisRuns: completedRuns,
        segmentsByRunId,
        videoRecords: parseAll(videoRecords, parseWith<VideoRecordEntity>(videoRecordSchema)),
        knowledgeItems: parseAll(
          knowledgeItems,
          parseWith<KnowledgeItemEntity>(knowledgeItemSchema),
        ),
        qaThreads: parseAll(qaThreads, parseWith<QaThreadEntity>(qaThreadSchema)),
        qaMessagesByThreadId,
      }
    },
  }
}

export const searchRepository = createSearchRepository()
