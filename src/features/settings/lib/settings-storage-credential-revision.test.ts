import { describe, expect, it } from "bun:test"

import {
  SETTINGS_KEYS,
  type SettingsStorageAdapter
} from "@/features/settings/lib/settings-storage"
import { createSettingsStorageForTest } from "@/features/settings/lib/testing/settings-storage-lock"

function createAdapter() {
  const store = new Map<string, unknown>()
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
  return { adapter, store }
}

async function seedProvider(storage: ReturnType<typeof createSettingsStorageForTest>, apiKey = "sk-first") {
  await storage.saveProviderConfig({
    id: "provider-a",
    name: "Provider A",
    baseUrl: "https://api.example.com/v1",
    model: "model-a",
    apiKey
  })
}

describe("provider credential revisions", () => {
  it("returns a non-secret revision outside profile metadata and keeps it stable across reads", async () => {
    const { adapter } = createAdapter()
    const storage = createSettingsStorageForTest(adapter)
    await seedProvider(storage)

    const first = await storage.resolveProvider("provider-a")
    const second = await storage.resolveProvider("provider-a")
    expect(first.credentialRevision).toBeString()
    expect(first.credentialRevision.length).toBeGreaterThanOrEqual(16)
    expect(first.credentialRevision).toBe(second.credentialRevision)
    expect(first.credentialRevision).not.toContain(first.apiKey)
    expect(first.profile).not.toHaveProperty("credentialRevision")
    expect(JSON.stringify(await storage.exportSettings())).not.toContain(first.credentialRevision)
    expect(JSON.stringify(await storage.exportSettings())).not.toContain(first.apiKey)
  })

  it("rotates the revision when the same profile receives a replacement key", async () => {
    const { adapter } = createAdapter()
    const storage = createSettingsStorageForTest(adapter)
    await seedProvider(storage)
    const before = await storage.resolveProvider("provider-a")

    await storage.setProviderApiKey("provider-a", "sk-second")
    const after = await storage.resolveProvider("provider-a")
    expect(after.profile).toEqual(before.profile)
    expect(after.apiKey).toBe("sk-second")
    expect(after.credentialRevision).not.toBe(before.credentialRevision)
  })

  it("retains the revision for metadata-only edits and rotates it for key edits", async () => {
    const { adapter } = createAdapter()
    const storage = createSettingsStorageForTest(adapter)
    await seedProvider(storage)
    const before = await storage.resolveProvider("provider-a")
    const input = {
      id: "provider-a",
      name: "Renamed",
      baseUrl: before.profile.baseUrl,
      model: before.profile.model
    }

    await storage.saveProviderProfile(input)
    const metadataOnly = await storage.resolveProvider("provider-a")
    expect(metadataOnly.apiKey).toBe(before.apiKey)
    expect(metadataOnly.credentialRevision).toBe(before.credentialRevision)

    await storage.saveProviderProfile(input, "sk-replacement")
    const replaced = await storage.resolveProvider("provider-a")
    expect(replaced.credentialRevision).not.toBe(before.credentialRevision)
  })

  it("migrates a legacy string secret once and shares its stable revision across instances", async () => {
    const { adapter, store } = createAdapter()
    const first = createSettingsStorageForTest(adapter)
    await seedProvider(first, "sk-legacy")
    store.set(SETTINGS_KEYS.providerSecrets, { "provider-a": "sk-legacy" })

    const migrated = createSettingsStorageForTest(adapter)
    const resolved = await migrated.resolveProvider("provider-a")
    expect(resolved.apiKey).toBe("sk-legacy")
    expect(resolved.credentialRevision).toBeString()

    const anotherPanel = createSettingsStorageForTest(adapter)
    expect((await anotherPanel.resolveProvider("provider-a")).credentialRevision)
      .toBe(resolved.credentialRevision)
    expect(store.has("providerCredentialRevisions")).toBe(false)
    expect(store.has("credentialRevision")).toBe(false)
  })

  it("does not overwrite another panel's key replacement with a stale metadata-only save", async () => {
    const { adapter, store } = createAdapter()
    const panelA = createSettingsStorageForTest(adapter)
    await seedProvider(panelA)
    const before = await panelA.resolveProvider("provider-a")

    let gateSecretsRead = true
    let releaseSecretsRead!: () => void
    let markSecretsReadStarted!: () => void
    const secretsReadStarted = new Promise<void>((resolve) => { markSecretsReadStarted = resolve })
    const secretsReadGate = new Promise<void>((resolve) => { releaseSecretsRead = resolve })
    const gatedAdapter: SettingsStorageAdapter = {
      async get<T>(keys: string[]): Promise<Partial<Record<string, T>>> {
        const snapshot = await adapter.get<T>(keys)
        if (gateSecretsRead && keys.length === 1 && keys[0] === SETTINGS_KEYS.providerSecrets) {
          gateSecretsRead = false
          markSecretsReadStarted()
          await secretsReadGate
        }
        return snapshot
      },
      set: (values) => adapter.set(values),
      remove: (keys) => adapter.remove(keys),
    }
    const stalePanel = createSettingsStorageForTest(gatedAdapter)
    const panelB = createSettingsStorageForTest(adapter)
    const metadataSave = stalePanel.saveProviderProfile({
      id: "provider-a",
      name: "Renamed in panel A",
      baseUrl: before.profile.baseUrl,
      model: before.profile.model,
    })
    await secretsReadStarted
    await panelB.setProviderApiKey("provider-a", "sk-from-panel-b")
    const replacement = await panelB.resolveProvider("provider-a")
    releaseSecretsRead()
    await metadataSave

    const after = await panelA.resolveProvider("provider-a")
    expect(after.profile.name).toBe("Renamed in panel A")
    expect(after.apiKey).toBe("sk-from-panel-b")
    expect(after.credentialRevision).toBe(replacement.credentialRevision)
    expect(after.credentialRevision).not.toBe(before.credentialRevision)
    expect(store.get(SETTINGS_KEYS.providerSecrets)).toEqual({
      "provider-a": { apiKey: "sk-from-panel-b", credentialRevision: replacement.credentialRevision },
    })
  })

  it("observes another panel's key replacement without relying on profile timestamps", async () => {
    const { adapter } = createAdapter()
    const panelA = createSettingsStorageForTest(adapter)
    const panelB = createSettingsStorageForTest(adapter)
    await seedProvider(panelA)
    const before = await panelA.resolveProvider("provider-a")
    const profileTimestamp = before.profile.updatedAt

    await panelB.setProviderApiKey("provider-a", "sk-from-panel-b")
    const after = await panelA.resolveProvider("provider-a")
    expect(after.profile.updatedAt).toBe(profileTimestamp)
    expect(after.apiKey).toBe("sk-from-panel-b")
    expect(after.credentialRevision).not.toBe(before.credentialRevision)
  })

  it("invalidates on removal and creates a fresh revision when a key is added again", async () => {
    const { adapter } = createAdapter()
    const storage = createSettingsStorageForTest(adapter)
    await seedProvider(storage)
    const before = await storage.resolveProvider("provider-a")

    await storage.removeProviderApiKey("provider-a")
    await expect(storage.resolveProvider("provider-a")).rejects.toThrow("API key")
    await storage.setProviderApiKey("provider-a", "sk-first")
    const restored = await storage.resolveProvider("provider-a")
    expect(restored.credentialRevision).not.toBe(before.credentialRevision)
  })

  it("deleting a profile removes its credential entry without introducing a new storage key", async () => {
    const { adapter, store } = createAdapter()
    const storage = createSettingsStorageForTest(adapter)
    await seedProvider(storage)
    const keysBefore = new Set(store.keys())

    await storage.removeProviderProfile("provider-a")
    await expect(storage.resolveProvider("provider-a")).rejects.toThrow("not found")
    expect(store.get(SETTINGS_KEYS.providerSecrets)).toEqual({})
    expect(new Set(store.keys())).toEqual(keysBefore)
  })
})
