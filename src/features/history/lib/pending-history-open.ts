/**
 * Cross-surface signal so the Options History tab can ask the sidepanel to
 * load a specific saved analysis without the user having to click Refresh.
 * The sidepanel watches `chrome.storage.onChanged` for this key, loads the
 * referenced videoId, then clears the key so the same payload does not
 * fire twice on a later reload.
 */
export const PENDING_HISTORY_OPEN_KEY = "yt-summarizer.pending-history-open"

export type PendingHistoryOpenPayload = {
  videoId: string
  contentKey?: string
  analysisRunId?: string
  requestedAt: number
}

export function isPendingHistoryOpenPayload(
  value: unknown
): value is PendingHistoryOpenPayload {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<PendingHistoryOpenPayload>
  return (
    typeof candidate.videoId === "string" &&
    candidate.videoId.length > 0 &&
    typeof candidate.requestedAt === "number" &&
    Number.isFinite(candidate.requestedAt) &&
    (candidate.contentKey === undefined || typeof candidate.contentKey === "string") &&
    (candidate.analysisRunId === undefined || typeof candidate.analysisRunId === "string")
  )
}
