import {
  normalizeKnowledgeTimestamp,
  type KnowledgeRepository
} from "@/features/knowledge/lib/knowledge-repository"
import type { KnowledgeItemEntity } from "@/lib/schemas/persistence"
import type { VideoIdentity } from "@/features/platform/types"

export type KnowledgeSnapshot = {
  contentKey: string | null
  items: KnowledgeItemEntity[]
  isLoading: boolean
  error: string | null
}

export type KnowledgeControllerDependencies = {
  repository: Pick<
    KnowledgeRepository,
    | "listByContentKey"
    | "toggleBookmark"
    | "createNote"
    | "updateNote"
    | "deleteItem"
  >
}

export type KnowledgeLoadRequest = {
  identity: VideoIdentity
}

export type KnowledgeBookmarkRequest = {
  identity: VideoIdentity
  videoTitle: string
  timestampSeconds: number
}

export type KnowledgeNoteRequest = {
  identity: VideoIdentity
  videoTitle: string
  text: string
  timestampSeconds?: number | null
}

export type KnowledgeUpdateNoteRequest = {
  id: string
  text: string
}

export type KnowledgeToggleBookmarkResult =
  | { kind: "created"; item: KnowledgeItemEntity }
  | { kind: "removed"; item: KnowledgeItemEntity }

const EMPTY_SNAPSHOT: KnowledgeSnapshot = {
  contentKey: null,
  items: [],
  isLoading: false,
  error: null
}

function sameSnapshot(left: KnowledgeSnapshot, right: KnowledgeSnapshot): boolean {
  if (
    left.contentKey !== right.contentKey
    || left.isLoading !== right.isLoading
    || left.error !== right.error
    || left.items.length !== right.items.length
  ) return false
  return left.items.every((item, index) => item === right.items[index])
}

/**
 * Owns the per-content Knowledge read model and its async load generation.
 *
 * Deliberately React-free and unaware of WorkspaceController: Knowledge is a
 * separate feature collection, so the workspace snapshot never carries it.
 * Every command receives a complete canonical identity; the controller never
 * derives one from a bare `videoId`.
 */
export function createKnowledgeController(dependencies: KnowledgeControllerDependencies) {
  const { repository } = dependencies
  let snapshot: KnowledgeSnapshot = EMPTY_SNAPSHOT
  const listeners = new Set<() => void>()
  let loadGeneration = 0

  function notify() {
    for (const listener of listeners) listener()
  }

  function publish(next: KnowledgeSnapshot): KnowledgeSnapshot {
    if (!sameSnapshot(snapshot, next)) {
      snapshot = next
      notify()
    }
    return snapshot
  }

  function byNewestUpdated(items: KnowledgeItemEntity[]): KnowledgeItemEntity[] {
    return [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async function refresh(contentKey: string, generation: number) {
    try {
      const items = await repository.listByContentKey(contentKey)
      if (generation !== loadGeneration) return
      publish({ contentKey, items: byNewestUpdated(items), isLoading: false, error: null })
    } catch (error) {
      if (generation !== loadGeneration) return
      publish({
        ...snapshot,
        isLoading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    getSnapshot(): KnowledgeSnapshot {
      return snapshot
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    /**
     * Starts a new load generation. A slower earlier load can never overwrite a
     * newer one, and `reset()` invalidates any in-flight load.
     */
    async loadForContent(request: KnowledgeLoadRequest): Promise<KnowledgeSnapshot> {
      const contentKey = request.identity.contentKey
      const generation = ++loadGeneration
      publish({ contentKey, items: [], isLoading: true, error: null })
      await refresh(contentKey, generation)
      return snapshot
    },

    reset(): KnowledgeSnapshot {
      loadGeneration += 1
      return publish({ ...EMPTY_SNAPSHOT })
    },

    /**
     * Point bookmarks dedupe on the normalized whole second within the same
     * contentKey: clicking an existing bookmark second removes it instead of
     * stacking duplicates. Notes never participate in this rule.
     *
     * The check-and-toggle itself lives in the repository, which serializes
     * overlapping calls. This command only republishes the authoritative rows,
     * so an interleaved click can never leave a stale duplicate in the snapshot.
     */
    async toggleBookmark(request: KnowledgeBookmarkRequest): Promise<KnowledgeToggleBookmarkResult> {
      const contentKey = request.identity.contentKey
      const generation = loadGeneration
      const result = await repository.toggleBookmark({
        identity: request.identity,
        videoTitle: request.videoTitle,
        timestampSeconds: normalizeKnowledgeTimestamp(request.timestampSeconds),
      })
      if (generation === loadGeneration) {
        await refresh(contentKey, generation)
      }
      return result
    },

    async createNote(request: KnowledgeNoteRequest): Promise<KnowledgeItemEntity> {
      const contentKey = request.identity.contentKey
      const generation = loadGeneration
      const item = await repository.createNote({
        identity: request.identity,
        videoTitle: request.videoTitle,
        text: request.text,
        timestampSeconds: request.timestampSeconds ?? null,
      })
      if (generation === loadGeneration) {
        publish({
          contentKey,
          items: byNewestUpdated([
            item,
            ...snapshot.items.filter((entry) => entry.id !== item.id && entry.contentKey === contentKey),
          ]),
          isLoading: false,
          error: null,
        })
      }
      return item
    },

    async updateNote(request: KnowledgeUpdateNoteRequest): Promise<KnowledgeItemEntity> {
      const generation = loadGeneration
      const item = await repository.updateNote({ id: request.id, text: request.text })
      if (generation === loadGeneration) {
        publish({
          ...snapshot,
          items: byNewestUpdated(snapshot.items.map((entry) => (
            entry.id === item.id ? item : entry
          ))),
        })
      }
      return item
    },

    async deleteItem(id: string): Promise<void> {
      const generation = loadGeneration
      await repository.deleteItem(id)
      if (generation === loadGeneration) {
        publish({ ...snapshot, items: snapshot.items.filter((item) => item.id !== id) })
      }
    },
  }
}

export type KnowledgeController = ReturnType<typeof createKnowledgeController>
