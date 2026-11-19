import { describe, expect, it } from "bun:test"

import { createAnalysisPresetSnapshot } from "@/features/analysis/lib/analysis-preset"
import { VIDEO_ANALYSIS_SCHEMA_VERSION } from "@/features/analysis/lib/analysis-schema"
import { OpenAICompatibleClientError } from "@/features/analysis/lib/openai-compatible-client"
import type { AnalysisPrompt } from "@/features/analysis/lib/prompts"
import type { TranscriptCue } from "@/features/transcript/lib/transcript-schema"
import { computeTranscriptFingerprint } from "@/lib/persistence/cache-identity"

import {
  createFinalResumeCheckpointController,
  FINAL_CHECKPOINT_PLANNING_VERSION,
  type FinalCheckpointContext,
  type FinalResumeCheckpointController,
} from "./final-resume-checkpoint"

const cues: TranscriptCue[] = [
  { startSec: 0, endSec: 10, text: "First cue." },
  { startSec: 10, endSec: 20, text: "Second cue." },
]

const finalPrompt: AnalysisPrompt = {
  systemPrompt: "You are a structured video analyst.",
  userPrompt: "Summarize the partial analyses.",
}

const temporaryFailure = new OpenAICompatibleClientError("temporary upstream", {
  kind: "http",
  status: 502,
})

const ORIGINAL_TASK_ID = "task-original"
const ORIGINAL_EPOCH = 7

async function publishedContext(
  overrides: Partial<FinalCheckpointContext> = {},
): Promise<FinalCheckpointContext> {
  const base: FinalCheckpointContext = {
    source: {
      taskId: ORIGINAL_TASK_ID,
      workspaceEpoch: ORIGINAL_EPOCH,
      sourceTabId: 41,
      platform: "youtube",
      videoId: "video-resume",
      partId: null,
      contentKey: "youtube:video-resume",
      title: "Resume Fixture",
      durationSec: 20,
    },
    transcript: {
      fingerprint: await computeTranscriptFingerprint(cues),
      cues,
    },
    provider: {
      profileId: "profile-resume",
      baseUrl: "https://api.example.com/v1",
      model: "resume-model",
      timeoutMs: 120_000,
      credentialRevision: "credential-revision-1",
    },
    preset: createAnalysisPresetSnapshot("standard"),
    schemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
    planningVersion: FINAL_CHECKPOINT_PLANNING_VERSION,
    budgetPolicy: { contextWindowEstimateTokens: 10_000, reservedCompletionTokens: 500, reservedRepairTokens: 500 },
  }
  return {
    ...base,
    ...overrides,
    source: { ...base.source, ...overrides.source },
    transcript: { ...base.transcript, ...overrides.transcript },
    provider: { ...base.provider, ...overrides.provider },
  }
}

async function publishAvailableCheckpoint(
  controller: FinalResumeCheckpointController = createFinalResumeCheckpointController(),
): Promise<{ controller: FinalResumeCheckpointController; context: FinalCheckpointContext }> {
  const context = await publishedContext()
  const attempt = await controller.beginCandidate({
    context,
    execution: {
      strategy: "map-reduce",
      videoId: "video-resume",
      initialChunkCount: 1,
      reductionLevels: 0,
      mapPlan: [
        { id: "chunk-1", index: 0, startSec: 0, endSec: 20, cueStartIndex: 0, cueEndIndex: 2 },
      ],
      chunkSummaries: [
        { chunkId: "chunk-1", startSec: 0, endSec: 20, summary: "Mapped the whole video." },
      ],
      finalInputSummaries: [
        { chunkId: "chunk-1", startSec: 0, endSec: 20, summary: "Mapped the whole video." },
      ],
      finalInputMapChunkIds: [["chunk-1"]],
      finalPrompt,
    },
  })
  if (!attempt) throw new Error("fixture checkpoint was rejected")
  if (!await attempt.validate()) throw new Error("fixture checkpoint failed validation")
  if (!await attempt.promoteFinalFailure(temporaryFailure)) {
    throw new Error("fixture checkpoint did not publish")
  }
  if (controller.getMetadata().state !== "available") {
    throw new Error("fixture checkpoint is not available")
  }
  return { controller, context }
}

/**
 * A live resume execution always has a brand-new task id and may have advanced
 * the workspace epoch. These fields describe the *current* execution, not the
 * original one that produced the checkpoint.
 */
async function resumeContext(
  overrides: Partial<FinalCheckpointContext["source"]> = {},
): Promise<FinalCheckpointContext> {
  const base = await publishedContext()
  return {
    ...base,
    source: {
      ...base.source,
      taskId: "task-resume-2",
      workspaceEpoch: 19,
      ...overrides,
    },
  }
}

describe("final resume double identity", () => {
  it("acquires a checkpoint from a new task and epoch while keeping the immutable source identity", async () => {
    const { controller } = await publishAvailableCheckpoint()
    const context = await resumeContext()
    expect(context.source.taskId).not.toBe(ORIGINAL_TASK_ID)
    expect(context.source.workspaceEpoch).not.toBe(ORIGINAL_EPOCH)

    const acquired = await controller.acquireForResume({
      context,
      isCurrentExecution: () => true,
    })

    expect(acquired.kind).toBe("acquired")
    if (acquired.kind !== "acquired") throw new Error("expected an acquired resume lease")
    expect(acquired.lease.identity.sourceTaskId).toBe(ORIGINAL_TASK_ID)
    expect(acquired.lease.identity.workspaceEpoch).toBe(ORIGINAL_EPOCH)
    acquired.lease.release()
    expect(controller.getMetadata().state).toBe("available")
  })

  it("still rejects a plain acquire from the new task so strict matching is not weakened", async () => {
    const { controller } = await publishAvailableCheckpoint()

    const acquired = await controller.acquire(await resumeContext())

    expect(acquired.kind).toBe("identity-mismatch")
    expect(controller.getMetadata().state).toBe("empty")
  })

  it("rejects resume when the live execution is no longer admitted", async () => {
    const { controller } = await publishAvailableCheckpoint()

    const acquired = await controller.acquireForResume({
      context: await resumeContext(),
      isCurrentExecution: () => false,
    })

    expect(acquired.kind).toBe("execution-superseded")
    expect(controller.getMetadata().state).toBe("available")
  })

  for (const [label, mutate] of [
    ["content key", (context: FinalCheckpointContext) => ({ ...context, source: { ...context.source, contentKey: "youtube:other" } })],
    ["part id", (context: FinalCheckpointContext) => ({ ...context, source: { ...context.source, partId: "2" } })],
    ["title", (context: FinalCheckpointContext) => ({ ...context, source: { ...context.source, title: "Renamed" } })],
    ["duration", (context: FinalCheckpointContext) => ({ ...context, source: { ...context.source, durationSec: 21 } })],
    ["source tab", (context: FinalCheckpointContext) => ({ ...context, source: { ...context.source, sourceTabId: 42 } })],
    ["transcript fingerprint", (context: FinalCheckpointContext) => ({ ...context, transcript: { ...context.transcript, fingerprint: "changed" } })],
    ["credential revision", (context: FinalCheckpointContext) => ({ ...context, provider: { ...context.provider, credentialRevision: "credential-revision-2" } })],
    ["provider model", (context: FinalCheckpointContext) => ({ ...context, provider: { ...context.provider, model: "other-model" } })],
    ["provider base url", (context: FinalCheckpointContext) => ({ ...context, provider: { ...context.provider, baseUrl: "https://other.example.com/v1" } })],
    ["timeout", (context: FinalCheckpointContext) => ({ ...context, provider: { ...context.provider, timeoutMs: 60_000 } })],
    ["preset", (context: FinalCheckpointContext) => ({ ...context, preset: createAnalysisPresetSnapshot("concise") })],
    ["budget policy", (context: FinalCheckpointContext) => ({ ...context, budgetPolicy: { ...context.budgetPolicy, reservedCompletionTokens: 1_000 } })],
  ] as const) {
    it(`refuses resume when the ${label} changed`, async () => {
      const { controller } = await publishAvailableCheckpoint()

      const acquired = await controller.acquireForResume({
        context: mutate(await resumeContext()),
        isCurrentExecution: () => true,
      })

      expect(acquired.kind).toBe("identity-mismatch")
      expect(controller.getMetadata().state).toBe("empty")
    })
  }

  it("keeps the lease valid across revalidation and revokes it when the execution ends", async () => {
    const { controller } = await publishAvailableCheckpoint()
    let current = true
    const context = await resumeContext()
    const acquired = await controller.acquireForResume({
      context,
      isCurrentExecution: () => current,
    })
    if (acquired.kind !== "acquired") throw new Error("expected an acquired resume lease")

    expect(await acquired.lease.validate(context)).toBe(true)

    current = false
    expect(await acquired.lease.validate(context)).toBe(false)
    expect(controller.getMetadata().state).toBe("empty")
  })

  it("refuses resume after the checkpoint already expired", async () => {
    let clock = 1_000
    const { controller } = await publishAvailableCheckpoint(
      createFinalResumeCheckpointController({ now: () => clock }),
    )
    clock += 30 * 60 * 1000

    const acquired = await controller.acquireForResume({
      context: await resumeContext(),
      isCurrentExecution: () => true,
    })

    expect(acquired.kind).toBe("expired")
  })
})
