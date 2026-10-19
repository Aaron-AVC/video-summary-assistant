import { describe, expect, it } from "bun:test"

import type { VideoInfo } from "@/features/platform/types"
import {
  computeTranscriptFingerprint,
  TRANSCRIPT_FINGERPRINT_VERSION,
} from "@/lib/persistence/cache-identity"
import { resolveAskTranscriptFingerprint } from "@/sidepanel/lib/ask-transcript-identity"
import type { CurrentTranscriptResult } from "@/sidepanel/lib/load-current-transcript"
import {
  buildAnalysisTaskTranscriptCacheWrite,
  buildTranscriptCacheWrite,
  prepareAnalysisTaskTranscriptFinalization,
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

const analysisTaskSource = {
  platform: "youtube" as const,
  videoId: "video-a",
  partId: null,
  contentKey: "youtube:video-a",
  title: "Task title",
  author: "Task author",
  canonicalUrl: "https://task.example/video-a",
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

describe("analysis task transcript finalization", () => {
  it("computes the fingerprint from the final transcript cues", async () => {
    const expected = await computeTranscriptFingerprint(cues)
    const plan = await prepareAnalysisTaskTranscriptFinalization({
      result: resultFor(),
      taskSource: analysisTaskSource,
    })

    expect(plan.transcriptFingerprint).toBe(expected)
  })

  it("preserves truthy result metadata and falls back only for empty values", async () => {
    const plan = await prepareAnalysisTaskTranscriptFinalization({
      result: resultFor({
        ...youtubeVideo,
        title: "Result title",
        author: "Result author",
        canonicalUrl: "https://result.example/video-a",
      }),
      taskSource: analysisTaskSource,
    })

    expect(plan.sourceVideo).toMatchObject({
      title: "Result title",
      author: "Result author",
      canonicalUrl: "https://result.example/video-a",
    })

    const fallbackPlan = await prepareAnalysisTaskTranscriptFinalization({
      result: resultFor({
        ...youtubeVideo,
        title: "",
        author: null,
        canonicalUrl: "",
      }),
      taskSource: analysisTaskSource,
    })

    expect(fallbackPlan.sourceVideo).toMatchObject({
      title: "Task title",
      author: "Task author",
      canonicalUrl: "https://task.example/video-a",
    })
  })

  it("uses an empty canonical URL when both result and task metadata are empty", async () => {
    const plan = await prepareAnalysisTaskTranscriptFinalization({
      result: resultFor({
        ...youtubeVideo,
        title: "",
        author: null,
        canonicalUrl: "",
      }),
      taskSource: {
        ...analysisTaskSource,
        title: "Fallback title",
        author: null,
        canonicalUrl: null,
      },
    })

    expect(plan.sourceVideo.title).toBe("Fallback title")
    expect(plan.sourceVideo.author).toBeNull()
    expect(plan.sourceVideo.canonicalUrl).toBe("")
  })

  it("publishes the final YouTube identity and transcript data", async () => {
    const plan = await prepareAnalysisTaskTranscriptFinalization({
      result: resultFor(),
      taskSource: analysisTaskSource,
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

  it("preserves distinct Bilibili P1 and P2 task identities", async () => {
    const p1 = await prepareAnalysisTaskTranscriptFinalization({
      result: resultFor({
        platform: "bilibili",
        videoId: "BV-task",
        partId: "1",
        contentKey: "bilibili:BV-task:p:1",
        title: "Part 1",
        canonicalUrl: "https://www.bilibili.com/video/BV-task?p=1",
      }),
      taskSource: {
        ...analysisTaskSource,
        platform: "bilibili",
        videoId: "BV-task",
        contentKey: "bilibili:BV-task:p:1",
      },
    })
    const p2 = await prepareAnalysisTaskTranscriptFinalization({
      result: resultFor({
        platform: "bilibili",
        videoId: "BV-task",
        partId: "2",
        contentKey: "bilibili:BV-task:p:2",
        title: "Part 2",
        canonicalUrl: "https://www.bilibili.com/video/BV-task?p=2",
      }),
      taskSource: {
        ...analysisTaskSource,
        platform: "bilibili",
        videoId: "BV-task",
        contentKey: "bilibili:BV-task:p:2",
      },
    })

    expect(p1.publication.identity).toEqual({
      platform: "bilibili",
      videoId: "BV-task",
      partId: "1",
      contentKey: "bilibili:BV-task:p:1",
    })
    expect(p2.publication.identity).toEqual({
      platform: "bilibili",
      videoId: "BV-task",
      partId: "2",
      contentKey: "bilibili:BV-task:p:2",
    })
    expect(p1.publication.identity.contentKey).not.toBe(p2.publication.identity.contentKey)
  })

  it("does not invent a partId when the final source video has none", async () => {
    const plan = await prepareAnalysisTaskTranscriptFinalization({
      result: resultFor({
        ...youtubeVideo,
        partId: undefined,
      }),
      taskSource: analysisTaskSource,
    })

    expect(plan.sourceVideo.partId).toBeUndefined()
    expect(plan.publication.identity).toEqual({
      platform: "youtube",
      videoId: "video-a",
      contentKey: "youtube:video-a",
    })
  })

  it("builds task cache payloads from the final source video and explicit task content key", () => {
    const sourceVideo: VideoInfo = {
      platform: "bilibili",
      videoId: "BV-task",
      partId: "2",
      contentKey: "bilibili:BV-task:p:2",
      title: "Part 2",
      author: "Author",
      canonicalUrl: "https://www.bilibili.com/video/BV-task?p=2",
    }
    const transcript = {
      segments: cues,
      source: "auto" as const,
      language: "zh-Hans",
      raw: {
        format: "vtt" as const,
        text: "WEBVTT\n\n00:00.000 --> 00:05.000\n你好",
        sourceUrl: "https://example.com/task.vtt",
      },
    }

    expect(buildAnalysisTaskTranscriptCacheWrite({
      sourceVideo,
      transcript,
      taskContentKey: "historical:bilibili:BV-task:p:2",
      fingerprint: "fingerprint-task",
      now: "2026-10-19T12:34:56.000Z",
    })).toEqual({
      id: "transcript:historical:bilibili:BV-task:p:2:fingerprint-task",
      contentKey: "historical:bilibili:BV-task:p:2",
      platform: "bilibili",
      videoId: "BV-task",
      partId: "2",
      fingerprint: "fingerprint-task",
      fingerprintVersion: TRANSCRIPT_FINGERPRINT_VERSION,
      language: "zh-Hans",
      sourceUrl: "https://example.com/task.vtt",
      rawVtt: "WEBVTT\n\n00:00.000 --> 00:05.000\n你好",
      cues,
      createdAt: "2026-10-19T12:34:56.000Z",
      updatedAt: "2026-10-19T12:34:56.000Z",
    })
  })

  it("maps optional task cache fields to null", () => {
    const sourceVideo: VideoInfo = {
      platform: "youtube",
      videoId: "video-a",
      contentKey: "youtube:video-a",
      title: "Video A",
      author: null,
      canonicalUrl: "",
    }
    const transcript = {
      segments: cues,
      source: "manual" as const,
      language: null,
      raw: undefined,
    }

    expect(buildAnalysisTaskTranscriptCacheWrite({
      sourceVideo,
      transcript,
      taskContentKey: "youtube:video-a",
      fingerprint: "fingerprint-task",
      now: "2026-10-19T00:00:00.000Z",
    })).toMatchObject({
      id: "transcript:youtube:video-a:fingerprint-task",
      contentKey: "youtube:video-a",
      platform: "youtube",
      videoId: "video-a",
      partId: null,
      fingerprint: "fingerprint-task",
      fingerprintVersion: TRANSCRIPT_FINGERPRINT_VERSION,
      language: null,
      sourceUrl: null,
      rawVtt: null,
      createdAt: "2026-10-19T00:00:00.000Z",
      updatedAt: "2026-10-19T00:00:00.000Z",
    })
  })
})
