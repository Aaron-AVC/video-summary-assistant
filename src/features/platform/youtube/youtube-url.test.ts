import { describe, expect, it } from "bun:test"

import { config as youtubeWatchConfig } from "@/contents/youtube-watch"
import {
  isSupportedYouTubeWatchUrl,
  YOUTUBE_WATCH_MATCH_PATTERNS,
} from "@/features/platform/youtube/youtube-url"
import { youtubeAdapter } from "@/features/platform/youtube/youtube-adapter"
import { matchesManifestPattern } from "@/lib/runtime/manifest-pattern"

describe("YouTube watch URL support boundary", () => {
  it("keeps adapter support, content-script matches, and manifest matcher aligned", () => {
    expect(youtubeWatchConfig.matches).toEqual([...YOUTUBE_WATCH_MATCH_PATTERNS])

    for (const href of [
      "https://www.youtube.com/watch?v=video123456",
      "https://youtube.com/watch?v=video123456",
    ]) {
      const url = new URL(href)
      expect(YOUTUBE_WATCH_MATCH_PATTERNS.some((pattern) => matchesManifestPattern(href, pattern))).toBe(true)
      expect(isSupportedYouTubeWatchUrl(url)).toBe(true)
      expect(youtubeAdapter.canHandle(url)).toBe(true)
    }

    const unsupported = new URL("https://m.youtube.com/watch?v=video123456")
    expect(YOUTUBE_WATCH_MATCH_PATTERNS.some((pattern) => matchesManifestPattern(unsupported.href, pattern))).toBe(false)
    expect(isSupportedYouTubeWatchUrl(unsupported)).toBe(false)
    expect(youtubeAdapter.canHandle(unsupported)).toBe(false)
  })
})
