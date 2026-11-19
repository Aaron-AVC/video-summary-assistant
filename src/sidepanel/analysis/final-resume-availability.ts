import {
  FINAL_CHECKPOINT_TTL_MS,
  type FinalCheckpointMetadata,
} from "@/features/analysis/lib/final-resume-checkpoint"

/**
 * Content-free identity of the source a checkpoint belongs to. It mirrors the
 * fields the Side Panel already publishes through its lifecycle adapter, so a
 * provider, video, part, title, duration or transcript change invalidates the
 * resume entry immediately.
 */
export type FinalResumeIdentity = {
  sourceTabId: number | null
  contentKey: string | null
  partId: string | null
  title: string | null
  durationSec: number | null
  transcriptFingerprint: string | null
  providerProfileId: string | null
  analysisPresetId: string
}

export type FinalResumePhase = "available" | "resuming" | "saving" | "unavailable"

export type FinalResumeHideReason =
  | "no-checkpoint"
  | "not-available"
  | "expired"
  | "conflict"
  | "no-confirmed-transient-failure"
  | "tab-changed"
  | "content-key-changed"
  | "part-changed"
  | "title-changed"
  | "duration-changed"
  | "transcript-changed"
  | "provider-changed"
  | "preset-changed"

export type FinalResumeStatus = {
  /** HTTP status only; never the response body, prompt, cues or summaries. */
  kind: string
  status: number | null
}

export type FinalResumeView = {
  visible: boolean
  canStart: boolean
  phaseLabel: FinalResumePhase
  remainingMinutes: number
  status: FinalResumeStatus | null
  reason: FinalResumeHideReason | null
}

export type FinalResumeAvailabilityOptions = {
  readMetadata: () => FinalCheckpointMetadata
  readIdentity: () => FinalResumeIdentity
  readCurrentIdentity: () => FinalResumeIdentity | null
  hasConflict: () => boolean
  now?: () => number
}

export type FinalResumeAvailability = {
  getSnapshot: () => FinalResumeView
  subscribe: (listener: () => void) => () => void
  refresh: (event?: { kind: string }) => void
  setPhase: (phase: FinalResumePhase) => void
  destroy: () => void
}

const TRANSIENT_STATUSES = new Set([502, 503, 504])

function isConfirmedTransientFailure(metadata: FinalCheckpointMetadata): boolean {
  if (!metadata.failure) return false
  if (metadata.failure.kind === "timeout") return true
  return metadata.failure.kind === "http"
    && metadata.failure.status !== null
    && TRANSIENT_STATUSES.has(metadata.failure.status)
}

function identityMismatchReason(
  expected: FinalResumeIdentity,
  current: FinalResumeIdentity,
): FinalResumeHideReason | null {
  if (expected.sourceTabId !== current.sourceTabId) return "tab-changed"
  if (expected.contentKey !== current.contentKey) return "content-key-changed"
  if (expected.partId !== current.partId) return "part-changed"
  if (expected.title !== current.title) return "title-changed"
  if (expected.durationSec !== current.durationSec) return "duration-changed"
  if (expected.transcriptFingerprint !== current.transcriptFingerprint) return "transcript-changed"
  if (expected.providerProfileId !== current.providerProfileId) return "provider-changed"
  if (expected.analysisPresetId !== current.analysisPresetId) return "preset-changed"
  return null
}

/**
 * Computes the user-visible resume entry.
 *
 * The metadata read is synchronous by contract, so this module owns the
 * subscription, TTL watch and phase state M2 deliberately did not provide. The
 * returned view never carries summaries, prompts, cues or secrets.
 */
export function createFinalResumeAvailability(
  options: FinalResumeAvailabilityOptions,
): FinalResumeAvailability {
  const now = options.now ?? (() => Date.now())
  const listeners = new Set<() => void>()
  let phase: FinalResumePhase = "available"
  let destroyed = false
  let lastKey = ""

  const compute = (): FinalResumeView => {
    const metadata = options.readMetadata()
    const base = (
      visible: boolean,
      reason: FinalResumeHideReason | null,
    ): FinalResumeView => ({
      visible,
      canStart: visible && phase === "available",
      phaseLabel: phase,
      remainingMinutes: metadata.expiresAt === null
        ? 0
        : Math.max(0, Math.ceil((metadata.expiresAt - now()) / 60_000)),
      status: metadata.failure
        ? { kind: metadata.failure.kind, status: metadata.failure.status }
        : null,
      reason,
    })

    if (phase === "resuming" || phase === "saving") {
      return base(true, null)
    }
    if (metadata.state === "empty") return base(false, "no-checkpoint")
    if (metadata.state !== "available") return base(false, "not-available")
    if (metadata.expiresAt === null || now() >= metadata.expiresAt) return base(false, "expired")
    if (!isConfirmedTransientFailure(metadata)) {
      return base(false, "no-confirmed-transient-failure")
    }
    if (options.hasConflict()) return base(false, "conflict")
    const current = options.readCurrentIdentity()
    if (!current) return base(false, "tab-changed")
    const mismatch = identityMismatchReason(options.readIdentity(), current)
    if (mismatch) return base(false, mismatch)
    return base(true, null)
  }

  const notify = () => {
    for (const listener of listeners) listener()
  }

  const refresh = () => {
    if (destroyed) return
    const snapshot = compute()
    const key = JSON.stringify(snapshot)
    if (key === lastKey) return
    lastKey = key
    notify()
  }

  return {
    getSnapshot() {
      if (destroyed) {
        return {
          visible: false,
          canStart: false,
          phaseLabel: "unavailable",
          remainingMinutes: 0,
          status: null,
          reason: "no-checkpoint",
        }
      }
      return compute()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    refresh,
    setPhase(next) {
      if (destroyed) return
      phase = next
      refresh()
    },
    destroy() {
      destroyed = true
      listeners.clear()
    },
  }
}

export function describeFinalResumeAvailability(input: {
  metadata: FinalCheckpointMetadata
  reason: FinalResumeHideReason | null
  phase: FinalResumePhase
  remainingMinutes: number
  hasConflict?: boolean
}): FinalResumeView {
  const visible = input.reason === null
  return {
    visible,
    canStart: visible && input.phase === "available" && !input.hasConflict,
    phaseLabel: input.phase,
    remainingMinutes: input.remainingMinutes,
    status: input.metadata.failure
      ? { kind: input.metadata.failure.kind, status: input.metadata.failure.status }
      : null,
    reason: input.reason,
  }
}

/** TTL of a freshly created checkpoint; the action never outlives it. */
export const FINAL_RESUME_ENTRY_TTL_MS = FINAL_CHECKPOINT_TTL_MS
