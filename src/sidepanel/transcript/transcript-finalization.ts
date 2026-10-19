import type {
  TranscriptSegment,
  VideoIdentity,
  VideoInfo,
  VideoTranscript,
} from "@/features/platform/types"
import type { TranscriptCacheEntity } from "@/lib/schemas/persistence"
import {
  StaleTranscriptError,
  type CurrentTranscriptResult,
} from "@/sidepanel/lib/load-current-transcript"
import { resolveAskTranscriptFingerprint } from "@/sidepanel/lib/ask-transcript-identity"
import { TRANSCRIPT_FINGERPRINT_VERSION } from "@/lib/persistence/cache-identity"
import { computeTranscriptFingerprint } from "@/lib/persistence/cache-identity"

export type CurrentTranscriptPublicationPlan = {
  identity: VideoIdentity
  title: string
  cues: TranscriptSegment[]
  rawVtt: string | null
}

export type CurrentTranscriptFinalizationPlan = {
  fingerprint: string | null
  shouldInvalidateAsk: boolean
  publication: CurrentTranscriptPublicationPlan
}

export type AnalysisTaskTranscriptSource = {
  platform: VideoInfo["platform"]
  videoId: string
  partId: string | null
  contentKey: string
  title: string
  author: string | null
  canonicalUrl: string | null
}

export type AnalysisTaskTranscriptPublicationPlan = {
  identity: VideoIdentity
  title: string
  cues: TranscriptSegment[]
  rawVtt: string | null
}

export type AnalysisTaskTranscriptFinalizationPlan = {
  sourceVideo: VideoInfo
  transcriptFingerprint: string
  publication: AnalysisTaskTranscriptPublicationPlan
}

export async function prepareCurrentTranscriptFinalization({
  result,
  previousFingerprint,
  isCurrent,
}: {
  result: CurrentTranscriptResult
  previousFingerprint: string | null
  isCurrent: () => boolean
}): Promise<CurrentTranscriptFinalizationPlan> {
  const fingerprint = await resolveAskTranscriptFingerprint({
    currentFingerprint: previousFingerprint,
    transcriptCues: result.transcript.segments,
  })
  if (!isCurrent()) throw new StaleTranscriptError()

  return {
    fingerprint,
    shouldInvalidateAsk: Boolean(previousFingerprint && previousFingerprint !== fingerprint),
    publication: {
      identity: {
        platform: result.video.platform,
        videoId: result.video.videoId,
        contentKey: result.video.contentKey,
        ...(result.video.partId ? { partId: result.video.partId } : {}),
      },
      title: result.video.title,
      cues: result.transcript.segments,
      rawVtt: result.transcript.raw?.text ?? null,
    },
  }
}

export function buildTranscriptCacheWrite({
  result,
  fingerprint,
  now,
}: {
  result: CurrentTranscriptResult
  fingerprint: string | null
  now: string
}): TranscriptCacheEntity {
  return {
    id: `transcript:${result.video.contentKey}:${fingerprint}`,
    contentKey: result.video.contentKey,
    platform: result.video.platform,
    videoId: result.video.videoId,
    partId: result.video.partId ?? null,
    fingerprint,
    fingerprintVersion: TRANSCRIPT_FINGERPRINT_VERSION,
    language: result.transcript.language ?? null,
    sourceUrl: result.transcript.raw?.sourceUrl ?? null,
    rawVtt: result.transcript.raw?.text ?? null,
    cues: result.transcript.segments,
    createdAt: now,
    updatedAt: now,
  }
}

export async function prepareAnalysisTaskTranscriptFinalization({
  result,
  taskSource,
}: {
  result: CurrentTranscriptResult
  taskSource: AnalysisTaskTranscriptSource
}): Promise<AnalysisTaskTranscriptFinalizationPlan> {
  const sourceVideo: VideoInfo = {
    ...result.video,
    title: result.video.title || taskSource.title,
    author: result.video.author ?? taskSource.author,
    canonicalUrl: result.video.canonicalUrl || taskSource.canonicalUrl || "",
  }
  const transcriptFingerprint = await computeTranscriptFingerprint(result.transcript.segments)

  return {
    sourceVideo,
    transcriptFingerprint,
    publication: {
      identity: {
        platform: sourceVideo.platform,
        videoId: sourceVideo.videoId,
        contentKey: sourceVideo.contentKey,
        ...(sourceVideo.partId ? { partId: sourceVideo.partId } : {}),
      },
      title: sourceVideo.title,
      cues: result.transcript.segments,
      rawVtt: result.transcript.raw?.text ?? null,
    },
  }
}

export function buildAnalysisTaskTranscriptCacheWrite({
  sourceVideo,
  transcript,
  taskContentKey,
  fingerprint,
  now,
}: {
  sourceVideo: VideoInfo
  transcript: VideoTranscript
  taskContentKey: string
  fingerprint: string
  now: string
}): TranscriptCacheEntity {
  return {
    id: `transcript:${taskContentKey}:${fingerprint}`,
    contentKey: taskContentKey,
    platform: sourceVideo.platform,
    videoId: sourceVideo.videoId,
    partId: sourceVideo.partId ?? null,
    fingerprint,
    fingerprintVersion: TRANSCRIPT_FINGERPRINT_VERSION,
    language: transcript.language ?? null,
    sourceUrl: transcript.raw?.sourceUrl ?? null,
    rawVtt: transcript.raw?.text ?? null,
    cues: transcript.segments,
    createdAt: now,
    updatedAt: now,
  }
}
