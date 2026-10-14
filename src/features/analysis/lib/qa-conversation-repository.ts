import { db, withDatabaseTransaction } from "@/lib/db"
import { runWriteWithQuotaGuard } from "@/lib/db/errors"
import type { DatabaseSchema } from "@/lib/db/schema"
import {
  qaMessageSchema,
  qaThreadSchema,
  type QaMessageEntity,
  type QaThreadEntity
} from "@/lib/schemas/persistence"

export type CreateQaThreadInput = Omit<QaThreadEntity, "id" | "createdAt" | "updatedAt"> & {
  id?: string
  createdAt?: string
  updatedAt?: string
}

export type AppendQaMessageInput = Omit<QaMessageEntity, "id" | "sequence" | "createdAt"> & {
  id?: string
  sequence?: number
  createdAt?: string
}

export type QaConversationRepositoryOptions = {
  now?: () => Date
  runTransaction?: <T>(
    mode: "r" | "rw",
    tables: (keyof DatabaseSchema)[],
    callback: () => Promise<T>
  ) => Promise<T>
}

function sortNewest(left: QaThreadEntity, right: QaThreadEntity) {
  return right.updatedAt.localeCompare(left.updatedAt)
}

export function createQaConversationRepository(
  database = db,
  options: QaConversationRepositoryOptions = {}
) {
  const now = options.now ?? (() => new Date())
  const runTransaction = options.runTransaction ?? withDatabaseTransaction
  const threads = (database as typeof database & { qaThreads?: typeof database.qaThreads }).qaThreads
  const messages = (database as typeof database & { qaMessages?: typeof database.qaMessages }).qaMessages

  async function readThreads() {
    if (!threads) return [] as QaThreadEntity[]
    const rows = await threads.toArray()
    return rows.flatMap((row) => {
      try { return [qaThreadSchema.parse(row)] } catch { return [] }
    })
  }

  async function readMessages() {
    if (!messages) return [] as QaMessageEntity[]
    const rows = await messages.toArray()
    return rows.flatMap((row) => {
      try { return [qaMessageSchema.parse(row)] } catch { return [] }
    })
  }

  return {
    async createQaThread(input: CreateQaThreadInput) {
      const createdAt = input.createdAt ?? now().toISOString()
      const parsed = qaThreadSchema.parse({
        ...input,
        id: input.id ?? crypto.randomUUID(),
        createdAt,
        updatedAt: input.updatedAt ?? createdAt,
      })
      if (!threads) return parsed
      return runWriteWithQuotaGuard(async () => {
        await threads.put(parsed)
        return parsed
      })
    },

    async listQaThreadsForVideo(contentKey: string, analysisRunId?: string) {
      const rows = (await readThreads()).filter((row) => (
        row.contentKey === contentKey && (!analysisRunId || row.analysisRunId === analysisRunId)
      ))
      return rows.sort(sortNewest)
    },

    async getQaThread(threadId: string) {
      if (!threads) return null
      const row = await threads.get(threadId)
      if (!row) return null
      try { return qaThreadSchema.parse(row) } catch { return null }
    },

    async getLatestQaThreadForVideo(contentKey: string, analysisRunId: string) {
      return (await this.listQaThreadsForVideo(contentKey, analysisRunId))[0] ?? null
    },

    async listQaMessages(threadId: string) {
      return (await readMessages())
        .filter((row) => row.threadId === threadId)
        .sort((left, right) => left.sequence - right.sequence || left.createdAt.localeCompare(right.createdAt))
    },

    async appendQaMessage(input: AppendQaMessageInput) {
      if (!messages || !threads) {
        const fallback = qaMessageSchema.parse({
          ...input,
          id: input.id ?? crypto.randomUUID(),
          sequence: input.sequence ?? 0,
          createdAt: input.createdAt ?? now().toISOString(),
        })
        return fallback
      }
      return runWriteWithQuotaGuard(async () => runTransaction("rw", ["qaThreads", "qaMessages"], async () => {
        const thread = await threads.get(input.threadId)
        if (!thread) throw new Error("Cannot append a message to a missing Ask Video thread.")
        const existing = await this.listQaMessages(input.threadId)
        const sequence = input.sequence ?? (existing.at(-1)?.sequence ?? -1) + 1
        const message = qaMessageSchema.parse({
          ...input,
          id: input.id ?? crypto.randomUUID(),
          sequence,
          createdAt: input.createdAt ?? now().toISOString(),
        })
        await messages.put(message)
        const updatedAt = now().toISOString()
        await threads.put({ ...qaThreadSchema.parse(thread), updatedAt })
        return message
      }))
    },

    async deleteQaThread(threadId: string) {
      if (!threads) return
      await runWriteWithQuotaGuard(async () => runTransaction("rw", ["qaThreads", "qaMessages"], async () => {
        const allMessages = messages ? await readMessages() : []
        const messageIds = allMessages.filter((message) => message.threadId === threadId).map((message) => message.id)
        if (messages && messageIds.length > 0) await messages.bulkDelete(messageIds)
        await threads.delete(threadId)
      }))
    },

    async clearAll() {
      await Promise.all([threads?.clear(), messages?.clear()])
    }
  }
}

export const qaConversationRepository = createQaConversationRepository()
