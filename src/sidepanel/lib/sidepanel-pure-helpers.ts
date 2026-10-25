import { parseContentKey } from "@/features/platform/content-key"
import type {
  ActiveVideoContext,
  VideoIdentity,
  VideoPlatform,
} from "@/features/platform/types"

export type AnalysisIdentitySource = {
  platform: VideoIdentity["platform"]
  videoId: string
  contentKey: string
  partId?: string | null
}

/**
 * The part of a restored history context that a saved analysis content key
 * can supply on its own. Everything else (title, url, videoId) comes from
 * the caller, so this projection deliberately stays minimal.
 */
export type ContentKeyHistoryIdentity = {
  platform: VideoPlatform
  partId: string | null
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

/**
 * Projects the canonical identity carried by a saved analysis `contentKey`
 * onto the two fields a history restore needs but the key alone can name.
 * The validation rules live in `parseContentKey`; this function only maps
 * its discriminated result, so a malformed key yields `null` instead of a
 * guessed platform. Callers must treat `null` as "cannot restore" and keep
 * the current workspace untouched.
 */
export function historyContextIdentityFromContentKey(
  contentKey: string,
): ContentKeyHistoryIdentity | null {
  const parsed = parseContentKey(contentKey)
  if (!parsed) return null
  if (parsed.platform === "bilibili") {
    return { platform: "bilibili", partId: parsed.partId }
  }
  return { platform: "youtube", partId: null }
}
