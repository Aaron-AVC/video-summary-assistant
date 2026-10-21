import { db } from "@/lib/db"
import { runWriteWithQuotaGuard } from "@/lib/db/errors"
import {
  knowledgeItemSchema,
  type KnowledgeItemEntity
} from "@/lib/schemas/persistence"
import type { VideoIdentity } from "@/features/platform/types"

export type KnowledgeCreateIdentity = {
  identity: VideoIdentity
  videoTitle: string
}

export type KnowledgeRepositoryOptions = {
  now?: () => string
  randomId?: () => string
}

export type CreateBookmarkInput = KnowledgeCreateIdentity & {
  timestampSeconds: number
  analysisRunId?: string | null
}

export type CreateNoteInput = KnowledgeCreateIdentity & {
  text: string
  timestampSeconds?: number | null
  analysisRunId?: string | null
}

export type UpdateKnowledgeNoteInput = {
  id: string
  text: string
}

export type ToggleBookmarkResult =
  | { kind: "created"; item: KnowledgeItemEntity }
  | { kind: "removed"; item: KnowledgeItemEntity }

/**
 * Normalizes a playback timestamp into the exact second used for Bookmark
 * identity so repeated clicks at the same position dedupe deterministically.
 */
export function normalizeKnowledgeTimestamp(timestampSeconds: number): number {
  if (!Number.isFinite(timestampSeconds)) return 0
  return Math.max(0, Math.floor(timestampSeconds))
}

function byNewestUpdated<T extends { updatedAt: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

function parseRow(row: unknown): KnowledgeItemEntity | null {
  const parsed = knowledgeItemSchema.safeParse(row)
  return parsed.success ? parsed.data : null
}

export function createKnowledgeRepository(
  database = db,
  options: KnowledgeRepositoryOptions = {}
) {
  const now = options.now ?? (() => new Date().toISOString())
  const randomId = options.randomId ?? (() => crypto.randomUUID())

  const stores = database as typeof database & {
    knowledgeItems?: typeof database.knowledgeItems
  }

  async function allRows(): Promise<unknown[]> {
    return stores.knowledgeItems ? await stores.knowledgeItems.toArray() : []
  }

  /**
   * Serializes toggles that target the same `contentKey` + whole second. Two
   * overlapping calls therefore run one after another: the second one observes
   * the row the first one persisted instead of racing it into a duplicate.
   */
  const toggleQueues = new Map<string, Promise<unknown>>()

  function enqueueToggle<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = toggleQueues.get(key) ?? Promise.resolve()
    const next = previous.then(task, task)
    const settled = next.then(
      () => undefined,
      () => undefined
    )
    toggleQueues.set(key, settled)
    void settled.then(() => {
      if (toggleQueues.get(key) === settled) toggleQueues.delete(key)
    })
    return next
  }

  const repository = {
    /**
     * Strict `contentKey` filter. Bilibili `p1` and `p2` never mix because the
     * canonical key carries the part suffix.
     */
    async listByContentKey(contentKey: string): Promise<KnowledgeItemEntity[]> {
      const rows = (await allRows()).flatMap((row) => {
        const parsed = parseRow(row)
        if (!parsed || parsed.contentKey !== contentKey) return []
        return [parsed]
      })
      return byNewestUpdated(rows)
    },

    async findById(id: string): Promise<KnowledgeItemEntity | null> {
      return parseRow(await stores.knowledgeItems?.get(id))
    },

    async createBookmark(input: CreateBookmarkInput): Promise<KnowledgeItemEntity> {
      const timestamp = normalizeKnowledgeTimestamp(input.timestampSeconds)
      const item = knowledgeItemSchema.parse({
        id: randomId(),
        kind: "bookmark",
        contentKey: input.identity.contentKey,
        platform: input.identity.platform,
        videoId: input.identity.videoId,
        partId: input.identity.partId ?? null,
        videoTitle: input.videoTitle,
        analysisRunId: input.analysisRunId ?? null,
        startSec: timestamp,
        endSec: timestamp,
        text: null,
        createdAt: now(),
        updatedAt: now()
      } satisfies KnowledgeItemEntity)
      return runWriteWithQuotaGuard(async () => {
        await stores.knowledgeItems!.put(item)
        return item
      })
    },

    async createNote(input: CreateNoteInput): Promise<KnowledgeItemEntity> {
      const anchored = typeof input.timestampSeconds === "number"
      const timestamp = anchored ? normalizeKnowledgeTimestamp(input.timestampSeconds!) : null
      const timestampNow = now()
      const item = knowledgeItemSchema.parse({
        id: randomId(),
        kind: "note",
        contentKey: input.identity.contentKey,
        platform: input.identity.platform,
        videoId: input.identity.videoId,
        partId: input.identity.partId ?? null,
        videoTitle: input.videoTitle,
        analysisRunId: input.analysisRunId ?? null,
        startSec: timestamp,
        endSec: timestamp,
        text: input.text.trim(),
        createdAt: timestampNow,
        updatedAt: timestampNow
      } satisfies KnowledgeItemEntity)
      return runWriteWithQuotaGuard(async () => {
        await stores.knowledgeItems!.put(item)
        return item
      })
    },

    /**
     * Only `text` and `updatedAt` may change. Identity, anchor, binding, and
     * `createdAt` are read back from the persisted row.
     */
    async updateNote(input: UpdateKnowledgeNoteInput): Promise<KnowledgeItemEntity> {
      const existing = parseRow(await stores.knowledgeItems?.get(input.id))
      if (!existing) {
        throw new Error("Knowledge note not found.")
      }
      if (existing.kind !== "note") {
        throw new Error("Only notes can be edited.")
      }
      const next = knowledgeItemSchema.parse({
        ...existing,
        text: input.text.trim(),
        updatedAt: now()
      } satisfies KnowledgeItemEntity)
      return runWriteWithQuotaGuard(async () => {
        await stores.knowledgeItems!.put(next)
        return next
      })
    },

    async deleteItem(id: string): Promise<void> {
      await runWriteWithQuotaGuard(async () => {
        await stores.knowledgeItems?.delete(id)
      })
    },

    async deleteByContentKey(contentKey: string): Promise<void> {
      const rows = (await allRows()).flatMap((row) => {
        const parsed = parseRow(row)
        return parsed && parsed.contentKey === contentKey ? [parsed.id] : []
      })
      if (rows.length === 0) return
      await runWriteWithQuotaGuard(async () => {
        await stores.knowledgeItems?.bulkDelete(rows)
      })
    },

    async clearAll(): Promise<void> {
      await runWriteWithQuotaGuard(async () => {
        await stores.knowledgeItems?.clear()
      })
    },

    /**
     * Atomic point-bookmark toggle. The decision reads persisted rows rather
     * than any caller-side snapshot, so overlapping clicks at the same second
     * can neither create duplicates nor skip a removal.
     */
    async toggleBookmark(input: CreateBookmarkInput): Promise<ToggleBookmarkResult> {
      const contentKey = input.identity.contentKey
      const timestamp = normalizeKnowledgeTimestamp(input.timestampSeconds)
      return enqueueToggle(`${contentKey}@${timestamp}`, async () => {
        const existing = (await repository.listByContentKey(contentKey)).find(
          (entry) => entry.kind === "bookmark" && entry.startSec === timestamp
        )
        if (existing) {
          await repository.deleteItem(existing.id)
          return { kind: "removed" as const, item: existing }
        }
        const created = await repository.createBookmark(input)
        return { kind: "created" as const, item: created }
      })
    }
  }

  return repository
}

export type KnowledgeRepository = ReturnType<typeof createKnowledgeRepository>

export const knowledgeRepository = createKnowledgeRepository()
