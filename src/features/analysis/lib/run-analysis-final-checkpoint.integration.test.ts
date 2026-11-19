import { describe, expect, it } from "bun:test"

import {
  finalAnalysisPromptFits,
  planReductionGroups,
  planTranscriptChunks,
  selectAnalysisStrategy,
} from "@/features/analysis/lib/analysis-plan"
import type { AnalysisBudgetPolicy } from "@/features/analysis/lib/analysis-budget"
import { createAnalysisPresetSnapshot } from "@/features/analysis/lib/analysis-preset"
import { VIDEO_ANALYSIS_SCHEMA_VERSION } from "@/features/analysis/lib/analysis-schema"
import { OpenAICompatibleClientError } from "@/features/analysis/lib/openai-compatible-client"
import {
  buildFinalAnalysisPrompt,
  type EvidenceSummary,
} from "@/features/analysis/lib/prompts"
import { runAnalysis } from "@/features/analysis/lib/run-analysis"
import type { TranscriptCue } from "@/features/transcript/lib/transcript-schema"
import { computeTranscriptFingerprint } from "@/lib/persistence/cache-identity"

import {
  createFinalResumeCheckpointController,
  FINAL_CHECKPOINT_PLANNING_VERSION,
  verifyFinalCheckpointRecord,
  type FinalCheckpointCandidateAttempt,
  type FinalCheckpointContext,
  type FinalCheckpointExecution,
} from "./final-resume-checkpoint"

const provider = {
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-test-placeholder",
  model: "test-model",
}

const finalFailure = new OpenAICompatibleClientError("temporary upstream", {
  kind: "http",
  status: 502,
})

type Call = {
  structured: boolean
  system: string
  user: string
}

type Scenario = ReturnType<typeof findScenario>
type HookFailure = "prepare" | "promote-after-publish" | null

function createClient(calls: Call[], scenario: Scenario) {
  return {
    provider,
    createChatCompletion: async ({ messages }: {
      messages: Array<{ role: string, content: string }>
    }) => {
      const promptText = messages.map((message) => message.content).join("\n")
      const call: Call = {
        structured: /JSON only|valid JSON object/i.test(promptText),
        system: messages[0]?.content ?? "",
        user: messages[1]?.content ?? "",
      }
      calls.push(call)
      if (call.structured) throw finalFailure
      return call.user.includes("Reduction level:") ? scenario.reducedSummary : scenario.mapSummary
    },
  }
}

async function checkpointContext(scenario: Scenario): Promise<FinalCheckpointContext> {
  return {
    source: {
      taskId: `task-${scenario.videoId}`,
      workspaceEpoch: 11,
      sourceTabId: 23,
      platform: "youtube",
      videoId: scenario.videoId,
      partId: null,
      contentKey: `youtube:${scenario.videoId}`,
      title: scenario.videoId,
      durationSec: scenario.cues.at(-1)!.endSec,
    },
    transcript: {
      fingerprint: await computeTranscriptFingerprint(scenario.cues),
      cues: scenario.cues,
    },
    provider: {
      profileId: "profile-integration",
      baseUrl: provider.baseUrl,
      model: provider.model,
      timeoutMs: 120_000,
      credentialRevision: "credential-revision-1",
    },
    preset: createAnalysisPresetSnapshot("standard"),
    schemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
    planningVersion: FINAL_CHECKPOINT_PLANNING_VERSION,
    budgetPolicy: { ...scenario.policy },
  }
}

async function runCheckpointScenario(scenario: Scenario, hookFailure: HookFailure = null) {
  const calls: Call[] = []
  const controller = createFinalResumeCheckpointController()
  const context = await checkpointContext(scenario)
  let attempt: FinalCheckpointCandidateAttempt | null = null
  let preparedCandidate: Omit<FinalCheckpointExecution, "videoId"> | null = null
  let prepareCalls = 0
  let promoteCalls = 0

  const error = await runAnalysis({
    provider,
    transcript: {
      videoId: scenario.videoId,
      title: scenario.videoId,
      cues: scenario.cues,
    },
    budgetPolicy: scenario.policy,
    client: createClient(calls, scenario) as never,
    finalCheckpoint: {
      prepareFinalCandidate: async (candidate) => {
        prepareCalls += 1
        preparedCandidate = candidate
        attempt = await controller.beginCandidate({
          context,
          execution: { videoId: scenario.videoId, ...candidate },
        })
        if (!attempt) return false
        if (hookFailure === "prepare") throw new Error("injected preparation failure")
        return attempt.validate()
      },
      promoteFinalFailure: async (failure) => {
        promoteCalls += 1
        if (!attempt) return false
        const published = await attempt.promoteFinalFailure(failure)
        if (hookFailure === "promote-after-publish") {
          throw new Error("injected post-publication failure")
        }
        return published
      },
      discardFinalCandidate: () => {
        attempt?.discard("test-discard")
        attempt = null
      },
    },
  }).then(
    () => null,
    (reason: unknown) => reason,
  )

  return {
    calls,
    context,
    controller,
    error,
    getAttempt: () => attempt,
    preparedCandidate,
    prepareCalls,
    promoteCalls,
  }
}

for (const expectedLevels of [1, 2] as const) {
  it(`publishes a real ${expectedLevels}-level Reduction checkpoint with intact Map and merged identities`, async () => {
    const scenario = findScenario(expectedLevels)
    const result = await runCheckpointScenario(scenario)

    expect(result.error).toBe(finalFailure)
    expect(result.prepareCalls).toBe(1)
    expect(result.promoteCalls).toBe(1)
    expect(result.controller.getMetadata()).toMatchObject({
      state: "available",
      failure: { kind: "http", status: 502 },
    })
    expect(result.calls.filter((call) => call.structured)).toHaveLength(1)
    for (let level = 1; level <= expectedLevels; level += 1) {
      expect(result.calls.some((call) => call.user.includes(`Reduction level: ${level}`))).toBe(true)
    }

    const attempt = result.getAttempt()
    expect(attempt).not.toBeNull()
    const record = attempt!.getRecordForVerification()
    expect(await verifyFinalCheckpointRecord(record)).toBe(true)
    expect(record.identity.initialChunkCount).toBe(scenario.chunkCount)
    expect(record.identity.reductionLevels).toBe(expectedLevels)
    expect(record.payload.mapPlan).toEqual(scenario.mapPlan)
    expect(record.payload.chunkSummaries).toEqual(scenario.chunkSummaries)
    expect(record.payload.chunkSummaries.every((summary) => summary.summary === scenario.mapSummary)).toBe(true)
    expect(record.payload.finalInputSummaries).toEqual(scenario.finalInputSummaries)
    expect(record.payload.finalInputMapChunkIds).toEqual(scenario.finalInputMapChunkIds)
    expect(record.payload.finalInputSummaries.length).toBeLessThan(record.payload.chunkSummaries.length)
    expect(record.payload.finalPrompt).toEqual(buildFinalAnalysisPrompt({
      videoTitle: scenario.videoId,
      chunkSummaries: scenario.finalInputSummaries,
      preset: createAnalysisPresetSnapshot("standard"),
    }))
    for (const summary of record.payload.finalInputSummaries) {
      expect(record.payload.finalPrompt.userPrompt).toContain(summary.chunkId)
      expect(record.payload.finalPrompt.userPrompt).toContain(summary.summary)
    }

    const callCountBeforeAcquire = result.calls.length
    const acquired = await result.controller.acquire(result.context)
    expect(acquired.kind).toBe("acquired")
    if (acquired.kind !== "acquired") throw new Error("expected the published checkpoint to be acquired")
    expect(acquired.lease.payload).toEqual(record.payload)
    expect(acquired.lease.identity).toEqual(record.identity)
    acquired.lease.release()

    const changedContext: FinalCheckpointContext = {
      ...result.context,
      provider: { ...result.context.provider, credentialRevision: "credential-revision-2" },
    }
    const mismatch = await result.controller.acquire(changedContext)
    expect(mismatch.kind).toBe("identity-mismatch")
    expect(result.controller.getMetadata().state).toBe("empty")
    expect(result.calls).toHaveLength(callCountBeforeAcquire)
  })
}

for (const expectedLevels of [1, 2] as const) {
  it(`publishes a real ${expectedLevels}-level Reduction checkpoint for overlapping and nested cues`, async () => {
    const scenario = findScenario(expectedLevels, { overlapping: true })
    const nestedIndex = scenario.mapPlan[0]!.cueEndIndex
    const outer = scenario.cues[nestedIndex - 1]!
    const nested = scenario.cues[nestedIndex]!
    expect(nested.startSec).toBeGreaterThan(outer.startSec)
    expect(nested.endSec).toBeLessThan(outer.endSec)
    expect(scenario.mapPlan[0]!.cueEndIndex).toBe(nestedIndex)
    expect(scenario.mapPlan[1]!.cueStartIndex).toBe(nestedIndex)

    const separatedExampleCues = longCues(4, 280)
    separatedExampleCues[0] = { ...separatedExampleCues[0]!, startSec: 0, endSec: 10 }
    separatedExampleCues[1] = { ...separatedExampleCues[1]!, startSec: 5, endSec: 9 }
    let separatedByBudget = false
    for (let inputBudget = 100; inputBudget <= 5_000 && !separatedByBudget; inputBudget += 5) {
      try {
        const chunks = planTranscriptChunks({ cues: separatedExampleCues, budgetPolicy: policyForInputBudget(inputBudget) })
        separatedByBudget = chunks[0]?.cues.length === 1 && chunks[1]?.cues.length === 1
      } catch {
        // Search the next budget.
      }
    }
    expect(separatedByBudget).toBe(true)

    const result = await runCheckpointScenario(scenario)
    expect(result.error).toBe(finalFailure)
    expect(result.preparedCandidate).toMatchObject({
      mapPlan: scenario.mapPlan,
      finalInputSummaries: scenario.finalInputSummaries,
      finalInputMapChunkIds: scenario.finalInputMapChunkIds,
    })
    expect(result.controller.getMetadata()).toMatchObject({
      state: "available",
      failure: { kind: "http", status: 502 },
    })
    const attempt = result.getAttempt()
    expect(attempt).not.toBeNull()
    const record = attempt!.getRecordForVerification()
    expect(await verifyFinalCheckpointRecord(record)).toBe(true)
    expect(record.payload.mapPlan).toEqual(scenario.mapPlan)
    expect(record.payload.finalInputMapChunkIds).toEqual(scenario.finalInputMapChunkIds)
    expect(record.payload.finalInputMapChunkIds.flat()).toEqual(scenario.mapPlan.map((chunk) => chunk.id))
    expect((await result.controller.acquire(result.context)).kind).toBe("acquired")
  })
}

it("fully invalidates the real candidate when asynchronous preparation throws", async () => {
  const scenario = findScenario(1)
  const result = await runCheckpointScenario(scenario, "prepare")

  expect(result.error).toBe(finalFailure)
  expect(result.prepareCalls).toBe(1)
  expect(result.promoteCalls).toBe(0)
  expect(result.calls.filter((call) => call.structured)).toHaveLength(1)
  expect(result.controller.getMetadata().state).toBe("empty")
  expect((await result.controller.acquire(result.context)).kind).toBe("unavailable")
})

it("fully invalidates even when a promotion hook throws after publishing", async () => {
  const scenario = findScenario(1)
  const result = await runCheckpointScenario(scenario, "promote-after-publish")

  expect(result.error).toBe(finalFailure)
  expect(result.prepareCalls).toBe(1)
  expect(result.promoteCalls).toBe(1)
  expect(result.controller.getMetadata().state).toBe("empty")
  expect((await result.controller.acquire(result.context)).kind).toBe("unavailable")
})

function longCues(count: number, textLength: number): TranscriptCue[] {
  return Array.from({ length: count }, (_, index) => ({
    startSec: index * 10,
    endSec: (index + 1) * 10,
    text: `${index} ${String.fromCharCode(97 + index % 26).repeat(textLength)}`,
  }))
}

function policyForInputBudget(inputBudget: number): AnalysisBudgetPolicy {
  return {
    contextWindowEstimateTokens: inputBudget + 510,
    reservedCompletionTokens: 10,
    reservedRepairTokens: 500,
  }
}

function findScenario(expectedLevels: 1 | 2, options: { overlapping?: boolean } = {}) {
  const baseCues = expectedLevels === 1 ? longCues(10, 280) : longCues(24, 300)
  const mapSummary = expectedLevels === 1 ? `map ${"m".repeat(260)}` : `map ${"m".repeat(300)}`
  const reducedSummary = expectedLevels === 1 ? "condensed reduction" : `reduced ${"r".repeat(180)}`
  const videoId = `reduction-${expectedLevels}-level${options.overlapping ? "-overlapping" : ""}`

  for (let inputBudget = 100; inputBudget <= 5_000; inputBudget += 5) {
    const policy = policyForInputBudget(inputBudget)
    const cues = baseCues.map((cue) => ({ ...cue }))
    try {
      if (selectAnalysisStrategy({ videoTitle: videoId, cues, budgetPolicy: policy }) !== "map-reduce") continue
      let chunks = planTranscriptChunks({ videoTitle: videoId, cues, budgetPolicy: policy })
      if (options.overlapping) {
        const nestedIndex = chunks[0]!.cues.length
        const outerIndex = nestedIndex - 1
        const outer = cues[outerIndex]!
        const nested = cues[nestedIndex]!
        cues[outerIndex] = { ...outer, endSec: nested.endSec }
        cues[nestedIndex] = { ...nested, startSec: outer.startSec + 5, endSec: nested.endSec - 1 }
        const replanned = planTranscriptChunks({ videoTitle: videoId, cues, budgetPolicy: policy })
        if (replanned.map((chunk) => chunk.cues.length).join(",") !== chunks.map((chunk) => chunk.cues.length).join(",")) continue
        chunks = replanned
      }
      let cueStartIndex = 0
      const mapPlan = chunks.map(({ id, index, startSec, endSec, cues: chunkCues }) => {
        const cueEndIndex = cueStartIndex + chunkCues.length
        const item = { id, index, startSec, endSec, cueStartIndex, cueEndIndex }
        cueStartIndex = cueEndIndex
        return item
      })
      const chunkSummaries: EvidenceSummary[] = chunks.map((chunk) => ({
        chunkId: chunk.id,
        startSec: chunk.startSec,
        endSec: chunk.endSec,
        summary: mapSummary,
      }))
      let finalInputSummaries: EvidenceSummary[] = chunkSummaries.map((summary) => ({ ...summary }))
      let finalInputMapChunkIds = chunks.map((chunk) => [chunk.id])
      let reductionLevels = 0
      while (!finalAnalysisPromptFits({ videoTitle: videoId, summaries: finalInputSummaries, budgetPolicy: policy })) {
        reductionLevels += 1
        if (reductionLevels > 8) throw new Error("test scenario did not converge")
        const groups = planReductionGroups({
          level: reductionLevels,
          summaries: finalInputSummaries,
          budgetPolicy: policy,
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
      if (reductionLevels !== expectedLevels || chunks.length < (expectedLevels === 1 ? 4 : 8)) continue
      return {
        videoId,
        cues,
        mapSummary,
        reducedSummary,
        policy,
        mapPlan,
        chunkSummaries,
        finalInputSummaries,
        finalInputMapChunkIds,
        chunkCount: chunks.length,
        reductionLevels,
      }
    } catch {
      // Search the next deterministic injected budget.
    }
  }
  throw new Error(`No deterministic ${expectedLevels}-level Reduction scenario found.`)
}
