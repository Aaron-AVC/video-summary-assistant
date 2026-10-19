import type {
  TranscriptSegment,
  VideoIdentity,
} from "@/features/platform/types"
import type { TranscriptCacheEntity } from "@/lib/schemas/persistence"
import {
  StaleTranscriptError,
  type CurrentTranscriptResult,
} from "@/sidepanel/lib/load-current-transcript"
import { resolveAskTranscriptFingerprint } from "@/sidepanel/lib/ask-transcript-identity"
import { TRANSCRIPT_FINGERPRINT_VERSION } from "@/lib/persistence/cache-identity"

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
