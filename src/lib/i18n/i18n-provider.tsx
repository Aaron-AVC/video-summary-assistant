import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { settingsStorage } from "@/features/settings/lib/settings-storage"
import {
  normalizeLanguagePreference,
  resolveLocale,
  translate,
  type AppLocale,
  type LanguagePreference,
  type TranslationParams,
} from "./i18n"
import type { TranslationKey } from "./en"

type I18nContextValue = {
  locale: AppLocale
  preference: LanguagePreference
  t: (key: TranslationKey, params?: TranslationParams) => string
  setPreference: (preference: LanguagePreference) => Promise<void>
}

const DEFAULT_I18N_CONTEXT: I18nContextValue = {
  locale: "en",
  preference: "auto",
  t: (key, params) => translate("en", key, params),
  setPreference: async () => {},
}

const I18nContext = createContext<I18nContextValue>(DEFAULT_I18N_CONTEXT)
const LANGUAGE_STORAGE_KEY = "yt-summarizer.language"

type PreferenceChangeListener = (value: unknown) => void

type I18nPreferenceSynchronizerOptions = {
  readPreference: () => Promise<unknown>
  writePreference: (preference: LanguagePreference) => Promise<unknown>
  subscribe: (listener: PreferenceChangeListener) => () => void
  onPreference: (preference: LanguagePreference) => void
}

/**
 * Keeps async preference reads and writes ordered against storage events.
 * The revision is advanced before every externally observable change, so an
 * older in-flight operation cannot overwrite a newer event or user choice.
 */
export function createI18nPreferenceSynchronizer({
  readPreference,
  writePreference,
  subscribe,
  onPreference,
}: I18nPreferenceSynchronizerOptions) {
  let revision = 0
  let stopped = false
  let unsubscribe: (() => void) | null = null
  let writeQueue: Promise<void> = Promise.resolve()

  const applyIfCurrent = (value: unknown, expectedRevision?: number) => {
    if (stopped || (expectedRevision !== undefined && expectedRevision !== revision)) return
    onPreference(normalizeLanguagePreference(value))
  }

  const start = () => {
    if (stopped || unsubscribe) return

    unsubscribe = subscribe((value) => {
      revision += 1
      applyIfCurrent(value)
    })

    const initialRevision = revision
    try {
      void readPreference()
        .then((value) => applyIfCurrent(value, initialRevision))
        .catch(() => {
          // Keep the safe default when storage is unavailable or read fails.
        })
    } catch {
      // Keep the safe default when storage access throws synchronously.
    }
  }

  const setPreference = async (value: LanguagePreference) => {
    const normalized = normalizeLanguagePreference(value)
    revision += 1
    const operationRevision = revision
    const write = writeQueue.catch(() => {}).then(async () => {
      await writePreference(normalized)
      applyIfCurrent(normalized, operationRevision)
    })
    writeQueue = write
    await write
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    revision += 1
    unsubscribe?.()
    unsubscribe = null
  }

  return { start, setPreference, stop }
}

function subscribeToLanguageChanges(listener: PreferenceChangeListener) {
  const storageArea = globalThis.chrome?.storage
  if (!storageArea?.onChanged) return () => {}

  const handleStorageChange = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string,
  ) => {
    if (areaName !== "local") return
    const change = changes[LANGUAGE_STORAGE_KEY]
    if (change) listener(change.newValue)
  }

  storageArea.onChanged.addListener(handleStorageChange)
  return () => storageArea.onChanged.removeListener(handleStorageChange)
}

export function I18nProvider({ children }: PropsWithChildren) {
  const [preference, setPreferenceState] = useState<LanguagePreference>("auto")
  const [locale, setLocale] = useState<AppLocale>(() => resolveLocale("auto"))
  const synchronizerRef = useRef<ReturnType<typeof createI18nPreferenceSynchronizer> | null>(null)

  const applyPreference = useCallback((next: unknown) => {
    const normalized = normalizeLanguagePreference(next)
    setPreferenceState(normalized)
    setLocale(resolveLocale(normalized))
  }, [])

  useEffect(() => {
    const synchronizer = createI18nPreferenceSynchronizer({
      readPreference: () => settingsStorage.getLanguagePreference(),
      writePreference: (next) => settingsStorage.setLanguagePreference(next),
      subscribe: subscribeToLanguageChanges,
      onPreference: applyPreference,
    })
    synchronizerRef.current = synchronizer
    synchronizer.start()
    return () => {
      synchronizer.stop()
      if (synchronizerRef.current === synchronizer) synchronizerRef.current = null
    }
  }, [applyPreference])

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = locale
  }, [locale])

  const setPreference = useCallback(async (next: LanguagePreference) => {
    const synchronizer = synchronizerRef.current
    if (synchronizer) {
      await synchronizer.setPreference(next)
      return
    }
    const normalized = normalizeLanguagePreference(next)
    await settingsStorage.setLanguagePreference(normalized)
    applyPreference(normalized)
  }, [applyPreference])

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    preference,
    t: (key, params) => translate(locale, key, params),
    setPreference,
  }), [locale, preference, setPreference])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext)
}
