import { describe, expect, it } from "bun:test"

import {
  PENDING_HISTORY_OPEN_KEY,
  type PendingHistoryOpenPayload,
} from "@/features/history/lib/pending-history-open"
import {
  createPendingHistoryOpenAdapter,
  type PendingHistoryOpenStorage,
  type PendingHistoryOpenStorageChangeListener,
} from "@/sidepanel/history/pending-history-open-adapter"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

type FakeStorageOptions = {
  initialValue?: unknown
  getResult?: () => Promise<{ [key: string]: unknown } | undefined>
}

function createFakeStorage({ initialValue, getResult }: FakeStorageOptions = {}) {
  const listeners = new Set<PendingHistoryOpenStorageChangeListener>()
  const events: string[] = []
  const removeCalls: string[] = []
  const stored: { [key: string]: unknown } = {}

  if (initialValue !== undefined) stored[PENDING_HISTORY_OPEN_KEY] = initialValue

  let removeShouldReject = false

  const storage: PendingHistoryOpenStorage = {
    get: async (key) => {
      if (getResult) return await getResult()
      return { [key]: stored[key] }
    },
    remove: async (key) => {
      removeCalls.push(key)
      events.push("remove")
      if (removeShouldReject) throw new Error("remove failed")
      delete stored[key]
    },
    addChangeListener: (listener) => {
      listeners.add(listener)
    },
    removeChangeListener: (listener) => {
      listeners.delete(listener)
    },
  }

  return {
    storage,
    listeners,
    events,
    removeCalls,
    stored,
    setRemoveRejects: (value: boolean) => {
      removeShouldReject = value
    },
    emitChange: (changes: { [key: string]: { newValue?: unknown } }, areaName: string) => {
      for (const listener of [...listeners]) listener(changes, areaName)
    },
  }
}

function validPayload(overrides: Partial<PendingHistoryOpenPayload> = {}): PendingHistoryOpenPayload {
  return {
    videoId: "video-1",
    contentKey: "youtube:video-1",
    analysisRunId: "run-1",
    requestedAt: 1_700_000_000_000,
    ...overrides,
  }
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

describe("pending history open adapter", () => {
  it("consumes an initial stored payload, then clears the key", async () => {
    const payload = validPayload()
    const fake = createFakeStorage({ initialValue: payload })
    const opened: PendingHistoryOpenPayload[] = []
    const adapter = createPendingHistoryOpenAdapter({
      storage: fake.storage,
      onOpen: (next) => {
        opened.push(next)
      },
    })

    adapter.start()
    await flush()

    expect(opened).toEqual([payload])
    expect(fake.removeCalls).toEqual([PENDING_HISTORY_OPEN_KEY])
    expect(fake.stored[PENDING_HISTORY_OPEN_KEY]).toBeUndefined()
    adapter.stop()
  })

  it("ignores a malformed initial payload without clearing the key", async () => {
    const fake = createFakeStorage({ initialValue: { videoId: 42 } })
    const opened: PendingHistoryOpenPayload[] = []
    const adapter = createPendingHistoryOpenAdapter({
      storage: fake.storage,
      onOpen: (next) => {
        opened.push(next)
      },
    })

    adapter.start()
    await flush()

    expect(opened).toEqual([])
    expect(fake.removeCalls).toEqual([])
    adapter.stop()
  })

  it("opens on a local storage change for the pending key", async () => {
    const fake = createFakeStorage()
    const opened: PendingHistoryOpenPayload[] = []
    const adapter = createPendingHistoryOpenAdapter({
      storage: fake.storage,
      onOpen: (next) => {
        opened.push(next)
      },
    })

    adapter.start()
    await flush()
    const payload = validPayload({ analysisRunId: undefined })
    fake.emitChange({ [PENDING_HISTORY_OPEN_KEY]: { newValue: payload } }, "local")
    await flush()

    expect(opened).toEqual([payload])
    adapter.stop()
  })

  it("ignores changes from another storage area", async () => {
    const fake = createFakeStorage()
    const opened: PendingHistoryOpenPayload[] = []
    const adapter = createPendingHistoryOpenAdapter({
      storage: fake.storage,
      onOpen: (next) => {
        opened.push(next)
      },
    })

    adapter.start()
    await flush()
    fake.emitChange({ [PENDING_HISTORY_OPEN_KEY]: { newValue: validPayload() } }, "sync")
    await flush()

    expect(opened).toEqual([])
    expect(fake.removeCalls).toEqual([])
    adapter.stop()
  })

  it("ignores changes to unrelated keys", async () => {
    const fake = createFakeStorage()
    const opened: PendingHistoryOpenPayload[] = []
    const adapter = createPendingHistoryOpenAdapter({
      storage: fake.storage,
      onOpen: (next) => {
        opened.push(next)
      },
    })

    adapter.start()
    await flush()
    fake.emitChange({ "some-other-key": { newValue: validPayload() } }, "local")
    await flush()

    expect(opened).toEqual([])
    expect(fake.removeCalls).toEqual([])
    adapter.stop()
  })

  it("removes the key only after the open completes", async () => {
    const payload = validPayload()
    const fake = createFakeStorage({ initialValue: payload })
    const order: string[] = []
    const adapter = createPendingHistoryOpenAdapter({
      storage: {
        ...fake.storage,
        remove: async (key) => {
          order.push("remove")
          await fake.storage.remove(key)
        },
      },
      onOpen: async () => {
        order.push("onOpen:start")
        await Promise.resolve()
        order.push("onOpen:done")
      },
    })

    adapter.start()
    await flush()

    expect(order).toEqual(["onOpen:start", "onOpen:done", "remove"])
    adapter.stop()
  })

  it("still clears the key when the open rejects", async () => {
    const fake = createFakeStorage({ initialValue: validPayload() })
    const adapter = createPendingHistoryOpenAdapter({
      storage: fake.storage,
      onOpen: () => {
        throw new Error("open failed")
      },
    })

    adapter.start()
    await flush()

    expect(fake.removeCalls).toEqual([PENDING_HISTORY_OPEN_KEY])
    adapter.stop()
  })

  it("keeps the consumption settled when removal rejects", async () => {
    const fake = createFakeStorage({ initialValue: validPayload() })
    fake.setRemoveRejects(true)
    let openedCount = 0
    const adapter = createPendingHistoryOpenAdapter({
      storage: fake.storage,
      onOpen: () => {
        openedCount += 1
      },
    })

    adapter.start()
    await flush()

    expect(openedCount).toBe(1)
    expect(fake.removeCalls).toEqual([PENDING_HISTORY_OPEN_KEY])
    adapter.stop()
  })

  it("stops delivering storage changes after stop", async () => {
    const fake = createFakeStorage()
    const opened: PendingHistoryOpenPayload[] = []
    const adapter = createPendingHistoryOpenAdapter({
      storage: fake.storage,
      onOpen: (next) => {
        opened.push(next)
      },
    })

    adapter.start()
    await flush()
    adapter.stop()
    fake.emitChange({ [PENDING_HISTORY_OPEN_KEY]: { newValue: validPayload() } }, "local")
    await flush()

    expect(opened).toEqual([])
    expect(fake.listeners.size).toBe(0)
  })

  it("ignores an initial read that resolves after stop", async () => {
    const pending = deferred<{ [key: string]: unknown }>()
    const fake = createFakeStorage({ getResult: () => pending.promise })
    const opened: PendingHistoryOpenPayload[] = []
    const adapter = createPendingHistoryOpenAdapter({
      storage: fake.storage,
      onOpen: (next) => {
        opened.push(next)
      },
    })

    adapter.start()
    adapter.stop()
    pending.resolve({ [PENDING_HISTORY_OPEN_KEY]: validPayload() })
    await flush()

    expect(opened).toEqual([])
    expect(fake.removeCalls).toEqual([])
  })

  it("registers only one listener across repeated start calls", async () => {
    const fake = createFakeStorage()
    const adapter = createPendingHistoryOpenAdapter({
      storage: fake.storage,
      onOpen: () => {},
    })

    adapter.start()
    adapter.start()
    await flush()

    expect(fake.listeners.size).toBe(1)
    adapter.stop()
  })

  it("tolerates repeated stop calls", async () => {
    const fake = createFakeStorage()
    const adapter = createPendingHistoryOpenAdapter({
      storage: fake.storage,
      onOpen: () => {},
    })

    adapter.start()
    await flush()
    adapter.stop()
    adapter.stop()

    expect(fake.listeners.size).toBe(0)
  })
})
