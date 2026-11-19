import { describe, expect, it } from "bun:test"

import {
  createSettingsStorage,
  SETTINGS_KEYS,
  type SettingsStorageAdapter,
} from "@/features/settings/lib/settings-storage"
import { createTestSettingsStorageLockManager } from "@/features/settings/lib/testing/settings-storage-lock"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

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
    },
  }
  return { adapter, store }
}

function providerInput(id: string, apiKey: string) {
  return {
    id,
    name: id,
    baseUrl: "https://api.example.com/v1",
    model: "model-1",
    apiKey,
  }
}

/**
 * Old code reaches this gate through two unlocked secret reads. Fixed code
 * reaches it through one locked read plus a second queued lock request.
 */
function createSecretWriteRace() {
  const { adapter, store } = createAdapter()
  const firstReadStarted = deferred()
  const releaseFirstRead = deferred()
  let raceEnabled = false
  let lockUsed = false
  let firstSecretRead = true
  let attempts = 0
  const noteOperation = () => {
    if (!raceEnabled) return
    attempts += 1
    if (attempts === 2) releaseFirstRead.resolve()
  }
  const lockManager = createTestSettingsStorageLockManager(() => {
    if (!raceEnabled) return
    lockUsed = true
    noteOperation()
  })
  const gatedAdapter: SettingsStorageAdapter = {
    async get<T>(keys: string[]): Promise<Partial<Record<string, T>>> {
      const snapshot = await adapter.get<T>(keys)
      if (raceEnabled && keys.length === 1 && keys[0] === SETTINGS_KEYS.providerSecrets) {
        if (!lockUsed) noteOperation()
        if (firstSecretRead) {
          firstSecretRead = false
          firstReadStarted.resolve()
          await releaseFirstRead.promise
        }
      }
      return snapshot
    },
    set: (values) => adapter.set(values),
    remove: (keys) => adapter.remove(keys),
  }
  const seed = createSettingsStorage(adapter, { lockManager })
  const panelA = createSettingsStorage(gatedAdapter, { lockManager })
  const panelB = createSettingsStorage(gatedAdapter, { lockManager })

  return {
    store,
    lockManager,
    panelA,
    panelB,
    firstReadStarted: firstReadStarted.promise,
    async seedProviders() {
      await seed.saveProviderConfig(providerInput("provider-p", "sk-p-old"))
      await seed.saveProviderConfig(providerInput("provider-q", "sk-q-old"))
      raceEnabled = true
    },
  }
}

describe("provider credential cross-panel serialization", () => {
  it("preserves both key replacements and revisions when panels edit different profiles", async () => {
    const race = createSecretWriteRace()
    await race.seedProviders()
    const beforeP = await race.panelA.resolveProvider("provider-p")
    const beforeQ = await race.panelA.resolveProvider("provider-q")

    const first = race.panelA.setProviderApiKey("provider-p", "sk-p-new")
    await race.firstReadStarted
    const second = race.panelB.setProviderApiKey("provider-q", "sk-q-new")
    await Promise.all([first, second])

    const afterP = await race.panelA.resolveProvider("provider-p")
    const afterQ = await race.panelA.resolveProvider("provider-q")
    expect(afterP.apiKey).toBe("sk-p-new")
    expect(afterQ.apiKey).toBe("sk-q-new")
    expect(afterP.credentialRevision).not.toBe(beforeP.credentialRevision)
    expect(afterQ.credentialRevision).not.toBe(beforeQ.credentialRevision)
    expect(afterP.credentialRevision).not.toBe(afterQ.credentialRevision)
    expect(race.lockManager.maxActive).toBe(1)
  })

  it("serializes two replacements of the same provider without a revision rollback", async () => {
    const race = createSecretWriteRace()
    await race.seedProviders()
    const before = await race.panelA.resolveProvider("provider-p")

    const first = race.panelA.setProviderApiKey("provider-p", "sk-p-first-writer")
    await race.firstReadStarted
    const second = race.panelB.setProviderApiKey("provider-p", "sk-p-second-writer")
    await Promise.all([first, second])

    const after = await race.panelA.resolveProvider("provider-p")
    expect(after.apiKey).toBe("sk-p-second-writer")
    expect(after.credentialRevision).toBeString()
    expect(after.credentialRevision).not.toBe(before.credentialRevision)
    expect(race.lockManager.maxActive).toBe(1)
    expect((await race.panelA.resolveProvider("provider-q")).apiKey).toBe("sk-q-old")
  })

  it("does not recreate a credential when deletion wins a key-write race", async () => {
    const race = createSecretWriteRace()
    await race.seedProviders()

    const removal = race.panelA.removeProviderProfile("provider-p")
    await race.firstReadStarted
    const replacement = race.panelB.setProviderApiKey("provider-p", "sk-p-late")
    const [removalResult, replacementResult] = await Promise.allSettled([removal, replacement])

    expect(removalResult.status).toBe("fulfilled")
    expect(replacementResult.status).toBe("rejected")
    if (replacementResult.status === "rejected") {
      expect(String(replacementResult.reason)).toContain("not found")
    }
    expect(await race.panelA.getProviderProfile("provider-p")).toBeNull()
    expect(race.store.get(SETTINGS_KEYS.providerSecrets)).not.toHaveProperty("provider-p")
    expect((await race.panelA.resolveProvider("provider-q")).apiKey).toBe("sk-q-old")
    expect(race.lockManager.maxActive).toBe(1)
  })

  it("keeps the surviving credentials consistent after a failed locked write", async () => {
    const { adapter, store } = createAdapter()
    const lockManager = createTestSettingsStorageLockManager()
    const seed = createSettingsStorage(adapter, { lockManager })
    await seed.saveProviderConfig(providerInput("provider-p", "sk-p-old"))
    await seed.saveProviderConfig(providerInput("provider-q", "sk-q-old"))
    const beforeP = await seed.resolveProvider("provider-p")
    const beforeQ = await seed.resolveProvider("provider-q")
    let failWrite = true
    const failingAdapter: SettingsStorageAdapter = {
      get: adapter.get,
      async set(values) {
        if (failWrite && SETTINGS_KEYS.providerSecrets in values) {
          failWrite = false
          throw new Error("injected provider write failure")
        }
        await adapter.set(values)
      },
      remove: adapter.remove,
    }
    const panel = createSettingsStorage(failingAdapter, { lockManager })

    await expect(panel.setProviderApiKey("provider-p", "sk-p-rejected")).rejects.toThrow("injected")
    expect(await seed.resolveProvider("provider-p")).toEqual(beforeP)
    expect(await seed.resolveProvider("provider-q")).toEqual(beforeQ)

    await panel.setProviderApiKey("provider-q", "sk-q-new")
    expect(await seed.resolveProvider("provider-p")).toEqual(beforeP)
    const afterQ = await seed.resolveProvider("provider-q")
    expect(afterQ.apiKey).toBe("sk-q-new")
    expect(afterQ.credentialRevision).not.toBe(beforeQ.credentialRevision)
    expect(store.get(SETTINGS_KEYS.providerSecrets)).toEqual({
      "provider-p": { apiKey: "sk-p-old", credentialRevision: beforeP.credentialRevision },
      "provider-q": { apiKey: "sk-q-new", credentialRevision: afterQ.credentialRevision },
    })
  })

  it("fails explicitly instead of silently writing credentials without Web Locks", async () => {
    const { adapter, store } = createAdapter()
    const seed = createSettingsStorage(adapter, {
      lockManager: createTestSettingsStorageLockManager(),
    })
    await seed.saveProviderConfig(providerInput("provider-p", "sk-p-old"))
    const before = store.get(SETTINGS_KEYS.providerSecrets)
    const withoutLocks = createSettingsStorage(adapter, { lockManager: null })

    await expect(withoutLocks.setProviderApiKey("provider-p", "sk-unsafe")).rejects.toThrow("Web Locks")
    expect(store.get(SETTINGS_KEYS.providerSecrets)).toEqual(before)
  })

  it("serializes legacy migration with clear-settings so no secret is resurrected", async () => {
    const { adapter, store } = createAdapter()
    store.set(SETTINGS_KEYS.legacyProviderConfigs, [{
      id: "legacy-p",
      name: "Legacy P",
      baseUrl: "https://legacy.example.com/v1",
      model: "legacy-model",
      apiKey: "sk-legacy",
    }])
    const migrationReadStarted = deferred()
    const releaseMigrationRead = deferred()
    let lockUsed = false
    let firstMigrationRead = true
    let attempts = 0
    const noteOperation = () => {
      attempts += 1
      if (attempts === 2) releaseMigrationRead.resolve()
    }
    const lockManager = createTestSettingsStorageLockManager(() => {
      lockUsed = true
      noteOperation()
    })
    const gatedAdapter: SettingsStorageAdapter = {
      async get<T>(keys: string[]): Promise<Partial<Record<string, T>>> {
        const snapshot = await adapter.get<T>(keys)
        if (firstMigrationRead && keys.includes(SETTINGS_KEYS.legacyProviderConfigs)) {
          firstMigrationRead = false
          if (!lockUsed) noteOperation()
          migrationReadStarted.resolve()
          await releaseMigrationRead.promise
        }
        return snapshot
      },
      set: (values) => adapter.set(values),
      async remove(keys) {
        if (keys.includes(SETTINGS_KEYS.legacyProviderConfigs) && keys.length > 2 && !lockUsed) {
          noteOperation()
        }
        await adapter.remove(keys)
      },
    }
    const migratingPanel = createSettingsStorage(gatedAdapter, { lockManager })
    const clearingPanel = createSettingsStorage(gatedAdapter, { lockManager })

    const migration = migratingPanel.getSettingsSnapshot()
    await migrationReadStarted.promise
    const clearing = clearingPanel.clearSettings()
    await Promise.all([migration, clearing])

    expect(store.get(SETTINGS_KEYS.legacyProviderConfigs)).toBeUndefined()
    expect(store.get(SETTINGS_KEYS.providerProfiles)).toBeUndefined()
    expect(store.get(SETTINGS_KEYS.providerSecrets)).toBeUndefined()
    expect(lockManager.maxActive).toBe(1)
  })
})
