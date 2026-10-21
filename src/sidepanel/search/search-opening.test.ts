import { describe, expect, it } from "bun:test"

import type { VideoIdentity } from "@/features/platform/types"
import {
  createSearchOpener,
  resolveSearchOpening,
  type SearchOpenerEffects,
  type SearchTimestampNavigationOutcome,
} from "@/sidepanel/search/search-opening"
import type { SearchResult } from "@/sidepanel/search/search-controller"

function identity(overrides: Partial<VideoIdentity> = {}): VideoIdentity {
  return {
    platform: "youtube",
    videoId: "video-a",
    contentKey: "youtube:video-a",
    ...overrides,
  }
}

function buildResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "historical-analysis:run-1",
    kind: "historical-analysis",
    title: "Alpha video",
    subtitle: "youtube · video-a",
    snippet: "deployment",
    updatedAt: "2026-01-01T00:00:00.000Z",
    identity: identity(),
    contentKey: "youtube:video-a",
    platform: "youtube",
    videoId: "video-a",
    partId: null,
    analysisRunId: "run-1",
    transcriptFingerprint: null,
    knowledgeItemId: null,
    threadId: null,
    timestampSeconds: null,
    targetSurface: null,
    ...overrides,
  }
}

type HarnessOverrides = {
  currentContentKey?: string | null
  displayed?: { contentKey: string; analysisRunId: string | null } | null
  fingerprint?: string | null
  /** Forces the restore to land on a different identity than requested. */
  restoreTo?: { contentKey?: string; analysisRunId?: string }
  jump?: (
    target: VideoIdentity,
    timestampSeconds: number,
  ) => Promise<SearchTimestampNavigationOutcome>
  openThreadKind?: "ready" | "stale" | "mismatch"
}

function createHarness(overrides: HarnessOverrides = {}) {
  const calls = {
    restore: [] as Array<{ videoId: string; contentKey: string; analysisRunId: string }>,
    openThread: [] as Array<{ transcriptFingerprint: string | null; contentKey: string; analysisRunId: string }>,
    publish: [] as Array<{ threadId: string; contentKey: string; analysisRunId: string }>,
    jump: [] as Array<{ identity: VideoIdentity; timestampSeconds: number }>,
    surfaces: [] as Array<{ surface: string; timestampSeconds: number | null }>,
  }

  let displayed = overrides.displayed ?? null
  let currentContentKey = overrides.currentContentKey ?? "youtube:video-a"
  const fingerprint = overrides.fingerprint ?? "fp-a"

  const effects: SearchOpenerEffects = {
    readCurrentContentKey: () => currentContentKey,
    readDisplayedAnalysis: () => displayed,
    readCurrentTranscriptFingerprint: () => fingerprint,
    resolveRestoredTranscriptFingerprint: async () => fingerprint,
    restoreAnalysis: async (input) => {
      calls.restore.push(input)
      displayed = {
        contentKey: overrides.restoreTo?.contentKey ?? input.contentKey,
        analysisRunId: overrides.restoreTo?.analysisRunId ?? input.analysisRunId,
      }
    },
    openThread: async (input) => {
      calls.openThread.push({
        transcriptFingerprint: input.transcriptFingerprint,
        contentKey: input.contentKey,
        analysisRunId: input.analysisRunId,
      })

      if (overrides.openThreadKind === "stale") return { kind: "stale" }
      if (overrides.openThreadKind === "mismatch") {
        return { kind: "mismatch", reason: "missing-thread" }
      }

      return {
        kind: "ready",
        thread: { threadId: input.threadId, messages: [], answer: null },
      }
    },
    publishThread: (input) => {
      calls.publish.push({
        threadId: input.threadId,
        contentKey: input.contentKey,
        analysisRunId: input.analysisRunId,
      })
    },
    jump: async (target, timestampSeconds) => {
      calls.jump.push({ identity: target, timestampSeconds })

      if (overrides.jump) return overrides.jump(target, timestampSeconds)

      return { kind: "opened-new-tab" }
    },
    showSurface: (surface, timestampSeconds) => {
      calls.surfaces.push({ surface, timestampSeconds })
    },
  }

  return {
    calls,
    opener: createSearchOpener(effects),
    setCurrentContentKey: (next: string | null) => {
      currentContentKey = next
    },
  }
}

describe("search opening decision", () => {
  it("routes a current runtime analysis hit to Overview", () => {
    expect(resolveSearchOpening(buildResult({
      kind: "current-runtime-content",
      targetSurface: "overview",
    }))).toEqual({ kind: "current", surface: "overview", timestampSeconds: null })
  })

  it("routes a current runtime transcript hit to Transcript at the cue", () => {
    expect(resolveSearchOpening(buildResult({
      kind: "current-runtime-content",
      targetSurface: "transcript",
      timestampSeconds: 42,
    }))).toEqual({ kind: "current", surface: "transcript", timestampSeconds: 42 })
  })

  it("treats a transcript hit without a cue timestamp as Overview", () => {
    expect(resolveSearchOpening(buildResult({
      kind: "current-runtime-content",
      targetSurface: "transcript",
      timestampSeconds: null,
    }))).toEqual({ kind: "current", surface: "overview", timestampSeconds: null })
  })

  it("classifies knowledge, QA and historical rows", () => {
    expect(resolveSearchOpening(buildResult({ kind: "knowledge", timestampSeconds: 12 })))
      .toEqual({ kind: "knowledge", timestampSeconds: 12 })
    expect(resolveSearchOpening(buildResult({ kind: "qa-thread" }))).toEqual({ kind: "qa" })
    expect(resolveSearchOpening(buildResult({ kind: "historical-analysis" })))
      .toEqual({ kind: "historical" })
  })
})

describe("current runtime result opening", () => {
  it("never invokes the History restore path for current runtime content", async () => {
    const harness = createHarness()

    const outcome = await harness.opener.open(buildResult({
      kind: "current-runtime-content",
      targetSurface: "overview",
      analysisRunId: "run-1",
    }))

    expect(outcome).toEqual({ kind: "opened", surface: "overview" })
    expect(harness.calls.restore).toEqual([])
    expect(harness.calls.surfaces).toEqual([{ surface: "overview", timestampSeconds: null }])
  })

  it("reveals the matching transcript cue instead of restoring history", async () => {
    const harness = createHarness()

    const outcome = await harness.opener.open(buildResult({
      kind: "current-runtime-content",
      targetSurface: "transcript",
      timestampSeconds: 42,
    }))

    expect(outcome).toEqual({ kind: "opened", surface: "transcript" })
    expect(harness.calls.restore).toEqual([])
    expect(harness.calls.surfaces).toEqual([{ surface: "transcript", timestampSeconds: 42 }])
  })

  it("waits for the exact published content key when the video has to change", async () => {
    const harness = createHarness({ currentContentKey: "youtube:video-a" })
    const result = buildResult({
      kind: "current-runtime-content",
      targetSurface: "overview",
      contentKey: "youtube:video-b",
      identity: identity({ videoId: "video-b", contentKey: "youtube:video-b" }),
    })

    const outcome = await harness.opener.open(result)

    expect(outcome).toEqual({ kind: "pending", contentKey: "youtube:video-b" })
    expect(harness.calls.jump).toHaveLength(1)
    expect(harness.calls.surfaces).toEqual([])

    // An unrelated runtime publication must not resume the queued request.
    await harness.opener.notifyRuntimeContent("youtube:video-c")
    expect(harness.opener.pendingContentKey()).toBe("youtube:video-b")
    expect(harness.calls.surfaces).toEqual([])

    harness.setCurrentContentKey("youtube:video-b")
    await harness.opener.notifyRuntimeContent("youtube:video-b")

    expect(harness.opener.pendingContentKey()).toBeNull()
    expect(harness.calls.surfaces).toEqual([{ surface: "overview", timestampSeconds: null }])
  })
})

describe("historical result opening", () => {
  it("restores the exact saved analysis run", async () => {
    const harness = createHarness({ currentContentKey: "youtube:video-b" })

    const outcome = await harness.opener.open(buildResult({
      kind: "historical-analysis",
      contentKey: "youtube:video-a",
      analysisRunId: "run-7",
    }))

    expect(outcome).toEqual({ kind: "opened", surface: "overview" })
    expect(harness.calls.restore).toEqual([{
      videoId: "video-a",
      contentKey: "youtube:video-a",
      analysisRunId: "run-7",
    }])
    expect(harness.calls.jump).toEqual([])
  })

  it("rejects a historical row that carries no run identity", async () => {
    const harness = createHarness()

    const outcome = await harness.opener.open(buildResult({
      kind: "historical-analysis",
      analysisRunId: null,
    }))

    expect(outcome).toEqual({ kind: "rejected", reason: "missing-analysis-run" })
    expect(harness.calls.restore).toEqual([])
  })
})

describe("QA thread opening", () => {
  it("publishes a thread only after the exact identity triple is restored", async () => {
    const harness = createHarness()

    const outcome = await harness.opener.open(buildResult({
      kind: "qa-thread",
      threadId: "thread-1",
      analysisRunId: "run-1",
      transcriptFingerprint: "fp-a",
    }))

    expect(outcome).toEqual({ kind: "opened", surface: "ask" })
    expect(harness.calls.restore).toEqual([{
      videoId: "video-a",
      contentKey: "youtube:video-a",
      analysisRunId: "run-1",
    }])
    expect(harness.calls.openThread).toEqual([{
      transcriptFingerprint: "fp-a",
      contentKey: "youtube:video-a",
      analysisRunId: "run-1",
    }])
    expect(harness.calls.publish).toEqual([{
      threadId: "thread-1",
      contentKey: "youtube:video-a",
      analysisRunId: "run-1",
    }])
    expect(harness.calls.surfaces).toEqual([{ surface: "ask", timestampSeconds: null }])
  })

  it("rejects the thread when the restored run belongs to another analysis", async () => {
    const harness = createHarness({ restoreTo: { analysisRunId: "run-2" } })

    const outcome = await harness.opener.open(buildResult({
      kind: "qa-thread",
      threadId: "thread-1",
      analysisRunId: "run-1",
      transcriptFingerprint: "fp-a",
    }))

    expect(outcome).toEqual({ kind: "rejected", reason: "restored-run-mismatch" })
    expect(harness.calls.publish).toEqual([])
    expect(harness.calls.openThread).toEqual([])
  })

  it("rejects the thread when the restored content key differs", async () => {
    const harness = createHarness({ restoreTo: { contentKey: "youtube:video-other" } })

    const outcome = await harness.opener.open(buildResult({
      kind: "qa-thread",
      threadId: "thread-1",
      analysisRunId: "run-1",
      transcriptFingerprint: "fp-a",
    }))

    expect(outcome).toEqual({ kind: "rejected", reason: "restored-content-mismatch" })
    expect(harness.calls.publish).toEqual([])
    expect(harness.calls.openThread).toEqual([])
  })

  it("rejects a thread whose restored fingerprint moved", async () => {
    const harness = createHarness({ fingerprint: "fp-moved" })

    const outcome = await harness.opener.open(buildResult({
      kind: "qa-thread",
      threadId: "thread-1",
      analysisRunId: "run-1",
      transcriptFingerprint: "fp-a",
    }))

    expect(outcome).toEqual({ kind: "rejected", reason: "transcript-fingerprint-mismatch" })
    expect(harness.calls.publish).toEqual([])
    expect(harness.calls.openThread).toEqual([])
  })

  it("rejects a QA row that carries no run identity", async () => {
    const harness = createHarness()

    const outcome = await harness.opener.open(buildResult({
      kind: "qa-thread",
      threadId: "thread-1",
      analysisRunId: null,
    }))

    expect(outcome).toEqual({ kind: "rejected", reason: "missing-analysis-run" })
    expect(harness.calls.restore).toEqual([])
  })

  it("rejects a QA row that carries no thread identity", async () => {
    const harness = createHarness()

    const outcome = await harness.opener.open(buildResult({
      kind: "qa-thread",
      threadId: null,
      analysisRunId: "run-1",
    }))

    expect(outcome).toEqual({ kind: "rejected", reason: "missing-thread" })
    expect(harness.calls.restore).toEqual([])
  })
})

describe("Bilibili part isolation", () => {
  it("never opens the second part from a request for the first part", async () => {
    const harness = createHarness({ currentContentKey: "bilibili:BV-1:p:1" })

    const outcome = await harness.opener.open(buildResult({
      kind: "knowledge",
      contentKey: "bilibili:BV-1:p:2",
      platform: "bilibili",
      videoId: "BV-1",
      partId: "2",
      identity: identity({
        platform: "bilibili",
        videoId: "BV-1",
        partId: "2",
        contentKey: "bilibili:BV-1:p:2",
      }),
      timestampSeconds: 30,
    }))

    expect(outcome).toEqual({ kind: "pending", contentKey: "bilibili:BV-1:p:2" })
    expect(harness.calls.jump[0]?.identity.contentKey).toBe("bilibili:BV-1:p:2")
    expect(harness.calls.surfaces).toEqual([])

    // Re-publishing part 1 must not satisfy the part 2 request.
    harness.setCurrentContentKey("bilibili:BV-1:p:1")
    await harness.opener.notifyRuntimeContent("bilibili:BV-1:p:1")

    expect(harness.opener.pendingContentKey()).toBe("bilibili:BV-1:p:2")
    expect(harness.calls.surfaces).toEqual([])
  })
})

describe("cross-video pending intent", () => {
  it("clears the queue when navigation cannot reach the target", async () => {
    const harness = createHarness({
      currentContentKey: "youtube:video-a",
      jump: async () => ({ kind: "runtime-failure", error: "tab closed" }),
    })

    const outcome = await harness.opener.open(buildResult({
      kind: "knowledge",
      contentKey: "youtube:video-b",
      identity: identity({ videoId: "video-b", contentKey: "youtube:video-b" }),
    }))

    expect(outcome).toEqual({ kind: "rejected", reason: "runtime-failure" })
    expect(harness.opener.pendingContentKey()).toBeNull()
  })

  it("clears the queue when the runtime identity is missing", async () => {
    const harness = createHarness({
      currentContentKey: null,
      jump: async () => ({ kind: "missing-identity" }),
    })

    const outcome = await harness.opener.open(buildResult({
      kind: "knowledge",
      contentKey: "youtube:video-b",
    }))

    expect(outcome).toEqual({ kind: "rejected", reason: "missing-identity" })
    expect(harness.opener.pendingContentKey()).toBeNull()
  })

  it("lets a newer pending request survive an older navigation failure", async () => {
    let releaseOlder: ((outcome: SearchTimestampNavigationOutcome) => void) | null = null
    const harness = createHarness({
      currentContentKey: "youtube:video-a",
      jump: (target) => {
        if (target.contentKey === "youtube:video-b") {
          return new Promise((resolve) => {
            releaseOlder = resolve
          })
        }

        return Promise.resolve({ kind: "opened-new-tab" })
      },
    })

    const older = harness.opener.open(buildResult({
      kind: "knowledge",
      contentKey: "youtube:video-b",
      identity: identity({ videoId: "video-b", contentKey: "youtube:video-b" }),
    }))

    const newer = await harness.opener.open(buildResult({
      kind: "knowledge",
      contentKey: "youtube:video-c",
      identity: identity({ videoId: "video-c", contentKey: "youtube:video-c" }),
    }))

    expect(newer).toEqual({ kind: "pending", contentKey: "youtube:video-c" })

    releaseOlder?.({ kind: "runtime-failure", error: "stale tab" })
    expect(await older).toEqual({ kind: "rejected", reason: "runtime-failure" })

    // The older failure must not clear the newer request.
    expect(harness.opener.pendingContentKey()).toBe("youtube:video-c")

    harness.setCurrentContentKey("youtube:video-b")
    await harness.opener.notifyRuntimeContent("youtube:video-b")
    expect(harness.opener.pendingContentKey()).toBe("youtube:video-c")

    harness.setCurrentContentKey("youtube:video-c")
    await harness.opener.notifyRuntimeContent("youtube:video-c")

    expect(harness.opener.pendingContentKey()).toBeNull()
    expect(harness.calls.surfaces).toEqual([{ surface: "overview", timestampSeconds: null }])
  })
})
