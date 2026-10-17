import { en, type TranslationKey } from "./en"
import { zhCN } from "./zh-CN"

export type LanguagePreference = "auto" | "zh-CN" | "en"
export type AppLocale = "zh-CN" | "en"
export type TranslationParams = Record<string, string | number>

export function normalizeLanguagePreference(value: unknown): LanguagePreference {
  return value === "zh-CN" || value === "en" || value === "auto" ? value : "auto"
}

export function resolveLocale(
  preference: LanguagePreference,
  browserLocale?: string | null,
): AppLocale {
  if (preference === "zh-CN") return "zh-CN"
  if (preference === "en") return "en"
  let detectedLocale = browserLocale
  if (detectedLocale === undefined) {
    try {
      detectedLocale = globalThis.chrome?.i18n?.getUILanguage?.()
    } catch {
      detectedLocale = undefined
    }
  }
  const browser = typeof detectedLocale === "string" && detectedLocale.trim()
    ? detectedLocale
    : typeof navigator !== "undefined" ? navigator.language : "en"
  return String(browser).toLowerCase().startsWith("zh") ? "zh-CN" : "en"
}

export function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template
  return template.replace(/\{([\w.-]+)\}/g, (match, name: string) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}

export function translate(locale: AppLocale, key: TranslationKey, params?: TranslationParams): string {
  const template = (locale === "zh-CN" ? zhCN : en)[key] ?? en[key]
  return interpolate(template, params)
}
