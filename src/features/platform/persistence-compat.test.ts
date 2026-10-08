import { describe, expect, it } from "bun:test"

import {
  projectPersistedVideoIdentity,
  shouldPersistPlatformAnalysis,
} from "@/features/platform/persistence-compat"

describe("platform persistence compatibility", () => {
  it("keeps existing YouTube history persistence and skips videoId-only Bilibili history", () => {
    expect(shouldPersistPlatformAnalysis({
      platform: "youtube",
    })).toBe(true)
    expect(shouldPersistPlatformAnalysis({
      platform: "bilibili",
    })).toBe(false)
  })

  it("preserves the existing YouTube timestamp identity projection", () => {
    expect(projectPersistedVideoIdentity("youtube12345")).toEqual({
      platform: "youtube",
      videoId: "youtube12345",
      contentKey: "youtube:youtube12345",
    })
  })
})
