import "fake-indexeddb/auto"

import Dexie from "dexie"
import { afterEach, describe, expect, it } from "bun:test"

import { YoutubeSummarizerDatabase } from "@/lib/db"
import { verifyDatabaseReady } from "@/lib/db/readiness"

const createdDatabases: Dexie[] = []
const originalDependencies = Dexie.dependencies

afterEach(() => {
  for (const database of createdDatabases.splice(0)) database.close()
  Dexie.dependencies = originalDependencies
})

describe("Dexie 4.3.0 database readiness", () => {
  it("opens and probes the existing schema without changing stored rows", async () => {
    Dexie.dependencies = { ...originalDependencies, indexedDB, IDBKeyRange }
    const database = new YoutubeSummarizerDatabase(`readiness-${crypto.randomUUID()}`)
    createdDatabases.push(database)
    await database.open()
    await database.recentVideos.put({
      videoId: "retained",
      platform: "youtube",
      contentKey: "youtube:retained",
      title: "Retained",
      channelTitle: "",
      status: "completed",
      openedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    database.close()

    await verifyDatabaseReady(database)
    expect(await database.recentVideos.get("retained")).toMatchObject({ title: "Retained" })
    expect(await database.recentVideos.count()).toBe(1)
  })

  it("reopens the same Dexie instance after a failed open and a later recovery", async () => {
    const realIndexedDB = indexedDB
    let denyOpen = true
    const recoveringFactory = new Proxy(realIndexedDB, {
      get(target, property) {
        if (property === "open") {
          return (...args: Parameters<IDBFactory["open"]>) => {
            if (denyOpen) throw new DOMException("Injected transient failure", "UnknownError")
            return target.open(...args)
          }
        }
        const value = Reflect.get(target, property, target) as unknown
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    Dexie.dependencies = {
      ...originalDependencies,
      indexedDB: recoveringFactory as IDBFactory,
      IDBKeyRange,
    }
    const database = new Dexie(`readiness-retry-${crypto.randomUUID()}`)
    database.version(1).stores({ recentVideos: "videoId" })
    createdDatabases.push(database)

    let failure: unknown
    try {
      await verifyDatabaseReady(database)
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({ name: "UnknownError" })
    expect(database.isOpen()).toBe(false)
    expect(database.hasFailed()).toBe(true)

    denyOpen = false
    await verifyDatabaseReady(database)
    expect(database.isOpen()).toBe(true)
    expect(database.hasFailed()).toBe(false)
    expect(await database.table("recentVideos").count()).toBe(0)
  })
})
