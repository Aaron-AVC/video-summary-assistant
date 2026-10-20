import { describe, expect, it } from "bun:test"

import type { AnalysisRunEntity, SegmentSummaryEntity, TranscriptSnapshotEntity, VideoRecordEntity } from "@/lib/schemas/persistence"
import { computeTranscriptFingerprint } from "@/lib/persistence/cache-identity"
import { resolveAskTranscriptFingerprint } from "@/sidepanel/lib/ask-transcript-identity"
import {
  createHistoryController,
  type HistoryControllerDependencies,
  type HistoryRecentEntry,
} from "@/sidepanel/history/history-controller"

const now = "2026-10-20T10:00:00.000Z"
const cues = [{ startSec: 0, endSec: 2, text: "History cue" }]

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function analysisRun(overrides: Partial<AnalysisRunEntity> = {}): AnalysisRunEntity {
  return {
    id: "run-1",
    videoId: "video-1",
    platform: "youtube",
    contentKey: "youtube:video-1",
    partId: null,
    transcriptSnapshotId: "snapshot-1",
    providerConfigId: "provider-1",
    transcriptFingerprint: "persisted-fingerprint",
    analysisSchemaVersion: 1,
    analysisPromptVersion: "video-analysis-v2",
    analysisCacheKey: "cache-1",
    providerProfileId: "provider-1",
    providerBaseUrl: "https://api.example.com/v1",
    providerModel: "model-1",
    status: "completed",
    summary: "History summary",
    keyPoints: [{ text: "Key point" }],
    topics: [],
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    ...overrides,
  }
}

function segment(runId = "run-1"): SegmentSummaryEntity {
  return {
    id: `segment-${runId}`,
    analysisRunId: runId,
    videoId: "video-1",
    contentKey: "youtube:video-1",
    title: "Chapter",
    summary: "Chapter summary",
    detail: "Chapter detail",
    startSec: 0,
    endSec: 2,
    createdAt: now,
    updatedAt: now,
  }
}

function transcript(overrides: Partial<TranscriptSnapshotEntity> = {}): TranscriptSnapshotEntity {
  return {
    id: "snapshot-1",
    videoId: "video-1",
    platform: "youtube",
    contentKey: "youtube:video-1",
    partId: null,
    fingerprint: "stale-fingerprint",
    language: "en",
    sourceUrl: null,
    rawVtt: "WEBVTT",
    cues,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function recentEntry(overrides: Partial<HistoryRecentEntry> = {}): HistoryRecentEntry {
  return {
    recentVideo: {
      videoId: "video-1",
      analysisRunId: "run-1",
      contentKey: "youtube:video-1",
      platform: "youtube",
      partId: null,
      title: "History title",
      channelTitle: "Channel",
      status: "completed",
      updatedAt: now,
    },
    analysis: { summary: "exists" },
    ...overrides,
  }
}

function createDependencies(overrides: Partial<HistoryControllerDependencies> = {}): HistoryControllerDependencies {
  return {
    listRecentAnalyses: async () => [],
    getCurrentAnalysisByVideoId: async () => null,
    getLatestTranscriptSnapshotByVideoId: async () => null,
    getCurrentAnalysisByContentKey: async () => null,
    getLatestTranscriptByContentKey: async () => null,
    getSavedAnalysisRunById: async () => null,
    deleteAnalysisRun: async () => {},
    deleteVideoData: async () => {},
    performDestructiveOperation: async (_action, _target, mutate) => mutate(),
    ...overrides,
  }
}

describe("HistoryController", () => {
  it("limits and maps recent history while filtering entries without analysis", async () => {
    let requestedLimit = 0
    const controller = createHistoryController(createDependencies({
      listRecentAnalyses: async (limit) => {
        requestedLimit = limit
        return [recentEntry(), recentEntry({ analysis: null })]
      },
    }))

    await expect(controller.listRecentAnalyses(10)).resolves.toEqual([{
      videoId: "video-1",
      analysisRunId: "run-1",
      contentKey: "youtube:video-1",
      platform: "youtube",
      partId: null,
      title: "History title",
      channelTitle: "Channel",
      status: "completed",
      updatedAt: now,
    }])
    expect(requestedLimit).toBe(10)
  })

  it("reads legacy analysis, transcript, and recent title concurrently with video fallback", async () => {
    const calls: string[] = []
    const pendingAnalysis = deferred<AnalysisRunEntity & { segments: SegmentSummaryEntity[] }>()
    const pendingTranscript = deferred<TranscriptSnapshotEntity>()
    const pendingRecent = deferred<HistoryRecentEntry[]>()
    const controller = createHistoryController(createDependencies({
      getCurrentAnalysisByVideoId: async () => { calls.push("analysis"); return pendingAnalysis.promise },
      getLatestTranscriptSnapshotByVideoId: async () => { calls.push("transcript"); return pendingTranscript.promise },
      listRecentAnalyses: async (limit) => {
        calls.push(`recent:${limit}`)
        return pendingRecent.promise
      },
    }))

    const restore = controller.loadLegacyVideoRestore({ videoId: "video-1", isCurrent: () => true })
    await Promise.resolve()
    expect(calls.sort()).toEqual(["analysis", "recent:25", "transcript"])
    pendingAnalysis.resolve({ ...analysisRun(), segments: [segment()] })
    pendingTranscript.resolve(transcript())
    pendingRecent.resolve([recentEntry({ recentVideo: { ...recentEntry().recentVideo, videoId: "other", title: "Other" } })])
    const result = await restore

    expect(result).toMatchObject({ kind: "ready", snapshot: {
      sourceIdentity: { platform: "youtube", videoId: "video-1", contentKey: "youtube:video-1" },
      transcript: { exists: true, title: "video-1" },
      analysis: { title: "video-1", contentKey: "youtube:video-1", analysisRunId: "run-1" },
    } })
  })

  it("keeps a legacy transcript restore when its analysis is absent", async () => {
    const controller = createHistoryController(createDependencies({
      getLatestTranscriptSnapshotByVideoId: async () => transcript(),
      listRecentAnalyses: async () => [],
    }))

    const result = await controller.loadLegacyVideoRestore({ videoId: "video-1", isCurrent: () => true })

    expect(result).toMatchObject({ kind: "ready", snapshot: {
      transcript: { exists: true, cues },
      analysis: null,
    } })
  })

  it("clears legacy execution metadata even when the persisted row contains it", async () => {
    const controller = createHistoryController(createDependencies({
      getCurrentAnalysisByVideoId: async () => ({
        ...analysisRun({
          providerProfileId: "provider-old",
          providerBaseUrl: "https://example.com/v1",
          providerModel: "old-model",
          analysisSchemaVersion: 7,
          analysisPromptVersion: "old-prompt",
        }),
        segments: [segment()],
      }),
    }))

    const result = await controller.loadLegacyVideoRestore({ videoId: "video-1", isCurrent: () => true })

    expect(result).toMatchObject({ kind: "ready", snapshot: {
      analysis: {
        providerProfileId: null,
        providerBaseUrl: null,
        providerModel: null,
        analysisSchemaVersion: null,
        analysisPromptVersion: null,
      },
    } })
  })

  it("applies current context platform, contentKey, partId, and title fallbacks", async () => {
    const controller = createHistoryController(createDependencies({
      getLatestTranscriptByContentKey: async () => transcript({
        platform: undefined,
        contentKey: undefined,
        partId: null,
      }),
    }))

    const result = await controller.loadCurrentContextRestore({
      context: {
        platform: "bilibili",
        videoId: "BV1",
        partId: "2",
        contentKey: "bilibili:BV1:p:2",
        title: null,
      },
      isCurrent: () => true,
    })

    expect(result).toMatchObject({ kind: "ready", snapshot: {
      sourceIdentity: { platform: "bilibili", videoId: "BV1", partId: "2", contentKey: "bilibili:BV1:p:2" },
      transcript: {
        title: "BV1",
        identity: { platform: "bilibili", videoId: "video-1", partId: "2", contentKey: "bilibili:BV1:p:2" },
      },
    } })
  })

  it("returns a stale result before fingerprint preparation when currentness changes after reads", async () => {
    let current = true
    const controller = createHistoryController(createDependencies({
      getLatestTranscriptByContentKey: async () => transcript(),
    }))

    const result = await controller.loadCurrentContextRestore({
      context: {
        platform: "youtube",
        videoId: "video-1",
        partId: null,
        contentKey: "youtube:video-1",
        title: "Video",
      },
      isCurrent: () => {
        const value = current
        current = false
        return value
      },
    })

    expect(result).toEqual({ kind: "stale" })
  })

  it("preserves exact-run metadata and run-bound transcript identity fallbacks", async () => {
    const aggregate = {
      analysisRun: analysisRun({
        platform: "bilibili",
        videoId: "BV1",
        contentKey: "bilibili:BV1:p:2",
        partId: "2",
      }),
      segments: [segment()],
      transcript: transcript({
        videoId: "BV1",
        platform: undefined,
        contentKey: undefined,
        partId: null,
      }),
      videoRecord: null,
    }
    const controller = createHistoryController(createDependencies({
      getSavedAnalysisRunById: async () => aggregate,
    }))

    const result = await controller.loadSavedRunRestore({ analysisRunId: "run-1", isCurrent: () => true })

    expect(result).toMatchObject({ kind: "ready", snapshot: {
      sourceIdentity: { platform: "bilibili", videoId: "BV1", partId: "2", contentKey: "bilibili:BV1:p:2" },
      transcript: { identity: { platform: "bilibili", videoId: "BV1", partId: "2", contentKey: "bilibili:BV1:p:2" } },
      analysis: {
        platform: "bilibili",
        videoId: "BV1",
        partId: "2",
        contentKey: "bilibili:BV1:p:2",
        analysisRunId: "run-1",
        providerProfileId: "provider-1",
        providerBaseUrl: "https://api.example.com/v1",
        providerModel: "model-1",
        analysisSchemaVersion: 1,
        analysisPromptVersion: "video-analysis-v2",
      },
    } })
  })

  it("prefers persisted video record metadata for an exact run", async () => {
    const videoRecord: VideoRecordEntity = {
      contentKey: "youtube:recorded",
      platform: "youtube",
      videoId: "recorded-video",
      partId: null,
      title: "Recorded title",
      channelTitle: null,
      thumbnailUrl: null,
      canonicalUrl: null,
      durationSec: null,
      openedAt: now,
      updatedAt: now,
      analyzedAt: now,
    }
    const controller = createHistoryController(createDependencies({
      getSavedAnalysisRunById: async () => ({
        analysisRun: analysisRun({ contentKey: "youtube:run-content", videoId: "run-video" }),
        segments: [segment()],
        transcript: null,
        videoRecord,
      }),
    }))

    const result = await controller.loadSavedRunRestore({ analysisRunId: "run-1", isCurrent: () => true })

    expect(result).toMatchObject({ kind: "ready", snapshot: {
      sourceIdentity: { contentKey: "youtube:recorded", videoId: "recorded-video" },
      analysis: { title: "Recorded title", contentKey: "youtube:recorded", videoId: "recorded-video" },
    } })
  })

  it("reuses the actual transcript cues for fingerprint semantics", async () => {
    const controller = createHistoryController(createDependencies({
      getLatestTranscriptSnapshotByVideoId: async () => transcript(),
      listRecentAnalyses: async () => [],
    }))
    const expected = await resolveAskTranscriptFingerprint({
      currentFingerprint: "stale-fingerprint",
      transcriptCues: cues,
    })

    const result = await controller.loadLegacyVideoRestore({ videoId: "video-1", isCurrent: () => true })

    expect(result).toMatchObject({ kind: "ready", snapshot: { transcript: { fingerprint: expected } } })
    expect(expected).toBe(await computeTranscriptFingerprint(cues))
  })

  it("preserves the exact-run missing aggregate and content identity errors", async () => {
    const missingController = createHistoryController(createDependencies())
    await expect(missingController.loadSavedRunRestore({ analysisRunId: "missing", isCurrent: () => true }))
      .rejects.toThrow("Saved analysis run was not found in local history.")

    const noIdentityController = createHistoryController(createDependencies({
      getSavedAnalysisRunById: async () => ({
        analysisRun: analysisRun({ contentKey: undefined }),
        segments: [segment()],
        transcript: null,
        videoRecord: null,
      }),
    }))
    await expect(noIdentityController.loadSavedRunRestore({ analysisRunId: "run-1", isCurrent: () => true }))
      .rejects.toThrow("Saved analysis run has no persisted content identity.")
  })

  it("propagates repository dependency failures unchanged", async () => {
    const error = new Error("history read failed")
    const controller = createHistoryController(createDependencies({
      getCurrentAnalysisByContentKey: async () => { throw error },
    }))

    await expect(controller.loadCurrentContextRestore({
      context: { platform: "youtube", videoId: "video-1", partId: null, contentKey: "youtube:video-1", title: "Video" },
      isCurrent: () => true,
    })).rejects.toBe(error)
  })

  it("deletes only the requested analysis run through the matching destructive action", async () => {
    const repositoryCalls: string[] = []
    let coordination: { action: string; target: unknown } | null = null
    const controller = createHistoryController(createDependencies({
      deleteAnalysisRun: async (analysisRunId) => { repositoryCalls.push(analysisRunId) },
      deleteVideoData: async (contentKey) => { repositoryCalls.push(`video:${contentKey}`) },
      performDestructiveOperation: async (action, target, mutate) => {
        coordination = { action, target }
        await mutate()
      },
    }))

    await expect(controller.deleteAnalysisRun({
      analysisRunId: "run-requested",
      contentKey: "youtube:video-requested",
    })).resolves.toEqual({ type: "delete-analysis-run", analysisRunId: "run-requested" })
    expect(coordination).toEqual({
      action: "delete-analysis-run",
      target: { analysisRunId: "run-requested", contentKey: "youtube:video-requested" },
    })
    expect(repositoryCalls).toEqual(["run-requested"])
  })

  it("deletes only the requested video data through the matching destructive action", async () => {
    const repositoryCalls: string[] = []
    let coordination: { action: string; target: unknown } | null = null
    const controller = createHistoryController(createDependencies({
      deleteAnalysisRun: async (analysisRunId) => { repositoryCalls.push(`analysis:${analysisRunId}`) },
      deleteVideoData: async (contentKey) => { repositoryCalls.push(contentKey) },
      performDestructiveOperation: async (action, target, mutate) => {
        coordination = { action, target }
        await mutate()
      },
    }))

    await expect(controller.deleteVideoData({ contentKey: "bilibili:BV1:p:2" }))
      .resolves.toEqual({ type: "delete-video-data", contentKey: "bilibili:BV1:p:2" })
    expect(coordination).toEqual({
      action: "delete-video-data",
      target: { contentKey: "bilibili:BV1:p:2" },
    })
    expect(repositoryCalls).toEqual(["bilibili:BV1:p:2"])
  })

  it("runs the repository mutation before destructive coordination completes", async () => {
    const calls: string[] = []
    const controller = createHistoryController(createDependencies({
      deleteVideoData: async () => { calls.push("repository") },
      performDestructiveOperation: async (_action, _target, mutate) => {
        calls.push("coordination:start")
        await mutate()
        calls.push("coordination:done")
      },
    }))

    await controller.deleteVideoData({ contentKey: "youtube:video-1" })
    expect(calls).toEqual(["coordination:start", "repository", "coordination:done"])
  })

  it("does not delete when destructive coordination rejects", async () => {
    const coordinationError = new Error("operation blocked")
    let repositoryCalls = 0
    const controller = createHistoryController(createDependencies({
      deleteAnalysisRun: async () => { repositoryCalls += 1 },
      performDestructiveOperation: async () => { throw coordinationError },
    }))

    await expect(controller.deleteAnalysisRun({ analysisRunId: "run-1" })).rejects.toBe(coordinationError)
    expect(repositoryCalls).toBe(0)
  })

  it("propagates analysis deletion repository failures unchanged", async () => {
    const repositoryError = new Error("analysis delete failed")
    const controller = createHistoryController(createDependencies({
      deleteAnalysisRun: async () => { throw repositoryError },
      performDestructiveOperation: async (_action, _target, mutate) => mutate(),
    }))

    await expect(controller.deleteAnalysisRun({ analysisRunId: "run-1" })).rejects.toBe(repositoryError)
  })

  it("propagates video deletion coordination failures unchanged", async () => {
    const coordinationError = new Error("video operation blocked")
    const controller = createHistoryController(createDependencies({
      performDestructiveOperation: async () => { throw coordinationError },
    }))

    await expect(controller.deleteVideoData({ contentKey: "youtube:video-1" })).rejects.toBe(coordinationError)
  })
})
