import { describe, expect, it } from "bun:test"

import { matchesManifestPattern } from "@/lib/runtime/manifest-pattern"

describe("matchesManifestPattern", () => {
  it("matches a YouTube watch URL against the generated wildcard path", () => {
    expect(matchesManifestPattern(
      "https://www.youtube.com/watch?v=video123456",
      "https://www.youtube.com/watch*",
    )).toBe(true)
  })

  it("rejects unsupported paths and hosts", () => {
    expect(matchesManifestPattern(
      "https://www.youtube.com/",
      "https://www.youtube.com/watch*",
    )).toBe(false)
    expect(matchesManifestPattern(
      "https://m.youtube.com/watch?v=video123456",
      "https://www.youtube.com/watch*",
    )).toBe(false)
  })

  it("supports wildcard subdomains without treating path metacharacters as regex", () => {
    expect(matchesManifestPattern(
      "https://video.example.com/watch.v1?id=1",
      "https://*.example.com/watch.v1*",
    )).toBe(true)
    expect(matchesManifestPattern(
      "https://video.example.com/watchXv1?id=1",
      "https://*.example.com/watch.v1*",
    )).toBe(false)
  })
})
