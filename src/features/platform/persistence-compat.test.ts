import { describe, expect, it } from "bun:test"

import {
  projectPersistedVideoIdentity,
  shouldPersistPlatformAnalysis,
} from "@/features/platform/persistence-compat"

describe("platform persistence compatibility", () => {
  it("persists both supported platforms through contentKey", () => {
    expect(shouldPersistPlatformAnalysis({
      platform: "youtube",
    })).toBe(true)
    expect(shouldPersistPlatformAnalysis({
      platform: "bilibili",
    })).toBe(true)
  })

  it("preserves the existing YouTube timestamp identity projection", () => {
    expect(projectPersistedVideoIdentity("youtube12345")).toEqual({
      platform: "youtube",
      videoId: "youtube12345",
      contentKey: "youtube:youtube12345",
    })
  })
})
