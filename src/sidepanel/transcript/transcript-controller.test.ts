import { describe, expect, it } from "bun:test"

import type { TranscriptSegment, VideoIdentity } from "@/features/platform/types"
import { TranscriptController } from "@/sidepanel/transcript/transcript-controller"

const cues: TranscriptSegment[] = [
  { startSec: 0, endSec: 5, text: "Hello" },
  { startSec: 5, endSec: 10, text: "World" },
]

const identity: VideoIdentity = {
  platform: "youtube",
  videoId: "video-a",
  contentKey: "youtube:video-a",
}

const publication = {
  cues,
  identity,
  title: "Video A",
  fingerprint: "fingerprint-a",
  rawVtt: "WEBVTT",
}

describe("TranscriptController", () => {
  it("starts with the empty transcript snapshot", () => {
    expect(new TranscriptController().getSnapshot()).toEqual({
      cues: [],
      identity: null,
      title: null,
      fingerprint: null,
      rawVtt: null,
      error: null,
      isLoading: false,
    })
  })

  it("notifies subscribers once for a mutation and stops after unsubscribe", () => {
    const controller = new TranscriptController()
    let notifications = 0
    const unsubscribe = controller.subscribe(() => {
      notifications += 1
    })

    controller.setLoading(true)
    expect(notifications).toBe(1)
    unsubscribe()
    controller.setLoading(false)
    expect(notifications).toBe(1)
  })

  it("publishes data fields while preserving error and loading", () => {
    const controller = new TranscriptController()
    controller.setError("existing error")
    controller.setLoading(true)

    controller.publish(publication)

    expect(controller.getSnapshot()).toEqual({
      ...publication,
      error: "existing error",
      isLoading: true,
    })
  })

  it("changes only the fingerprint through setFingerprint", () => {
    const controller = new TranscriptController()
    controller.publish(publication)

    controller.setFingerprint("fingerprint-b")

    expect(controller.getSnapshot()).toEqual({
      ...publication,
      fingerprint: "fingerprint-b",
      error: null,
      isLoading: false,
    })
  })

  it("changes only the error through setError", () => {
    const controller = new TranscriptController()
    controller.publish(publication)

    controller.setError("failed")

    expect(controller.getSnapshot()).toEqual({
      ...publication,
      error: "failed",
      isLoading: false,
    })
  })

  it("changes only loading through setLoading", () => {
    const controller = new TranscriptController()
    controller.publish(publication)

    controller.setLoading(true)

    expect(controller.getSnapshot()).toEqual({
      ...publication,
      error: null,
      isLoading: true,
    })
  })

  it("resets data, error, and loading together", () => {
    const controller = new TranscriptController()
    controller.setError("failed")
    controller.setLoading(true)
    controller.publish(publication)

    controller.reset()

    expect(controller.getSnapshot()).toEqual({
      cues: [],
      identity: null,
      title: null,
      fingerprint: null,
      rawVtt: null,
      error: null,
      isLoading: false,
    })
  })

  it("does not notify when a command leaves the snapshot unchanged", () => {
    const controller = new TranscriptController()
    let notifications = 0
    controller.subscribe(() => {
      notifications += 1
    })

    controller.setLoading(false)
    controller.setError(null)
    controller.publish({ ...publication, cues: [...publication.cues], identity: { ...identity } })
    expect(notifications).toBe(1)
  })

  it("does not expose mutable internal arrays or objects", () => {
    const controller = new TranscriptController()
    const inputCues = cues.map((cue) => ({ ...cue }))
    const inputIdentity = { ...identity }
    controller.publish({ ...publication, cues: inputCues, identity: inputIdentity })

    inputCues[0].text = "mutated input"
    inputIdentity.videoId = "mutated-input"
    const returned = controller.getSnapshot()
    returned.cues[0].text = "mutated output"
    if (returned.identity) returned.identity.videoId = "mutated-output"

    expect(controller.getSnapshot()).toEqual({
      ...publication,
      cues,
      identity,
      error: null,
      isLoading: false,
    })
  })

  it("starts with load epoch token zero", () => {
    const controller = new TranscriptController()

    expect(controller.captureLoadEpoch()).toBe(0)
    expect(controller.isLoadEpochCurrent(0)).toBe(true)
  })

  it("increments load epochs and invalidates older tokens", () => {
    const controller = new TranscriptController()

    const first = controller.beginLoadEpoch()
    const second = controller.beginLoadEpoch()

    expect(first).toBe(1)
    expect(second).toBe(2)
    expect(controller.isLoadEpochCurrent(first)).toBe(false)
    expect(controller.isLoadEpochCurrent(second)).toBe(true)
  })

  it("invalidates a captured epoch once per invalidation", () => {
    const controller = new TranscriptController()
    const captured = controller.captureLoadEpoch()

    expect(controller.invalidateLoadEpoch()).toBe(1)
    expect(controller.invalidateLoadEpoch()).toBe(2)
    expect(controller.captureLoadEpoch()).toBe(2)
    expect(controller.isLoadEpochCurrent(captured)).toBe(false)
  })

  it("captures the current epoch without changing it", () => {
    const controller = new TranscriptController()
    controller.beginLoadEpoch()

    expect(controller.captureLoadEpoch()).toBe(1)
    expect(controller.captureLoadEpoch()).toBe(1)
  })

  it("does not notify snapshot subscribers for epoch changes", () => {
    const controller = new TranscriptController()
    let notifications = 0
    controller.subscribe(() => {
      notifications += 1
    })

    controller.beginLoadEpoch()
    controller.invalidateLoadEpoch()

    expect(notifications).toBe(0)
  })

  it("does not implicitly invalidate the load epoch on reset", () => {
    const controller = new TranscriptController()
    const epoch = controller.beginLoadEpoch()
    controller.publish(publication)

    controller.reset()

    expect(controller.captureLoadEpoch()).toBe(epoch)
    expect(controller.isLoadEpochCurrent(epoch)).toBe(true)
    expect(controller.getSnapshot()).toEqual({
      cues: [],
      identity: null,
      title: null,
      fingerprint: null,
      rawVtt: null,
      error: null,
      isLoading: false,
    })
  })
})
