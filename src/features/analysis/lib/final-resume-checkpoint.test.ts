import { describe, expect, it } from "bun:test"

import { DEFAULT_ANALYSIS_BUDGET_POLICY } from "@/features/analysis/lib/analysis-budget"
import { createAnalysisPresetSnapshot } from "@/features/analysis/lib/analysis-preset"
import { VIDEO_ANALYSIS_SCHEMA_VERSION } from "@/features/analysis/lib/analysis-schema"
import { OpenAICompatibleClientError } from "@/features/analysis/lib/openai-compatible-client"
import { computeTranscriptFingerprint } from "@/lib/persistence/cache-identity"
import type { TranscriptCue } from "@/features/transcript/lib/transcript-schema"

import {
  countFinalCheckpointSummaryBytes,
  createFinalResumeCheckpointController,
  FINAL_CHECKPOINT_MAX_SUMMARY_BYTES,
  FINAL_CHECKPOINT_PLANNING_VERSION,
  FINAL_CHECKPOINT_TTL_MS,
  isFinalFailureEligibleForCheckpoint,
  isFinalCheckpointExecutionOverCapacity,
  verifyFinalCheckpointRecord,
  type FinalCheckpointCandidateInput,
  type FinalCheckpointContext,
  type FinalCheckpointExecution,
} from "./final-resume-checkpoint"

const NOW = 1_800_000_000_000

function cuesFixture(): TranscriptCue[] {
  return [
    { startSec: 0, endSec: 10, text: "first cue" },
    { startSec: 10, endSec: 20, text: "second cue" },
    { startSec: 20, endSec: 30, text: "third cue" },
  ]
}

async function contextFixture(overrides: {
  source?: Partial<FinalCheckpointContext["source"]>
  transcript?: Partial<FinalCheckpointContext["transcript"]>
  provider?: Partial<FinalCheckpointContext["provider"]>
  presetId?: "standard" | "concise" | "detailed"
  schemaVersion?: number
  planningVersion?: string
  budgetPolicy?: Partial<FinalCheckpointContext["budgetPolicy"]>
} = {}): Promise<FinalCheckpointContext> {
  const cues = overrides.transcript?.cues ?? cuesFixture()
  return {
    source: {
      taskId: "task-a",
      workspaceEpoch: 3,
      sourceTabId: 7,
      platform: "youtube",
      videoId: "video-a",
      partId: null,
      contentKey: "youtube:video-a",
      title: "Video A",
      durationSec: 30,
      ...overrides.source,
    },
    transcript: {
      fingerprint: overrides.transcript?.fingerprint ?? await computeTranscriptFingerprint(cues),
      cues,
      ...overrides.transcript,
    },
    provider: {
      profileId: "profile-a",
      baseUrl: "https://api.example.com/v1",
      model: "model-a",
      timeoutMs: 120_000,
      credentialRevision: "credential-revision-a",
      ...overrides.provider,
    },
    preset: createAnalysisPresetSnapshot(overrides.presetId ?? "standard"),
    schemaVersion: overrides.schemaVersion ?? VIDEO_ANALYSIS_SCHEMA_VERSION,
    planningVersion: overrides.planningVersion ?? FINAL_CHECKPOINT_PLANNING_VERSION,
    budgetPolicy: {
      ...DEFAULT_ANALYSIS_BUDGET_POLICY,
      ...overrides.budgetPolicy,
    },
  }
}

function executionFixture(): FinalCheckpointExecution {
  const chunkSummaries = [
    { chunkId: "chunk-1", startSec: 0, endSec: 10, summary: "map one" },
    { chunkId: "chunk-2", startSec: 10, endSec: 20, summary: "map two" },
    { chunkId: "chunk-3", startSec: 20, endSec: 30, summary: "map three" },
  ]
  return {
    strategy: "map-reduce",
    videoId: "video-a",
    initialChunkCount: 3,
    reductionLevels: 0,
    mapPlan: [
      { id: "chunk-1", index: 0, startSec: 0, endSec: 10, cueStartIndex: 0, cueEndIndex: 1 },
      { id: "chunk-2", index: 1, startSec: 10, endSec: 20, cueStartIndex: 1, cueEndIndex: 2 },
      { id: "chunk-3", index: 2, startSec: 20, endSec: 30, cueStartIndex: 2, cueEndIndex: 3 },
    ],
    chunkSummaries,
    finalInputSummaries: chunkSummaries.map((summary) => ({ ...summary })),
    finalInputMapChunkIds: [["chunk-1"], ["chunk-2"], ["chunk-3"]],
    finalPrompt: {
      systemPrompt: "system prompt",
      userPrompt: "final user prompt",
    },
  }
}

async function candidateFixture(): Promise<FinalCheckpointCandidateInput> {
  return { context: await contextFixture(), execution: executionFixture() }
}

async function overlappingCandidateFixture(): Promise<FinalCheckpointCandidateInput> {
  const cues: TranscriptCue[] = [
    { startSec: 0, endSec: 10, text: "outer cue" },
    { startSec: 5, endSec: 9, text: "nested cue" },
    { startSec: 10, endSec: 20, text: "later cue" },
  ]
  const chunkSummaries = [
    { chunkId: "chunk-1", startSec: 0, endSec: 10, summary: "outer summary" },
    { chunkId: "chunk-2", startSec: 5, endSec: 9, summary: "nested summary" },
    { chunkId: "chunk-3", startSec: 10, endSec: 20, summary: "later summary" },
  ]
  return {
    context: await contextFixture({ transcript: { cues }, source: { durationSec: 20 } }),
    execution: {
      strategy: "map-reduce",
      videoId: "video-a",
      initialChunkCount: 3,
      reductionLevels: 0,
      mapPlan: [
        { id: "chunk-1", index: 0, startSec: 0, endSec: 10, cueStartIndex: 0, cueEndIndex: 1 },
        { id: "chunk-2", index: 1, startSec: 5, endSec: 9, cueStartIndex: 1, cueEndIndex: 2 },
        { id: "chunk-3", index: 2, startSec: 10, endSec: 20, cueStartIndex: 2, cueEndIndex: 3 },
      ],
      chunkSummaries,
      finalInputSummaries: chunkSummaries.map((summary) => ({ ...summary })),
      finalInputMapChunkIds: [["chunk-1"], ["chunk-2"], ["chunk-3"]],
      finalPrompt: { systemPrompt: "system prompt", userPrompt: "final user prompt" },
    },
  }
}

function controllerFixture(options: {
  now?: () => number
  ids?: string[]
  digest?: (value: string) => Promise<string>
} = {}) {
  const ids = [...(options.ids ?? ["lease-1", "lease-2"])]
  return createFinalResumeCheckpointController({
    now: options.now ?? (() => NOW),
    randomUUID: () => ids.shift() ?? "lease-fallback",
    digest: options.digest,
  })
}

async function availableCheckpoint(options: {
  now?: () => number
  ids?: string[]
  digest?: (value: string) => Promise<string>
  input?: FinalCheckpointCandidateInput
  error?: OpenAICompatibleClientError
} = {}) {
  const controller = controllerFixture(options)
  const attempt = await controller.beginCandidate(options.input ?? await candidateFixture())
  expect(attempt).not.toBeNull()
  expect(await attempt!.promoteFinalFailure(options.error ?? new OpenAICompatibleClientError(
    "temporary upstream failure",
    { kind: "http", status: 502 },
  ))).toBe(true)
  return { controller, attempt: attempt! }
}

describe("M2 final checkpoint — deterministic overlapping-cue plans", () => {
  it("publishes a Final 502 checkpoint for nested cues split into different chunks", async () => {
    const input = await overlappingCandidateFixture()
    const controller = controllerFixture()
    const attempt = await controller.beginCandidate(input)
    expect(attempt).not.toBeNull()
    expect(await attempt!.promoteFinalFailure(new OpenAICompatibleClientError(
      "temporary upstream failure",
      { kind: "http", status: 502 },
    ))).toBe(true)
    expect(controller.getMetadata().state).toBe("available")
    expect((await controller.acquire(input.context)).kind).toBe("acquired")
  })

  const corruptPlans: Array<[string, (input: FinalCheckpointCandidateInput) => void]> = [
    ["tampered cue boundary", (input) => {
      input.execution.mapPlan[0]!.endSec = 9
      input.execution.chunkSummaries[0]!.endSec = 9
      input.execution.finalInputSummaries[0]!.endSec = 9
    }],
    ["swapped chunks", (input) => {
      for (const key of ["mapPlan", "chunkSummaries", "finalInputSummaries", "finalInputMapChunkIds"] as const) {
        const items = input.execution[key]
        ;[items[0], items[1]] = [items[1]!, items[0]!]
      }
    }],
    ["missing cue", (input) => {
      input.execution.mapPlan.splice(1, 1)
      input.execution.mapPlan[1]!.index = 1
      input.execution.chunkSummaries.splice(1, 1)
      input.execution.finalInputSummaries.splice(1, 1)
      input.execution.finalInputMapChunkIds.splice(1, 1)
      input.execution.initialChunkCount = 2
    }],
  ]
  for (const [name, mutate] of corruptPlans) {
    it(`rejects ${name} in an overlapping-cue plan`, async () => {
      const input = await overlappingCandidateFixture()
      mutate(input)
      const controller = controllerFixture()
      expect(await controller.beginCandidate(input)).toBeNull()
      expect(controller.getMetadata().state).toBe("empty")
    })
  }
})

describe("M2 final checkpoint — candidate and eligibility", () => {
  it("keeps a candidate private until the actual Final request fails with an eligible error", async () => {
    const controller = controllerFixture()
    const attempt = await controller.beginCandidate(await candidateFixture())
    expect(attempt).not.toBeNull()
    expect(controller.getMetadata()).toMatchObject({ state: "candidate", generation: 1 })
    expect(await attempt!.promoteFinalFailure(new OpenAICompatibleClientError("bad request", {
      kind: "http",
      status: 400,
    }))).toBe(false)
    expect(controller.getMetadata().state).toBe("empty")
  })

  it.each([502, 503, 504])("publishes Final HTTP %i without adding a retry", async (status) => {
    const { controller } = await availableCheckpoint({
      error: new OpenAICompatibleClientError("upstream", { kind: "http", status }),
    })
    expect(controller.getMetadata()).toMatchObject({
      state: "available",
      failure: { kind: "http", status },
    })
  })

  it("accepts an explicit timeout and rejects the over-broad unclassified network kind", async () => {
    const { controller } = await availableCheckpoint({
      error: new OpenAICompatibleClientError("deadline", { kind: "timeout", status: null }),
    })
    expect(controller.getMetadata().state).toBe("available")

    const networkController = controllerFixture()
    const networkAttempt = await networkController.beginCandidate(await candidateFixture())
    expect(await networkAttempt!.promoteFinalFailure(new OpenAICompatibleClientError(
      "connection reset",
      { kind: "network", status: null },
    ))).toBe(false)
    expect(networkController.getMetadata().state).toBe("empty")
  })

  it.each([
    ["http-500", { kind: "http", status: 500 }],
    ["http-400", { kind: "http", status: 400 }],
    ["http-401", { kind: "http", status: 401 }],
    ["http-403", { kind: "http", status: 403 }],
    ["http-429", { kind: "http", status: 429 }],
    ["cancelled", { kind: "cancelled", status: null }],
    ["network", { kind: "network", status: null }],
    ["invalid-response", { kind: "invalid-response", status: null }],
    ["other", { kind: "other", status: null }],
  ] as const)("rejects %s even when its message contains eligible words", (_name, details) => {
    expect(isFinalFailureEligibleForCheckpoint(new OpenAICompatibleClientError(
      "HTTP 502 timeout secret-token <html>private summary</html>",
      details,
    ))).toBe(false)
    expect(isFinalFailureEligibleForCheckpoint(new Error("Final HTTP 503 timeout"))).toBe(false)
  })

  it("does not publish after cancellation, replacement, or disposal", async () => {
    for (const action of ["cancel", "replace", "destroy"] as const) {
      const controller = controllerFixture()
      const attempt = await controller.beginCandidate(await candidateFixture())
      if (action === "cancel") controller.invalidate("cancelled")
      if (action === "replace") controller.invalidate("replaced")
      if (action === "destroy") controller.destroy()
      expect(await attempt!.promoteFinalFailure(new OpenAICompatibleClientError("upstream", {
        kind: "http",
        status: 503,
      }))).toBe(false)
      expect(controller.getMetadata().state).toBe("empty")
    }
  })

  it("exposes only content-free failure metadata", async () => {
    const { controller } = await availableCheckpoint({
      error: new OpenAICompatibleClientError(
        "sk-live-secret <html>map one final user prompt</html>",
        { kind: "http", status: 502 },
      ),
    })
    const serialized = JSON.stringify(controller.getMetadata())
    expect(serialized).not.toContain("sk-live-secret")
    expect(serialized).not.toContain("<html>")
    expect(serialized).not.toContain("map one")
    expect(serialized).not.toContain("final user prompt")
    expect(serialized).not.toContain("credential-revision-a")
  })
})

describe("M2 final checkpoint — integrity and immutable data", () => {
  it("freezes a deep clone so later caller mutation cannot alter the checkpoint", async () => {
    const input = await candidateFixture()
    const { controller } = await availableCheckpoint({ input })
    input.execution.chunkSummaries[0]!.summary = "tampered map summary"
    input.execution.finalInputSummaries[0]!.summary = "tampered final input"
    input.execution.finalPrompt.userPrompt = "tampered prompt"
    input.context.transcript.cues[0]!.text = "tampered cue"

    const acquired = await controller.acquire(await contextFixture())
    expect(acquired.kind).toBe("acquired")
    if (acquired.kind !== "acquired") return
    expect(acquired.lease.payload.chunkSummaries[0]!.summary).toBe("map one")
    expect(acquired.lease.payload.finalInputSummaries[0]!.summary).toBe("map one")
    expect(acquired.lease.payload.finalPrompt.userPrompt).toBe("final user prompt")
    expect(Object.isFrozen(acquired.lease.payload.chunkSummaries)).toBe(true)
    expect(Object.isFrozen(acquired.lease.payload.chunkSummaries[0])).toBe(true)
    expect(() => {
      ;(acquired.lease.payload.chunkSummaries[0] as { summary: string }).summary = "blocked"
    }).toThrow()
  })

  it("rejects a record whose nested data changed after sealing", async () => {
    const controller = controllerFixture()
    const attempt = await controller.beginCandidate(await candidateFixture())
    const record = attempt!.getRecordForVerification()
    expect(await verifyFinalCheckpointRecord(record)).toBe(true)
    const corrupted = structuredClone(record)
    corrupted.payload.finalInputSummaries[0]!.summary = "corrupted"
    expect(await verifyFinalCheckpointRecord(corrupted)).toBe(false)
    corrupted.payload.finalInputSummaries = structuredClone(record.payload.finalInputSummaries)
    corrupted.integrity = record.integrity
    corrupted.identity.finalPromptDigest = "0".repeat(64)
    expect(await verifyFinalCheckpointRecord(corrupted)).toBe(false)
  })

  it.each([
    ["duplicate chunk ids", (input: FinalCheckpointCandidateInput) => {
      input.execution.chunkSummaries[1]!.chunkId = "chunk-1"
    }],
    ["non-contiguous ranges", (input: FinalCheckpointCandidateInput) => {
      input.execution.chunkSummaries[1]!.startSec = 11
      input.execution.mapPlan[1]!.startSec = 11
    }],
    ["infinite range", (input: FinalCheckpointCandidateInput) => {
      input.execution.chunkSummaries[0]!.endSec = Number.POSITIVE_INFINITY
    }],
    ["plan/summary mismatch", (input: FinalCheckpointCandidateInput) => {
      input.execution.mapPlan[0]!.id = "different"
    }],
    ["cue range mismatch", (input: FinalCheckpointCandidateInput) => {
      input.context.transcript.cues[2]!.endSec = 31
    }],
    ["fingerprint mismatch", (input: FinalCheckpointCandidateInput) => {
      input.context.transcript.fingerprint = "0".repeat(64)
    }],
    ["bad map count", (input: FinalCheckpointCandidateInput) => {
      input.execution.initialChunkCount = 4
    }],
    ["single-pass execution", (input: FinalCheckpointCandidateInput) => {
      input.execution.strategy = "single-pass"
    }],
  ])("rejects %s", async (_name, mutate) => {
    const input = await candidateFixture()
    mutate(input)
    const controller = controllerFixture()
    expect(await controller.beginCandidate(input)).toBeNull()
    expect(controller.getMetadata().state).toBe("empty")
  })
})

describe("M2 final checkpoint — TTL and byte capacity", () => {
  it("expires at now >= expiresAt, not one millisecond later", async () => {
    let now = NOW
    const first = await availableCheckpoint({ now: () => now })
    now = NOW + FINAL_CHECKPOINT_TTL_MS - 1
    expect((await first.controller.acquire(await contextFixture())).kind).toBe("acquired")
    first.controller.invalidate("test-complete")

    now = NOW
    const second = await availableCheckpoint({ now: () => now, ids: ["second-lease"] })
    now = NOW + FINAL_CHECKPOINT_TTL_MS
    expect((await second.controller.acquire(await contextFixture())).kind).toBe("expired")
    expect(second.controller.getMetadata().state).toBe("empty")
  })

  it("accepts exactly 256 KiB of Map plus final-input summaries", async () => {
    const input = await candidateFixture()
    const currentBytes = countFinalCheckpointSummaryBytes(input.execution)
    const addition = (FINAL_CHECKPOINT_MAX_SUMMARY_BYTES - currentBytes) / 2
    input.execution.chunkSummaries[0]!.summary += "x".repeat(addition)
    input.execution.finalInputSummaries[0]!.summary += "x".repeat(addition)
    expect(countFinalCheckpointSummaryBytes(input.execution)).toBe(FINAL_CHECKPOINT_MAX_SUMMARY_BYTES)
    const controller = controllerFixture()
    expect(await controller.beginCandidate(input)).not.toBeNull()
  })

  it("rejects one byte over capacity without truncating either summary", async () => {
    const input = await candidateFixture()
    const currentBytes = countFinalCheckpointSummaryBytes(input.execution)
    const addition = (FINAL_CHECKPOINT_MAX_SUMMARY_BYTES - currentBytes) / 2
    input.execution.chunkSummaries[0]!.summary += "x".repeat(addition)
    input.execution.finalInputSummaries[0]!.summary += "x".repeat(addition)
    input.execution.chunkSummaries[0]!.summary += "x"
    expect(countFinalCheckpointSummaryBytes(input.execution)).toBe(FINAL_CHECKPOINT_MAX_SUMMARY_BYTES + 1)
    expect(isFinalCheckpointExecutionOverCapacity(input.execution)).toBe(true)
    const originalLength = input.execution.chunkSummaries[0]!.summary.length
    const controller = controllerFixture()
    expect(await controller.beginCandidate(input)).toBeNull()
    expect(input.execution.chunkSummaries[0]!.summary.length).toBe(originalLength)
  })

  it("counts UTF-8 bytes rather than JavaScript characters", async () => {
    const input = await candidateFixture()
    const currentBytes = countFinalCheckpointSummaryBytes(input.execution)
    const asciiAddition = (FINAL_CHECKPOINT_MAX_SUMMARY_BYTES - currentBytes - 6) / 2
    input.execution.chunkSummaries[0]!.summary += `${"x".repeat(asciiAddition)}界`
    input.execution.finalInputSummaries[0]!.summary += `${"x".repeat(asciiAddition)}界`
    expect(countFinalCheckpointSummaryBytes(input.execution)).toBe(FINAL_CHECKPOINT_MAX_SUMMARY_BYTES)
    expect(await controllerFixture().beginCandidate(input)).not.toBeNull()
    input.execution.chunkSummaries[0]!.summary += "x"
    expect(isFinalCheckpointExecutionOverCapacity(input.execution)).toBe(true)
    expect(await controllerFixture().beginCandidate(input)).toBeNull()
  })
})

describe("M2 final checkpoint — strict identity", () => {
  const mutations: Array<[string, (context: FinalCheckpointContext) => void]> = [
    ["source tab", (context) => { context.source.sourceTabId = 8 }],
    ["platform", (context) => { context.source.platform = "bilibili"; context.source.partId = "p1" }],
    ["video", (context) => { context.source.videoId = "video-b" }],
    ["part", (context) => { context.source.partId = "p2" }],
    ["content key", (context) => { context.source.contentKey = "youtube:video-b" }],
    ["workspace epoch", (context) => { context.source.workspaceEpoch += 1 }],
    ["source task", (context) => { context.source.taskId = "task-b" }],
    ["cue text", (context) => { context.transcript.cues[0]!.text = "changed" }],
    ["cue timing", (context) => { context.transcript.cues[0]!.endSec = 9 }],
    ["fingerprint", (context) => { context.transcript.fingerprint = "f".repeat(64) }],
    ["title", (context) => { context.source.title = "Changed title" }],
    ["duration", (context) => { context.source.durationSec = 31 }],
    ["profile", (context) => { context.provider.profileId = "profile-b" }],
    ["base URL", (context) => { context.provider.baseUrl = "https://other.example.com/v1" }],
    ["model", (context) => { context.provider.model = "model-b" }],
    ["timeout", (context) => { context.provider.timeoutMs = 121_000 }],
    ["credential revision", (context) => { context.provider.credentialRevision = "credential-revision-b" }],
    ["preset", (context) => { context.preset = createAnalysisPresetSnapshot("detailed") }],
    ["schema", (context) => { context.schemaVersion += 1 }],
    ["planning version", (context) => { context.planningVersion = "other-plan" }],
    ["budget", (context) => { context.budgetPolicy = { ...context.budgetPolicy, reservedRepairTokens: 2_001 } }],
  ]

  it.each(mutations)("fails closed when %s changes", async (_name, mutate) => {
    const { controller } = await availableCheckpoint()
    const changed = await contextFixture()
    mutate(changed)
    if (_name === "cue text" || _name === "cue timing") {
      changed.transcript.fingerprint = await computeTranscriptFingerprint(changed.transcript.cues)
    }
    expect((await controller.acquire(changed)).kind).toBe("identity-mismatch")
    expect(controller.getMetadata().state).toBe("empty")
  })

  it("canonicalizes equivalent Provider base URLs but not different endpoints", async () => {
    const first = await availableCheckpoint()
    const equivalent = await contextFixture()
    equivalent.provider.baseUrl = "https://api.example.com/v1/"
    expect((await first.controller.acquire(equivalent)).kind).toBe("acquired")

    const second = await availableCheckpoint({ ids: ["second"] })
    const different = await contextFixture()
    different.provider.baseUrl = "https://api.example.com/v2"
    expect((await second.controller.acquire(different)).kind).toBe("identity-mismatch")
  })

  it("does not resurrect a valid A checkpoint after observing A → B → A", async () => {
    const { controller } = await availableCheckpoint()
    const contextB = await contextFixture()
    contextB.source.videoId = "video-b"
    contextB.source.contentKey = "youtube:video-b"
    contextB.source.workspaceEpoch += 1
    await controller.observeContext(contextB)
    await controller.observeContext(await contextFixture())
    expect(controller.getMetadata().state).toBe("empty")
    expect((await controller.acquire(await contextFixture())).kind).toBe("unavailable")
  })
})

describe("M2 final checkpoint — lease and async races", () => {
  it("allows only one of two concurrent acquisitions", async () => {
    const { controller } = await availableCheckpoint()
    const [first, second] = await Promise.all([
      controller.acquire(await contextFixture()),
      controller.acquire(await contextFixture()),
    ])
    expect([first.kind, second.kind].sort()).toEqual(["acquired", "lease-unavailable"])
  })

  it("cannot republish from a stale attempt after invalidation", async () => {
    const controller = controllerFixture()
    const stale = await controller.beginCandidate(await candidateFixture())
    controller.invalidate("new-analysis")
    const current = await controller.beginCandidate(await candidateFixture())
    expect(current).not.toBeNull()
    expect(await stale!.promoteFinalFailure(new OpenAICompatibleClientError("old", {
      kind: "http",
      status: 502,
    }))).toBe(false)
    expect(controller.getMetadata()).toMatchObject({ state: "candidate", generation: current!.generation })
  })

  it("does not revive a checkpoint while an async integrity read is in flight", async () => {
    let releaseDigest!: (value: string) => void
    const pendingDigest = new Promise<string>((resolve) => { releaseDigest = resolve })
    let delayNextRead = false
    const digest = async (value: string) => {
      if (delayNextRead) {
        delayNextRead = false
        return pendingDigest
      }
      const { sha256Hex } = await import("@/lib/persistence/cache-identity")
      return sha256Hex(value)
    }
    const { controller } = await availableCheckpoint({ digest })
    delayNextRead = true
    const acquisition = controller.acquire(await contextFixture())
    controller.invalidate("clear-transcript-cache")
    releaseDigest("0".repeat(64))
    expect((await acquisition).kind).toBe("invalidated")
    expect(controller.getMetadata().state).toBe("empty")
  })

  it("an old lease cannot release or destroy a newer generation", async () => {
    const { controller } = await availableCheckpoint()
    const acquired = await controller.acquire(await contextFixture())
    expect(acquired.kind).toBe("acquired")
    if (acquired.kind !== "acquired") return
    controller.invalidate("replacement")
    const replacement = await controller.beginCandidate(await candidateFixture())
    expect(await replacement!.promoteFinalFailure(new OpenAICompatibleClientError("new", {
      kind: "http",
      status: 502,
    }))).toBe(true)
    const before = controller.getMetadata()
    acquired.lease.release()
    acquired.lease.destroy()
    expect(controller.getMetadata()).toEqual(before)
  })

  it("release returns only the same live generation to the available state", async () => {
    const { controller } = await availableCheckpoint()
    const acquired = await controller.acquire(await contextFixture())
    expect(acquired.kind).toBe("acquired")
    if (acquired.kind !== "acquired") return
    expect(controller.getMetadata().state).toBe("leased")
    expect(await acquired.lease.validate(await contextFixture())).toBe(true)
    acquired.lease.release()
    expect(controller.getMetadata().state).toBe("available")
    const reacquired = await controller.acquire(await contextFixture())
    expect(reacquired.kind).toBe("acquired")
    if (reacquired.kind !== "acquired") return
    reacquired.lease.destroy()
    expect(controller.getMetadata().state).toBe("empty")
  })
})

describe("M2 final checkpoint — destructive mutation policy", () => {
  it.each([
    ["clear-transcript-cache", { type: "clear-transcript-cache" }, true],
    ["clear-analysis-history", { type: "clear-analysis-history" }, true],
    ["clear-all", { type: "clear-all" }, true],
    ["related analysis deletion", { type: "delete-analysis-run", analysisRunId: "run-a" }, true],
    ["clear-conversations", { type: "clear-conversations" }, false],
    ["clear-diagnostics", { type: "clear-diagnostics" }, false],
    ["unrelated video deletion", { type: "delete-video-data", contentKey: "youtube:other" }, false],
  ] as const)("handles %s", async (_name, mutation, shouldInvalidate) => {
    const { controller } = await availableCheckpoint()
    expect(controller.handleDestructiveMutation(mutation)).toBe(shouldInvalidate)
    expect(controller.getMetadata().state).toBe(shouldInvalidate ? "empty" : "available")
  })

  it("invalidates when the checkpoint's own video is deleted", async () => {
    const { controller } = await availableCheckpoint()
    expect(controller.handleDestructiveMutation({
      type: "delete-video-data",
      contentKey: "youtube:video-a",
    })).toBe(true)
    expect(controller.getMetadata().state).toBe("empty")
  })
})
