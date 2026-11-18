import { describe, expect, test } from "bun:test"

import type { DestructiveMutation } from "@/features/history/lib/destructive-operation-coordinator"
import {
  SidePanelFinalCheckpointLifecycle,
  type FinalCheckpointSourceIdentity,
} from "@/sidepanel/analysis/final-checkpoint-lifecycle"

class FakeEvent<Args extends unknown[]> {
  readonly listeners = new Set<(...args: Args) => void>()

  addListener(listener: (...args: Args) => void): void {
    this.listeners.add(listener)
  }

  removeListener(listener: (...args: Args) => void): void {
    this.listeners.delete(listener)
  }

  emit(...args: Args): void {
    for (const listener of [...this.listeners]) listener(...args)
  }
}

class FakeController {
  invalidations = 0
  destroyed = false
  readonly mutations: DestructiveMutation[] = []

  invalidate(): void {
    this.invalidations += 1
  }

  handleDestructiveMutation(mutation: DestructiveMutation): void {
    this.mutations.push(mutation)
  }

  destroy(): void {
    this.destroyed = true
    this.invalidations += 1
  }
}

function sourceFixture(): FinalCheckpointSourceIdentity {
  return {
    sourceTabId: 7,
    platform: "youtube",
    videoId: "video-a",
    partId: null,
    contentKey: "youtube:video-a",
    title: "Video A",
    durationSec: 120,
    workspaceEpoch: 3,
    transcriptFingerprint: "a".repeat(64),
    providerProfileId: "provider-a",
    analysisPresetId: "detailed",
  }
}

function createHarness() {
  const storageChanged = new FakeEvent<[Record<string, unknown>, string]>()
  const tabUpdated = new FakeEvent<[number, { url?: string; title?: string; status?: string }]>()
  const tabRemoved = new FakeEvent<[number]>()
  const controller = new FakeController()
  const lifecycle = new SidePanelFinalCheckpointLifecycle(controller, {
    storage: storageChanged,
    tabs: { onUpdated: tabUpdated, onRemoved: tabRemoved },
  })
  lifecycle.syncSource(sourceFixture())
  return { lifecycle, controller, storageChanged, tabUpdated, tabRemoved }
}

describe("Side Panel final-checkpoint lifecycle", () => {
  test("keeps an identical source identity without invalidating", () => {
    const { lifecycle, controller } = createHarness()
    lifecycle.syncSource(sourceFixture())
    expect(controller.invalidations).toBe(0)
  })

  test.each([
    ["sourceTabId", { sourceTabId: 8 }],
    ["platform", { platform: "bilibili" as const }],
    ["videoId", { videoId: "video-b" }],
    ["partId", { partId: "p2" }],
    ["contentKey", { contentKey: "youtube:video-b" }],
    ["title", { title: "Renamed" }],
    ["durationSec", { durationSec: 121 }],
    ["workspaceEpoch", { workspaceEpoch: 4 }],
    ["transcriptFingerprint", { transcriptFingerprint: "b".repeat(64) }],
    ["providerProfileId", { providerProfileId: "provider-b" }],
    ["analysisPresetId", { analysisPresetId: "brief" }],
  ])("invalidates when %s changes", (_field, patch) => {
    const { lifecycle, controller } = createHarness()
    lifecycle.syncSource({ ...sourceFixture(), ...patch })
    expect(controller.invalidations).toBe(1)
  })

  test("does not resurrect a checkpoint across A→B→A or P1→P2→P1", () => {
    const { lifecycle, controller } = createHarness()
    const source = sourceFixture()
    lifecycle.syncSource({ ...source, videoId: "video-b", contentKey: "youtube:video-b" })
    lifecycle.syncSource(source)
    lifecycle.syncSource({ ...source, providerProfileId: "provider-b" })
    lifecycle.syncSource(source)
    expect(controller.invalidations).toBe(4)
  })

  test.each([
    "yt-summarizer.provider.default",
    "yt-summarizer.provider.profiles",
    "yt-summarizer.provider.secrets",
    "yt-summarizer.analysis.preset",
  ])("invalidates for relevant cross-surface storage key %s", (key) => {
    const { controller, storageChanged } = createHarness()
    storageChanged.emit({ [key]: { oldValue: "old", newValue: "new" } }, "local")
    expect(controller.invalidations).toBe(1)
  })

  test("ignores unrelated storage keys and non-local areas", () => {
    const { controller, storageChanged } = createHarness()
    storageChanged.emit({ "video.summary.transcript.cache.v1": {} }, "local")
    storageChanged.emit({ "yt-summarizer.provider.secrets": {} }, "sync")
    expect(controller.invalidations).toBe(0)
  })

  test("invalidates for a matching tab update/removal but not an unrelated tab", () => {
    const { controller, tabUpdated, tabRemoved } = createHarness()
    tabUpdated.emit(8, { url: "https://example.com/other" })
    tabRemoved.emit(8)
    expect(controller.invalidations).toBe(0)
    tabUpdated.emit(7, { status: "loading" })
    tabRemoved.emit(7)
    expect(controller.invalidations).toBe(2)
  })

  test("forwards destructive mutations without duplicating their matching policy", () => {
    const { lifecycle, controller } = createHarness()
    const mutation: DestructiveMutation = { type: "clear-conversations" }
    lifecycle.handleMutation(mutation)
    expect(controller.mutations).toEqual([mutation])
    expect(controller.invalidations).toBe(0)
  })

  test("destroy removes browser listeners and invalidates exactly once", () => {
    const { lifecycle, controller, storageChanged, tabUpdated, tabRemoved } = createHarness()
    lifecycle.destroy()
    lifecycle.destroy()
    expect(controller.destroyed).toBe(true)
    expect(controller.invalidations).toBe(1)
    expect(storageChanged.listeners.size).toBe(0)
    expect(tabUpdated.listeners.size).toBe(0)
    expect(tabRemoved.listeners.size).toBe(0)
    storageChanged.emit({ "yt-summarizer.provider.secrets": {} }, "local")
    expect(controller.invalidations).toBe(1)
  })
})
