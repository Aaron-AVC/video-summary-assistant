import type { VideoIdentity } from "@/features/platform/types"
import type { AskOpenedThread, AskOpenThreadResult } from "@/sidepanel/ask/ask-controller"
import type { SearchResult } from "@/sidepanel/search/search-controller"

/**
 * Surfaces a Search result can be revealed on. `ask` is only ever reached by
 * restoring an exact QA conversation.
 */
export type SearchOpeningSurface = "overview" | "transcript" | "ask"

/**
 * Authoritative identity reported by the restore boundary. Every component is
 * read from the persisted snapshot that was actually published, never from
 * React-rendered Workspace state, so opening a QA thread can validate the
 * restore outcome synchronously.
 */
export type SearchRestoredAnalysis = {
  contentKey: string
  analysisRunId: string | null
  transcriptFingerprint: string | null
}

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

export type SearchDisplayedAnalysis = {
  contentKey: string
  analysisRunId: string | null
}

export type SearchOpenerEffects = {
  /** Canonical contentKey currently owned by the runtime bridge, or null. */
  readCurrentContentKey: () => string | null
  /**
   * Identity of the analysis the Workspace is currently displaying. This is a
   * different domain from `readCurrentContentKey`: it can point at historical
   * content while the player keeps showing another video. It must be readable
   * synchronously, without waiting for a future React render.
   */
  readDisplayedAnalysis: () => SearchDisplayedAnalysis | null
  /** Transcript fingerprint currently published to the Workspace. */
  readCurrentTranscriptFingerprint: () => string | null
  /**
   * Restores an exact analysis run and returns the identity it actually
   * published, or null when the restore was superseded and published nothing.
   */
  restoreAnalysis: (input: {
    videoId: string
    contentKey: string
    analysisRunId: string
  }) => Promise<SearchRestoredAnalysis | null>
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
 * Three invariants are load-bearing:
 * 1. A current-runtime hit never touches the History restore path; it only
 *    jumps and switches the surface of the content the runtime already owns.
 * 2. A QA thread is only published after the exact analysis run is restored
 *    and every identity component (contentKey, analysisRunId, transcript
 *    fingerprint) still matches what the result promised. The initial check
 *    uses the restore boundary's reported identity; the final check reads the
 *    Workspace's displayed analysis identity, which is a different domain from
 *    the runtime video and may legitimately point at historical content.
 * 3. Every `open` supersedes the previous one, so a slow older request can
 *    never publish over a newer result. The cross-video pending token follows
 *    the same rule for queued navigations.
 */
export function createSearchOpener(effects: SearchOpenerEffects): SearchOpener {
  let pending: PendingSearchResult | null = null
  let pendingToken = 0
  let openSequence = 0

  const isOpenCurrent = (token: number) => token === openSequence

  const superseded = (): SearchOpeningOutcome => ({ kind: "rejected", reason: "superseded" })

  async function openQaThread(
    result: SearchResult,
    token: number,
  ): Promise<SearchOpeningOutcome> {
    const { analysisRunId } = result

    if (!result.threadId) return { kind: "rejected", reason: "missing-thread" }
    if (!analysisRunId) return { kind: "rejected", reason: "missing-analysis-run" }

    const restored = await effects.restoreAnalysis({
      videoId: result.videoId,
      contentKey: result.contentKey,
      analysisRunId,
    })

    if (!isOpenCurrent(token)) return superseded()
    if (!restored) return { kind: "rejected", reason: "restored-analysis-unavailable" }

    if (restored.contentKey !== result.contentKey) {
      return { kind: "rejected", reason: "restored-content-mismatch" }
    }

    if (restored.analysisRunId !== analysisRunId) {
      return { kind: "rejected", reason: "restored-run-mismatch" }
    }

    if (restored.transcriptFingerprint !== result.transcriptFingerprint) {
      return { kind: "rejected", reason: "transcript-fingerprint-mismatch" }
    }

    // The restore result is authoritative for this opening, but it is a
    // snapshot. Anything that changes what the Workspace displays before the
    // thread is published must invalidate it, so currentness is re-read from
    // the displayed analysis identity — not from runtime content, which still
    // shows another video, and not from React-rendered state.
    const isCurrent = () => {
      if (!isOpenCurrent(token)) return false

      const displayed = effects.readDisplayedAnalysis()

      if (!displayed) return false
      if (displayed.contentKey !== restored.contentKey) return false
      if (displayed.analysisRunId !== restored.analysisRunId) return false

      return effects.readCurrentTranscriptFingerprint() === restored.transcriptFingerprint
    }

    const opened = await effects.openThread({
      threadId: result.threadId,
      contentKey: result.contentKey,
      analysisRunId,
      transcriptFingerprint: restored.transcriptFingerprint,
      isCurrent,
    })

    if (!isOpenCurrent(token)) return superseded()

    if (opened.kind !== "ready") {
      return {
        kind: "rejected",
        reason: opened.kind === "mismatch" ? opened.reason : opened.kind,
      }
    }

    if (!isCurrent()) return { kind: "rejected", reason: "displayed-analysis-changed" }

    effects.publishThread({
      threadId: result.threadId,
      contentKey: result.contentKey,
      analysisRunId,
      thread: opened.thread,
    })
    effects.showSurface("ask", null)

    return { kind: "opened", surface: "ask" }
  }

  async function queueCrossVideo(
    result: SearchResult,
    token: number,
  ): Promise<SearchOpeningOutcome> {
    const requestToken = ++pendingToken

    pending = { token: requestToken, result }

    const outcome = await effects.jump(result.identity, result.timestampSeconds ?? 0)

    if (!isOpenCurrent(token)) return superseded()

    if (outcome.kind === "missing-identity" || outcome.kind === "runtime-failure") {
      // Only the request that failed may clear the queue. A newer request that
      // replaced this one must survive an older navigation failure.
      if (pending?.token === requestToken) pending = null

      return { kind: "rejected", reason: outcome.kind }
    }

    return { kind: "pending", contentKey: result.contentKey }
  }

  async function open(result: SearchResult): Promise<SearchOpeningOutcome> {
    const token = ++openSequence
    const decision = resolveSearchOpening(result)

    if (decision.kind === "current" || decision.kind === "knowledge") {
      if (effects.readCurrentContentKey() !== result.contentKey) {
        return queueCrossVideo(result, token)
      }
    }

    // Every non-queued opening supersedes any pending cross-video request.
    pending = null
    pendingToken += 1

    if (decision.kind === "historical") {
      if (!result.analysisRunId) {
        return { kind: "rejected", reason: "missing-analysis-run" }
      }

      const restored = await effects.restoreAnalysis({
        videoId: result.videoId,
        contentKey: result.contentKey,
        analysisRunId: result.analysisRunId,
      })

      if (!isOpenCurrent(token)) return superseded()
      if (!restored) return { kind: "rejected", reason: "restored-analysis-unavailable" }

      effects.showSurface("overview", null)

      return { kind: "opened", surface: "overview" }
    }

    if (decision.kind === "qa") {
      return openQaThread(result, token)
    }

    if (decision.kind === "current") {
      if (decision.surface === "transcript" && decision.timestampSeconds !== null) {
        // A transcript hit must move the player to the cue through the existing
        // timestamp navigation service, then focus that cue in the panel.
        await effects.jump(result.identity, decision.timestampSeconds)

        if (!isOpenCurrent(token)) return superseded()

        effects.showSurface("transcript", decision.timestampSeconds)

        return { kind: "opened", surface: "transcript" }
      }

      effects.showSurface("overview", null)

      return { kind: "opened", surface: "overview" }
    }

    if (decision.timestampSeconds !== null) {
      await effects.jump(result.identity, decision.timestampSeconds)

      if (!isOpenCurrent(token)) return superseded()
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
