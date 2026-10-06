import { describe, expect, it } from "bun:test"

import {
  clearDataManagementStores,
  createDataManagementSnapshot
} from "@/features/settings/components/data-management"
import type { SettingsSnapshot } from "@/features/settings/lib/settings-storage"
import type { TranscriptLogEntry } from "@/features/transcript/lib/transcript-log"
import type { PersistenceExport } from "@/lib/schemas/persistence"

const settingsSnapshot: SettingsSnapshot = {
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
