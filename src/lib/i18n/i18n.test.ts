import { describe, expect, it } from "bun:test"

import { en } from "@/lib/i18n/en"
import { zhCN } from "@/lib/i18n/zh-CN"
import { createI18nPreferenceSynchronizer } from "@/lib/i18n/i18n-provider"
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

  it("applies the normal initial preference load", async () => {
    const updates: string[] = []
    const synchronizer = createI18nPreferenceSynchronizer({
      readPreference: async () => "zh-CN",
      writePreference: async () => {},
      subscribe: () => () => {},
      onPreference: (preference) => updates.push(preference),
    })

    synchronizer.start()
    await Promise.resolve()

    expect(updates).toEqual(["zh-CN"])
    synchronizer.stop()
  })

  it("does not let a stale initial read overwrite an earlier storage event", async () => {
    let resolveInitial!: (value: unknown) => void
    const initialRead = new Promise<unknown>((resolve) => {
      resolveInitial = resolve
    })
    let emit: ((value: unknown) => void) | undefined
    const updates: string[] = []
    const synchronizer = createI18nPreferenceSynchronizer({
      readPreference: () => initialRead,
      writePreference: async () => {},
      subscribe: (listener) => {
        emit = listener
        return () => { emit = undefined }
      },
      onPreference: (preference) => updates.push(preference),
    })

    synchronizer.start()
    emit?.("en")
    resolveInitial("zh-CN")
    await Promise.resolve()

    expect(updates).toEqual(["en"])
    synchronizer.stop()
  })

  it("keeps rapid successive user changes ordered", async () => {
    const writes: Array<() => void> = []
    const updates: string[] = []
    const synchronizer = createI18nPreferenceSynchronizer({
      readPreference: async () => "auto",
      writePreference: () => new Promise<void>((resolve) => writes.push(resolve)),
      subscribe: () => () => {},
      onPreference: (preference) => updates.push(preference),
    })

    synchronizer.start()
    await Promise.resolve()
    const first = synchronizer.setPreference("zh-CN")
    const second = synchronizer.setPreference("en")
    writes[1]()
    await second
    writes[0]()
    await first

    expect(updates).toEqual(["auto", "en"])
    synchronizer.stop()
  })

  it("cleans up the listener and ignores events after stop", () => {
    let listener: ((value: unknown) => void) | undefined
    let cleanupCount = 0
    const updates: string[] = []
    const synchronizer = createI18nPreferenceSynchronizer({
      readPreference: async () => "auto",
      writePreference: async () => {},
      subscribe: (nextListener) => {
        listener = nextListener
        return () => {
          cleanupCount += 1
        }
      },
      onPreference: (preference) => updates.push(preference),
    })

    synchronizer.start()
    synchronizer.stop()
    listener?.("zh-CN")

    expect(cleanupCount).toBe(1)
    expect(updates).toEqual([])
  })

  it("swallows initial read failures without an unhandled rejection", async () => {
    const updates: string[] = []
    const synchronizer = createI18nPreferenceSynchronizer({
      readPreference: async () => {
        throw new Error("storage unavailable")
      },
      writePreference: async () => {},
      subscribe: () => () => {},
      onPreference: (preference) => updates.push(preference),
    })

    synchronizer.start()
    await Promise.resolve()

    expect(updates).toEqual([])
    synchronizer.stop()
  })
})
