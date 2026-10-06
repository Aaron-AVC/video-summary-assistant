import {
  settingsStorage,
  type ThemePreference
} from "@/features/settings/lib/settings-storage"

const THEME_STORAGE_KEY = "yt-summarizer-theme"

export function createThemeStorage() {
  return {
    async getThemePreference(): Promise<ThemePreference> {
      const storedTheme = readLocalThemePreference()

      if (storedTheme) {
        return storedTheme
      }

      const theme = await settingsStorage.getThemePreference()

      persistLocalThemePreference(theme)
      return theme
    },
    async setThemePreference(theme: ThemePreference) {
      persistLocalThemePreference(theme)
      await settingsStorage.setThemePreference(theme)
      return theme
    }
  }
}

export const themeStorage = createThemeStorage()

function readLocalThemePreference(): ThemePreference | null {
  if (typeof window === "undefined") {
    return null
  }

  const theme = window.localStorage.getItem(THEME_STORAGE_KEY)

  return theme === "light" || theme === "dark" || theme === "system"
    ? theme
    : null
}

function persistLocalThemePreference(theme: ThemePreference) {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(THEME_STORAGE_KEY, theme)
}
