import { describe, expect, it } from "bun:test"

import type { VideoInfo } from "@/features/platform/types"
import { TRANSCRIPT_FINGERPRINT_VERSION } from "@/lib/persistence/cache-identity"
import { resolveAskTranscriptFingerprint } from "@/sidepanel/lib/ask-transcript-identity"
import type { CurrentTranscriptResult } from "@/sidepanel/lib/load-current-transcript"
import {
  buildTranscriptCacheWrite,
  prepareCurrentTranscriptFinalization,
} from "@/sidepanel/transcript/transcript-finalization"

const youtubeVideo: VideoInfo = {
  platform: "youtube",
  videoId: "video-a",
  contentKey: "youtube:video-a",
  title: "Video A",
  author: "Author A",
  canonicalUrl: "https://www.youtube.com/watch?v=video-a",
}

const cues = [
  { startSec: 0, endSec: 5, text: "Hello" },
  { startSec: 5, endSec: 10, text: "World" },
]

function resultFor(video: VideoInfo = youtubeVideo, segments = cues): CurrentTranscriptResult {
  return {
    video,
    transcript: {
      segments,
      source: "manual",
      language: "en",
      raw: {
        format: "vtt",
        text: "WEBVTT",
        sourceUrl: "https://example.com/captions.vtt",
      },
    },
  }
}

async function fingerprintFor(segments = cues) {
  return resolveAskTranscriptFingerprint({
    currentFingerprint: null,
    transcriptCues: segments,
  })
}

describe("current transcript finalization", () => {
  it("computes the fingerprint from the actual cues", async () => {
    const expected = await fingerprintFor()
    const plan = await prepareCurrentTranscriptFinalization({
      result: resultFor(),
      previousFingerprint: null,
      isCurrent: () => true,
    })

    expect(plan.fingerprint).toBe(expected)
  })

  it("does not invalidate Ask when there is no previous fingerprint", async () => {
    const plan = await prepareCurrentTranscriptFinalization({
      result: resultFor(),
      previousFingerprint: null,
      isCurrent: () => true,
    })

    expect(plan.shouldInvalidateAsk).toBe(false)
  })

  it("does not invalidate Ask when the previous fingerprint matches", async () => {
    const fingerprint = await fingerprintFor()
    const plan = await prepareCurrentTranscriptFinalization({
      result: resultFor(),
      previousFingerprint: fingerprint,
      isCurrent: () => true,
    })

    expect(plan.shouldInvalidateAsk).toBe(false)
  })

  it("invalidates Ask when the previous fingerprint differs", async () => {
    const plan = await prepareCurrentTranscriptFinalization({
      result: resultFor(),
      previousFingerprint: "stale-fingerprint",
      isCurrent: () => true,
    })

    expect(plan.shouldInvalidateAsk).toBe(true)
  })

  it("keeps truthiness semantics when a non-null previous fingerprint meets empty cues", async () => {
    const plan = await prepareCurrentTranscriptFinalization({
      result: resultFor(youtubeVideo, []),
      previousFingerprint: "previous-fingerprint",
      isCurrent: () => true,
    })

    expect(plan.fingerprint).toBeNull()
    expect(plan.shouldInvalidateAsk).toBe(true)
  })

  it("rejects a stale result only after fingerprint resolution", async () => {
    let currentChecks = 0
    await expect(prepareCurrentTranscriptFinalization({
      result: resultFor(),
      previousFingerprint: null,
      isCurrent: () => {
        currentChecks += 1
        return false
      },
    })).rejects.toThrow("video part changed")
    expect(currentChecks).toBe(1)
  })

  it("publishes the canonical YouTube identity and current transcript data", async () => {
    const plan = await prepareCurrentTranscriptFinalization({
      result: resultFor(),
      previousFingerprint: null,
      isCurrent: () => true,
    })

    expect(plan.publication).toEqual({
      identity: {
        platform: "youtube",
        videoId: "video-a",
        contentKey: "youtube:video-a",
      },
      title: "Video A",
      cues,
      rawVtt: "WEBVTT",
    })
  })

  it("preserves distinct Bilibili P1 and P2 publication identities", async () => {
    const p1 = await prepareCurrentTranscriptFinalization({
      result: resultFor({
        platform: "bilibili",
        videoId: "BV-test",
        partId: "1",
        contentKey: "bilibili:BV-test:p:1",
        title: "Part 1",
        canonicalUrl: "https://www.bilibili.com/video/BV-test?p=1",
      }),
      previousFingerprint: null,
      isCurrent: () => true,
    })
    const p2 = await prepareCurrentTranscriptFinalization({
      result: resultFor({
        platform: "bilibili",
        videoId: "BV-test",
        partId: "2",
        contentKey: "bilibili:BV-test:p:2",
        title: "Part 2",
        canonicalUrl: "https://www.bilibili.com/video/BV-test?p=2",
      }),
      previousFingerprint: null,
      isCurrent: () => true,
    })

    expect(p1.publication.identity).toEqual({
      platform: "bilibili",
      videoId: "BV-test",
      partId: "1",
      contentKey: "bilibili:BV-test:p:1",
    })
    expect(p2.publication.identity).toEqual({
      platform: "bilibili",
      videoId: "BV-test",
      partId: "2",
      contentKey: "bilibili:BV-test:p:2",
    })
    expect(p1.publication.identity.contentKey).not.toBe(p2.publication.identity.contentKey)
  })

  it("builds the exact cache payload with explicit timestamps", async () => {
    const result = resultFor()
    const payload = buildTranscriptCacheWrite({
      result,
      fingerprint: "fingerprint-1",
      now: "2026-10-19T12:34:56.000Z",
    })

    expect(payload).toEqual({
      id: "transcript:youtube:video-a:fingerprint-1",
      contentKey: "youtube:video-a",
      platform: "youtube",
      videoId: "video-a",
      partId: null,
      fingerprint: "fingerprint-1",
      fingerprintVersion: TRANSCRIPT_FINGERPRINT_VERSION,
      language: "en",
      sourceUrl: "https://example.com/captions.vtt",
      rawVtt: "WEBVTT",
      cues,
      createdAt: "2026-10-19T12:34:56.000Z",
      updatedAt: "2026-10-19T12:34:56.000Z",
    })
  })

  it("maps optional cache fields to null", () => {
    const result = resultFor({
      platform: "bilibili",
      videoId: "BV-test",
      contentKey: "bilibili:BV-test:p:1",
      title: "Part 1",
      canonicalUrl: "https://www.bilibili.com/video/BV-test?p=1",
    })
    result.transcript.language = null
    result.transcript.raw = undefined

    expect(buildTranscriptCacheWrite({
      result,
      fingerprint: null,
      now: "2026-10-19T00:00:00.000Z",
    })).toMatchObject({
      id: "transcript:bilibili:BV-test:p:1:null",
      partId: null,
      fingerprint: null,
      language: null,
      sourceUrl: null,
      rawVtt: null,
    })
  })
})
