import { describe, expect, it } from "bun:test"

import { createQaConversationRepository } from "@/features/analysis/lib/qa-conversation-repository"

class Table<T extends { id: string }> {
  rows: T[] = []
  async put(row: T) {
    this.rows = this.rows.filter((item) => item.id !== row.id)
    this.rows.push(row)
  }
  async get(id: string) { return this.rows.find((row) => row.id === id) }
  async toArray() { return [...this.rows] }
  async delete(id: string) { this.rows = this.rows.filter((row) => row.id !== id) }
  async bulkDelete(ids: string[]) { for (const id of ids) await this.delete(id) }
  async clear() { this.rows = [] }
}

function database() {
  return {
    qaThreads: new Table<any>(),
    qaMessages: new Table<any>(),
  }
}

const time = "2026-10-14T00:00:00.000Z"
const threadInput = {
  contentKey: "youtube:video",
  platform: "youtube" as const,
  videoId: "video",
  partId: null,
  title: "Why?",
  analysisRunId: "run-1",
  transcriptFingerprint: "fp-1",
  providerProfileId: "provider",
  providerBaseUrl: "https://api.example.com/v1",
  providerModel: "model",
}

describe("Ask Video conversation repository", () => {
  it("creates, appends, orders, and restores a conversation", async () => {
    const fake = database()
    const repo = createQaConversationRepository(fake as never, {
      now: () => new Date(time),
      runTransaction: async (_mode, _tables, callback) => callback()
    })
    const thread = await repo.createQaThread(threadInput)
    await repo.appendQaMessage({ threadId: thread.id, role: "user", content: "Why?" })
    await repo.appendQaMessage({
      threadId: thread.id,
      role: "assistant",
      content: "Because.",
      citations: [{ text: "Evidence", startSec: 1, endSec: 2 }],
      followUps: ["What next?"]
    })

    expect((await repo.listQaThreadsForVideo("youtube:video", "run-1")).map((item) => item.id)).toEqual([thread.id])
    expect((await repo.listQaMessages(thread.id)).map((item) => [item.sequence, item.role, item.content])).toEqual([
      [0, "user", "Why?"],
      [1, "assistant", "Because."]
    ])
  })

  it("isolates multiple threads and analysis runs, and cascades deletes", async () => {
    const fake = database()
    const repo = createQaConversationRepository(fake as never, {
      now: () => new Date(time),
      runTransaction: async (_mode, _tables, callback) => callback()
    })
    const first = await repo.createQaThread(threadInput)
    const second = await repo.createQaThread({ ...threadInput, id: "thread-2", title: "Second", analysisRunId: "run-2" })
    await repo.appendQaMessage({ threadId: first.id, role: "user", content: "First" })
    await repo.appendQaMessage({ threadId: second.id, role: "user", content: "Second" })
    expect(await repo.listQaThreadsForVideo("youtube:video", "run-1")).toHaveLength(1)
    expect(await repo.listQaThreadsForVideo("youtube:video", "run-2")).toHaveLength(1)

    await repo.deleteQaThread(first.id)
    expect(await repo.getQaThread(first.id)).toBeNull()
    expect(await repo.listQaMessages(first.id)).toHaveLength(0)
    expect(await repo.getQaThread(second.id)).not.toBeNull()
    expect(await repo.listQaMessages(second.id)).toHaveLength(1)
  })

  it("keeps a submitted user message when the provider produces no assistant message", async () => {
    const fake = database()
    const repo = createQaConversationRepository(fake as never, {
      now: () => new Date(time),
      runTransaction: async (_mode, _tables, callback) => callback()
    })
    const thread = await repo.createQaThread(threadInput)
    await repo.appendQaMessage({ threadId: thread.id, role: "user", content: "Retry me" })

    expect(await repo.listQaMessages(thread.id)).toEqual([
      expect.objectContaining({ role: "user", content: "Retry me", sequence: 0 })
    ])
  })

  it("persists cached assistant answers as ordered conversation messages", async () => {
    const fake = database()
    const repo = createQaConversationRepository(fake as never, {
      now: () => new Date(time),
      runTransaction: async (_mode, _tables, callback) => callback()
    })
    const thread = await repo.createQaThread(threadInput)
    await repo.appendQaMessage({ threadId: thread.id, role: "user", content: "Why?" })
    await repo.appendQaMessage({
      threadId: thread.id,
      role: "assistant",
      content: "Because.",
      citations: [{ text: "Evidence", startSec: 1, endSec: 2 }],
      suggestedJumps: [{ title: "Evidence", reason: "Relevant", startSec: 1, endSec: 2 }],
      followUps: ["What next?"]
    })

    const messages = await repo.listQaMessages(thread.id)
    expect(messages[1]).toEqual(expect.objectContaining({
      role: "assistant",
      content: "Because.",
      citations: [{ text: "Evidence", startSec: 1, endSec: 2 }],
      suggestedJumps: [{ title: "Evidence", reason: "Relevant", startSec: 1, endSec: 2 }],
      followUps: ["What next?"]
    }))
  })

  it("persists and restores suggested jumps without an optional reason", async () => {
    const fake = database()
    const repo = createQaConversationRepository(fake as never, {
      now: () => new Date(time),
      runTransaction: async (_mode, _tables, callback) => callback()
    })
    const thread = await repo.createQaThread(threadInput)
    const message = await repo.appendQaMessage({
      threadId: thread.id,
      role: "assistant",
      content: "Because.",
      suggestedJumps: [{ title: "Evidence", startSec: 1, endSec: 2 }],
    })

    expect(message.suggestedJumps).toEqual([{ title: "Evidence", startSec: 1, endSec: 2 }])
    expect(await repo.listQaMessages(thread.id)).toEqual([expect.objectContaining({
      suggestedJumps: [{ title: "Evidence", startSec: 1, endSec: 2 }],
    })])
  })
})
