import type { VideoIdentity } from "@/features/platform/types"

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
