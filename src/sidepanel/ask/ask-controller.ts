import type { AskVideoAnswer, VideoAnalysis } from "@/features/analysis/lib/analysis-schema"
import type { AskTaskSnapshot } from "@/features/analysis/lib/ask-task-controller"
import {
  boundQaConversationContext,
  computeBoundedConversationContextFingerprint,
  type QaConversationContextMessage,
} from "@/features/analysis/lib/qa-conversation-context"
import type { TranscriptSegment } from "@/features/platform/types"
import type { ResolvedProvider } from "@/features/settings/lib/settings-storage"
import {
  computeQaCacheKey,
  VIDEO_QA_PROMPT_VERSION,
  VIDEO_QA_SCHEMA_VERSION,
} from "@/lib/persistence/cache-identity"
import type {
  QaAnswerEntity,
  QaMessageEntity,
  QaThreadEntity,
} from "@/lib/schemas/persistence"
import {
  getFrozenQaProviderRequest,
  matchesQaThreadIdentity,
} from "@/sidepanel/lib/ask-conversation-identity"
import {
  filterQaThreadsByTranscript,
  resolveAskTranscriptFingerprint,
  resolveAskTranscriptRequestIdentity,
} from "@/sidepanel/lib/ask-transcript-identity"

/** New-thread payload the Ask thread boundary persists. */
export type CreateAskThreadInput = {
  contentKey: string
  platform: QaThreadEntity["platform"]
  videoId: string
  partId: string | null
  title: string
  analysisRunId: string
  transcriptFingerprint: string
  providerProfileId: string
  providerBaseUrl: string
  providerModel: string
}

/** Narrow pre-task user message the Ask turn boundary persists. */
export type AskUserMessageInput = {
  threadId: string
  role: "user"
  content: string
}

/** Narrow assistant message the Ask execution boundary persists. */
export type AskAssistantMessageInput = {
  threadId: string
  role: "assistant"
  content: string
  citations: AskVideoAnswer["citations"]
  suggestedJumps: AskVideoAnswer["suggestedJumps"]
  followUps: AskVideoAnswer["followUps"]
}

/**
 * Exact provider call the Ask execution boundary needs. It mirrors the
 * `askVideo` option surface without exposing the client injection hook.
 */
export type AskVideoExecutionInput = {
  provider: AskProviderRequest
  question: string
  transcript: {
    videoId: string
    title: string | null
    cues: TranscriptSegment[]
  }
  analysis: VideoAnalysis
  conversationHistory: QaConversationContextMessage[]
  signal: AbortSignal
  onRepairStart: () => void
}

/**
 * Narrow repository/settings surface the Ask conversation boundary needs.
 * The controller never imports the qaConversationRepository or settingsStorage
 * singleton, React, chrome, toast, or any task controller; the root wires these in.
 */
export type AskControllerDependencies = {
  listQaThreadsForVideo: (
    contentKey: string,
    analysisRunId: string,
  ) => Promise<QaThreadEntity[]>
  getQaThread: (threadId: string) => Promise<QaThreadEntity | null>
  listQaMessages: (threadId: string) => Promise<QaMessageEntity[]>
  deleteQaThread: (threadId: string) => Promise<void>
  createQaThread: (input: CreateAskThreadInput) => Promise<QaThreadEntity>
  resolveProvider: (providerId: string) => Promise<ResolvedProvider>
  appendQaMessage: (input: AskUserMessageInput) => Promise<QaMessageEntity>
  getQaAnswer: (cacheKey: string) => Promise<QaAnswerEntity | null>
  saveQaAnswer: (input: QaAnswerEntity) => Promise<unknown>
  runAskVideo: (input: AskVideoExecutionInput) => Promise<{ answer: AskVideoAnswer }>
  appendAssistantMessage: (input: AskAssistantMessageInput) => Promise<QaMessageEntity>
  now?: () => string
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

export type AskExecutionThreadRequest = {
  requestedThreadId: string | null
  contentKey: string
  analysisRunId: string
  transcriptFingerprint: string
  platform: QaThreadEntity["platform"]
  videoId: string
  partId: string | null
  question: string
  selectedProviderId: string
  isCurrent: () => boolean
}

/**
 * Temporary execution capability for one Ask request. It is never stored in
 * React state, a controller snapshot, a task snapshot, or persistence.
 */
export type AskProviderRequest = {
  baseUrl: string
  apiKey: string
  model: string
  generationTimeoutSec: number
}

export type AskExecutionThreadResult =
  | { kind: "stale" }
  | {
      kind: "ready"
      thread: QaThreadEntity
      created: boolean
      providerRequest: AskProviderRequest
    }

/** Exact user-facing error the reused-thread provider path must surface. */
export const ASK_THREAD_PROVIDER_UNAVAILABLE_MESSAGE =
  "The provider used by this conversation is no longer available. Start a new chat to use the current provider."

export type AskExecutionTurnRequest = {
  threadId: string
  question: string
}

/**
 * Bounded provider history built from messages persisted before the current
 * question, plus the user message that was just appended.
 */
export type AskExecutionTurnResult = {
  conversationHistory: QaConversationContextMessage[]
  userMessage: QaMessageEntity
}

/**
 * Everything the root already captured for one Ask request, before the task
 * starts. The controller derives cache identity and the frozen task inputs from
 * this snapshot; it never starts, observes, or cancels the task itself.
 */
export type AskExecutionTaskInputRequest = {
  thread: QaThreadEntity

  requestedContentKey: string
  requestedAnalysisRunId: string

  question: string

  /** Transient execution capability; never persisted or published. */
  providerRequest: AskProviderRequest

  platform: "youtube" | "bilibili"
  videoId: string
  partId: string | null
  videoTitle: string
  analysis: VideoAnalysis

  transcriptCues: TranscriptSegment[]
  conversationHistory: QaConversationContextMessage[]
}

/**
 * Frozen task inputs plus the QA cache identity they belong to. `taskSnapshot`
 * is the exact value the root passes to `AskTaskController.start`, minus the
 * task id and start time that the controller owns.
 */
export type AskExecutionTaskInputResult = {
  qaCacheKey: string
  taskSnapshot: Omit<AskTaskSnapshot, "taskId" | "startedAt">
  providerRequest: AskProviderRequest
  taskAnalysis: VideoAnalysis
  taskTranscriptCues: TranscriptSegment[]
  taskConversationHistory: QaConversationContextMessage[]
}

/**
 * One Ask execution run, fed by the frozen inputs of the previous preparation
 * step plus the task lifecycle capabilities the root still owns. The controller
 * consumes these; it never starts, observes, or cancels the task.
 */
export type AskExecutionTaskRequest = {
  qaCacheKey: string
  taskSnapshot: Omit<AskTaskSnapshot, "taskId" | "startedAt">
  providerRequest: AskProviderRequest
  taskAnalysis: VideoAnalysis
  taskTranscriptCues: TranscriptSegment[]
  taskConversationHistory: QaConversationContextMessage[]
  signal: AbortSignal
  isTaskCurrent: () => boolean
  setPhase: (phase: "repairing" | "finalizing") => void
}

/** Domain result of one Ask execution run. No UI intent, no toast text. */
export type AskExecutionTaskResult = {
  answer: AskVideoAnswer
  assistantMessage: QaMessageEntity
}

/**
 * Ask-specific transcript preflight inputs. The root captures every value; the
 * controller owns only the domain resolution, never the load epoch, the
 * generation, or the React state around it.
 */
export type AskExecutionTranscriptIdentityRequest = {
  analysisFingerprint: string | null | undefined
  currentFingerprint: string | null | undefined
  transcriptCues: TranscriptSegment[]
  contentMatches: boolean
}

/**
 * Exact union the transcript-identity helper already produces. The controller
 * re-exports it so the root keeps the same reason strings without importing the
 * helper directly.
 */
export type AskExecutionTranscriptIdentityResult =
  | { ok: true; transcriptFingerprint: string }
  | { ok: false; reason: "transcript-unavailable" | "transcript-mismatch" }

/** Inputs for resolving the fingerprint an open-thread request compares against. */
export type AskOpenThreadTranscriptRequest = {
  currentFingerprint: string | null | undefined
  transcriptCues: TranscriptSegment[]
}

export type AskController = {
  restoreConversation: (
    request: AskRestoreConversationRequest,
  ) => Promise<AskRestoreConversationResult>
  openThread: (request: AskOpenThreadRequest) => Promise<AskOpenThreadResult>
  deleteThread: (request: AskDeleteThreadRequest) => Promise<AskDeleteThreadResult>
  prepareExecutionThread: (
    request: AskExecutionThreadRequest,
  ) => Promise<AskExecutionThreadResult>
  prepareExecutionTurn: (
    request: AskExecutionTurnRequest,
  ) => Promise<AskExecutionTurnResult>
  prepareExecutionTaskInput: (
    request: AskExecutionTaskInputRequest,
  ) => Promise<AskExecutionTaskInputResult>
  runExecutionTask: (
    request: AskExecutionTaskRequest,
  ) => Promise<AskExecutionTaskResult>
  prepareExecutionTranscriptIdentity: (
    request: AskExecutionTranscriptIdentityRequest,
  ) => Promise<AskExecutionTranscriptIdentityResult>
  resolveOpenThreadTranscriptFingerprint: (
    request: AskOpenThreadTranscriptRequest,
  ) => Promise<string | null>
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
  const {
    listQaThreadsForVideo,
    getQaThread,
    listQaMessages,
    deleteQaThread,
    createQaThread,
    resolveProvider,
    appendQaMessage,
    getQaAnswer,
    saveQaAnswer,
    runAskVideo,
    appendAssistantMessage,
  } = dependencies
  const now = dependencies.now ?? (() => new Date().toISOString())

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

  async function prepareExecutionThread(
    request: AskExecutionThreadRequest,
  ): Promise<AskExecutionThreadResult> {
    const {
      requestedThreadId,
      contentKey,
      analysisRunId,
      transcriptFingerprint,
      platform,
      videoId,
      partId,
      question,
      selectedProviderId,
      isCurrent,
    } = request
    let thread = requestedThreadId ? await getQaThread(requestedThreadId) : null
    const canReuseThread = matchesQaThreadIdentity(thread, {
      contentKey,
      analysisRunId,
      transcriptFingerprint,
    })

    // First currentness guard: after the thread read and the reuse decision,
    // before any provider resolution or new-thread creation.
    if (!isCurrent()) return { kind: "stale" }

    let resolvedProvider: ResolvedProvider
    let created = false
    if (canReuseThread && thread) {
      try {
        resolvedProvider = await resolveProvider(thread.providerProfileId)
      } catch {
        throw new Error(ASK_THREAD_PROVIDER_UNAVAILABLE_MESSAGE)
      }
    } else {
      resolvedProvider = await resolveProvider(selectedProviderId)
      thread = await createQaThread({
        contentKey,
        platform,
        videoId,
        partId,
        title: question.slice(0, 60),
        analysisRunId,
        transcriptFingerprint,
        providerProfileId: selectedProviderId,
        providerBaseUrl: resolvedProvider.profile.baseUrl,
        providerModel: resolvedProvider.profile.model,
      })
      created = true
    }
    if (!thread) return { kind: "stale" }
    return {
      kind: "ready",
      thread,
      created,
      providerRequest: getFrozenQaProviderRequest(thread, resolvedProvider),
    }
  }

  /**
   * Read the thread history that predates the current question, bound it with
   * the authoritative policy, then persist the user message. The order is the
   * contract: bounding must never see the current question, otherwise the
   * provider payload and QA cache identity drift. No workspace currentness
   * check happens here; the root owns the guard before this call.
   */
  async function prepareExecutionTurn(
    request: AskExecutionTurnRequest,
  ): Promise<AskExecutionTurnResult> {
    const { threadId, question } = request
    const previousMessages = await listQaMessages(threadId)
    const conversationHistory = boundQaConversationContext(previousMessages.map((message) => ({
      role: message.role,
      content: message.content,
    })))
    const userMessage = await appendQaMessage({
      threadId,
      role: "user",
      content: question,
    })
    return { conversationHistory, userMessage }
  }

  /**
   * Derive the QA cache identity and freeze the task inputs the runner reads.
   *
   * Cache identity is authoritative over the persisted thread for provider
   * identity and analysis run, while the task snapshot keeps the requested
   * analysis run and the captured analysis view for source metadata. The
   * transient provider request only travels as execution capability: it never
   * reaches the snapshot, the cache key, React state, or persistence.
   */
  async function prepareExecutionTaskInput(
    request: AskExecutionTaskInputRequest,
  ): Promise<AskExecutionTaskInputResult> {
    const {
      thread,
      requestedContentKey,
      requestedAnalysisRunId,
      question,
      providerRequest,
      platform,
      videoId,
      partId,
      videoTitle,
      analysis,
      transcriptCues,
      conversationHistory,
    } = request

    const conversationContextFingerprint =
      await computeBoundedConversationContextFingerprint(conversationHistory)

    const qaCacheKey = await computeQaCacheKey({
      contentKey: requestedContentKey,
      transcriptFingerprint: thread.transcriptFingerprint,
      analysisRunId: thread.analysisRunId,
      providerProfileId: thread.providerProfileId,
      baseUrl: thread.providerBaseUrl,
      model: thread.providerModel,
      question,
      conversationContextFingerprint,
    })

    const taskSnapshot: Omit<AskTaskSnapshot, "taskId" | "startedAt"> = {
      contentKey: requestedContentKey,
      analysisRunId: requestedAnalysisRunId,
      transcriptFingerprint: thread.transcriptFingerprint,
      threadId: thread.id,
      platform,
      videoId,
      partId,
      videoTitle,
      question,
      providerProfileId: thread.providerProfileId,
      providerBaseUrl: thread.providerBaseUrl,
      providerModel: thread.providerModel,
      generationTimeoutSec: providerRequest.generationTimeoutSec ?? 600,
    }

    return {
      qaCacheKey,
      taskSnapshot,
      providerRequest: { ...providerRequest },
      taskAnalysis: analysis,
      taskTranscriptCues: [...transcriptCues],
      taskConversationHistory: [...conversationHistory],
    }
  }

  /**
   * Ask-specific transcript preflight. It delegates to the existing helper so
   * fingerprint computation and matching policy stay in one place; the root
   * keeps the load-epoch, generation, and UI-mapping guards around this call.
   */
  async function prepareExecutionTranscriptIdentity(
    request: AskExecutionTranscriptIdentityRequest,
  ): Promise<AskExecutionTranscriptIdentityResult> {
    const { analysisFingerprint, currentFingerprint, transcriptCues, contentMatches } = request
    return resolveAskTranscriptRequestIdentity({
      analysisFingerprint,
      currentFingerprint,
      transcriptCues,
      contentMatches,
    })
  }

  /**
   * Fingerprint an open-thread request should be validated against. Delegates to
   * the shared resolver so the cue fingerprint remains the authority.
   */
  async function resolveOpenThreadTranscriptFingerprint(
    request: AskOpenThreadTranscriptRequest,
  ): Promise<string | null> {
    const { currentFingerprint, transcriptCues } = request
    return resolveAskTranscriptFingerprint({ currentFingerprint, transcriptCues })
  }

  /**
   * Execute one Ask task: QA cache lookup, optional model call, cache write,
   * and assistant-message persistence.
   *
   * The three task-active guards and their order are the contract: one before
   * the cache read, one after it and before the model call, one after the
   * answer is resolved and before `finalizing`. Nothing after `finalizing` may
   * re-check the task, because the task controller no longer allows cancelling
   * from that phase.
   */
  async function runExecutionTask(
    request: AskExecutionTaskRequest,
  ): Promise<AskExecutionTaskResult> {
    const {
      qaCacheKey,
      taskSnapshot,
      providerRequest,
      taskAnalysis,
      taskTranscriptCues,
      taskConversationHistory,
      signal,
      isTaskCurrent,
      setPhase,
    } = request

    const ensureTaskActive = () => {
      if (!isTaskCurrent()) throw new Error("Ask Video task is no longer active.")
      if (signal.aborted) {
        throw new DOMException("The Ask Video request was cancelled.", "AbortError")
      }
    }

    ensureTaskActive()
    const cachedAnswer = await getQaAnswer(qaCacheKey)
    ensureTaskActive()

    let answer: AskVideoAnswer
    if (cachedAnswer) {
      answer = cachedAnswer.answer
    } else {
      const result = await runAskVideo({
        provider: { ...providerRequest },
        question: taskSnapshot.question,
        transcript: {
          videoId: taskSnapshot.videoId,
          title: taskSnapshot.videoTitle,
          cues: taskTranscriptCues,
        },
        analysis: taskAnalysis,
        conversationHistory: taskConversationHistory,
        signal,
        onRepairStart: () => setPhase("repairing"),
      })
      answer = result.answer
    }

    ensureTaskActive()
    setPhase("finalizing")

    if (!cachedAnswer) {
      const timestamp = now()
      await saveQaAnswer({
        cacheKey: qaCacheKey,
        contentKey: taskSnapshot.contentKey,
        transcriptFingerprint: taskSnapshot.transcriptFingerprint,
        analysisRunId: taskSnapshot.analysisRunId,
        providerProfileId: taskSnapshot.providerProfileId,
        providerBaseUrl: taskSnapshot.providerBaseUrl,
        providerModel: taskSnapshot.providerModel,
        question: taskSnapshot.question,
        schemaVersion: VIDEO_QA_SCHEMA_VERSION,
        promptVersion: VIDEO_QA_PROMPT_VERSION,
        answer,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    }

    const assistantMessage = await appendAssistantMessage({
      threadId: taskSnapshot.threadId,
      role: "assistant",
      content: answer.answer,
      citations: answer.citations,
      suggestedJumps: answer.suggestedJumps,
      followUps: answer.followUps,
    })

    return { answer, assistantMessage }
  }

  return {
    restoreConversation,
    openThread,
    deleteThread,
    prepareExecutionThread,
    prepareExecutionTurn,
    prepareExecutionTaskInput,
    runExecutionTask,
    prepareExecutionTranscriptIdentity,
    resolveOpenThreadTranscriptFingerprint,
  }
}
