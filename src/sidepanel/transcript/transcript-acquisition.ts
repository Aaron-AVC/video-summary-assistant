import type {
  TranscriptSegment,
  VideoIdentity,
  VideoInfo,
} from "@/features/platform/types"
import {
  StaleTranscriptError,
  resolveCurrentTranscript,
  type CurrentTranscriptResult,
} from "@/sidepanel/lib/load-current-transcript"

export type TranscriptAcquisitionRequest = {
  video: VideoInfo
  sourceTabId?: number
  cachedPartIdFallback?: string | null
}

export type TranscriptSessionSnapshot = {
  identity: VideoIdentity | null
  segments: TranscriptSegment[]
  rawVtt: string | null
}

export type CachedTranscriptCandidate = {
  platform: VideoIdentity["platform"]
  videoId: string
  partId: string | null
  contentKey: string
  language: string | null
  rawVtt: string | null
  sourceUrl: string | null
  cues: TranscriptSegment[]
}

export type TranscriptAcquisitionOptions = {
  request: TranscriptAcquisitionRequest
  session: TranscriptSessionSnapshot
  forceReload?: boolean
  isCurrent: () => boolean
  readCached: (contentKey: string) => Promise<CachedTranscriptCandidate | null>
  loadRemote: (input: {
    request: TranscriptAcquisitionRequest
    isCurrent: () => boolean
  }) => Promise<CurrentTranscriptResult>
}

export async function acquireTranscript({
  request,
  session,
  forceReload = false,
  isCurrent,
  readCached,
  loadRemote,
}: TranscriptAcquisitionOptions): Promise<CurrentTranscriptResult> {
  const sessionResult = session.identity?.contentKey === request.video.contentKey
    && session.segments.length > 0
    ? {
        video: request.video,
        transcript: {
          segments: session.segments,
          source: "unknown" as const,
          raw: session.rawVtt ? { format: "vtt" as const, text: session.rawVtt } : undefined,
        },
      }
    : null

  const result = await resolveCurrentTranscript({
    requestedContentKey: request.video.contentKey,
    isCurrent,
    forceReload,
    sessionResult,
    loadCached: async () => {
      const cached = await readCached(request.video.contentKey)
      if (!cached) return null

      const partId = cached.partId ?? request.cachedPartIdFallback
      return {
        video: {
          platform: cached.platform,
          videoId: cached.videoId,
          contentKey: cached.contentKey,
          ...(partId ? { partId } : {}),
          title: request.video.title,
          author: request.video.author,
          canonicalUrl: request.video.canonicalUrl,
        },
        transcript: {
          segments: cached.cues,
          source: "unknown" as const,
          language: cached.language,
          raw: cached.rawVtt
            ? {
                format: "vtt" as const,
                text: cached.rawVtt,
                sourceUrl: cached.sourceUrl,
              }
            : undefined,
        },
      }
    },
    loadRemote: () => loadRemote({ request, isCurrent }),
  })

  if (!isCurrent()) throw new StaleTranscriptError()
  return result
}
