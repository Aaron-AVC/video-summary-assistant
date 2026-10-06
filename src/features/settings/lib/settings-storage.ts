export type ThemePreference = "light" | "dark" | "system"

export type ProviderConfigRecord = {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export type SettingsSnapshot = {
  theme: ThemePreference
  defaultProviderId: string | null
  providerConfigs: ProviderConfigRecord[]
  diagnosticLogging: boolean
}

type StorageValue = string | number | boolean | null | undefined | object

export type SettingsStorageAdapter = {
  get: <T>(keys: string[]) => Promise<Partial<Record<string, T>>>
  set: (values: Record<string, StorageValue>) => Promise<void>
  remove: (keys: string[]) => Promise<void>
}

const SETTINGS_KEYS = {
  theme: "yt-summarizer.theme",
  defaultProviderId: "yt-summarizer.provider.default",
  providerConfigs: "yt-summarizer.provider.configs",
  diagnosticLogging: "yt-summarizer.diagnostic-logging",
} as const

const SETTINGS_KEY_LIST = [
  SETTINGS_KEYS.theme,
  SETTINGS_KEYS.defaultProviderId,
  SETTINGS_KEYS.providerConfigs,
  SETTINGS_KEYS.diagnosticLogging,
]

const DEFAULT_THEME: ThemePreference = "system"

function getChromeStorageArea() {
  return globalThis.chrome?.storage?.local ?? null
}

function createChromeStorageAdapter(): SettingsStorageAdapter {
  const storage = getChromeStorageArea()

  if (!storage) {
    return createMemoryStorageAdapter()
  }

  return {
    get: async <T>(keys: string[]) => {
      return (await storage.get(keys)) as Partial<Record<string, T>>
    },
    set: async (values) => {
      await storage.set(values)
    },
    remove: async (keys) => {
      await storage.remove(keys)
    }
  }
}

function createMemoryStorageAdapter(): SettingsStorageAdapter {
  const store = new Map<string, StorageValue>()

  return {
    async get<T>(keys: string[]) {
      return keys.reduce<Partial<Record<string, T>>>((result, key) => {
        const value = store.get(key)

        if (value !== undefined) {
          result[key] = value as T
        }

        return result
      }, {})
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) {
          store.delete(key)
          continue
        }

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

function normalizeThemePreference(theme: unknown): ThemePreference {
  return theme === "light" || theme === "dark" || theme === "system"
    ? theme
    : DEFAULT_THEME
}

function normalizeProviderConfigRecord(
  value: unknown,
  defaultProviderId: string | null
): ProviderConfigRecord | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const record = value as Partial<ProviderConfigRecord>

  if (
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    typeof record.baseUrl !== "string" ||
    typeof record.apiKey !== "string" ||
    typeof record.model !== "string"
  ) {
    return null
  }

  const createdAt = typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString()
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : createdAt

  return {
    id: record.id,
    name: record.name,
    baseUrl: record.baseUrl,
    apiKey: record.apiKey,
    model: record.model,
    isDefault: record.id === defaultProviderId,
    createdAt,
    updatedAt
  }
}

export function createSettingsStorage(adapter = createChromeStorageAdapter()) {
  async function getSnapshot(): Promise<SettingsSnapshot> {
    const values = await adapter.get<unknown>(SETTINGS_KEY_LIST)
    const defaultProviderId =
      typeof values[SETTINGS_KEYS.defaultProviderId] === "string"
        ? (values[SETTINGS_KEYS.defaultProviderId] as string)
        : null

    const providerConfigs = Array.isArray(values[SETTINGS_KEYS.providerConfigs])
      ? (values[SETTINGS_KEYS.providerConfigs] as unknown[])
          .map((value) => normalizeProviderConfigRecord(value, defaultProviderId))
          .filter((value): value is ProviderConfigRecord => value !== null)
      : []

    return {
      theme: normalizeThemePreference(values[SETTINGS_KEYS.theme]),
      defaultProviderId,
      providerConfigs,
      diagnosticLogging: values[SETTINGS_KEYS.diagnosticLogging] === true,
    }
  }

  return {
    async getThemePreference() {
      const snapshot = await getSnapshot()
      return snapshot.theme
    },
    async setThemePreference(theme: ThemePreference) {
      await adapter.set({ [SETTINGS_KEYS.theme]: theme })
      return theme
    },
    async getProviderConfigs() {
      const snapshot = await getSnapshot()
      return snapshot.providerConfigs
    },
    async saveProviderConfig(
      providerConfig: Omit<ProviderConfigRecord, "isDefault" | "createdAt" | "updatedAt"> &
        Partial<Pick<ProviderConfigRecord, "createdAt" | "updatedAt">>
    ) {
      const snapshot = await getSnapshot()
      const now = new Date().toISOString()
      const nextRecord: ProviderConfigRecord = {
        ...providerConfig,
        isDefault:
          snapshot.defaultProviderId === null ||
          snapshot.defaultProviderId === providerConfig.id,
        createdAt: providerConfig.createdAt ?? now,
        updatedAt: providerConfig.updatedAt ?? now
      }

      const providerConfigs = snapshot.providerConfigs.filter(
        (record) => record.id !== providerConfig.id
      )

      providerConfigs.push(nextRecord)

      const defaultProviderId =
        snapshot.defaultProviderId ?? (nextRecord.isDefault ? nextRecord.id : null)

      await adapter.set({
        [SETTINGS_KEYS.providerConfigs]: providerConfigs.map(({ isDefault, ...record }) => record),
        [SETTINGS_KEYS.defaultProviderId]: defaultProviderId
      })

      return {
        ...nextRecord,
        isDefault: defaultProviderId === nextRecord.id
      }
    },
    async setDefaultProviderConfig(providerId: string | null) {
      const snapshot = await getSnapshot()
      const hasProvider = providerId
        ? snapshot.providerConfigs.some((record) => record.id === providerId)
        : false

      const defaultProviderId = hasProvider ? providerId : null
      await adapter.set({ [SETTINGS_KEYS.defaultProviderId]: defaultProviderId })
      return defaultProviderId
    },
    async removeProviderConfig(providerId: string) {
      const snapshot = await getSnapshot()
      const providerConfigs = snapshot.providerConfigs.filter(
        (record) => record.id !== providerId
      )
      const defaultProviderId =
        snapshot.defaultProviderId === providerId ? providerConfigs[0]?.id ?? null : snapshot.defaultProviderId

      await adapter.set({
        [SETTINGS_KEYS.providerConfigs]: providerConfigs.map(({ isDefault, ...record }) => record),
        [SETTINGS_KEYS.defaultProviderId]: defaultProviderId
      })

      return providerConfigs.map((record) => ({
        ...record,
        isDefault: record.id === defaultProviderId
      }))
    },
    async getDiagnosticLogging(): Promise<boolean> {
      const snapshot = await getSnapshot()
      return snapshot.diagnosticLogging
    },
    async setDiagnosticLogging(enabled: boolean) {
      await adapter.set({ [SETTINGS_KEYS.diagnosticLogging]: enabled })
    },
    async exportSettings() {
      return getSnapshot()
    },
    async clearSettings() {
      await adapter.remove(SETTINGS_KEY_LIST)
    }
  }
}

export const settingsStorage = createSettingsStorage()

export { SETTINGS_KEYS }
