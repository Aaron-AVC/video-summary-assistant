import type { DestructiveMutation } from "@/features/history/lib/destructive-operation-coordinator"
import type { VideoPlatform } from "@/features/platform/types"
import { SETTINGS_KEYS } from "@/features/settings/lib/settings-storage"

export type FinalCheckpointSourceIdentity = {
  sourceTabId: number | null
  platform: VideoPlatform | null
  videoId: string | null
  partId: string | null
  contentKey: string | null
  title: string | null
  durationSec: number | null
  workspaceEpoch: number
  transcriptFingerprint: string | null
  providerProfileId: string | null
  analysisPresetId: string
}

export type FinalCheckpointLifecycleController = {
  invalidate: (reason: string) => void
  handleDestructiveMutation: (mutation: DestructiveMutation) => unknown
  destroy: () => void
}

type ListenerEvent<Args extends unknown[]> = {
  addListener: (listener: (...args: Args) => void) => void
  removeListener: (listener: (...args: Args) => void) => void
}

export type FinalCheckpointLifecycleAdapters = {
  storage?: ListenerEvent<[Record<string, unknown>, string]>
  tabs?: {
    onUpdated?: ListenerEvent<[number, { url?: string; title?: string; status?: string }]>
    onRemoved?: ListenerEvent<[number]>
  }
}

const CHECKPOINT_SETTING_KEYS = new Set<string>([
  SETTINGS_KEYS.defaultProviderId,
  SETTINGS_KEYS.providerProfiles,
  SETTINGS_KEYS.providerSecrets,
  SETTINGS_KEYS.analysisPreset,
])

/**
 * Owns one panel's browser-event bindings. Identity comparison is deliberately
 * independent of the active-task snapshot, which disappears after a Final error.
 */
export class SidePanelFinalCheckpointLifecycle<
  Controller extends FinalCheckpointLifecycleController,
> {
  private serializedSource: string | null = null
  private sourceTabId: number | null = null
  private destroyed = false

  private readonly onStorageChanged = (changes: Record<string, unknown>, areaName: string): void => {
    if (areaName !== "local") return
    if (Object.keys(changes).some((key) => CHECKPOINT_SETTING_KEYS.has(key))) {
      this.invalidate()
    }
  }

  private readonly onTabUpdated = (tabId: number): void => {
    if (this.sourceTabId !== null && tabId === this.sourceTabId) this.invalidate()
  }

  private readonly onTabRemoved = (tabId: number): void => {
    if (this.sourceTabId !== null && tabId === this.sourceTabId) this.invalidate()
  }

  constructor(
    readonly controller: Controller,
    private readonly adapters: FinalCheckpointLifecycleAdapters = {},
  ) {
    adapters.storage?.addListener(this.onStorageChanged)
    adapters.tabs?.onUpdated?.addListener(this.onTabUpdated)
    adapters.tabs?.onRemoved?.addListener(this.onTabRemoved)
  }

  syncSource(identity: FinalCheckpointSourceIdentity): void {
    if (this.destroyed) return
    const serialized = JSON.stringify(identity)
    if (this.serializedSource !== null && serialized !== this.serializedSource) {
      this.invalidate()
    }
    this.serializedSource = serialized
    this.sourceTabId = identity.sourceTabId
  }

  invalidate(): void {
    if (!this.destroyed) this.controller.invalidate("side-panel-lifecycle")
  }

  handleMutation(mutation: DestructiveMutation): void {
    if (!this.destroyed) this.controller.handleDestructiveMutation(mutation)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.adapters.storage?.removeListener(this.onStorageChanged)
    this.adapters.tabs?.onUpdated?.removeListener(this.onTabUpdated)
    this.adapters.tabs?.onRemoved?.removeListener(this.onTabRemoved)
    this.controller.destroy()
  }
}
