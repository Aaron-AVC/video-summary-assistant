import type { ActiveVideoContext, VideoIdentity } from "@/features/platform/types"

export type AnalysisIdentitySource = {
  platform: VideoIdentity["platform"]
  videoId: string
  contentKey: string
  partId?: string | null
}

export function formatTimestamp(timestampSeconds: number) {
  const totalSeconds = Math.round(timestampSeconds)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

export function identityFromContext(context: ActiveVideoContext): VideoIdentity | null {
  if (!context.platform || !context.videoId || !context.contentKey) return null
  return {
    platform: context.platform,
    videoId: context.videoId,
    contentKey: context.contentKey,
    ...(context.partId ? { partId: context.partId } : {}),
  }
}

export function identityFromAnalysis(source: AnalysisIdentitySource): VideoIdentity {
  return {
    platform: source.platform,
    videoId: source.videoId,
    contentKey: source.contentKey,
    ...(source.partId ? { partId: source.partId } : {}),
  }
}
