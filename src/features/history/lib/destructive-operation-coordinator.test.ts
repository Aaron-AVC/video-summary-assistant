import { describe, expect, it } from "bun:test"

import {
  DestructiveOperationBlockedError,
  getDestructiveTaskConflicts,
  performDestructiveOperation,
  queryActiveDestructiveTasks,
  subscribeToDestructiveOperations,
  type DestructiveCoordinatorChannel,
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
