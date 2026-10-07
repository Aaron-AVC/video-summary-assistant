import type { FetchLike } from "@/features/transcript/lib/transcript-schema"
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
