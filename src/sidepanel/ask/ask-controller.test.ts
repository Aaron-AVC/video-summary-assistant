import { describe, expect, it } from "bun:test"

import type { QaMessageEntity, QaThreadEntity } from "@/lib/schemas/persistence"
import {
  createAskController,
  projectAskAnswer,
  type AskControllerDependencies,
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
}

function createFakeDependencies(overrides: Partial<AskControllerDependencies> = {}) {
  const calls: FakeCalls = {
    listQaThreadsForVideo: [],
    getQaThread: [],
    listQaMessages: [],
    deleteQaThread: [],
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
      return await (overrides.listQaMessages?.(threadId) ?? [])
    },
    deleteQaThread: async (threadId) => {
      calls.deleteQaThread.push(threadId)
      await overrides.deleteQaThread?.(threadId)
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
