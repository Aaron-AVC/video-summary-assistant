import type { VideoIdentity } from "@/features/platform/types"
import type { ActiveVideoContext } from "@/features/platform/types"

/** Legacy YouTube projection kept for old history URLs and migration code. */
export function projectPersistedVideoIdentity(videoId: string): VideoIdentity {
  return {
    platform: "youtube",
    videoId,
    contentKey: `youtube:${videoId}`,
  }
}

/** Task 8 persistence authority: every supported platform has a stable contentKey. */
export function shouldPersistPlatformAnalysis(identity: Pick<VideoIdentity, "platform">): boolean {
  return identity.platform === "youtube" || identity.platform === "bilibili"
}

export function projectContentIdentity(identity: VideoIdentity): VideoIdentity {
  return { ...identity }
}

export function analysisMatchesActiveIdentity(
  analysis: Pick<VideoIdentity, "platform" | "videoId" | "contentKey">,
  active: Pick<ActiveVideoContext, "platform" | "videoId" | "contentKey"> | null,
): boolean {
  if (!active || analysis.platform !== active.platform) return false
  if (analysis.platform === "bilibili" || active.platform === "bilibili") {
    return analysis.contentKey === active.contentKey
  }
  return analysis.videoId === active.videoId
}

/** Compatibility wrapper retained for callers that still use the old name. */
export async function persistIfSupportedPlatform<T>(
  identity: Pick<VideoIdentity, "platform">,
  persist: () => Promise<T>,
): Promise<boolean> {
  if (!shouldPersistPlatformAnalysis(identity)) return false
  await persist()
  return true
}
