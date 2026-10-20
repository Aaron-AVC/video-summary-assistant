import {
  PENDING_HISTORY_OPEN_KEY,
  isPendingHistoryOpenPayload,
  type PendingHistoryOpenPayload,
} from "@/features/history/lib/pending-history-open"

/**
 * The Options History tab publishes a payload under
 * `PENDING_HISTORY_OPEN_KEY` and then asks Chrome to open the side panel.
 * This adapter owns the side-panel half of that handoff: the best-effort
 * initial read, the `chrome.storage.onChanged` subscription, payload
 * validation through the shared helper, and the storage key cleanup.
 *
 * It deliberately knows nothing about history restore, transcript
 * publication, Ask state, or presentation. `onOpen` is the only thing it
 * triggers, and the caller owns everything that happens inside it.
 */

export type PendingHistoryOpenStorageChange = {
  newValue?: unknown
}

export type PendingHistoryOpenStorageChanges = {
  [key: string]: PendingHistoryOpenStorageChange
}

export type PendingHistoryOpenStorageChangeListener = (
  changes: PendingHistoryOpenStorageChanges,
  areaName: string,
) => void

/**
 * Narrow storage surface so the lifecycle can be tested without Chrome.
 * Implementations must be best-effort: a missing storage area resolves
 * instead of throwing, matching `chrome.storage?.local?.` access.
 */
export type PendingHistoryOpenStorage = {
  get: (key: string) => Promise<PendingHistoryOpenStorageChanges | undefined>
  remove: (key: string) => Promise<void>
  addChangeListener: (listener: PendingHistoryOpenStorageChangeListener) => void
  removeChangeListener: (listener: PendingHistoryOpenStorageChangeListener) => void
}

export type PendingHistoryOpenAdapterOptions = {
  onOpen: (payload: PendingHistoryOpenPayload) => Promise<void> | void
  storage?: PendingHistoryOpenStorage
}

export type PendingHistoryOpenAdapter = {
  start: () => void
  stop: () => void
}

/**
 * Wraps the real extension storage. Every access mirrors the optional
 * chaining the side panel used before extraction, so an absent
 * `chrome.storage` degrades to a no-op instead of throwing.
 */
export function createChromePendingHistoryOpenStorage(
  source: typeof globalThis.chrome | undefined = globalThis.chrome,
): PendingHistoryOpenStorage {
  return {
    async get(key) {
      const local = source?.storage?.local
      if (!local?.get) return undefined
      return (await local.get(key)) as PendingHistoryOpenStorageChanges | undefined
    },
    async remove(key) {
      const local = source?.storage?.local
      if (!local?.remove) return
      await local.remove(key)
    },
    addChangeListener(listener) {
      source?.storage?.onChanged?.addListener?.(listener)
    },
    removeChangeListener(listener) {
      source?.storage?.onChanged?.removeListener?.(listener)
    },
  }
}

export function createPendingHistoryOpenAdapter({
  onOpen,
  storage = createChromePendingHistoryOpenStorage(),
}: PendingHistoryOpenAdapterOptions): PendingHistoryOpenAdapter {
  let active = false
  let stopped = false
  let registeredListener: PendingHistoryOpenStorageChangeListener | null = null

  /**
   * Invalid payloads are ignored entirely: no open, no key removal, so a
   * malformed producer write cannot erase a payload another consumer needs.
   */
  const consumePayload = async (rawValue: unknown) => {
    if (!active || !isPendingHistoryOpenPayload(rawValue)) return
    try {
      await onOpen(rawValue)
    } finally {
      // Cleanup is unconditional: a failed open must still clear the key so
      // the same payload does not replay on the next mount.
      try {
        await storage.remove(PENDING_HISTORY_OPEN_KEY)
      } catch {
        // Storage may not be writable in some sandboxes; ignore.
      }
    }
  }

  const handleChange: PendingHistoryOpenStorageChangeListener = (changes, areaName) => {
    if (areaName !== "local") return
    const change = changes[PENDING_HISTORY_OPEN_KEY]
    if (change) void consumePayload(change.newValue)
  }

  const start = () => {
    if (stopped || registeredListener) return
    active = true
    registeredListener = handleChange
    storage.addChangeListener(handleChange)

    void (async () => {
      try {
        const stored = await storage.get(PENDING_HISTORY_OPEN_KEY)
        // `consumePayload` re-checks activity, so a read that resolves after
        // `stop()` neither opens nor clears the pending payload.
        await consumePayload(stored?.[PENDING_HISTORY_OPEN_KEY])
      } catch {
        // chrome.storage unavailable; nothing to drain.
      }
    })()
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    active = false
    const listener = registeredListener
    registeredListener = null
    if (listener) storage.removeChangeListener(listener)
  }

  return { start, stop }
}
