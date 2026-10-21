import type { VideoIdentity } from "@/features/platform/types"
import type { AskOpenedThread, AskOpenThreadResult } from "@/sidepanel/ask/ask-controller"
import type { SearchResult } from "@/sidepanel/search/search-controller"

/**
 * Surfaces a Search result can be revealed on. `ask` is only ever reached by
 * restoring an exact QA conversation.
 */
export type SearchOpeningSurface = "overview" | "transcript" | "ask"

/**
 * Pure classification of a result into the surface it must open. Current
 * runtime hits carry their own target surface; historical, knowledge and QA
 * rows always resolve to their own surface.
 */
export type SearchOpeningDecision =
  | { kind: "current"; surface: "overview" | "transcript"; timestampSeconds: number | null }
  | { kind: "knowledge"; timestampSeconds: number | null }
  | { kind: "historical" }
  | { kind: "qa" }

export function resolveSearchOpening(result: SearchResult): SearchOpeningDecision {
  switch (result.kind) {
    case "current-runtime-content":
      if (result.targetSurface === "transcript" && result.timestampSeconds !== null) {
        return {
          kind: "current",
          surface: "transcript",
          timestampSeconds: result.timestampSeconds,
        }
      }

      return { kind: "current", surface: "overview", timestampSeconds: null }
    case "knowledge":
      return { kind: "knowledge", timestampSeconds: result.timestampSeconds }
    case "qa-thread":
      return { kind: "qa" }
    case "historical-analysis":
      return { kind: "historical" }
  }
}

export type SearchTimestampNavigationOutcome =
  | { kind: "missing-identity" }
  | { kind: "jumped-active" }
  | { kind: "opened-new-tab" }
  | { kind: "runtime-failure"; error: string }

export type SearchOpenerThreadInput = {
  threadId: string
  contentKey: string
  analysisRunId: string
  transcriptFingerprint: string | null
  isCurrent: () => boolean
}

export type SearchOpenerEffects = {
  /** Canonical contentKey currently owned by the runtime bridge, or null. */
  readCurrentContentKey: () => string | null
  /** Analysis currently published to the Workspace, or null. */
  readDisplayedAnalysis: () => { contentKey: string; analysisRunId: string | null } | null
  /** Transcript fingerprint currently published to the Workspace. */
  readCurrentTranscriptFingerprint: () => string | null
  /** Fingerprint of the transcript restored alongside the displayed analysis. */
  resolveRestoredTranscriptFingerprint: () => Promise<string | null>
  restoreAnalysis: (input: {
    videoId: string
    contentKey: string
    analysisRunId: string
  }) => Promise<void>
  openThread: (input: SearchOpenerThreadInput) => Promise<AskOpenThreadResult>
  publishThread: (input: {
    threadId: string
    contentKey: string
    analysisRunId: string
    thread: AskOpenedThread
  }) => void
  jump: (
    identity: VideoIdentity,
    timestampSeconds: number,
  ) => Promise<SearchTimestampNavigationOutcome>
  showSurface: (surface: SearchOpeningSurface, timestampSeconds: number | null) => void
}

export type SearchOpeningOutcome =
  | { kind: "opened"; surface: SearchOpeningSurface }
  | { kind: "pending"; contentKey: string }
  | { kind: "rejected"; reason: string }

type PendingSearchResult = {
  token: number
  result: SearchResult
}

export type SearchOpener = {
  open: (result: SearchResult) => Promise<SearchOpeningOutcome>
  /**
   * Called whenever the runtime bridge publishes authoritative content. A
   * pending cross-video request only resumes once this exactly matches it.
   */
  notifyRuntimeContent: (contentKey: string | null) => Promise<void>
  pendingContentKey: () => string | null
}

/**
 * React-free opening policy for Search results.
 *
 * Two invariants are load-bearing:
 * 1. A current-runtime hit never touches the History restore path; it only
 *    switches the surface of the content the runtime already owns.
 * 2. A QA thread is only published after the exact analysis run is restored
 *    and every identity component (contentKey, analysisRunId, transcript
 *    fingerprint) still matches what the result promised.
 */
export function createSearchOpener(effects: SearchOpenerEffects): SearchOpener {
  let pending: PendingSearchResult | null = null
  let pendingToken = 0

  async function openQaThread(result: SearchResult): Promise<SearchOpeningOutcome> {
    const { analysisRunId } = result

    if (!result.threadId) return { kind: "rejected", reason: "missing-thread" }
    if (!analysisRunId) return { kind: "rejected", reason: "missing-analysis-run" }

    await effects.restoreAnalysis({
      videoId: result.videoId,
      contentKey: result.contentKey,
      analysisRunId,
    })

    const displayed = effects.readDisplayedAnalysis()

    if (displayed?.contentKey !== result.contentKey) {
      return { kind: "rejected", reason: "restored-content-mismatch" }
    }

    if (displayed.analysisRunId !== analysisRunId) {
      return { kind: "rejected", reason: "restored-run-mismatch" }
    }

    const restoredFingerprint = await effects.resolveRestoredTranscriptFingerprint()

    if (restoredFingerprint !== result.transcriptFingerprint) {
      return { kind: "rejected", reason: "transcript-fingerprint-mismatch" }
    }

    const isCurrent = () => {
      const now = effects.readDisplayedAnalysis()

      return (
        now?.contentKey === result.contentKey
        && now.analysisRunId === analysisRunId
        && effects.readCurrentTranscriptFingerprint() === restoredFingerprint
      )
    }

    const opened = await effects.openThread({
      threadId: result.threadId,
      contentKey: result.contentKey,
      analysisRunId,
      transcriptFingerprint: restoredFingerprint,
      isCurrent,
    })

    if (opened.kind !== "ready" || !isCurrent()) {
      return {
        kind: "rejected",
        reason: opened.kind === "mismatch" ? opened.reason : opened.kind,
      }
    }

    effects.publishThread({
      threadId: result.threadId,
      contentKey: result.contentKey,
      analysisRunId,
      thread: opened.thread,
    })
    effects.showSurface("ask", null)

    return { kind: "opened", surface: "ask" }
  }

  async function queueCrossVideo(result: SearchResult): Promise<SearchOpeningOutcome> {
    const token = ++pendingToken

    pending = { token, result }

    const outcome = await effects.jump(result.identity, result.timestampSeconds ?? 0)

    if (outcome.kind === "missing-identity" || outcome.kind === "runtime-failure") {
      // Only the request that failed may clear the queue. A newer request that
      // replaced this one must survive an older navigation failure.
      if (pending?.token === token) pending = null

      return { kind: "rejected", reason: outcome.kind }
    }

    return { kind: "pending", contentKey: result.contentKey }
  }

  async function open(result: SearchResult): Promise<SearchOpeningOutcome> {
    const decision = resolveSearchOpening(result)

    if (decision.kind === "historical") {
      if (!result.analysisRunId) {
        return { kind: "rejected", reason: "missing-analysis-run" }
      }

      await effects.restoreAnalysis({
        videoId: result.videoId,
        contentKey: result.contentKey,
        analysisRunId: result.analysisRunId,
      })
      effects.showSurface("overview", null)

      return { kind: "opened", surface: "overview" }
    }

    if (decision.kind === "qa") {
      return openQaThread(result)
    }

    if (effects.readCurrentContentKey() !== result.contentKey) {
      return queueCrossVideo(result)
    }

    if (decision.kind === "current") {
      effects.showSurface(decision.surface, decision.timestampSeconds)

      return { kind: "opened", surface: decision.surface }
    }

    if (decision.timestampSeconds !== null) {
      await effects.jump(result.identity, decision.timestampSeconds)
    }

    effects.showSurface("overview", decision.timestampSeconds)

    return { kind: "opened", surface: "overview" }
  }

  async function notifyRuntimeContent(contentKey: string | null): Promise<void> {
    const current = pending

    if (!current) return
    if (contentKey !== current.result.contentKey) return

    pending = null
    await open(current.result)
  }

  return {
    open,
    notifyRuntimeContent,
    pendingContentKey: () => pending?.result.contentKey ?? null,
  }
}
