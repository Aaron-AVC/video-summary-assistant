import { describe, expect, it } from "bun:test"

import {
  MAX_QA_CONTEXT_MESSAGES,
  boundQaConversationContext,
} from "@/features/analysis/lib/qa-conversation-context"
import type { ResolvedProvider } from "@/features/settings/lib/settings-storage"
import type { QaMessageEntity, QaThreadEntity } from "@/lib/schemas/persistence"
import {
  ASK_THREAD_PROVIDER_UNAVAILABLE_MESSAGE,
  createAskController,
  projectAskAnswer,
  type AskControllerDependencies,
  type AskExecutionThreadRequest,
  type AskExecutionTurnRequest,
  type AskUserMessageInput,
  type CreateAskThreadInput,
} from "@/sidepanel/ask/ask-controller"

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
