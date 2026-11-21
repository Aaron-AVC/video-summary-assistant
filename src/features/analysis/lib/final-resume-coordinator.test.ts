import { describe, expect, it } from "bun:test"

import { DEFAULT_ANALYSIS_BUDGET_POLICY } from "@/features/analysis/lib/analysis-budget"
import {
  createAnalysisPresetSnapshot,
} from "@/features/analysis/lib/analysis-preset"
import {
  VIDEO_ANALYSIS_PROMPT_VERSION,
  VIDEO_ANALYSIS_SCHEMA_VERSION,
  type VideoAnalysis,
} from "@/features/analysis/lib/analysis-schema"
import type { AnalysisTaskSnapshot } from "@/features/analysis/lib/analysis-task-controller"
import {
  createFinalResumeCheckpointController,
  FINAL_CHECKPOINT_PLANNING_VERSION,
  FINAL_CHECKPOINT_TTL_MS,
  type FinalCheckpointContext,
  type FinalResumeCheckpointController,
} from "@/features/analysis/lib/final-resume-checkpoint"
import { OpenAICompatibleClientError } from "@/features/analysis/lib/openai-compatible-client"
import type { AnalysisPrompt } from "@/features/analysis/lib/prompts"
import { AnalysisAbortedError } from "@/features/analysis/lib/structured-analysis"
import type { VideoInfo, VideoTranscript } from "@/features/platform/types"
import type { TranscriptCue } from "@/features/transcript/lib/transcript-schema"
import { computeTranscriptFingerprint } from "@/lib/persistence/cache-identity"
import type { AnalysisCacheEntity } from "@/lib/schemas/persistence"

import {
  createFinalResumeCoordinator,
  type FinalResumeCoordinatorDependencies,
  type FinalResumeProvider,
  type FinalResumeRequest,
} from "./final-resume-coordinator"

const CONTENT_KEY = "youtube:video-resume"
const PROVIDER_ID = "profile-resume"
const BASE_URL = "https://api.example.com/v1"
const MODEL = "resume-model"
const TIMEOUT_SEC = 120
const CREDENTIAL_REVISION = "credential-revision-1"
const SOURCE_TAB_ID = 41
const ORIGINAL_TASK_ID = "task-original"
const RESUME_TASK_ID = "task-resume-2"
const ORIGINAL_EPOCH = 7
const RESUME_EPOCH = 19
/** Deliberately different from the coordinator's `now()` completion timestamp. */
const CAPTURED_AT = "2026-01-01T00:19:59.000Z"

const cues: TranscriptCue[] = [
  { startSec: 0, endSec: 10, text: "First cue." },
  { startSec: 10, endSec: 20, text: "Second cue." },
]

const finalPrompt: AnalysisPrompt = {
  systemPrompt: "You are a structured video analyst.",
  userPrompt: "Summarize the partial analyses.",
}

const transientFailure = new OpenAICompatibleClientError("temporary upstream", {
  kind: "http",
  status: 502,
})

function analysisFixture(): VideoAnalysis {
  return {
    summary: "Resumed summary.",
    keyPoints: [{ text: "Resumed point.", startSec: 0, endSec: 10 }],
    chapters: [{
      title: "Chapter",
      startSec: 0,
      endSec: 20,
      summary: "Chapter summary.",
      detail: "Chapter detail.",
    }],
  }
}

function taskSnapshotFixture(overrides: Partial<AnalysisTaskSnapshot> = {}): AnalysisTaskSnapshot {
  return {
    taskId: ORIGINAL_TASK_ID,
    sourceTabId: SOURCE_TAB_ID,
    platform: "youtube",
    videoId: "video-resume",
    partId: null,
    contentKey: CONTENT_KEY,
    title: "Original Title",
    author: "Author",
    canonicalUrl: "https://www.youtube.com/watch?v=video-resume",
    providerProfileId: PROVIDER_ID,
    providerBaseUrl: BASE_URL,
    providerModel: MODEL,
    generationTimeoutSec: TIMEOUT_SEC,
    analysisPresetId: "standard",
    analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
    startedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function sourceVideoFixture(overrides: Partial<VideoInfo> = {}): VideoInfo {
  return {
    platform: "youtube",
    videoId: "video-resume",
    partId: null,
    contentKey: CONTENT_KEY,
    title: "Original Title",
    author: "Author",
    durationSec: 20,
    thumbnailUrl: null,
    canonicalUrl: "https://www.youtube.com/watch?v=video-resume",
    ...overrides,
  }
}

function transcriptFixture(): VideoTranscript {
  return {
    segments: cues.map((cue) => ({ ...cue })),
    language: "en",
    source: "manual",
    raw: { format: "vtt", text: "WEBVTT\n", sourceUrl: null },
  }
}

async function checkpointContext(): Promise<FinalCheckpointContext> {
  return {
    source: {
      taskId: ORIGINAL_TASK_ID,
      workspaceEpoch: ORIGINAL_EPOCH,
      sourceTabId: SOURCE_TAB_ID,
      platform: "youtube",
      videoId: "video-resume",
      partId: null,
      contentKey: CONTENT_KEY,
      title: "Original Title",
      durationSec: 20,
    },
    transcript: {
      fingerprint: await computeTranscriptFingerprint(cues),
      cues,
    },
    provider: {
      profileId: PROVIDER_ID,
      baseUrl: BASE_URL,
      model: MODEL,
      timeoutMs: TIMEOUT_SEC * 1000,
      credentialRevision: CREDENTIAL_REVISION,
    },
    preset: createAnalysisPresetSnapshot("standard"),
    schemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
    planningVersion: FINAL_CHECKPOINT_PLANNING_VERSION,
    budgetPolicy: { ...DEFAULT_ANALYSIS_BUDGET_POLICY },
  }
}

const providerFixture: FinalResumeProvider = {
  apiKey: "sk-fixture-never-real",
  credentialRevision: CREDENTIAL_REVISION,
  profileUpdatedAt: "2026-01-01T00:00:00.000Z",
  profileBaseUrl: BASE_URL,
  profileModel: MODEL,
  profileGenerationTimeoutSec: TIMEOUT_SEC,
}

type Harness = {
  controller: FinalResumeCheckpointController
  calls: string[]
  saveCalls: string[]
  finalOnlyInputs: Array<Record<string, unknown>>
  request: FinalResumeRequest
  dependencies: FinalResumeCoordinatorDependencies
}

async function publishAvailableCheckpoint(
  controller: FinalResumeCheckpointController = createFinalResumeCheckpointController(),
): Promise<FinalResumeCheckpointController> {
  const context = await checkpointContext()
  const attempt = await controller.beginCandidate({
    context,
    execution: {
      strategy: "map-reduce",
      videoId: "video-resume",
      initialChunkCount: 2,
      reductionLevels: 0,
      mapPlan: [
        { id: "chunk-1", index: 0, startSec: 0, endSec: 10, cueStartIndex: 0, cueEndIndex: 1 },
        { id: "chunk-2", index: 1, startSec: 10, endSec: 20, cueStartIndex: 1, cueEndIndex: 2 },
      ],
      chunkSummaries: [
        { chunkId: "chunk-1", startSec: 0, endSec: 10, summary: "Mapped block one." },
        { chunkId: "chunk-2", startSec: 10, endSec: 20, summary: "Mapped block two." },
      ],
      finalInputSummaries: [
        { chunkId: "chunk-1", startSec: 0, endSec: 10, summary: "Mapped block one." },
        { chunkId: "chunk-2", startSec: 10, endSec: 20, summary: "Mapped block two." },
      ],
      finalInputMapChunkIds: [["chunk-1"], ["chunk-2"]],
      finalPrompt,
    },
  })
  if (!attempt) throw new Error("fixture candidate was rejected")
  if (!await attempt.validate()) throw new Error("fixture candidate failed validation")
  if (!await attempt.promoteFinalFailure(transientFailure)) {
    throw new Error("fixture candidate was not published")
  }
  if (controller.getMetadata().state !== "available") {
    throw new Error("fixture checkpoint is not available")
  }
  return controller
}

async function createHarness(
  overrides: Partial<FinalResumeCoordinatorDependencies> = {},
  controller: FinalResumeCheckpointController = createFinalResumeCheckpointController(),
): Promise<Harness> {
  await publishAvailableCheckpoint(controller)
  const calls: string[] = []
  const saveCalls: string[] = []
  const finalOnlyInputs: Array<Record<string, unknown>> = []

  const dependencies: FinalResumeCoordinatorDependencies = {
    readLiveSource: async () => ({
      taskSnapshot: taskSnapshotFixture({ taskId: RESUME_TASK_ID }),
      sourceVideo: sourceVideoFixture(),
      workspaceEpoch: RESUME_EPOCH,
    }),
    loadTranscript: async () => ({
      transcript: transcriptFixture(),
      fingerprint: await computeTranscriptFingerprint(cues),
      capturedAt: CAPTURED_AT,
    }),
    resolveProvider: async () => providerFixture,
    getAnalysisCache: async () => null,
    runFinalOnlyAnalysis: async (input) => {
      calls.push("final")
      finalOnlyInputs.push(input as unknown as Record<string, unknown>)
      return { analysis: analysisFixture(), repairAttempted: false, rawResponse: "{}" }
    },
    persistCompletedAnalysis: async () => {
      saveCalls.push("persist")
      return { analysisRunId: "run-resumed" }
    },
    now: () => "2026-01-01T00:30:00.000Z",
    randomUUID: () => "generated-id",
    ...overrides,
  }

  const request: FinalResumeRequest = {
    taskSnapshot: taskSnapshotFixture({ taskId: RESUME_TASK_ID, startedAt: "2026-01-01T00:20:00.000Z" }),
    workspaceEpoch: RESUME_EPOCH,
    signal: new AbortController().signal,
    setPhase: () => {},
    ensureTaskCurrent: () => {},
    checkpoint: controller,
    checkpointMetadata: () => controller.getMetadata(),
  }

  return { controller, calls, saveCalls, finalOnlyInputs, request, dependencies }
}

function coordinatorFor(harness: Harness) {
  return createFinalResumeCoordinator(harness.dependencies)
}

describe("final resume coordinator", () => {
  it("runs only the Final stage under the new task and publishes a completed analysis", async () => {
    const harness = await createHarness()

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(result.kind).toBe("completed")
    expect(harness.calls).toEqual(["final"])
    expect(harness.saveCalls).toEqual(["persist"])
    expect(harness.finalOnlyInputs[0]!.execution).toEqual({
      strategy: "map-reduce",
      initialChunkCount: 2,
      reductionLevels: 0,
      chunkSummaries: [
        { chunkId: "chunk-1", startSec: 0, endSec: 10, summary: "Mapped block one." },
        { chunkId: "chunk-2", startSec: 10, endSec: 20, summary: "Mapped block two." },
      ],
      finalPrompt,
    })
    expect(harness.controller.getMetadata().state).toBe("empty")
    if (result.kind === "completed") {
      expect(result.publication.analysisRunId).toBe("run-resumed")
      expect(result.publication.contentKey).toBe(CONTENT_KEY)
    }
  })

  it("keeps the checkpoint source task while the resume runs under the new task id", async () => {
    const harness = await createHarness()

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(harness.request.taskSnapshot.taskId).toBe(RESUME_TASK_ID)
    expect(result.kind).toBe("completed")
    expect(harness.calls).toEqual(["final"])
  })

  it("issues zero model requests when the live source identity changed", async () => {
    const harness = await createHarness({
      readLiveSource: async () => ({
        taskSnapshot: taskSnapshotFixture({ taskId: RESUME_TASK_ID, contentKey: "youtube:other" }),
        sourceVideo: sourceVideoFixture({ contentKey: "youtube:other", videoId: "video-other" }),
        workspaceEpoch: RESUME_EPOCH,
      }),
    })

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(result.kind).toBe("identity-mismatch")
    expect(harness.calls).toEqual([])
    expect(harness.saveCalls).toEqual([])
  })

  it("issues zero model requests when the Bilibili part changed", async () => {
    const harness = await createHarness({
      readLiveSource: async () => ({
        taskSnapshot: taskSnapshotFixture({ taskId: RESUME_TASK_ID, partId: "2" }),
        sourceVideo: sourceVideoFixture({ partId: "2" }),
        workspaceEpoch: RESUME_EPOCH,
      }),
    })

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(result.kind).toBe("identity-mismatch")
    expect(harness.calls).toEqual([])
  })

  it("issues zero model requests when the credential revision changed", async () => {
    const harness = await createHarness({
      resolveProvider: async () => ({ ...providerFixture, credentialRevision: "credential-revision-2" }),
    })

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(result.kind).toBe("identity-mismatch")
    expect(harness.calls).toEqual([])
  })

  it("issues zero model requests when the provider endpoint or model changed", async () => {
    for (const changed of [{ profileModel: "other-model" }, { profileBaseUrl: "https://other.example.com/v1" }]) {
      const harness = await createHarness({
        resolveProvider: async () => ({ ...providerFixture, ...changed }),
      })
      const result = await coordinatorFor(harness).resume(harness.request)
      expect(result.kind).toBe("identity-mismatch")
      expect(harness.calls).toEqual([])
    }
  })

  it("issues zero model requests when the transcript fingerprint changed", async () => {
    const harness = await createHarness({
      loadTranscript: async () => ({
        transcript: transcriptFixture(),
        fingerprint: "changed-fingerprint",
        capturedAt: CAPTURED_AT,
      }),
    })

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(result.kind).toBe("identity-mismatch")
    expect(harness.calls).toEqual([])
  })

  it("issues zero model requests when the preset changed", async () => {
    const harness = await createHarness()

    const result = await coordinatorFor(harness).resume({
      ...harness.request,
      taskSnapshot: { ...harness.request.taskSnapshot, analysisPresetId: "concise" },
    })

    expect(result.kind).toBe("identity-mismatch")
    expect(harness.calls).toEqual([])
  })

  it("uses an exact completed cache hit without any model request", async () => {
    const cached: AnalysisCacheEntity = {
      cacheKey: "cache-key",
      contentKey: CONTENT_KEY,
      platform: "youtube",
      videoId: "video-resume",
      partId: null,
      transcriptFingerprint: await computeTranscriptFingerprint(cues),
      analysisSchemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
      analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
      providerProfileId: PROVIDER_ID,
      providerBaseUrl: BASE_URL,
      providerModel: MODEL,
      analysisRunId: null,
      analysis: analysisFixture(),
      createdAt: "2025-12-31T00:00:00.000Z",
      updatedAt: "2025-12-31T00:00:00.000Z",
    }
    const harness = await createHarness({ getAnalysisCache: async () => cached })

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(result.kind).toBe("cached")
    expect(harness.calls).toEqual([])
    expect(harness.saveCalls).toEqual([])
    expect(harness.controller.getMetadata().state).toBe("empty")
    if (result.kind === "cached") expect(result.publication.analysisRunId).toBeNull()
  })

  it("refuses a second concurrent resume while the first lease is held", async () => {
    let releaseFirst: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let requests = 0
    const harness = await createHarness({
      runFinalOnlyAnalysis: async () => {
        requests += 1
        await gate
        return { analysis: analysisFixture(), repairAttempted: false, rawResponse: "{}" }
      },
    })
    const coordinator = coordinatorFor(harness)

    const first = coordinator.resume(harness.request)
    // Let the first resume reach the held lease before the second click lands.
    await new Promise((resolve) => setTimeout(resolve, 0))
    const second = await coordinator.resume(harness.request)
    releaseFirst!()
    const firstResult = await first

    expect(firstResult.kind).toBe("completed")
    expect(second.kind).toMatch(/lease-unavailable|unavailable/)
    expect(requests).toBe(1)
  })

  it("reports a persistence failure separately from a provider failure", async () => {
    const harness = await createHarness({
      persistCompletedAnalysis: async () => {
        throw new Error("IndexedDB write failed")
      },
    })

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(result.kind).toBe("persistence-failed")
    expect(harness.calls).toEqual(["final"])
    expect(harness.controller.getMetadata().state).toBe("empty")
  })

  it("treats a second transient Final failure as eligible for another manual resume", async () => {
    const harness = await createHarness({
      runFinalOnlyAnalysis: async () => {
        harness.calls.push("final")
        throw transientFailure
      },
    })

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(result.kind).toBe("final-retryable")
    expect(harness.calls).toEqual(["final"])
    expect(harness.controller.getMetadata().state).toBe("available")
  })

  it("discards the checkpoint when the resumed Final returned an unusable structure", async () => {
    const harness = await createHarness({
      runFinalOnlyAnalysis: async (input) => {
        harness.calls.push("final")
        input.onFinalResponseReceived?.()
        throw new Error("Provider returned invalid structured video analysis after one repair attempt.")
      },
    })

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(result.kind).toBe("structured-output-failed")
    expect(harness.calls).toEqual(["final"])
    expect(harness.controller.getMetadata().state).toBe("empty")
  })

  it("discards the checkpoint when Repair fails with HTTP 503 after the Final response", async () => {
    let responseReceived = false
    const harness = await createHarness({
      runFinalOnlyAnalysis: async (input) => {
        harness.calls.push("final")
        input.onFinalResponseReceived?.()
        responseReceived = true
        throw new OpenAICompatibleClientError("Repair upstream unavailable", {
          kind: "http",
          status: 503,
        })
      },
    })

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(responseReceived).toBe(true)
    expect(result).toEqual({
      kind: "structured-output-failed",
      error: new OpenAICompatibleClientError("Repair upstream unavailable", {
        kind: "http",
        status: 503,
      }),
    })
    expect(harness.calls).toEqual(["final"])
    expect(harness.saveCalls).toEqual([])
    expect(harness.controller.getMetadata().state).toBe("empty")
    const secondAttempt = await coordinatorFor(harness).resume(harness.request)
    expect(secondAttempt.kind).toBe("unavailable")
    expect(harness.calls).toEqual(["final"])
    expect(harness.saveCalls).toEqual([])
  })

  it("discards the checkpoint on non-retryable provider failures", async () => {
    const harness = await createHarness({
      runFinalOnlyAnalysis: async () => {
        harness.calls.push("final")
        throw new OpenAICompatibleClientError("unauthorized", { kind: "http", status: 401 })
      },
    })

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(result.kind).toBe("fatal-failure")
    expect(harness.controller.getMetadata().state).toBe("empty")
  })

  it("discards everything and reports cancellation without persisting", async () => {
    const harness = await createHarness({
      runFinalOnlyAnalysis: async () => {
        harness.calls.push("final")
        throw new AnalysisAbortedError()
      },
    })

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(result.kind).toBe("cancelled")
    expect(harness.saveCalls).toEqual([])
    expect(harness.controller.getMetadata().state).toBe("empty")
  })

  it("fails closed without a model request when the live task is no longer admitted", async () => {
    const harness = await createHarness()

    const result = await coordinatorFor(harness).resume({
      ...harness.request,
      ensureTaskCurrent: () => {
        throw new Error("Analysis task is no longer active.")
      },
    })

    expect(result.kind).toBe("execution-superseded")
    expect(harness.calls).toEqual([])
  })

  it("fails closed without a model request when the checkpoint is unavailable", async () => {
    const harness = await createHarness()
    harness.controller.invalidate("test-invalidated")

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(result.kind).toBe("unavailable")
    expect(harness.calls).toEqual([])
  })
})

function cacheEntityFixture(overrides: Partial<AnalysisCacheEntity> = {}): AnalysisCacheEntity {
  return {
    cacheKey: "cache-key",
    contentKey: CONTENT_KEY,
    platform: "youtube",
    videoId: "video-resume",
    partId: null,
    transcriptFingerprint: "",
    analysisSchemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
    analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
    providerProfileId: PROVIDER_ID,
    providerBaseUrl: BASE_URL,
    providerModel: MODEL,
    analysisRunId: null,
    analysis: analysisFixture(),
    createdAt: "2025-12-31T00:00:00.000Z",
    updatedAt: "2025-12-31T00:00:00.000Z",
    ...overrides,
  }
}

function parseDeferred() {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return { gate, release }
}

describe("final resume coordinator F-03: the lease precedes the cache fast path", () => {
  it("F-03-a refuses a cached safety net owned by another checkpoint (no publication, zero model calls)", async () => {
    const fingerprint = await computeTranscriptFingerprint(cues)
    const harness = await createHarness({
      // The live request now points at video B while the available checkpoint
      // still belongs to video A.
      readLiveSource: async () => ({
        taskSnapshot: taskSnapshotFixture({
          taskId: RESUME_TASK_ID,
          contentKey: "youtube:video-other",
          videoId: "video-other",
        }),
        sourceVideo: sourceVideoFixture({
          contentKey: "youtube:video-other",
          videoId: "video-other",
        }),
        workspaceEpoch: RESUME_EPOCH,
      }),
      // ... and a perfectly matching cache row exists for B.
      getAnalysisCache: async () => cacheEntityFixture({
        contentKey: "youtube:video-other",
        videoId: "video-other",
        transcriptFingerprint: fingerprint,
      }),
    })

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(result.kind).toBe("identity-mismatch")
    expect(harness.calls).toEqual([])
    expect(harness.saveCalls).toEqual([])
    // The mismatched checkpoint must not be rewritten as a cache settlement.
    expect(harness.controller.getMetadata().invalidationReason).not.toBe("cache-satisfied")
    expect(harness.controller.getMetadata().state).not.toBe("leased")
  })

  it("F-03-b reports expired instead of publishing a matching cache for an expired checkpoint", async () => {
    let clock = Date.parse("2026-01-01T00:00:00.000Z")
    const controller = createFinalResumeCheckpointController({ now: () => clock })
    const fingerprint = await computeTranscriptFingerprint(cues)
    const harness = await createHarness({
      getAnalysisCache: async () => cacheEntityFixture({ transcriptFingerprint: fingerprint }),
    }, controller)

    // Push the checkpoint past its 30 minute TTL before the resume runs.
    clock += FINAL_CHECKPOINT_TTL_MS + 1

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(result.kind).toBe("expired")
    expect(harness.calls).toEqual([])
    expect(harness.saveCalls).toEqual([])
    expect(harness.controller.getMetadata().state).not.toBe("available")
  })

  it("F-03-c publishes an exact cache hit, makes zero model requests and destroys the checkpoint", async () => {
    const fingerprint = await computeTranscriptFingerprint(cues)
    const harness = await createHarness({
      getAnalysisCache: async () => cacheEntityFixture({ transcriptFingerprint: fingerprint }),
    })

    // The cache fast path is only legitimate after the single lease proved the
    // checkpoint belongs to this live request; record that it really happened.
    let acquisitions = 0
    const acquireForResume = harness.controller.acquireForResume.bind(harness.controller)
    harness.controller.acquireForResume = async (resumeRequest) => {
      acquisitions += 1
      return acquireForResume(resumeRequest)
    }

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(acquisitions).toBe(1)
    expect(result.kind).toBe("cached")
    expect(harness.calls).toEqual([])
    expect(harness.saveCalls).toEqual([])
    // A cache hit ends the resume opportunity: the checkpoint must be gone, not
    // just released back into a clickable "available" state.
    expect(harness.controller.getMetadata().state).not.toBe("available")
    if (result.kind === "cached") {
      expect(result.publication.analysisRunId).toBeNull()
      expect(result.publication.analysis).toEqual(analysisFixture())
    }
  })
})

describe("final resume coordinator F-04: credentials are re-verified before use", () => {
  it("F-04-a aborts before the Final request when the provider rotated during the cache lookup", async () => {
    const providerState: { current: FinalResumeProvider } = { current: { ...providerFixture } }
    const harness = await createHarness({
      resolveProvider: async () => ({ ...providerState.current }),
      // Pause deterministically at the asynchronous cache lookup, rotate the
      // stored credential (model/endpoint/key/revision) before the storage
      // invalidation notification could ever fire, then let the resume go.
      getAnalysisCache: async () => {
        providerState.current = {
          ...providerState.current,
          apiKey: "sk-rotated-key",
          credentialRevision: "credential-revision-2",
          profileBaseUrl: "https://rotated.example.com/v1",
          profileModel: "rotated-model",
        }
        return null
      },
    })

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(result.kind).toBe("identity-mismatch")
    expect(harness.calls).toEqual([])
    expect(harness.saveCalls).toEqual([])
    expect(harness.controller.getMetadata().state).not.toBe("available")
  })

  it("F-04-b refuses to persist when the credential revision rotates after the Final request", async () => {
    const providerState: { current: FinalResumeProvider } = { current: { ...providerFixture } }
    const harness = await createHarness({
      resolveProvider: async () => ({ ...providerState.current }),
      runFinalOnlyAnalysis: async () => {
        harness.calls.push("final")
        // Rotate the stored credential while the resumed Final is finishing,
        // i.e. after the response but before the completion write.
        providerState.current = {
          ...providerState.current,
          credentialRevision: "credential-revision-2",
        }
        return { analysis: analysisFixture(), repairAttempted: false, rawResponse: "{}" }
      },
    })

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(result.kind).toBe("identity-mismatch")
    expect(harness.calls).toEqual(["final"])
    expect(harness.saveCalls).toEqual([])
    expect(harness.controller.getMetadata().state).not.toBe("available")
  })
})

describe("final resume coordinator F-01: the live source is re-captured, not just re-checked", () => {
  it("re-reads the live source, transcript and provider before the Final request and before persistence", async () => {
    let liveReads = 0
    let transcriptLoads = 0
    let providerReads = 0
    const harness = await createHarness({
      readLiveSource: async () => {
        liveReads += 1
        return {
          taskSnapshot: taskSnapshotFixture({ taskId: RESUME_TASK_ID }),
          sourceVideo: sourceVideoFixture(),
          workspaceEpoch: RESUME_EPOCH,
        }
      },
      loadTranscript: async () => {
        transcriptLoads += 1
        return {
          transcript: transcriptFixture(),
          fingerprint: await computeTranscriptFingerprint(cues),
          capturedAt: CAPTURED_AT,
        }
      },
      resolveProvider: async () => {
        providerReads += 1
        return { ...providerFixture }
      },
    })

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(result.kind).toBe("completed")
    // Admission, pre-Final and pre-persistence: a real re-capture each time.
    expect(liveReads).toBe(3)
    expect(transcriptLoads).toBe(3)
    expect(providerReads).toBe(3)
  })

  it("fails closed with zero model requests when the live transcript changes after admission", async () => {
    let loads = 0
    const harness = await createHarness({
      loadTranscript: async () => {
        loads += 1
        // The second (pre-Final) capture sees a different transcript.
        return {
          transcript: transcriptFixture(),
          fingerprint: loads === 1
            ? await computeTranscriptFingerprint(cues)
            : "changed-fingerprint-after-admission",
          capturedAt: CAPTURED_AT,
        }
      },
    })

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(result.kind).toBe("identity-mismatch")
    expect(harness.calls).toEqual([])
    expect(harness.saveCalls).toEqual([])
  })
})

describe("M4 cancellation, supersession and TTL races", () => {
  it("expires during the cache lookup instead of publishing a stale cached result", async () => {
    let clock = Date.parse("2026-01-01T00:00:00.000Z")
    const controller = createFinalResumeCheckpointController({ now: () => clock })
    const fingerprint = await computeTranscriptFingerprint(cues)
    const cacheRead = parseDeferred()
    const harness = await createHarness({
      getAnalysisCache: async () => {
        clock += FINAL_CHECKPOINT_TTL_MS
        cacheRead.release()
        return cacheEntityFixture({ transcriptFingerprint: fingerprint })
      },
    }, controller)

    const result = await coordinatorFor(harness).resume(harness.request)
    await cacheRead.gate

    expect(result.kind).toBe("expired")
    expect(harness.calls).toEqual([])
    expect(harness.saveCalls).toEqual([])
    expect(harness.controller.getMetadata().state).toBe("empty")
  })

  it("does not publish a late successful Final after cancellation", async () => {
    const abort = new AbortController()
    const response = parseDeferred()
    const requestStarted = parseDeferred()
    const harness = await createHarness({
      runFinalOnlyAnalysis: async () => {
        harness.calls.push("final")
        requestStarted.release()
        // Deliberately model a provider that ignores AbortSignal and returns a
        // valid result after the user cancelled the request.
        await response.gate
        return { analysis: analysisFixture(), repairAttempted: false, rawResponse: "{}" }
      },
    })
    harness.request.signal = abort.signal
    const resume = coordinatorFor(harness).resume(harness.request)

    await requestStarted.gate
    abort.abort()
    response.release()
    const result = await resume

    expect(result.kind).toBe("cancelled")
    expect(harness.calls).toEqual(["final"])
    expect(harness.saveCalls).toEqual([])
    expect(harness.controller.getMetadata().state).toBe("empty")
  })

  it("does not publish a late successful Final after task supersession without an abort", async () => {
    const response = parseDeferred()
    const requestStarted = parseDeferred()
    let current = true
    const harness = await createHarness({
      runFinalOnlyAnalysis: async () => {
        harness.calls.push("final")
        requestStarted.release()
        await response.gate
        return { analysis: analysisFixture(), repairAttempted: false, rawResponse: "{}" }
      },
    })
    harness.request.ensureTaskCurrent = () => {
      if (!current) throw new Error("task was replaced")
    }
    const resume = coordinatorFor(harness).resume(harness.request)

    await requestStarted.gate
    current = false
    response.release()
    const result = await resume

    expect(result.kind).toBe("execution-superseded")
    expect(harness.calls).toEqual(["final"])
    expect(harness.saveCalls).toEqual([])
    expect(harness.controller.getMetadata().state).toBe("empty")
  })

  it("expires a retryable Final response while the provider request is in flight", async () => {
    let clock = Date.parse("2026-01-01T00:00:00.000Z")
    const controller = createFinalResumeCheckpointController({ now: () => clock })
    const harness = await createHarness({
      runFinalOnlyAnalysis: async () => {
        harness.calls.push("final")
        clock += FINAL_CHECKPOINT_TTL_MS
        throw transientFailure
      },
    }, controller)

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(result.kind).toBe("expired")
    expect(harness.calls).toEqual(["final"])
    expect(harness.saveCalls).toEqual([])
    expect(harness.controller.getMetadata().state).toBe("empty")
  })

  it.each([502, 503, 504])("keeps an in-flight HTTP %s retryable only while the original TTL is valid", async (status) => {
    const harness = await createHarness({
      runFinalOnlyAnalysis: async () => {
        harness.calls.push("final")
        throw new OpenAICompatibleClientError("temporary upstream", { kind: "http", status })
      },
    })

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(result.kind).toBe("final-retryable")
    expect(harness.calls).toEqual(["final"])
    expect(harness.saveCalls).toEqual([])
    expect(harness.controller.getMetadata().state).toBe("available")
  })
})

describe("M4 source and provider changes across real await boundaries", () => {
  it("does not resurrect YouTube A after the transcript read observes B then A", async () => {
    let currentVideo = sourceVideoFixture()
    const transcriptRead = parseDeferred()
    let loads = 0
    const harness = await createHarness({
      readLiveSource: async () => ({
        taskSnapshot: taskSnapshotFixture({ taskId: RESUME_TASK_ID }),
        sourceVideo: currentVideo,
        workspaceEpoch: RESUME_EPOCH,
      }),
      loadTranscript: async () => {
        loads += 1
        if (loads === 1) {
          currentVideo = sourceVideoFixture({ videoId: "video-b", contentKey: "youtube:video-b" })
          const changed = await checkpointContext()
          changed.source.videoId = "video-b"
          changed.source.contentKey = "youtube:video-b"
          await harness.controller.observeContext(changed)
          transcriptRead.release()
        }
        return {
          transcript: transcriptFixture(),
          fingerprint: await computeTranscriptFingerprint(cues),
          capturedAt: CAPTURED_AT,
        }
      },
    })
    const resume = coordinatorFor(harness).resume(harness.request)
    await transcriptRead.gate
    currentVideo = sourceVideoFixture()
    const result = await resume

    expect(result.kind).toMatch(/identity-mismatch|unavailable/)
    expect(harness.calls).toEqual([])
    expect(harness.saveCalls).toEqual([])
    expect(harness.controller.getMetadata().state).toBe("empty")
  })

  it("does not resurrect Bilibili P1 after the provider read observes P2 then P1", async () => {
    const originalContext = await checkpointContext()
    const controller = createFinalResumeCheckpointController()
    const p1Context: FinalCheckpointContext = {
      ...originalContext,
      source: {
        ...originalContext.source,
        platform: "bilibili",
        videoId: "BV1xx",
        partId: "1",
        contentKey: "bilibili:BV1xx:1",
      },
    }
    await publishAvailableCheckpoint(controller)
    const p1Candidate = await controller.beginCandidate({
      context: p1Context,
      execution: {
        strategy: "map-reduce",
        videoId: "BV1xx",
        initialChunkCount: 2,
        reductionLevels: 0,
        mapPlan: [
          { id: "chunk-1", index: 0, startSec: 0, endSec: 10, cueStartIndex: 0, cueEndIndex: 1 },
          { id: "chunk-2", index: 1, startSec: 10, endSec: 20, cueStartIndex: 1, cueEndIndex: 2 },
        ],
        chunkSummaries: [
          { chunkId: "chunk-1", startSec: 0, endSec: 10, summary: "P1 map one." },
          { chunkId: "chunk-2", startSec: 10, endSec: 20, summary: "P1 map two." },
        ],
        finalInputSummaries: [
          { chunkId: "chunk-1", startSec: 0, endSec: 10, summary: "P1 map one." },
          { chunkId: "chunk-2", startSec: 10, endSec: 20, summary: "P1 map two." },
        ],
        finalInputMapChunkIds: [["chunk-1"], ["chunk-2"]],
        finalPrompt,
      },
    })
    expect(p1Candidate).not.toBeNull()
    expect(await p1Candidate!.promoteFinalFailure(transientFailure)).toBe(true)
    // The fixture's original source is A; the lifecycle must observe P2 before
    // a later P1 recapture. This first mismatch invalidates the checkpoint.
    await controller.observeContext({
      ...p1Context,
      source: { ...p1Context.source, partId: "2", contentKey: "bilibili:BV1xx:2" },
    })
    const providerRead = parseDeferred()
    let reads = 0
    const harness = await createHarness({
      readLiveSource: async () => ({
        taskSnapshot: taskSnapshotFixture({
          taskId: RESUME_TASK_ID,
          platform: "bilibili",
          videoId: "BV1xx",
          partId: "1",
          contentKey: "bilibili:BV1xx:1",
        }),
        sourceVideo: sourceVideoFixture({
          platform: "bilibili",
          videoId: "BV1xx",
          partId: "1",
          contentKey: "bilibili:BV1xx:1",
        }),
        workspaceEpoch: RESUME_EPOCH,
      }),
      resolveProvider: async () => {
        reads += 1
        if (reads === 1) providerRead.release()
        return providerFixture
      },
    }, controller)
    harness.request.taskSnapshot = taskSnapshotFixture({
      taskId: RESUME_TASK_ID,
      platform: "bilibili",
      videoId: "BV1xx",
      partId: "1",
      contentKey: "bilibili:BV1xx:1",
    })
    const resume = coordinatorFor(harness).resume(harness.request)
    await providerRead.gate
    const result = await resume

    expect(result.kind).toMatch(/identity-mismatch|unavailable/)
    expect(harness.calls).toEqual([])
    expect(harness.saveCalls).toEqual([])
    expect(harness.controller.getMetadata().state).toBe("empty")
  })

  it.each([
    ["apiKey", { apiKey: "sk-rotated-never-real" }],
    ["credentialRevision", { credentialRevision: "credential-revision-2" }],
    ["model", { profileModel: "model-rotated" }],
    ["endpoint", { profileBaseUrl: "https://rotated.example.com/v1" }],
    ["timeout", { profileGenerationTimeoutSec: TIMEOUT_SEC + 1 }],
  ])("rejects a post-Final %s rotation before any persistence", async (_field, rotation) => {
    let current = { ...providerFixture }
    let reads = 0
    const harness = await createHarness({
      resolveProvider: async () => {
        reads += 1
        return { ...current }
      },
      runFinalOnlyAnalysis: async () => {
        harness.calls.push("final")
        current = { ...current, ...rotation }
        return { analysis: analysisFixture(), repairAttempted: false, rawResponse: "{}" }
      },
    })
    const result = await coordinatorFor(harness).resume(harness.request)

    expect(reads).toBe(3)

    expect(result.kind).toBe("identity-mismatch")
    expect(harness.calls).toEqual(["final"])
    expect(harness.saveCalls).toEqual([])
    expect(harness.controller.getMetadata().state).toBe("empty")
  })
})

describe("final resume coordinator transcript capture timestamp", () => {
  it("persists the real transcript acquisition time, not the save completion time", async () => {
    const persisted: Array<{ transcriptCapturedAt?: string, completedAt?: string }> = []
    const harness = await createHarness({
      loadTranscript: async () => ({
        transcript: transcriptFixture(),
        fingerprint: await computeTranscriptFingerprint(cues),
        capturedAt: CAPTURED_AT,
      }),
      persistCompletedAnalysis: async (input) => {
        persisted.push(input as unknown as { transcriptCapturedAt: string, completedAt: string })
        harness.saveCalls.push("persist")
        return { analysisRunId: "run-resumed" }
      },
    })

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(result.kind).toBe("completed")
    expect(persisted).toHaveLength(1)
    expect(persisted[0]!.transcriptCapturedAt).toBe(CAPTURED_AT)
    expect(persisted[0]!.completedAt).toBe("2026-01-01T00:30:00.000Z")
    expect(persisted[0]!.transcriptCapturedAt).not.toBe(persisted[0]!.completedAt)
  })

  it("persists the last real capture when the transcript is re-acquired before the write", async () => {
    let loads = 0
    const persisted: Array<{ transcriptCapturedAt?: string }> = []
    const harness = await createHarness({
      loadTranscript: async () => {
        loads += 1
        return {
          transcript: transcriptFixture(),
          fingerprint: await computeTranscriptFingerprint(cues),
          capturedAt: loads === 1 ? "2026-01-01T00:10:00.000Z" : "2026-01-01T00:29:00.000Z",
        }
      },
      persistCompletedAnalysis: async (input) => {
        persisted.push(input as unknown as { transcriptCapturedAt: string })
        return { analysisRunId: "run-resumed" }
      },
    })

    const result = await coordinatorFor(harness).resume(harness.request)

    expect(result.kind).toBe("completed")
    expect(persisted[0]!.transcriptCapturedAt).toBe("2026-01-01T00:29:00.000Z")
  })
})
