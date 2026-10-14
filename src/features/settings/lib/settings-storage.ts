import { sanitizeProviderConfigForExport } from "@/lib/export/provider-config-export"
import {
  DEFAULT_PROVIDER_GENERATION_TIMEOUT_SEC,
  MAX_PROVIDER_GENERATION_TIMEOUT_SEC,
  MIN_PROVIDER_GENERATION_TIMEOUT_SEC,
} from "@/features/settings/lib/provider-schema"

export type ThemePreference = "light" | "dark" | "system"

export type ProviderProfile = {
  id: string
  name: string
  baseUrl: string
  model: string
  generationTimeoutSec: number
  createdAt: string
  updatedAt: string
}

export type ProviderProfileView = ProviderProfile & {
  isDefault: boolean
  hasApiKey: boolean
}

/** Compatibility name for existing UI projections; it never contains apiKey. */
export type ProviderConfigRecord = ProviderProfileView

export type ResolvedProvider = {
  profile: ProviderProfileView
  apiKey: string
}

export type SettingsSnapshot = {
  theme: ThemePreference
  defaultProviderId: string | null
  providerConfigs: ProviderProfileView[]
  diagnosticLogging: boolean
}

export type SettingsExportSnapshot = Omit<SettingsSnapshot, "providerConfigs"> & {
  providerConfigs: ReturnType<typeof sanitizeProviderConfigForExport>[]
}

type StorageValue = string | number | boolean | null | undefined | object

export type SettingsStorageAdapter = {
  get: <T>(keys: string[]) => Promise<Partial<Record<string, T>>>
  set: (values: Record<string, StorageValue>) => Promise<void>
  remove: (keys: string[]) => Promise<void>
}

export const SETTINGS_KEYS = {
  theme: "yt-summarizer.theme",
  defaultProviderId: "yt-summarizer.provider.default",
  providerProfiles: "yt-summarizer.provider.profiles",
  providerSecrets: "yt-summarizer.provider.secrets",
  legacyProviderConfigs: "yt-summarizer.provider.configs",
  diagnosticLogging: "yt-summarizer.diagnostic-logging",
} as const

const SETTINGS_KEY_LIST = [
  SETTINGS_KEYS.theme,
  SETTINGS_KEYS.defaultProviderId,
  SETTINGS_KEYS.providerProfiles,
  SETTINGS_KEYS.providerSecrets,
  SETTINGS_KEYS.legacyProviderConfigs,
  SETTINGS_KEYS.diagnosticLogging,
]

const DEFAULT_THEME: ThemePreference = "system"

function getChromeStorageArea() {
  return globalThis.chrome?.storage?.local ?? null
}

function createChromeStorageAdapter(): SettingsStorageAdapter {
  const storage = getChromeStorageArea()

  if (!storage) return createMemoryStorageAdapter()

  return {
    get: async <T>(keys: string[]) => (await storage.get(keys)) as Partial<Record<string, T>>,
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
        if (value !== undefined) result[key] = value as T
        return result
      }, {})
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) store.delete(key)
        else store.set(key, value)
      }
    },
    async remove(keys) {
      for (const key of keys) store.delete(key)
    }
  }
}

function normalizeThemePreference(theme: unknown): ThemePreference {
  return theme === "light" || theme === "dark" || theme === "system" ? theme : DEFAULT_THEME
}

function normalizeProfile(value: unknown): ProviderProfile | null {
  if (!value || typeof value !== "object") return null
  const record = value as Partial<ProviderProfile>
  if (
    typeof record.id !== "string" || !record.id.trim()
    || typeof record.name !== "string" || !record.name.trim()
    || typeof record.baseUrl !== "string" || !record.baseUrl.trim()
    || typeof record.model !== "string" || !record.model.trim()
  ) return null

  const now = new Date().toISOString()
  const generationTimeoutSec = Number.isInteger(record.generationTimeoutSec)
    && Number(record.generationTimeoutSec) >= MIN_PROVIDER_GENERATION_TIMEOUT_SEC
    && Number(record.generationTimeoutSec) <= MAX_PROVIDER_GENERATION_TIMEOUT_SEC
    ? Number(record.generationTimeoutSec)
    : DEFAULT_PROVIDER_GENERATION_TIMEOUT_SEC
  return {
    id: record.id.trim(),
    name: record.name.trim(),
    baseUrl: record.baseUrl.trim().replace(/\/+$/, ""),
    model: record.model.trim(),
    generationTimeoutSec,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : now,
  }
}

function normalizeProfiles(value: unknown): ProviderProfile[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((entry) => {
    const profile = normalizeProfile(entry)
    if (!profile || seen.has(profile.id)) return []
    seen.add(profile.id)
    return [profile]
  })
}

function normalizeSecrets(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
    (result, [id, secret]) => {
      if (typeof secret === "string" && secret.trim()) result[id] = secret.trim()
      return result
    },
    {},
  )
}

function legacyProfile(value: unknown): { profile: ProviderProfile; apiKey: string } | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const profile = normalizeProfile({
    id: record.id,
    name: record.name,
    baseUrl: record.baseUrl,
    model: record.model,
    generationTimeoutSec: record.generationTimeoutSec,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  })
  if (!profile || typeof record.apiKey !== "string") return null
  return { profile, apiKey: record.apiKey.trim() }
}

export function createSettingsStorage(adapter = createChromeStorageAdapter()) {
  let migrationPromise: Promise<void> | null = null

  async function migrateLegacyProviderStorage(): Promise<void> {
    const values = await adapter.get<unknown>([
      SETTINGS_KEYS.providerProfiles,
      SETTINGS_KEYS.providerSecrets,
      SETTINGS_KEYS.legacyProviderConfigs,
      SETTINGS_KEYS.defaultProviderId,
    ])
    const currentProfiles = normalizeProfiles(values[SETTINGS_KEYS.providerProfiles])
    const legacyValues = Array.isArray(values[SETTINGS_KEYS.legacyProviderConfigs])
      ? values[SETTINGS_KEYS.legacyProviderConfigs] as unknown[]
      : []

    if (legacyValues.length === 0) return

    const migrated = legacyValues.map(legacyProfile).filter(
      (entry): entry is { profile: ProviderProfile; apiKey: string } => entry !== null,
    )
    // Existing metadata wins, while legacy profiles missing from a partial
    // migration are still recovered before the secret-bearing record is removed.
    const profiles = [...currentProfiles]
    for (const entry of migrated) {
      if (!profiles.some((profile) => profile.id === entry.profile.id)) {
        profiles.push(entry.profile)
      }
    }
    const secrets = normalizeSecrets(values[SETTINGS_KEYS.providerSecrets])
    for (const entry of migrated) {
      if (entry.apiKey && secrets[entry.profile.id] === undefined) {
        secrets[entry.profile.id] = entry.apiKey
      }
    }
    const requestedDefault = typeof values[SETTINGS_KEYS.defaultProviderId] === "string"
      ? String(values[SETTINGS_KEYS.defaultProviderId])
      : null
    const defaultProviderId = profiles.some((profile) => profile.id === requestedDefault)
      ? requestedDefault
      : profiles[0]?.id ?? null

    // Write the new copy before removing the only legacy secret-bearing copy.
    await adapter.set({
      [SETTINGS_KEYS.providerProfiles]: profiles,
      [SETTINGS_KEYS.providerSecrets]: secrets,
      [SETTINGS_KEYS.defaultProviderId]: defaultProviderId,
    })
    await adapter.remove([SETTINGS_KEYS.legacyProviderConfigs])
  }

  async function ensureMigration() {
    if (!migrationPromise) {
      const pending = migrateLegacyProviderStorage()
      migrationPromise = pending.catch((error) => {
        migrationPromise = null
        throw error
      })
    }
    await migrationPromise
  }

  async function readSnapshot(): Promise<SettingsSnapshot> {
    await ensureMigration()
    const values = await adapter.get<unknown>([
      SETTINGS_KEYS.theme,
      SETTINGS_KEYS.defaultProviderId,
      SETTINGS_KEYS.providerProfiles,
      SETTINGS_KEYS.providerSecrets,
      SETTINGS_KEYS.diagnosticLogging,
    ])
    const profiles = normalizeProfiles(values[SETTINGS_KEYS.providerProfiles])
    const secrets = normalizeSecrets(values[SETTINGS_KEYS.providerSecrets])
    const requestedDefault = typeof values[SETTINGS_KEYS.defaultProviderId] === "string"
      ? String(values[SETTINGS_KEYS.defaultProviderId])
      : null
    const defaultProviderId = profiles.some((profile) => profile.id === requestedDefault)
      ? requestedDefault
      : profiles[0]?.id ?? null

    if (defaultProviderId !== requestedDefault) {
      await adapter.set({ [SETTINGS_KEYS.defaultProviderId]: defaultProviderId })
    }

    const providerConfigs = profiles.map((profile) => ({
      ...profile,
      isDefault: profile.id === defaultProviderId,
      hasApiKey: typeof secrets[profile.id] === "string" && secrets[profile.id].length > 0,
    }))
    return {
      theme: normalizeThemePreference(values[SETTINGS_KEYS.theme]),
      defaultProviderId: defaultProviderId as string | null,
      providerConfigs,
      diagnosticLogging: values[SETTINGS_KEYS.diagnosticLogging] === true,
    }
  }

  async function readSecrets(): Promise<Record<string, string>> {
    await ensureMigration()
    const values = await adapter.get<unknown>([SETTINGS_KEYS.providerSecrets])
    return normalizeSecrets(values[SETTINGS_KEYS.providerSecrets])
  }

  async function writeProfiles(
    profiles: ProviderProfile[],
    defaultProviderId: string | null,
    secrets: Record<string, string>,
  ) {
    await adapter.set({
      [SETTINGS_KEYS.providerProfiles]: profiles,
      [SETTINGS_KEYS.defaultProviderId]: defaultProviderId,
      [SETTINGS_KEYS.providerSecrets]: secrets,
    })
  }

  return {
    async getThemePreference() {
      return (await readSnapshot()).theme
    },
    async setThemePreference(theme: ThemePreference) {
      await adapter.set({ [SETTINGS_KEYS.theme]: theme })
      return theme
    },
    async getProviderProfiles() {
      return (await readSnapshot()).providerConfigs
    },
    async listProviderProfiles() {
      return (await readSnapshot()).providerConfigs
    },
    async getProviderProfile(providerId: string) {
      return (await readSnapshot()).providerConfigs.find((profile) => profile.id === providerId) ?? null
    },
    async saveProviderProfile(
      input: Omit<ProviderProfile, "createdAt" | "updatedAt" | "generationTimeoutSec"> &
        Partial<Pick<ProviderProfile, "createdAt" | "updatedAt" | "generationTimeoutSec">>,
      apiKey?: string,
    ): Promise<ProviderProfileView> {
      const snapshot = await readSnapshot()
      const now = new Date().toISOString()
      const existing = snapshot.providerConfigs.find((profile) => profile.id === input.id)
      const profile: ProviderProfile = {
        id: input.id,
        name: input.name,
        baseUrl: input.baseUrl,
        model: input.model,
        generationTimeoutSec: normalizeGenerationTimeoutSec(input.generationTimeoutSec),
        createdAt: input.createdAt ?? existing?.createdAt ?? now,
        updatedAt: input.updatedAt ?? now,
      }
      const profiles: ProviderProfile[] = [
        ...snapshot.providerConfigs.filter((entry) => entry.id !== profile.id),
        profile,
      ].map(({ id, name, baseUrl, model, generationTimeoutSec, createdAt, updatedAt }) => ({
        id, name, baseUrl, model, generationTimeoutSec, createdAt, updatedAt,
      }))
      const defaultProviderId = snapshot.defaultProviderId ?? profile.id
      const secrets = await readSecrets()
      if (apiKey !== undefined) {
        if (apiKey.trim()) secrets[profile.id] = apiKey.trim()
        else delete secrets[profile.id]
      }
      await writeProfiles(profiles, defaultProviderId, secrets)
      return {
        ...profile,
        isDefault: defaultProviderId === profile.id,
        hasApiKey: Boolean(secrets[profile.id]),
      }
    },
    async removeProviderProfile(providerId: string) {
      const snapshot = await readSnapshot()
      const profiles: ProviderProfile[] = snapshot.providerConfigs
        .filter((profile) => profile.id !== providerId)
        .map(({ id, name, baseUrl, model, generationTimeoutSec, createdAt, updatedAt }) => ({
          id, name, baseUrl, model, generationTimeoutSec, createdAt, updatedAt,
        }))
      const defaultProviderId = snapshot.defaultProviderId === providerId
        ? profiles[0]?.id ?? null
        : snapshot.defaultProviderId
      const secrets = await readSecrets()
      delete secrets[providerId]
      await writeProfiles(profiles, defaultProviderId, secrets)
      return (await readSnapshot()).providerConfigs
    },
    async setDefaultProviderId(providerId: string | null) {
      const snapshot = await readSnapshot()
      const nextDefault = providerId && snapshot.providerConfigs.some((profile) => profile.id === providerId)
        ? providerId
        : snapshot.providerConfigs[0]?.id ?? null
      await adapter.set({ [SETTINGS_KEYS.defaultProviderId]: nextDefault })
      return nextDefault
    },
    async getDefaultProviderId() {
      return (await readSnapshot()).defaultProviderId
    },
    async hasProviderApiKey(providerId: string) {
      return Boolean((await readSecrets())[providerId])
    },
    async setProviderApiKey(providerId: string, apiKey: string) {
      const secrets = await readSecrets()
      if (apiKey.trim()) secrets[providerId] = apiKey.trim()
      else delete secrets[providerId]
      await adapter.set({ [SETTINGS_KEYS.providerSecrets]: secrets })
    },
    async removeProviderApiKey(providerId: string) {
      const secrets = await readSecrets()
      delete secrets[providerId]
      await adapter.set({ [SETTINGS_KEYS.providerSecrets]: secrets })
    },
    async resolveProvider(providerId: string): Promise<ResolvedProvider> {
      const profile = (await readSnapshot()).providerConfigs.find((entry) => entry.id === providerId)
      if (!profile) throw new Error("Provider profile was not found.")
      const apiKey = (await readSecrets())[providerId]
      if (!apiKey) throw new Error("Provider API key is not configured.")
      return { profile, apiKey }
    },
    async resolveDefaultProvider(): Promise<ResolvedProvider> {
      const providerId = (await readSnapshot()).defaultProviderId
      if (!providerId) throw new Error("Configure a default provider before continuing.")
      return this.resolveProvider(providerId)
    },
    async getDiagnosticLogging(): Promise<boolean> {
      return (await readSnapshot()).diagnosticLogging
    },
    async setDiagnosticLogging(enabled: boolean) {
      await adapter.set({ [SETTINGS_KEYS.diagnosticLogging]: enabled })
    },
    async getSettingsSnapshot() {
      return readSnapshot()
    },
    async getProviderConfigs() {
      return (await readSnapshot()).providerConfigs
    },
    async saveProviderConfig(input: Omit<ProviderProfile, "createdAt" | "updatedAt" | "generationTimeoutSec"> & {
      apiKey: string
      generationTimeoutSec?: number
      createdAt?: string
      updatedAt?: string
    }) {
      return this.saveProviderProfile(input, input.apiKey)
    },
    async setDefaultProviderConfig(providerId: string | null) {
      return this.setDefaultProviderId(providerId)
    },
    async removeProviderConfig(providerId: string) {
      return this.removeProviderProfile(providerId)
    },
    async exportSettings(): Promise<SettingsExportSnapshot> {
      const snapshot = await readSnapshot()
      return {
        ...snapshot,
        providerConfigs: snapshot.providerConfigs.map(sanitizeProviderConfigForExport),
      }
    },
    async clearSettings() {
      await adapter.remove([
        SETTINGS_KEYS.theme,
        SETTINGS_KEYS.defaultProviderId,
        SETTINGS_KEYS.providerProfiles,
        SETTINGS_KEYS.providerSecrets,
        SETTINGS_KEYS.legacyProviderConfigs,
        SETTINGS_KEYS.diagnosticLogging,
      ])
      migrationPromise = null
    }
  }
}

function normalizeGenerationTimeoutSec(value: unknown): number {
  return Number.isInteger(value)
    && Number(value) >= MIN_PROVIDER_GENERATION_TIMEOUT_SEC
    && Number(value) <= MAX_PROVIDER_GENERATION_TIMEOUT_SEC
    ? Number(value)
    : DEFAULT_PROVIDER_GENERATION_TIMEOUT_SEC
}

export const settingsStorage = createSettingsStorage()
