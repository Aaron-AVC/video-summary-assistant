import { describe, expect, it } from "bun:test"

import type { VideoIdentity } from "@/features/platform/types"
import {
  navigateToTimestamp,
  type TimestampNavigatorResult,
} from "@/sidepanel/navigation/timestamp-navigation"

const youtubeIdentity: VideoIdentity = {
  platform: "youtube",
  videoId: "youtube-video",
  contentKey: "youtube:youtube-video",
}

const bilibiliPartOneIdentity: VideoIdentity = {
  platform: "bilibili",
  videoId: "BV-test",
  partId: "1",
  contentKey: "bilibili:BV-test:p:1",
}

const bilibiliPartTwoIdentity: VideoIdentity = {
  platform: "bilibili",
  videoId: "BV-test",
  partId: "2",
  contentKey: "bilibili:BV-test:p:2",
}

function navigatorReturning(result: TimestampNavigatorResult) {
  const calls: Array<{ identity: VideoIdentity; timestampSeconds: number }> = []
  const navigate = async (identity: VideoIdentity, timestampSeconds: number) => {
    calls.push({ identity, timestampSeconds })
    return result
  }
  return { calls, navigate }
}

describe("timestamp navigation boundary", () => {
  it("returns missing-identity without invoking the runtime navigator", async () => {
    let callCount = 0
    const outcome = await navigateToTimestamp({
      identity: null,
      timestampSeconds: 12.5,
      navigate: async () => {
        callCount += 1
        return { ok: true, openedNewTab: false }
      },
    })

    expect(outcome).toEqual({ kind: "missing-identity" })
    expect(callCount).toBe(0)
  })

  it("forwards the complete YouTube identity and timestamp", async () => {
    const { calls, navigate } = navigatorReturning({ ok: true, openedNewTab: false })

    const outcome = await navigateToTimestamp({
      identity: youtubeIdentity,
      timestampSeconds: 42.75,
      navigate,
    })

    expect(outcome).toEqual({ kind: "jumped-active" })
    expect(calls).toEqual([{ identity: youtubeIdentity, timestampSeconds: 42.75 }])
  })

  it("preserves the Bilibili P1 part identity", async () => {
    const { calls, navigate } = navigatorReturning({ ok: true, openedNewTab: false })

    await navigateToTimestamp({
      identity: bilibiliPartOneIdentity,
      timestampSeconds: 8,
      navigate,
    })

    expect(calls).toEqual([{ identity: bilibiliPartOneIdentity, timestampSeconds: 8 }])
  })

  it("preserves the Bilibili P2 part identity without collapsing it into P1", async () => {
    const { calls, navigate } = navigatorReturning({ ok: true, openedNewTab: false })

    await navigateToTimestamp({
      identity: bilibiliPartTwoIdentity,
      timestampSeconds: 9,
      navigate,
    })

    expect(calls).toEqual([{ identity: bilibiliPartTwoIdentity, timestampSeconds: 9 }])
    expect(calls[0]?.identity).not.toEqual(bilibiliPartOneIdentity)
  })

  it("returns jumped-active for an active-tab success", async () => {
    const { navigate } = navigatorReturning({ ok: true, openedNewTab: false })

    await expect(navigateToTimestamp({
      identity: youtubeIdentity,
      timestampSeconds: 3,
      navigate,
    })).resolves.toEqual({ kind: "jumped-active" })
  })

  it("returns opened-new-tab for a new-tab success", async () => {
    const { navigate } = navigatorReturning({ ok: true, openedNewTab: true })

    await expect(navigateToTimestamp({
      identity: youtubeIdentity,
      timestampSeconds: 3,
      navigate,
    })).resolves.toEqual({ kind: "opened-new-tab" })
  })

  it("preserves a runtime failure error verbatim", async () => {
    const error = "No active tab"
    const { navigate } = navigatorReturning({ ok: false, error })

    await expect(navigateToTimestamp({
      identity: youtubeIdentity,
      timestampSeconds: 3,
      navigate,
    })).resolves.toEqual({ kind: "runtime-failure", error })
  })
})
