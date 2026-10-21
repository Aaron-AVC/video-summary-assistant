import { describe, expect, it } from "bun:test"

import type { ActiveVideoContext, TranscriptSegment, VideoIdentity } from "@/features/platform/types"
import type { AnalysisExecutionPublication } from "@/sidepanel/analysis/analysis-controller"
import type {
  HistoryAnalysisSnapshot,
  HistoryRestoreSnapshot,
  HistoryTranscriptSnapshot,
} from "@/sidepanel/history/history-controller"
import { createSearchOpener } from "@/sidepanel/search/search-opening"
import type { SearchResult } from "@/sidepanel/search/search-controller"
import { publishCompletedAnalysis } from "@/sidepanel/workspace/analysis-publication"
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

function publicationFor(analysisRunId: string): AnalysisExecutionPublication {
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
  }
}

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
    analysis: publicationFor(analysisRunId).analysis,
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
    readDisplayedAnalysis: () => controller.getDisplaySelection().analysis,
    readDisplayGeneration: () => controller.getDisplayGeneration(),
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

function observe(controller: WorkspaceController): void {
  controller.observeRuntimeContent({ videoContext: context(), activeTabId: 1 })
}

/**
 * Drives the production publication contract shared by the cached and the
 * fresh completion paths: `WorkspaceController.publishAnalysisResult` with the
 * exact effects the side panel wires in `handleAnalyze`.
 */
async function publishProductionAnalysis(
  controller: WorkspaceController,
  publication: AnalysisExecutionPublication,
): Promise<(AnalysisExecutionPublication & { errorMessage: null })[]> {
  const published: (AnalysisExecutionPublication & { errorMessage: null })[] = []
  await controller.publishAnalysisResult({
    workspaceEpoch: controller.captureEpoch(),
    taskContentKey: publication.contentKey,
    currentContentKey: publication.contentKey,
    effects: {
      publishAnalysis: () => {
        publishCompletedAnalysis(publication, {
          publishAnalysisView: (view) => {
            published.push(view)
          },
          readSelectedQaThreadId: () => controller.getDisplaySelection().qaThreadId,
          syncDisplaySelection: (selection) => {
            controller.syncDisplaySelection(selection)
          },
        })
      },
      setAnalysisCompleted: () => {},
      restoreQaConversation: async () => {},
    },
  })

  return published
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

describe("publishCompletedAnalysis", () => {
  it("records display ownership in the same synchronous segment as the publication", async () => {
    const controller = new WorkspaceController()
    observe(controller)
    controller.setSelectedQaThreadId("thread-existing")
    const generationBefore = controller.getDisplayGeneration()

    const published = await publishProductionAnalysis(controller, publicationFor("run-2"))

    expect(published).toHaveLength(1)
    expect(published[0]?.errorMessage).toBeNull()
    expect(controller.getDisplayGeneration()).toBe(generationBefore + 1)
    expect(controller.getDisplaySelection()).toEqual({
      analysis: { contentKey: "youtube:video-a", analysisRunId: "run-2" },
      qaThreadId: "thread-existing",
    })
  })

  it("updates display ownership for a fresh analysis result as well", async () => {
    const controller = new WorkspaceController()
    observe(controller)
    const generationBefore = controller.getDisplayGeneration()

    const published = await publishProductionAnalysis(controller, publicationFor("run-3"))

    expect(published).toHaveLength(1)
    expect(controller.getDisplayGeneration()).toBe(generationBefore + 1)
    expect(controller.getDisplaySelection().analysis).toEqual({
      contentKey: "youtube:video-a",
      analysisRunId: "run-3",
    })
  })

  it("keeps the displayed analysis untouched when the workspace epoch is stale", async () => {
    const controller = new WorkspaceController()
    observe(controller)
    const staleEpoch = controller.captureEpoch()
    const displayGenerationBefore = controller.getDisplayGeneration()

    // The workspace moves to another video, which advances the epoch.
    controller.observeRuntimeContent({
      videoContext: context({
        videoId: "video-b",
        contentKey: "youtube:video-b",
        title: "Video B",
      }),
      activeTabId: 1,
    })

    let publishedCount = 0
    await controller.publishAnalysisResult({
      workspaceEpoch: staleEpoch,
      taskContentKey: "youtube:video-a",
      currentContentKey: "youtube:video-b",
      effects: {
        publishAnalysis: () => {
          publishedCount += 1
        },
        setAnalysisCompleted: () => {},
        restoreQaConversation: async () => {},
      },
    })

    expect(publishedCount).toBe(0)
    expect(controller.getDisplayGeneration()).toBe(displayGenerationBefore)
    expect(controller.getDisplaySelection().analysis).toBeNull()
  })
})

describe("history restore versus production analysis publication", () => {
  it("never lets a history restore overwrite a fresh analysis publication", async () => {
    const controller = new WorkspaceController()
    observe(controller)
    const gate = createDeferred()

    const generation = controller.beginLoadGeneration()
    const displayGeneration = controller.getDisplayGeneration()
    const publishing = controller.publishHistoryRestore({
      mode: "saved-run",
      snapshot: restoreSnapshot("run-1"),
      workspaceEpoch: controller.captureEpoch(),
      isRequestCurrent: () => controller.isLoadGenerationCurrent(generation),
      effects: publicationEffects({
        restoreQaConversation: () => gate.promise,
      }),
    })

    await flushMicrotasks()

    // A fresh analysis result publishes run-2 without beginLoadGeneration().
    await publishProductionAnalysis(controller, publicationFor("run-2"))

    expect(controller.getDisplayGeneration()).toBe(displayGeneration + 1)
    expect(controller.isLoadGenerationCurrent(generation)).toBe(true)

    gate.resolve()
    const published = await publishing
    const committed = commitRestoredDisplaySelection({
      generation,
      displayGeneration,
      restored: published.kind === "published" ? published.restored : null,
      effects: commitEffects(controller),
    })

    expect(committed).toBeNull()
    expect(controller.getDisplaySelection().analysis).toEqual({
      contentKey: "youtube:video-a",
      analysisRunId: "run-2",
    })
  })

  it("never lets a history restore overwrite a cached analysis publication", async () => {
    const controller = new WorkspaceController()
    observe(controller)
    const gate = createDeferred()

    const generation = controller.beginLoadGeneration()
    const displayGeneration = controller.getDisplayGeneration()
    const publishing = controller.publishHistoryRestore({
      mode: "saved-run",
      snapshot: restoreSnapshot("run-1"),
      workspaceEpoch: controller.captureEpoch(),
      isRequestCurrent: () => controller.isLoadGenerationCurrent(generation),
      effects: publicationEffects({
        restoreQaConversation: () => gate.promise,
      }),
    })

    await flushMicrotasks()

    await publishProductionAnalysis(controller, publicationFor("run-4"))

    expect(controller.getDisplayGeneration()).toBe(displayGeneration + 1)

    gate.resolve()
    const published = await publishing
    const committed = commitRestoredDisplaySelection({
      generation,
      displayGeneration,
      restored: published.kind === "published" ? published.restored : null,
      effects: commitEffects(controller),
    })

    expect(committed).toBeNull()
    expect(controller.getDisplaySelection().analysis).toEqual({
      contentKey: "youtube:video-a",
      analysisRunId: "run-4",
    })
  })

  it("never publishes a stale QA thread when a fresh analysis publication wins", async () => {
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
      const displayGeneration = controller.getDisplayGeneration()
      const published = await controller.publishHistoryRestore({
        mode: "saved-run",
        snapshot: restoreSnapshot(input.analysisRunId),
        workspaceEpoch: controller.captureEpoch(),
        isRequestCurrent: () => controller.isLoadGenerationCurrent(generation),
        effects: publicationEffects({
          restoreQaConversation: () => gate.promise,
        }),
      })

      return commitRestoredDisplaySelection({
        generation,
        displayGeneration,
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

    await publishProductionAnalysis(controller, publicationFor("run-2"))
    gate.resolve()

    expect(await openingA).toEqual({ kind: "rejected", reason: "restored-analysis-unavailable" })
    expect(publishedThreads).toEqual([])
    expect(controller.getDisplaySelection().analysis).toEqual({
      contentKey: "youtube:video-a",
      analysisRunId: "run-2",
    })
  })
})
