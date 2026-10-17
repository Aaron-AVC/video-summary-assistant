import { describe, expect, it } from "bun:test"

import {
  clearCategorizedData,
  clearDataManagementStores,
  createDataManagementSnapshot,
  performCategorizedDataClear
} from "@/features/settings/components/data-management"
import { DestructiveOperationBlockedError } from "@/features/history/lib/destructive-operation-coordinator"
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
  language: "auto",
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
  it("clears only the selected data category", async () => {
    const cleared: string[] = []
    const dependencies = {
      exportSettings: async () => settingsSnapshot,
      exportLocalData: async () => localData,
      getTranscriptLogs: async () => [],
      clearSettings: async () => { cleared.push("settings") },
      clearLocalData: async () => { cleared.push("all-local") },
      clearTranscriptLogs: async () => { cleared.push("diagnostics") },
      clearQaData: async () => { cleared.push("conversations") },
      clearTranscriptCache: async () => { cleared.push("transcript-cache") },
      clearAnalysisHistory: async () => { cleared.push("analysis-history") }
    }

    await clearCategorizedData("conversations", dependencies)
    expect(cleared).toEqual(["conversations"])
    await clearCategorizedData("transcript-cache", dependencies)
    expect(cleared).toEqual(["conversations", "transcript-cache"])
    await clearCategorizedData("analysis-history", dependencies)
    expect(cleared).toEqual(["conversations", "transcript-cache", "analysis-history"])
    await clearCategorizedData("diagnostics", dependencies)
    expect(cleared).toEqual(["conversations", "transcript-cache", "analysis-history", "diagnostics"])
  })

  it("does not clear language preference for categorized actions", async () => {
    let language = "zh-CN"
    const dependencies = {
      exportSettings: async () => settingsSnapshot,
      exportLocalData: async () => localData,
      getTranscriptLogs: async () => [],
      clearSettings: async () => { language = "auto" },
      clearLocalData: async () => {},
      clearQaData: async () => {},
      clearTranscriptCache: async () => {},
      clearAnalysisHistory: async () => {},
      clearTranscriptLogs: async () => {},
    }

    await clearCategorizedData("conversations", dependencies)
    await clearCategorizedData("transcript-cache", dependencies)
    await clearCategorizedData("analysis-history", dependencies)
    await clearCategorizedData("diagnostics", dependencies)

    expect(language).toBe("zh-CN")
  })

  it("blocks conversations clear for active Ask but allows analysis-only tasks", async () => {
    let clears = 0
    const dependencies = {
      clearQaData: async () => { clears += 1 }
    }
    const blocked = await performCategorizedDataClear("conversations", dependencies, {
      checkConflicts: async () => [{ kind: "ask", contentKey: "youtube:a", phase: "answering" }],
      broadcastMutation: () => {},
    }).then(() => false, (error) => error instanceof DestructiveOperationBlockedError)
    expect(blocked).toBe(true)
    expect(clears).toBe(0)

    await performCategorizedDataClear("conversations", dependencies, {
      checkConflicts: async () => [{ kind: "analysis", contentKey: "youtube:a", phase: "analyzing" }],
      broadcastMutation: (mutation) => expect(mutation).toEqual({ type: "clear-conversations" }),
    })
    expect(clears).toBe(1)
  })

  it("blocks analysis-history and all clears for active tasks while allowing diagnostics", async () => {
    const cleared: string[] = []
    const dependencies = {
      clearQaData: async () => { cleared.push("conversations") },
      clearAnalysisHistory: async () => { cleared.push("history") },
      clearSettings: async () => { cleared.push("settings") },
      clearLocalData: async () => { cleared.push("all-local") },
      clearTranscriptLogs: async () => { cleared.push("diagnostics") },
    }
    const active = async () => [{ kind: "analysis" as const, contentKey: "youtube:a", phase: "analyzing" }]
    await expect(performCategorizedDataClear("analysis-history", dependencies, {
      checkConflicts: active,
      broadcastMutation: () => {},
    })).rejects.toBeInstanceOf(DestructiveOperationBlockedError)
    await expect(performCategorizedDataClear("all", dependencies, {
      checkConflicts: active,
      broadcastMutation: () => {},
    })).rejects.toBeInstanceOf(DestructiveOperationBlockedError)

    await performCategorizedDataClear("diagnostics", dependencies, {
      checkConflicts: active,
      broadcastMutation: (mutation) => expect(mutation).toEqual({ type: "clear-diagnostics" }),
    })
    expect(cleared).toEqual(["diagnostics"])
  })

  it("allows an active task to persist normally after a blocked clear", async () => {
    let persisted = false
    const blocked = await performCategorizedDataClear("analysis-history", {
      clearAnalysisHistory: async () => { persisted = false },
    }, {
      checkConflicts: async () => [{ kind: "ask", contentKey: "youtube:a", phase: "finalizing" }],
      broadcastMutation: () => {},
    }).then(() => false, () => true)
    expect(blocked).toBe(true)
    persisted = true
    expect(persisted).toBe(true)
  })

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
