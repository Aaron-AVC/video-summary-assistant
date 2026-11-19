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
  FINAL_CHECKPOINT_TTL_MS,
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

async function acquireResumeLease(
  controller: FinalResumeCheckpointController = createFinalResumeCheckpointController(),
  context?: FinalCheckpointContext,
  isCurrentExecution: () => boolean = () => true,
) {
  const published = await publishAvailableCheckpoint(controller)
  const leaseContext = context ?? await resumeContext()
  const acquired = await controller.acquireForResume({ context: leaseContext, isCurrentExecution })
  if (acquired.kind !== "acquired") throw new Error(`expected a resume lease, received ${acquired.kind}`)
  return { controller, lease: acquired.lease, resumeContext: leaseContext, publishedContext: published.context }
}

/** Every mutation except the two resume-normalized execution fields. */
const liveIdentityMutations: Array<[string, (context: FinalCheckpointContext) => Promise<FinalCheckpointContext>]> = [
  ["contentKey", async (context) => ({ ...context, source: { ...context.source, contentKey: "youtube:other" } })],
  ["credentialRevision", async (context) => ({ ...context, provider: { ...context.provider, credentialRevision: "credential-revision-2" } })],
  ["cues", async (context) => {
    const changedCues: TranscriptCue[] = [
      { startSec: 0, endSec: 10, text: "First cue rewritten." },
      { startSec: 10, endSec: 20, text: "Second cue." },
    ]
    return {
      ...context,
      transcript: { cues: changedCues, fingerprint: await computeTranscriptFingerprint(changedCues) },
    }
  }],
  ["timeoutMs", async (context) => ({ ...context, provider: { ...context.provider, timeoutMs: 60_000 } })],
  ["partId", async (context) => ({ ...context, source: { ...context.source, partId: "2" } })],
  ["videoId", async (context) => ({ ...context, source: { ...context.source, videoId: "video-other", contentKey: "youtube:video-other" } })],
  ["title", async (context) => ({ ...context, source: { ...context.source, title: "Renamed" } })],
  ["durationSec", async (context) => ({ ...context, source: { ...context.source, durationSec: 21 } })],
  ["preset", async (context) => ({ ...context, preset: createAnalysisPresetSnapshot("concise") })],
  ["budgetPolicy", async (context) => ({ ...context, budgetPolicy: { ...context.budgetPolicy, reservedCompletionTokens: 1_000 } })],
]

describe("F-01 lease.validate must re-check the live identity it receives", () => {
  for (const [label, mutate] of liveIdentityMutations) {
    it(`refuses a resume lease when the live ${label} changed after acquisition`, async () => {
      const { controller, lease, resumeContext: live } = await acquireResumeLease()

      expect(await lease.validate(await mutate(live))).toBe(false)

      const metadata = controller.getMetadata()
      expect(metadata.state).toBe("empty")
      expect(metadata.invalidationReason).not.toBeNull()
    })
  }

  it("refuses a resume lease when several live fields changed at once", async () => {
    const { controller, lease, resumeContext: live } = await acquireResumeLease()
    const changed: FinalCheckpointContext = {
      ...live,
      source: { ...live.source, videoId: "video-other", partId: "9", contentKey: "youtube:video-other", title: "Other" },
      provider: { ...live.provider, model: "other-model", credentialRevision: "credential-revision-9", timeoutMs: 5_000 },
    }

    expect(await lease.validate(changed)).toBe(false)
    expect(controller.getMetadata().state).toBe("empty")
    expect(controller.getMetadata().invalidationReason).not.toBeNull()
  })

  it("keeps the resume lease valid when only the normalized taskId and workspaceEpoch changed", async () => {
    const { controller, lease, resumeContext: live } = await acquireResumeLease()

    const normalizedOnly: FinalCheckpointContext = {
      ...live,
      source: { ...live.source, taskId: "task-resume-3", workspaceEpoch: 42 },
    }
    expect(normalizedOnly.source.taskId).not.toBe(live.source.taskId)
    expect(normalizedOnly.source.workspaceEpoch).not.toBe(live.source.workspaceEpoch)

    expect(await lease.validate(normalizedOnly)).toBe(true)
    expect(controller.getMetadata().state).toBe("leased")
  })

  it("accepts the identical live context and stays reusable across repeated revalidation", async () => {
    const { controller, lease, resumeContext: live } = await acquireResumeLease()

    expect(await lease.validate(live)).toBe(true)
    expect(await lease.validate(live)).toBe(true)
    expect(controller.getMetadata().state).toBe("leased")
  })

  it("refuses a resume lease once the checkpoint TTL expired", async () => {
    let clock = 1_000
    const controller = createFinalResumeCheckpointController({ now: () => clock })
    const published = await publishAvailableCheckpoint(controller)
    const live = await resumeContext()
    const acquired = await controller.acquireForResume({ context: live, isCurrentExecution: () => true })
    if (acquired.kind !== "acquired") throw new Error("expected a resume lease")

    clock += FINAL_CHECKPOINT_TTL_MS
    expect(await acquired.lease.validate(live)).toBe(false)
    expect(published.controller.getMetadata().state).toBe("empty")
  })

  it("refuses a resume lease after it was destroyed", async () => {
    const { controller, lease, resumeContext: live } = await acquireResumeLease()
    lease.destroy()

    expect(await lease.validate(live)).toBe(false)
    expect(controller.getMetadata().state).toBe("empty")
  })

  it("refuses a resume lease after it was released", async () => {
    const { controller, lease, resumeContext: live } = await acquireResumeLease()
    lease.release()

    expect(await lease.validate(live)).toBe(false)
    expect(controller.getMetadata().state).toBe("available")
  })

  it("refuses a resume lease when the live execution is no longer admitted", async () => {
    let current = true
    const { controller, lease, resumeContext: live } = await acquireResumeLease(
      createFinalResumeCheckpointController(),
      undefined,
      () => current,
    )

    current = false
    expect(await lease.validate(live)).toBe(false)
    expect(controller.getMetadata().state).toBe("empty")
    expect(controller.getMetadata().invalidationReason).toBe("execution-superseded")
  })
})

describe("F-01 plain acquire keeps its unnormalized strict identity contract", () => {
  async function acquirePlainLease(controller: FinalResumeCheckpointController) {
    const published = await publishAvailableCheckpoint(controller)
    const acquired = await controller.acquire(published.context)
    if (acquired.kind !== "acquired") throw new Error(`expected a plain lease, received ${acquired.kind}`)
    return { lease: acquired.lease, context: published.context }
  }

  for (const [label, mutate] of [
    ["videoId", async (context: FinalCheckpointContext) => ({
      ...context,
      source: { ...context.source, videoId: "video-other", contentKey: "youtube:video-other" },
    })],
    ["partId", async (context: FinalCheckpointContext) => ({
      ...context,
      source: { ...context.source, partId: "2" },
    })],
    ["contentKey", async (context: FinalCheckpointContext) => ({
      ...context,
      source: { ...context.source, contentKey: "youtube:other" },
    })],
    ["credentialRevision", async (context: FinalCheckpointContext) => ({
      ...context,
      provider: { ...context.provider, credentialRevision: "credential-revision-2" },
    })],
    ["cues", async (context: FinalCheckpointContext) => {
      const changedCues: TranscriptCue[] = [
        { startSec: 0, endSec: 10, text: "First cue rewritten." },
        { startSec: 10, endSec: 20, text: "Second cue." },
      ]
      return {
        ...context,
        transcript: { cues: changedCues, fingerprint: await computeTranscriptFingerprint(changedCues) },
      }
    }],
  ] as const) {
    it(`refuses a plain lease when the live ${label} changed, with no resume normalization`, async () => {
      const controller = createFinalResumeCheckpointController()
      const { lease, context } = await acquirePlainLease(controller)

      expect(await lease.validate(await mutate(context))).toBe(false)
      expect(controller.getMetadata().state).toBe("empty")
      expect(controller.getMetadata().invalidationReason).not.toBeNull()
    })
  }

  it("does not normalize a new taskId or workspaceEpoch for a plain lease", async () => {
    const controller = createFinalResumeCheckpointController()
    const { lease, context } = await acquirePlainLease(controller)

    const newExecution: FinalCheckpointContext = {
      ...context,
      source: { ...context.source, taskId: "task-resume-2", workspaceEpoch: 19 },
    }
    expect(await lease.validate(newExecution)).toBe(false)
    expect(controller.getMetadata().state).toBe("empty")
  })

  it("still rejects a plain acquire from a new task with identity-mismatch", async () => {
    const { controller } = await publishAvailableCheckpoint()

    const acquired = await controller.acquire(await resumeContext())

    expect(acquired.kind).toBe("identity-mismatch")
    expect(controller.getMetadata().state).toBe("empty")
    expect(controller.getMetadata().invalidationReason).toBe("identity-mismatch")
  })
})
