import { describe, expect, it } from "bun:test"

import { VIDEO_ANALYSIS_PROMPT_VERSION } from "@/features/analysis/lib/analysis-schema"
import { ANALYSIS_PRESET_STRATEGIES } from "@/features/analysis/lib/analysis-preset"
import type { VideoAnalysis } from "@/features/analysis/lib/analysis-schema"
import type { AnalysisTaskPhase, AnalysisTaskSnapshot } from "@/features/analysis/lib/analysis-task-controller"
import type { AnalysisTaskExecutionPolicy } from "@/features/analysis/lib/analysis-task-lifecycle"
import type { RunAnalysisOptions, RunAnalysisResult } from "@/features/analysis/lib/run-analysis"
import type { SaveAnalysisRunInput } from "@/features/history/lib/history-repository"
import type { VideoInfo, VideoTranscript } from "@/features/platform/types"
import { computeAnalysisCacheKey } from "@/lib/persistence/cache-identity"
import type {
  AnalysisCacheEntity,
  TranscriptSnapshotEntity,
  VideoRecordEntity,
} from "@/lib/schemas/persistence"
import type { SaveTaskCacheInput } from "@/sidepanel/transcript/transcript-controller"

import {
  createAnalysisController,
  type AnalysisController,
  type AnalysisControllerDependencies,
  type AnalysisExecutionRequest,
} from "./analysis-controller"

const CONTENT_KEY = "youtube:video-1"
const TRANSCRIPT_FINGERPRINT = "fingerprint-1"
const TRANSCRIPT_CAPTURED_AT = "2026-01-01T00:10:00.000Z"
const COMPLETED_AT = "2026-01-01T00:20:00.000Z"
const TASK_STARTED_AT = "2026-01-01T00:00:00.000Z"
const CACHED_AT = "2025-12-31T00:00:00.000Z"

function snapshotFixture(
  overrides: Partial<AnalysisTaskSnapshot> = {},
): AnalysisTaskSnapshot {
  return {
    taskId: "task-1",
    sourceTabId: 7,
    platform: "youtube",
    videoId: "video-1",
    partId: null,
    contentKey: CONTENT_KEY,
    title: "Snapshot Title",
    author: "Snapshot Author",
    canonicalUrl: "https://www.youtube.com/watch?v=video-1",
    providerProfileId: "profile-1",
    providerBaseUrl: "https://api.example.com/v1",
    providerModel: "model-1",
    generationTimeoutSec: 120,
    analysisPresetId: "standard",
    analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
    startedAt: TASK_STARTED_AT,
    ...overrides,
  }
}

function videoFixture(overrides: Partial<VideoInfo> = {}): VideoInfo {
  return {
    platform: "youtube",
    videoId: "video-1",
    contentKey: CONTENT_KEY,
    title: "Video Title",
    author: "Video Author",
    durationSec: 300,
    thumbnailUrl: "https://img.example.com/thumb.jpg",
    canonicalUrl: "https://www.youtube.com/watch?v=video-1",
    ...overrides,
  }
}

function transcriptFixture(overrides: Partial<VideoTranscript> = {}): VideoTranscript {
  return {
    segments: [
      { startSec: 0, endSec: 12, text: "Intro line." },
      { startSec: 12, endSec: 24, text: "Second line." },
    ],
    language: "en",
    source: "manual",
    raw: {
      format: "vtt",
      text: "WEBVTT\n\n00:00:00.000 --> 00:00:12.000\nIntro line.\n",
      sourceUrl: "https://www.youtube.com/api/timedtext?v=video-1",
    },
    ...overrides,
  }
}

function analysisFixture(): VideoAnalysis {
  return {
    summary: "A concise summary.",
    keyPoints: [
      { text: "First point.", startSec: 0, endSec: 12 },
      { text: "Second point." },
    ],
    chapters: [
      {
        title: "Chapter One",
        startSec: 0,
        endSec: 12,
        summary: "Chapter one summary.",
        detail: "Chapter one detail.",
      },
      {
        title: "Chapter Two",
        startSec: 12,
        endSec: 24,
        summary: "Chapter two summary.",
        detail: "Chapter two detail.",
      },
    ],
  }
}

function runResultFixture(overrides: Partial<RunAnalysisResult> = {}): RunAnalysisResult {
  return {
    videoId: "video-1",
    strategy: "single-pass",
    initialChunkCount: 0,
    reductionLevels: 0,
    chunkSummaries: [],
    analysis: analysisFixture(),
    rawResponse: "{}",
    repairAttempted: false,
    ...overrides,
  }
}

function cacheFixture(overrides: Partial<AnalysisCacheEntity> = {}): AnalysisCacheEntity {
  return {
    cacheKey: "cache-key-1",
    contentKey: CONTENT_KEY,
    platform: "youtube",
    videoId: "video-1",
    partId: null,
    transcriptFingerprint: TRANSCRIPT_FINGERPRINT,
    analysisSchemaVersion: 1,
    analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
    providerProfileId: "profile-1",
    providerBaseUrl: "https://api.example.com/v1",
    providerModel: "model-1",
    analysisRunId: "cached-run-1",
    analysis: analysisFixture(),
    createdAt: CACHED_AT,
    updatedAt: CACHED_AT,
    ...overrides,
  }
}

type HarnessConfig = {
  overrides?: Partial<AnalysisControllerDependencies>
  nowValues?: string[]
  uuids?: string[]
  cached?: AnalysisCacheEntity | null
}

type Harness = {
  controller: AnalysisController
  deps: AnalysisControllerDependencies
  events: string[]
  calls: {
    resolveProvider: string[]
    saveTaskTranscriptCache: SaveTaskCacheInput[]
    getAnalysisCache: string[]
    saveVideoRecord: VideoRecordEntity[]
    saveTranscriptSnapshot: TranscriptSnapshotEntity[]
    saveAnalysisRun: SaveAnalysisRunInput[]
    saveAnalysisCache: AnalysisCacheEntity[]
    runAnalysis: RunAnalysisOptions[]
  }
}

function createHarness(config: HarnessConfig = {}): Harness {
  const events: string[] = []
  const calls: Harness["calls"] = {
    resolveProvider: [],
    saveTaskTranscriptCache: [],
    getAnalysisCache: [],
    saveVideoRecord: [],
    saveTranscriptSnapshot: [],
    saveAnalysisRun: [],
    saveAnalysisCache: [],
    runAnalysis: [],
  }
  const nowValues = [...(config.nowValues ?? [TRANSCRIPT_CAPTURED_AT, COMPLETED_AT])]
  const uuids = [...(config.uuids ?? ["run-1", "snapshot-1", "segment-1", "segment-2"])]
  const nextNow = () => {
    const value = nowValues.length > 0 ? nowValues.shift()! : COMPLETED_AT
    events.push(`now:${value}`)
    return value
  }
  const nextUuid = () => (uuids.length > 0 ? uuids.shift()! : "uuid-fallback")

  const base: AnalysisControllerDependencies = {
    resolveProvider: async (providerId) => {
      calls.resolveProvider.push(providerId)
      events.push("resolveProvider")
      return { apiKey: "resolved-secret" }
    },
    saveTaskTranscriptCache: async (input) => {
      calls.saveTaskTranscriptCache.push(input)
      events.push("saveTaskTranscriptCache")
    },
    getAnalysisCache: async (cacheKey) => {
      calls.getAnalysisCache.push(cacheKey)
      events.push("getAnalysisCache")
      return config.cached ?? null
    },
    saveVideoRecord: async (input) => {
      calls.saveVideoRecord.push(input)
      events.push("saveVideoRecord")
      return input
    },
    saveTranscriptSnapshot: async (input) => {
      calls.saveTranscriptSnapshot.push(input)
      events.push("saveTranscriptSnapshot")
      return input
    },
    saveAnalysisRun: async (input) => {
      calls.saveAnalysisRun.push(input)
      events.push("saveAnalysisRun")
      return input
    },
    saveAnalysisCache: async (input) => {
      calls.saveAnalysisCache.push(input)
      events.push("saveAnalysisCache")
      return input
    },
    runAnalysis: async (options) => {
      calls.runAnalysis.push(options)
      events.push("runAnalysis")
      return runResultFixture()
    },
    now: nextNow,
    randomUUID: nextUuid,
  }

  const deps = { ...base, ...(config.overrides ?? {}) }
  return {
    controller: createAnalysisController(deps),
    deps,
    events,
    calls,
  }
}

type RequestExtras = {
  phases: AnalysisTaskPhase[]
  guardCalls: number
  publicationCalls: { count: number }
}

type RequestOverrides = Partial<
  Omit<AnalysisExecutionRequest, "setPhase" | "ensureTaskCurrent">
> & {
  ensureTaskCurrent?: () => void
}

function createRequest(
  events: string[],
  overrides: RequestOverrides = {},
): { request: AnalysisExecutionRequest; extras: RequestExtras } {
  const phases: AnalysisTaskPhase[] = []
  const extras = { phases, guardCalls: 0, publicationCalls: { count: 0 } }
  const request: AnalysisExecutionRequest = {
    taskSnapshot: snapshotFixture(),
    sourceVideo: videoFixture(),
    transcript: transcriptFixture(),
    transcriptFingerprint: TRANSCRIPT_FINGERPRINT,
    executionPolicy: { bypassAnalysisCache: false, forceReloadTranscript: false },
    signal: new AbortController().signal,
    setPhase: (phase) => {
      phases.push(phase)
      events.push(`phase:${phase}`)
    },
    ensureTaskCurrent: () => {
      extras.guardCalls += 1
      events.push("guard")
    },
    ...overrides,
  }
  return { request, extras }
}

async function expectedCacheKey(): Promise<string> {
  return computeAnalysisCacheKey({
    contentKey: CONTENT_KEY,
    transcriptFingerprint: TRANSCRIPT_FINGERPRINT,
    providerProfileId: "profile-1",
    baseUrl: "https://api.example.com/v1",
    model: "model-1",
  })
}

const defaultPolicy: AnalysisTaskExecutionPolicy = {
  bypassAnalysisCache: false,
  forceReloadTranscript: false,
}

describe("analysis controller — common prefix", () => {
  it("A. starts the workflow by entering the analyzing phase", async () => {
    const harness = createHarness()
    const { request, extras } = createRequest(harness.events)

    await harness.controller.runExecutionTask(request)

    expect(extras.phases[0]).toBe("analyzing")
    expect(harness.events[0]).toBe("phase:analyzing")
  })

  it("B. resolves the provider from the task snapshot provider profile", async () => {
    const harness = createHarness()
    const { request } = createRequest(harness.events, {
      taskSnapshot: snapshotFixture({ providerProfileId: "profile-9" }),
    })

    await harness.controller.runExecutionTask(request)

    expect(harness.calls.resolveProvider).toEqual(["profile-9"])
  })

  it("C. runs the task-current guard only after provider resolution", async () => {
    const harness = createHarness()
    const { request, extras } = createRequest(harness.events)

    await harness.controller.runExecutionTask(request)

    const providerIndex = harness.events.indexOf("resolveProvider")
    const guardIndex = harness.events.indexOf("guard")
    expect(providerIndex).toBeGreaterThan(-1)
    expect(guardIndex).toBeGreaterThan(providerIndex)
    expect(extras.guardCalls).toBe(2)
  })

  it("D. persists the exact task transcript cache payload", async () => {
    const harness = createHarness()
    const { request } = createRequest(harness.events)

    await harness.controller.runExecutionTask(request)

    expect(harness.calls.saveTaskTranscriptCache).toEqual([
      {
        sourceVideo: videoFixture(),
        transcript: transcriptFixture(),
        taskContentKey: CONTENT_KEY,
        fingerprint: TRANSCRIPT_FINGERPRINT,
        now: TRANSCRIPT_CAPTURED_AT,
      },
    ])
  })
})

describe("analysis controller — analysis cache", () => {
  it("E. returns the exact cached publication without running the model", async () => {
    const harness = createHarness({ cached: cacheFixture() })
    const { request, extras } = createRequest(harness.events)

    const result = await harness.controller.runExecutionTask(request)

    expect(result.kind).toBe("cached")
    expect(result.publication).toEqual({
      platform: "youtube",
      videoId: "video-1",
      partId: null,
      contentKey: CONTENT_KEY,
      title: "Video Title",
      analysis: analysisFixture(),
      analysisRunId: "cached-run-1",
      transcriptFingerprint: TRANSCRIPT_FINGERPRINT,
      providerProfileId: "profile-1",
      providerBaseUrl: "https://api.example.com/v1",
      providerModel: "model-1",
      analysisSchemaVersion: 1,
      analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
      lastAnalyzedAt: CACHED_AT,
    })
    expect(extras.phases).toEqual(["analyzing"])
    expect(harness.calls.runAnalysis).toHaveLength(0)
    expect(harness.calls.saveVideoRecord).toHaveLength(0)
    expect(harness.calls.saveTranscriptSnapshot).toHaveLength(0)
    expect(harness.calls.saveAnalysisRun).toHaveLength(0)
    expect(harness.calls.saveAnalysisCache).toHaveLength(0)
    expect(harness.events).not.toContain("phase:finalizing")
  })

  it("E2. runs the task-current guard before returning the cached result", async () => {
    const harness = createHarness({ cached: cacheFixture() })
    const { request, extras } = createRequest(harness.events)

    await harness.controller.runExecutionTask(request)

    const lastGuardIndex = harness.events.lastIndexOf("guard")
    expect(extras.guardCalls).toBe(2)
    expect(lastGuardIndex).toBeGreaterThan(harness.events.indexOf("getAnalysisCache"))
  })

  it("E3. preserves a nullable analysis run identity on a genuine exact cache hit", async () => {
    const harness = createHarness({ cached: cacheFixture({ analysisRunId: null }) })
    const { request, extras } = createRequest(harness.events)

    const result = await harness.controller.runExecutionTask(request)

    expect(result.kind).toBe("cached")
    expect(result.publication.analysisRunId).toBeNull()
    expect(result.publication).toEqual({
      platform: "youtube",
      videoId: "video-1",
      partId: null,
      contentKey: CONTENT_KEY,
      title: "Video Title",
      analysis: analysisFixture(),
      analysisRunId: null,
      transcriptFingerprint: TRANSCRIPT_FINGERPRINT,
      providerProfileId: "profile-1",
      providerBaseUrl: "https://api.example.com/v1",
      providerModel: "model-1",
      analysisSchemaVersion: 1,
      analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
      lastAnalyzedAt: CACHED_AT,
    })
    expect(harness.calls.runAnalysis).toHaveLength(0)
    expect(harness.calls.saveVideoRecord).toHaveLength(0)
    expect(harness.calls.saveTranscriptSnapshot).toHaveLength(0)
    expect(harness.calls.saveAnalysisRun).toHaveLength(0)
    expect(harness.calls.saveAnalysisCache).toHaveLength(0)
    expect(extras.phases).toEqual(["analyzing"])
    expect(harness.events).not.toContain("phase:finalizing")
  })

  it("F. skips the cache lookup entirely when the execution policy bypasses it", async () => {
    const harness = createHarness({ cached: cacheFixture() })
    const { request } = createRequest(harness.events, {
      executionPolicy: { ...defaultPolicy, bypassAnalysisCache: true },
    })

    const result = await harness.controller.runExecutionTask(request)

    expect(result.kind).toBe("completed")
    expect(harness.calls.getAnalysisCache).toHaveLength(0)
    expect(harness.calls.runAnalysis).toHaveLength(1)
  })

  it("G. falls through to the model when the cached identity does not match", async () => {
    const harness = createHarness({ cached: cacheFixture({ providerModel: "model-other" }) })
    const { request } = createRequest(harness.events)

    const result = await harness.controller.runExecutionTask(request)

    expect(result.kind).toBe("completed")
    expect(harness.calls.getAnalysisCache).toHaveLength(1)
    expect(harness.calls.runAnalysis).toHaveLength(1)
  })

  it("G2. falls through to the model when the cached entry has no analysis", async () => {
    const harness = createHarness({ cached: cacheFixture({ analysis: null }) })
    const { request } = createRequest(harness.events)

    const result = await harness.controller.runExecutionTask(request)

    expect(result.kind).toBe("completed")
    expect(harness.calls.runAnalysis).toHaveLength(1)
  })
})

describe("analysis controller — model execution", () => {
  it("H. passes the frozen provider config with the resolved secret", async () => {
    const harness = createHarness()
    const { request } = createRequest(harness.events)

    await harness.controller.runExecutionTask(request)

    expect(harness.calls.runAnalysis[0]?.provider).toEqual({
      baseUrl: "https://api.example.com/v1",
      apiKey: "resolved-secret",
      model: "model-1",
      generationTimeoutSec: 120,
    })
  })

  it("I. passes the exact transcript input", async () => {
    const harness = createHarness()
    const { request } = createRequest(harness.events)

    await harness.controller.runExecutionTask(request)

    expect(harness.calls.runAnalysis[0]?.transcript).toEqual({
      videoId: "video-1",
      title: "Video Title",
      cues: transcriptFixture().segments,
      durationSec: 300,
    })
  })

  it("J. forwards the abort signal unchanged", async () => {
    const harness = createHarness()
    const controller = new AbortController()
    const { request } = createRequest(harness.events, { signal: controller.signal })

    await harness.controller.runExecutionTask(request)

    expect(harness.calls.runAnalysis[0]?.signal).toBe(controller.signal)
  })

  it("K. guards task currentness after the model and before finalizing", async () => {
    const harness = createHarness()
    const { request } = createRequest(harness.events)

    await harness.controller.runExecutionTask(request)

    const modelIndex = harness.events.indexOf("runAnalysis")
    const finalizingIndex = harness.events.indexOf("phase:finalizing")
    const guardIndex = harness.events.lastIndexOf("guard", finalizingIndex)
    expect(modelIndex).toBeGreaterThan(-1)
    expect(guardIndex).toBeGreaterThan(modelIndex)
    expect(finalizingIndex).toBeGreaterThan(guardIndex)
  })
})

describe("analysis controller — completion timestamps and identifiers", () => {
  it("L. reads the completion timestamp as a second now() value", async () => {
    const harness = createHarness()
    const { request } = createRequest(harness.events)

    const result = await harness.controller.runExecutionTask(request)

    expect(harness.calls.saveTaskTranscriptCache[0]?.now).toBe(TRANSCRIPT_CAPTURED_AT)
    expect(harness.calls.saveTranscriptSnapshot[0]?.createdAt).toBe(TRANSCRIPT_CAPTURED_AT)
    expect(harness.calls.saveTranscriptSnapshot[0]?.updatedAt).toBe(TRANSCRIPT_CAPTURED_AT)
    expect(harness.calls.saveVideoRecord[0]?.analyzedAt).toBe(COMPLETED_AT)
    expect(result.publication.lastAnalyzedAt).toBe(COMPLETED_AT)
    expect(result.publication.lastAnalyzedAt).not.toBe(TRANSCRIPT_CAPTURED_AT)
  })

  it("R. consumes deterministic run, snapshot and segment identifiers", async () => {
    const harness = createHarness()
    const { request } = createRequest(harness.events)

    const result = await harness.controller.runExecutionTask(request)

    expect(result.publication.analysisRunId).toBe("run-1")
    const savedRun = harness.calls.saveAnalysisRun[0]
    expect(savedRun?.analysisRun.id).toBe("run-1")
    expect(savedRun?.analysisRun.transcriptSnapshotId).toBe("snapshot-1")
    expect(savedRun?.segments.map((segment) => segment.id)).toEqual(["segment-1", "segment-2"])
    expect(harness.calls.saveTranscriptSnapshot[0]?.id).toBe("snapshot-1")
  })
})

describe("analysis controller — persistence", () => {
  it("M. writes persistence records in the documented order", async () => {
    const harness = createHarness()
    const { request } = createRequest(harness.events)

    await harness.controller.runExecutionTask(request)

    const persistenceEvents = harness.events.filter((event) => (
      event === "saveVideoRecord"
      || event === "saveTranscriptSnapshot"
      || event === "saveAnalysisRun"
      || event === "saveAnalysisCache"
    ))
    expect(persistenceEvents).toEqual([
      "saveVideoRecord",
      "saveTranscriptSnapshot",
      "saveAnalysisRun",
      "saveAnalysisCache",
    ])
  })

  it("N. persists the exact video record payload", async () => {
    const harness = createHarness()
    const { request } = createRequest(harness.events)

    await harness.controller.runExecutionTask(request)

    expect(harness.calls.saveVideoRecord[0]).toEqual({
      contentKey: CONTENT_KEY,
      platform: "youtube",
      videoId: "video-1",
      partId: null,
      title: "Video Title",
      channelTitle: "Video Author",
      thumbnailUrl: "https://img.example.com/thumb.jpg",
      canonicalUrl: "https://www.youtube.com/watch?v=video-1",
      durationSec: 300,
      openedAt: TASK_STARTED_AT,
      updatedAt: COMPLETED_AT,
      analyzedAt: COMPLETED_AT,
    })
  })

  it("O. persists the exact transcript snapshot payload", async () => {
    const harness = createHarness()
    const { request } = createRequest(harness.events)

    await harness.controller.runExecutionTask(request)

    expect(harness.calls.saveTranscriptSnapshot[0]).toEqual({
      id: "snapshot-1",
      videoId: "video-1",
      platform: "youtube",
      contentKey: CONTENT_KEY,
      partId: null,
      language: "en",
      sourceUrl: "https://www.youtube.com/api/timedtext?v=video-1",
      rawVtt: "WEBVTT\n\n00:00:00.000 --> 00:00:12.000\nIntro line.\n",
      cues: transcriptFixture().segments,
      createdAt: TRANSCRIPT_CAPTURED_AT,
      updatedAt: TRANSCRIPT_CAPTURED_AT,
    })
  })

  it("P. persists the exact analysis run, segments and recent video payload", async () => {
    const harness = createHarness()
    const { request } = createRequest(harness.events)
    const cacheKey = await expectedCacheKey()

    await harness.controller.runExecutionTask(request)

    expect(harness.calls.saveAnalysisRun[0]).toEqual({
      analysisRun: {
        id: "run-1",
        videoId: "video-1",
        platform: "youtube",
        contentKey: CONTENT_KEY,
        partId: null,
        transcriptSnapshotId: "snapshot-1",
        providerConfigId: "profile-1",
        transcriptFingerprint: TRANSCRIPT_FINGERPRINT,
        analysisSchemaVersion: 1,
        analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
        analysisCacheKey: cacheKey,
        providerProfileId: "profile-1",
        providerBaseUrl: "https://api.example.com/v1",
        providerModel: "model-1",
        status: "completed",
        summary: "A concise summary.",
        keyPoints: analysisFixture().keyPoints,
        topics: [],
        errorMessage: null,
        createdAt: TASK_STARTED_AT,
        updatedAt: COMPLETED_AT,
        completedAt: COMPLETED_AT,
      },
      segments: [
        {
          id: "segment-1",
          analysisRunId: "run-1",
          videoId: "video-1",
          contentKey: CONTENT_KEY,
          title: "Chapter One",
          summary: "Chapter one summary.",
          detail: "Chapter one detail.",
          startSec: 0,
          endSec: 12,
          createdAt: TASK_STARTED_AT,
          updatedAt: COMPLETED_AT,
        },
        {
          id: "segment-2",
          analysisRunId: "run-1",
          videoId: "video-1",
          contentKey: CONTENT_KEY,
          title: "Chapter Two",
          summary: "Chapter two summary.",
          detail: "Chapter two detail.",
          startSec: 12,
          endSec: 24,
          createdAt: TASK_STARTED_AT,
          updatedAt: COMPLETED_AT,
        },
      ],
      recentVideo: {
        videoId: "video-1",
        analysisRunId: "run-1",
        contentKey: CONTENT_KEY,
        title: "Video Title",
        channelTitle: "Video Author",
        thumbnailUrl: "https://img.example.com/thumb.jpg",
        status: "completed",
        openedAt: TASK_STARTED_AT,
        analyzedAt: COMPLETED_AT,
        updatedAt: COMPLETED_AT,
      },
    })
  })

  it("Q. persists the exact analysis cache payload", async () => {
    const harness = createHarness()
    const { request } = createRequest(harness.events)
    const cacheKey = await expectedCacheKey()

    await harness.controller.runExecutionTask(request)

    expect(harness.calls.saveAnalysisCache[0]).toEqual({
      cacheKey,
      contentKey: CONTENT_KEY,
      platform: "youtube",
      videoId: "video-1",
      partId: null,
      transcriptFingerprint: TRANSCRIPT_FINGERPRINT,
      analysisSchemaVersion: 1,
      analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
      providerProfileId: "profile-1",
      providerBaseUrl: "https://api.example.com/v1",
      providerModel: "model-1",
      analysisRunId: "run-1",
      analysis: analysisFixture(),
      createdAt: TASK_STARTED_AT,
      updatedAt: COMPLETED_AT,
    })
  })

  it("S. returns the exact completed publication projection", async () => {
    const harness = createHarness()
    const { request } = createRequest(harness.events)

    const result = await harness.controller.runExecutionTask(request)

    expect(result).toEqual({
      kind: "completed",
      publication: {
        platform: "youtube",
        videoId: "video-1",
        partId: null,
        contentKey: CONTENT_KEY,
        title: "Video Title",
        analysis: analysisFixture(),
        analysisRunId: "run-1",
        transcriptFingerprint: TRANSCRIPT_FINGERPRINT,
        providerProfileId: "profile-1",
        providerBaseUrl: "https://api.example.com/v1",
        providerModel: "model-1",
        analysisSchemaVersion: 1,
        analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
        lastAnalyzedAt: COMPLETED_AT,
      },
    })
    expect("errorMessage" in result.publication).toBe(false)
    expect(Object.values(result.publication)).not.toContain("resolved-secret")
  })
})

describe("analysis controller — error propagation and dependency surface", () => {
  it("T. propagates provider resolution rejection unchanged", async () => {
    const failure = new Error("provider exploded")
    const harness = createHarness({
      overrides: {
        resolveProvider: async () => {
          throw failure
        },
      },
    })
    const { request, extras } = createRequest(harness.events)

    await expect(harness.controller.runExecutionTask(request)).rejects.toBe(failure)
    expect(extras.guardCalls).toBe(0)
    expect(harness.calls.getAnalysisCache).toHaveLength(0)
    expect(harness.calls.runAnalysis).toHaveLength(0)
    expect(harness.calls.saveVideoRecord).toHaveLength(0)
  })

  it("U. propagates a task-current rejection after provider resolution", async () => {
    const failure = new Error("task is stale")
    const harness = createHarness()
    const { request } = createRequest(harness.events, {
      ensureTaskCurrent: () => {
        throw failure
      },
    })

    await expect(harness.controller.runExecutionTask(request)).rejects.toBe(failure)
    expect(harness.calls.getAnalysisCache).toHaveLength(0)
    expect(harness.calls.saveTaskTranscriptCache).toHaveLength(0)
    expect(harness.calls.runAnalysis).toHaveLength(0)
    expect(harness.calls.saveAnalysisRun).toHaveLength(0)
  })

  it("V. propagates model rejection unchanged", async () => {
    const failure = new Error("model exploded")
    const harness = createHarness({
      overrides: {
        runAnalysis: async () => {
          throw failure
        },
      },
    })
    const { request, extras } = createRequest(harness.events)

    await expect(harness.controller.runExecutionTask(request)).rejects.toBe(failure)
    expect(extras.phases).toEqual(["analyzing"])
    expect(harness.calls.saveVideoRecord).toHaveLength(0)
    expect(harness.calls.saveAnalysisRun).toHaveLength(0)
  })

  it("W. skips finalizing and persistence when the guard rejects after the model", async () => {
    const failure = new Error("task is stale after model")
    const harness = createHarness()
    let guardCalls = 0
    const { request, extras } = createRequest(harness.events, {
      ensureTaskCurrent: () => {
        guardCalls += 1
        harness.events.push("guard")
        if (guardCalls >= 2) throw failure
      },
    })

    await expect(harness.controller.runExecutionTask(request)).rejects.toBe(failure)
    expect(extras.phases).toEqual(["analyzing"])
    expect(harness.calls.saveVideoRecord).toHaveLength(0)
    expect(harness.calls.saveTranscriptSnapshot).toHaveLength(0)
    expect(harness.calls.saveAnalysisRun).toHaveLength(0)
    expect(harness.calls.saveAnalysisCache).toHaveLength(0)
  })

  it("X. propagates persistence rejection unchanged", async () => {
    const failure = new Error("quota exceeded")
    const harness = createHarness({
      overrides: {
        saveAnalysisRun: async () => {
          throw failure
        },
      },
    })
    const { request } = createRequest(harness.events)

    await expect(harness.controller.runExecutionTask(request)).rejects.toBe(failure)
    expect(harness.calls.saveVideoRecord).toHaveLength(1)
    expect(harness.calls.saveTranscriptSnapshot).toHaveLength(1)
    expect(harness.calls.saveAnalysisCache).toHaveLength(0)
  })

  it("Y. exposes no presentation, toast or workspace capability", () => {
    const harness = createHarness()
    const keys = Object.keys(harness.deps).sort()

    expect(keys).toEqual([
      "getAnalysisCache",
      "now",
      "randomUUID",
      "resolveProvider",
      "runAnalysis",
      "saveAnalysisCache",
      "saveAnalysisRun",
      "saveTaskTranscriptCache",
      "saveTranscriptSnapshot",
      "saveVideoRecord",
    ])
    for (const forbidden of [
      "publishAnalysisResult",
      "publishAnalysisTranscript",
      "refreshRecentAnalyses",
      "toast",
      "t",
      "setAnalysisView",
      "setAnalysisPhase",
      "workspaceController",
      "workspaceEpoch",
    ]) {
      expect(keys).not.toContain(forbidden)
    }
  })
})

describe("analysis controller — analysis preset identity", () => {
  const CONCISE_VERSION = ANALYSIS_PRESET_STRATEGIES.concise.promptVersion
  const DETAILED_VERSION = ANALYSIS_PRESET_STRATEGIES.detailed.promptVersion

  function conciseSnapshot(): AnalysisTaskSnapshot {
    return snapshotFixture({
      analysisPresetId: "concise",
      analysisPromptVersion: CONCISE_VERSION,
    })
  }

  it("S1. keeps the standard cache identity byte-compatible with the pre-preset contract", async () => {
    const harness = createHarness()
    const { request } = createRequest(harness.events)

    const result = await harness.controller.runExecutionTask(request)

    expect(harness.calls.getAnalysisCache[0]).toBe(await expectedCacheKey())
    expect(harness.calls.runAnalysis[0]?.preset?.id).toBe("standard")
    expect(harness.calls.runAnalysis[0]?.preset?.styleInstructions).toEqual([])
    expect(harness.calls.saveAnalysisRun[0]?.analysisRun.analysisPromptVersion).toBe(
      VIDEO_ANALYSIS_PROMPT_VERSION,
    )
    if (result.kind !== "completed") throw new Error("expected a completed run")
    expect(result.publication.analysisPromptVersion).toBe(VIDEO_ANALYSIS_PROMPT_VERSION)
  })

  it("S2. sends the snapshot preset strategy to the model request", async () => {
    const harness = createHarness()
    const { request } = createRequest(harness.events, { taskSnapshot: conciseSnapshot() })

    await harness.controller.runExecutionTask(request)

    const preset = harness.calls.runAnalysis[0]?.preset
    expect(preset?.id).toBe("concise")
    expect(preset?.promptVersion).toBe(CONCISE_VERSION)
    expect(preset?.styleInstructions.length).toBeGreaterThan(0)
  })

  it("S3. uses the snapshot prompt version for lookup, persistence and publication", async () => {
    const harness = createHarness()
    const { request } = createRequest(harness.events, { taskSnapshot: conciseSnapshot() })

    const result = await harness.controller.runExecutionTask(request)

    const expectedKey = await computeAnalysisCacheKey({
      contentKey: CONTENT_KEY,
      transcriptFingerprint: TRANSCRIPT_FINGERPRINT,
      providerProfileId: "profile-1",
      baseUrl: "https://api.example.com/v1",
      model: "model-1",
      promptVersion: CONCISE_VERSION,
    })
    expect(harness.calls.getAnalysisCache).toEqual([expectedKey])
    expect(harness.calls.saveAnalysisRun[0]?.analysisRun.analysisPromptVersion).toBe(CONCISE_VERSION)
    expect(harness.calls.saveAnalysisCache[0]?.analysisPromptVersion).toBe(CONCISE_VERSION)
    if (result.kind !== "completed") throw new Error("expected a completed run")
    expect(result.publication.analysisPromptVersion).toBe(CONCISE_VERSION)
    expect(result.publication.analysisRunId).toBe("run-1")
  })

  it("S4. never lets two presets share a cache identity", async () => {
    const identity = {
      contentKey: CONTENT_KEY,
      transcriptFingerprint: TRANSCRIPT_FINGERPRINT,
      providerProfileId: "profile-1",
      baseUrl: "https://api.example.com/v1",
      model: "model-1",
    }
    const standard = await computeAnalysisCacheKey({
      ...identity,
      promptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
    })
    const concise = await computeAnalysisCacheKey({ ...identity, promptVersion: CONCISE_VERSION })
    const detailed = await computeAnalysisCacheKey({ ...identity, promptVersion: DETAILED_VERSION })

    expect(new Set([standard, concise, detailed]).size).toBe(3)
  })

  it("S5. refuses a cache hit that belongs to another preset", async () => {
    const harness = createHarness({
      cached: cacheFixture({ analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION }),
    })
    const { request } = createRequest(harness.events, { taskSnapshot: conciseSnapshot() })

    const result = await harness.controller.runExecutionTask(request)

    expect(harness.calls.runAnalysis).toHaveLength(1)
    if (result.kind !== "completed") throw new Error("expected a completed run")
    expect(result.publication.analysisPromptVersion).toBe(CONCISE_VERSION)
  })

  it("S6. reuses an exact cache hit that matches the concise snapshot identity", async () => {
    const harness = createHarness({
      cached: cacheFixture({ analysisPromptVersion: CONCISE_VERSION }),
    })
    const { request } = createRequest(harness.events, { taskSnapshot: conciseSnapshot() })

    const result = await harness.controller.runExecutionTask(request)

    expect(result.kind).toBe("cached")
    expect(harness.calls.runAnalysis).toHaveLength(0)
  })
})

describe("analysis controller — standard cache compatibility", () => {
  it("S7. does not reuse a Standard cache row written under the previous prompt contract", async () => {
    // The row was produced by the pre-hardening prompt identity. Bumping
    // VIDEO_ANALYSIS_PROMPT_VERSION must invalidate it: a stale prompt contract
    // may contain prompt-injection boundaries the new one already fixes, so
    // reusing it would republish output the current contract would not produce.
    const legacyPromptVersion = "video-analysis-v2"
    expect(legacyPromptVersion).not.toBe(VIDEO_ANALYSIS_PROMPT_VERSION)

    const harness = createHarness({
      cached: cacheFixture({ analysisPromptVersion: legacyPromptVersion }),
    })
    const { request } = createRequest(harness.events)

    const result = await harness.controller.runExecutionTask(request)

    expect(result.kind).toBe("completed")
    expect(harness.calls.getAnalysisCache[0]).toBe(await expectedCacheKey())
    expect(harness.calls.runAnalysis).toHaveLength(1)
    expect(result.publication.analysisPromptVersion).toBe(VIDEO_ANALYSIS_PROMPT_VERSION)
  })

  it("S7b. still reuses a Standard cache row written under the current prompt contract", async () => {
    // The compatibility half of S7: a row at the current identity is an exact
    // hit and must short-circuit the model, so the invalidation above is caused
    // by the version bump and not by a broken cache path.
    const harness = createHarness({
      cached: cacheFixture({ analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION }),
    })
    const { request } = createRequest(harness.events)

    const result = await harness.controller.runExecutionTask(request)

    expect(result.kind).toBe("cached")
    expect(harness.calls.getAnalysisCache[0]).toBe(await expectedCacheKey())
    expect(harness.calls.runAnalysis).toHaveLength(0)
    expect(harness.calls.saveAnalysisRun).toHaveLength(0)
    if (result.kind !== "cached") throw new Error("expected a cached run")
    expect(result.publication.analysisPromptVersion).toBe(VIDEO_ANALYSIS_PROMPT_VERSION)
  })

  it("S8. keeps two tasks with different presets fully isolated", async () => {
    const detailedHarness = createHarness()
    const { request: detailedRequest } = createRequest(detailedHarness.events, {
      taskSnapshot: snapshotFixture({
        taskId: "task-2",
        analysisPresetId: "detailed",
        analysisPromptVersion: ANALYSIS_PRESET_STRATEGIES.detailed.promptVersion,
      }),
    })
    const conciseHarness = createHarness()
    const { request: conciseRequest } = createRequest(conciseHarness.events, {
      taskSnapshot: snapshotFixture({
        taskId: "task-1",
        analysisPresetId: "concise",
        analysisPromptVersion: ANALYSIS_PRESET_STRATEGIES.concise.promptVersion,
      }),
    })

    const first = await conciseHarness.controller.runExecutionTask(conciseRequest)
    const second = await detailedHarness.controller.runExecutionTask(detailedRequest)

    expect(conciseHarness.calls.runAnalysis[0]?.preset?.id).toBe("concise")
    expect(detailedHarness.calls.runAnalysis[0]?.preset?.id).toBe("detailed")
    expect(conciseHarness.calls.getAnalysisCache[0]).not.toBe(
      detailedHarness.calls.getAnalysisCache[0],
    )
    if (first.kind !== "completed" || second.kind !== "completed") {
      throw new Error("expected completed runs")
    }
    expect(first.publication.analysisPromptVersion).not.toBe(second.publication.analysisPromptVersion)
  })
})
