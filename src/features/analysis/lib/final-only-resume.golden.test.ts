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
  type FinalCheckpointContext,
  type FinalResumeCheckpointController,
} from "@/features/analysis/lib/final-resume-checkpoint"
import { OpenAICompatibleClientError } from "@/features/analysis/lib/openai-compatible-client"
import {
  finalAnalysisPromptFits,
  planReductionGroups,
  planTranscriptChunks,
} from "@/features/analysis/lib/analysis-plan"
import { buildFinalAnalysisPrompt, type EvidenceSummary } from "@/features/analysis/lib/prompts"
import { runAnalysis } from "@/features/analysis/lib/run-analysis"
import { runFinalOnlyAnalysis } from "@/features/analysis/lib/run-final-only-analysis"
import type { FinalResumeCoordinatorDependencies } from "@/features/analysis/lib/final-resume-coordinator"
import { createFinalResumeCoordinator } from "@/features/analysis/lib/final-resume-coordinator"
import type { VideoInfo, VideoTranscript } from "@/features/platform/types"
import type { TranscriptCue } from "@/features/transcript/lib/transcript-schema"
import { computeTranscriptFingerprint } from "@/lib/persistence/cache-identity"

const CONTENT_KEY = "youtube:golden-video"
const VIDEO_ID = "golden-video"
const PROVIDER_ID = "profile-golden"
const BASE_URL = "https://api.example.com/v1"
const MODEL = "golden-model"
const CREDENTIAL_REVISION = "credential-revision-1"
const TIMEOUT_SEC = 120
const SOURCE_TAB_ID = 77
const ORIGINAL_TASK_ID = "task-golden-original"
const RESUME_TASK_ID = "task-golden-resume"

type RecordedCall = {
  kind: "map" | "reduction" | "final" | "repair"
  level?: number
}

const HTTP_502 = new OpenAICompatibleClientError("upstream unavailable", {
  kind: "http",
  status: 502,
})
const HTTP_503 = new OpenAICompatibleClientError("upstream unavailable", {
  kind: "http",
  status: 503,
})

function validAnalysisJson(): string {
  return JSON.stringify({
    summary: "Golden summary.",
    keyPoints: [{ text: "Golden point.", startSec: 0, endSec: 10 }],
    chapters: [{
      title: "Chapter One",
      startSec: 0,
      endSec: 10,
      summary: "Chapter one summary.",
      detail: "Chapter one detail.",
    }],
  })
}

function analysisFixture(): VideoAnalysis {
  return JSON.parse(validAnalysisJson()) as VideoAnalysis
}

function longCues(count: number, textLength: number): TranscriptCue[] {
  return Array.from({ length: count }, (_, index) => ({
    startSec: index * 10,
    endSec: (index + 1) * 10,
    text: `${index} ${String.fromCharCode(97 + index % 26).repeat(textLength)}`,
  }))
}

function policyForInputBudget(inputBudget: number) {
  return {
    contextWindowEstimateTokens: inputBudget + 510,
    reservedCompletionTokens: 10,
    reservedRepairTokens: 500,
  }
}

/**
 * Uses the real planner to find a deterministic budget where the video produces
 * exactly the requested number of Map chunks and Reduction levels. The loop
 * mirrors the M2 checkpoint integration fixture so both suites describe the same
 * production plan shapes.
 */
function findGoldenScenario(expectedLevels: 0 | 1 | 2, expectedChunks?: number) {
  const baseCues = expectedLevels === 0
    ? longCues(10, 300)
    : expectedLevels === 1 ? longCues(10, 280) : longCues(24, 300)
  const mapSummary = expectedLevels === 0
    ? "mk"
    : expectedLevels === 1 ? `map ${"m".repeat(260)}` : `map ${"m".repeat(300)}`

  const reducedSummary = expectedLevels === 0
    ? "rd"
    : expectedLevels === 1 ? "condensed reduction" : `reduced ${"r".repeat(180)}`

  for (let inputBudget = 100; inputBudget <= 6_000; inputBudget += 5) {
    const budgetPolicy = policyForInputBudget(inputBudget)
    const cues = baseCues.map((cue) => ({ ...cue }))
    try {
      let chunks = planTranscriptChunks({ videoTitle: VIDEO_ID, cues, budgetPolicy })
      const chunkSummaries: EvidenceSummary[] = chunks.map((chunk) => ({
        chunkId: chunk.id,
        startSec: chunk.startSec,
        endSec: chunk.endSec,
        summary: mapSummary,
      }))
      let finalInputSummaries: EvidenceSummary[] = chunkSummaries.map((summary) => ({ ...summary }))
      let finalInputMapChunkIds = chunks.map((chunk) => [chunk.id])
      let reductionLevels = 0
      while (!finalAnalysisPromptFits({
        videoTitle: VIDEO_ID,
        summaries: finalInputSummaries,
        budgetPolicy,
      })) {
        reductionLevels += 1
        if (reductionLevels > 8) throw new Error("did not converge")
        const groups = planReductionGroups({
          level: reductionLevels,
          summaries: finalInputSummaries,
          budgetPolicy,
        })
        let groupOffset = 0
        const nextSummaries: EvidenceSummary[] = []
        const nextCoverage: string[][] = []
        for (const [index, group] of groups.entries()) {
          const coverage = finalInputMapChunkIds.slice(groupOffset, groupOffset + group.length).flat()
          groupOffset += group.length
          nextCoverage.push(coverage)
          nextSummaries.push(group.length === 1 ? group[0]! : ({
            chunkId: `reduction-${reductionLevels}-${index + 1}`,
            startSec: Math.min(...group.map((node) => node.startSec)),
            endSec: Math.max(...group.map((node) => node.endSec)),
            summary: reducedSummary,
          }))
        }
        finalInputSummaries = nextSummaries
        finalInputMapChunkIds = nextCoverage
      }
      if (reductionLevels !== expectedLevels) continue
      if (expectedChunks !== undefined && chunks.length !== expectedChunks) continue
      if (expectedChunks === undefined && expectedLevels === 0 && chunks.length < 3) continue
      return {
        cues,
        budgetPolicy,
        chunkCount: chunks.length,
        expectedLevels: reductionLevels,
        mapSummary,
        reducedSummary,
      }
    } catch {
      // Search the next deterministic injected budget.
    }
  }
  throw new Error(`no deterministic scenario found for ${expectedLevels} Reduction levels`)
}

type GoldenHarness = {
  calls: RecordedCall[]
  controller: FinalResumeCheckpointController
  context: FinalCheckpointContext
  scenario: ReturnType<typeof findGoldenScenario>
  transcript: VideoTranscript
  sourceVideo: VideoInfo
}

async function runFirstFailPass(
  scenario: ReturnType<typeof findGoldenScenario>,
  controller: FinalResumeCheckpointController,
  options: { firstFinalError?: Error; reduceSummaries?: boolean } = {},
): Promise<GoldenHarness> {
  const calls: RecordedCall[] = []
  const firstFinalError = options.firstFinalError ?? HTTP_502
  const transcript: VideoTranscript = {
    segments: scenario.cues.map((cue) => ({ ...cue })),
    language: "en",
    source: "manual",
    raw: { format: "vtt", text: "WEBVTT\n", sourceUrl: null },
  }
  const sourceVideo: VideoInfo = {
    platform: "youtube",
    videoId: VIDEO_ID,
    partId: null,
    contentKey: CONTENT_KEY,
    title: "Golden Video",
    author: "Author",
    durationSec: scenario.cues.at(-1)!.endSec,
    thumbnailUrl: null,
    canonicalUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
  }
  const fingerprint = await computeTranscriptFingerprint(scenario.cues)

  let candidate: Parameters<FinalResumeCoordinatorDependencies["runFinalOnlyAnalysis"]>[0] | null = null
  let finalCalls = 0
  const client = {
    provider: { baseUrl: BASE_URL, apiKey: "sk-fixture-never-real", model: MODEL },
    createChatCompletion: async ({ messages }: { messages: Array<{ role: string, content: string }> }) => {
      const promptText = messages.map((message) => message.content).join("\n")
      const isStructured = /JSON only|valid JSON object/i.test(promptText)
      const reductionLevel = /Reduction level:\s*(\d+)/.exec(promptText)
      if (isStructured) {
        finalCalls += 1
        calls.push({ kind: "final" })
        if (finalCalls === 1) throw firstFinalError
        return validAnalysisJson()
      }
      if (reductionLevel) {
        calls.push({ kind: "reduction", level: Number(reductionLevel[1]) })
        return scenario.reducedSummary
      }
      calls.push({ kind: "map" })
      return scenario.mapSummary
    },
  }

  const context: FinalCheckpointContext = {
    source: {
      taskId: ORIGINAL_TASK_ID,
      workspaceEpoch: 5,
      sourceTabId: SOURCE_TAB_ID,
      platform: "youtube",
      videoId: VIDEO_ID,
      partId: null,
      contentKey: CONTENT_KEY,
      title: sourceVideo.title,
      durationSec: sourceVideo.durationSec,
    },
    transcript: { fingerprint, cues: scenario.cues },
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
    // Production checkpoint contexts capture the default budget policy; the
    // scenario budget only drives the injected planner limits.
    budgetPolicy: { ...DEFAULT_ANALYSIS_BUDGET_POLICY },
  }

  let attempt: Awaited<ReturnType<FinalResumeCheckpointController["beginCandidate"]>> = null
  const failure = await runAnalysis({
    provider: { baseUrl: BASE_URL, apiKey: "sk-fixture-never-real", model: MODEL, generationTimeoutSec: TIMEOUT_SEC },
    transcript: {
      videoId: VIDEO_ID,
      title: sourceVideo.title,
      cues: scenario.cues,
      durationSec: sourceVideo.durationSec,
    },
    budgetPolicy: scenario.budgetPolicy,
    client: client as never,
    finalCheckpoint: {
      prepareFinalCandidate: async (input) => {
        attempt = await controller.beginCandidate({
          context,
          execution: { videoId: VIDEO_ID, ...input },
        })
        if (!attempt) return false
        candidate = null
        return attempt.validate()
      },
      promoteFinalFailure: async (error) => (attempt ? attempt.promoteFinalFailure(error) : false),
      discardFinalCandidate: () => {
        attempt?.discard("final-response")
        attempt = null
      },
    },
  }).then(() => null, (reason: unknown) => reason)

  expect(failure).toBe(firstFinalError)
  expect(controller.getMetadata().state).toBe("available")
  expect(candidate).toBeNull()

  return { calls, controller, context, scenario, transcript, sourceVideo }
}

function resumeDependencies(harness: GoldenHarness, overrides: Partial<FinalResumeCoordinatorDependencies> = {}) {
  const resumeCalls: RecordedCall[] = []
  const dependencies: FinalResumeCoordinatorDependencies = {
    readLiveSource: async () => ({
      taskSnapshot: taskSnapshot(),
      sourceVideo: harness.sourceVideo,
      workspaceEpoch: 12,
    }),
    loadTranscript: async () => ({
      transcript: harness.transcript,
      fingerprint: await computeTranscriptFingerprint(harness.scenario.cues),
      capturedAt: "2026-01-01T00:19:59.000Z",
    }),
    resolveProvider: async () => ({
      apiKey: "sk-fixture-never-real",
      credentialRevision: CREDENTIAL_REVISION,
      profileUpdatedAt: "2026-01-01T00:00:00.000Z",
      profileBaseUrl: BASE_URL,
      profileModel: MODEL,
      profileGenerationTimeoutSec: TIMEOUT_SEC,
    }),
    getAnalysisCache: async () => null,
    runFinalOnlyAnalysis: async (input) => {
      resumeCalls.push({ kind: "final" })
      return runFinalOnlyAnalysis({
        ...input,
        client: {
          provider: { baseUrl: BASE_URL, apiKey: "sk-fixture-never-real", model: MODEL },
          createChatCompletion: async ({ messages }: { messages: Array<{ role: string, content: string }> }) => {
            const promptText = messages.map((message) => message.content).join("\n")
            if (/JSON only|valid JSON object/i.test(promptText)) {
              return validAnalysisJson()
            }
            throw new Error("resume must not request map or reduction prompts")
          },
        } as never,
      })
    },
    persistCompletedAnalysis: async () => ({ analysisRunId: "run-golden-resume" }),
    now: () => "2026-01-01T00:30:00.000Z",
    randomUUID: () => "golden-id",
    ...overrides,
  }
  return { dependencies, resumeCalls }
}

function taskSnapshot(): AnalysisTaskSnapshot {
  return {
    taskId: RESUME_TASK_ID,
    sourceTabId: SOURCE_TAB_ID,
    platform: "youtube",
    videoId: VIDEO_ID,
    partId: null,
    contentKey: CONTENT_KEY,
    title: "Golden Video",
    author: "Author",
    canonicalUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    providerProfileId: PROVIDER_ID,
    providerBaseUrl: BASE_URL,
    providerModel: MODEL,
    generationTimeoutSec: TIMEOUT_SEC,
    analysisPresetId: "standard",
    analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
    startedAt: "2026-01-01T00:20:00.000Z",
  }
}

describe("golden final-only resume flow", () => {
  it("runs 5 Map then one 502 Final, and the manual resume issues only one Final", async () => {
    const scenario = findGoldenScenario(0, 5)
    const controller = createFinalResumeCheckpointController()
    const harness = await runFirstFailPass(scenario, controller)

    expect(harness.calls.filter((call) => call.kind === "map")).toHaveLength(5)
    expect(harness.calls.filter((call) => call.kind === "reduction")).toHaveLength(0)
    expect(harness.calls.filter((call) => call.kind === "final")).toHaveLength(1)
    // No user click yet: nothing else may be requested.
    expect(harness.calls).toHaveLength(6)

    const { dependencies, resumeCalls } = resumeDependencies(harness)
    const coordinator = createFinalResumeCoordinator(dependencies)
    let persisted = 0
    dependencies.persistCompletedAnalysis = async () => {
      persisted += 1
      return { analysisRunId: "run-golden-resume" }
    }

    const result = await coordinator.resume({
      taskSnapshot: taskSnapshot(),
      workspaceEpoch: 12,
      signal: new AbortController().signal,
      setPhase: () => {},
      ensureTaskCurrent: () => {},
      checkpoint: controller,
      checkpointMetadata: () => controller.getMetadata(),
    })

    expect(result.kind).toBe("completed")
    expect(resumeCalls).toHaveLength(1)
    expect(persisted).toBe(1)
    expect(controller.getMetadata().state).toBe("empty")
    if (result.kind === "completed") {
      expect(result.publication.analysis.summary).toBe("Golden summary.")
      expect(result.publication.analysisRunId).toBe("run-golden-resume")
    }
  })

  it("resumes a one-level Reduction plan without repeating Map or Reduction", async () => {
    const scenario = findGoldenScenario(1)
    const controller = createFinalResumeCheckpointController()
    const harness = await runFirstFailPass(scenario, controller)

    const reductions = harness.calls.filter((call) => call.kind === "reduction")
    expect(reductions.length).toBeGreaterThan(0)
    expect(reductions.every((call) => call.level === 1)).toBe(true)
    const mapCount = harness.calls.filter((call) => call.kind === "map").length

    const { dependencies, resumeCalls } = resumeDependencies(harness)
    const result = await createFinalResumeCoordinator(dependencies).resume({
      taskSnapshot: taskSnapshot(),
      workspaceEpoch: 12,
      signal: new AbortController().signal,
      setPhase: () => {},
      ensureTaskCurrent: () => {},
      checkpoint: controller,
      checkpointMetadata: () => controller.getMetadata(),
    })

    expect(result.kind).toBe("completed")
    expect(resumeCalls).toHaveLength(1)
    expect(mapCount).toBe(harness.calls.filter((call) => call.kind === "map").length)
    expect(controller.getMetadata().state).toBe("empty")
  })

  it("resumes a two-level Reduction plan with only one Final request", async () => {
    const scenario = findGoldenScenario(2)
    const controller = createFinalResumeCheckpointController()
    const harness = await runFirstFailPass(scenario, controller)

    const reductions = harness.calls.filter((call) => call.kind === "reduction")
    expect(reductions.filter((call) => call.level === 1).length).toBeGreaterThan(0)
    expect(reductions.filter((call) => call.level === 2).length).toBeGreaterThan(0)
    const before = harness.calls.length

    const { dependencies, resumeCalls } = resumeDependencies(harness)
    const result = await createFinalResumeCoordinator(dependencies).resume({
      taskSnapshot: taskSnapshot(),
      workspaceEpoch: 12,
      signal: new AbortController().signal,
      setPhase: () => {},
      ensureTaskCurrent: () => {},
      checkpoint: controller,
      checkpointMetadata: () => controller.getMetadata(),
    })

    expect(result.kind).toBe("completed")
    expect(resumeCalls).toHaveLength(1)
    expect(harness.calls.length).toBe(before)
    expect(controller.getMetadata().state).toBe("empty")
  })

  it("requires a second explicit click when the resumed Final also fails transiently", async () => {
    const scenario = findGoldenScenario(0, 5)
    const controller = createFinalResumeCheckpointController()
    const harness = await runFirstFailPass(scenario, controller)

    const { dependencies, resumeCalls } = resumeDependencies(harness, {
      runFinalOnlyAnalysis: async () => {
        resumeCalls.push({ kind: "final" })
        throw HTTP_503
      },
    })

    const result = await createFinalResumeCoordinator(dependencies).resume({
      taskSnapshot: taskSnapshot(),
      workspaceEpoch: 12,
      signal: new AbortController().signal,
      setPhase: () => {},
      ensureTaskCurrent: () => {},
      checkpoint: controller,
      checkpointMetadata: () => controller.getMetadata(),
    })

    expect(result.kind).toBe("final-retryable")
    expect(resumeCalls).toHaveLength(1)
    expect(controller.getMetadata().state).toBe("available")
  })
})
