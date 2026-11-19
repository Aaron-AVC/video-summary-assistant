import { describe, expect, it } from "bun:test"

import { type SettingsStorageAdapter } from "@/features/settings/lib/settings-storage"
import { createSettingsStorageForTest } from "@/features/settings/lib/testing/settings-storage-lock"
import type { AnalysisPresetId } from "@/features/analysis/lib/analysis-preset"

function createAdapter(): SettingsStorageAdapter {
  const store = new Map<string, unknown>()

  return {
    async get<T>(keys: string[]): Promise<Partial<Record<string, T>>> {
      const result: Partial<Record<string, T>> = {}

      for (const key of keys) {
        if (store.has(key)) {
          result[key] = store.get(key) as T
        }
      }

      return result
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

describe("createSettingsStorage", () => {
  it("persists theme and default provider selection", async () => {
    const storage = createSettingsStorageForTest(createAdapter())

    await storage.setThemePreference("dark")
    await storage.saveProviderConfig({
      id: "provider-1",
      name: "Local model",
      baseUrl: "https://api.example.com",
      apiKey: "sk-test-placeholder",
      model: "gpt-4.1"
    })

    expect(await storage.getThemePreference()).toBe("dark")
    expect(await storage.getProviderConfigs()).toEqual([
      expect.objectContaining({ id: "provider-1", isDefault: true, generationTimeoutSec: 600 })
    ])
    expect(await storage.setDefaultProviderConfig("provider-1")).toBe("provider-1")
  })

  it("persists, exports, and clears the language preference", async () => {
    const storage = createSettingsStorageForTest(createAdapter())

    await storage.setLanguagePreference("zh-CN")
    expect(await storage.getLanguagePreference()).toBe("zh-CN")
    expect((await storage.getSettingsSnapshot()).language).toBe("zh-CN")
    expect((await storage.exportSettings()).language).toBe("zh-CN")

    await storage.clearSettings()
    expect(await storage.getLanguagePreference()).toBe("auto")
    expect((await storage.exportSettings()).language).toBe("auto")
  })

  it("exports and clears persisted settings without native helper configuration", async () => {
    const storage = createSettingsStorageForTest(createAdapter())

    await storage.setThemePreference("light")
    await storage.saveProviderConfig({
      id: "provider-1",
      name: "Hosted model",
      baseUrl: "https://api.example.com",
      apiKey: "sk-test-placeholder",
      model: "gpt-4.1"
    })

    const exported = await storage.exportSettings()
    expect(exported).toEqual(
      expect.objectContaining({
        theme: "light",
        providerConfigs: [expect.objectContaining({ id: "provider-1", generationTimeoutSec: 600 })]
      })
    )
    expect(JSON.stringify(exported)).not.toContain("sk-test-placeholder")

    await storage.clearSettings()

    expect(await storage.exportSettings()).toEqual({
      theme: "system",
      language: "auto",
      defaultProviderId: null,
      providerConfigs: [],
      diagnosticLogging: false,
      analysisPresetId: "standard",
    })
  })

  it("persists, exports and clears the global analysis preset", async () => {
    const storage = createSettingsStorageForTest(createAdapter())

    expect(await storage.getAnalysisPresetId()).toBe("standard")
    expect((await storage.getSettingsSnapshot()).analysisPresetId).toBe("standard")

    await storage.setAnalysisPresetId("detailed")
    expect(await storage.getAnalysisPresetId()).toBe("detailed")
    expect((await storage.getSettingsSnapshot()).analysisPresetId).toBe("detailed")
    expect((await storage.exportSettings()).analysisPresetId).toBe("detailed")

    await storage.clearSettings()
    expect(await storage.getAnalysisPresetId()).toBe("standard")
    expect((await storage.exportSettings()).analysisPresetId).toBe("standard")
  })

  it("falls back to standard for missing or invalid stored preset values", async () => {
    for (const stored of [undefined, null, "", "legacy-unknown", "DETAILED", 7]) {
      const store = new Map<string, unknown>([["yt-summarizer.analysis.preset", stored]])
      const storage = createSettingsStorageForTest({
        async get<T>(keys: string[]): Promise<Partial<Record<string, T>>> {
          const result: Partial<Record<string, T>> = {}
          for (const key of keys) {
            if (store.has(key)) result[key] = store.get(key) as T
          }
          return result
        },
        async set(values) {
          for (const [key, value] of Object.entries(values)) store.set(key, value)
        },
        async remove(keys) {
          for (const key of keys) store.delete(key)
        }
      })

      expect(await storage.getAnalysisPresetId()).toBe("standard")
      expect((await storage.getSettingsSnapshot()).analysisPresetId).toBe("standard")
    }
  })

  it("normalizes an invalid preset written through the setter", async () => {
    const store = new Map<string, unknown>()
    const storage = createSettingsStorageForTest({
      async get<T>(keys: string[]): Promise<Partial<Record<string, T>>> {
        const result: Partial<Record<string, T>> = {}
        for (const key of keys) {
          if (store.has(key)) result[key] = store.get(key) as T
        }
        return result
      },
      async set(values) {
        for (const [key, value] of Object.entries(values)) store.set(key, value)
      },
      async remove(keys) {
        for (const key of keys) store.delete(key)
      }
    })

    await storage.setAnalysisPresetId("bogus" as AnalysisPresetId)
    expect(store.get("yt-summarizer.analysis.preset")).toBe("standard")
    expect(await storage.getAnalysisPresetId()).toBe("standard")
  })

  it("migrates legacy secret-bearing records idempotently and keeps secrets out of profile metadata", async () => {
    const store = new Map<string, unknown>([
      ["yt-summarizer.provider.configs", [{
        id: "legacy-a",
        name: "Legacy",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "sk-legacy-secret",
        model: "legacy-model",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }]],
      ["yt-summarizer.provider.default", "legacy-a"]
    ])
    const adapter: SettingsStorageAdapter = {
      async get<T>(keys: string[]): Promise<Partial<Record<string, T>>> {
        return keys.reduce<Partial<Record<string, T>>>((result, key) => {
          if (store.has(key)) result[key] = store.get(key) as T
          return result
        }, {})
      },
      async set(values) {
        for (const [key, value] of Object.entries(values)) store.set(key, value)
      },
      async remove(keys) {
        for (const key of keys) store.delete(key)
      }
    }
    const storage = createSettingsStorageForTest(adapter)

    const first = await storage.getSettingsSnapshot()
    const second = await storage.getSettingsSnapshot()

    expect(first.providerConfigs).toEqual([expect.objectContaining({
      id: "legacy-a",
      isDefault: true,
      hasApiKey: true,
    })])
    expect(first.providerConfigs[0]).not.toHaveProperty("apiKey")
    expect(second.providerConfigs).toEqual(first.providerConfigs)
    expect(store.get("yt-summarizer.provider.configs")).toBeUndefined()
    await expect(storage.resolveProvider("legacy-a")).resolves.toMatchObject({ apiKey: "sk-legacy-secret" })
    expect(JSON.stringify(await storage.exportSettings())).not.toContain("sk-legacy-secret")
  })

  it("keeps an existing secret when an edited profile omits a replacement key", async () => {
    const storage = createSettingsStorageForTest(createAdapter())
    await storage.saveProviderProfile({
      id: "provider-1",
      name: "Provider",
      baseUrl: "https://api.example.com/v1",
      model: "model-a",
    }, "sk-original")
    await storage.saveProviderProfile({
      id: "provider-1",
      name: "Renamed",
      baseUrl: "https://api.example.com/v1",
      model: "model-b",
    })

    await expect(storage.resolveProvider("provider-1")).resolves.toMatchObject({
      apiKey: "sk-original",
      profile: { name: "Renamed", model: "model-b" },
    })
  })

  it("normalizes invalid generation timeout metadata to 600 seconds", async () => {
    const storage = createSettingsStorageForTest(createAdapter())
    await storage.saveProviderProfile({
      id: "provider-timeout",
      name: "Provider",
      baseUrl: "https://api.example.com/v1",
      model: "model",
      generationTimeoutSec: 30,
    })
    await expect(storage.getProviderProfile("provider-timeout")).resolves.toMatchObject({ generationTimeoutSec: 600 })
  })

  it("keeps the legacy secret-bearing record when migration writes fail", async () => {
    const legacyKey = "yt-summarizer.provider.configs"
    const store = new Map<string, unknown>([
      [legacyKey, [{
        id: "legacy-failure",
        name: "Legacy",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "sk-legacy-failure",
        model: "legacy-model",
      }]],
    ])
    let failWrites = true
    let removeCalls = 0
    const adapter: SettingsStorageAdapter = {
      async get<T>(keys: string[]): Promise<Partial<Record<string, T>>> {
        return keys.reduce<Partial<Record<string, T>>>((result, key) => {
          if (store.has(key)) result[key] = store.get(key) as T
          return result
        }, {})
      },
      async set(values) {
        if (failWrites) throw new Error("migration write failed")
        for (const [key, value] of Object.entries(values)) store.set(key, value)
      },
      async remove(keys) {
        removeCalls += 1
        for (const key of keys) store.delete(key)
      },
    }
    const storage = createSettingsStorageForTest(adapter)

    await expect(storage.getSettingsSnapshot()).rejects.toThrow("migration write failed")
    expect(removeCalls).toBe(0)
    expect(store.get(legacyKey)).toBeDefined()

    failWrites = false
    await expect(storage.getSettingsSnapshot()).resolves.toMatchObject({
      providerConfigs: [expect.objectContaining({ id: "legacy-failure", hasApiKey: true })],
    })
    expect(store.get(legacyKey)).toBeUndefined()
  })

  it("removes the corresponding secret when a provider is deleted or all data is cleared", async () => {
    const storage = createSettingsStorageForTest(createAdapter())
    await storage.saveProviderProfile({
      id: "provider-1", name: "Provider", baseUrl: "https://api.example.com", model: "model"
    }, "sk-delete")
    await storage.removeProviderProfile("provider-1")
    await expect(storage.resolveProvider("provider-1")).rejects.toThrow()
    await storage.saveProviderProfile({
      id: "provider-2", name: "Provider 2", baseUrl: "https://api.example.com", model: "model"
    }, "sk-clear")
    await storage.clearSettings()
    await expect(storage.resolveProvider("provider-2")).rejects.toThrow()
  })
})
