import { describe, expect, it } from "bun:test"

import {
  clearDataManagementStores,
  createDataManagementSnapshot
} from "@/features/settings/components/data-management"
import { createHistoryRepository } from "@/features/history/lib/history-repository"
import {
  createSettingsStorage,
  type SettingsExportSnapshot,
  type SettingsStorageAdapter
} from "@/features/settings/lib/settings-storage"
import type { TranscriptLogEntry } from "@/features/transcript/lib/transcript-log"
import type { PersistenceExport } from "@/lib/schemas/persistence"

const settingsSnapshot: SettingsExportSnapshot = {
  theme: "system",
  defaultProviderId: null,
  providerConfigs: [],
  diagnosticLogging: true
}

const localData: PersistenceExport = {
  providerConfigs: [],
  transcriptSnapshots: [],
  analysisRuns: [],
  segmentSummaries: [],
  recentVideos: []
}

function createSettingsAdapter(): SettingsStorageAdapter {
  const store = new Map<string, unknown>()

  return {
    async get<T>(keys: string[]): Promise<Partial<Record<string, T>>> {
      return keys.reduce<Partial<Record<string, T>>>((result, key) => {
        if (store.has(key)) {
          result[key] = store.get(key) as T
        }
        return result
      }, {})
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) {
        store.set(key, value)
      }
    },
    async remove(keys) {
      for (const key of keys) {
        store.delete(key)
      }
    }
  }
}

const diagnosticLogs: TranscriptLogEntry[] = [
  {
    videoId: "abc123",
    pageUrl: "https://www.youtube.com/watch?v=abc123",
    timestamp: "2026-05-04T00:00:00.000Z",
    outcome: "all_failed",
    steps: [
      {
        step: "watch-page-html",
        durationMs: 12,
        ok: false,
        error: "No transcript data found"
      }
    ]
  }
]

describe("data-management storage lifecycle", () => {
  it("includes diagnostic transcript logs in exports", async () => {
    const snapshot = await createDataManagementSnapshot(
      {
        exportSettings: async () => settingsSnapshot,
        exportLocalData: async () => localData,
        getTranscriptLogs: async () => diagnosticLogs,
        clearSettings: async () => {},
        clearLocalData: async () => {},
        clearTranscriptLogs: async () => {}
      },
      "2026-05-04T00:00:00.000Z"
    )

    expect(snapshot).toEqual({
      generatedAt: "2026-05-04T00:00:00.000Z",
      settings: settingsSnapshot,
      localData,
      diagnosticLogs
    })
  })

  it("excludes API keys from settings and IndexedDB provider exports", async () => {
    const secret = "sk-secret-must-not-export"
    const timestamp = "2026-05-04T00:00:00.000Z"
    const storage = createSettingsStorage(createSettingsAdapter())

    await storage.saveProviderConfig({
      id: "settings-provider",
      name: "Settings provider",
      baseUrl: "https://settings.example.com/v1",
      apiKey: secret,
      model: "settings-model",
      createdAt: timestamp,
      updatedAt: timestamp
    })

    const localProvider = {
      id: "indexeddb-provider",
      name: "IndexedDB provider",
      baseUrl: "https://indexeddb.example.com/v1",
      apiKey: secret,
      model: "indexeddb-model",
      createdAt: timestamp,
      updatedAt: timestamp
    }
    const emptyTable = { toArray: async () => [] }
    const repository = createHistoryRepository(
      {
        providerConfigs: { toArray: async () => [localProvider] },
        transcriptSnapshots: emptyTable,
        analysisRuns: emptyTable,
        segmentSummaries: emptyTable,
        recentVideos: emptyTable
      } as never
    )

    const snapshot = await createDataManagementSnapshot(
      {
        exportSettings: () => storage.exportSettings(),
        exportLocalData: () => repository.exportLocalData(),
        getTranscriptLogs: async () => [],
        clearSettings: async () => {},
        clearLocalData: async () => {},
        clearTranscriptLogs: async () => {}
      },
      timestamp
    )
    const serialized = JSON.stringify(snapshot)

    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain('"apiKey"')
    expect(snapshot.settings.providerConfigs[0]).toEqual(
      expect.objectContaining({
        name: "Settings provider",
        baseUrl: "https://settings.example.com/v1",
        model: "settings-model"
      })
    )
    expect(snapshot.localData.providerConfigs[0]).toEqual(
      expect.objectContaining({
        name: "IndexedDB provider",
        baseUrl: "https://indexeddb.example.com/v1",
        model: "indexeddb-model"
      })
    )
  })
  it("clears diagnostic transcript logs with local data", async () => {
    const cleared: string[] = []

    await clearDataManagementStores({
      exportSettings: async () => settingsSnapshot,
      exportLocalData: async () => localData,
      getTranscriptLogs: async () => diagnosticLogs,
      clearSettings: async () => {
        cleared.push("settings")
      },
      clearLocalData: async () => {
        cleared.push("local-data")
      },
      clearTranscriptLogs: async () => {
        cleared.push("diagnostic-logs")
      }
    })

    expect(cleared).toContain("settings")
    expect(cleared).toContain("local-data")
    expect(cleared).toContain("diagnostic-logs")
  })
})
