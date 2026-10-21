import { describe, expect, it } from "bun:test"

import type { ActiveVideoContext, TranscriptSegment, VideoIdentity } from "@/features/platform/types"
import type {
  HistoryAnalysisSnapshot,
  HistoryRestoreSnapshot,
  HistoryTranscriptSnapshot,
} from "@/sidepanel/history/history-controller"
import { createSearchOpener } from "@/sidepanel/search/search-opening"
import type { SearchResult } from "@/sidepanel/search/search-controller"
import { commitRestoredDisplaySelection } from "@/sidepanel/workspace/restored-display-selection"
import { WorkspaceController } from "@/sidepanel/workspace/workspace-controller"
import type { WorkspaceHistoryPublicationEffects } from "@/sidepanel/workspace/workspace-controller"

function context(overrides: Partial<ActiveVideoContext> = {}): ActiveVideoContext {
  return {
    pageType: "video",
    platform: "youtube",
    videoId: "video-a",
    partId: null,
    contentKey: "youtube:video-a",
    url: "https://www.youtube.com/watch?v=video-a",
    canonicalUrl: "https://www.youtube.com/watch?v=video-a",
    title: "Video A",
    author: "Author A",
    timestampSeconds: 0,
    isReady: true,
    ...overrides,
  }
}

function identity(overrides: Partial<VideoIdentity> = {}): VideoIdentity {
  return {
    platform: "youtube",
    videoId: "video-a",
    contentKey: "youtube:video-a",
    ...overrides,
  }
}

const CUES: TranscriptSegment[] = [
  { startSec: 0, endSec: 12, text: "intro" },
]

function transcriptSnapshot(fingerprint = "fp-a"): HistoryTranscriptSnapshot {
  return {
    exists: true,
    cues: CUES,
    identity: identity(),
    title: "Video A",
    fingerprint,
    rawVtt: "WEBVTT\n",
  }
}

function analysisSnapshot(analysisRunId: string): HistoryAnalysisSnapshot {
  return {
    platform: "youtube",
    videoId: "video-a",
    partId: null,
    contentKey: "youtube:video-a",
    title: "Video A",
    analysis: {
      summary: `Summary ${analysisRunId}`,
      keyPoints: [{ text: "point" }],
      chapters: [{
        title: "Chapter",
        startSec: 0,
        endSec: 12,
        summary: "Chapter summary",
        detail: "Chapter detail",
      }],
    },
    analysisRunId,
    transcriptFingerprint: "fp-a",
    providerProfileId: "profile-1",
    providerBaseUrl: "https://provider.example",
    providerModel: "model-1",
    analysisSchemaVersion: 1,
    analysisPromptVersion: "video-analysis-v2",
    lastAnalyzedAt: "2026-01-01T00:00:00.000Z",
    errorMessage: null,
  }
}

function restoreSnapshot(analysisRunId: string): HistoryRestoreSnapshot {
  return {
    sourceIdentity: identity(),
    transcript: transcriptSnapshot(),
    analysis: analysisSnapshot(analysisRunId),
  }
}

function publicationEffects(
  overrides: Partial<WorkspaceHistoryPublicationEffects> = {},
): WorkspaceHistoryPublicationEffects {
  return {
    publishTranscript: () => {},
    clearTranscriptError: () => {},
    clearAnalysis: () => {},
    setAnalysisIdle: () => {},
    publishAnalysis: () => {},
    setAnalysisCompleted: () => {},
    clearAskWorkspace: () => {},
    restoreQaConversation: async () => {},
    ...overrides,
  }
}

function commitEffects(controller: WorkspaceController) {
  return {
    isLoadGenerationCurrent: (generation: number) => controller.isLoadGenerationCurrent(generation),
    readSelectedQaThreadId: () => controller.getDisplaySelection().qaThreadId,
    syncDisplaySelection: (selection: Parameters<WorkspaceController["syncDisplaySelection"]>[0]) => {
      controller.syncDisplaySelection(selection)
    },
  }
}

function createDeferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve()
  }
}

function qaResult(threadId: string, analysisRunId: string): SearchResult {
  return {
    id: `qa-thread:${threadId}`,
    kind: "qa-thread",
    title: "Question",
    subtitle: "youtube · video-a",
    snippet: "answer",
    updatedAt: "2026-01-01T00:00:00.000Z",
    identity: identity(),
    contentKey: "youtube:video-a",
    platform: "youtube",
    videoId: "video-a",
    partId: null,
    analysisRunId,
    transcriptFingerprint: "fp-a",
    knowledgeItemId: null,
    threadId,
    timestampSeconds: null,
    targetSurface: null,
  }
}

function observe(controller: WorkspaceController, contentKey = "youtube:video-a"): void {
  const videoId = contentKey.split(":").pop() as string
  controller.observeRuntimeContent({
    videoContext: context({ videoId, contentKey }),
    activeTabId: 1,
  })
}

describe("commitRestoredDisplaySelection", () => {
  it("records the restored analysis identity and preserves the selected QA thread", () => {
    const controller = new WorkspaceController()
    observe(controller)
    controller.setSelectedQaThreadId("thread-existing")
    const generation = controller.beginLoadGeneration()

    const committed = commitRestoredDisplaySelection({
      generation,
      restored: {
        contentKey: "youtube:video-a",
        analysisRunId: "run-2",
        transcriptFingerprint: "fp-a",
      },
      effects: commitEffects(controller),
    })

    expect(committed).toEqual({
      contentKey: "youtube:video-a",
      analysisRunId: "run-2",
      transcriptFingerprint: "fp-a",
    })
    expect(controller.getDisplaySelection()).toEqual({
      analysis: { contentKey: "youtube:video-a", analysisRunId: "run-2" },
      qaThreadId: "thread-existing",
    })
  })

  it("never commits once the captured load generation is stale", () => {
    const controller = new WorkspaceController()
    observe(controller)
    const generation = controller.beginLoadGeneration()

    controller.beginLoadGeneration()

    const committed = commitRestoredDisplaySelection({
      generation,
      restored: {
        contentKey: "youtube:video-a",
        analysisRunId: "run-1",
        transcriptFingerprint: "fp-a",
      },
      effects: commitEffects(controller),
    })

    expect(committed).toBeNull()
    expect(controller.getDisplaySelection().analysis).toBeNull()
  })

  it("reports no success when the restore published no analysis", () => {
    const controller = new WorkspaceController()
    observe(controller)
    const generation = controller.beginLoadGeneration()

    const committed = commitRestoredDisplaySelection({
      generation,
      restored: null,
      effects: commitEffects(controller),
    })

    expect(committed).toBeNull()
    expect(controller.getDisplaySelection().analysis).toBeNull()
  })

  it("never mutates runtime content while committing a historical restore", () => {
    const controller = new WorkspaceController()
    observe(controller, "youtube:video-b")
    const before = controller.getSnapshot().runtimeContent
    const generation = controller.beginLoadGeneration()

    commitRestoredDisplaySelection({
      generation,
      restored: {
        contentKey: "youtube:video-a",
        analysisRunId: "run-1",
        transcriptFingerprint: "fp-a",
      },
      effects: commitEffects(controller),
    })

    expect(controller.getSnapshot().runtimeContent).toEqual(before)
    expect(controller.getSnapshot().runtimeContent.contentKey).toBe("youtube:video-b")
  })
})

describe("stale restore publication race", () => {
  it("never lets an older restore overwrite a newer displayed analysis", async () => {
    const controller = new WorkspaceController()
    observe(controller)
    const gate = createDeferred()

    const generationA = controller.beginLoadGeneration()
    const publishingA = controller.publishHistoryRestore({
      mode: "saved-run",
      snapshot: restoreSnapshot("run-1"),
      workspaceEpoch: controller.captureEpoch(),
      isRequestCurrent: () => controller.isLoadGenerationCurrent(generationA),
      effects: publicationEffects({
        restoreQaConversation: () => gate.promise,
      }),
    })

    await flushMicrotasks()

    const generationB = controller.beginLoadGeneration()
    const publishedB = await controller.publishHistoryRestore({
      mode: "saved-run",
      snapshot: restoreSnapshot("run-2"),
      workspaceEpoch: controller.captureEpoch(),
      isRequestCurrent: () => controller.isLoadGenerationCurrent(generationB),
      effects: publicationEffects(),
    })

    const committedB = commitRestoredDisplaySelection({
      generation: generationB,
      restored: publishedB.kind === "published" ? publishedB.restored : null,
      effects: commitEffects(controller),
    })

    expect(committedB?.analysisRunId).toBe("run-2")

    // A finishes after B already committed. The publication boundary allows
    // that on purpose, so the root restore handler must reject it.
    gate.resolve()
    const publishedA = await publishingA
    const committedA = commitRestoredDisplaySelection({
      generation: generationA,
      restored: publishedA.kind === "published" ? publishedA.restored : null,
      effects: commitEffects(controller),
    })

    expect(committedA).toBeNull()
    expect(controller.getDisplaySelection().analysis).toEqual({
      contentKey: "youtube:video-a",
      analysisRunId: "run-2",
    })
  })

  it("lets the newer Search opening publish while the stale one publishes nothing", async () => {
    const controller = new WorkspaceController()
    observe(controller)
    const gate = createDeferred()
    const publishedThreads: string[] = []

    const restoreFor = async (input: {
      videoId: string
      contentKey: string
      analysisRunId: string
    }) => {
      const generation = controller.beginLoadGeneration()
      const published = await controller.publishHistoryRestore({
        mode: "saved-run",
        snapshot: restoreSnapshot(input.analysisRunId),
        workspaceEpoch: controller.captureEpoch(),
        isRequestCurrent: () => controller.isLoadGenerationCurrent(generation),
        effects: publicationEffects({
          restoreQaConversation: input.analysisRunId === "run-1"
            ? () => gate.promise
            : async () => {},
        }),
      })

      return commitRestoredDisplaySelection({
        generation,
        restored: published.kind === "published" ? published.restored : null,
        effects: commitEffects(controller),
      })
    }

    const opener = createSearchOpener({
      readCurrentContentKey: () => "youtube:video-a",
      readDisplayedAnalysis: () => controller.getDisplaySelection().analysis,
      readCurrentTranscriptFingerprint: () => "fp-a",
      restoreAnalysis: restoreFor,
      openThread: async (input) => ({
        kind: "ready",
        thread: { threadId: input.threadId, messages: [], answer: null },
      }),
      publishThread: (input) => {
        publishedThreads.push(input.threadId)
      },
      jump: async () => ({ kind: "jumped-active" }),
      showSurface: () => {},
    })

    const openingA = opener.open(qaResult("thread-a", "run-1"))
    await flushMicrotasks()

    const openingB = await opener.open(qaResult("thread-b", "run-2"))
    expect(openingB).toEqual({ kind: "opened", surface: "ask" })
    expect(publishedThreads).toEqual(["thread-b"])

    gate.resolve()
    expect(await openingA).toEqual({ kind: "rejected", reason: "superseded" })

    expect(publishedThreads).toEqual(["thread-b"])
    expect(controller.getDisplaySelection().analysis).toEqual({
      contentKey: "youtube:video-a",
      analysisRunId: "run-2",
    })
  })
})
