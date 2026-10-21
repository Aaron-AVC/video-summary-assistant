import { describe, expect, it } from "bun:test"

import {
  normalizeKnowledgeTimestamp,
  createKnowledgeRepository,
} from "@/features/knowledge/lib/knowledge-repository"
import { PersistenceError } from "@/lib/db/errors"
import type { KnowledgeItemEntity } from "@/lib/schemas/persistence"

type FakeTable = {
  rows: KnowledgeItemEntity[]
  putShouldThrow: unknown
}

function createDatabase() {
  const table: FakeTable = { rows: [], putShouldThrow: null }

  const database = {
    knowledgeItems: {
      async toArray() {
        return table.rows.map((row) => ({ ...row }))
      },
      async get(id: string) {
        const row = table.rows.find((entry) => entry.id === id)
        return row ? { ...row } : undefined
      },
      async put(row: KnowledgeItemEntity) {
        if (table.putShouldThrow) throw table.putShouldThrow
        const index = table.rows.findIndex((entry) => entry.id === row.id)
        if (index >= 0) table.rows[index] = { ...row }
        else table.rows.push({ ...row })
      },
      async delete(id: string) {
        if (table.putShouldThrow) throw table.putShouldThrow
        table.rows = table.rows.filter((entry) => entry.id !== id)
      },
      async bulkDelete(ids: string[]) {
        if (table.putShouldThrow) throw table.putShouldThrow
        table.rows = table.rows.filter((entry) => !ids.includes(entry.id))
      },
      async clear() {
        if (table.putShouldThrow) throw table.putShouldThrow
        table.rows = []
      }
    }
  }

  return { database, table }
}

const identity = (contentKey: string, partId: string | null = null) => ({
  contentKey,
  platform: contentKey.startsWith("bilibili") ? ("bilibili" as const) : ("youtube" as const),
  videoId: contentKey.split(":")[1]?.split(":")[0] ?? "video",
  partId,
})

function createRepository() {
  const { database, table } = createDatabase()
  let sequence = 0
  const repository = createKnowledgeRepository(database as never, {
    now: () => `2026-10-20T00:00:0${sequence % 10}.000Z`,
    randomId: () => `id-${++sequence}`,
  })
  return { repository, table }
}

describe("normalizeKnowledgeTimestamp", () => {
  it("floors to whole seconds and never returns a negative anchor", () => {
    expect(normalizeKnowledgeTimestamp(12.9)).toBe(12)
    expect(normalizeKnowledgeTimestamp(-4)).toBe(0)
    expect(normalizeKnowledgeTimestamp(Number.NaN)).toBe(0)
    expect(normalizeKnowledgeTimestamp(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe("Knowledge repository", () => {
  it("creates a point bookmark with identical start and end seconds", async () => {
    const { repository } = createRepository()
    const item = await repository.createBookmark({
      identity: identity("youtube:video-a"),
      videoTitle: "Video A",
      timestampSeconds: 42.8,
    })

    expect(item.kind).toBe("bookmark")
    expect(item.startSec).toBe(42)
    expect(item.endSec).toBe(42)
    expect(item.text).toBeNull()
    expect(item.analysisRunId).toBeNull()
    expect(item.contentKey).toBe("youtube:video-a")
  })

  it("creates anchored and unanchored notes", async () => {
    const { repository } = createRepository()
    const anchored = await repository.createNote({
      identity: identity("youtube:video-a"),
      videoTitle: "Video A",
      text: "  anchored  ",
      timestampSeconds: 7.6,
    })
    const unanchored = await repository.createNote({
      identity: identity("youtube:video-a"),
      videoTitle: "Video A",
      text: "free form",
      timestampSeconds: null,
    })

    expect(anchored.text).toBe("anchored")
    expect(anchored.startSec).toBe(7)
    expect(anchored.endSec).toBe(7)
    expect(unanchored.startSec).toBeNull()
    expect(unanchored.endSec).toBeNull()
  })

  it("rejects notes without text through schema validation", async () => {
    const { repository } = createRepository()
    await expect(repository.createNote({
      identity: identity("youtube:video-a"),
      videoTitle: "Video A",
      text: "   ",
      timestampSeconds: null,
    })).rejects.toThrow()
  })

  it("updates only note text and updatedAt", async () => {
    const { repository } = createRepository()
    const created = await repository.createNote({
      identity: identity("youtube:video-a"),
      videoTitle: "Video A",
      text: "before",
      timestampSeconds: 5,
    })

    const updated = await repository.updateNote({ id: created.id, text: "  after  " })

    expect(updated.text).toBe("after")
    expect(updated.startSec).toBe(created.startSec)
    expect(updated.endSec).toBe(created.endSec)
    expect(updated.contentKey).toBe(created.contentKey)
    expect(updated.createdAt).toBe(created.createdAt)
    expect(updated.analysisRunId).toBeNull()
    expect(updated.updatedAt >= created.updatedAt).toBe(true)
  })

  it("refuses to edit a bookmark through updateNote", async () => {
    const { repository } = createRepository()
    const bookmark = await repository.createBookmark({
      identity: identity("youtube:video-a"),
      videoTitle: "Video A",
      timestampSeconds: 3,
    })

    await expect(repository.updateNote({ id: bookmark.id, text: "nope" }))
      .rejects.toThrow("Only notes can be edited.")
  })

  it("lists newest-updated first and isolates by exact contentKey", async () => {
    const { repository } = createRepository()
    const first = await repository.createNote({
      identity: identity("youtube:video-a"),
      videoTitle: "A",
      text: "first",
      timestampSeconds: null,
    })
    const second = await repository.createNote({
      identity: identity("youtube:video-a"),
      videoTitle: "A",
      text: "second",
      timestampSeconds: null,
    })
    await repository.createBookmark({
      identity: identity("youtube:video-b"),
      videoTitle: "B",
      timestampSeconds: 1,
    })

    const listed = await repository.listByContentKey("youtube:video-a")
    expect(listed.map((item) => item.id)).toEqual([second.id, first.id])
    expect(await repository.listByContentKey("youtube:video-b")).toHaveLength(1)
    expect(await repository.listByContentKey("youtube:video-c")).toEqual([])
  })

  it("keeps Bilibili p1 and p2 isolated", async () => {
    const { repository } = createRepository()
    await repository.createBookmark({
      identity: identity("bilibili:BV1xx:p:1", "1"),
      videoTitle: "P1",
      timestampSeconds: 10,
    })
    await repository.createBookmark({
      identity: identity("bilibili:BV1xx:p:2", "2"),
      videoTitle: "P2",
      timestampSeconds: 10,
    })

    const p1 = await repository.listByContentKey("bilibili:BV1xx:p:1")
    const p2 = await repository.listByContentKey("bilibili:BV1xx:p:2")
    expect(p1).toHaveLength(1)
    expect(p2).toHaveLength(1)
    expect(p1[0].partId).toBe("1")
    expect(p2[0].partId).toBe("2")
  })

  it("ignores corrupt rows instead of rendering them unchecked", async () => {
    const { repository, table } = createRepository()
    await repository.createNote({
      identity: identity("youtube:video-a"),
      videoTitle: "A",
      text: "valid",
      timestampSeconds: null,
    })
    table.rows.push({
      id: "corrupt",
      kind: "bookmark",
      contentKey: "youtube:video-a",
      platform: "youtube",
      videoId: "video-a",
      partId: null,
      videoTitle: "A",
      analysisRunId: null,
      startSec: 5,
      endSec: 9,
      text: "bookmarks cannot carry text",
      createdAt: "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-20T00:00:00.000Z",
    })

    const listed = await repository.listByContentKey("youtube:video-a")
    expect(listed).toHaveLength(1)
    expect(listed[0].text).toBe("valid")
  })

  it("deletes only the exact contentKey", async () => {
    const { repository } = createRepository()
    await repository.createBookmark({
      identity: identity("bilibili:BV1xx:p:1", "1"),
      videoTitle: "P1",
      timestampSeconds: 1,
    })
    await repository.createBookmark({
      identity: identity("bilibili:BV1xx:p:2", "2"),
      videoTitle: "P2",
      timestampSeconds: 1,
    })

    await repository.deleteByContentKey("bilibili:BV1xx:p:1")

    expect(await repository.listByContentKey("bilibili:BV1xx:p:1")).toEqual([])
    expect(await repository.listByContentKey("bilibili:BV1xx:p:2")).toHaveLength(1)
  })

  it("deletes a single item and clears all rows", async () => {
    const { repository } = createRepository()
    const mine = await repository.createBookmark({
      identity: identity("youtube:video-a"),
      videoTitle: "A",
      timestampSeconds: 1,
    })
    await repository.createBookmark({
      identity: identity("youtube:video-a"),
      videoTitle: "A",
      timestampSeconds: 2,
    })

    await repository.deleteItem(mine.id)
    expect((await repository.listByContentKey("youtube:video-a")).map((item) => item.id))
      .toHaveLength(1)

    await repository.clearAll()
    expect(await repository.listByContentKey("youtube:video-a")).toEqual([])
  })

  it("surfaces quota failures as PersistenceError", async () => {
    const { repository, table } = createRepository()
    const quotaError = Object.assign(new Error("quota"), { name: "QuotaExceededError" })
    table.putShouldThrow = quotaError

    const failure = repository.createBookmark({
      identity: identity("youtube:video-a"),
      videoTitle: "A",
      timestampSeconds: 1,
    })
    await expect(failure).rejects.toBeInstanceOf(PersistenceError)
    await expect(failure).rejects.toMatchObject({ reason: "quota_exceeded" })
  })

  it("toggles an existing same-second bookmark off instead of stacking it", async () => {
    const { repository, table } = createRepository()

    const first = await repository.toggleBookmark({
      identity: identity("youtube:video-a"),
      videoTitle: "A",
      timestampSeconds: 30.4,
    })
    const second = await repository.toggleBookmark({
      identity: identity("youtube:video-a"),
      videoTitle: "A",
      timestampSeconds: 30.9,
    })

    expect(first.kind).toBe("created")
    expect(second.kind).toBe("removed")
    expect(table.rows).toHaveLength(0)
  })

  it("serializes overlapping toggles at the same second so no duplicate row persists", async () => {
    const { database, table } = createDatabase()
    // Every read snapshots the rows that exist at call time, then waits for the
    // gate. Two unserialized toggles would both snapshot "absent" and each
    // persist a duplicate bookmark.
    const originalToArray = database.knowledgeItems.toArray
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    database.knowledgeItems.toArray = async () => {
      const captured = table.rows.map((row) => ({ ...row }))
      await gate
      return captured
    }
    expect(typeof originalToArray).toBe("function")

    let sequence = 0
    const repository = createKnowledgeRepository(database as never, {
      now: () => `2026-10-20T00:00:0${sequence % 10}.000Z`,
      randomId: () => `id-${++sequence}`,
    })

    const first = repository.toggleBookmark({
      identity: identity("youtube:video-a"),
      videoTitle: "A",
      timestampSeconds: 12.4,
    })
    const second = repository.toggleBookmark({
      identity: identity("youtube:video-a"),
      videoTitle: "A",
      timestampSeconds: 12.8,
    })

    release?.()
    const results = await Promise.all([first, second])

    expect(results.map((entry) => entry.kind)).toEqual(["created", "removed"])
    expect(
      table.rows.filter((row) => row.kind === "bookmark" && row.startSec === 12)
    ).toHaveLength(0)
  })

  it("keeps overlapping toggles on different seconds independent", async () => {
    const { repository, table } = createRepository()

    const results = await Promise.all([
      repository.toggleBookmark({
        identity: identity("youtube:video-a"),
        videoTitle: "A",
        timestampSeconds: 10,
      }),
      repository.toggleBookmark({
        identity: identity("youtube:video-a"),
        videoTitle: "A",
        timestampSeconds: 11,
      }),
    ])

    expect(results.map((entry) => entry.kind)).toEqual(["created", "created"])
    expect(table.rows.map((row) => row.startSec).sort()).toEqual([10, 11])
  })
})
