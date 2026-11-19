import { sanitizeProviderConfigForExport } from "@/lib/export/provider-config-export"
import {
  DEFAULT_PROVIDER_GENERATION_TIMEOUT_SEC,
  MAX_PROVIDER_GENERATION_TIMEOUT_SEC,
  MIN_PROVIDER_GENERATION_TIMEOUT_SEC,
} from "@/features/settings/lib/provider-schema"
import { normalizeAnalysisPresetId, type AnalysisPresetId } from "@/features/analysis/lib/analysis-preset"
import {
  normalizeLanguagePreference,
  type LanguagePreference,
} from "@/lib/i18n/i18n"

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
  /** Opaque, non-secret revision rotated whenever this profile's key is replaced or removed. */
  credentialRevision: string
}

export type SettingsSnapshot = {
  theme: ThemePreference
  language: LanguagePreference
  defaultProviderId: string | null
  providerConfigs: ProviderProfileView[]
  diagnosticLogging: boolean
  /** Global analysis preset default applied to newly started analysis tasks. */
  analysisPresetId: AnalysisPresetId
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

export type SettingsStorageLockManager = {
  request: <T>(
    name: string,
    options: { mode: "exclusive" },
    callback: (lock: { name: string; mode: "exclusive" } | null) => Promise<T>,
  ) => Promise<T>
}

export type SettingsStorageOptions = {
  /** Pass null in tests to verify the explicit unavailable-lock failure path. */
  lockManager?: SettingsStorageLockManager | null
}

const PROVIDER_SETTINGS_WRITE_LOCK = "yt-summarizer.settings.provider.write"

export const SETTINGS_KEYS = {
  theme: "yt-summarizer.theme",
  defaultProviderId: "yt-summarizer.provider.default",
  providerProfiles: "yt-summarizer.provider.profiles",
  providerSecrets: "yt-summarizer.provider.secrets",
  legacyProviderConfigs: "yt-summarizer.provider.configs",
  diagnosticLogging: "yt-summarizer.diagnostic-logging",
  language: "yt-summarizer.language",
  analysisPreset: "yt-summarizer.analysis.preset",
} as const

const SETTINGS_KEY_LIST = [
  SETTINGS_KEYS.theme,
  SETTINGS_KEYS.defaultProviderId,
  SETTINGS_KEYS.providerProfiles,
  SETTINGS_KEYS.providerSecrets,
  SETTINGS_KEYS.legacyProviderConfigs,
  SETTINGS_KEYS.diagnosticLogging,
  SETTINGS_KEYS.language,
  SETTINGS_KEYS.analysisPreset,
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

type ProviderSecretEntry = {
  apiKey: string
  credentialRevision: string
}

type ProviderSecretRecord = Record<string, ProviderSecretEntry>

function createCredentialRevision(): string {
  return globalThis.crypto.randomUUID()
}

function normalizeSecretEntries(value: unknown): {
  entries: ProviderSecretRecord
  needsMigration: boolean
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { entries: {}, needsMigration: false }
  }
  const entries: ProviderSecretRecord = {}
  let needsMigration = false
  for (const [id, secret] of Object.entries(value as Record<string, unknown>)) {
    if (typeof secret === "string" && secret.trim()) {
      entries[id] = { apiKey: secret.trim(), credentialRevision: createCredentialRevision() }
      needsMigration = true
      continue
    }
    if (!secret || typeof secret !== "object" || Array.isArray(secret)) continue
    const record = secret as Partial<ProviderSecretEntry>
    if (typeof record.apiKey !== "string" || !record.apiKey.trim()) continue
    const credentialRevision = typeof record.credentialRevision === "string"
      && record.credentialRevision.trim()
      ? record.credentialRevision.trim()
      : createCredentialRevision()
    if (credentialRevision !== record.credentialRevision) needsMigration = true
    entries[id] = { apiKey: record.apiKey.trim(), credentialRevision }
  }
  return { entries, needsMigration }
}

function normalizeSecrets(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(normalizeSecretEntries(value).entries).map(([id, entry]) => [id, entry.apiKey]),
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

export function createSettingsStorage(
  adapter = createChromeStorageAdapter(),
  options: SettingsStorageOptions = {},
) {
  let migrationPromise: Promise<void> | null = null
  const lockManager = options.lockManager === undefined
    ? (typeof navigator === "undefined" || !navigator.locks
      ? null
      : navigator.locks as unknown as SettingsStorageLockManager)
    : options.lockManager

  async function withProviderWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    if (!lockManager) {
      throw new Error("Provider settings coordination requires Web Locks in this browser context.")
    }
    return lockManager.request(
      PROVIDER_SETTINGS_WRITE_LOCK,
      { mode: "exclusive" },
      async (lock) => {
        if (!lock) throw new Error("Could not acquire the provider settings write lock.")
        return operation()
      },
    )
  }

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

    const normalizedSecrets = normalizeSecretEntries(values[SETTINGS_KEYS.providerSecrets])
    if (legacyValues.length === 0 && !normalizedSecrets.needsMigration) return

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
    const secrets = normalizedSecrets.entries
    for (const entry of migrated) {
      if (entry.apiKey && secrets[entry.profile.id] === undefined) {
        secrets[entry.profile.id] = {
          apiKey: entry.apiKey,
          credentialRevision: createCredentialRevision()
        }
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

  async function ensureMigrationLocked() {
    if (!migrationPromise) {
      const pending = migrateLegacyProviderStorage()
      migrationPromise = pending.catch((error) => {
        migrationPromise = null
        throw error
      })
    }
    await migrationPromise
  }

  async function ensureMigration() {
    await withProviderWriteLock(ensureMigrationLocked)
  }

  async function withMigratedWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    return withProviderWriteLock(async () => {
      await ensureMigrationLocked()
      return operation()
    })
  }

  async function readSnapshotCurrent(): Promise<SettingsSnapshot> {
    const values = await adapter.get<unknown>([
      SETTINGS_KEYS.theme,
      SETTINGS_KEYS.defaultProviderId,
      SETTINGS_KEYS.providerProfiles,
      SETTINGS_KEYS.providerSecrets,
      SETTINGS_KEYS.diagnosticLogging,
      SETTINGS_KEYS.language,
      SETTINGS_KEYS.analysisPreset,
    ])
    const profiles = normalizeProfiles(values[SETTINGS_KEYS.providerProfiles])
    const secrets = normalizeSecrets(values[SETTINGS_KEYS.providerSecrets])
    const requestedDefault = typeof values[SETTINGS_KEYS.defaultProviderId] === "string"
      ? String(values[SETTINGS_KEYS.defaultProviderId])
      : null
    const defaultProviderId = profiles.some((profile) => profile.id === requestedDefault)
      ? requestedDefault
      : profiles[0]?.id ?? null

    const providerConfigs = profiles.map((profile) => ({
      ...profile,
      isDefault: profile.id === defaultProviderId,
      hasApiKey: typeof secrets[profile.id] === "string" && secrets[profile.id].length > 0,
    }))
    return {
      theme: normalizeThemePreference(values[SETTINGS_KEYS.theme]),
      language: normalizeLanguagePreference(values[SETTINGS_KEYS.language]),
      defaultProviderId: defaultProviderId as string | null,
      providerConfigs,
      diagnosticLogging: values[SETTINGS_KEYS.diagnosticLogging] === true,
      analysisPresetId: normalizeAnalysisPresetId(values[SETTINGS_KEYS.analysisPreset]),
    }
  }

  async function readSnapshot(): Promise<SettingsSnapshot> {
    await ensureMigration()
    return readSnapshotCurrent()
  }

  async function readSecretEntriesCurrent(): Promise<ProviderSecretRecord> {
    const values = await adapter.get<unknown>([SETTINGS_KEYS.providerSecrets])
    return normalizeSecretEntries(values[SETTINGS_KEYS.providerSecrets]).entries
  }

  async function readSecretEntries(): Promise<ProviderSecretRecord> {
    await ensureMigration()
    return readSecretEntriesCurrent()
  }

  async function writeProfiles(
    profiles: ProviderProfile[],
    defaultProviderId: string | null,
    secrets?: ProviderSecretRecord,
  ) {
    const values: Record<string, StorageValue> = {
      [SETTINGS_KEYS.providerProfiles]: profiles,
      [SETTINGS_KEYS.defaultProviderId]: defaultProviderId,
    }
    // A metadata-only save must not write a stale whole-map credential snapshot.
    if (secrets !== undefined) values[SETTINGS_KEYS.providerSecrets] = secrets
    await adapter.set(values)
  }

  return {
    async getThemePreference() {
      return (await readSnapshot()).theme
    },
    async setThemePreference(theme: ThemePreference) {
      await adapter.set({ [SETTINGS_KEYS.theme]: theme })
      return theme
    },
    async getLanguagePreference(): Promise<LanguagePreference> {
      const values = await adapter.get<unknown>([SETTINGS_KEYS.language])
      return normalizeLanguagePreference(values[SETTINGS_KEYS.language])
    },
    async setLanguagePreference(language: LanguagePreference) {
      const normalized = normalizeLanguagePreference(language)
      await adapter.set({ [SETTINGS_KEYS.language]: normalized })
      return normalized
    },
    async getAnalysisPresetId(): Promise<AnalysisPresetId> {
      const values = await adapter.get<unknown>([SETTINGS_KEYS.analysisPreset])
      return normalizeAnalysisPresetId(values[SETTINGS_KEYS.analysisPreset])
    },
    async setAnalysisPresetId(presetId: AnalysisPresetId) {
      const normalized = normalizeAnalysisPresetId(presetId)
      await adapter.set({ [SETTINGS_KEYS.analysisPreset]: normalized })
      return normalized
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
      return withMigratedWriteLock(async () => {
        const snapshot = await readSnapshotCurrent()
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
        const secrets = await readSecretEntriesCurrent()
        if (apiKey !== undefined) {
          if (apiKey.trim()) {
            secrets[profile.id] = {
              apiKey: apiKey.trim(),
              credentialRevision: createCredentialRevision()
            }
          } else delete secrets[profile.id]
        }
        await writeProfiles(profiles, defaultProviderId, apiKey === undefined ? undefined : secrets)
        return {
          ...profile,
          isDefault: defaultProviderId === profile.id,
          hasApiKey: Boolean(secrets[profile.id]),
        }
      })
    },
    async removeProviderProfile(providerId: string) {
      return withMigratedWriteLock(async () => {
        const snapshot = await readSnapshotCurrent()
        const profiles: ProviderProfile[] = snapshot.providerConfigs
          .filter((profile) => profile.id !== providerId)
          .map(({ id, name, baseUrl, model, generationTimeoutSec, createdAt, updatedAt }) => ({
            id, name, baseUrl, model, generationTimeoutSec, createdAt, updatedAt,
          }))
        const defaultProviderId = snapshot.defaultProviderId === providerId
          ? profiles[0]?.id ?? null
          : snapshot.defaultProviderId
        const secrets = await readSecretEntriesCurrent()
        delete secrets[providerId]
        await writeProfiles(profiles, defaultProviderId, secrets)
        return (await readSnapshotCurrent()).providerConfigs
      })
    },
    async setDefaultProviderId(providerId: string | null) {
      return withMigratedWriteLock(async () => {
        const snapshot = await readSnapshotCurrent()
        const nextDefault = providerId && snapshot.providerConfigs.some((profile) => profile.id === providerId)
          ? providerId
          : snapshot.providerConfigs[0]?.id ?? null
        await adapter.set({ [SETTINGS_KEYS.defaultProviderId]: nextDefault })
        return nextDefault
      })
    },
    async getDefaultProviderId() {
      return (await readSnapshot()).defaultProviderId
    },
    async hasProviderApiKey(providerId: string) {
      return Boolean((await readSecretEntries())[providerId])
    },
    async setProviderApiKey(providerId: string, apiKey: string) {
      return withMigratedWriteLock(async () => {
        const snapshot = await readSnapshotCurrent()
        if (!snapshot.providerConfigs.some((profile) => profile.id === providerId)) {
          throw new Error("Provider profile was not found.")
        }
        const secrets = await readSecretEntriesCurrent()
        if (apiKey.trim()) {
          secrets[providerId] = {
            apiKey: apiKey.trim(),
            credentialRevision: createCredentialRevision()
          }
        } else delete secrets[providerId]
        await adapter.set({ [SETTINGS_KEYS.providerSecrets]: secrets })
      })
    },
    async removeProviderApiKey(providerId: string) {
      return withMigratedWriteLock(async () => {
        const secrets = await readSecretEntriesCurrent()
        delete secrets[providerId]
        await adapter.set({ [SETTINGS_KEYS.providerSecrets]: secrets })
      })
    },
    async resolveProvider(providerId: string): Promise<ResolvedProvider> {
      await ensureMigration()
      // Read the profile and its secret envelope together so apiKey and its
      // revision can never come from different storage snapshots.
      const values = await adapter.get<unknown>([
        SETTINGS_KEYS.providerProfiles,
        SETTINGS_KEYS.providerSecrets,
        SETTINGS_KEYS.defaultProviderId,
      ])
      const profile = normalizeProfiles(values[SETTINGS_KEYS.providerProfiles])
        .find((entry) => entry.id === providerId)
      if (!profile) throw new Error("Provider profile was not found.")
      const entry = normalizeSecretEntries(values[SETTINGS_KEYS.providerSecrets]).entries[providerId]
      if (!entry) throw new Error("Provider API key is not configured.")
      const requestedDefault = typeof values[SETTINGS_KEYS.defaultProviderId] === "string"
        ? String(values[SETTINGS_KEYS.defaultProviderId])
        : null
      return {
        profile: {
          ...profile,
          isDefault: requestedDefault === providerId,
          hasApiKey: true
        },
        apiKey: entry.apiKey,
        credentialRevision: entry.credentialRevision
      }
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
      await withProviderWriteLock(async () => {
        // Any earlier migration holds this same lock until its writes have settled.
        await adapter.remove([
          SETTINGS_KEYS.theme,
          SETTINGS_KEYS.defaultProviderId,
          SETTINGS_KEYS.providerProfiles,
          SETTINGS_KEYS.providerSecrets,
          SETTINGS_KEYS.legacyProviderConfigs,
          SETTINGS_KEYS.diagnosticLogging,
          SETTINGS_KEYS.language,
          SETTINGS_KEYS.analysisPreset,
        ])
        migrationPromise = null
      })
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
