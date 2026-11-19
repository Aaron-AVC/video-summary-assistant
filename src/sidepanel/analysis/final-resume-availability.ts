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

/**
 * Fallback wake-up used while the exact expiry is still further away than the
 * cap. It is an upper bound on how stale the entry can be, not the primary
 * trigger: the scheduler always keeps the exact `expiresAt` as its last step.
 */
export const FINAL_RESUME_TTL_FALLBACK_MS = 30_000

/**
 * Next wake-up for the resume entry, in milliseconds.
 *
 * Returns the exact remaining time until `metadata.expiresAt`, so the entry
 * disappears at the expiry instant rather than up to a poll interval later.
 * Already-reached expiry collapses to zero, which the scheduler treats as "no
 * further wake-up" because the refresh that observed it already reported the
 * change. Returns `null` when the checkpoint has no expiry at all.
 *
 * `maxDelayMs` is a safety ceiling for very distant expiries only: it keeps a
 * single timer from being armed minutes ahead in a host that may throttle or
 * clamp timers. It is not a polling interval — the scheduler re-arms, and the
 * final wake-up still lands exactly on the expiry.
 *
 * Pure: it reads no clock of its own and mutates nothing.
 */
export function computeFinalResumeTtlDelay(input: {
  expiresAt: number | null
  now: number
  maxDelayMs?: number
}): number | null {
  if (input.expiresAt === null) return null
  const remaining = input.expiresAt - input.now
  if (!Number.isFinite(remaining) || remaining <= 0) return 0
  if (input.maxDelayMs === undefined || input.maxDelayMs <= 0) return remaining
  return Math.min(remaining, input.maxDelayMs)
}

export type FinalResumeTtlScheduler = {
  /** (Re)starts from the current expiry. Safe to call repeatedly. */
  start: () => void
  /** Re-reads the expiry and replaces the pending wake-up. */
  reschedule: () => void
  stop: () => void
}

/**
 * Drives the TTL wake-up.
 *
 * Every wake-up is a single `refresh`, and the timer is re-armed from the
 * freshly read expiry, so a new checkpoint (a different `expiresAt`) is picked
 * up without restarting the Side Panel. When the expiry has passed, exactly one
 * refresh is issued and nothing is re-armed, which is what makes the action
 * disappear at that instant instead of up to a poll-interval later.
 *
 * The timer primitives and the clock are injectable so this is testable without
 * a DOM; production wires the globals.
 */
export function createFinalResumeTtlScheduler(input: {
  readExpiresAt: () => number | null
  refresh: () => void
  now?: () => number
  setTimer?: (listener: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /**
   * Safety ceiling for a very distant expiry. The wake-up still targets the
   * real expiry; this only prevents arming one timer many minutes ahead in a
   * host that may clamp or throttle long timers.
   */
  maxDelayMs?: number
  /**
   * Re-check interval used only while there is no checkpoint to expire yet.
   * Without it the scheduler would park until an unrelated render happened to
   * re-arm it, leaving the entry stale after a checkpoint appears.
   */
  idleRecheckMs?: number
}): FinalResumeTtlScheduler {
  const now = input.now ?? (() => Date.now())
  const setTimer = input.setTimer ?? ((listener, ms) => setTimeout(listener, ms))
  const clearTimer = input.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  let handle: unknown = null
  let running = false

  const clear = () => {
    if (handle === null) return
    clearTimer(handle)
    handle = null
  }

  const arm = () => {
    clear()
    if (!running) return
    const expiresAt = input.readExpiresAt()
    const remaining = computeFinalResumeTtlDelay({
      expiresAt,
      now: now(),
      ...(input.maxDelayMs === undefined ? {} : { maxDelayMs: input.maxDelayMs }),
    })
    // No expiry yet. The checkpoint can still appear while the panel stays
    // open, so parking the scheduler here would leave the entry permanently
    // stale: keep a bounded idle re-check instead. A *reached* expiry does not
    // re-arm, because that refresh already published the change and a zero
    // delay would spin.
    if (remaining === null) {
      const idle = input.idleRecheckMs ?? input.maxDelayMs ?? null
      if (idle === null || idle <= 0) return
      handle = setTimer(() => {
        handle = null
        input.refresh()
        arm()
      }, idle)
      return
    }
    if (remaining === 0) return
    // `remaining` is exactly the time to the expiry, so the wake-up lands on it.
    handle = setTimer(() => {
      handle = null
      input.refresh()
      arm()
    }, remaining)
  }

  return {
    start() {
      running = true
      // Evaluate the current state once before arming. A checkpoint that is
      // already expired must publish its expiry now, and an entry that became
      // visible/hidden while nobody was watching must not wait a full cycle.
      input.refresh()
      arm()
    },
    reschedule() {
      arm()
    },
    stop() {
      running = false
      clear()
    },
  }
}

/**
 * Whether a task transition must recompute the resume entry.
 *
 * Releasing the workspace is what makes an earlier checkpoint usable again (for
 * example after the first Final attempt failed). While a task still owns the
 * workspace the entry stays hidden by the conflict rule, so an unchanged owner
 * needs no refresh.
 */
export function shouldRefreshFinalResumeOnTaskRelease(input: {
  previousTaskContentKey: string | null
  nextTaskContentKey: string | null
}): boolean {
  return input.previousTaskContentKey !== null && input.nextTaskContentKey !== input.previousTaskContentKey
}

/**
 * Whether a task transition *into* a running task must recompute the entry.
 *
 * A newly admitted task hides the action through the conflict rule, so the UI
 * never offers a resume that points at a workspace another task now owns.
 */
export function shouldRefreshFinalResumeOnTaskAdmission(input: {
  previousTaskContentKey: string | null
  nextTaskContentKey: string | null
}): boolean {
  return input.nextTaskContentKey !== input.previousTaskContentKey
}

/**
 * Phases that own the analysis workspace and therefore block a resume.
 *
 * `error`, `cancelled`, `completed` and `idle` intentionally do not: a failed
 * Final attempt must leave the checkpoint resumable.
 */
export const FINAL_RESUME_CONFLICT_PHASES = [
  "loading-transcript",
  "analyzing",
  "finalizing",
  "cancelling",
] as const

/**
 * Conflict decision for the resume entry.
 *
 * `taskActive` must come from the authoritative task controller, not from a
 * render-time state variable. The Side Panel refreshes this decision from inside
 * the controller's own subscription, which runs *before* React has re-rendered,
 * so a render-era value would still describe the task that just finished and
 * would report a conflict for a workspace that is already free.
 *
 * `taskReleased` acknowledges the ordering hazard that caused the real-browser
 * regression: the controller clears the task synchronously, but `analysisPhase`
 * is React state and can still hold the phase of the run that just ended. When
 * the caller observed an authoritative release, the workspace is free, so a
 * leftover phase must not keep the entry hidden. Without a release the phase is
 * still meaningful: a destructive operation can be running before any analysis
 * task exists, and `loading-transcript` covers exactly that window.
 */
export function computeFinalResumeConflict(input: {
  taskActive: boolean
  phase: string
  taskReleased?: boolean
}): boolean {
  if (input.taskActive) return true
  if (input.taskReleased) return false
  return (FINAL_RESUME_CONFLICT_PHASES as readonly string[]).includes(input.phase)
}

/**
 * The all-null identity used before any checkpoint exists.
 *
 * `expected` is only meaningful while a checkpoint is live; until then it must
 * never accidentally equal a real identity, because equality is what grants
 * access to the stored checkpoint.
 */
export function emptyFinalResumeIdentity(
  analysisPresetId: FinalResumeIdentity["analysisPresetId"],
): FinalResumeIdentity {
  return {
    sourceTabId: null,
    contentKey: null,
    partId: null,
    title: null,
    durationSec: null,
    transcriptFingerprint: null,
    providerProfileId: null,
    analysisPresetId,
  }
}

export type CheckpointIdentityTransition = {
  /**
   * `seeded`   – the checkpoint appeared; `expected` now binds its source.
   * `cleared`  – the checkpoint is gone; `expected` is back to the null shape.
   * `unchanged`– nothing to do; `expected` must be left exactly as it was.
   */
  kind: "seeded" | "cleared" | "unchanged"
  expected: FinalResumeIdentity
}

/**
 * Resolves the *expected* side of the resume identity comparison.
 *
 * This is an invariant, not a mirror of the live video context:
 *
 * - It is seeded exactly once, on the `empty → non-empty` transition, from the
 *   task snapshot that actually bound the checkpoint (falling back to the live
 *   context only when no task identity is available).
 * - While a checkpoint exists it is never overwritten. Overwriting it with the
 *   live identity would make expected equal current on every video/part switch
 *   and silently disable the entire protection: a checkpoint created for video
 *   A could then be resumed against video B.
 * - It is cleared when the checkpoint returns to empty, so the next checkpoint
 *   starts from a clean slate.
 *
 * A candidate checkpoint is seeded as well. It is not visible yet, but it
 * becomes the entry's expected side the moment it is promoted, and that
 * promotion must not depend on some unrelated re-render happening first.
 */
export function resolveCheckpointIdentityTransition(input: {
  previousState: FinalCheckpointMetadata["state"]
  nextState: FinalCheckpointMetadata["state"]
  previousExpected: FinalResumeIdentity
  currentIdentity: FinalResumeIdentity
  /** Source snapshot of the task that bound the checkpoint, when known. */
  taskIdentity?: FinalResumeIdentity | null
  /** Preset to store in the null shape when clearing. */
  analysisPresetId?: FinalResumeIdentity["analysisPresetId"]
}): CheckpointIdentityTransition {
  const presetId = input.analysisPresetId
    ?? input.currentIdentity.analysisPresetId
    ?? input.previousExpected.analysisPresetId

  if (input.nextState === "empty") {
    // Only report a change when something is actually being cleared.
    if (input.previousState === "empty") {
      return { kind: "unchanged", expected: input.previousExpected }
    }
    return { kind: "cleared", expected: emptyFinalResumeIdentity(presetId) }
  }

  // Non-empty. Seed only on the transition, never on a later identity change.
  if (input.previousState !== "empty") {
    return { kind: "unchanged", expected: input.previousExpected }
  }
  return {
    kind: "seeded",
    expected: input.taskIdentity ?? input.currentIdentity,
  }
}
