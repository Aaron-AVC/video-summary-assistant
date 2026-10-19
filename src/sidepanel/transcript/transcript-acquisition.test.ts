import { describe, expect, it } from "bun:test"

import type { VideoInfo } from "@/features/platform/types"
import {
  StaleTranscriptError,
  type CurrentTranscriptResult,
} from "@/sidepanel/lib/load-current-transcript"
import {
  acquireTranscript,
  type CachedTranscriptCandidate,
  type TranscriptAcquisitionOptions,
} from "@/sidepanel/transcript/transcript-acquisition"

const youtubeVideo: VideoInfo = {
  platform: "youtube",
  videoId: "video-a",
  contentKey: "youtube:video-a",
  title: "Current title",
  author: "Current author",
  canonicalUrl: "https://www.youtube.com/watch?v=video-a",
}

const cues = [{ startSec: 0, endSec: 5, text: "Cached cue" }]

const cachedCandidate: CachedTranscriptCandidate = {
  platform: "youtube",
  videoId: "video-a",
  partId: null,
  contentKey: "youtube:video-a",
  language: "en",
  rawVtt: "WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nCached cue",
  sourceUrl: "https://example.com/captions.vtt",
  cues,
}

function resultFor(video: VideoInfo = youtubeVideo): CurrentTranscriptResult {
  return {
    video,
    transcript: { segments: cues, source: "unknown" },
  }
}

function acquisitionOptions(
  overrides: Partial<TranscriptAcquisitionOptions> = {},
): TranscriptAcquisitionOptions {
  return {
    request: { video: youtubeVideo },
    session: { identity: null, segments: [], rawVtt: null },
    isCurrent: () => true,
    readCached: async () => null,
    loadRemote: async () => resultFor(),
    ...overrides,
  }
}

describe("transcript acquisition", () => {
  it("uses a matching session candidate without reading cache or remote", async () => {
    const sessionIdentity = {
      platform: "youtube" as const,
      videoId: "video-a",
      contentKey: "youtube:video-a",
    }
    let cacheCalls = 0
    let remoteCalls = 0
    const options = acquisitionOptions({
      session: { identity: sessionIdentity, segments: cues, rawVtt: "WEBVTT" },
      readCached: async () => { cacheCalls += 1; return cachedCandidate },
      loadRemote: async () => { remoteCalls += 1; return resultFor() },
    })

    const result = await acquireTranscript(options)

    expect(result.video).toBe(youtubeVideo)
    expect(result.transcript).toEqual({
      segments: cues,
      source: "unknown",
      raw: { format: "vtt", text: "WEBVTT" },
    })
    expect(cacheCalls).toBe(0)
    expect(remoteCalls).toBe(0)
  })

  it("ignores a session with a different contentKey and continues to cache", async () => {
    let cacheCalls = 0
    let remoteCalls = 0
    const result = await acquireTranscript(acquisitionOptions({
      session: {
        identity: { platform: "youtube", videoId: "video-b", contentKey: "youtube:video-b" },
        segments: cues,
        rawVtt: null,
      },
      readCached: async (contentKey) => {
        cacheCalls += 1
        expect(contentKey).toBe("youtube:video-a")
        return cachedCandidate
      },
      loadRemote: async () => { remoteCalls += 1; return resultFor() },
    }))

    expect(result.transcript.segments).toBe(cues)
    expect(cacheCalls).toBe(1)
    expect(remoteCalls).toBe(0)
  })

  it("ignores an empty session candidate", async () => {
    let cacheCalls = 0
    const result = await acquireTranscript(acquisitionOptions({
      session: {
        identity: { platform: "youtube", videoId: "video-a", contentKey: "youtube:video-a" },
        segments: [],
        rawVtt: "WEBVTT",
      },
      readCached: async () => { cacheCalls += 1; return null },
    }))

    expect(result).toEqual(resultFor())
    expect(cacheCalls).toBe(1)
  })

  it("shapes cached transcript data without altering sourceUrl", async () => {
    const result = await acquireTranscript(acquisitionOptions({
      readCached: async () => cachedCandidate,
    }))

    expect(result.transcript).toEqual({
      segments: cues,
      source: "unknown",
      language: "en",
      raw: {
        format: "vtt",
        text: cachedCandidate.rawVtt,
        sourceUrl: cachedCandidate.sourceUrl,
      },
    })
  })

  it("uses the cached canonical platform, videoId, and contentKey", async () => {
    const cached: CachedTranscriptCandidate = {
      ...cachedCandidate,
      platform: "bilibili",
      videoId: "BV-cache",
      partId: "1",
      contentKey: "bilibili:BV-cache:p:1",
    }
    const result = await acquireTranscript(acquisitionOptions({
      readCached: async () => cached,
    }))

    expect(result.video).toEqual({
      platform: "bilibili",
      videoId: "BV-cache",
      partId: "1",
      contentKey: "bilibili:BV-cache:p:1",
      title: youtubeVideo.title,
      author: youtubeVideo.author,
      canonicalUrl: youtubeVideo.canonicalUrl,
    })
  })

  it("preserves Bilibili P1 and P2 identities distinctly", async () => {
    const p1: CachedTranscriptCandidate = {
      ...cachedCandidate,
      platform: "bilibili",
      videoId: "BV-test",
      partId: "1",
      contentKey: "bilibili:BV-test:p:1",
    }
    const p2: CachedTranscriptCandidate = {
      ...p1,
      partId: "2",
      contentKey: "bilibili:BV-test:p:2",
    }
    const p1Result = await acquireTranscript(acquisitionOptions({ readCached: async () => p1 }))
    const p2Result = await acquireTranscript(acquisitionOptions({ readCached: async () => p2 }))

    expect(p1Result.video.partId).toBe("1")
    expect(p1Result.video.contentKey).toBe("bilibili:BV-test:p:1")
    expect(p2Result.video.partId).toBe("2")
    expect(p2Result.video.contentKey).toBe("bilibili:BV-test:p:2")
    expect(p1Result.video.contentKey).not.toBe(p2Result.video.contentKey)
  })

  it("does not use the request video partId without the task compatibility fallback", async () => {
    const requestVideo: VideoInfo = {
      platform: "bilibili",
      videoId: "BV-test",
      partId: "2",
      contentKey: "bilibili:BV-test:p:2",
      title: "Part 2",
      canonicalUrl: "https://www.bilibili.com/video/BV-test?p=2",
    }
    const result = await acquireTranscript(acquisitionOptions({
      request: { video: requestVideo },
      readCached: async () => ({
        ...cachedCandidate,
        platform: "bilibili",
        videoId: "BV-test",
        partId: null,
        contentKey: "bilibili:BV-test:p:2",
      }),
    }))

    expect(result.video.partId).toBeUndefined()
  })

  it("uses the configured task compatibility fallback when cached partId is absent", async () => {
    const requestVideo: VideoInfo = {
      platform: "bilibili",
      videoId: "BV-test",
      partId: "2",
      contentKey: "bilibili:BV-test:p:2",
      title: "Part 2",
      canonicalUrl: "https://www.bilibili.com/video/BV-test?p=2",
    }
    const result = await acquireTranscript(acquisitionOptions({
      request: { video: requestVideo, cachedPartIdFallback: "2" },
      readCached: async () => ({
        ...cachedCandidate,
        platform: "bilibili",
        videoId: "BV-test",
        partId: null,
        contentKey: "bilibili:BV-test:p:2",
      }),
    }))

    expect(result.video.partId).toBe("2")
  })

  it("skips session and cache and calls remote exactly once for forceReload", async () => {
    let cacheCalls = 0
    let remoteCalls = 0
    const sessionIdentity = {
      platform: "youtube" as const,
      videoId: "video-a",
      contentKey: "youtube:video-a",
    }
    const result = await acquireTranscript(acquisitionOptions({
      forceReload: true,
      session: { identity: sessionIdentity, segments: cues, rawVtt: "WEBVTT" },
      readCached: async () => { cacheCalls += 1; return cachedCandidate },
      loadRemote: async () => { remoteCalls += 1; return resultFor() },
    }))

    expect(result).toEqual(resultFor())
    expect(cacheCalls).toBe(0)
    expect(remoteCalls).toBe(1)
  })

  it("passes sourceTabId through the captured remote request", async () => {
    let remoteRequest: TranscriptAcquisitionOptions["request"] | null = null
    const result = await acquireTranscript(acquisitionOptions({
      request: { video: youtubeVideo, sourceTabId: 47 },
      loadRemote: async ({ request }) => {
        remoteRequest = request
        return resultFor()
      },
    }))

    expect(result).toEqual(resultFor())
    expect(remoteRequest?.sourceTabId).toBe(47)
  })

  it("rejects a result when currentness changes after acquisition", async () => {
    await expect(acquireTranscript(acquisitionOptions({
      session: {
        identity: { platform: "youtube", videoId: "video-a", contentKey: "youtube:video-a" },
        segments: cues,
        rawVtt: null,
      },
      isCurrent: () => false,
    }))).rejects.toBeInstanceOf(StaleTranscriptError)
  })

  it("propagates remote loader errors unchanged", async () => {
    const error = new Error("captions_unavailable")
    await expect(acquireTranscript(acquisitionOptions({
      loadRemote: async () => { throw error },
    }))).rejects.toBe(error)
  })
})
