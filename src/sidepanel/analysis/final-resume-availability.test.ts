import { describe, expect, it } from "bun:test"

import type { FinalCheckpointMetadata } from "@/features/analysis/lib/final-resume-checkpoint"

import {
  createFinalResumeAvailability,
  describeFinalResumeAvailability,
  type FinalResumeIdentity,
} from "./final-resume-availability"

const NOW = 1_000_000

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
