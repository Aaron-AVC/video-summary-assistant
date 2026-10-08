import type { VideoIdentity } from "@/features/platform/types"
import type { ActiveVideoContext } from "@/features/platform/types"

/**
 * Task 2 compatibility projection for the existing videoId-keyed YouTube
 * persistence model. Multi-platform persistence moves to contentKey in Task 8.
 */
export function projectPersistedVideoIdentity(videoId: string): VideoIdentity {
  return {
    platform: "youtube",
    videoId,
    contentKey: `youtube:${videoId}`,
  }
}

/** Task 3 bounded compatibility: Bilibili analyses stay session-only until Task 8. */
export function shouldPersistPlatformAnalysis(identity: Pick<VideoIdentity, "platform">): boolean {
  return identity.platform === "youtube"
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

/** Keeps legacy videoId-only history writes within the platforms it can represent safely. */
export async function persistIfSupportedPlatform<T>(
  identity: Pick<VideoIdentity, "platform">,
  persist: () => Promise<T>,
): Promise<boolean> {
  if (!shouldPersistPlatformAnalysis(identity)) return false
  await persist()
  return true
}
