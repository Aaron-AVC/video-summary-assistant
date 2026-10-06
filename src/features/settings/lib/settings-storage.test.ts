import { describe, expect, it } from "bun:test"

import { createSettingsStorage, type SettingsStorageAdapter } from "@/features/settings/lib/settings-storage"

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
    const storage = createSettingsStorage(createAdapter())

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
      expect.objectContaining({ id: "provider-1", isDefault: true })
    ])
    expect(await storage.setDefaultProviderConfig("provider-1")).toBe("provider-1")
  })

  it("exports and clears persisted settings without native helper configuration", async () => {
    const storage = createSettingsStorage(createAdapter())

    await storage.setThemePreference("light")
    await storage.saveProviderConfig({
      id: "provider-1",
      name: "Hosted model",
      baseUrl: "https://api.example.com",
      apiKey: "sk-test-placeholder",
      model: "gpt-4.1"
    })

    expect(await storage.exportSettings()).toEqual(
      expect.objectContaining({
        theme: "light",
        providerConfigs: [expect.objectContaining({ id: "provider-1" })]
      })
    )

    await storage.clearSettings()

    expect(await storage.exportSettings()).toEqual({
      theme: "system",
      defaultProviderId: null,
      providerConfigs: [],
      diagnosticLogging: false,
    })
  })
})
