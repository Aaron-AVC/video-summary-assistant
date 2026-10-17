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
  taskId?: string
  contentKey?: string
  analysisRunId?: string
  threadId?: string
  phase: string
}

export type TaskAdmissionHandle = {
  taskId: string
  release: () => void
}

export type TaskAdmissionStarter = (taskId: string) => void | Promise<void>

export type DestructiveCoordinatorSerialization = {
  admitTask: (
    task: DestructiveTaskSnapshot,
    starter: TaskAdmissionStarter,
  ) => Promise<TaskAdmissionHandle>
  reserveDestructive: <T>(operation: () => Promise<T>) => Promise<T>
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
  serialization?: DestructiveCoordinatorSerialization
}

const CHANNEL_NAME = "video-summary-assistant:destructive-coordination:v1"
const RESPONSE_WINDOW_MS = 180
const ADMISSION_LOCK_NAME = "video-summary-assistant:task-admission:v1"
const ACTIVE_TASK_LOCK_PREFIX = "video-summary-assistant:active-task:v1:"
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

function createDeferred() {
  let resolve!: () => void
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function encodeTaskLockDescriptor(task: DestructiveTaskSnapshot, taskId: string) {
  return encodeURIComponent(JSON.stringify({
    taskId,
    kind: task.kind,
    contentKey: task.contentKey,
    analysisRunId: task.analysisRunId,
    threadId: task.threadId,
  }))
}

function decodeTaskLockDescriptor(name: string): DestructiveTaskSnapshot | null {
  if (!name.startsWith(ACTIVE_TASK_LOCK_PREFIX)) return null
  const encoded = name.slice(ACTIVE_TASK_LOCK_PREFIX.length)
  const separator = encoded.lastIndexOf(":")
  if (separator <= 0) return null
  try {
    const value = JSON.parse(decodeURIComponent(encoded.slice(0, separator))) as unknown
    if (!isRecord(value) || !isTaskKind(value.kind)) return null
    return {
      ...(typeof value.taskId === "string" ? { taskId: value.taskId } : {}),
      kind: value.kind,
      ...(typeof value.contentKey === "string" ? { contentKey: value.contentKey } : {}),
      ...(typeof value.analysisRunId === "string" ? { analysisRunId: value.analysisRunId } : {}),
      ...(typeof value.threadId === "string" ? { threadId: value.threadId } : {}),
      phase: "unknown",
    }
  } catch {
    return null
  }
}

function getBrowserLockManager(): LockManager {
  if (typeof navigator === "undefined" || !navigator.locks) {
    throw new Error("Data coordination is unavailable in this browser context. Try again after reopening the extension.")
  }
  return navigator.locks
}

function isTaskKind(value: unknown): value is DestructiveTaskSnapshot["kind"] {
  return value === "analysis" || value === "ask" || value === "unknown"
}

function createWebLocksSerialization(): DestructiveCoordinatorSerialization {
  return {
    async admitTask(task, starter) {
      const locks = getBrowserLockManager()
      const taskId = createId()
      const releaseTask = createDeferred()
      let taskReady!: () => void
      const taskReadyPromise = new Promise<void>((resolve) => {
        taskReady = resolve
      })
      let taskLockPromise: Promise<void> | null = null
      try {
        const admitted = await locks.request(
          ADMISSION_LOCK_NAME,
          { ifAvailable: true },
          async (lock) => {
            if (!lock) return false
            taskLockPromise = locks.request<void>(
              `${ACTIVE_TASK_LOCK_PREFIX}${encodeTaskLockDescriptor(task, taskId)}:${taskId}`,
              { mode: "shared" },
              async (activeTaskLock) => {
                if (!activeTaskLock) throw new Error("Could not acquire task admission lock.")
                taskReady()
                await releaseTask.promise
              },
            )
            await taskReadyPromise
            await starter(taskId)
            return true
          },
        )

        if (!admitted) throw new DestructiveOperationBlockedError()
      } catch (error) {
        releaseTask.resolve()
        if (taskLockPromise) await taskLockPromise.catch(() => {})
        throw error
      }

      let released = false
      return {
        taskId,
        release: () => {
          if (released) return
          released = true
          releaseTask.resolve()
          void taskLockPromise
        },
      }
    },

    async reserveDestructive(operation) {
      return getBrowserLockManager().request(
        ADMISSION_LOCK_NAME,
        async (lock) => {
          if (!lock) throw new Error("Could not acquire destructive-operation reservation.")
          return await operation()
        },
      )
    },
  }
}

function getDefaultSerialization() {
  return createWebLocksSerialization()
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
    && (value.taskId === undefined || typeof value.taskId === "string")
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

  const snapshots = await new Promise<DestructiveTaskSnapshot[]>((resolve) => {
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

  if (typeof navigator === "undefined" || !navigator.locks?.query) return snapshots
  let heldLocks: LockManagerSnapshot
  try {
    heldLocks = await navigator.locks.query()
  } catch {
    return [...snapshots, { kind: "unknown", phase: "lock-query-error" }]
  }
  const lockTasks = heldLocks.held
    .map((lock) => decodeTaskLockDescriptor(lock.name))
    .filter((task): task is DestructiveTaskSnapshot => task !== null)
  return mergeDestructiveTaskSnapshots(snapshots, lockTasks)
}

function sameDestructiveTaskIdentity(
  left: DestructiveTaskSnapshot,
  right: DestructiveTaskSnapshot,
): boolean {
  if (left.taskId !== undefined && right.taskId !== undefined) {
    return left.taskId === right.taskId
  }
  return left.kind === right.kind
    && left.contentKey === right.contentKey
    && left.analysisRunId === right.analysisRunId
    && left.threadId === right.threadId
}

export function mergeDestructiveTaskSnapshots(
  liveSnapshots: DestructiveTaskSnapshot[],
  lockSnapshots: DestructiveTaskSnapshot[],
): DestructiveTaskSnapshot[] {
  const merged = [...liveSnapshots]
  for (const lockSnapshot of lockSnapshots) {
    if (!merged.some((liveSnapshot) => sameDestructiveTaskIdentity(liveSnapshot, lockSnapshot))) {
      merged.push(lockSnapshot)
    }
  }
  return merged
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

export async function admitDestructiveTask(
  task: DestructiveTaskSnapshot,
  starter: TaskAdmissionStarter,
  options: Pick<DestructiveCoordinatorOptions, "serialization"> = {},
): Promise<TaskAdmissionHandle> {
  return (options.serialization ?? getDefaultSerialization()).admitTask(task, starter)
}

export type PerformDestructiveOperationOptions = {
  checkConflicts?: (
    action: DestructiveAction,
    target: DestructiveOperationTarget,
  ) => Promise<DestructiveTaskSnapshot[]>
  broadcastMutation?: (mutation: DestructiveMutation) => void
  serialization?: DestructiveCoordinatorSerialization
}

export async function performDestructiveOperation(
  action: DestructiveAction,
  target: DestructiveOperationTarget,
  mutate: () => Promise<void>,
  options: PerformDestructiveOperationOptions = {},
): Promise<void> {
  const execute = async () => {
    const tasks = await (options.checkConflicts ?? queryActiveDestructiveTasks)(action, target)
    if (getDestructiveTaskConflicts(action, target, tasks).length > 0) {
      throw new DestructiveOperationBlockedError()
    }
    await mutate()
    const mutation = mutationForAction(action, target)
    ;(options.broadcastMutation ?? publishDestructiveMutation)(mutation)
  }

  // Injected conflict checks are retained for narrow unit tests that exercise
  // the conflict rules without a browser lock implementation.
  if (options.serialization || !options.checkConflicts) {
    await (options.serialization ?? getDefaultSerialization()).reserveDestructive(execute)
    return
  }
  await execute()
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
