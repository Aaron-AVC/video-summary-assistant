import { describe, expect, it } from "bun:test"

import type { KnowledgeRepository } from "@/features/knowledge/lib/knowledge-repository"
import { createKnowledgeController } from "@/sidepanel/knowledge/knowledge-controller"
import type { KnowledgeItemEntity } from "@/lib/schemas/persistence"

const identity = (contentKey: string, partId: string | null = null) => ({
  contentKey,
  platform: contentKey.startsWith("bilibili") ? ("bilibili" as const) : ("youtube" as const),
  videoId: contentKey.split(":")[1]?.split(":")[0] ?? "video",
  partId,
})

function item(overrides: Partial<KnowledgeItemEntity> = {}): KnowledgeItemEntity {
  return {
    id: "item-1",
    kind: "bookmark",
    contentKey: "youtube:video-a",
    platform: "youtube",
    videoId: "video-a",
    partId: null,
    videoTitle: "Video A",
    analysisRunId: null,
    startSec: 10,
    endSec: 10,
    text: null,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    ...overrides,
  }
}

type RepositoryCalls = {
  listByContentKey: string[]
  toggleBookmark: Array<{ contentKey: string; timestampSeconds: number }>
  createBookmark: Array<{ contentKey: string; timestampSeconds: number }>
  createNote: Array<{ contentKey: string; text: string; timestampSeconds: number | null }>
  updateNote: Array<{ id: string; text: string }>
  deleteItem: string[]
}

function createController(overrides: Partial<KnowledgeRepository> = {}) {
  const calls: RepositoryCalls = {
    listByContentKey: [],
    toggleBookmark: [],
    createBookmark: [],
    createNote: [],
    updateNote: [],
    deleteItem: [],
  }
  let sequence = 0
  const rows: KnowledgeItemEntity[] = []

  const repository = {
    async listByContentKey(contentKey: string) {
      calls.listByContentKey.push(contentKey)
      if (overrides.listByContentKey) return overrides.listByContentKey(contentKey)
      return rows
        .filter((row) => row.contentKey === contentKey)
        .map((row) => ({ ...row }))
    },
    async createBookmark(input: Parameters<KnowledgeRepository["createBookmark"]>[0]) {
      calls.createBookmark.push({
        contentKey: input.identity.contentKey,
        timestampSeconds: input.timestampSeconds,
      })
      if (overrides.createBookmark) return overrides.createBookmark(input)
      const row = item({
        id: `bookmark-${++sequence}`,
        contentKey: input.identity.contentKey,
        platform: input.identity.platform,
        videoId: input.identity.videoId,
        partId: input.identity.partId ?? null,
        videoTitle: input.videoTitle,
        startSec: Math.floor(input.timestampSeconds),
        endSec: Math.floor(input.timestampSeconds),
        createdAt: `2026-10-20T00:00:0${sequence}.000Z`,
        updatedAt: `2026-10-20T00:00:0${sequence}.000Z`,
      })
      rows.push(row)
      return { ...row }
    },
    async toggleBookmark(input: Parameters<KnowledgeRepository["toggleBookmark"]>[0]) {
      calls.toggleBookmark.push({
        contentKey: input.identity.contentKey,
        timestampSeconds: input.timestampSeconds,
      })
      if (overrides.toggleBookmark) return overrides.toggleBookmark(input)
      const timestamp = Math.floor(input.timestampSeconds)
      const index = rows.findIndex(
        (row) =>
          row.kind === "bookmark" &&
          row.contentKey === input.identity.contentKey &&
          row.startSec === timestamp
      )
      if (index >= 0) {
        const [removed] = rows.splice(index, 1)
        calls.deleteItem.push(removed.id)
        return { kind: "removed" as const, item: { ...removed } }
      }
      const row = item({
        id: `bookmark-${++sequence}`,
        contentKey: input.identity.contentKey,
        platform: input.identity.platform,
        videoId: input.identity.videoId,
        partId: input.identity.partId ?? null,
        videoTitle: input.videoTitle,
        startSec: timestamp,
        endSec: timestamp,
        createdAt: `2026-10-20T00:00:0${sequence}.000Z`,
        updatedAt: `2026-10-20T00:00:0${sequence}.000Z`,
      })
      calls.createBookmark.push({
        contentKey: input.identity.contentKey,
        timestampSeconds: timestamp,
      })
      rows.push(row)
      return { kind: "created" as const, item: { ...row } }
    },
    async createNote(input: Parameters<KnowledgeRepository["createNote"]>[0]) {
      calls.createNote.push({
        contentKey: input.identity.contentKey,
        text: input.text,
        timestampSeconds: input.timestampSeconds ?? null,
      })
      if (overrides.createNote) return overrides.createNote(input)
      const row = item({
        id: `note-${++sequence}`,
        kind: "note",
        contentKey: input.identity.contentKey,
        platform: input.identity.platform,
        videoId: input.identity.videoId,
        partId: input.identity.partId ?? null,
        videoTitle: input.videoTitle,
        text: input.text,
        startSec: input.timestampSeconds ?? null,
        endSec: input.timestampSeconds ?? null,
        createdAt: `2026-10-20T00:00:0${sequence}.000Z`,
        updatedAt: `2026-10-20T00:00:0${sequence}.000Z`,
      })
      rows.push(row)
      return { ...row }
    },
    async updateNote(input: { id: string; text: string }) {
      calls.updateNote.push(input)
      if (overrides.updateNote) return overrides.updateNote(input)
      const index = rows.findIndex((row) => row.id === input.id)
      const next = { ...rows[index], text: input.text, updatedAt: "2026-10-21T00:00:00.000Z" }
      rows[index] = next
      return { ...next }
    },
    async deleteItem(id: string) {
      calls.deleteItem.push(id)
      if (overrides.deleteItem) return overrides.deleteItem(id)
      const index = rows.findIndex((row) => row.id === id)
      if (index >= 0) rows.splice(index, 1)
    },
  } as unknown as KnowledgeRepository

  const controller = createKnowledgeController({ repository })
  return { controller, calls, rows }
}

describe("KnowledgeController", () => {
  it("starts with an empty snapshot", () => {
    const { controller } = createController()
    expect(controller.getSnapshot()).toEqual({
      contentKey: null,
      items: [],
      isLoading: false,
      error: null,
    })
  })

  it("loads the exact contentKey", async () => {
    const { controller, rows } = createController()
    rows.push(item({ id: "a", contentKey: "youtube:video-a" }))

    const snapshot = await controller.loadForContent({ identity: identity("youtube:video-a") })

    expect(snapshot.contentKey).toBe("youtube:video-a")
    expect(snapshot.items.map((entry) => entry.id)).toEqual(["a"])
    expect(snapshot.isLoading).toBe(false)
    expect(snapshot.error).toBeNull()
  })

  it("isolates YouTube videos", async () => {
    const { controller, rows } = createController()
    rows.push(item({ id: "a", contentKey: "youtube:video-a" }))
    rows.push(item({ id: "b", contentKey: "youtube:video-b" }))

    await controller.loadForContent({ identity: identity("youtube:video-a") })
    expect(controller.getSnapshot().items.map((entry) => entry.id)).toEqual(["a"])

    await controller.loadForContent({ identity: identity("youtube:video-b") })
    expect(controller.getSnapshot().items.map((entry) => entry.id)).toEqual(["b"])
  })

  it("isolates Bilibili p1 and p2", async () => {
    const { controller, rows } = createController()
    rows.push(item({ id: "p1", contentKey: "bilibili:BV1xx:p:1", platform: "bilibili", partId: "1" }))
    rows.push(item({ id: "p2", contentKey: "bilibili:BV1xx:p:2", platform: "bilibili", partId: "2" }))

    await controller.loadForContent({ identity: identity("bilibili:BV1xx:p:1", "1") })
    expect(controller.getSnapshot().items.map((entry) => entry.id)).toEqual(["p1"])

    await controller.loadForContent({ identity: identity("bilibili:BV1xx:p:2", "2") })
    expect(controller.getSnapshot().items.map((entry) => entry.id)).toEqual(["p2"])
  })

  it("rejects a stale load that finishes after a newer one", async () => {
    let releaseFirst: (() => void) | null = null
    const { controller } = createController({
      async listByContentKey(contentKey: string) {
        if (contentKey === "youtube:video-a") {
          await new Promise<void>((resolve) => { releaseFirst = resolve })
          return [item({ id: "a", contentKey }) as never]
        }
        return [item({ id: "b", contentKey }) as never]
      },
    })

    const first = controller.loadForContent({ identity: identity("youtube:video-a") })
    const second = controller.loadForContent({ identity: identity("youtube:video-b") })
    await second
    releaseFirst?.()
    await first

    expect(controller.getSnapshot().contentKey).toBe("youtube:video-b")
    expect(controller.getSnapshot().items.map((entry) => entry.id)).toEqual(["b"])
  })

  it("reset invalidates a pending load so it cannot republish", async () => {
    let release: (() => void) | null = null
    const { controller } = createController({
      async listByContentKey(contentKey: string) {
        await new Promise<void>((resolve) => { release = resolve })
        return [item({ id: "a", contentKey }) as never]
      },
    })

    const pending = controller.loadForContent({ identity: identity("youtube:video-a") })
    const resetSnapshot = controller.reset()
    expect(resetSnapshot).toEqual({
      contentKey: null,
      items: [],
      isLoading: false,
      error: null,
    })
    release?.()
    await pending

    expect(controller.getSnapshot().contentKey).toBeNull()
    expect(controller.getSnapshot().items).toEqual([])
  })

  it("creates a bookmark at the normalized current second", async () => {
    const { controller, calls } = createController()
    await controller.loadForContent({ identity: identity("youtube:video-a") })

    const result = await controller.toggleBookmark({
      identity: identity("youtube:video-a"),
      videoTitle: "Video A",
      timestampSeconds: 12.9,
    })

    expect(result.kind).toBe("created")
    expect(calls.createBookmark).toEqual([
      { contentKey: "youtube:video-a", timestampSeconds: 12 },
    ])
    expect(controller.getSnapshot().items).toHaveLength(1)
    expect(controller.getSnapshot().items[0].startSec).toBe(12)
  })

  it("toggles off a repeat bookmark at the same normalized second", async () => {
    const { controller, calls } = createController()
    await controller.loadForContent({ identity: identity("youtube:video-a") })

    const first = await controller.toggleBookmark({
      identity: identity("youtube:video-a"),
      videoTitle: "Video A",
      timestampSeconds: 30.4,
    })
    const second = await controller.toggleBookmark({
      identity: identity("youtube:video-a"),
      videoTitle: "Video A",
      timestampSeconds: 30.9,
    })

    expect(first.kind).toBe("created")
    expect(second.kind).toBe("removed")
    expect(calls.deleteItem).toEqual([(first as { item: KnowledgeItemEntity }).item.id])
    expect(controller.getSnapshot().items).toEqual([])
  })

  it("keeps bookmarks on different seconds separate", async () => {
    const { controller } = createController()
    await controller.loadForContent({ identity: identity("youtube:video-a") })

    await controller.toggleBookmark({
      identity: identity("youtube:video-a"),
      videoTitle: "Video A",
      timestampSeconds: 10,
    })
    await controller.toggleBookmark({
      identity: identity("youtube:video-a"),
      videoTitle: "Video A",
      timestampSeconds: 11,
    })

    expect(controller.getSnapshot().items).toHaveLength(2)
  })

  it("creates an unanchored note", async () => {
    const { controller, calls } = createController()
    await controller.loadForContent({ identity: identity("youtube:video-a") })

    await controller.createNote({
      identity: identity("youtube:video-a"),
      videoTitle: "Video A",
      text: "free form",
    })

    expect(calls.createNote).toEqual([{
      contentKey: "youtube:video-a",
      text: "free form",
      timestampSeconds: null,
    }])
    expect(controller.getSnapshot().items[0].startSec).toBeNull()
  })

  it("creates a timestamped note", async () => {
    const { controller, calls } = createController()
    await controller.loadForContent({ identity: identity("youtube:video-a") })

    await controller.createNote({
      identity: identity("youtube:video-a"),
      videoTitle: "Video A",
      text: "anchored",
      timestampSeconds: 5,
    })

    expect(calls.createNote[0].timestampSeconds).toBe(5)
    expect(controller.getSnapshot().items[0].startSec).toBe(5)
  })

  it("updates only note text and updatedAt", async () => {
    const { controller, rows } = createController()
    await controller.loadForContent({ identity: identity("youtube:video-a") })
    const note = await controller.createNote({
      identity: identity("youtube:video-a"),
      videoTitle: "Video A",
      text: "before",
      timestampSeconds: 8,
    })

    const updated = await controller.updateNote({ id: note.id, text: "after" })

    expect(updated.text).toBe("after")
    expect(updated.startSec).toBe(8)
    expect(updated.endSec).toBe(8)
    expect(updated.contentKey).toBe("youtube:video-a")
    expect(rows[0].text).toBe("after")
  })

  it("deletes an item", async () => {
    const { controller, calls } = createController()
    await controller.loadForContent({ identity: identity("youtube:video-a") })
    const created = await controller.createNote({
      identity: identity("youtube:video-a"),
      videoTitle: "Video A",
      text: "delete me",
    })

    await controller.deleteItem(created.id)

    expect(calls.deleteItem).toEqual([created.id])
    expect(controller.getSnapshot().items).toEqual([])
  })

  it("does not rely on its own snapshot while overlapping toggles are unresolved", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let toggles = 0
    const { controller, rows } = createController({
      async toggleBookmark(input: Parameters<KnowledgeRepository["toggleBookmark"]>[0]) {
        toggles += 1
        await gate
        const timestamp = Math.floor(input.timestampSeconds)
        const index = rows.findIndex(
          (row) =>
            row.kind === "bookmark" &&
            row.contentKey === input.identity.contentKey &&
            row.startSec === timestamp
        )
        if (index >= 0) {
          const [removed] = rows.splice(index, 1)
          return { kind: "removed" as const, item: { ...removed } }
        }
        const row = item({
          id: `bookmark-${toggles}`,
          contentKey: input.identity.contentKey,
          startSec: timestamp,
          endSec: timestamp,
        })
        rows.push(row)
        return { kind: "created" as const, item: { ...row } }
      },
    })
    await controller.loadForContent({ identity: identity("youtube:video-a") })

    const first = controller.toggleBookmark({
      identity: identity("youtube:video-a"),
      videoTitle: "Video A",
      timestampSeconds: 12.4,
    })
    const second = controller.toggleBookmark({
      identity: identity("youtube:video-a"),
      videoTitle: "Video A",
      timestampSeconds: 12.8,
    })

    release()
    const results = await Promise.all([first, second])

    expect(results.map((entry) => entry.kind)).toEqual(["created", "removed"])
    expect(controller.getSnapshot().items).toEqual([])
    expect(rows.filter((row) => row.kind === "bookmark")).toHaveLength(0)
  })

  it("keeps the authoritative contentKey and recovers after a failed reload", async () => {
    let shouldFail = false
    const { controller, rows } = createController({
      async listByContentKey(contentKey: string) {
        if (shouldFail) throw new Error("db down")
        return rows
          .filter((row) => row.contentKey === contentKey)
          .map((row) => ({ ...row }))
      },
    })
    rows.push(item({ id: "a", contentKey: "youtube:video-a" }))
    const valid = await controller.loadForContent({ identity: identity("youtube:video-a") })
    expect(valid.items.map((entry) => entry.id)).toEqual(["a"])

    // The same controller transitions from a valid snapshot to a failure: the
    // published contentKey must still name the content that was being loaded.
    shouldFail = true
    const failed = await controller.loadForContent({ identity: identity("youtube:video-a") })
    expect(failed).toEqual({
      contentKey: "youtube:video-a",
      items: [],
      isLoading: false,
      error: "db down",
    })
    expect(controller.getSnapshot()).toEqual(failed)

    shouldFail = false
    const recovered = await controller.loadForContent({ identity: identity("youtube:video-a") })
    expect(recovered.error).toBeNull()
    expect(recovered.items.map((entry) => entry.id)).toEqual(["a"])
  })

  it("notifies subscribers once per published snapshot", async () => {
    const { controller, rows } = createController()
    rows.push(item({ id: "a", contentKey: "youtube:video-a" }))
    let notifications = 0
    const unsubscribe = controller.subscribe(() => { notifications += 1 })

    await controller.loadForContent({ identity: identity("youtube:video-a") })
    const afterLoad = notifications
    expect(afterLoad).toBeGreaterThan(0)

    unsubscribe()
    await controller.loadForContent({ identity: identity("youtube:video-a") })
    expect(notifications).toBe(afterLoad)
  })
})
