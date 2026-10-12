import type { FetchLike } from "@/features/transcript/lib/transcript-schema"
import type {
  YouTubeLivePlayerState,
  YouTubeTimedtextCandidate,
} from "@/features/platform/youtube/youtube-live-state"
import type {
  NativeChapter,
  VideoIdentity,
  VideoInfo,
  VideoPlatform,
  VideoTranscript,
} from "@/features/platform/types"

export type PlatformPageEnvironment = {
  document: Document
  location: URL
  fetch: FetchLike
  /** Live URL probe used to reject asynchronous results after an SPA/part switch. */
  getCurrentUrl?: () => URL
  /** Bounded MAIN-world YouTube player/timedtext snapshot, injected by the runtime bridge. */
  readYouTubeLivePlayerState?: (expectedVideoId: string) => Promise<YouTubeLivePlayerState | null>
  /** One-shot bounded caption reload used only during an explicit transcript request. */
  refreshYouTubeCaptionResource?: (
    expectedVideoId: string,
    previousStartTime: number,
  ) => Promise<YouTubeTimedtextCandidate | null>
  diagnosticLoggingEnabled?: boolean
}

export interface VideoPlatformAdapter {
  readonly platform: VideoPlatform
  canHandle(url: URL): boolean
  getVideoIdentity(url: URL): VideoIdentity | null
  readVideoInfo(env: PlatformPageEnvironment): Promise<VideoInfo> | VideoInfo
  getTranscript(env: PlatformPageEnvironment): Promise<VideoTranscript>
  getNativeChapters(env: PlatformPageEnvironment): Promise<NativeChapter[]>
  getCurrentTime(env: PlatformPageEnvironment): number
  seek(env: PlatformPageEnvironment, seconds: number): boolean
  buildTimestampUrl(video: VideoInfo | VideoIdentity, seconds: number): string
}
