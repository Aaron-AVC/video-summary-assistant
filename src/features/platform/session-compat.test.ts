import { describe, expect, it, mock } from "bun:test"

import {
  analysisMatchesActiveIdentity,
  persistIfSupportedPlatform,
} from "@/features/platform/persistence-compat"
import type { VideoIdentity } from "@/features/platform/types"

const BVID = "BV1xx411c7mD"

function identity(partId: string): VideoIdentity {
  return {
    platform: "bilibili",
    videoId: BVID,
    partId,
    contentKey: `bilibili:${BVID}:p:${partId}`,
  }
}

describe("contentKey platform persistence compatibility", () => {
  it("allows Bilibili persistence through its part-specific contentKey", async () => {
    const save = mock(async () => "saved")
    await expect(persistIfSupportedPlatform(identity("2"), save)).resolves.toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it("preserves YouTube persistence and distinguishes Bilibili parts for display", async () => {
    const save = mock(async () => "saved")
    await expect(persistIfSupportedPlatform({
      platform: "youtube",
    }, save)).resolves.toBe(true)
    expect(save).toHaveBeenCalledTimes(1)

    expect(analysisMatchesActiveIdentity(identity("1"), identity("1"))).toBe(true)
    expect(analysisMatchesActiveIdentity(identity("1"), identity("2"))).toBe(false)
    expect(analysisMatchesActiveIdentity(identity("2"), {
      platform: "youtube",
      videoId: BVID,
      contentKey: `youtube:${BVID}`,
    })).toBe(false)
  })
})
