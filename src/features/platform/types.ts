export type VideoPlatform = "youtube"

export type VideoIdentity = {
  platform: VideoPlatform
  videoId: string
  partId?: string
  contentKey: string
}

export type VideoInfo = VideoIdentity & {
  title: string
  author?: string | null
  durationSec?: number | null
  thumbnailUrl?: string | null
  canonicalUrl: string
}

export type TranscriptSegment = {
  startSec: number
  endSec: number
  text: string
}

export type TranscriptSource = "manual" | "auto" | "unknown"

export type VideoTranscript = {
  segments: TranscriptSegment[]
  language?: string | null
  source: TranscriptSource
  raw?: {
    format: "vtt"
    text: string
    sourceUrl?: string | null
  }
}

export type NativeChapter = {
  id: string
  title: string
  startSec: number
  endSec?: number
  source: VideoPlatform
}

export type ActiveVideoContext = {
  pageType: "video" | "unsupported"
  platform: VideoPlatform | null
  videoId: string | null
  partId: string | null
  contentKey: string | null
  url: string
  canonicalUrl: string | null
  title: string | null
  author: string | null
  timestampSeconds: number
  isReady: boolean
}
