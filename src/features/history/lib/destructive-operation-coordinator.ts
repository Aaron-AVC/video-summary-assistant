export type DestructiveAction =
  | "delete-analysis-run"
  | "delete-video-data"
  | "clear-conversations"
  | "clear-transcript-cache"
  | "clear-analysis-history"
  | "clear-diagnostics"
  | "clear-all"

export type DestructiveOperationTarget = {
  analysisRunId?: string
  contentKey?: string
}

export type DestructiveTaskSnapshot = {
  kind: "analysis" | "ask" | "unknown"
  contentKey?: string
  analysisRunId?: string
  threadId?: string
  phase: string
}

export type DestructiveMutation =
  | { type: "delete-analysis-run"; analysisRunId: string }
  | { type: "delete-video-data"; contentKey: string }
  | { type: "clear-conversations" }
  | { type: "clear-transcript-cache" }
  | { type: "clear-analysis-history" }
  | { type: "clear-diagnostics" }
  | { type: "clear-all" }

type CoordinatorMessage =
  | {
      type: "query"
      requestId: string
      action: DestructiveAction
      target: DestructiveOperationTarget
    }
  | {
      type: "snapshot"
      requestId: string
      instanceId: string
      tasks: DestructiveTaskSnapshot[]
    }
  | { type: "mutation"; mutation: DestructiveMutation }

type ChannelMessageEvent = { data: unknown }

export interface DestructiveCoordinatorChannel {
  onmessage: ((event: ChannelMessageEvent) => void) | null
  postMessage(message: CoordinatorMessage): void
  close(): void
}

export type DestructiveCoordinatorOptions = {
  createChannel?: () => DestructiveCoordinatorChannel
  responseWindowMs?: number
  createId?: () => string
}

const CHANNEL_NAME = "video-summary-assistant:destructive-coordination:v1"
const RESPONSE_WINDOW_MS = 180
const ACTIONS: DestructiveAction[] = [
  "delete-analysis-run",
  "delete-video-data",
  "clear-conversations",
  "clear-transcript-cache",
  "clear-analysis-history",
  "clear-diagnostics",
  "clear-all",
]

function createBrowserChannel(): DestructiveCoordinatorChannel {
  if (typeof BroadcastChannel === "undefined") {
    throw new Error("Data deletion coordination is unavailable. Try again after reopening the extension.")
  }
  return new BroadcastChannel(CHANNEL_NAME) as unknown as DestructiveCoordinatorChannel
}

function createId() {
  return crypto.randomUUID()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isDestructiveAction(value: unknown): value is DestructiveAction {
  return typeof value === "string" && ACTIONS.includes(value as DestructiveAction)
}

function isTaskSnapshot(value: unknown): value is DestructiveTaskSnapshot {
  return isRecord(value)
    && (value.kind === "analysis" || value.kind === "ask" || value.kind === "unknown")
    && typeof value.phase === "string"
    && (value.contentKey === undefined || typeof value.contentKey === "string")
    && (value.analysisRunId === undefined || typeof value.analysisRunId === "string")
    && (value.threadId === undefined || typeof value.threadId === "string")
}

function isMutation(value: unknown): value is DestructiveMutation {
  if (!isRecord(value) || typeof value.type !== "string") return false
  if (value.type === "delete-analysis-run") return typeof value.analysisRunId === "string"
  if (value.type === "delete-video-data") return typeof value.contentKey === "string"
  return value.type === "clear-conversations"
    || value.type === "clear-transcript-cache"
    || value.type === "clear-analysis-history"
    || value.type === "clear-diagnostics"
    || value.type === "clear-all"
}

function normalizeTarget(value: unknown): DestructiveOperationTarget {
  if (!isRecord(value)) return {}
  return {
    ...(typeof value.analysisRunId === "string" ? { analysisRunId: value.analysisRunId } : {}),
    ...(typeof value.contentKey === "string" ? { contentKey: value.contentKey } : {}),
  }
}

export function getDestructiveTaskConflicts(
  action: DestructiveAction,
  target: DestructiveOperationTarget,
  tasks: DestructiveTaskSnapshot[],
): DestructiveTaskSnapshot[] {
  if (action === "clear-diagnostics") return []
  if (action === "clear-transcript-cache") {
    return tasks.filter((task) => task.kind === "unknown"
      || (task.kind === "analysis" && task.phase === "loading-transcript"))
  }
  if (action === "clear-conversations") {
    return tasks.filter((task) => task.kind === "ask" || task.kind === "unknown")
  }
  if (action === "clear-analysis-history" || action === "clear-all") return tasks
  if (action === "delete-analysis-run") {
    return tasks.filter((task) => task.kind === "unknown"
      || (target.analysisRunId !== undefined && task.analysisRunId === target.analysisRunId)
      || (target.contentKey !== undefined && task.contentKey === target.contentKey))
  }
  return tasks.filter((task) => task.kind === "unknown"
    || (target.contentKey !== undefined && task.contentKey === target.contentKey))
}

export async function queryActiveDestructiveTasks(
  action: DestructiveAction,
  target: DestructiveOperationTarget = {},
  options: DestructiveCoordinatorOptions = {},
): Promise<DestructiveTaskSnapshot[]> {
  const createChannel = options.createChannel ?? createBrowserChannel
  const channel = createChannel()
  const requestId = (options.createId ?? createId)()
  const responders = new Map<string, DestructiveTaskSnapshot[]>()

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      channel.onmessage = null
      channel.close()
      resolve([...responders.values()].flat())
    }, options.responseWindowMs ?? RESPONSE_WINDOW_MS)

    channel.onmessage = (event) => {
      const message = event.data
      if (!isRecord(message)
        || message.type !== "snapshot"
        || message.requestId !== requestId
        || typeof message.instanceId !== "string"
        || !Array.isArray(message.tasks)) return
      responders.set(message.instanceId, message.tasks.filter(isTaskSnapshot))
    }

    try {
      channel.postMessage({ type: "query", requestId, action, target })
    } catch {
      clearTimeout(timeout)
      channel.onmessage = null
      channel.close()
      resolve([{ kind: "unknown", phase: "coordination-error" }])
    }
  })
}

export function publishDestructiveMutation(
  mutation: DestructiveMutation,
  options: DestructiveCoordinatorOptions = {},
): void {
  const channel = (options.createChannel ?? createBrowserChannel)()
  try {
    channel.postMessage({ type: "mutation", mutation })
  } finally {
    channel.close()
  }
}

export function subscribeToDestructiveOperations(
  getTasks: () => DestructiveTaskSnapshot[],
  onMutation: (mutation: DestructiveMutation) => void | Promise<void>,
  options: DestructiveCoordinatorOptions = {},
): () => void {
  const channel = (options.createChannel ?? createBrowserChannel)()
  const instanceId = (options.createId ?? createId)()
  channel.onmessage = (event) => {
    const message = event.data
    if (!isRecord(message)) return
    if (message.type === "query"
      && typeof message.requestId === "string"
      && isDestructiveAction(message.action)) {
      let tasks: DestructiveTaskSnapshot[]
      try {
        tasks = getTasks()
      } catch {
        tasks = [{ kind: "unknown", phase: "snapshot-error" }]
      }
      try {
        channel.postMessage({
          type: "snapshot",
          requestId: message.requestId,
          instanceId,
          tasks,
        })
      } catch {
        // A missing reply causes the Options surface to use its bounded no-live-panel behavior.
      }
      return
    }
    if (message.type === "mutation" && isMutation(message.mutation)) {
      void onMutation(message.mutation)
    }
  }
  return () => {
    channel.onmessage = null
    channel.close()
  }
}

export class DestructiveOperationBlockedError extends Error {
  constructor() {
    super("Cancel the active task before clearing/deleting this data.")
    this.name = "DestructiveOperationBlockedError"
  }
}

export type PerformDestructiveOperationOptions = {
  checkConflicts?: (
    action: DestructiveAction,
    target: DestructiveOperationTarget,
  ) => Promise<DestructiveTaskSnapshot[]>
  broadcastMutation?: (mutation: DestructiveMutation) => void
}

export async function performDestructiveOperation(
  action: DestructiveAction,
  target: DestructiveOperationTarget,
  mutate: () => Promise<void>,
  options: PerformDestructiveOperationOptions = {},
): Promise<void> {
  const tasks = await (options.checkConflicts ?? queryActiveDestructiveTasks)(action, target)
  if (getDestructiveTaskConflicts(action, target, tasks).length > 0) {
    throw new DestructiveOperationBlockedError()
  }
  await mutate()
  const mutation = mutationForAction(action, target)
  ;(options.broadcastMutation ?? publishDestructiveMutation)(mutation)
}

export function mutationForAction(
  action: DestructiveAction,
  target: DestructiveOperationTarget = {},
): DestructiveMutation {
  if (action === "delete-analysis-run") {
    if (!target.analysisRunId) throw new Error("An analysis run identity is required.")
    return { type: action, analysisRunId: target.analysisRunId }
  }
  if (action === "delete-video-data") {
    if (!target.contentKey) throw new Error("A video content identity is required.")
    return { type: action, contentKey: target.contentKey }
  }
  return { type: action }
}

export function isDestructiveMutation(value: unknown): value is DestructiveMutation {
  return isMutation(value)
}

export function readDestructiveQuery(value: unknown): {
  requestId: string
  action: DestructiveAction
  target: DestructiveOperationTarget
} | null {
  if (!isRecord(value)
    || value.type !== "query"
    || typeof value.requestId !== "string"
    || !isDestructiveAction(value.action)) return null
  return {
    requestId: value.requestId,
    action: value.action,
    target: normalizeTarget(value.target),
  }
}
