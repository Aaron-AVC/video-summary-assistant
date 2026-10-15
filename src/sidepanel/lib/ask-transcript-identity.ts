import { computeTranscriptFingerprint } from "@/lib/persistence/cache-identity"
import type { TranscriptSegment } from "@/features/platform/types"

export type AskTranscriptMatch = "match" | "mismatch" | "unknown"

export function compareAskTranscriptIdentity({
  analysisFingerprint,
  currentFingerprint,
}: {
  analysisFingerprint: string | null | undefined
  currentFingerprint: string | null | undefined
}): AskTranscriptMatch {
  if (!analysisFingerprint) return currentFingerprint ? "match" : "unknown"
  if (!currentFingerprint) return "unknown"
  return analysisFingerprint === currentFingerprint ? "match" : "mismatch"
}

/**
 * The cues being passed to askVideo are the authority. A persisted fingerprint
 * is reused only when it still agrees with those cues; otherwise the actual
 * cue fingerprint wins.
 */
export async function resolveAskTranscriptFingerprint({
  currentFingerprint,
  transcriptCues,
}: {
  currentFingerprint: string | null | undefined
  transcriptCues: TranscriptSegment[]
}): Promise<string | null> {
  if (transcriptCues.length === 0) return null
  const computedFingerprint = await computeTranscriptFingerprint(transcriptCues)
  return currentFingerprint === computedFingerprint ? currentFingerprint : computedFingerprint
}

export async function resolveAskTranscriptRequestIdentity({
  analysisFingerprint,
  currentFingerprint,
  transcriptCues,
  contentMatches,
}: {
  analysisFingerprint: string | null | undefined
  currentFingerprint: string | null | undefined
  transcriptCues: TranscriptSegment[]
  contentMatches: boolean
}): Promise<
  | { ok: true; transcriptFingerprint: string }
  | { ok: false; reason: "transcript-unavailable" | "transcript-mismatch" }
> {
  if (!contentMatches || transcriptCues.length === 0) {
    return { ok: false, reason: "transcript-unavailable" }
  }
  const transcriptFingerprint = await resolveAskTranscriptFingerprint({ currentFingerprint, transcriptCues })
  if (!transcriptFingerprint) return { ok: false, reason: "transcript-unavailable" }
  if (compareAskTranscriptIdentity({ analysisFingerprint, currentFingerprint: transcriptFingerprint }) === "mismatch") {
    return { ok: false, reason: "transcript-mismatch" }
  }
  return { ok: true, transcriptFingerprint }
}

export function filterQaThreadsByTranscript<T extends { transcriptFingerprint: string }>(
  threads: T[],
  transcriptFingerprint: string | null,
): T[] {
  if (!transcriptFingerprint) return []
  return threads.filter((thread) => thread.transcriptFingerprint === transcriptFingerprint)
}

export function matchesAskRequestWorkspaceIdentity(
  requested: {
    contentKey: string
    analysisRunId: string
    threadId: string | null
    transcriptFingerprint: string
  },
  current: {
    contentKey: string | null
    analysisRunId: string
    threadId: string | null
    transcriptFingerprint: string | null
  },
): boolean {
  return requested.contentKey === current.contentKey
    && requested.analysisRunId === current.analysisRunId
    && requested.threadId === current.threadId
    && requested.transcriptFingerprint === current.transcriptFingerprint
}
