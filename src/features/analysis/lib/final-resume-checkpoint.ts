import { validateAnalysisBudgetPolicy, type AnalysisBudgetPolicy } from "@/features/analysis/lib/analysis-budget"
import type { AnalysisPresetStrategy } from "@/features/analysis/lib/analysis-preset"
import { VIDEO_ANALYSIS_SCHEMA_VERSION } from "@/features/analysis/lib/analysis-schema"
import { OpenAICompatibleClientError } from "@/features/analysis/lib/openai-compatible-client"
import type { AnalysisPrompt, EvidenceSummary } from "@/features/analysis/lib/prompts"
import type { DestructiveMutation } from "@/features/history/lib/destructive-operation-coordinator"
import type { VideoInfo } from "@/features/platform/types"
import type { TranscriptCue } from "@/features/transcript/lib/transcript-schema"
import {
  canonicalJson,
  computeTranscriptFingerprint,
  normalizeCacheBaseUrl,
  sha256Hex,
} from "@/lib/persistence/cache-identity"

export const FINAL_CHECKPOINT_TTL_MS = 30 * 60 * 1000
export const FINAL_CHECKPOINT_MAX_SUMMARY_BYTES = 256 * 1024
export const FINAL_CHECKPOINT_VERSION = 1
export const FINAL_CHECKPOINT_PLANNING_VERSION = "analysis-plan-v1"

export type FinalCheckpointMapPlanItem = {
  id: string
  index: number
  startSec: number
  endSec: number
}

export type FinalCheckpointExecution = {
  strategy: "single-pass" | "map-reduce"
  videoId: string
  initialChunkCount: number
  reductionLevels: number
  mapPlan: FinalCheckpointMapPlanItem[]
  chunkSummaries: EvidenceSummary[]
  finalInputSummaries: EvidenceSummary[]
  finalPrompt: AnalysisPrompt
}

export type FinalCheckpointContext = {
  source: {
    taskId: string
    workspaceEpoch: number
    sourceTabId: number
    platform: VideoInfo["platform"]
    videoId: string
    partId: string | null
    contentKey: string
    title: string
    durationSec: number | null
  }
  transcript: {
    fingerprint: string
    cues: TranscriptCue[]
  }
  provider: {
    profileId: string
    baseUrl: string
    model: string
    timeoutMs: number
    credentialRevision: string
  }
  preset: AnalysisPresetStrategy
  schemaVersion: number
  planningVersion: string
  budgetPolicy: AnalysisBudgetPolicy
}

export type FinalCheckpointCandidateInput = {
  context: FinalCheckpointContext
  execution: FinalCheckpointExecution
}

export type FinalCheckpointIdentity = {
  checkpointVersion: number
  generation: number
  sourceTaskId: string
  workspaceEpoch: number
  sourceTabId: number
  platform: VideoInfo["platform"]
  videoId: string
  partId: string | null
  contentKey: string
  title: string
  durationSec: number | null
  transcriptFingerprint: string
  transcriptCuesDigest: string
  providerProfileId: string
  providerBaseUrl: string
  providerModel: string
  providerTimeoutMs: number
  providerCredentialRevision: string
  presetId: string
  promptVersion: string
  presetDigest: string
  schemaVersion: number
  planningVersion: string
  budgetPolicy: AnalysisBudgetPolicy
  mapPlanDigest: string
  chunkSummariesDigest: string
  finalInputDigest: string
  finalPromptDigest: string
  initialChunkCount: number
  reductionLevels: number
}

export type FinalCheckpointPayload = FinalCheckpointExecution & {
  checkpointVersion: number
  strategy: "map-reduce"
}

export type FinalCheckpointRecord = {
  checkpointVersion: number
  generation: number
  createdAt: number
  expiresAt: number
  summaryBytes: number
  identity: FinalCheckpointIdentity
  payload: FinalCheckpointPayload
  integrity: string
}

export type FinalCheckpointMetadata = {
  state: "empty" | "candidate" | "available" | "leased"
  generation: number
  createdAt: number | null
  expiresAt: number | null
  summaryBytes: number
  failure: { kind: string; status: number | null } | null
  invalidationReason: string | null
}

export type FinalCheckpointLease = {
  leaseId: string
  generation: number
  identity: FinalCheckpointIdentity
  payload: FinalCheckpointPayload
  validate(context: FinalCheckpointContext): Promise<boolean>
  release(): void
  destroy(): void
}

export type FinalCheckpointAcquisition =
  | { kind: "acquired"; lease: FinalCheckpointLease }
  | { kind: "unavailable" | "lease-unavailable" | "expired" | "identity-mismatch" | "integrity-failed" | "invalidated" | "destroyed" }

export type FinalCheckpointCandidateAttempt = {
  generation: number
  validate(): Promise<boolean>
  promoteFinalFailure(error: unknown): Promise<boolean>
  discard(reason: string): void
  getRecordForVerification(): FinalCheckpointRecord
}

export type FinalResumeCheckpointController = {
  beginCandidate(input: FinalCheckpointCandidateInput): Promise<FinalCheckpointCandidateAttempt | null>
  observeContext(context: FinalCheckpointContext): Promise<void>
  acquire(context: FinalCheckpointContext): Promise<FinalCheckpointAcquisition>
  getMetadata(): FinalCheckpointMetadata
  handleDestructiveMutation(mutation: DestructiveMutation): boolean
  invalidate(reason: string): void
  destroy(): void
}

type Digest = (value: string) => Promise<string>

type Entry = {
  record: FinalCheckpointRecord
  context: FinalCheckpointContext
  state: "candidate" | "available" | "leased"
  leaseId: string | null
  failure: { kind: string; status: number | null } | null
}

export function countFinalCheckpointSummaryBytes(execution: FinalCheckpointExecution): number {
  const encoder = new TextEncoder()
  return [...execution.chunkSummaries, ...execution.finalInputSummaries]
    .reduce((total, summary) => total + encoder.encode(summary.summary).byteLength, 0)
}

export function isFinalCheckpointExecutionOverCapacity(execution: FinalCheckpointExecution): boolean {
  return countFinalCheckpointSummaryBytes(execution) > FINAL_CHECKPOINT_MAX_SUMMARY_BYTES
}

export function isFinalFailureEligibleForCheckpoint(error: unknown): boolean {
  if (!(error instanceof OpenAICompatibleClientError)) return false
  if (error.kind === "timeout") return true
  // The existing client maps every non-abort/non-timeout request exception to
  // `network`, including untyped programming failures. Do not infer transient
  // eligibility from that broad kind or from message text.
  return error.kind === "http" && (error.status === 502 || error.status === 503 || error.status === 504)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isValidTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function cloneFrozen<T>(value: T, ancestors = new Set<object>()): T {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Checkpoint numbers must be finite.")
    return value
  }
  if (typeof value !== "object") throw new Error("Checkpoint values must be plain JSON data.")
  const object = value as object
  if (ancestors.has(object)) throw new Error("Checkpoint values must not contain cycles.")
  ancestors.add(object)
  try {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((item) => cloneFrozen(item, ancestors))) as T
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Checkpoint objects must not carry custom prototypes.")
    }
    const clone: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        throw new Error("Checkpoint object keys are not safe.")
      }
      clone[key] = cloneFrozen(item, ancestors)
    }
    return Object.freeze(clone) as T
  } finally {
    ancestors.delete(object)
  }
}

function validateSummary(summary: EvidenceSummary): boolean {
  return isNonEmptyString(summary.chunkId)
    && isNonEmptyString(summary.summary)
    && isValidTime(summary.startSec)
    && isValidTime(summary.endSec)
    && summary.endSec >= summary.startSec
}

function validateMapAgainstCues(
  mapPlan: FinalCheckpointMapPlanItem[],
  cues: TranscriptCue[],
): boolean {
  if (mapPlan.length === 0 || cues.length === 0) return false
  const ids = new Set<string>()
  let cueIndex = 0
  for (const [index, chunk] of mapPlan.entries()) {
    if (chunk.index !== index || !isNonEmptyString(chunk.id) || ids.has(chunk.id)) return false
    ids.add(chunk.id)
    if (!isValidTime(chunk.startSec) || !isValidTime(chunk.endSec) || chunk.endSec < chunk.startSec) {
      return false
    }
    const firstCue = cues[cueIndex]
    if (!firstCue || chunk.startSec !== firstCue.startSec) return false
    let lastCue: TranscriptCue | undefined
    while (cueIndex < cues.length) {
      const cue = cues[cueIndex]!
      if (cue.startSec < chunk.startSec || cue.endSec > chunk.endSec) break
      lastCue = cue
      cueIndex += 1
    }
    if (!lastCue || chunk.endSec !== lastCue.endSec) return false
  }
  return cueIndex === cues.length
}

function validateFinalInputCoverage(
  finalInput: EvidenceSummary[],
  mapPlan: FinalCheckpointMapPlanItem[],
): boolean {
  if (finalInput.length === 0 || finalInput.length > mapPlan.length) return false
  const ids = new Set<string>()
  let mapIndex = 0
  for (const summary of finalInput) {
    if (!validateSummary(summary) || ids.has(summary.chunkId)) return false
    ids.add(summary.chunkId)
    const first = mapPlan[mapIndex]
    if (!first || summary.startSec !== first.startSec) return false
    let last: FinalCheckpointMapPlanItem | undefined
    while (mapIndex < mapPlan.length) {
      const chunk = mapPlan[mapIndex]!
      if (chunk.startSec < summary.startSec || chunk.endSec > summary.endSec) break
      last = chunk
      mapIndex += 1
    }
    if (!last || summary.endSec !== last.endSec) return false
  }
  return mapIndex === mapPlan.length
}

async function validateCandidateInput(input: FinalCheckpointCandidateInput): Promise<boolean> {
  const { context, execution } = input
  try {
    if (execution.strategy !== "map-reduce") return false
    if (context.schemaVersion !== VIDEO_ANALYSIS_SCHEMA_VERSION) return false
    if (context.planningVersion !== FINAL_CHECKPOINT_PLANNING_VERSION) return false
    if (!isNonEmptyString(context.source.taskId) || !Number.isInteger(context.source.workspaceEpoch)) return false
    if (context.source.workspaceEpoch < 0 || !Number.isInteger(context.source.sourceTabId)) return false
    if (context.source.sourceTabId < 0) return false
    if (!isNonEmptyString(context.source.videoId) || context.source.videoId !== execution.videoId) return false
    if (!isNonEmptyString(context.source.contentKey) || typeof context.source.title !== "string") return false
    if (context.source.partId !== null && !isNonEmptyString(context.source.partId)) return false
    if (context.source.durationSec !== null && !isValidTime(context.source.durationSec)) return false
    if (context.source.durationSec !== null && context.transcript.cues.some(
      (cue) => cue.endSec > context.source.durationSec!,
    )) return false
    if (!isNonEmptyString(context.provider.profileId) || !isNonEmptyString(context.provider.model)) return false
    if (!isNonEmptyString(context.provider.credentialRevision)) return false
    if (!Number.isFinite(context.provider.timeoutMs) || context.provider.timeoutMs <= 0) return false
    normalizeCacheBaseUrl(context.provider.baseUrl)
    validateAnalysisBudgetPolicy(context.budgetPolicy)
    if (!Number.isInteger(context.schemaVersion) || context.schemaVersion <= 0) return false
    if (!Number.isInteger(execution.reductionLevels) || execution.reductionLevels < 0) return false
    if (execution.initialChunkCount !== execution.mapPlan.length) return false
    if (execution.chunkSummaries.length !== execution.mapPlan.length) return false
    if (!isNonEmptyString(execution.finalPrompt.systemPrompt)) return false
    if (!isNonEmptyString(execution.finalPrompt.userPrompt)) return false
    if (isFinalCheckpointExecutionOverCapacity(execution)) return false

    const cues = context.transcript.cues
    if (cues.length === 0) return false
    for (const cue of cues) {
      if (!isValidTime(cue.startSec) || !isValidTime(cue.endSec) || cue.endSec < cue.startSec) return false
      if (typeof cue.text !== "string") return false
    }
    if (await computeTranscriptFingerprint(cues) !== context.transcript.fingerprint) return false
    if (!validateMapAgainstCues(execution.mapPlan, cues)) return false
    for (const [index, summary] of execution.chunkSummaries.entries()) {
      const chunk = execution.mapPlan[index]!
      if (!validateSummary(summary)) return false
      if (summary.chunkId !== chunk.id || summary.startSec !== chunk.startSec || summary.endSec !== chunk.endSec) {
        return false
      }
    }
    if (!validateFinalInputCoverage(execution.finalInputSummaries, execution.mapPlan)) return false
    if (execution.reductionLevels === 0) {
      if (execution.finalInputSummaries.length !== execution.chunkSummaries.length) return false
      for (const [index, summary] of execution.finalInputSummaries.entries()) {
        if (canonicalJson(summary) !== canonicalJson(execution.chunkSummaries[index]!)) return false
      }
    } else if (execution.finalInputSummaries.length >= execution.chunkSummaries.length) {
      return false
    }
    return true
  } catch {
    return false
  }
}

async function buildIdentity(
  context: FinalCheckpointContext,
  execution: FinalCheckpointExecution,
  generation: number,
  digest: Digest,
): Promise<FinalCheckpointIdentity> {
  const cues = context.transcript.cues.map((cue) => ({
    startSec: cue.startSec,
    endSec: cue.endSec,
    text: cue.text,
  }))
  const [transcriptCuesDigest, presetDigest, mapPlanDigest, chunkSummariesDigest, finalInputDigest, finalPromptDigest] =
    await Promise.all([
      digest(canonicalJson(cues)),
      digest(canonicalJson(context.preset)),
      digest(canonicalJson(execution.mapPlan)),
      digest(canonicalJson(execution.chunkSummaries)),
      digest(canonicalJson(execution.finalInputSummaries)),
      digest(canonicalJson(execution.finalPrompt)),
    ])
  return cloneFrozen({
    checkpointVersion: FINAL_CHECKPOINT_VERSION,
    generation,
    sourceTaskId: context.source.taskId,
    workspaceEpoch: context.source.workspaceEpoch,
    sourceTabId: context.source.sourceTabId,
    platform: context.source.platform,
    videoId: context.source.videoId,
    partId: context.source.partId,
    contentKey: context.source.contentKey,
    title: context.source.title,
    durationSec: context.source.durationSec,
    transcriptFingerprint: context.transcript.fingerprint,
    transcriptCuesDigest,
    providerProfileId: context.provider.profileId,
    providerBaseUrl: normalizeCacheBaseUrl(context.provider.baseUrl),
    providerModel: context.provider.model,
    providerTimeoutMs: context.provider.timeoutMs,
    providerCredentialRevision: context.provider.credentialRevision,
    presetId: context.preset.id,
    promptVersion: context.preset.promptVersion,
    presetDigest,
    schemaVersion: context.schemaVersion,
    planningVersion: context.planningVersion,
    budgetPolicy: context.budgetPolicy,
    mapPlanDigest,
    chunkSummariesDigest,
    finalInputDigest,
    finalPromptDigest,
    initialChunkCount: execution.initialChunkCount,
    reductionLevels: execution.reductionLevels,
  })
}

function integrityInput(record: FinalCheckpointRecord): string {
  return canonicalJson({
    checkpointVersion: record.checkpointVersion,
    generation: record.generation,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    summaryBytes: record.summaryBytes,
    identity: record.identity,
    payload: record.payload,
  })
}

async function sealRecord(
  context: FinalCheckpointContext,
  execution: FinalCheckpointExecution,
  generation: number,
  createdAt: number,
  digest: Digest,
): Promise<FinalCheckpointRecord> {
  const payload = cloneFrozen({
    checkpointVersion: FINAL_CHECKPOINT_VERSION,
    ...execution,
    strategy: "map-reduce" as const,
  })
  const identity = await buildIdentity(context, payload, generation, digest)
  const unsigned = {
    checkpointVersion: FINAL_CHECKPOINT_VERSION,
    generation,
    createdAt,
    expiresAt: createdAt + FINAL_CHECKPOINT_TTL_MS,
    summaryBytes: countFinalCheckpointSummaryBytes(payload),
    identity,
    payload,
  }
  const integrity = await digest(canonicalJson(unsigned))
  return Object.freeze({ ...unsigned, integrity })
}

export async function verifyFinalCheckpointRecord(
  record: FinalCheckpointRecord,
  digest: Digest = sha256Hex,
): Promise<boolean> {
  try {
    if (record.checkpointVersion !== FINAL_CHECKPOINT_VERSION) return false
    if (!Number.isInteger(record.generation) || record.generation <= 0) return false
    if (!Number.isFinite(record.createdAt) || !Number.isFinite(record.expiresAt)) return false
    if (record.expiresAt - record.createdAt !== FINAL_CHECKPOINT_TTL_MS) return false
    if (record.identity.checkpointVersion !== FINAL_CHECKPOINT_VERSION) return false
    if (record.identity.generation !== record.generation) return false
    if (record.payload.checkpointVersion !== FINAL_CHECKPOINT_VERSION) return false
    if (record.payload.strategy !== "map-reduce") return false
    if (record.summaryBytes !== countFinalCheckpointSummaryBytes(record.payload)) return false
    if (isFinalCheckpointExecutionOverCapacity(record.payload)) return false
    if (record.identity.mapPlanDigest !== await digest(canonicalJson(record.payload.mapPlan))) return false
    if (record.identity.chunkSummariesDigest !== await digest(canonicalJson(record.payload.chunkSummaries))) return false
    if (record.identity.finalInputDigest !== await digest(canonicalJson(record.payload.finalInputSummaries))) return false
    if (record.identity.finalPromptDigest !== await digest(canonicalJson(record.payload.finalPrompt))) return false
    return record.integrity === await digest(integrityInput(record))
  } catch {
    return false
  }
}

async function contextMatchesRecord(
  context: FinalCheckpointContext,
  record: FinalCheckpointRecord,
  digest: Digest,
): Promise<boolean> {
  try {
    if (!await validateCandidateInput({ context, execution: record.payload })) return false
    const current = await buildIdentity(context, record.payload, record.generation, digest)
    return canonicalJson(current) === canonicalJson(record.identity)
  } catch {
    return false
  }
}

function sanitizeReason(reason: string): string {
  return /^[a-z0-9:-]{1,64}$/.test(reason) ? reason : "invalidated"
}

export function createFinalResumeCheckpointController(options: {
  now?: () => number
  randomUUID?: () => string
  digest?: Digest
} = {}): FinalResumeCheckpointController {
  const now = options.now ?? Date.now
  const randomUUID = options.randomUUID ?? (() => crypto.randomUUID())
  const digest = options.digest ?? sha256Hex
  let generation = 0
  let entry: Entry | null = null
  let destroyed = false
  let invalidationReason: string | null = null

  const invalidate = (reason: string): void => {
    generation += 1
    entry = null
    invalidationReason = sanitizeReason(reason)
  }

  const isCurrent = (candidateGeneration: number, candidateEntry: Entry): boolean =>
    !destroyed && generation === candidateGeneration && entry === candidateEntry

  const expired = (record: FinalCheckpointRecord): boolean => now() >= record.expiresAt

  const acquire = async (context: FinalCheckpointContext): Promise<FinalCheckpointAcquisition> => {
    if (destroyed) return { kind: "destroyed" }
    const acquiredEntry = entry
    if (!acquiredEntry) return { kind: "unavailable" }
    if (acquiredEntry.state === "leased") return { kind: "lease-unavailable" }
    if (acquiredEntry.state !== "available") return { kind: "unavailable" }
    if (expired(acquiredEntry.record)) {
      invalidate("expired")
      return { kind: "expired" }
    }

    const acquiredGeneration = generation
    const leaseId = randomUUID()
    acquiredEntry.state = "leased"
    acquiredEntry.leaseId = leaseId
    let leaseActive = true

    const stillOwnsLease = (): boolean => isCurrent(acquiredGeneration, acquiredEntry)
      && acquiredEntry.state === "leased"
      && acquiredEntry.leaseId === leaseId
      && leaseActive

    const integrityValid = await verifyFinalCheckpointRecord(acquiredEntry.record, digest)
    if (destroyed) return { kind: "destroyed" }
    if (!isCurrent(acquiredGeneration, acquiredEntry)) return { kind: "invalidated" }
    if (!integrityValid) {
      invalidate("integrity-failed")
      return { kind: "integrity-failed" }
    }
    const identityValid = await contextMatchesRecord(context, acquiredEntry.record, digest)
    if (destroyed) return { kind: "destroyed" }
    if (!isCurrent(acquiredGeneration, acquiredEntry)) return { kind: "invalidated" }
    if (!identityValid) {
      invalidate("identity-mismatch")
      return { kind: "identity-mismatch" }
    }
    if (expired(acquiredEntry.record)) {
      invalidate("expired")
      return { kind: "expired" }
    }

    const lease: FinalCheckpointLease = {
      leaseId,
      generation: acquiredGeneration,
      identity: acquiredEntry.record.identity,
      payload: acquiredEntry.record.payload,
      async validate(currentContext) {
        if (!stillOwnsLease() || expired(acquiredEntry.record)) return false
        const valid = await verifyFinalCheckpointRecord(acquiredEntry.record, digest)
          && await contextMatchesRecord(currentContext, acquiredEntry.record, digest)
        if (!stillOwnsLease()) return false
        if (!valid || expired(acquiredEntry.record)) {
          invalidate(valid ? "expired" : "lease-validation-failed")
          return false
        }
        return true
      },
      release() {
        if (!stillOwnsLease()) return
        leaseActive = false
        acquiredEntry.leaseId = null
        if (expired(acquiredEntry.record)) invalidate("expired")
        else acquiredEntry.state = "available"
      },
      destroy() {
        if (!stillOwnsLease()) return
        leaseActive = false
        invalidate("lease-destroyed")
      },
    }
    return { kind: "acquired", lease }
  }

  return {
    async beginCandidate(input) {
      if (destroyed) return null
      invalidate("candidate-replaced")
      const candidateGeneration = generation
      invalidationReason = null
      let context: FinalCheckpointContext
      let execution: FinalCheckpointExecution
      try {
        context = cloneFrozen(input.context)
        execution = cloneFrozen(input.execution)
      } catch {
        return null
      }
      if (!await validateCandidateInput({ context, execution })) return null
      if (destroyed || generation !== candidateGeneration || entry !== null) return null
      const record = await sealRecord(context, execution, candidateGeneration, now(), digest)
      if (destroyed || generation !== candidateGeneration || entry !== null) return null
      const candidateEntry: Entry = {
        record,
        context,
        state: "candidate",
        leaseId: null,
        failure: null,
      }
      entry = candidateEntry

      const validateCandidate = async (): Promise<boolean> => {
        if (!isCurrent(candidateGeneration, candidateEntry) || candidateEntry.state !== "candidate") return false
        if (expired(record)) {
          invalidate("expired")
          return false
        }
        const valid = await verifyFinalCheckpointRecord(record, digest)
        if (!isCurrent(candidateGeneration, candidateEntry)) return false
        if (!valid) {
          invalidate("integrity-failed")
          return false
        }
        return true
      }

      return {
        generation: candidateGeneration,
        validate: validateCandidate,
        async promoteFinalFailure(error) {
          if (!isFinalFailureEligibleForCheckpoint(error)) {
            if (isCurrent(candidateGeneration, candidateEntry)) invalidate("ineligible-final-failure")
            return false
          }
          if (!await validateCandidate()) return false
          if (!await contextMatchesRecord(context, record, digest)) {
            if (isCurrent(candidateGeneration, candidateEntry)) invalidate("identity-mismatch")
            return false
          }
          if (!isCurrent(candidateGeneration, candidateEntry) || candidateEntry.state !== "candidate") return false
          candidateEntry.state = "available"
          candidateEntry.failure = {
            kind: error instanceof OpenAICompatibleClientError ? error.kind : "other",
            status: error instanceof OpenAICompatibleClientError ? error.status : null,
          }
          return true
        },
        discard(reason) {
          if (isCurrent(candidateGeneration, candidateEntry)) invalidate(reason)
        },
        getRecordForVerification() { return record },
      }
    },

    async observeContext(context) {
      const observed = entry
      if (!observed || destroyed) return
      const observedGeneration = generation
      const matches = await contextMatchesRecord(context, observed.record, digest)
      if (!isCurrent(observedGeneration, observed)) return
      if (!matches) invalidate("identity-mismatch")
    },

    acquire,

    getMetadata() {
      if (!entry) {
        return {
          state: "empty",
          generation,
          createdAt: null,
          expiresAt: null,
          summaryBytes: 0,
          failure: null,
          invalidationReason,
        }
      }
      return {
        state: entry.state,
        generation,
        createdAt: entry.record.createdAt,
        expiresAt: entry.record.expiresAt,
        summaryBytes: entry.record.summaryBytes,
        failure: entry.failure ? { ...entry.failure } : null,
        invalidationReason: null,
      }
    },

    handleDestructiveMutation(mutation) {
      if (!entry || destroyed) return false
      if (mutation.type === "clear-conversations" || mutation.type === "clear-diagnostics") return false
      if (mutation.type === "delete-video-data" && mutation.contentKey !== entry.record.identity.contentKey) {
        return false
      }
      invalidate(`mutation:${mutation.type}`)
      return true
    },

    invalidate,
    destroy() {
      if (destroyed) return
      invalidate("destroyed")
      destroyed = true
    },
  }
}
