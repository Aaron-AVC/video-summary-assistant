import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react"

import { themeStorage } from "@/lib/theme/theme-storage"

type ThemeMode = "light" | "dark" | "system"
type ResolvedTheme = Exclude<ThemeMode, "system">

type ThemeContextValue = {
  theme: ThemeMode
  resolvedTheme: ResolvedTheme
  setTheme: (theme: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const THEME_STORAGE_KEY = "yt-summarizer-theme"

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") {
    return "light"
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

/**
 * Reads the cached theme preference synchronously from localStorage so the
 * initial render can apply the correct html.dark class before paint. Async
 * chrome.storage hydration replaces this once it settles, but using the
 * cached value first removes the light-to-dark FOUC when the sidepanel
 * reopens with a previously-persisted preference.
 */
function readCachedThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "system"
  }

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored
    }
  } catch {
    // localStorage may be unavailable in incognito sandboxes — fall through.
  }

  return "system"
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? getSystemTheme() : mode
}

function applyHtmlThemeClass(resolved: ResolvedTheme) {
  if (typeof document === "undefined") {
    return
  }
  document.documentElement.classList.toggle("dark", resolved === "dark")
}

// Apply the cached resolved theme synchronously at module load. This runs
// before React mounts, so the html.dark class is correct on first paint
// even though full storage hydration is async.
if (typeof document !== "undefined") {
  applyHtmlThemeClass(resolveTheme(readCachedThemeMode()))
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const initialMode = readCachedThemeMode()
  const [theme, setTheme] = useState<ThemeMode>(initialMode)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(initialMode)
  )

  useEffect(() => {
    void themeStorage.getThemePreference().then((storedTheme) => {
      setTheme(storedTheme)
    })

    // Sync the theme across extension surfaces (sidepanel, options) when
    // the user changes it in any of them. chrome.storage.onChanged fires
    // in every extension page so reading the new value here keeps the
    // sidepanel in step with the Options Appearance toggle without a
    // reload.
    const storageArea = globalThis.chrome?.storage
    if (!storageArea?.onChanged) {
      return
    }
    const SETTINGS_THEME_KEY = "yt-summarizer.theme"
    const handleStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ) => {
      if (areaName !== "local") return
      const change = changes[SETTINGS_THEME_KEY]
      if (!change) return
      const next = change.newValue
      if (next === "light" || next === "dark" || next === "system") {
        try {
          window.localStorage.setItem(THEME_STORAGE_KEY, next)
        } catch {
          // localStorage may be unavailable; chrome.storage is still authoritative.
        }
        setTheme(next)
      }
    }
    storageArea.onChanged.addListener(handleStorageChange)
    return () => {
      storageArea.onChanged.removeListener(handleStorageChange)
    }
  }, [])

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")

    const applyTheme = (nextTheme: ThemeMode) => {
      const nextResolvedTheme = resolveTheme(nextTheme)

      applyHtmlThemeClass(nextResolvedTheme)
      setResolvedTheme(nextResolvedTheme)
    }

    applyTheme(theme)

    const handleChange = () => {
      if (theme === "system") {
        applyTheme("system")
      }
    }

    mediaQuery.addEventListener("change", handleChange)

    return () => {
      mediaQuery.removeEventListener("change", handleChange)
    }
  }, [theme])

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme: (nextTheme) => {
        void themeStorage.setThemePreference(nextTheme)
        setTheme(nextTheme)
      }
    }),
    [resolvedTheme, theme]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)

  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }

  return context
}
