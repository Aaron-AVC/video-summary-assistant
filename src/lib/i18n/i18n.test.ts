import { describe, expect, it } from "bun:test"

import { en } from "@/lib/i18n/en"
import { zhCN } from "@/lib/i18n/zh-CN"
import {
  interpolate,
  normalizeLanguagePreference,
  resolveLocale,
  translate,
} from "@/lib/i18n/i18n"

describe("i18n", () => {
  it("resolves auto and explicit language preferences", () => {
    expect(resolveLocale("auto", "zh-CN")).toBe("zh-CN")
    expect(resolveLocale("auto", "zh-TW")).toBe("zh-CN")
    expect(resolveLocale("auto", "en-US")).toBe("en")
    expect(resolveLocale("zh-CN", "en-US")).toBe("zh-CN")
    expect(resolveLocale("en", "zh-CN")).toBe("en")
  })

  it("normalizes invalid persisted values to auto", () => {
    expect(normalizeLanguagePreference("ja")).toBe("auto")
    expect(normalizeLanguagePreference(undefined)).toBe("auto")
    expect(normalizeLanguagePreference("zh-CN")).toBe("zh-CN")
  })

  it("keeps dictionary keys in parity and interpolates deterministically", () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort())
    expect(interpolate("Saved {count} items", { count: 3 })).toBe("Saved 3 items")
    expect(interpolate("Saved {count} items")).toBe("Saved {count} items")
    expect(translate("zh-CN", "data.currentInventory", { count: 3 })).toContain("3")
  })
})
