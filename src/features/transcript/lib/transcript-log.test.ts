import { afterEach, describe, expect, it } from "bun:test"

import {
  clearTranscriptLogs,
  createLogCollector,
  getTranscriptLogs,
  saveTranscriptLog,
  type TranscriptLogEntry
} from "@/features/transcript/lib/transcript-log"

const STORAGE_KEY = "yt-summarizer.transcript-log"

function installChromeStorageMock(options: {
  onGet?: (key: string, snapshot: Record<string, unknown>, call: number) => Promise<void>
} = {}) {
  const store = new Map<string, unknown>()
  const writes: Record<string, unknown>[] = []
  let getCall = 0

  const chromeMock = {
    storage: {
      local: {
        async get(key: string) {
          const snapshot = store.has(key) ? { [key]: structuredClone(store.get(key)) } : {}
          await options.onGet?.(key, snapshot, ++getCall)
          return snapshot
        },
        async set(values: Record<string, unknown>) {
          writes.push(structuredClone(values))
          for (const [key, value] of Object.entries(values)) {
            store.set(key, value)
          }
        },
        async remove(key: string) {
          store.delete(key)
        }
      }
    }
  }

  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: chromeMock
  })

  return { store, writes }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

const diagnosticLog: TranscriptLogEntry = {
  videoId: "abc123",
  pageUrl: "https://www.youtube.com/watch?v=abc123",
  timestamp: "2026-05-04T00:00:00.000Z",
  outcome: "all_failed",
  steps: [
    {
      step: "panel",
      durationMs: 8,
      ok: false,
      error: "No transcript panel found"
    }
  ]
}

afterEach(() => {
  delete (globalThis as typeof globalThis & { chrome?: unknown }).chrome
})

describe("transcript diagnostic log storage", () => {
  it("clears persisted logs containing video context", async () => {
    const { store } = installChromeStorageMock()

    await saveTranscriptLog(diagnosticLog)

    expect(await getTranscriptLogs()).toEqual([
      expect.objectContaining({
        videoId: "abc123",
        pageUrl: "https://www.youtube.com/watch?v=abc123"
      })
    ])

    await clearTranscriptLogs()

    expect(await getTranscriptLogs()).toEqual([])
    expect(store.has(STORAGE_KEY)).toBe(false)
  })

  it("redacts signed timedtext URLs from thrown and structured errors", async () => {
    const { store } = installChromeStorageMock()
    const signedUrl = "https://www.youtube.com/api/timedtext?v=abc123&signature=SECRET_TEST_VALUE&pot=SECRET_TEST_TOKEN"
    store.set(STORAGE_KEY, [{
      ...diagnosticLog,
      steps: [{ step: "old", durationMs: 1, ok: false, error: signedUrl }]
    }])
    expect(JSON.stringify(await getTranscriptLogs())).not.toContain("SECRET_TEST_VALUE")
    const collector = createLogCollector("abc123", "https://www.youtube.com/watch?v=abc123")

    await expect(collector.logStep("legacy-fetch", async () => {
      throw new Error(`Fetch failed for ${signedUrl}`)
    })).rejects.toThrow()
    await collector.logStep("fetch-result", async () => ({
      ok: false,
      error: { message: `Request failed: ${signedUrl}` },
    }))
    collector.finalize("all_failed")
    await new Promise((resolve) => setTimeout(resolve, 0))

    const serialized = JSON.stringify(store.get(STORAGE_KEY))
    expect(serialized).not.toContain("SECRET_TEST_VALUE")
    expect(serialized).not.toContain("SECRET_TEST_TOKEN")
    expect(serialized).not.toContain(signedUrl)
    expect(serialized).toContain("[redacted transcript URL]")
  })

  it("does not restore diagnostic logs when a pending read overlaps clear", async () => {
    const readReached = deferred()
    const releaseRead = deferred()
    const { store, writes } = installChromeStorageMock({
      onGet: async (_key, _snapshot, call) => {
        if (call !== 1) return
        readReached.resolve()
        await releaseRead.promise
      }
    })
    store.set(STORAGE_KEY, [{
      ...diagnosticLog,
      steps: [{ step: "legacy", durationMs: 1, ok: false, error:
        "https://www.youtube.com/api/timedtext?v=abc123&signature=SECRET_TEST_VALUE" }]
    }])

    const reading = getTranscriptLogs()
    await readReached.promise
    await clearTranscriptLogs()
    releaseRead.resolve()
    const entries = await reading

    expect(entries[0]?.steps[0]?.error).toBe("[redacted transcript URL]")
    expect(store.has(STORAGE_KEY)).toBe(false)
    expect(writes).toEqual([])
  })

  it("does not overwrite a concurrent append when sanitizing historical read output", async () => {
    const readReached = deferred()
    const releaseRead = deferred()
    const { store, writes } = installChromeStorageMock({
      onGet: async (_key, _snapshot, call) => {
        if (call !== 1) return
        readReached.resolve()
        await releaseRead.promise
      }
    })
    store.set(STORAGE_KEY, [{
      ...diagnosticLog,
      steps: [{ step: "legacy", durationMs: 1, ok: false, error:
        "https://www.youtube.com/api/timedtext?v=abc123&signature=SECRET_TEST_VALUE" }]
    }])
    const newLog: TranscriptLogEntry = {
      ...diagnosticLog,
      videoId: "new-video",
      steps: [{ step: "new", durationMs: 1, ok: true }]
    }

    const reading = getTranscriptLogs()
    await readReached.promise
    await saveTranscriptLog(newLog)
    releaseRead.resolve()
    const entries = await reading
    const persisted = store.get(STORAGE_KEY) as TranscriptLogEntry[]

    expect(entries[0]?.steps[0]?.error).toBe("[redacted transcript URL]")
    expect(persisted.map((entry) => entry.videoId)).toEqual(["new-video", "abc123"])
    expect(JSON.stringify(persisted)).not.toContain("SECRET_TEST_VALUE")
    expect(writes).toHaveLength(1)
  })
})
