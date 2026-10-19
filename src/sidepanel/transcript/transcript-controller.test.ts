import { describe, expect, it } from "bun:test"

import type { TranscriptSegment, VideoIdentity, VideoInfo } from "@/features/platform/types"
import type { TranscriptCacheEntity } from "@/lib/schemas/persistence"
import { computeTranscriptFingerprint } from "@/lib/persistence/cache-identity"
import type { CurrentTranscriptResult } from "@/sidepanel/lib/load-current-transcript"
import type {
  CachedTranscriptCandidate,
  TranscriptAcquisitionRequest,
} from "@/sidepanel/transcript/transcript-acquisition"
import { buildTranscriptCacheWrite } from "@/sidepanel/transcript/transcript-finalization"
import {
  TranscriptController,
  type TranscriptControllerDependencies,
} from "@/sidepanel/transcript/transcript-controller"

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

const video: VideoInfo = {
  ...identity,
  title: "Video A",
  author: "Author A",
  canonicalUrl: "https://www.youtube.com/watch?v=video-a",
}

const request: TranscriptAcquisitionRequest = { video }

const result: CurrentTranscriptResult = {
  video,
  transcript: {
    segments: cues,
    source: "manual",
    language: "en",
    raw: { format: "vtt", text: "WEBVTT", sourceUrl: "https://captions.example/video-a.vtt" },
  },
}

const cachedCandidate: CachedTranscriptCandidate = {
  platform: "youtube",
  videoId: "video-a",
  partId: null,
  contentKey: "youtube:video-a",
  language: "en",
  rawVtt: "WEBVTT",
  sourceUrl: "https://captions.example/video-a.vtt",
  cues,
}

const fixedNow = "2026-10-20T10:00:00.000Z"

function createController(
  overrides: Partial<TranscriptControllerDependencies> = {},
): TranscriptController {
  return new TranscriptController({
    readCached: async () => null,
    loadRemote: async () => result,
    saveCache: async () => undefined,
    now: () => fixedNow,
    ...overrides,
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe("TranscriptController", () => {
  it("starts with the empty transcript snapshot", () => {
    expect(createController().getSnapshot()).toEqual({
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
    const controller = createController()
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
    const controller = createController()
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
    const controller = createController()
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
    const controller = createController()
    controller.publish(publication)

    controller.setError("failed")

    expect(controller.getSnapshot()).toEqual({
      ...publication,
      error: "failed",
      isLoading: false,
    })
  })

  it("changes only loading through setLoading", () => {
    const controller = createController()
    controller.publish(publication)

    controller.setLoading(true)

    expect(controller.getSnapshot()).toEqual({
      ...publication,
      error: null,
      isLoading: true,
    })
  })

  it("resets data, error, and loading together", () => {
    const controller = createController()
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
    const controller = createController()
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
    const controller = createController()
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
    const controller = createController()

    expect(controller.captureLoadEpoch()).toBe(0)
    expect(controller.isLoadEpochCurrent(0)).toBe(true)
  })

  it("increments load epochs and invalidates older tokens", () => {
    const controller = createController()

    const first = controller.beginLoadEpoch()
    const second = controller.beginLoadEpoch()

    expect(first).toBe(1)
    expect(second).toBe(2)
    expect(controller.isLoadEpochCurrent(first)).toBe(false)
    expect(controller.isLoadEpochCurrent(second)).toBe(true)
  })

  it("invalidates a captured epoch once per invalidation", () => {
    const controller = createController()
    const captured = controller.captureLoadEpoch()

    expect(controller.invalidateLoadEpoch()).toBe(1)
    expect(controller.invalidateLoadEpoch()).toBe(2)
    expect(controller.captureLoadEpoch()).toBe(2)
    expect(controller.isLoadEpochCurrent(captured)).toBe(false)
  })

  it("captures the current epoch without changing it", () => {
    const controller = createController()
    controller.beginLoadEpoch()

    expect(controller.captureLoadEpoch()).toBe(1)
    expect(controller.captureLoadEpoch()).toBe(1)
  })

  it("does not notify snapshot subscribers for epoch changes", () => {
    const controller = createController()
    let notifications = 0
    controller.subscribe(() => {
      notifications += 1
    })

    controller.beginLoadEpoch()
    controller.invalidateLoadEpoch()

    expect(notifications).toBe(0)
  })

  it("does not implicitly invalidate the load epoch on reset", () => {
    const controller = createController()
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

  it("starts current loading in a new epoch and clears the prior error before acquisition", async () => {
    const events: string[] = []
    let controller: TranscriptController
    controller = createController({
      readCached: async () => {
        events.push("readCached")
        expect(controller.getSnapshot()).toMatchObject({ isLoading: true, error: null })
        return null
      },
      loadRemote: async ({ isCurrent }) => {
        events.push("loadRemote")
        expect(isCurrent()).toBe(true)
        return result
      },
    })
    controller.setError("previous error")

    await controller.loadCurrent({ request, forceReload: false, isTargetCurrent: () => true })

    expect(controller.captureLoadEpoch()).toBe(1)
    expect(events).toEqual(["readCached", "loadRemote"])
    expect(controller.getSnapshot()).toMatchObject({ isLoading: false, error: null })
  })

  it("reuses the matching controller session without reading cache or remote", async () => {
    let cacheCalls = 0
    let remoteCalls = 0
    const controller = createController({
      readCached: async () => { cacheCalls += 1; return null },
      loadRemote: async () => { remoteCalls += 1; return result },
    })
    controller.publish(publication)

    const loaded = await controller.loadCurrent({ request, forceReload: false, isTargetCurrent: () => true })

    expect(loaded.transcript.segments).toEqual(cues)
    expect(cacheCalls).toBe(0)
    expect(remoteCalls).toBe(0)
  })

  it("force reload skips session and cache and calls remote once", async () => {
    let cacheCalls = 0
    let remoteCalls = 0
    const controller = createController({
      readCached: async () => { cacheCalls += 1; return cachedCandidate },
      loadRemote: async () => { remoteCalls += 1; return result },
    })
    controller.publish(publication)

    await controller.loadCurrent({ request, forceReload: true, isTargetCurrent: () => true })

    expect(cacheCalls).toBe(0)
    expect(remoteCalls).toBe(1)
  })

  it("uses a cached candidate without calling remote", async () => {
    let remoteCalls = 0
    const controller = createController({
      readCached: async (contentKey) => {
        expect(contentKey).toBe(video.contentKey)
        return cachedCandidate
      },
      loadRemote: async () => { remoteCalls += 1; return result },
    })

    const loaded = await controller.loadCurrent({ request, forceReload: false, isTargetCurrent: () => true })

    expect(loaded.video.contentKey).toBe(video.contentKey)
    expect(loaded.transcript.segments).toEqual(cues)
    expect(remoteCalls).toBe(0)
  })

  it("forwards the request, including sourceTabId, to the remote dependency", async () => {
    let receivedRequest: TranscriptAcquisitionRequest | undefined
    const controller = createController({
      readCached: async () => null,
      loadRemote: async ({ request: remoteRequest }) => {
        receivedRequest = remoteRequest
        return result
      },
    })
    const taskLikeRequest = { ...request, sourceTabId: 42 }

    await controller.loadCurrent({ request: taskLikeRequest, forceReload: true, isTargetCurrent: () => true })

    expect(receivedRequest).toEqual(taskLikeRequest)
  })

  it("publishes the finalized transcript and persists the exact payload with injected time", async () => {
    let saved: TranscriptCacheEntity | undefined
    const controller = createController({
      readCached: async () => null,
      loadRemote: async () => result,
      saveCache: async (payload) => { saved = payload },
      now: () => fixedNow,
    })

    await controller.loadCurrent({ request, forceReload: true, isTargetCurrent: () => true })

    const snapshot = controller.getSnapshot()
    expect(snapshot).toMatchObject({
      cues,
      identity,
      title: video.title,
      rawVtt: result.transcript.raw?.text,
      error: null,
      isLoading: false,
    })
    expect(snapshot.fingerprint).toBe(await computeTranscriptFingerprint(cues))
    expect(saved).toEqual(buildTranscriptCacheWrite({
      result,
      fingerprint: snapshot.fingerprint,
      now: fixedNow,
    }))
  })

  it("calls fingerprint invalidation once, after fingerprint resolution and before publication", async () => {
    const previousFingerprint = "previous-fingerprint"
    const expectedFingerprint = await computeTranscriptFingerprint(cues)
    const events: string[] = []
    const controller = createController({
      readCached: async () => null,
      loadRemote: async () => result,
    })
    controller.setFingerprint(previousFingerprint)
    let observedFingerprint = previousFingerprint
    controller.subscribe(() => {
      const fingerprint = controller.getSnapshot().fingerprint
      if (fingerprint !== observedFingerprint) {
        observedFingerprint = fingerprint ?? ""
        events.push("publish")
      }
    })

    await controller.loadCurrent({
      request,
      forceReload: true,
      isTargetCurrent: () => true,
      onFingerprintChanged: (change) => {
        events.push("fingerprint")
        expect(change.previousFingerprint).toBe(previousFingerprint)
        expect(change.fingerprint).toBe(expectedFingerprint)
      },
    })

    expect(events).toEqual(["fingerprint", "publish"])
  })

  it("does not call fingerprint invalidation when the previous fingerprint is null", async () => {
    let callbackCalls = 0
    const controller = createController()

    await controller.loadCurrent({
      request,
      forceReload: true,
      isTargetCurrent: () => true,
      onFingerprintChanged: () => { callbackCalls += 1 },
    })

    expect(callbackCalls).toBe(0)
  })

  it("does not call fingerprint invalidation when the fingerprint is unchanged", async () => {
    const fingerprint = await computeTranscriptFingerprint(cues)
    let callbackCalls = 0
    const controller = createController()
    controller.setFingerprint(fingerprint)

    await controller.loadCurrent({
      request,
      forceReload: true,
      isTargetCurrent: () => true,
      onFingerprintChanged: () => { callbackCalls += 1 },
    })

    expect(callbackCalls).toBe(0)
  })

  it("calls onPublished once with committed state before cache persistence", async () => {
    const events: string[] = []
    const controller = createController({
      readCached: async () => null,
      loadRemote: async () => result,
      saveCache: async () => { events.push("saveCache") },
    })
    let publishedFingerprint: string | null | undefined

    await controller.loadCurrent({
      request,
      forceReload: true,
      isTargetCurrent: () => true,
      onPublished: (snapshot) => {
        events.push("onPublished")
        publishedFingerprint = snapshot.fingerprint
        expect(controller.getSnapshot().fingerprint).toBe(snapshot.fingerprint)
      },
    })

    expect(events).toEqual(["onPublished", "saveCache"])
    expect(publishedFingerprint).toBe(controller.getSnapshot().fingerprint)
  })

  it("keeps publication and rejects the original cache error while clearing current loading", async () => {
    const persistenceError = new Error("quota exceeded")
    const controller = createController({
      readCached: async () => null,
      loadRemote: async () => result,
      saveCache: async () => { throw persistenceError },
    })

    await expect(controller.loadCurrent({
      request,
      forceReload: true,
      isTargetCurrent: () => true,
    })).rejects.toBe(persistenceError)

    expect(controller.getSnapshot()).toMatchObject({
      cues,
      identity,
      error: persistenceError.message,
      isLoading: false,
    })
  })

  it("stores and rethrows an acquisition error for the current request", async () => {
    const acquisitionError = new Error("caption service failed")
    const controller = createController({
      readCached: async () => null,
      loadRemote: async () => { throw acquisitionError },
    })

    await expect(controller.loadCurrent({
      request,
      forceReload: true,
      isTargetCurrent: () => true,
    })).rejects.toBe(acquisitionError)

    expect(controller.getSnapshot()).toMatchObject({
      identity: null,
      error: acquisitionError.message,
      isLoading: false,
    })
  })

  it("rejects target-stale results without publishing or setting stale error state", async () => {
    const pending = deferred<CurrentTranscriptResult>()
    let targetCurrent = true
    const controller = createController({
      readCached: async () => null,
      loadRemote: async () => pending.promise,
    })
    const loading = controller.loadCurrent({
      request,
      forceReload: true,
      isTargetCurrent: () => targetCurrent,
    })
    targetCurrent = false
    controller.reset()
    pending.resolve(result)

    await expect(loading).rejects.toMatchObject({ name: "StaleTranscriptError" })
    expect(controller.getSnapshot()).toMatchObject({ identity: null, error: null, isLoading: false })
  })

  it("a second load invalidates the first without clearing newer loading or state", async () => {
    const first = deferred<CurrentTranscriptResult>()
    const second = deferred<CurrentTranscriptResult>()
    let remoteCalls = 0
    const controller = createController({
      readCached: async () => null,
      loadRemote: async () => {
        remoteCalls += 1
        return remoteCalls === 1 ? first.promise : second.promise
      },
    })
    const firstLoad = controller.loadCurrent({ request, forceReload: true, isTargetCurrent: () => true })
    const secondLoad = controller.loadCurrent({ request, forceReload: true, isTargetCurrent: () => true })
    controller.setError("newer request error")
    first.resolve(result)

    await expect(firstLoad).rejects.toMatchObject({ name: "StaleTranscriptError" })
    expect(controller.getSnapshot()).toMatchObject({
      identity: null,
      error: "newer request error",
      isLoading: true,
    })

    const secondResult: CurrentTranscriptResult = {
      ...result,
      video: { ...video, title: "Second result" },
    }
    second.resolve(secondResult)
    await secondLoad

    expect(controller.getSnapshot()).toMatchObject({
      title: "Second result",
      error: "newer request error",
      isLoading: false,
    })
  })
})
