import { describe, expect, it } from "bun:test"

import { PLATFORM_ADAPTERS, resolvePlatformAdapter } from "@/features/platform/registry"
import { youtubeAdapter } from "@/features/platform/youtube/youtube-adapter"
import { bilibiliAdapter } from "@/features/platform/bilibili/bilibili-adapter"

describe("platform adapter registry", () => {
  it("resolves supported YouTube watch URLs to the registered adapter", () => {
    expect(PLATFORM_ADAPTERS).toEqual([youtubeAdapter, bilibiliAdapter])
    expect(resolvePlatformAdapter("https://www.youtube.com/watch?v=video123456")).toBe(youtubeAdapter)
    expect(resolvePlatformAdapter("https://www.bilibili.com/video/BV1xx411c7mD/?p=2")).toBe(bilibiliAdapter)
  })

  it("returns null for unsupported and malformed URLs without requiring a DOM", () => {
    expect(resolvePlatformAdapter("https://example.com/watch?v=video123456")).toBeNull()
    expect(resolvePlatformAdapter("not a URL")).toBeNull()
  })
})
