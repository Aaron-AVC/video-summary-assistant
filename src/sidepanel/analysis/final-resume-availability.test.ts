import { describe, expect, it } from "bun:test"

import type { FinalCheckpointMetadata } from "@/features/analysis/lib/final-resume-checkpoint"

import {
  computeFinalResumeConflict,
  computeFinalResumeTtlDelay,
  createFinalResumeAvailability,
  createFinalResumeTtlScheduler,
  describeFinalResumeAvailability,
  emptyFinalResumeIdentity,
  resolveCheckpointIdentityTransition,
  shouldRefreshFinalResumeOnTaskRelease,
  type FinalResumeIdentity,
} from "./final-resume-availability"

const NOW = 1_000_000

/**
 * Minimal deterministic timer harness. It models the host's
 * setTimeout/clearTimeout contract only, so the scheduler's own policy is what
 * the test observes. The harness owns the clock: a fired callback observes its
 * own scheduled instant, which is what the TTL boundary depends on.
 */
function createFakeTimers(start: number) {
  type Entry = { id: number; at: number; fn: () => void; delay: number }
  let nextId = 1
  let time = start
  let pending: Entry[] = []

  const setTimer = (fn: () => void, delay: number): unknown => {
    const entry: Entry = { id: nextId, at: time + delay, fn, delay }
    nextId += 1
    pending.push(entry)
    return entry.id
  }
  const clearTimer = (handle: unknown): void => {
    pending = pending.filter((entry) => entry.id !== handle)
  }
  const firstDelay = (): number | null => pending.length === 0
    ? null
    : Math.min(...pending.map((entry) => entry.delay))
  const advanceTo = (target: number): void => {
    for (;;) {
      const due = pending
        .filter((entry) => entry.at <= target)
        .sort((left, right) => left.at - right.at)[0]
      if (!due) break
      pending = pending.filter((entry) => entry.id !== due.id)
      time = due.at
      due.fn()
    }
    time = target
  }

  return {
    now: () => time,
    setTimer,
    clearTimer,
    firstDelay,
    advanceTo,
    advanceBy: (ms: number) => advanceTo(time + ms),
    pendingCount: () => pending.length,
  }
}

function metadata(overrides: Partial<FinalCheckpointMetadata> = {}): FinalCheckpointMetadata {
  return {
    state: "available",
    generation: 3,
    createdAt: NOW - 60_000,
    expiresAt: NOW + 29 * 60_000,
    summaryBytes: 512,
    failure: { kind: "http", status: 502 },
    invalidationReason: null,
    ...overrides,
  }
}

function identity(overrides: Partial<FinalResumeIdentity> = {}): FinalResumeIdentity {
  return {
    sourceTabId: 7,
    contentKey: "youtube:abc",
    partId: null,
    title: "Video",
    durationSec: 600,
    transcriptFingerprint: "fingerprint-1",
    providerProfileId: "profile-1",
    analysisPresetId: "standard",
    ...overrides,
  }
}

function createHarness() {
  let clock = NOW
  let currentIdentity = identity()
  let currentMetadata = metadata()
  const availability = createFinalResumeAvailability({
    readMetadata: () => currentMetadata,
    readIdentity: () => identity(),
    readCurrentIdentity: () => currentIdentity,
    hasConflict: () => false,
    now: () => clock,
  })
  return {
    availability,
    advance(ms: number) {
      clock += ms
    },
    changeIdentity(next: FinalResumeIdentity) {
      currentIdentity = next
    },
    changeMetadata(next: FinalCheckpointMetadata) {
      currentMetadata = next
    },
  }
}

describe("final resume availability", () => {
  it("shows the resume action for a matching, unexpired, available checkpoint", () => {
    const harness = createHarness()

    const view = harness.availability.getSnapshot()

    expect(view.visible).toBe(true)
    expect(view.phaseLabel).toBe("available")
    expect(view.status).toEqual({ kind: "http", status: 502 })
    expect(view.remainingMinutes).toBe(29)
  })

  it("hides the action once the TTL elapses without requiring a refresh", () => {
    const harness = createHarness()
    expect(harness.availability.getSnapshot().visible).toBe(true)

    harness.advance(30 * 60_000)

    expect(harness.availability.getSnapshot().visible).toBe(false)
    expect(harness.availability.getSnapshot().reason).toBe("expired")
  })

  it("notifies subscribers when the visibility changes", () => {
    const harness = createHarness()
    const changes: boolean[] = []
    const unsubscribe = harness.availability.subscribe(() => {
      changes.push(harness.availability.getSnapshot().visible)
    })

    harness.changeIdentity(identity({ contentKey: "youtube:other" }))
    harness.availability.refresh({ kind: "identity-changed" })
    unsubscribe()

    expect(changes.at(-1)).toBe(false)
  })

  it("hides the action while another analysis task owns the workspace", () => {
    const availability = createFinalResumeAvailability({
      readMetadata: () => metadata(),
      readIdentity: () => identity(),
      readCurrentIdentity: () => identity(),
      hasConflict: () => true,
      now: () => NOW,
    })

    expect(availability.getSnapshot().visible).toBe(false)
    expect(availability.getSnapshot().reason).toBe("conflict")
  })

  it("hides the action when the live video, part, transcript or provider changed", () => {
    for (const [reason, current] of [
      ["content-key-changed", identity({ contentKey: "youtube:other" })],
      ["part-changed", identity({ partId: "2" })],
      ["transcript-changed", identity({ transcriptFingerprint: "fingerprint-2" })],
      ["provider-changed", identity({ providerProfileId: "profile-2" })],
      ["preset-changed", identity({ analysisPresetId: "concise" })],
      ["title-changed", identity({ title: "Renamed" })],
      ["duration-changed", identity({ durationSec: 601 })],
      ["tab-changed", identity({ sourceTabId: 8 })],
    ] as const) {
      const availability = createFinalResumeAvailability({
        readMetadata: () => metadata(),
        readIdentity: () => identity(),
        readCurrentIdentity: () => current,
        hasConflict: () => false,
        now: () => NOW,
      })
      const view = availability.getSnapshot()
      expect(view.visible).toBe(false)
      expect(view.reason).toBe(reason)
    }
  })

  it("hides the action when the checkpoint has no confirmed transient failure", () => {
    for (const failure of [null, { kind: "http", status: 401 }, { kind: "http", status: 400 }]) {
      const availability = createFinalResumeAvailability({
        readMetadata: () => metadata({ failure }),
        readIdentity: () => identity(),
        readCurrentIdentity: () => identity(),
        hasConflict: () => false,
        now: () => NOW,
      })
      expect(availability.getSnapshot().visible).toBe(false)
    }
  })

  it("hides the action when the checkpoint is leased, candidate, or invalidated", () => {
    for (const state of ["leased", "candidate", "empty"] as const) {
      const availability = createFinalResumeAvailability({
        readMetadata: () => metadata({ state }),
        readIdentity: () => identity(),
        readCurrentIdentity: () => identity(),
        hasConflict: () => false,
        now: () => NOW,
      })
      expect(availability.getSnapshot().visible).toBe(false)
    }
  })

  it("does not expose map summaries, prompts, cues or provider secrets in the view", () => {
    const harness = createHarness()

    const serialized = JSON.stringify(harness.availability.getSnapshot())

    expect(serialized).not.toContain("sk-")
    expect(serialized).not.toContain("summary")
    expect(serialized).not.toContain("prompt")
    expect(serialized).not.toContain("cues")
  })

  it("reports the resuming and saving phases so the button can be disabled", () => {
    const harness = createHarness()

    harness.availability.setPhase("resuming")
    expect(harness.availability.getSnapshot()).toMatchObject({ phaseLabel: "resuming", canStart: false })

    harness.availability.setPhase("saving")
    expect(harness.availability.getSnapshot()).toMatchObject({ phaseLabel: "saving", canStart: false })

    harness.availability.setPhase("available")
    expect(harness.availability.getSnapshot()).toMatchObject({ phaseLabel: "available", canStart: true })
  })

  it("keeps the error status but never the raw response body", () => {
    const view = describeFinalResumeAvailability({
      metadata: metadata({ failure: { kind: "http", status: 504 } }),
      reason: null,
      phase: "available",
      remainingMinutes: 12,
    })

    expect(view.status).toEqual({ kind: "http", status: 504 })
    expect(view.remainingMinutes).toBe(12)
  })
})

/**
 * Task B (review NOTE): the entry must disappear at the exact TTL boundary and
 * reappear as soon as a released task no longer conflicts.
 *
 * The Side Panel owns the timer, so the scheduling policy is a pure, injectable
 * module: `computeFinalResumeTtlDelay` decides the next wake-up and
 * `createFinalResumeTtlScheduler` drives it. `getSnapshot` stays a pure read.
 */
describe("final resume TTL scheduling", () => {
  const CAP = 30_000

  it("wakes up exactly at metadata.expiresAt instead of polling a fixed interval", () => {
    expect(computeFinalResumeTtlDelay({ expiresAt: NOW + 29 * 60_000, now: NOW })).toBe(29 * 60_000)
    expect(computeFinalResumeTtlDelay({ expiresAt: NOW + 1_234, now: NOW })).toBe(1_234)
  })

  it("is already expired at or past expiresAt and has nothing to schedule without one", () => {
    expect(computeFinalResumeTtlDelay({ expiresAt: NOW, now: NOW })).toBe(0)
    expect(computeFinalResumeTtlDelay({ expiresAt: NOW - 1, now: NOW })).toBe(0)
    expect(computeFinalResumeTtlDelay({ expiresAt: null, now: NOW })).toBeNull()
  })

  it("caps a long wait with the fallback interval but still lands on the exact expiry", () => {
    // A fallback wake-up may fire earlier, but the delay never exceeds the cap,
    // and the last wake-up lands on the expiry itself.
    expect(computeFinalResumeTtlDelay({ expiresAt: NOW + 29 * 60_000, now: NOW, maxDelayMs: CAP })).toBe(CAP)
    expect(computeFinalResumeTtlDelay({ expiresAt: NOW + 500, now: NOW, maxDelayMs: CAP })).toBe(500)

    const timers = createFakeTimers(NOW)
    const expiresAt = NOW + 29 * 60_000 + 500
    let refreshCount = 0
    const scheduler = createFinalResumeTtlScheduler({
      readExpiresAt: () => expiresAt,
      refresh: () => {
        refreshCount += 1
      },
      now: timers.now,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      maxDelayMs: CAP,
    })

    scheduler.start()
    timers.advanceTo(expiresAt - 1)
    // The fallback wake-ups before the expiry are pure re-reads.
    expect(refreshCount).toBeGreaterThan(0)

    const beforeExpiry = refreshCount
    timers.advanceBy(1)
    expect(timers.now()).toBe(expiresAt)
    expect(refreshCount).toBe(beforeExpiry + 1)

    // The expired entry is reported at that instant and no zero-delay loop runs.
    timers.advanceBy(10 * CAP)
    expect(refreshCount).toBe(beforeExpiry + 1)
    expect(timers.pendingCount()).toBe(0)
    scheduler.stop()
  })

  it("reschedules when a new checkpoint moves expiresAt", () => {
    const timers = createFakeTimers(NOW)
    let refreshCount = 0
    let expiresAt: number | null = NOW + 60_000
    const scheduler = createFinalResumeTtlScheduler({
      readExpiresAt: () => expiresAt,
      refresh: () => {
        refreshCount += 1
      },
      now: timers.now,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    })

    scheduler.start()
    expect(timers.firstDelay()).toBe(60_000)
    // `start` evaluates the current state once, then arms the expiry wake-up.
    expect(refreshCount).toBe(1)

    // A fresh checkpoint replaces the pending wake-up with its own expiry.
    expiresAt = NOW + 5_000
    scheduler.reschedule()
    expect(timers.firstDelay()).toBe(5_000)

    timers.advanceTo(NOW + 5_000)
    expect(refreshCount).toBe(2)
    scheduler.stop()
  })

  it("stops scheduling once stopped and never fires afterwards", () => {
    const timers = createFakeTimers(NOW)
    let refreshCount = 0
    const scheduler = createFinalResumeTtlScheduler({
      readExpiresAt: () => NOW + 1_000,
      refresh: () => {
        refreshCount += 1
      },
      now: timers.now,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    })

    scheduler.start()
    // Only the single startup evaluation may run.
    expect(refreshCount).toBe(1)
    scheduler.stop()
    timers.advanceTo(NOW + 5_000)
    expect(refreshCount).toBe(1)
  })
})

describe("final resume refresh on task release", () => {
  it("refreshes when a running analysis task releases the workspace", () => {
    // First Final failure: a task existed, then it was released, so the button
    // has to be recomputed back to available.
    expect(shouldRefreshFinalResumeOnTaskRelease({
      previousTaskContentKey: "youtube:abc",
      nextTaskContentKey: null,
    })).toBe(true)
  })

  it("does not refresh while a task keeps running or when none was running", () => {
    expect(shouldRefreshFinalResumeOnTaskRelease({
      previousTaskContentKey: "youtube:abc",
      nextTaskContentKey: "youtube:abc",
    })).toBe(false)
    expect(shouldRefreshFinalResumeOnTaskRelease({
      previousTaskContentKey: null,
      nextTaskContentKey: null,
    })).toBe(false)
  })
})

/**
 * Regression: "the resume button never comes back after a Final failure".
 *
 * Real-browser smoke exposed two independent defects here:
 *
 * 1. The conflict decision was read from render-time React state. The panel
 *    refreshes from inside the task controller's subscription, which runs
 *    before React re-renders, so the release instant still saw the finished
 *    task and published a *wrong* `conflict` snapshot. Nothing refreshed after
 *    the re-render, so the button stayed hidden.
 * 2. The TTL scheduler stopped itself permanently when the checkpoint had no
 *    expiry yet (the normal state after mount and after a discarded
 *    checkpoint), so no later wake-up could ever correct the wrong snapshot.
 */
describe("final resume conflict source of truth", () => {
  const identity = (): FinalResumeIdentity => ({
    sourceTabId: 7,
    contentKey: "youtube:abc",
    partId: null,
    title: "Video",
    durationSec: 600,
    transcriptFingerprint: "fingerprint-1",
    providerProfileId: "profile-1",
    analysisPresetId: "standard",
  })
  const availableMetadata = (): FinalCheckpointMetadata => ({
    state: "available",
    generation: 3,
    createdAt: NOW - 60_000,
    expiresAt: NOW + 29 * 60_000,
    summaryBytes: 512,
    failure: { kind: "http", status: 502 },
    invalidationReason: null,
  })

  it("does not report a conflict once the authoritative task released", () => {
    // Two render-era variables the panel used to read directly.
    let controllerTask: { contentKey: string } | null = { contentKey: "youtube:abc" }
    const renderEraTask: { contentKey: string } | null = { contentKey: "youtube:abc" }
    let controllerPhase = "analyzing"

    const availability = createFinalResumeAvailability({
      readMetadata: availableMetadata,
      readIdentity: identity,
      readCurrentIdentity: identity,
      // The fix reads authoritative values, never the render-era variables.
      hasConflict: () => computeFinalResumeConflict({
        taskActive: controllerTask !== null,
        phase: controllerPhase,
      }),
      now: () => NOW,
    })

    expect(availability.getSnapshot().visible).toBe(false)

    // The task finishes: the controller clears it synchronously and notifies,
    // while React has not re-rendered yet.
    controllerTask = null
    availability.refresh({ kind: "task-transition" })

    // The failure path then moves the phase off "analyzing"; the phase writer
    // refreshes too, so the final published snapshot is the correct one.
    controllerPhase = "error"
    availability.refresh({ kind: "phase" })

    const view = availability.getSnapshot()
    expect(view.visible).toBe(true)
    expect(view.reason).toBeNull()
    // Sanity: the stale render-era values would still have said "conflict",
    // which is exactly what made the button invisible in the browser.
    expect(computeFinalResumeConflict({
      taskActive: renderEraTask !== null,
      phase: "analyzing",
    })).toBe(true)
  })

  it("stops reporting a conflict as soon as the task is gone, even if the phase lags", () => {
    // The worst case the browser hit: the controller released the task but the
    // phase variable had not moved yet. Release alone must clear the conflict,
    // because a finished task is not a running task.
    const availability = createFinalResumeAvailability({
      readMetadata: availableMetadata,
      readIdentity: identity,
      readCurrentIdentity: identity,
      hasConflict: () => computeFinalResumeConflict({
        taskActive: false,
        // A phase left over from the finished run must not resurrect the block.
        phase: "analyzing",
        taskReleased: true,
      }),
      now: () => NOW,
    })

    expect(availability.getSnapshot().visible).toBe(true)
  })

  it("keeps treating a genuinely running task as a conflict", () => {
    for (const phase of ["loading-transcript", "analyzing", "finalizing", "cancelling"]) {
      expect(computeFinalResumeConflict({ taskActive: false, phase })).toBe(true)
    }
    expect(computeFinalResumeConflict({ taskActive: true, phase: "idle" })).toBe(true)
  })

  it("does not treat a finished or failed phase as a conflict", () => {
    for (const phase of ["idle", "error", "cancelled", "completed"]) {
      expect(computeFinalResumeConflict({ taskActive: false, phase })).toBe(false)
    }
  })
})

describe("final resume TTL scheduler survives a missing checkpoint", () => {
  it("keeps wake-ups alive when there is no expiry yet", () => {
    // A panel that mounts without a checkpoint (and one whose checkpoint was
    // discarded) must still wake up later: the checkpoint can appear while the
    // panel stays open, and a wrong snapshot must be correctable.
    const timers = createFakeTimers(NOW)
    let expiresAt: number | null = null
    let refreshCount = 0
    const scheduler = createFinalResumeTtlScheduler({
      readExpiresAt: () => expiresAt,
      refresh: () => {
        refreshCount += 1
      },
      now: timers.now,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      maxDelayMs: 30_000,
    })

    scheduler.start()
    // `start` evaluates once, then arms a bounded fallback because there is
    // still no expiry to target.
    expect(refreshCount).toBe(1)
    expect(timers.pendingCount()).toBe(1)

    timers.advanceBy(30_000)
    expect(refreshCount).toBe(2)

    // A checkpoint appeared in the meantime; the next wake-up must honour it.
    expiresAt = timers.now() + 5_000
    timers.advanceBy(30_000)
    expect(refreshCount).toBeGreaterThanOrEqual(3)
    scheduler.stop()
  })

  it("stops arming once the checkpoint has expired, without spinning", () => {
    const timers = createFakeTimers(NOW)
    let refreshCount = 0
    const scheduler = createFinalResumeTtlScheduler({
      readExpiresAt: () => NOW - 1,
      refresh: () => {
        refreshCount += 1
      },
      now: timers.now,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      maxDelayMs: 30_000,
    })

    scheduler.start()
    expect(refreshCount).toBe(1)
    timers.advanceBy(10 * 30_000)
    expect(refreshCount).toBe(1)
    scheduler.stop()
  })
})

/**
 * Ordering safety for the release carve-out.
 *
 * `taskReleased` only ever clears a *lagging phase*; it must never weaken the
 * rule that a running task blocks the entry, including a task that starts again
 * right after a release.
 */
describe("final resume conflict ordering", () => {
  it("treats a new task as a conflict from its very first notification", () => {
    // The controller publishes the active task before any analysis phase exists.
    expect(computeFinalResumeConflict({ taskActive: true, phase: "idle" })).toBe(true)
    expect(computeFinalResumeConflict({ taskActive: true, phase: "error" })).toBe(true)
  })

  it("keeps a restarted task a conflict even though a release was observed", () => {
    expect(computeFinalResumeConflict({
      taskActive: true,
      phase: "error",
      taskReleased: true,
    })).toBe(true)
  })

  it("still blocks on loading-transcript before any task exists", () => {
    // A destructive operation can hold the workspace with no analysis task yet.
    expect(computeFinalResumeConflict({
      taskActive: false,
      phase: "loading-transcript",
      taskReleased: false,
    })).toBe(true)
  })
})

/**
 * End-to-end reproduction of the real-browser smoke failure.
 *
 * Sequence that broke: five Map calls succeed, Final returns HTTP 502, the
 * checkpoint becomes available, the task finishes — and the "continue final
 * summary" button never appeared. This drives the same order through the real
 * modules (availability + conflict + scheduler) with one shared clock.
 */
describe("final resume after a Final 502", () => {
  it("shows the entry the instant the failed task releases, then hides it at the TTL", () => {
    const timers = createFakeTimers(NOW)
    let taskActive = true
    let phase = "finalizing"
    let taskReleased = false
    // The checkpoint only exists once the Final call has failed.
    let expiresAt: number | null = null

    const identity = (): FinalResumeIdentity => ({
      sourceTabId: 7,
      contentKey: "youtube:abc",
      partId: null,
      title: "Video",
      durationSec: 600,
      transcriptFingerprint: "fingerprint-1",
      providerProfileId: "profile-1",
      analysisPresetId: "standard",
    })
    const availability = createFinalResumeAvailability({
      readMetadata: () => ({
        state: expiresAt === null ? "empty" : "available",
        generation: 3,
        createdAt: NOW,
        expiresAt,
        summaryBytes: 512,
        failure: expiresAt === null ? null : { kind: "http", status: 502 },
        invalidationReason: null,
      }),
      readIdentity: identity,
      readCurrentIdentity: identity,
      hasConflict: () => computeFinalResumeConflict({ taskActive, phase, taskReleased }),
      now: timers.now,
    })

    const published: boolean[] = []
    availability.subscribe(() => {
      published.push(availability.getSnapshot().visible)
    })
    const scheduler = createFinalResumeTtlScheduler({
      readExpiresAt: () => expiresAt,
      refresh: () => availability.refresh({ kind: "ttl" }),
      now: timers.now,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      idleRecheckMs: 30_000,
    })
    scheduler.start()

    // The Final request fails: the checkpoint exists, but the task still runs.
    expiresAt = NOW + 30 * 60_000
    availability.refresh({ kind: "final-failed" })
    expect(availability.getSnapshot().visible).toBe(false)

    // The task finishes. React has not re-rendered, so `phase` still reads the
    // phase of the run that just ended.
    taskActive = false
    taskReleased = true
    availability.refresh({ kind: "task-transition" })

    const view = availability.getSnapshot()
    expect(view.visible).toBe(true)
    expect(view.reason).toBeNull()
    expect(view.canStart).toBe(true)
    expect(view.status).toEqual({ kind: "http", status: 502 })
    expect(published.at(-1)).toBe(true)

    // It stays available for the whole TTL, then disappears on the exact
    // boundary without a manual refresh.
    timers.advanceBy(30 * 60_000 - 1)
    expect(availability.getSnapshot().visible).toBe(true)
    timers.advanceBy(1)
    expect(availability.getSnapshot().visible).toBe(false)
    expect(availability.getSnapshot().reason).toBe("expired")
    scheduler.stop()
  })
})

/**
 * Regression: "continue final summary" never appeared after a Final 502.
 *
 * `finalResumeCheckpointIdentityRef` (the *expected* side of the identity
 * comparison) was never seeded: it stayed the all-null initial snapshot, so
 * `identityMismatchReason` hit `expected.sourceTabId !== current.sourceTabId`
 * on the first line and always reported `tab-changed`.
 *
 * The naive fix — overwriting `expected` whenever the checkpoint is not empty —
 * would be worse: it makes expected equal current on every identity change and
 * silently disables the whole protection. The seed must therefore be a one-shot
 * invariant, transition-driven, and pinned by the A/B test below.
 */
describe("checkpoint identity seeding", () => {
  const initial = (): FinalResumeIdentity => ({
    sourceTabId: null,
    contentKey: null,
    partId: null,
    title: null,
    durationSec: null,
    transcriptFingerprint: null,
    providerProfileId: null,
    analysisPresetId: "standard",
  })
  const onA = (): FinalResumeIdentity => ({
    sourceTabId: 7,
    contentKey: "youtube:A",
    partId: null,
    title: "Video A",
    durationSec: 600,
    transcriptFingerprint: "fp-a",
    providerProfileId: "profile-1",
    analysisPresetId: "standard",
  })
  const onB = (): FinalResumeIdentity => ({
    sourceTabId: 7,
    contentKey: "youtube:B",
    partId: null,
    title: "Video B",
    durationSec: 900,
    transcriptFingerprint: "fp-b",
    providerProfileId: "profile-1",
    analysisPresetId: "standard",
  })

  it("seeds expected exactly once on the empty -> available transition", () => {
    const transition = resolveCheckpointIdentityTransition({
      previousState: "empty",
      nextState: "available",
      previousExpected: initial(),
      currentIdentity: onA(),
    })

    expect(transition.kind).toBe("seeded")
    expect(transition.expected).toEqual(onA())
  })

  it("prefers the task snapshot that actually bound the checkpoint", () => {
    // The live context may already have drifted; the task owns the truth.
    const transition = resolveCheckpointIdentityTransition({
      previousState: "empty",
      nextState: "available",
      previousExpected: initial(),
      currentIdentity: onB(),
      taskIdentity: onA(),
    })

    expect(transition.expected).toEqual(onA())
  })

  it("never overwrites expected while the checkpoint stays non-empty", () => {
    // The A -> B switch: the effect re-runs because videoContext changed, but
    // an existing checkpoint still belongs to A.
    const transition = resolveCheckpointIdentityTransition({
      previousState: "available",
      nextState: "available",
      previousExpected: onA(),
      currentIdentity: onB(),
      taskIdentity: onB(),
    })

    expect(transition.kind).toBe("unchanged")
    expect(transition.expected).toEqual(onA())
  })

  it("clears expected when the checkpoint returns to empty, so the next one reseeds", () => {
    const cleared = resolveCheckpointIdentityTransition({
      previousState: "available",
      nextState: "empty",
      previousExpected: onA(),
      currentIdentity: onB(),
    })
    expect(cleared.kind).toBe("cleared")
    expect(cleared.expected).toEqual(initial())

    const reseeded = resolveCheckpointIdentityTransition({
      previousState: "empty",
      nextState: "available",
      previousExpected: cleared.expected,
      currentIdentity: onB(),
    })
    expect(reseeded.kind).toBe("seeded")
    expect(reseeded.expected).toEqual(onB())
  })

  it("seeds from a candidate checkpoint too, because the entry gate still needs it", () => {
    // A candidate is not visible, but once it is promoted to available the
    // expected side must already be correct; seeding at candidate time keeps
    // the promotion from depending on an unrelated re-render.
    const transition = resolveCheckpointIdentityTransition({
      previousState: "empty",
      nextState: "candidate",
      previousExpected: initial(),
      currentIdentity: onA(),
    })
    expect(transition.kind).toBe("seeded")
    expect(transition.expected).toEqual(onA())
  })

  it("A/B regression: a checkpoint bound to A must never validate against B", () => {
    // Seed while the checkpoint belongs to A.
    const seeded = resolveCheckpointIdentityTransition({
      previousState: "empty",
      nextState: "available",
      previousExpected: initial(),
      currentIdentity: onA(),
    })

    // The user switches to B. The transition must keep A as expected.
    const afterSwitch = resolveCheckpointIdentityTransition({
      previousState: "available",
      nextState: "available",
      previousExpected: seeded.expected,
      currentIdentity: onB(),
      taskIdentity: onB(),
    })
    expect(afterSwitch.expected).toEqual(onA())

    // With the real availability module, that mismatch must hide the entry.
    const availability = createFinalResumeAvailability({
      readMetadata: () => ({
        state: "available",
        generation: 3,
        createdAt: NOW - 60_000,
        expiresAt: NOW + 29 * 60_000,
        summaryBytes: 512,
        failure: { kind: "http", status: 502 },
        invalidationReason: null,
      }),
      readIdentity: () => afterSwitch.expected,
      readCurrentIdentity: () => onB(),
      hasConflict: () => false,
      now: () => NOW,
    })

    const view = availability.getSnapshot()
    expect(view.visible).toBe(false)
    expect(view.reason).toBe("content-key-changed")
  })

  it("A/B regression: the seeded identity makes the entry visible on A", () => {
    // This is the assertion the real browser failed: with expected seeded from
    // the checkpoint's own source, the button must be visible.
    const seeded = resolveCheckpointIdentityTransition({
      previousState: "empty",
      nextState: "available",
      previousExpected: initial(),
      currentIdentity: onA(),
    })

    const availability = createFinalResumeAvailability({
      readMetadata: () => ({
        state: "available",
        generation: 3,
        createdAt: NOW - 60_000,
        expiresAt: NOW + 29 * 60_000,
        summaryBytes: 512,
        failure: { kind: "http", status: 502 },
        invalidationReason: null,
      }),
      readIdentity: () => seeded.expected,
      readCurrentIdentity: () => onA(),
      hasConflict: () => false,
      now: () => NOW,
    })

    const view = availability.getSnapshot()
    expect(view.visible).toBe(true)
    expect(view.reason).toBeNull()
  })
})

/**
 * Full smoke path through the real modules: Map succeeds, the Final request
 * returns 502, the candidate checkpoint is promoted to `available`, then the
 * task releases while React has not re-rendered yet.
 *
 * This is the exact sequence in which the real browser never showed the button,
 * and it also pins that seeding did not weaken the identity protection.
 */
describe("smoke path: Final 502 -> candidate promoted -> task released", () => {
  it("shows the button after seeding, and still hides it for the wrong video", () => {
    const NOW = 2_000_000
    const task = { tab: 61499778, key: "youtube:smokeVideo1", part: null, title: "Smoke", dur: 300, fp: "fp1", prov: "p1", preset: "standard" as const }

    // --- before any checkpoint ---
    let expected = emptyFinalResumeIdentity(task.preset)
    let state: FinalCheckpointMetadata["state"] = "empty"
    let taskActive = true
    let released = false

    const avail = createFinalResumeAvailability({
      readMetadata: () => ({
        state,
        generation: 1,
        createdAt: state === "empty" ? null : NOW,
        expiresAt: state === "available" ? NOW + 29 * 60_000 : null,
        summaryBytes: state === "available" ? 512 : 0,
        failure: state === "available" ? { kind: "http", status: 502 } : null,
        invalidationReason: null,
      }),
      readIdentity: () => expected,
      readCurrentIdentity: () => ({
        sourceTabId: task.tab, contentKey: task.key, partId: task.part, title: task.title,
        durationSec: task.dur, transcriptFingerprint: task.fp, providerProfileId: task.prov,
        analysisPresetId: task.preset,
      }),
      hasConflict: () => computeFinalResumeConflict({ taskActive, phase: "analyzing", taskReleased: released }),
      now: () => NOW,
    })

    // 1. Map done; the checkpoint candidate is created before the Final request.
    let prev: FinalCheckpointMetadata["state"] = state
    state = "candidate"
    let t = resolveCheckpointIdentityTransition({
      previousState: prev, nextState: state, previousExpected: expected,
      currentIdentity: { sourceTabId: task.tab, contentKey: task.key, partId: task.part, title: task.title, durationSec: task.dur, transcriptFingerprint: task.fp, providerProfileId: task.prov, analysisPresetId: task.preset },
      taskIdentity: { sourceTabId: task.tab, contentKey: task.key, partId: task.part, title: task.title, durationSec: task.dur, transcriptFingerprint: task.fp, providerProfileId: task.prov, analysisPresetId: task.preset },
    })
    expected = t.expected
    expect(t.kind).toBe("seeded")
    avail.refresh({ kind: "checkpoint-seeded" })
    // Candidate is not offered, but the task is still running anyway.
    expect(avail.getSnapshot().visible).toBe(false)

    // 2. Final returned 502 -> the candidate is promoted to available.
    prev = state
    state = "available"
    t = resolveCheckpointIdentityTransition({
      previousState: prev, nextState: state, previousExpected: expected,
      currentIdentity: { sourceTabId: task.tab, contentKey: task.key, partId: task.part, title: task.title, durationSec: task.dur, transcriptFingerprint: task.fp, providerProfileId: task.prov, analysisPresetId: task.preset },
    })
    expected = t.expected
    expect(t.kind).toBe("unchanged") // already seeded at candidate time
    avail.refresh({ kind: "checkpoint-promoted" })
    // Task still active -> conflict, correctly hidden.
    expect(avail.getSnapshot().visible).toBe(false)
    expect(avail.getSnapshot().reason).toBe("conflict")

    // 3. Task releases. React has not re-rendered (phase still "analyzing").
    taskActive = false
    released = true
    avail.refresh({ kind: "task-transition" })

    const view = avail.getSnapshot()
    // This is what the real browser never showed.
    expect(view.visible).toBe(true)
    expect(view.reason).toBeNull()
    expect(view.canStart).toBe(true)
    expect(view.status).toEqual({ kind: "http", status: 502 })

    // 4. Identity protection intact: the same checkpoint must not resume on B.
    const onB = createFinalResumeAvailability({
      readMetadata: () => ({
        state: "available", generation: 1, createdAt: NOW, expiresAt: NOW + 29 * 60_000,
        summaryBytes: 512, failure: { kind: "http", status: 502 }, invalidationReason: null,
      }),
      readIdentity: () => expected, // still bound to A
      readCurrentIdentity: () => ({
        sourceTabId: task.tab, contentKey: "youtube:otherVideo", partId: null, title: "Other",
        durationSec: 900, transcriptFingerprint: "fp2", providerProfileId: task.prov,
        analysisPresetId: task.preset,
      }),
      hasConflict: () => false,
      now: () => NOW,
    })
    expect(onB.getSnapshot().visible).toBe(false)
    expect(onB.getSnapshot().reason).toBe("content-key-changed")
  })
})

/**
 * Identity protection across a real A -> B -> A switch, driven through the same
 * transition resolver the Side Panel uses. The seeding fix must not have turned
 * `expected` into a mirror of the live identity.
 */
describe("A/B protection through transitions", () => {
  const idA = (tab = 7): FinalResumeIdentity => ({
    sourceTabId: tab,
    contentKey: "youtube:A",
    partId: null,
    title: "A",
    durationSec: 600,
    transcriptFingerprint: "fpA",
    providerProfileId: "p1",
    analysisPresetId: "standard",
  })
  const idB = (tab = 7): FinalResumeIdentity => ({
    sourceTabId: tab,
    contentKey: "youtube:B",
    partId: null,
    title: "B",
    durationSec: 900,
    transcriptFingerprint: "fpB",
    providerProfileId: "p1",
    analysisPresetId: "standard",
  })
  const availabilityFor = (expected: FinalResumeIdentity, current: FinalResumeIdentity) =>
    createFinalResumeAvailability({
      readMetadata: () => ({
        state: "available",
        generation: 1,
        createdAt: 0,
        expiresAt: 10_000_000,
        summaryBytes: 512,
        failure: { kind: "http", status: 502 },
        invalidationReason: null,
      }),
      readIdentity: () => expected,
      readCurrentIdentity: () => current,
      hasConflict: () => false,
      now: () => 1_000,
    })

  it("keeps the entry hidden when switching A -> B, visible on A", () => {
    let expected = emptyFinalResumeIdentity("standard")
    // seed on A
    let t = resolveCheckpointIdentityTransition({ previousState: "empty", nextState: "available", previousExpected: expected, currentIdentity: idA(), taskIdentity: idA() })
    expected = t.expected
    expect(availabilityFor(expected, idA()).getSnapshot().visible).toBe(true)

    // switch to B: reconcile runs again with nextState still "available"
    const t2 = resolveCheckpointIdentityTransition({ previousState: "available", nextState: "available", previousExpected: expected, currentIdentity: idB(), taskIdentity: idB() })
    expect(t2.kind).toBe("unchanged")
    expect(t2.expected).toEqual(idA())
    const v = availabilityFor(t2.expected, idB()).getSnapshot()
    expect(v.visible).toBe(false)
    expect(v.reason).toBe("content-key-changed")

    // back to A: expected still A -> visible again
    const t3 = resolveCheckpointIdentityTransition({ previousState: "available", nextState: "available", previousExpected: t2.expected, currentIdentity: idA(), taskIdentity: idA() })
    expect(availabilityFor(t3.expected, idA()).getSnapshot().visible).toBe(true)
  })

  it("tab change is caught even for the same content", () => {
    let expected: FinalResumeIdentity = emptyFinalResumeIdentity("standard")
    expected = resolveCheckpointIdentityTransition({ previousState: "empty", nextState: "available", previousExpected: expected, currentIdentity: idA(7) }).expected
    const v = availabilityFor(expected, idA(9)).getSnapshot()
    expect(v.visible).toBe(false)
    expect(v.reason).toBe("tab-changed")
  })
})
