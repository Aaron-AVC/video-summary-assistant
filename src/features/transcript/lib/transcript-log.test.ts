import { afterEach, describe, expect, it } from "bun:test"

import {
  clearTranscriptLogs,
  getTranscriptLogs,
  saveTranscriptLog,
  type TranscriptLogEntry
} from "@/features/transcript/lib/transcript-log"

const STORAGE_KEY = "yt-summarizer.transcript-log"

function installChromeStorageMock() {
  const store = new Map<string, unknown>()

  const chromeMock = {
    storage: {
      local: {
        async get(key: string) {
          return store.has(key) ? { [key]: store.get(key) } : {}
        },
        async set(values: Record<string, unknown>) {
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

  return store
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
    const store = installChromeStorageMock()

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
})
