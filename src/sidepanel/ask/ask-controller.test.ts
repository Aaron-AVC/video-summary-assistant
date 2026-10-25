import { describe, expect, it } from "bun:test"

import type { AskVideoAnswer, VideoAnalysis } from "@/features/analysis/lib/analysis-schema"
import type { AskTaskSnapshot } from "@/features/analysis/lib/ask-task-controller"
import {
  MAX_QA_CONTEXT_MESSAGES,
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
  type QaCacheIdentityInput,
} from "@/lib/persistence/cache-identity"
import type {
  QaAnswerEntity,
  QaMessageEntity,
  QaThreadEntity,
} from "@/lib/schemas/persistence"
import {
  ASK_THREAD_PROVIDER_UNAVAILABLE_MESSAGE,
  createAskController,
  projectAskAnswer,
  type AskAssistantMessageInput,
  type AskControllerDependencies,
  type AskExecutionTaskInputRequest,
  type AskExecutionTaskRequest,
  type AskExecutionThreadRequest,
  type AskExecutionTranscriptIdentityRequest,
  type AskExecutionTurnRequest,
  type AskOpenThreadTranscriptRequest,
  type AskProviderRequest,
  type AskUserMessageInput,
  type AskVideoExecutionInput,
  type CreateAskThreadInput,
} from "@/sidepanel/ask/ask-controller"
import {
  resolveAskTranscriptFingerprint,
  resolveAskTranscriptRequestIdentity,
} from "@/sidepanel/lib/ask-transcript-identity"
import { WorkspaceController } from "@/sidepanel/workspace/workspace-controller"

const CONTENT_KEY = "youtube:video-a"
const ANALYSIS_RUN_ID = "run-1"
const FINGERPRINT = "fp-1"

function createThread(overrides: Partial<QaThreadEntity> = {}): QaThreadEntity {
  return {
    id: "thread-a",
    contentKey: CONTENT_KEY,
    platform: "youtube",
    videoId: "video-a",
    partId: null,
    title: "Question",
    analysisRunId: ANALYSIS_RUN_ID,
    transcriptFingerprint: FINGERPRINT,
    providerProfileId: "provider-a",
    providerBaseUrl: "https://provider-a.example/v1",
    providerModel: "model-a",
    createdAt: "2026-10-14T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
    ...overrides,
  }
}

function createMessage(overrides: Partial<QaMessageEntity> = {}): QaMessageEntity {
  return {
    id: "message-a",
    threadId: "thread-a",
    sequence: 0,
    role: "user",
    content: "What happens at the start?",
    createdAt: "2026-10-14T00:00:00.000Z",
    ...overrides,
  }
}

type FakeCalls = {
  listQaThreadsForVideo: [string, string][]
  getQaThread: string[]
  listQaMessages: string[]
  deleteQaThread: string[]
  createQaThread: CreateAskThreadInput[]
  resolveProvider: string[]
  appendQaMessage: AskUserMessageInput[]
  getQaAnswer: string[]
  saveQaAnswer: QaAnswerEntity[]
  runAskVideo: AskVideoExecutionInput[]
  appendAssistantMessage: AskAssistantMessageInput[]
  order: string[]
}

function createFakeDependencies(overrides: Partial<AskControllerDependencies> = {}) {
  const calls: FakeCalls = {
    listQaThreadsForVideo: [],
    getQaThread: [],
    listQaMessages: [],
    deleteQaThread: [],
    createQaThread: [],
    resolveProvider: [],
    appendQaMessage: [],
    getQaAnswer: [],
    saveQaAnswer: [],
    runAskVideo: [],
    appendAssistantMessage: [],
    order: [],
  }

  const dependencies: AskControllerDependencies = {
    listQaThreadsForVideo: async (contentKey, analysisRunId) => {
      calls.listQaThreadsForVideo.push([contentKey, analysisRunId])
      return await (overrides.listQaThreadsForVideo?.(contentKey, analysisRunId) ?? [])
    },
    getQaThread: async (threadId) => {
      calls.getQaThread.push(threadId)
      return await (overrides.getQaThread?.(threadId) ?? null)
    },
    listQaMessages: async (threadId) => {
      calls.listQaMessages.push(threadId)
      calls.order.push("listQaMessages")
      return await (overrides.listQaMessages?.(threadId) ?? [])
    },
    deleteQaThread: async (threadId) => {
      calls.deleteQaThread.push(threadId)
      await overrides.deleteQaThread?.(threadId)
    },
    createQaThread: async (input) => {
      calls.createQaThread.push(input)
      return await (overrides.createQaThread?.(input) ?? createThread({ id: "created-thread", ...input }))
    },
    resolveProvider: async (providerId) => {
      calls.resolveProvider.push(providerId)
      return await (overrides.resolveProvider?.(providerId) ?? createResolvedProvider())
    },
    appendQaMessage: async (input) => {
      calls.appendQaMessage.push(input)
      calls.order.push("appendQaMessage")
      return await (overrides.appendQaMessage?.(input) ?? createMessage({
        id: "appended-message",
        threadId: input.threadId,
        role: input.role,
        content: input.content,
      }))
    },
    getQaAnswer: async (cacheKey) => {
      calls.getQaAnswer.push(cacheKey)
      calls.order.push("getQaAnswer")
      return await (overrides.getQaAnswer?.(cacheKey) ?? null)
    },
    saveQaAnswer: async (input) => {
      calls.saveQaAnswer.push(input)
      calls.order.push("saveQaAnswer")
      return await overrides.saveQaAnswer?.(input)
    },
    runAskVideo: async (input) => {
      calls.runAskVideo.push(input)
      calls.order.push("runAskVideo")
      return await (overrides.runAskVideo?.(input) ?? { answer: createAskAnswer() })
    },
    appendAssistantMessage: async (input) => {
      calls.appendAssistantMessage.push(input)
      calls.order.push("appendAssistantMessage")
      return await (overrides.appendAssistantMessage?.(input) ?? createMessage({
        id: "assistant-message",
        threadId: input.threadId,
        role: "assistant",
        content: input.content,
        citations: input.citations,
        suggestedJumps: input.suggestedJumps,
        followUps: input.followUps,
      }))
    },
    ...(overrides.now ? { now: overrides.now } : {}),
  }

  return { dependencies, calls }
}

function alwaysCurrent() {
  return () => true
}
function alwaysStale() {
  return () => false
}

const QUESTION = "What happens at the start of this video?"

function createProviderRequest(overrides: Partial<AskProviderRequest> = {}): AskProviderRequest {
  return {
    baseUrl: "https://provider-a.example/v1",
    apiKey: "secret-a",
    model: "model-a",
    generationTimeoutSec: 900,
    ...overrides,
  }
}

function createAnalysis(): VideoAnalysis {
  return {
    summary: "A short summary.",
    keyPoints: [{ text: "A key point.", startSec: 0, endSec: 5 }],
    chapters: [{
      title: "Chapter one",
      startSec: 0,
      endSec: 10,
      summary: "Chapter summary.",
      detail: "Chapter detail.",
    }],
  }
}

function createTranscriptCues(): TranscriptSegment[] {
  return [
    { startSec: 0, endSec: 5, text: "First cue." },
    { startSec: 5, endSec: 10, text: "Second cue." },
  ]
}

function createConversationHistory(): QaConversationContextMessage[] {
  return [
    { role: "user", content: "previous user" },
    { role: "assistant", content: "previous assistant" },
  ]
}

function createResolvedProvider(overrides: Partial<ResolvedProvider> = {}): ResolvedProvider {
  return {
    profile: {
      id: "provider-a",
      name: "Provider A",
      baseUrl: "https://resolved-a.example/v1",
      model: "resolved-model-a",
      generationTimeoutSec: 900,
      createdAt: "2026-10-14T00:00:00.000Z",
      updatedAt: "2026-10-14T00:00:00.000Z",
      isDefault: true,
      hasApiKey: true,
      ...overrides.profile,
    },
    apiKey: "secret-a",
    ...overrides,
  }
}

function createExecutionRequest(
  overrides: Partial<AskExecutionThreadRequest> = {},
): AskExecutionThreadRequest {
  return {
    requestedThreadId: "thread-a",
    contentKey: CONTENT_KEY,
    analysisRunId: ANALYSIS_RUN_ID,
    transcriptFingerprint: FINGERPRINT,
    platform: "youtube",
    videoId: "video-a",
    partId: null,
    question: QUESTION,
    selectedProviderId: "provider-selected",
    isCurrent: alwaysCurrent(),
    ...overrides,
  }
}

describe("AskController restoreConversation", () => {
  it("returns an empty ready snapshot without touching the repository when analysisRunId is null", async () => {
    const { dependencies, calls } = createFakeDependencies()
    const controller = createAskController(dependencies)

    const result = await controller.restoreConversation({
      contentKey: CONTENT_KEY,
      analysisRunId: null,
      transcriptFingerprint: FINGERPRINT,
      isCurrent: alwaysCurrent(),
    })

    expect(result).toEqual({
      kind: "ready",
      snapshot: { threads: [], currentThreadId: null, messages: [], answer: null },
    })
    expect(calls.listQaThreadsForVideo).toEqual([])
    expect(calls.listQaMessages).toEqual([])
  })

  it("returns stale without touching the repository when analysisRunId is null and the request is stale", async () => {
    const { dependencies, calls } = createFakeDependencies()
    const controller = createAskController(dependencies)

    const result = await controller.restoreConversation({
      contentKey: CONTENT_KEY,
      analysisRunId: undefined,
      transcriptFingerprint: FINGERPRINT,
      isCurrent: alwaysStale(),
    })

    expect(result).toEqual({ kind: "stale" })
    expect(calls.listQaThreadsForVideo).toEqual([])
    expect(calls.listQaMessages).toEqual([])
  })

  it("reads threads with the requested content key and analysis run", async () => {
    const { dependencies, calls } = createFakeDependencies()
    const controller = createAskController(dependencies)

    await controller.restoreConversation({
      contentKey: CONTENT_KEY,
      analysisRunId: ANALYSIS_RUN_ID,
      transcriptFingerprint: FINGERPRINT,
      isCurrent: alwaysCurrent(),
    })

    expect(calls.listQaThreadsForVideo).toEqual([[CONTENT_KEY, ANALYSIS_RUN_ID]])
  })

  it("filters threads by transcript fingerprint", async () => {
    const { dependencies } = createFakeDependencies({
      listQaThreadsForVideo: async () => [
        createThread({ id: "thread-other", transcriptFingerprint: "fp-other" }),
        createThread({ id: "thread-match" }),
      ],
    })
    const controller = createAskController(dependencies)

    const result = await controller.restoreConversation({
      contentKey: CONTENT_KEY,
      analysisRunId: ANALYSIS_RUN_ID,
      transcriptFingerprint: FINGERPRINT,
      isCurrent: alwaysCurrent(),
    })

    expect(result.kind).toBe("ready")
    if (result.kind !== "ready") return
    expect(result.snapshot.threads.map((thread) => thread.id)).toEqual(["thread-match"])
  })

  it("uses the first filtered thread as current", async () => {
    const { dependencies, calls } = createFakeDependencies({
      listQaThreadsForVideo: async () => [
        createThread({ id: "thread-newest", updatedAt: "2026-10-15T00:00:00.000Z" }),
        createThread({ id: "thread-older", updatedAt: "2026-10-14T00:00:00.000Z" }),
      ],
    })
    const controller = createAskController(dependencies)

    const result = await controller.restoreConversation({
      contentKey: CONTENT_KEY,
      analysisRunId: ANALYSIS_RUN_ID,
      transcriptFingerprint: FINGERPRINT,
      isCurrent: alwaysCurrent(),
    })

    expect(result.kind).toBe("ready")
    if (result.kind !== "ready") return
    expect(result.snapshot.currentThreadId).toBe("thread-newest")
    expect(calls.listQaMessages).toEqual(["thread-newest"])
  })

  it("reads messages only for the selected thread", async () => {
    const { dependencies, calls } = createFakeDependencies({
      listQaThreadsForVideo: async () => [
        createThread({ id: "thread-newest" }),
        createThread({ id: "thread-older" }),
      ],
      listQaMessages: async () => [createMessage({ id: "message-1" })],
    })
    const controller = createAskController(dependencies)

    await controller.restoreConversation({
      contentKey: CONTENT_KEY,
      analysisRunId: ANALYSIS_RUN_ID,
      transcriptFingerprint: FINGERPRINT,
      isCurrent: alwaysCurrent(),
    })

    expect(calls.listQaMessages).toEqual(["thread-newest"])
  })

  it("returns empty messages, null current thread, and null answer when no thread matches", async () => {
    const { dependencies, calls } = createFakeDependencies({
      listQaThreadsForVideo: async () => [
        createThread({ id: "thread-other", transcriptFingerprint: "fp-other" }),
      ],
    })
    const controller = createAskController(dependencies)

    const result = await controller.restoreConversation({
      contentKey: CONTENT_KEY,
      analysisRunId: ANALYSIS_RUN_ID,
      transcriptFingerprint: FINGERPRINT,
      isCurrent: alwaysCurrent(),
    })

    expect(result).toEqual({
      kind: "ready",
      snapshot: { threads: [], currentThreadId: null, messages: [], answer: null },
    })
    expect(calls.listQaMessages).toEqual([])
  })

  it("returns stale when the request stops being current after the reads complete", async () => {
    let current = true
    const { dependencies } = createFakeDependencies({
      listQaThreadsForVideo: async () => [createThread()],
      listQaMessages: async () => {
        current = false
        return [createMessage()]
      },
    })
    const controller = createAskController(dependencies)

    const result = await controller.restoreConversation({
      contentKey: CONTENT_KEY,
      analysisRunId: ANALYSIS_RUN_ID,
      transcriptFingerprint: FINGERPRINT,
      isCurrent: () => current,
    })

    expect(result).toEqual({ kind: "stale" })
  })
})

describe("AskController answer projection", () => {
  it("projects the last assistant message", () => {
    const answer = projectAskAnswer([
      createMessage({
        id: "assistant-old",
        sequence: 1,
        role: "assistant",
        content: "older answer",
        citations: [{ text: "older", startSec: 1, endSec: 2 }],
      }),
      createMessage({ id: "user-2", sequence: 2, role: "user", content: "follow up" }),
      createMessage({
        id: "assistant-new",
        sequence: 3,
        role: "assistant",
        content: "newest answer",
        citations: [{ text: "newest", startSec: 10, endSec: 20 }],
      }),
    ])

    expect(answer?.answer).toBe("newest answer")
    expect(answer?.citations).toEqual([{ text: "newest", startSec: 10, endSec: 20 }])
  })

  it("falls back to startSec when a citation has no endSec", () => {
    const answer = projectAskAnswer([
      createMessage({
        role: "assistant",
        content: "answer",
        citations: [{ text: "cue", startSec: 42 }],
      }),
    ])

    expect(answer?.citations).toEqual([{ text: "cue", startSec: 42, endSec: 42 }])
  })

  it("defaults missing followUps and suggestedJumps to empty arrays", () => {
    const answer = projectAskAnswer([
      createMessage({
        role: "assistant",
        content: "answer",
        citations: [{ startSec: 1, endSec: 2 }],
      }),
    ])

    expect(answer?.followUps).toEqual([])
    expect(answer?.suggestedJumps).toEqual([])
  })

  it("returns null when the latest assistant message has no citations", () => {
    const answer = projectAskAnswer([
      createMessage({ role: "assistant", content: "answer without citations" }),
    ])

    expect(answer).toBeNull()
  })
})

describe("AskController openThread", () => {
  it("does not read messages when the thread does not exist", async () => {
    const { dependencies, calls } = createFakeDependencies()
    const controller = createAskController(dependencies)

    const result = await controller.openThread({
      threadId: "thread-a",
      contentKey: CONTENT_KEY,
      analysisRunId: ANALYSIS_RUN_ID,
      transcriptFingerprint: FINGERPRINT,
      isCurrent: alwaysCurrent(),
    })

    expect(result).toEqual({ kind: "mismatch", reason: "missing-thread" })
    expect(calls.listQaMessages).toEqual([])
  })

  it("does not read messages when the content key does not match", async () => {
    const { dependencies, calls } = createFakeDependencies({
      getQaThread: async () => createThread({ contentKey: "youtube:other" }),
    })
    const controller = createAskController(dependencies)

    const result = await controller.openThread({
      threadId: "thread-a",
      contentKey: CONTENT_KEY,
      analysisRunId: ANALYSIS_RUN_ID,
      transcriptFingerprint: FINGERPRINT,
      isCurrent: alwaysCurrent(),
    })

    expect(result).toEqual({ kind: "mismatch", reason: "content-key-mismatch" })
    expect(calls.listQaMessages).toEqual([])
  })

  it("does not read messages when the analysis run does not match", async () => {
    const { dependencies, calls } = createFakeDependencies({
      getQaThread: async () => createThread({ analysisRunId: "run-other" }),
    })
    const controller = createAskController(dependencies)

    const result = await controller.openThread({
      threadId: "thread-a",
      contentKey: CONTENT_KEY,
      analysisRunId: ANALYSIS_RUN_ID,
      transcriptFingerprint: FINGERPRINT,
      isCurrent: alwaysCurrent(),
    })

    expect(result).toEqual({ kind: "mismatch", reason: "analysis-run-mismatch" })
    expect(calls.listQaMessages).toEqual([])
  })

  it("does not read messages when the transcript fingerprint does not match", async () => {
    const { dependencies, calls } = createFakeDependencies({
      getQaThread: async () => createThread({ transcriptFingerprint: "fp-other" }),
    })
    const controller = createAskController(dependencies)

    const result = await controller.openThread({
      threadId: "thread-a",
      contentKey: CONTENT_KEY,
      analysisRunId: ANALYSIS_RUN_ID,
      transcriptFingerprint: FINGERPRINT,
      isCurrent: alwaysCurrent(),
    })

    expect(result).toEqual({ kind: "mismatch", reason: "transcript-fingerprint-mismatch" })
    expect(calls.listQaMessages).toEqual([])
  })

  it("does not read messages when the requested transcript fingerprint is missing", async () => {
    const { dependencies, calls } = createFakeDependencies({
      getQaThread: async () => createThread(),
    })
    const controller = createAskController(dependencies)

    const result = await controller.openThread({
      threadId: "thread-a",
      contentKey: CONTENT_KEY,
      analysisRunId: ANALYSIS_RUN_ID,
      transcriptFingerprint: null,
      isCurrent: alwaysCurrent(),
    })

    expect(result).toEqual({ kind: "mismatch", reason: "transcript-fingerprint-missing" })
    expect(calls.listQaMessages).toEqual([])
  })

  it("reads messages and returns a ready snapshot on an exact identity match", async () => {
    const { dependencies, calls } = createFakeDependencies({
      getQaThread: async () => createThread(),
      listQaMessages: async () => [
        createMessage({ id: "message-1", sequence: 0, role: "user", content: "question" }),
        createMessage({
          id: "message-2",
          sequence: 1,
          role: "assistant",
          content: "answer",
          citations: [{ text: "cue", startSec: 5, endSec: 9 }],
        }),
      ],
    })
    const controller = createAskController(dependencies)

    const result = await controller.openThread({
      threadId: "thread-a",
      contentKey: CONTENT_KEY,
      analysisRunId: ANALYSIS_RUN_ID,
      transcriptFingerprint: FINGERPRINT,
      isCurrent: alwaysCurrent(),
    })

    expect(calls.getQaThread).toEqual(["thread-a"])
    expect(calls.listQaMessages).toEqual(["thread-a"])
    expect(result.kind).toBe("ready")
    if (result.kind !== "ready") return
    expect(result.thread.threadId).toBe("thread-a")
    expect(result.thread.messages).toHaveLength(2)
    expect(result.thread.answer?.answer).toBe("answer")
    expect(result.thread.answer?.citations).toEqual([{ text: "cue", startSec: 5, endSec: 9 }])
  })

  it("returns stale when the request stops being current after the messages read", async () => {
    let current = true
    const { dependencies } = createFakeDependencies({
      getQaThread: async () => createThread(),
      listQaMessages: async () => {
        current = false
        return [createMessage()]
      },
    })
    const controller = createAskController(dependencies)

    const result = await controller.openThread({
      threadId: "thread-a",
      contentKey: CONTENT_KEY,
      analysisRunId: ANALYSIS_RUN_ID,
      transcriptFingerprint: FINGERPRINT,
      isCurrent: () => current,
    })

    expect(result).toEqual({ kind: "stale" })
  })
})

describe("AskController deleteThread", () => {
  it("calls the repository delete with the exact thread id", async () => {
    const { dependencies, calls } = createFakeDependencies()
    const controller = createAskController(dependencies)

    const result = await controller.deleteThread({ threadId: "thread-a" })

    expect(result).toEqual({ kind: "deleted" })
    expect(calls.deleteQaThread).toEqual(["thread-a"])
  })

  it("propagates a repository delete error unchanged", async () => {
    const failure = new Error("delete failed")
    const { dependencies } = createFakeDependencies({
      deleteQaThread: async () => {
        throw failure
      },
    })
    const controller = createAskController(dependencies)

    await expect(controller.deleteThread({ threadId: "thread-a" })).rejects.toBe(failure)
  })
})

describe("AskController dependency errors", () => {
  it("propagates thread read errors unchanged", async () => {
    const failure = new Error("read failed")
    const { dependencies } = createFakeDependencies({
      listQaThreadsForVideo: async () => {
        throw failure
      },
    })
    const controller = createAskController(dependencies)

    await expect(controller.restoreConversation({
      contentKey: CONTENT_KEY,
      analysisRunId: ANALYSIS_RUN_ID,
      transcriptFingerprint: FINGERPRINT,
      isCurrent: alwaysCurrent(),
    })).rejects.toBe(failure)
  })

  it("propagates message read errors unchanged", async () => {
    const failure = new Error("messages failed")
    const { dependencies } = createFakeDependencies({
      getQaThread: async () => createThread(),
      listQaMessages: async () => {
        throw failure
      },
    })
    const controller = createAskController(dependencies)

    await expect(controller.openThread({
      threadId: "thread-a",
      contentKey: CONTENT_KEY,
      analysisRunId: ANALYSIS_RUN_ID,
      transcriptFingerprint: FINGERPRINT,
      isCurrent: alwaysCurrent(),
    })).rejects.toBe(failure)
  })
})

describe("AskController prepareExecutionThread existing thread", () => {
  it("does not read a thread when requestedThreadId is null", async () => {
    const { dependencies, calls } = createFakeDependencies()
    const controller = createAskController(dependencies)

    await controller.prepareExecutionThread(
      createExecutionRequest({ requestedThreadId: null }),
    )

    expect(calls.getQaThread).toEqual([])
  })

  it("reuses an exact identity match without creating a thread", async () => {
    const { dependencies, calls } = createFakeDependencies({
      getQaThread: async () => createThread(),
    })
    const controller = createAskController(dependencies)

    const result = await controller.prepareExecutionThread(createExecutionRequest())

    expect(result.kind).toBe("ready")
    if (result.kind !== "ready") throw new Error("unreachable")
    expect(result.created).toBe(false)
    expect(result.thread.id).toBe("thread-a")
    expect(calls.getQaThread).toEqual(["thread-a"])
    expect(calls.createQaThread).toEqual([])
  })

  it("resolves the provider of the reused thread, not the selected provider", async () => {
    const { dependencies, calls } = createFakeDependencies({
      getQaThread: async () => createThread({ providerProfileId: "provider-thread" }),
    })
    const controller = createAskController(dependencies)

    await controller.prepareExecutionThread(createExecutionRequest())

    expect(calls.resolveProvider).toEqual(["provider-thread"])
  })

  it("maps a reused-thread provider resolution failure to the exact conversation error", async () => {
    const { dependencies } = createFakeDependencies({
      getQaThread: async () => createThread(),
      resolveProvider: async () => {
        throw new Error("provider record missing")
      },
    })
    const controller = createAskController(dependencies)

    const failure = await controller
      .prepareExecutionThread(createExecutionRequest())
      .then(() => null)
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(ASK_THREAD_PROVIDER_UNAVAILABLE_MESSAGE)
    expect((failure as Error).message).toBe(
      "The provider used by this conversation is no longer available. Start a new chat to use the current provider.",
    )
  })

  it("freezes the provider request from persisted thread fields and resolved secrets", async () => {
    const { dependencies } = createFakeDependencies({
      getQaThread: async () => createThread({
        providerBaseUrl: "https://thread-persisted.example/v1",
        providerModel: "thread-persisted-model",
      }),
      resolveProvider: async () => createResolvedProvider(),
    })
    const controller = createAskController(dependencies)

    const result = await controller.prepareExecutionThread(createExecutionRequest())

    if (result.kind !== "ready") throw new Error("unreachable")
    expect(result.providerRequest).toEqual({
      baseUrl: "https://thread-persisted.example/v1",
      apiKey: "secret-a",
      model: "thread-persisted-model",
      generationTimeoutSec: 900,
    })
  })
})

describe("AskController prepareExecutionThread new thread", () => {
  it("creates a new thread when the requested thread is missing", async () => {
    const { dependencies, calls } = createFakeDependencies({
      getQaThread: async () => null,
    })
    const controller = createAskController(dependencies)

    const result = await controller.prepareExecutionThread(createExecutionRequest())

    if (result.kind !== "ready") throw new Error("unreachable")
    expect(result.created).toBe(true)
    expect(calls.createQaThread).toHaveLength(1)
  })

  it("creates a new thread when the content key mismatches", async () => {
    const { dependencies, calls } = createFakeDependencies({
      getQaThread: async () => createThread({ contentKey: "youtube:video-other" }),
    })
    const controller = createAskController(dependencies)

    const result = await controller.prepareExecutionThread(createExecutionRequest())

    if (result.kind !== "ready") throw new Error("unreachable")
    expect(result.created).toBe(true)
    expect(calls.createQaThread).toHaveLength(1)
  })

  it("creates a new thread when the analysis run mismatches", async () => {
    const { dependencies, calls } = createFakeDependencies({
      getQaThread: async () => createThread({ analysisRunId: "run-other" }),
    })
    const controller = createAskController(dependencies)

    const result = await controller.prepareExecutionThread(createExecutionRequest())

    if (result.kind !== "ready") throw new Error("unreachable")
    expect(result.created).toBe(true)
    expect(calls.createQaThread).toHaveLength(1)
  })

  it("creates a new thread when the transcript fingerprint mismatches", async () => {
    const { dependencies, calls } = createFakeDependencies({
      getQaThread: async () => createThread({ transcriptFingerprint: "fp-other" }),
    })
    const controller = createAskController(dependencies)

    const result = await controller.prepareExecutionThread(createExecutionRequest())

    if (result.kind !== "ready") throw new Error("unreachable")
    expect(result.created).toBe(true)
    expect(calls.createQaThread).toHaveLength(1)
  })

  it("resolves the selected provider on the new-thread path", async () => {
    const { dependencies, calls } = createFakeDependencies({
      getQaThread: async () => null,
    })
    const controller = createAskController(dependencies)

    await controller.prepareExecutionThread(createExecutionRequest())

    expect(calls.resolveProvider).toEqual(["provider-selected"])
  })

  it("propagates the new-thread provider failure unchanged", async () => {
    const failure = new Error("no default provider configured")
    const { dependencies } = createFakeDependencies({
      getQaThread: async () => null,
      resolveProvider: async () => {
        throw failure
      },
    })
    const controller = createAskController(dependencies)

    await expect(
      controller.prepareExecutionThread(createExecutionRequest()),
    ).rejects.toBe(failure)
  })

  it("builds the exact new-thread payload", async () => {
    const { dependencies, calls } = createFakeDependencies({
      getQaThread: async () => null,
      resolveProvider: async () => createResolvedProvider(),
    })
    const controller = createAskController(dependencies)

    const result = await controller.prepareExecutionThread(
      createExecutionRequest({ partId: "part-2", question: QUESTION }),
    )

    expect(calls.createQaThread).toEqual([{
      contentKey: CONTENT_KEY,
      platform: "youtube",
      videoId: "video-a",
      partId: "part-2",
      title: QUESTION.slice(0, 60),
      analysisRunId: ANALYSIS_RUN_ID,
      transcriptFingerprint: FINGERPRINT,
      providerProfileId: "provider-selected",
      providerBaseUrl: "https://resolved-a.example/v1",
      providerModel: "resolved-model-a",
    }])
    if (result.kind !== "ready") throw new Error("unreachable")
    expect(result.created).toBe(true)
    expect(result.thread.id).toBe("created-thread")
  })

  it("truncates the title to the first 60 characters", async () => {
    const longQuestion = "q".repeat(120)
    const { dependencies, calls } = createFakeDependencies({
      getQaThread: async () => null,
    })
    const controller = createAskController(dependencies)

    await controller.prepareExecutionThread(
      createExecutionRequest({ question: longQuestion }),
    )

    expect(calls.createQaThread[0]!.title).toBe("q".repeat(60))
  })
})

describe("AskController prepareExecutionThread currentness", () => {
  it("returns stale after the reuse decision without resolving a provider or creating a thread", async () => {
    const { dependencies, calls } = createFakeDependencies({
      getQaThread: async () => createThread(),
    })
    const controller = createAskController(dependencies)

    const result = await controller.prepareExecutionThread(
      createExecutionRequest({ isCurrent: alwaysStale() }),
    )

    expect(result).toEqual({ kind: "stale" })
    expect(calls.getQaThread).toEqual(["thread-a"])
    expect(calls.resolveProvider).toEqual([])
    expect(calls.createQaThread).toEqual([])
  })

  it("reads the existing thread before the first currentness check", async () => {
    const order: string[] = []
    const { dependencies } = createFakeDependencies({
      getQaThread: async () => {
        order.push("getQaThread")
        return createThread()
      },
      resolveProvider: async () => {
        order.push("resolveProvider")
        return createResolvedProvider()
      },
    })
    const controller = createAskController(dependencies)

    await controller.prepareExecutionThread(createExecutionRequest({
      isCurrent: () => {
        order.push("isCurrent")
        return true
      },
    }))

    expect(order).toEqual(["getQaThread", "isCurrent", "resolveProvider"])
  })

  it("resolves the provider only when the request is current", async () => {
    const { dependencies, calls } = createFakeDependencies({
      getQaThread: async () => null,
    })
    const controller = createAskController(dependencies)

    await controller.prepareExecutionThread(createExecutionRequest())

    expect(calls.resolveProvider).toHaveLength(1)
    expect(calls.createQaThread).toHaveLength(1)
  })
})

describe("AskController prepareExecutionThread errors", () => {
  it("propagates getQaThread failures unchanged", async () => {
    const failure = new Error("thread read failed")
    const { dependencies } = createFakeDependencies({
      getQaThread: async () => {
        throw failure
      },
    })
    const controller = createAskController(dependencies)

    await expect(
      controller.prepareExecutionThread(createExecutionRequest()),
    ).rejects.toBe(failure)
  })

  it("propagates createQaThread failures unchanged", async () => {
    const failure = new Error("thread write failed")
    const { dependencies } = createFakeDependencies({
      getQaThread: async () => null,
      createQaThread: async () => {
        throw failure
      },
    })
    const controller = createAskController(dependencies)

    await expect(
      controller.prepareExecutionThread(createExecutionRequest()),
    ).rejects.toBe(failure)
  })
})

function createTurnRequest(
  overrides: Partial<AskExecutionTurnRequest> = {},
): AskExecutionTurnRequest {
  return {
    threadId: "thread-a",
    question: "What happened?",
    ...overrides,
  }
}

describe("AskController prepareExecutionTurn", () => {
  it("reads historical messages before appending the user message", async () => {
    const { dependencies, calls } = createFakeDependencies()
    const controller = createAskController(dependencies)

    await controller.prepareExecutionTurn(createTurnRequest())

    expect(calls.order).toEqual(["listQaMessages", "appendQaMessage"])
  })

  it("appends the exact narrow user payload", async () => {
    const { dependencies, calls } = createFakeDependencies()
    const controller = createAskController(dependencies)

    await controller.prepareExecutionTurn(createTurnRequest({
      threadId: "thread-a",
      question: "What happened?",
    }))

    expect(calls.appendQaMessage).toEqual([{
      threadId: "thread-a",
      role: "user",
      content: "What happened?",
    }])
    expect(Object.keys(calls.appendQaMessage[0]!).sort()).toEqual(["content", "role", "threadId"])
  })

  it("returns the persisted user message unchanged", async () => {
    const persisted = createMessage({
      id: "persisted-user-message",
      threadId: "thread-a",
      sequence: 4,
      role: "user",
      content: "What happened?",
      createdAt: "2026-10-20T10:00:00.000Z",
    })
    const { dependencies } = createFakeDependencies({
      appendQaMessage: async () => persisted,
    })
    const controller = createAskController(dependencies)

    const result = await controller.prepareExecutionTurn(createTurnRequest())

    expect(result.userMessage).toBe(persisted)
  })

  it("excludes the current question from the returned conversation history", async () => {
    const { dependencies } = createFakeDependencies({
      listQaMessages: async () => [
        createMessage({ id: "previous-user", role: "user", content: "previous user" }),
        createMessage({ id: "previous-assistant", role: "assistant", content: "previous assistant" }),
      ],
      appendQaMessage: async (input) => createMessage({
        id: "current-user",
        threadId: input.threadId,
        role: "user",
        content: input.content,
      }),
    })
    const controller = createAskController(dependencies)

    const result = await controller.prepareExecutionTurn(
      createTurnRequest({ question: "new question" }),
    )

    expect(result.conversationHistory).toEqual([
      { role: "user", content: "previous user" },
      { role: "assistant", content: "previous assistant" },
    ])
    expect(result.conversationHistory.some((message) => message.content === "new question")).toBe(false)
  })

  it("applies the existing bounding policy to blank and oversized history", async () => {
    const blankHeavy = [
      createMessage({ id: "blank-1", role: "user", content: "   " }),
      createMessage({ id: "blank-2", role: "assistant", content: "" }),
      ...Array.from({ length: 8 }, (_, index) => createMessage({
        id: `history-${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `  history message ${index}  `,
      })),
    ]
    const { dependencies } = createFakeDependencies({
      listQaMessages: async () => blankHeavy,
    })
    const controller = createAskController(dependencies)

    const result = await controller.prepareExecutionTurn(createTurnRequest())

    expect(result.conversationHistory).toEqual(boundQaConversationContext(
      blankHeavy.map((message) => ({ role: message.role, content: message.content })),
    ))
    expect(result.conversationHistory).toHaveLength(MAX_QA_CONTEXT_MESSAGES)
    expect(result.conversationHistory.some((message) => message.content.trim().length === 0)).toBe(false)
  })

  it("propagates a message read failure without appending", async () => {
    const failure = new Error("history read failed")
    const { dependencies, calls } = createFakeDependencies({
      listQaMessages: async () => {
        throw failure
      },
    })
    const controller = createAskController(dependencies)

    await expect(
      controller.prepareExecutionTurn(createTurnRequest()),
    ).rejects.toBe(failure)
    expect(calls.appendQaMessage).toEqual([])
  })

  it("propagates an append failure after reading history once", async () => {
    const failure = new Error("append failed")
    const { dependencies, calls } = createFakeDependencies({
      appendQaMessage: async () => {
        throw failure
      },
    })
    const controller = createAskController(dependencies)

    await expect(
      controller.prepareExecutionTurn(createTurnRequest()),
    ).rejects.toBe(failure)
    expect(calls.listQaMessages).toEqual(["thread-a"])
    expect(calls.order).toEqual(["listQaMessages", "appendQaMessage"])
  })

  it("touches only the message list and append dependencies", async () => {
    const { dependencies, calls } = createFakeDependencies()
    const controller = createAskController(dependencies)

    await controller.prepareExecutionTurn(createTurnRequest())

    expect(calls.listQaMessages).toEqual(["thread-a"])
    expect(calls.appendQaMessage).toHaveLength(1)
    expect(calls.getQaThread).toEqual([])
    expect(calls.listQaThreadsForVideo).toEqual([])
    expect(calls.createQaThread).toEqual([])
    expect(calls.deleteQaThread).toEqual([])
    expect(calls.resolveProvider).toEqual([])
  })
})

function createTaskInputRequest(
  overrides: Partial<AskExecutionTaskInputRequest> = {},
): AskExecutionTaskInputRequest {
  return {
    thread: createThread(),
    requestedContentKey: CONTENT_KEY,
    requestedAnalysisRunId: ANALYSIS_RUN_ID,
    question: QUESTION,
    providerRequest: createProviderRequest(),
    platform: "youtube",
    videoId: "video-a",
    partId: null,
    videoTitle: "Video A",
    analysis: createAnalysis(),
    transcriptCues: createTranscriptCues(),
    conversationHistory: createConversationHistory(),
    ...overrides,
  }
}

async function expectCacheKey(
  overrides: Partial<AskExecutionTaskInputRequest>,
  expected: QaCacheIdentityInput,
) {
  const controller = createAskController(createFakeDependencies().dependencies)
  const result = await controller.prepareExecutionTaskInput(createTaskInputRequest(overrides))

  expect(result.qaCacheKey).toBe(await computeQaCacheKey(expected))
  return result
}

describe("AskController prepareExecutionTaskInput cache identity", () => {
  it("derives the cache key from the existing QA cache identity helper", async () => {
    const request = createTaskInputRequest()
    const controller = createAskController(createFakeDependencies().dependencies)

    const result = await controller.prepareExecutionTaskInput(request)

    expect(result.qaCacheKey).toBe(await computeQaCacheKey({
      contentKey: request.requestedContentKey,
      transcriptFingerprint: request.thread.transcriptFingerprint,
      analysisRunId: request.thread.analysisRunId,
      providerProfileId: request.thread.providerProfileId,
      baseUrl: request.thread.providerBaseUrl,
      model: request.thread.providerModel,
      question: request.question,
      conversationContextFingerprint:
        await computeBoundedConversationContextFingerprint(request.conversationHistory),
    }))
  })

  it("keeps the persisted thread analysisRunId in the cache key while the task snapshot uses the requested run", async () => {
    const result = await expectCacheKey(
      {
        requestedAnalysisRunId: "requested-run",
        thread: createThread({ analysisRunId: "persisted-thread-run" }),
      },
      {
        contentKey: CONTENT_KEY,
        transcriptFingerprint: FINGERPRINT,
        analysisRunId: "persisted-thread-run",
        providerProfileId: "provider-a",
        baseUrl: "https://provider-a.example/v1",
        model: "model-a",
        question: QUESTION,
        conversationContextFingerprint:
          await computeBoundedConversationContextFingerprint(createConversationHistory()),
      },
    )

    expect(result.taskSnapshot.analysisRunId).toBe("requested-run")
  })

  it("takes cache provider identity from the thread, not the provider request", async () => {
    const result = await expectCacheKey(
      {
        providerRequest: {
          baseUrl: "https://request-base.example/v9",
          apiKey: "secret-a",
          model: "request-model",
          generationTimeoutSec: 900,
        },
      },
      {
        contentKey: CONTENT_KEY,
        transcriptFingerprint: FINGERPRINT,
        analysisRunId: ANALYSIS_RUN_ID,
        providerProfileId: "provider-a",
        baseUrl: "https://provider-a.example/v1",
        model: "model-a",
        question: QUESTION,
        conversationContextFingerprint:
          await computeBoundedConversationContextFingerprint(createConversationHistory()),
      },
    )

    expect(result.taskSnapshot.providerBaseUrl).toBe("https://provider-a.example/v1")
    expect(result.taskSnapshot.providerModel).toBe("model-a")
    expect(result.taskSnapshot.providerProfileId).toBe("provider-a")
  })

  it("keeps the conversation context inside the cache identity", async () => {
    const controller = createAskController(createFakeDependencies().dependencies)

    const withHistory = await controller.prepareExecutionTaskInput(createTaskInputRequest())
    const withoutHistory = await controller.prepareExecutionTaskInput(createTaskInputRequest({
      conversationHistory: [],
    }))

    expect(withHistory.qaCacheKey).not.toBe(withoutHistory.qaCacheKey)
  })

  it("matches the helper semantics for an empty conversation history", async () => {
    const result = await expectCacheKey(
      { conversationHistory: [] },
      {
        contentKey: CONTENT_KEY,
        transcriptFingerprint: FINGERPRINT,
        analysisRunId: ANALYSIS_RUN_ID,
        providerProfileId: "provider-a",
        baseUrl: "https://provider-a.example/v1",
        model: "model-a",
        question: QUESTION,
        conversationContextFingerprint: null,
      },
    )

    expect(await computeBoundedConversationContextFingerprint([])).toBeNull()
    expect(result.taskSnapshot).toBeDefined()
  })
})

describe("AskController prepareExecutionTaskInput frozen task inputs", () => {
  it("builds the exact task snapshot from the captured sources", async () => {
    const request = createTaskInputRequest()
    const controller = createAskController(createFakeDependencies().dependencies)

    const { taskSnapshot } = await controller.prepareExecutionTaskInput(request)

    expect(taskSnapshot).toEqual({
      contentKey: CONTENT_KEY,
      analysisRunId: ANALYSIS_RUN_ID,
      transcriptFingerprint: FINGERPRINT,
      threadId: "thread-a",
      platform: "youtube",
      videoId: "video-a",
      partId: null,
      videoTitle: "Video A",
      question: QUESTION,
      providerProfileId: "provider-a",
      providerBaseUrl: "https://provider-a.example/v1",
      providerModel: "model-a",
      generationTimeoutSec: 900,
    })
    expect(Object.keys(taskSnapshot).sort()).toEqual([
      "analysisRunId",
      "contentKey",
      "generationTimeoutSec",
      "partId",
      "platform",
      "providerBaseUrl",
      "providerModel",
      "providerProfileId",
      "question",
      "threadId",
      "transcriptFingerprint",
      "videoId",
      "videoTitle",
    ])
  })

  it("takes source metadata from the captured analysis view, not the thread", async () => {
    const controller = createAskController(createFakeDependencies().dependencies)

    const { taskSnapshot } = await controller.prepareExecutionTaskInput(createTaskInputRequest({
      thread: createThread({
        platform: "bilibili",
        videoId: "thread-video",
        partId: "thread-part",
        title: "Thread title",
      }),
      platform: "youtube",
      videoId: "view-video",
      partId: "view-part",
      videoTitle: "View title",
    }))

    expect(taskSnapshot.platform).toBe("youtube")
    expect(taskSnapshot.videoId).toBe("view-video")
    expect(taskSnapshot.partId).toBe("view-part")
    expect(taskSnapshot.videoTitle).toBe("View title")
  })

  it("falls back to the 600 second default when the provider request omits the timeout", async () => {
    const controller = createAskController(createFakeDependencies().dependencies)

    const { taskSnapshot } = await controller.prepareExecutionTaskInput(createTaskInputRequest({
      providerRequest: {
        baseUrl: "https://provider-a.example/v1",
        apiKey: "secret-a",
        model: "model-a",
        generationTimeoutSec: undefined as unknown as number,
      },
    }))

    expect(taskSnapshot.generationTimeoutSec).toBe(600)
  })

  it("never lets the API key reach the task snapshot", async () => {
    const controller = createAskController(createFakeDependencies().dependencies)

    const result = await controller.prepareExecutionTaskInput(createTaskInputRequest({
      providerRequest: {
        baseUrl: "https://provider-a.example/v1",
        apiKey: "super-secret",
        model: "model-a",
        generationTimeoutSec: 900,
      },
    }))

    expect("apiKey" in result.taskSnapshot).toBe(false)
    expect(JSON.stringify(result.taskSnapshot)).not.toContain("super-secret")
    expect(result.providerRequest.apiKey).toBe("super-secret")
    expect(result.qaCacheKey).not.toContain("super-secret")
  })

  it("returns the provider request as an execution capability copy", async () => {
    const request = createTaskInputRequest()
    const controller = createAskController(createFakeDependencies().dependencies)

    const { providerRequest } = await controller.prepareExecutionTaskInput(request)

    expect(providerRequest).toEqual(request.providerRequest)
    expect(providerRequest).not.toBe(request.providerRequest)
  })

  it("freezes the transcript cues with a shallow copy", async () => {
    const request = createTaskInputRequest()
    const controller = createAskController(createFakeDependencies().dependencies)

    const { taskTranscriptCues } = await controller.prepareExecutionTaskInput(request)

    expect(taskTranscriptCues).not.toBe(request.transcriptCues)
    expect(taskTranscriptCues).toEqual(request.transcriptCues)
    expect(taskTranscriptCues[0]).toBe(request.transcriptCues[0])
  })

  it("freezes the conversation history with a shallow copy", async () => {
    const request = createTaskInputRequest()
    const controller = createAskController(createFakeDependencies().dependencies)

    const { taskConversationHistory } = await controller.prepareExecutionTaskInput(request)

    expect(taskConversationHistory).not.toBe(request.conversationHistory)
    expect(taskConversationHistory).toEqual(request.conversationHistory)
    expect(taskConversationHistory[0]).toBe(request.conversationHistory[0])
  })

  it("returns the captured analysis payload unchanged", async () => {
    const request = createTaskInputRequest()
    const controller = createAskController(createFakeDependencies().dependencies)

    const { taskAnalysis } = await controller.prepareExecutionTaskInput(request)

    expect(taskAnalysis).toBe(request.analysis)
  })

  it("touches no repository or provider dependency", async () => {
    const { dependencies, calls } = createFakeDependencies()
    const controller = createAskController(dependencies)

    await controller.prepareExecutionTaskInput(createTaskInputRequest())

    expect(calls.listQaMessages).toEqual([])
    expect(calls.appendQaMessage).toEqual([])
    expect(calls.getQaThread).toEqual([])
    expect(calls.listQaThreadsForVideo).toEqual([])
    expect(calls.createQaThread).toEqual([])
    expect(calls.deleteQaThread).toEqual([])
    expect(calls.resolveProvider).toEqual([])
  })
})

const FIXED_NOW = "2026-10-21T00:00:00.000Z"

function createAskAnswer(overrides: Partial<AskVideoAnswer> = {}): AskVideoAnswer {
  return {
    answer: "The video starts with an introduction.",
    citations: [{ startSec: 0, endSec: 5, text: "First cue." }],
    suggestedJumps: [{ title: "Start", startSec: 0, endSec: 5 }],
    followUps: ["What comes next?"],
    ...overrides,
  }
}

function createQaAnswerEntity(overrides: Partial<QaAnswerEntity> = {}): QaAnswerEntity {
  return {
    cacheKey: "cache-key-a",
    contentKey: CONTENT_KEY,
    transcriptFingerprint: FINGERPRINT,
    analysisRunId: ANALYSIS_RUN_ID,
    providerProfileId: "provider-a",
    providerBaseUrl: "https://provider-a.example/v1",
    providerModel: "model-a",
    question: QUESTION,
    schemaVersion: VIDEO_QA_SCHEMA_VERSION,
    promptVersion: VIDEO_QA_PROMPT_VERSION,
    answer: createAskAnswer(),
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  }
}

function createTaskSnapshot(
  overrides: Partial<Omit<AskTaskSnapshot, "taskId" | "startedAt">> = {},
): Omit<AskTaskSnapshot, "taskId" | "startedAt"> {
  return {
    contentKey: CONTENT_KEY,
    analysisRunId: ANALYSIS_RUN_ID,
    transcriptFingerprint: FINGERPRINT,
    threadId: "thread-a",
    platform: "youtube",
    videoId: "video-a",
    partId: null,
    videoTitle: "Video A",
    question: QUESTION,
    providerProfileId: "provider-a",
    providerBaseUrl: "https://provider-a.example/v1",
    providerModel: "model-a",
    generationTimeoutSec: 900,
    ...overrides,
  }
}

function createExecutionTaskRequest(
  overrides: Partial<AskExecutionTaskRequest> = {},
): AskExecutionTaskRequest {
  return {
    qaCacheKey: "cache-key-a",
    taskSnapshot: createTaskSnapshot(),
    providerRequest: createProviderRequest(),
    taskAnalysis: createAnalysis(),
    taskTranscriptCues: createTranscriptCues(),
    taskConversationHistory: createConversationHistory(),
    signal: new AbortController().signal,
    isTaskCurrent: () => true,
    setPhase: () => {},
    ...overrides,
  }
}

function createPhaseRecorder() {
  const phases: ("repairing" | "finalizing")[] = []
  return {
    phases,
    setPhase: (phase: "repairing" | "finalizing") => { phases.push(phase) },
  }
}

describe("AskController runExecutionTask cache behaviour", () => {
  it("serves a cache hit without calling the model or writing the cache", async () => {
    const cachedAnswer = createQaAnswerEntity()
    const { dependencies, calls } = createFakeDependencies({
      getQaAnswer: async () => cachedAnswer,
    })
    const controller = createAskController(dependencies)
    const { phases, setPhase } = createPhaseRecorder()

    const result = await controller.runExecutionTask(createExecutionTaskRequest({ setPhase }))

    expect(calls.getQaAnswer).toEqual(["cache-key-a"])
    expect(calls.runAskVideo).toHaveLength(0)
    expect(calls.saveQaAnswer).toHaveLength(0)
    expect(calls.appendAssistantMessage).toHaveLength(1)
    expect(phases).toEqual(["finalizing"])
    expect(result.answer).toBe(cachedAnswer.answer)
  })

  it("runs the model, writes the cache, then persists the assistant message on a cache miss", async () => {
    const { dependencies, calls } = createFakeDependencies()
    const controller = createAskController(dependencies)
    const { phases, setPhase } = createPhaseRecorder()

    await controller.runExecutionTask(createExecutionTaskRequest({ setPhase }))

    expect(calls.order).toEqual([
      "getQaAnswer",
      "runAskVideo",
      "saveQaAnswer",
      "appendAssistantMessage",
    ])
    expect(phases).toEqual(["finalizing"])
  })

  it("never re-saves the cache for a cache hit", async () => {
    const { dependencies, calls } = createFakeDependencies({
      getQaAnswer: async () => createQaAnswerEntity(),
    })
    const controller = createAskController(dependencies)

    await controller.runExecutionTask(createExecutionTaskRequest())

    expect(calls.saveQaAnswer).toHaveLength(0)
    expect(calls.runAskVideo).toHaveLength(0)
  })
})

describe("AskController runExecutionTask persistence versus terminal UI publication", () => {
  /**
   * Mirrors the root at Ask completion: the displayed identity is read live
   * from the workspace display selection plus the current transcript
   * fingerprint. Persistence has already happened inside runExecutionTask, so
   * the publication verdict can only affect React state.
   */
  function readDisplayedAskIdentity(
    workspace: WorkspaceController,
    transcriptFingerprint: string | null,
  ) {
    const selection = workspace.getDisplaySelection()
    return {
      contentKey: selection.analysis?.contentKey ?? null,
      analysisRunId: selection.analysis?.analysisRunId ?? "legacy",
      threadId: selection.qaThreadId,
      transcriptFingerprint,
    }
  }

  function requestedIdentity(
    taskSnapshot: Omit<AskTaskSnapshot, "taskId" | "startedAt">,
  ) {
    return {
      contentKey: taskSnapshot.contentKey,
      analysisRunId: taskSnapshot.analysisRunId,
      threadId: taskSnapshot.threadId,
      transcriptFingerprint: taskSnapshot.transcriptFingerprint,
    }
  }

  function displayOtherVideo(workspace: WorkspaceController): void {
    workspace.syncDisplaySelection({
      analysis: { contentKey: "youtube:video-b", analysisRunId: "run-b" },
      qaThreadId: "thread-b",
    })
  }

  it("persists to the original thread and skips UI publication when another video is displayed", async () => {
    const { dependencies, calls } = createFakeDependencies()
    const controller = createAskController(dependencies)
    const workspace = new WorkspaceController()
    const request = createExecutionTaskRequest()

    // The user switched to another video while the task was still running.
    displayOtherVideo(workspace)

    const { answer, assistantMessage } = await controller.runExecutionTask(request)

    const published: string[] = []
    const result = workspace.publishAskResult({
      requested: requestedIdentity(request.taskSnapshot),
      current: readDisplayedAskIdentity(workspace, "fp-b"),
      effects: {
        publishAssistantMessage: () => published.push("publishAssistantMessage"),
        publishAnswer: () => published.push("publishAnswer"),
      },
    })

    // UI publication is rejected, yet both persistence writes already happened
    // against the frozen task identity.
    expect(result).toEqual({ kind: "stale" })
    expect(published).toEqual([])
    expect(calls.order).toEqual([
      "getQaAnswer",
      "runAskVideo",
      "saveQaAnswer",
      "appendAssistantMessage",
    ])
    expect(calls.saveQaAnswer).toHaveLength(1)
    expect(calls.saveQaAnswer[0]!.contentKey).toBe(CONTENT_KEY)
    expect(calls.saveQaAnswer[0]!.analysisRunId).toBe(ANALYSIS_RUN_ID)
    expect(calls.saveQaAnswer[0]!.transcriptFingerprint).toBe(FINGERPRINT)
    expect(calls.appendAssistantMessage).toHaveLength(1)
    expect(calls.appendAssistantMessage[0]!.threadId).toBe("thread-a")
    expect(assistantMessage.threadId).toBe("thread-a")
    expect(answer).toEqual(createAskAnswer())
  })

  it("publishes an A -> B -> A completion once the displayed identity matches again", async () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)
    const workspace = new WorkspaceController()
    const request = createExecutionTaskRequest()

    displayOtherVideo(workspace)
    await controller.runExecutionTask(request)

    // The user returned to the original analysis and thread before the result
    // was published.
    workspace.syncDisplaySelection({
      analysis: { contentKey: CONTENT_KEY, analysisRunId: ANALYSIS_RUN_ID },
      qaThreadId: "thread-a",
    })

    const published: string[] = []
    const result = workspace.publishAskResult({
      requested: requestedIdentity(request.taskSnapshot),
      current: readDisplayedAskIdentity(workspace, FINGERPRINT),
      effects: {
        publishAssistantMessage: () => published.push("publishAssistantMessage"),
        publishAnswer: () => published.push("publishAnswer"),
      },
    })

    expect(result).toEqual({ kind: "published" })
    expect(published).toEqual(["publishAssistantMessage", "publishAnswer"])
  })
})

describe("AskController runExecutionTask task guards", () => {
  it("checks the task exactly three times on the success path", async () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)
    let guardCalls = 0

    await controller.runExecutionTask(createExecutionTaskRequest({
      isTaskCurrent: () => { guardCalls += 1; return true },
    }))

    expect(guardCalls).toBe(3)
  })

  it("throws the exact inactive error before touching the cache", async () => {
    const { dependencies, calls } = createFakeDependencies()
    const controller = createAskController(dependencies)

    await expect(controller.runExecutionTask(createExecutionTaskRequest({
      isTaskCurrent: () => false,
    }))).rejects.toThrow("Ask Video task is no longer active.")

    expect(calls.getQaAnswer).toHaveLength(0)
    expect(calls.runAskVideo).toHaveLength(0)
    expect(calls.saveQaAnswer).toHaveLength(0)
    expect(calls.appendAssistantMessage).toHaveLength(0)
  })

  it("checks task currentness before the abort flag", async () => {
    const controllerInstance = new AbortController()
    controllerInstance.abort()
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)

    await expect(controller.runExecutionTask(createExecutionTaskRequest({
      signal: controllerInstance.signal,
      isTaskCurrent: () => false,
    }))).rejects.toThrow("Ask Video task is no longer active.")
  })

  it("throws the exact AbortError when the signal is already aborted", async () => {
    const abortController = new AbortController()
    abortController.abort()
    const { dependencies, calls } = createFakeDependencies()
    const controller = createAskController(dependencies)

    const error = await controller.runExecutionTask(createExecutionTaskRequest({
      signal: abortController.signal,
    })).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe("AbortError")
    expect((error as DOMException).message).toBe("The Ask Video request was cancelled.")
    expect(calls.getQaAnswer).toHaveLength(0)
    expect(calls.runAskVideo).toHaveLength(0)
    expect(calls.saveQaAnswer).toHaveLength(0)
    expect(calls.appendAssistantMessage).toHaveLength(0)
  })

  it("stops after the cache read when the task becomes stale", async () => {
    let guardCalls = 0
    const { dependencies, calls } = createFakeDependencies()
    const controller = createAskController(dependencies)
    const { phases, setPhase } = createPhaseRecorder()

    await expect(controller.runExecutionTask(createExecutionTaskRequest({
      setPhase,
      isTaskCurrent: () => { guardCalls += 1; return guardCalls === 1 },
    }))).rejects.toThrow("Ask Video task is no longer active.")

    expect(calls.getQaAnswer).toHaveLength(1)
    expect(calls.runAskVideo).toHaveLength(0)
    expect(phases).toEqual([])
    expect(calls.saveQaAnswer).toHaveLength(0)
    expect(calls.appendAssistantMessage).toHaveLength(0)
  })

  it("stops after the model resolves when the signal aborts during the call", async () => {
    const abortController = new AbortController()
    const { dependencies, calls } = createFakeDependencies({
      runAskVideo: async () => {
        abortController.abort()
        return { answer: createAskAnswer() }
      },
    })
    const controller = createAskController(dependencies)
    const { phases, setPhase } = createPhaseRecorder()

    const error = await controller.runExecutionTask(createExecutionTaskRequest({
      signal: abortController.signal,
      setPhase,
    })).catch((caught: unknown) => caught)

    expect((error as DOMException).name).toBe("AbortError")
    expect(phases).toEqual([])
    expect(calls.saveQaAnswer).toHaveLength(0)
    expect(calls.appendAssistantMessage).toHaveLength(0)
  })
})

describe("AskController runExecutionTask phases", () => {
  it("reports repairing before finalizing when the model repairs", async () => {
    const { dependencies } = createFakeDependencies({
      runAskVideo: async (input) => {
        input.onRepairStart()
        return { answer: createAskAnswer() }
      },
    })
    const controller = createAskController(dependencies)
    const { phases, setPhase } = createPhaseRecorder()

    await controller.runExecutionTask(createExecutionTaskRequest({ setPhase }))

    expect(phases).toEqual(["repairing", "finalizing"])
  })

  it("never reports repairing for a cache hit", async () => {
    const { dependencies } = createFakeDependencies({
      getQaAnswer: async () => createQaAnswerEntity(),
    })
    const controller = createAskController(dependencies)
    const { phases, setPhase } = createPhaseRecorder()

    await controller.runExecutionTask(createExecutionTaskRequest({ setPhase }))

    expect(phases).toEqual(["finalizing"])
  })

  it("stops guarding the task once finalizing starts", async () => {
    const { dependencies, calls } = createFakeDependencies()
    const controller = createAskController(dependencies)
    let guardCalls = 0
    const { phases, setPhase } = createPhaseRecorder()

    await controller.runExecutionTask(createExecutionTaskRequest({
      setPhase,
      isTaskCurrent: () => { guardCalls += 1; return true },
    }))

    expect(phases).toEqual(["finalizing"])
    expect(guardCalls).toBe(3)
    expect(calls.saveQaAnswer).toHaveLength(1)
    expect(calls.appendAssistantMessage).toHaveLength(1)
  })
})

describe("AskController runExecutionTask model input", () => {
  it("passes the frozen task inputs to the model unchanged", async () => {
    const request = createExecutionTaskRequest()
    const { dependencies, calls } = createFakeDependencies()
    const controller = createAskController(dependencies)

    await controller.runExecutionTask(request)

    const input = calls.runAskVideo[0]!
    expect(input.provider).toEqual(request.providerRequest)
    expect(input.provider).not.toBe(request.providerRequest)
    expect(input.question).toBe(request.taskSnapshot.question)
    expect(input.transcript.videoId).toBe(request.taskSnapshot.videoId)
    expect(input.transcript.title).toBe(request.taskSnapshot.videoTitle)
    expect(input.transcript.cues).toBe(request.taskTranscriptCues)
    expect(input.analysis).toBe(request.taskAnalysis)
    expect(input.conversationHistory).toBe(request.taskConversationHistory)
    expect(input.signal).toBe(request.signal)
  })
})

describe("AskController runExecutionTask persistence payloads", () => {
  it("writes the exact QA cache row with a single timestamp", async () => {
    const { dependencies, calls } = createFakeDependencies({ now: () => FIXED_NOW })
    const controller = createAskController(dependencies)
    const request = createExecutionTaskRequest()

    await controller.runExecutionTask(request)

    expect(calls.saveQaAnswer).toEqual([{
      cacheKey: request.qaCacheKey,
      contentKey: request.taskSnapshot.contentKey,
      transcriptFingerprint: request.taskSnapshot.transcriptFingerprint,
      analysisRunId: request.taskSnapshot.analysisRunId,
      providerProfileId: request.taskSnapshot.providerProfileId,
      providerBaseUrl: request.taskSnapshot.providerBaseUrl,
      providerModel: request.taskSnapshot.providerModel,
      question: request.taskSnapshot.question,
      schemaVersion: VIDEO_QA_SCHEMA_VERSION,
      promptVersion: VIDEO_QA_PROMPT_VERSION,
      answer: createAskAnswer(),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    }])
    const saved = calls.saveQaAnswer[0]!
    expect(saved.createdAt).toBe(saved.updatedAt)
  })

  it("persists the requested analysis run rather than the cache identity run", async () => {
    const { dependencies, calls } = createFakeDependencies({ now: () => FIXED_NOW })
    const controller = createAskController(dependencies)

    await controller.runExecutionTask(createExecutionTaskRequest({
      qaCacheKey: "cache-key-from-persisted-run",
      taskSnapshot: createTaskSnapshot({ analysisRunId: "requested-run" }),
    }))

    expect(calls.getQaAnswer).toEqual(["cache-key-from-persisted-run"])
    expect(calls.saveQaAnswer[0]!.cacheKey).toBe("cache-key-from-persisted-run")
    expect(calls.saveQaAnswer[0]!.analysisRunId).toBe("requested-run")
  })

  it("writes the exact assistant message input", async () => {
    const { dependencies, calls } = createFakeDependencies()
    const controller = createAskController(dependencies)

    await controller.runExecutionTask(createExecutionTaskRequest())

    const assistant = calls.appendAssistantMessage[0]!
    expect(assistant).toEqual({
      threadId: "thread-a",
      role: "assistant",
      content: "The video starts with an introduction.",
      citations: [{ startSec: 0, endSec: 5, text: "First cue." }],
      suggestedJumps: [{ title: "Start", startSec: 0, endSec: 5 }],
      followUps: ["What comes next?"],
    })
    expect(Object.keys(assistant).sort()).toEqual([
      "citations",
      "content",
      "followUps",
      "role",
      "suggestedJumps",
      "threadId",
    ])
  })

  it("returns the assistant entity the dependency produced", async () => {
    const persisted = createMessage({ id: "persisted-assistant", role: "assistant" })
    const { dependencies } = createFakeDependencies({
      appendAssistantMessage: async () => persisted,
    })
    const controller = createAskController(dependencies)

    const result = await controller.runExecutionTask(createExecutionTaskRequest())

    expect(result.assistantMessage).toBe(persisted)
  })
})

describe("AskController runExecutionTask failure propagation", () => {
  it("propagates a cache save failure without appending the assistant message", async () => {
    const saveError = new Error("quota exceeded")
    const { dependencies, calls } = createFakeDependencies({
      saveQaAnswer: async () => { throw saveError },
    })
    const controller = createAskController(dependencies)

    const error = await controller.runExecutionTask(createExecutionTaskRequest())
      .catch((caught: unknown) => caught)

    expect(error).toBe(saveError)
    expect(calls.appendAssistantMessage).toHaveLength(0)
  })

  it("propagates an assistant append failure unchanged", async () => {
    const appendError = new Error("append failed")
    const { dependencies } = createFakeDependencies({
      appendAssistantMessage: async () => { throw appendError },
    })
    const controller = createAskController(dependencies)

    const error = await controller.runExecutionTask(createExecutionTaskRequest())
      .catch((caught: unknown) => caught)

    expect(error).toBe(appendError)
  })

  it("propagates a model failure without finalizing or persisting anything", async () => {
    const modelError = new Error("provider down")
    const { dependencies, calls } = createFakeDependencies({
      runAskVideo: async () => { throw modelError },
    })
    const controller = createAskController(dependencies)
    const { phases, setPhase } = createPhaseRecorder()

    const error = await controller.runExecutionTask(createExecutionTaskRequest({ setPhase }))
      .catch((caught: unknown) => caught)

    expect(error).toBe(modelError)
    expect(phases).toEqual([])
    expect(calls.saveQaAnswer).toHaveLength(0)
    expect(calls.appendAssistantMessage).toHaveLength(0)
  })
})

function createTranscriptIdentityRequest(
  overrides: Partial<AskExecutionTranscriptIdentityRequest> = {},
): AskExecutionTranscriptIdentityRequest {
  return {
    analysisFingerprint: FINGERPRINT,
    currentFingerprint: FINGERPRINT,
    transcriptCues: createTranscriptCues(),
    contentMatches: true,
    ...overrides,
  }
}

function createOpenThreadTranscriptRequest(
  overrides: Partial<AskOpenThreadTranscriptRequest> = {},
): AskOpenThreadTranscriptRequest {
  return {
    currentFingerprint: FINGERPRINT,
    transcriptCues: createTranscriptCues(),
    ...overrides,
  }
}

describe("AskController prepareExecutionTranscriptIdentity", () => {
  it("returns ok with the resolved fingerprint on an exact match", async () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)
    const transcriptCues = createTranscriptCues()
    const cueFingerprint = await resolveAskTranscriptFingerprint({
      currentFingerprint: null,
      transcriptCues,
    })
    const request = createTranscriptIdentityRequest({
      analysisFingerprint: cueFingerprint,
      currentFingerprint: cueFingerprint,
      transcriptCues,
    })

    const result = await controller.prepareExecutionTranscriptIdentity(request)

    expect(result).toEqual({ ok: true, transcriptFingerprint: cueFingerprint })
  })

  it("reports transcript-unavailable when there are no cues", async () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)

    const result = await controller.prepareExecutionTranscriptIdentity(
      createTranscriptIdentityRequest({ transcriptCues: [] }),
    )

    expect(result).toEqual({ ok: false, reason: "transcript-unavailable" })
  })

  it("reports transcript-unavailable when the transcript content does not match", async () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)

    const result = await controller.prepareExecutionTranscriptIdentity(
      createTranscriptIdentityRequest({ contentMatches: false }),
    )

    expect(result).toEqual({ ok: false, reason: "transcript-unavailable" })
  })

  it("reports transcript-mismatch when the analysis fingerprint disagrees", async () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)
    const request = createTranscriptIdentityRequest()

    const resolved = await resolveAskTranscriptFingerprint({
      currentFingerprint: request.currentFingerprint,
      transcriptCues: request.transcriptCues,
    })
    const result = await controller.prepareExecutionTranscriptIdentity(
      createTranscriptIdentityRequest({ analysisFingerprint: `${resolved}-other` }),
    )

    expect(result).toEqual({ ok: false, reason: "transcript-mismatch" })
  })

  it("computes the cue fingerprint when no fingerprint is persisted yet", async () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)
    const request = createTranscriptIdentityRequest({
      analysisFingerprint: null,
      currentFingerprint: null,
    })

    const result = await controller.prepareExecutionTranscriptIdentity(request)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")
    expect(result.transcriptFingerprint).toBe(await resolveAskTranscriptFingerprint({
      currentFingerprint: null,
      transcriptCues: request.transcriptCues,
    }))
  })

  it("matches the helper semantics for representative inputs", async () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)
    const cues = createTranscriptCues()
    const cueFingerprint = await resolveAskTranscriptFingerprint({
      currentFingerprint: null,
      transcriptCues: cues,
    })
    const requests: AskExecutionTranscriptIdentityRequest[] = [
      createTranscriptIdentityRequest(),
      createTranscriptIdentityRequest({ transcriptCues: [] }),
      createTranscriptIdentityRequest({ contentMatches: false }),
      createTranscriptIdentityRequest({ analysisFingerprint: "different-analysis" }),
      createTranscriptIdentityRequest({ analysisFingerprint: null, currentFingerprint: null }),
      createTranscriptIdentityRequest({ currentFingerprint: "stale", analysisFingerprint: cueFingerprint }),
    ]

    for (const request of requests) {
      expect(await controller.prepareExecutionTranscriptIdentity(request))
        .toEqual(await resolveAskTranscriptRequestIdentity(request))
    }
  })

  it("touches no repository, provider, or cache dependency", async () => {
    const { dependencies, calls } = createFakeDependencies()
    const controller = createAskController(dependencies)

    await controller.prepareExecutionTranscriptIdentity(createTranscriptIdentityRequest())

    expect(calls.listQaMessages).toHaveLength(0)
    expect(calls.getQaThread).toHaveLength(0)
    expect(calls.appendQaMessage).toHaveLength(0)
    expect(calls.getQaAnswer).toHaveLength(0)
    expect(calls.runAskVideo).toHaveLength(0)
    expect(calls.saveQaAnswer).toHaveLength(0)
    expect(calls.appendAssistantMessage).toHaveLength(0)
  })
})

describe("AskController resolveOpenThreadTranscriptFingerprint", () => {
  it("returns null when there are no cues", async () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)

    const result = await controller.resolveOpenThreadTranscriptFingerprint(
      createOpenThreadTranscriptRequest({ transcriptCues: [] }),
    )

    expect(result).toBeNull()
  })

  it("keeps the current fingerprint when it already agrees with the cues", async () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)
    const cues = createTranscriptCues()
    const currentFingerprint = await resolveAskTranscriptFingerprint({
      currentFingerprint: null,
      transcriptCues: cues,
    })

    const result = await controller.resolveOpenThreadTranscriptFingerprint({
      currentFingerprint,
      transcriptCues: cues,
    })

    expect(result).toBe(currentFingerprint)
  })

  it("lets the computed cue fingerprint win over a stale persisted one", async () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)
    const cues = createTranscriptCues()

    const result = await controller.resolveOpenThreadTranscriptFingerprint({
      currentFingerprint: "stale-fingerprint",
      transcriptCues: cues,
    })

    expect(result).not.toBe("stale-fingerprint")
    expect(result).toBe(await resolveAskTranscriptFingerprint({
      currentFingerprint: "stale-fingerprint",
      transcriptCues: cues,
    }))
  })

  it("matches the helper semantics for representative inputs", async () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)
    const cues = createTranscriptCues()
    const requests: AskOpenThreadTranscriptRequest[] = [
      createOpenThreadTranscriptRequest(),
      createOpenThreadTranscriptRequest({ transcriptCues: [] }),
      createOpenThreadTranscriptRequest({ currentFingerprint: null }),
      createOpenThreadTranscriptRequest({ currentFingerprint: "stale" }),
    ]

    for (const request of requests) {
      expect(await controller.resolveOpenThreadTranscriptFingerprint(request))
        .toEqual(await resolveAskTranscriptFingerprint(request))
    }
  })

  it("touches no repository or provider dependency", async () => {
    const { dependencies, calls } = createFakeDependencies()
    const controller = createAskController(dependencies)

    await controller.resolveOpenThreadTranscriptFingerprint(createOpenThreadTranscriptRequest())

    expect(calls.getQaThread).toHaveLength(0)
    expect(calls.listQaMessages).toHaveLength(0)
    expect(calls.runAskVideo).toHaveLength(0)
    expect(calls.getQaAnswer).toHaveLength(0)
  })
})

describe("AskController execution generation", () => {
  it("returns a stable token from capture without mutating the counter", () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)

    const first = controller.captureExecutionGeneration()
    const second = controller.captureExecutionGeneration()

    expect(second).toBe(first)
    expect(controller.isExecutionGenerationCurrent(first)).toBe(true)
  })

  it("advances the execution generation exactly once per begin", () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)

    const before = controller.captureExecutionGeneration()
    const begun = controller.beginExecutionGeneration()

    expect(begun).toBe(before + 1)
    expect(controller.captureExecutionGeneration()).toBe(begun)
    expect(controller.isExecutionGenerationCurrent(begun)).toBe(true)
    expect(controller.isExecutionGenerationCurrent(before)).toBe(false)
  })

  it("stales the current execution token when invalidated", () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)

    const captured = controller.captureExecutionGeneration()
    const invalidated = controller.invalidateExecutionGeneration()

    expect(invalidated).toBe(captured + 1)
    expect(controller.isExecutionGenerationCurrent(captured)).toBe(false)
    expect(controller.isExecutionGenerationCurrent(invalidated)).toBe(true)
  })

  it("keeps repeated execution invalidation monotonic and currentness-safe", () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)

    const tokens = [controller.captureExecutionGeneration()]
    tokens.push(controller.invalidateExecutionGeneration())
    tokens.push(controller.invalidateExecutionGeneration())
    tokens.push(controller.invalidateExecutionGeneration())

    for (let index = 1; index < tokens.length; index += 1) {
      expect(tokens[index]).toBe(tokens[index - 1] + 1)
    }
    for (let index = 0; index < tokens.length - 1; index += 1) {
      expect(controller.isExecutionGenerationCurrent(tokens[index])).toBe(false)
    }
    expect(controller.isExecutionGenerationCurrent(tokens[tokens.length - 1])).toBe(true)
  })
})

describe("AskController thread-load generation", () => {
  it("returns a current token and stales the previous one on the next load", () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)

    const first = controller.beginThreadLoadGeneration()
    expect(controller.isThreadLoadGenerationCurrent(first)).toBe(true)

    const second = controller.beginThreadLoadGeneration()

    expect(second).toBe(first + 1)
    expect(controller.isThreadLoadGenerationCurrent(first)).toBe(false)
    expect(controller.isThreadLoadGenerationCurrent(second)).toBe(true)
  })

  it("stales the current thread-load token when invalidated", () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)

    const generation = controller.beginThreadLoadGeneration()
    const invalidated = controller.invalidateThreadLoadGeneration()

    expect(invalidated).toBe(generation + 1)
    expect(controller.isThreadLoadGenerationCurrent(generation)).toBe(false)
    expect(controller.isThreadLoadGenerationCurrent(invalidated)).toBe(true)
  })

  it("keeps repeated thread-load invalidation monotonic", () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)

    const start = controller.beginThreadLoadGeneration()
    const second = controller.invalidateThreadLoadGeneration()
    const third = controller.invalidateThreadLoadGeneration()

    expect(second).toBe(start + 1)
    expect(third).toBe(second + 1)
    expect(controller.isThreadLoadGenerationCurrent(start)).toBe(false)
    expect(controller.isThreadLoadGenerationCurrent(second)).toBe(false)
    expect(controller.isThreadLoadGenerationCurrent(third)).toBe(true)
  })
})

describe("AskController generation independence", () => {
  it("keeps a thread-load token current when the execution generation is invalidated", () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)

    const threadLoad = controller.beginThreadLoadGeneration()
    controller.invalidateExecutionGeneration()

    expect(controller.isThreadLoadGenerationCurrent(threadLoad)).toBe(true)
  })

  it("keeps an execution token current when the thread-load generation is invalidated", () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)

    const execution = controller.beginExecutionGeneration()
    controller.invalidateThreadLoadGeneration()

    expect(controller.isExecutionGenerationCurrent(execution)).toBe(true)
  })

  it("keeps a thread-load token current when an execution begins", () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)

    const threadLoad = controller.beginThreadLoadGeneration()
    controller.beginExecutionGeneration()

    expect(controller.isThreadLoadGenerationCurrent(threadLoad)).toBe(true)
  })

  it("keeps an execution token current when a thread load begins", () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)

    const execution = controller.beginExecutionGeneration()
    controller.beginThreadLoadGeneration()

    expect(controller.isExecutionGenerationCurrent(execution)).toBe(true)
  })

  it("keeps both counters independent across interleaved commands", () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)

    const execution = controller.beginExecutionGeneration()
    const threadLoad = controller.beginThreadLoadGeneration()
    controller.invalidateExecutionGeneration()
    controller.invalidateThreadLoadGeneration()

    expect(controller.isExecutionGenerationCurrent(execution)).toBe(false)
    expect(controller.isThreadLoadGenerationCurrent(threadLoad)).toBe(false)
    expect(controller.captureExecutionGeneration()).toBe(execution + 1)
  })
})

describe("AskController generation lifetime and isolation", () => {
  it("starts both counters at zero for a fresh controller instance", () => {
    const { dependencies } = createFakeDependencies()
    const controller = createAskController(dependencies)

    expect(controller.captureExecutionGeneration()).toBe(0)
    expect(controller.isThreadLoadGenerationCurrent(0)).toBe(true)
    expect(controller.isExecutionGenerationCurrent(1)).toBe(false)
  })

  it("gives each controller instance its own counters", () => {
    const first = createAskController(createFakeDependencies().dependencies)
    const second = createAskController(createFakeDependencies().dependencies)

    first.beginExecutionGeneration()
    first.beginThreadLoadGeneration()

    expect(second.captureExecutionGeneration()).toBe(0)
    expect(second.isThreadLoadGenerationCurrent(0)).toBe(true)
  })

  it("touches no repository, provider, cache, or model dependency", () => {
    const { dependencies, calls } = createFakeDependencies()
    const controller = createAskController(dependencies)

    controller.captureExecutionGeneration()
    controller.beginExecutionGeneration()
    controller.invalidateExecutionGeneration()
    controller.isExecutionGenerationCurrent(0)
    controller.beginThreadLoadGeneration()
    controller.invalidateThreadLoadGeneration()
    controller.isThreadLoadGenerationCurrent(0)

    expect(calls.listQaThreadsForVideo).toEqual([])
    expect(calls.getQaThread).toEqual([])
    expect(calls.listQaMessages).toEqual([])
    expect(calls.deleteQaThread).toEqual([])
    expect(calls.createQaThread).toEqual([])
    expect(calls.resolveProvider).toEqual([])
    expect(calls.appendQaMessage).toEqual([])
    expect(calls.getQaAnswer).toEqual([])
    expect(calls.saveQaAnswer).toEqual([])
    expect(calls.runAskVideo).toEqual([])
    expect(calls.appendAssistantMessage).toEqual([])
    expect(calls.order).toEqual([])
  })
})
