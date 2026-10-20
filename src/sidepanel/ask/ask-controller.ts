import type { AskVideoAnswer } from "@/features/analysis/lib/analysis-schema"
import type { QaMessageEntity, QaThreadEntity } from "@/lib/schemas/persistence"
import { filterQaThreadsByTranscript } from "@/sidepanel/lib/ask-transcript-identity"

/**
 * Narrow repository surface the Ask conversation read/open/delete boundary needs.
 * The controller never imports the qaConversationRepository singleton, React,
 * chrome, toast, or any task controller; the root wires these in.
 */
export type AskControllerDependencies = {
  listQaThreadsForVideo: (
    contentKey: string,
    analysisRunId: string,
  ) => Promise<QaThreadEntity[]>
  getQaThread: (threadId: string) => Promise<QaThreadEntity | null>
  listQaMessages: (threadId: string) => Promise<QaMessageEntity[]>
  deleteQaThread: (threadId: string) => Promise<void>
}

/** Read model restored for a workspace (history restore / analysis completion). */
export type AskConversationSnapshot = {
  threads: QaThreadEntity[]
  currentThreadId: string | null
  messages: QaMessageEntity[]
  answer: AskVideoAnswer | null
}

/** Read model produced by opening one existing thread. Threads list is not touched. */
export type AskOpenedThread = {
  threadId: string
  messages: QaMessageEntity[]
  answer: AskVideoAnswer | null
}

export type AskRestoreConversationRequest = {
  contentKey: string
  analysisRunId: string | null | undefined
  transcriptFingerprint?: string | null
  isCurrent: () => boolean
}

export type AskOpenThreadRequest = {
  threadId: string
  contentKey: string | null | undefined
  analysisRunId: string | null | undefined
  transcriptFingerprint: string | null | undefined
  isCurrent: () => boolean
}

export type AskDeleteThreadRequest = {
  threadId: string
}

export type AskOpenThreadMismatchReason =
  | "missing-thread"
  | "content-key-mismatch"
  | "analysis-run-mismatch"
  | "transcript-fingerprint-missing"
  | "transcript-fingerprint-mismatch"

export type AskRestoreConversationResult =
  | { kind: "stale" }
  | { kind: "ready"; snapshot: AskConversationSnapshot }

export type AskOpenThreadResult =
  | { kind: "stale" }
  | { kind: "mismatch"; reason: AskOpenThreadMismatchReason }
  | { kind: "ready"; thread: AskOpenedThread }

export type AskDeleteThreadResult = { kind: "deleted" }

export type AskController = {
  restoreConversation: (
    request: AskRestoreConversationRequest,
  ) => Promise<AskRestoreConversationResult>
  openThread: (request: AskOpenThreadRequest) => Promise<AskOpenThreadResult>
  deleteThread: (request: AskDeleteThreadRequest) => Promise<AskDeleteThreadResult>
}

/**
 * Current Ask answer projection. An assistant message only produces an answer
 * when it carries citations; content alone is not enough.
 */
export function projectAskAnswer(messages: QaMessageEntity[]): AskVideoAnswer | null {
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant")
  if (!latestAssistant?.citations) return null
  return {
    answer: latestAssistant.content,
    citations: latestAssistant.citations.map((citation) => ({
      text: citation.text,
      startSec: citation.startSec,
      endSec: citation.endSec ?? citation.startSec,
    })),
    followUps: latestAssistant.followUps ?? [],
    suggestedJumps: latestAssistant.suggestedJumps ?? [],
  }
}

export function createAskController(dependencies: AskControllerDependencies): AskController {
  const { listQaThreadsForVideo, getQaThread, listQaMessages, deleteQaThread } = dependencies

  function createEmptySnapshot(): AskConversationSnapshot {
    return { threads: [], currentThreadId: null, messages: [], answer: null }
  }

  async function restoreConversation(
    request: AskRestoreConversationRequest,
  ): Promise<AskRestoreConversationResult> {
    const { contentKey, analysisRunId, transcriptFingerprint, isCurrent } = request
    if (!analysisRunId) {
      if (!isCurrent()) return { kind: "stale" }
      return { kind: "ready", snapshot: createEmptySnapshot() }
    }
    const threads = filterQaThreadsByTranscript(
      await listQaThreadsForVideo(contentKey, analysisRunId),
      transcriptFingerprint ?? null,
    )
    const current = threads[0] ?? null
    const messages = current ? await listQaMessages(current.id) : []
    if (!isCurrent()) return { kind: "stale" }
    return {
      kind: "ready",
      snapshot: {
        threads,
        currentThreadId: current?.id ?? null,
        messages,
        answer: projectAskAnswer(messages),
      },
    }
  }

  async function openThread(request: AskOpenThreadRequest): Promise<AskOpenThreadResult> {
    const { threadId, contentKey, analysisRunId, transcriptFingerprint, isCurrent } = request
    const thread = await getQaThread(threadId)
    if (!thread) return { kind: "mismatch", reason: "missing-thread" }
    if (thread.contentKey !== contentKey) {
      return { kind: "mismatch", reason: "content-key-mismatch" }
    }
    if (thread.analysisRunId !== analysisRunId) {
      return { kind: "mismatch", reason: "analysis-run-mismatch" }
    }
    if (!transcriptFingerprint) {
      return { kind: "mismatch", reason: "transcript-fingerprint-missing" }
    }
    if (thread.transcriptFingerprint !== transcriptFingerprint) {
      return { kind: "mismatch", reason: "transcript-fingerprint-mismatch" }
    }
    const messages = await listQaMessages(threadId)
    if (!isCurrent()) return { kind: "stale" }
    return {
      kind: "ready",
      thread: { threadId, messages, answer: projectAskAnswer(messages) },
    }
  }

  async function deleteThread(
    request: AskDeleteThreadRequest,
  ): Promise<AskDeleteThreadResult> {
    await deleteQaThread(request.threadId)
    return { kind: "deleted" }
  }

  return { restoreConversation, openThread, deleteThread }
}
