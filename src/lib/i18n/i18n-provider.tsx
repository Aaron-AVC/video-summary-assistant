import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

export function I18nProvider({ children }: PropsWithChildren) {
  const [preference, setPreferenceState] = useState<LanguagePreference>("auto")
  const [locale, setLocale] = useState<AppLocale>(() => resolveLocale("auto"))

  const applyPreference = useCallback((next: unknown) => {
    const normalized = normalizeLanguagePreference(next)
    setPreferenceState(normalized)
    setLocale(resolveLocale(normalized))
  }, [])

  useEffect(() => {
    void settingsStorage.getLanguagePreference().then(applyPreference)
    const storageArea = globalThis.chrome?.storage
    if (!storageArea?.onChanged) return
    const handleStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ) => {
      if (areaName !== "local") return
      const change = changes[LANGUAGE_STORAGE_KEY]
      if (change) applyPreference(change.newValue)
    }
    storageArea.onChanged.addListener(handleStorageChange)
    return () => storageArea.onChanged.removeListener(handleStorageChange)
  }, [applyPreference])

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = locale
  }, [locale])

  const setPreference = useCallback(async (next: LanguagePreference) => {
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
