import { describe, expect, it } from "bun:test"

import {
  DestructiveOperationBlockedError,
  admitDestructiveTask,
  getDestructiveTaskConflicts,
  performDestructiveOperation,
  queryActiveDestructiveTasks,
  subscribeToDestructiveOperations,
  type DestructiveCoordinatorChannel,
  type DestructiveCoordinatorSerialization,
  type DestructiveTaskSnapshot,
} from "@/features/history/lib/destructive-operation-coordinator"

const analysis: DestructiveTaskSnapshot = {
  kind: "analysis",
  contentKey: "youtube:active",
  analysisRunId: "run-active",
  phase: "analyzing",
}
const loadingAnalysis: DestructiveTaskSnapshot = {
  ...analysis,
  phase: "loading-transcript",
}
const ask: DestructiveTaskSnapshot = {
  kind: "ask",
  contentKey: "youtube:active",
  analysisRunId: "run-active",
  threadId: "thread-active",
  phase: "answering",
}

describe("destructive-operation conflict rules", () => {
  it("blocks matching run/content Analysis and Ask, but allows unrelated content", () => {
    expect(getDestructiveTaskConflicts("delete-analysis-run", {
      analysisRunId: "run-active",
      contentKey: "youtube:active",
    }, [analysis])).toEqual([analysis])
    expect(getDestructiveTaskConflicts("delete-analysis-run", {
      analysisRunId: "run-other",
      contentKey: "youtube:active",
    }, [ask])).toEqual([ask])
    expect(getDestructiveTaskConflicts("delete-video-data", {
      contentKey: "youtube:other",
    }, [analysis])).toEqual([])
  })

  it("does not invoke delete for matching active Analysis or Ask", async () => {
    let deletes = 0
    const blockedAnalysis = await performDestructiveOperation(
      "delete-analysis-run",
      { analysisRunId: "run-active", contentKey: "youtube:active" },
      async () => { deletes += 1 },
      { checkConflicts: async () => [analysis], broadcastMutation: () => {} },
    ).then(() => false, () => true)
    const blockedAsk = await performDestructiveOperation(
      "delete-analysis-run",
      { analysisRunId: "run-other", contentKey: "youtube:active" },
      async () => { deletes += 1 },
      { checkConflicts: async () => [ask], broadcastMutation: () => {} },
    ).then(() => false, () => true)
    expect(blockedAnalysis).toBe(true)
    expect(blockedAsk).toBe(true)
    expect(deletes).toBe(0)

    await performDestructiveOperation(
      "delete-analysis-run",
      { analysisRunId: "run-other", contentKey: "youtube:other" },
      async () => { deletes += 1 },
      { checkConflicts: async () => [analysis], broadcastMutation: () => {} },
    )
    expect(deletes).toBe(1)
  })

  it("blocks clear conversations only for Ask tasks", () => {
    expect(getDestructiveTaskConflicts("clear-conversations", {}, [ask])).toEqual([ask])
    expect(getDestructiveTaskConflicts("clear-conversations", {}, [analysis])).toEqual([])
  })

  it("blocks history and all clears for any task, but not diagnostics", () => {
    expect(getDestructiveTaskConflicts("clear-analysis-history", {}, [analysis])).toEqual([analysis])
    expect(getDestructiveTaskConflicts("clear-analysis-history", {}, [ask])).toEqual([ask])
    expect(getDestructiveTaskConflicts("clear-all", {}, [analysis])).toEqual([analysis])
    expect(getDestructiveTaskConflicts("clear-all", {}, [ask])).toEqual([ask])
    expect(getDestructiveTaskConflicts("clear-diagnostics", {}, [analysis, ask])).toEqual([])
  })

  it("allows frozen transcript tasks but blocks transcript-loading analysis", () => {
    expect(getDestructiveTaskConflicts("clear-transcript-cache", {}, [analysis, ask])).toEqual([])
    expect(getDestructiveTaskConflicts("clear-transcript-cache", {}, [loadingAnalysis])).toEqual([loadingAnalysis])
  })
})

class FakeBroadcastBus {
  readonly channels: FakeBroadcastChannel[] = []

  createChannel(): DestructiveCoordinatorChannel {
    const channel = new FakeBroadcastChannel(this)
    this.channels.push(channel)
    return channel
  }

  post(sender: FakeBroadcastChannel, message: unknown) {
    for (const channel of this.channels) {
      if (!channel.closed && channel !== sender) channel.onmessage?.({ data: message })
    }
  }
}

class FakeBroadcastChannel implements DestructiveCoordinatorChannel {
  onmessage: DestructiveCoordinatorChannel["onmessage"] = null
  closed = false

  constructor(private readonly bus: FakeBroadcastBus) {}

  postMessage(message: unknown) {
    this.bus.post(this, message)
  }

  close() {
    this.closed = true
  }
}

describe("destructive-operation live coordination", () => {
  it("collects active snapshots from multiple live Side Panels", async () => {
    const bus = new FakeBroadcastBus()
    const cleanups = [analysis, ask].map((task, index) => subscribeToDestructiveOperations(
      () => [task],
      () => {},
      { createChannel: () => bus.createChannel(), createId: () => `panel-${index}` },
    ))

    const snapshots = await queryActiveDestructiveTasks("clear-all", {}, {
      createChannel: () => bus.createChannel(),
      createId: () => "query-1",
      responseWindowMs: 0,
    })

    expect(snapshots).toEqual([analysis, ask])
    cleanups.forEach((cleanup) => cleanup())
  })

  it("broadcasts a successful mutation but never mutates after a conflict", async () => {
    let mutationCount = 0
    let deleteCount = 0
    const checkConflicts = async () => [ask]

    await expect(performDestructiveOperation(
      "clear-conversations",
      {},
      async () => { deleteCount += 1 },
      { checkConflicts, broadcastMutation: () => { mutationCount += 1 } },
    )).rejects.toBeInstanceOf(DestructiveOperationBlockedError)
    expect(deleteCount).toBe(0)
    expect(mutationCount).toBe(0)

    await performDestructiveOperation(
      "clear-diagnostics",
      {},
      async () => { deleteCount += 1 },
      { checkConflicts, broadcastMutation: (mutation) => {
        expect(mutation).toEqual({ type: "clear-diagnostics" })
        mutationCount += 1
      } },
    )
    expect(deleteCount).toBe(1)
    expect(mutationCount).toBe(1)
  })
})

class FakeSerialization implements DestructiveCoordinatorSerialization {
  readonly activeTasks: DestructiveTaskSnapshot[] = []
  reservationActive = false
  private nextTaskId = 0

  async admitTask(task: DestructiveTaskSnapshot, starter: (taskId: string) => void | Promise<void>) {
    if (this.reservationActive) throw new DestructiveOperationBlockedError()
    const taskId = `task-${++this.nextTaskId}`
    this.activeTasks.push(task)
    try {
      await starter(taskId)
    } catch (error) {
      this.activeTasks.pop()
      throw error
    }
    let released = false
    return {
      taskId,
      release: () => {
        if (released) return
        released = true
        const index = this.activeTasks.indexOf(task)
        if (index >= 0) this.activeTasks.splice(index, 1)
      },
    }
  }

  async reserveDestructive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.reservationActive) throw new Error("reservation already active")
    this.reservationActive = true
    try {
      return await operation()
    } finally {
      this.reservationActive = false
    }
  }
}

const serializationAnalysis: DestructiveTaskSnapshot = {
  kind: "analysis",
  contentKey: "youtube:serial",
  analysisRunId: "run-serial",
  phase: "analyzing",
}
const serializationAsk: DestructiveTaskSnapshot = {
  kind: "ask",
  contentKey: "youtube:serial",
  analysisRunId: "run-serial",
  threadId: "thread-serial",
  phase: "answering",
}

describe("destructive/task admission serialization", () => {
  it("rejects Analysis and Ask admission after destructive reservation", async () => {
    const serialization = new FakeSerialization()
    let continueDelete!: () => void
    const deleteFinished = new Promise<void>((resolve) => { continueDelete = resolve })
    const destructive = performDestructiveOperation(
      "clear-all",
      {},
      () => deleteFinished,
      {
        serialization,
        checkConflicts: async () => [],
        broadcastMutation: () => {},
      },
    )
    await Promise.resolve()
    await expect(admitDestructiveTask(serializationAnalysis, () => {}, { serialization })).rejects.toBeInstanceOf(DestructiveOperationBlockedError)
    await expect(admitDestructiveTask(serializationAsk, () => {}, { serialization })).rejects.toBeInstanceOf(DestructiveOperationBlockedError)
    continueDelete()
    await destructive
  })

  it("rejects destructive operations for active Analysis and Ask", async () => {
    const serialization = new FakeSerialization()
    const analysisHandle = await admitDestructiveTask(serializationAnalysis, () => {}, { serialization })
    await expect(performDestructiveOperation("clear-all", {}, async () => {}, {
      serialization,
      checkConflicts: async () => serialization.activeTasks,
      broadcastMutation: () => {},
    })).rejects.toBeInstanceOf(DestructiveOperationBlockedError)
    analysisHandle.release()

    const askHandle = await admitDestructiveTask(serializationAsk, () => {}, { serialization })
    await expect(performDestructiveOperation("clear-conversations", {}, async () => {}, {
      serialization,
      checkConflicts: async () => serialization.activeTasks,
      broadcastMutation: () => {},
    })).rejects.toBeInstanceOf(DestructiveOperationBlockedError)
    askHandle.release()
  })

  it("serializes competing destructive and task requests so both cannot succeed", async () => {
    const serialization = new FakeSerialization()
    let releaseDelete!: () => void
    const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve })
    const destructive = performDestructiveOperation("clear-all", {}, () => deleteGate, {
      serialization,
      checkConflicts: async () => [],
      broadcastMutation: () => {},
    })
    await Promise.resolve()
    const competingTask = admitDestructiveTask(serializationAnalysis, () => {}, { serialization })
    await expect(competingTask).rejects.toBeInstanceOf(DestructiveOperationBlockedError)
    releaseDelete()
    await destructive
  })

  it("serializes a competing destructive and Ask request", async () => {
    const serialization = new FakeSerialization()
    let releaseDelete!: () => void
    const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve })
    const destructive = performDestructiveOperation("clear-all", {}, () => deleteGate, {
      serialization,
      checkConflicts: async () => [],
      broadcastMutation: () => {},
    })
    await Promise.resolve()
    await expect(admitDestructiveTask(serializationAsk, () => {}, { serialization })).rejects.toBeInstanceOf(DestructiveOperationBlockedError)
    releaseDelete()
    await destructive
  })

  it("releases a failed destructive reservation", async () => {
    const serialization = new FakeSerialization()
    await expect(performDestructiveOperation("clear-all", {}, async () => {
      throw new Error("delete failed")
    }, {
      serialization,
      checkConflicts: async () => [],
      broadcastMutation: () => {},
    })).rejects.toThrow("delete failed")
    const handle = await admitDestructiveTask(serializationAnalysis, () => {}, { serialization })
    handle.release()
  })

  it("does not retain a task after admission starter failure", async () => {
    const serialization = new FakeSerialization()
    await expect(admitDestructiveTask(serializationAnalysis, async () => {
      throw new Error("start failed")
    }, { serialization })).rejects.toThrow("start failed")
    expect(serialization.activeTasks).toEqual([])
    expect(serialization.reservationActive).toBe(false)
  })

  it("allows destructive mutation after task completion", async () => {
    const serialization = new FakeSerialization()
    const handle = await admitDestructiveTask(serializationAnalysis, () => {}, { serialization })
    handle.release()
    let deleted = false
    await performDestructiveOperation("clear-all", {}, async () => { deleted = true }, {
      serialization,
      checkConflicts: async () => serialization.activeTasks,
      broadcastMutation: () => {},
    })
    expect(deleted).toBe(true)
  })

  it("allows Analysis and Ask after destructive mutation completes", async () => {
    const serialization = new FakeSerialization()
    await performDestructiveOperation("clear-all", {}, async () => {}, {
      serialization,
      checkConflicts: async () => [],
      broadcastMutation: () => {},
    })
    const analysisHandle = await admitDestructiveTask(serializationAnalysis, () => {}, { serialization })
    analysisHandle.release()
    const askHandle = await admitDestructiveTask(serializationAsk, () => {}, { serialization })
    askHandle.release()
    expect(serialization.activeTasks).toEqual([])
  })
})
