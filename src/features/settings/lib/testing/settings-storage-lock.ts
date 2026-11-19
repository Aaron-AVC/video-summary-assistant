import {
  createSettingsStorage,
  type SettingsStorageAdapter,
  type SettingsStorageLockManager,
} from "@/features/settings/lib/settings-storage"

export type TestSettingsStorageLockManager = SettingsStorageLockManager & {
  readonly requests: number
  readonly maxActive: number
}

/** Deterministic exclusive-lock queue shared by test panel instances. */
export function createTestSettingsStorageLockManager(
  onRequest?: () => void,
): TestSettingsStorageLockManager {
  let tail = Promise.resolve()
  let active = 0
  let requests = 0
  let maxActive = 0

  return {
    get requests() {
      return requests
    },
    get maxActive() {
      return maxActive
    },
    request<T>(
      name: string,
      options: { mode: "exclusive" },
      callback: (lock: { name: string; mode: "exclusive" } | null) => Promise<T>,
    ): Promise<T> {
      requests += 1
      onRequest?.()
      const previous = tail
      let release!: () => void
      tail = new Promise<void>((resolve) => {
        release = resolve
      })
      return (async () => {
        await previous
        active += 1
        maxActive = Math.max(maxActive, active)
        try {
          return await callback({ name, mode: options.mode })
        } finally {
          active -= 1
          release()
        }
      })()
    },
  }
}

const lockManagers = new WeakMap<SettingsStorageAdapter, SettingsStorageLockManager>()

/** Existing tests share a lock whenever they share an adapter, like browser panels. */
export function createSettingsStorageForTest(
  adapter: SettingsStorageAdapter,
  explicitLockManager?: SettingsStorageLockManager,
) {
  let lockManager = explicitLockManager ?? lockManagers.get(adapter)
  if (!lockManager) {
    lockManager = createTestSettingsStorageLockManager()
    lockManagers.set(adapter, lockManager)
  }
  return createSettingsStorage(adapter, { lockManager })
}
