import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { VideoPlatform } from "@/features/platform/types"

import {
  FinalResumeSourceMismatchError,
  assertLiveSourceMatchesTask,
  type FinalResumeLiveSourceIdentity,
} from "./final-resume-source-identity"

/**
 * Task A (review F-02, HIGH).
 *
 * The project has no DOM test environment, so the identity check lives in a
 * pure module and `index.tsx` only wires it into `readLiveSource`. These tests
 * exercise the pure contract; the wiring itself is guarded by the source-level
 * assertions at the bottom plus `bun run typecheck`.
 */

type FrozenSource = {
  sourceTabId: number
  platform: VideoPlatform
  videoId: string
  partId: string | null
  contentKey: string
  title: string
}

function frozenYouTube(): FrozenSource {
  return {
    sourceTabId: 11,
    platform: "youtube",
    videoId: "vidA",
    partId: null,
    contentKey: "youtube:vidA",
    title: "Video A",
  }
}

function frozenBilibili(partId: string): FrozenSource {
  return {
    sourceTabId: 42,
    platform: "bilibili",
    videoId: "BV1xx",
    partId,
    contentKey: `bilibili:BV1xx:${partId}`,
    title: "Video B",
  }
}

function live(
  overrides: Partial<FinalResumeLiveSourceIdentity> = {},
): FinalResumeLiveSourceIdentity {
  return {
    isReady: true,
    sourceTabId: 11,
    platform: "youtube",
    videoId: "vidA",
    partId: null,
    contentKey: "youtube:vidA",
    title: "Video A",
    ...overrides,
  }
}

function mismatchField(run: () => unknown): string | null {
  try {
    run()
    return null
  } catch (error) {
    if (error instanceof FinalResumeSourceMismatchError) return error.field
    throw error
  }
}

describe("final resume live source identity", () => {
  it("accepts a live source that still matches the frozen resume task", () => {
    const verified = assertLiveSourceMatchesTask({
      current: live(),
      frozen: frozenYouTube(),
    })

    expect(verified).toEqual({
      sourceTabId: 11,
      platform: "youtube",
      videoId: "vidA",
      partId: null,
      contentKey: "youtube:vidA",
      title: "Video A",
    })
  })

  it("rejects YouTube A -> B -> A: B while the frozen resume is A, A again afterwards", () => {
    const frozen = frozenYouTube()

    // The user switched to B while the resume task is queued/awaiting a read.
    expect(mismatchField(() => assertLiveSourceMatchesTask({
      current: live({
        videoId: "vidB",
        contentKey: "youtube:vidB",
        title: "Video B",
      }),
      frozen,
    }))).toBe("video")

    // Switching back to A is allowed again: the check is stateless.
    const verified = assertLiveSourceMatchesTask({ current: live(), frozen })
    expect(verified.videoId).toBe("vidA")
    expect(verified.contentKey).toBe("youtube:vidA")
  })

  it("rejects Bilibili P1 -> P2 -> P1 by partId and contentKey, then allows P1 again", () => {
    const p1 = frozenBilibili("1")
    const p2Live = live({
      sourceTabId: 42,
      platform: "bilibili",
      videoId: "BV1xx",
      partId: "2",
      contentKey: "bilibili:BV1xx:2",
    })

    expect(mismatchField(() => assertLiveSourceMatchesTask({
      current: p2Live,
      frozen: p1,
    }))).toBe("part")

    // Same part id but a different content key must still fail closed: the
    // content key is the authority for cache and checkpoint identity.
    expect(mismatchField(() => assertLiveSourceMatchesTask({
      current: live({
        sourceTabId: 42,
        platform: "bilibili",
        videoId: "BV1xx",
        partId: "1",
        contentKey: "bilibili:BV1xx:other",
      }),
      frozen: p1,
    }))).toBe("content-key")

    const verified = assertLiveSourceMatchesTask({
      current: live({
        sourceTabId: 42,
        platform: "bilibili",
        videoId: "BV1xx",
        partId: "1",
        contentKey: "bilibili:BV1xx:1",
      }),
      frozen: p1,
    })
    expect(verified.partId).toBe("1")
    expect(verified.contentKey).toBe("bilibili:BV1xx:1")
  })

  it("fails closed when the source changes during an await, so no Final call can publish A", async () => {
    const frozen = frozenYouTube()

    // Model the real readLiveSource shape: capture, await, then re-assert the
    // same captured runtime identity. The second read is B, so the guard must
    // reject before any transcript/model work happens.
    let finalCallCount = 0
    const readLiveSource = async (read: () => FinalResumeLiveSourceIdentity) => {
      const current = read()
      await Promise.resolve()
      const verified = assertLiveSourceMatchesTask({ current, frozen })
      finalCallCount += 1
      return verified
    }

    await expect(readLiveSource(() => live({
      videoId: "vidB",
      contentKey: "youtube:vidB",
    }))).rejects.toBeInstanceOf(FinalResumeSourceMismatchError)

    // Fail closed: the rejected read never reached the Final stage.
    expect(finalCallCount).toBe(0)
  })

  it("rejects a changed tab even when the video identity looks identical", () => {
    expect(mismatchField(() => assertLiveSourceMatchesTask({
      current: live({ sourceTabId: 12 }),
      frozen: frozenYouTube(),
    }))).toBe("tab")
  })

  it("rejects an unready source before anything else", () => {
    expect(mismatchField(() => assertLiveSourceMatchesTask({
      current: live({ isReady: false, contentKey: null }),
      frozen: frozenYouTube(),
    }))).toBe("not-ready")
  })

  it("rejects a platform change", () => {
    expect(mismatchField(() => assertLiveSourceMatchesTask({
      current: live({ platform: "bilibili" }),
      frozen: frozenYouTube(),
    }))).toBe("platform")
  })

  it("takes the title from the live runtime and never from the frozen snapshot", () => {
    // Title is deliberately not a rejection field here: the checkpoint's own
    // strict context comparison owns title equality. The returned identity must
    // still be internally consistent and live-sourced.
    const verified = assertLiveSourceMatchesTask({
      current: live({ title: "Video A (retitled)" }),
      frozen: frozenYouTube(),
    })
    expect(verified.title).toBe("Video A (retitled)")

    const fallback = assertLiveSourceMatchesTask({
      current: live({ title: null }),
      frozen: frozenYouTube(),
    })
    expect(fallback.title).toBe("Video A")
  })

  it("keeps the rejection message content-free", () => {
    try {
      assertLiveSourceMatchesTask({
        current: live({ videoId: "vidB", contentKey: "youtube:vidB", title: "secret title" }),
        frozen: frozenYouTube(),
      })
      throw new Error("expected a rejection")
    } catch (error) {
      expect(error).toBeInstanceOf(FinalResumeSourceMismatchError)
      const message = (error as Error).message
      expect(message).not.toContain("secret title")
      expect(message).not.toContain("vidB")
      expect(message).not.toContain("youtube:")
    }
  })
})

/**
 * Wiring guards. `index.tsx` is a React entry point with no DOM harness, so the
 * inline call site is pinned with a source-level assertion instead of a render
 * test. These fail loudly if the guard is ever bypassed again.
 */
describe("final resume wiring source guards", () => {
  const sidepanelSource = readFileSync(
    join(import.meta.dir, "..", "index.tsx"),
    "utf8",
  )

  // Assertions are booleans on purpose: a `toContain` on a file-sized string
  // makes bun echo the whole source into the failure log.
  it("calls the strict live-source guard inside readLiveSource", () => {
    const start = sidepanelSource.indexOf("readLiveSource: async () =>")
    const end = sidepanelSource.indexOf("loadTranscript: async (live)")
    const wired = start >= 0 && end > start
    expect(wired).toBe(true)
    if (!wired) return
    const readLiveSource = sidepanelSource.slice(start, end)
    expect(readLiveSource.includes("assertLiveSourceMatchesTask")).toBe(true)
    // The F-02 defect was building the source identity from the task snapshot.
    expect(readLiveSource.includes("active.snapshot.platform")).toBe(false)
    expect(readLiveSource.includes("active.snapshot.contentKey")).toBe(false)
    expect(readLiveSource.includes("active.snapshot.videoId")).toBe(false)
    // Every identity field of the returned VideoInfo must come from the live
    // runtime, not from the frozen resume snapshot.
    expect(readLiveSource.includes("live.platform")).toBe(true)
    expect(readLiveSource.includes("live.videoId")).toBe(true)
    expect(readLiveSource.includes("live.contentKey")).toBe(true)
  })

  it("persists the real transcript capture time, never the save completion time", () => {
    const start = sidepanelSource.indexOf("persistCompletedAnalysis: async (input)")
    const end = sidepanelSource.indexOf("return { analysisRunId: result.analysisRunId }")
    const wired = start >= 0 && end > start
    expect(wired).toBe(true)
    if (!wired) return
    const persist = sidepanelSource.slice(start, end)
    expect(persist.includes("transcriptCapturedAt: input.transcriptCapturedAt")).toBe(true)
    expect(persist.includes("transcriptCapturedAt: input.completedAt")).toBe(false)
  })
})

/**
 * Duration ownership. The gate itself never supplies a duration: the caller
 * binds the last real acquisition to its content key. These assertions pin the
 * wiring so a value captured for another video or part cannot be reused.
 */
describe("final resume duration ownership", () => {
  const sidepanelSource = readFileSync(join(import.meta.dir, "..", "index.tsx"), "utf8")

  it("keys the captured duration by content key instead of keeping a bare value", () => {
    const start = sidepanelSource.indexOf("const finalCheckpointDurationRef")
    expect(start >= 0).toBe(true)
    if (start < 0) return
    const decl = sidepanelSource.slice(start, start + 400)
    expect(decl.includes("contentKey")).toBe(true)
  })

  it("resolves the resume duration through the content-key-scoped reader", () => {
    const start = sidepanelSource.indexOf("readLiveSource: async () =>")
    const end = sidepanelSource.indexOf("loadTranscript: async (live)")
    expect(start >= 0 && end > start).toBe(true)
    if (start < 0 || end <= start) return
    const readLiveSource = sidepanelSource.slice(start, end)
    expect(readLiveSource.includes("readFinalCheckpointDuration(live.contentKey)")).toBe(true)
  })
})

/**
 * Regression guard for the real-browser smoke failure: the resume button never
 * reappeared after a Final 502 because the conflict decision was read from
 * render-time React state inside a closure that runs before React re-renders.
 */
describe("final resume conflict wiring guards", () => {
  const sidepanelSource = readFileSync(join(import.meta.dir, "..", "index.tsx"), "utf8")

  it("decides conflict from authority mirrors, not render-era state", () => {
    const start = sidepanelSource.indexOf("finalResumeConflictRef.current = ()")
    expect(start >= 0).toBe(true)
    if (start < 0) return
    const closure = sidepanelSource.slice(start, start + 400)
    expect(closure.includes("computeFinalResumeConflict")).toBe(true)
    // Reading these directly is the defect: they are one render behind the
    // controller notification that triggers the refresh.
    expect(closure.includes("Boolean(activeAnalysisTask)")).toBe(false)
    expect(closure.includes("analysisPhase ===")).toBe(false)
    // The authority mirrors are what must be consulted.
    expect(closure.includes("analysisTaskActiveRef.current")).toBe(true)
  })

  it("keeps the TTL scheduler as the expiry-driven one, not a fixed poll", () => {
    expect(sidepanelSource.includes("createFinalResumeTtlScheduler")).toBe(true)
    expect(sidepanelSource.includes("FINAL_RESUME_TTL_FALLBACK_MS")).toBe(true)
    const start = sidepanelSource.indexOf("createFinalResumeTtlScheduler({")
    expect(start >= 0).toBe(true)
    if (start < 0) return
    const wiring = sidepanelSource.slice(start, start + 400)
    // The expiry must be read live, so a replacement checkpoint is honoured.
    expect(wiring.includes("getMetadata().expiresAt")).toBe(true)
  })
})

/**
 * Regression guard for the checkpoint-identity seeding defect.
 *
 * `finalResumeCheckpointIdentityRef` (expected) was never seeded, so the
 * comparison always reported `tab-changed` and the button never appeared. The
 * opposite mistake — overwriting expected on every identity change — would
 * disable the protection entirely. Both directions are pinned here.
 */
describe("checkpoint identity seeding wiring guards", () => {
  const sidepanelSource = readFileSync(join(import.meta.dir, "..", "index.tsx"), "utf8")

  it("no longer overwrites expected whenever the checkpoint is non-empty", () => {
    // The old defect write: expected was refreshed from the live identity.
    expect(sidepanelSource.includes("if (finalCheckpointLifecycle.controller.getMetadata().state !== \"empty\") {"))
      .toBe(false)
  })

  it("reconciles through the pure transition resolver", () => {
    expect(sidepanelSource.includes("resolveCheckpointIdentityTransition")).toBe(true)
    const start = sidepanelSource.indexOf("const reconcileCheckpointIdentity = (input:")
    expect(start >= 0).toBe(true)
    if (start < 0) return
    const body = sidepanelSource.slice(start, start + 1_200)
    // The decision must be the pure one, with both state and expected supplied.
    expect(body.includes("previousState: checkpointStateRef.current")).toBe(true)
    expect(body.includes("previousExpected: finalResumeCheckpointIdentityRef.current")).toBe(true)
    // And it must publish immediately rather than waiting for a TTL wake-up.
    expect(body.includes("finalResumeAvailability.refresh(")).toBe(true)
  })

  it("turns a checkpoint transition into a render", () => {
    // The controller has no subscription, so a version counter must exist and be
    // part of the identity effect's inputs; otherwise seeding never re-runs.
    expect(sidepanelSource.includes("checkpointStateVersion")).toBe(true)
    const start = sidepanelSource.indexOf("const [checkpointStateVersion")
    expect(start >= 0).toBe(true)
    const effectStart = sidepanelSource.indexOf("checkpointStateVersion,", start)
    expect(effectStart > start).toBe(true)
  })

  it("seeds from the task snapshot that actually bound the checkpoint", () => {
    const start = sidepanelSource.indexOf("const reconcileCheckpointIdentity = (input:")
    expect(start >= 0).toBe(true)
    if (start < 0) return
    const body = sidepanelSource.slice(start, start + 1_200)
    expect(body.includes("taskIdentity: input.taskIdentity ?? null")).toBe(true)
  })
})
