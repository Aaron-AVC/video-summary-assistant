import { describe, expect, it } from "bun:test"

import type {
  AnalysisRunEntity,
  KnowledgeItemEntity,
  QaMessageEntity,
  QaThreadEntity,
  SegmentSummaryEntity,
} from "@/lib/schemas/persistence"
import type { SearchRepositoryCandidates } from "@/features/search/lib/search-repository"
import {
  createSearchController,
  type SearchRuntimeProjection,
} from "@/sidepanel/search/search-controller"

function emptyCandidates(): SearchRepositoryCandidates {
  return {
    analysisRuns: [],
    segmentsByRunId: new Map(),
    videoRecords: [],
    knowledgeItems: [],
    qaThreads: [],
    qaMessagesByThreadId: new Map(),
  }
}

function buildRun(overrides: Partial<AnalysisRunEntity> = {}): AnalysisRunEntity {
  return {
    id: "run-1",
    videoId: "video-a",
    platform: "youtube",
    contentKey: "youtube:video-a",
    partId: null,
    transcriptSnapshotId: "snapshot-1",
    providerConfigId: null,
    transcriptFingerprint: "fp-1",
    status: "completed",
    summary: "A summary about deployment windows",
    keyPoints: [{ text: "Deploy safely" }],
    topics: [{ label: "Deployment" }],
    errorMessage: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    completedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  }
}

function buildKnowledgeItem(overrides: Partial<KnowledgeItemEntity> = {}): KnowledgeItemEntity {
  return {
    id: "knowledge-1",
    kind: "note",
    contentKey: "youtube:video-a",
    platform: "youtube",
    videoId: "video-a",
    partId: null,
    videoTitle: "Alpha video",
    analysisRunId: null,
    startSec: null,
    endSec: null,
    text: "remember the deployment checklist",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
    ...overrides,
  }
}

function buildThread(overrides: Partial<QaThreadEntity> = {}): QaThreadEntity {
  return {
    id: "thread-1",
    contentKey: "youtube:video-a",
    platform: "youtube",
    videoId: "video-a",
    partId: null,
    title: "Why deployment failed",
    analysisRunId: "run-1",
    transcriptFingerprint: "fp-1",
    providerProfileId: "profile-1",
    providerBaseUrl: "https://api.example.com",
    providerModel: "model-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-04T00:00:00.000Z",
    ...overrides,
  }
}

function buildMessage(overrides: Partial<QaMessageEntity> = {}): QaMessageEntity {
  return {
    id: "message-1",
    threadId: "thread-1",
    sequence: 1,
    role: "assistant",
    content: "The deployment failed because of a missing secret.",
    createdAt: "2026-01-04T00:00:00.000Z",
    ...overrides,
  }
}

function buildSegment(overrides: Partial<SegmentSummaryEntity> = {}): SegmentSummaryEntity {
  return {
    id: "segment-1",
    analysisRunId: "run-1",
    videoId: "video-a",
    title: "Deployment recap",
    summary: "The run rolled back",
    startSec: 10,
    endSec: 20,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  }
}

function buildRuntime(overrides: Partial<SearchRuntimeProjection> = {}): SearchRuntimeProjection {
  return {
    identity: {
      platform: "youtube",
      videoId: "video-a",
      contentKey: "youtube:video-a",
    },
    title: "Alpha video",
    analysis: null,
    transcript: { contentKey: null, cues: [] },
    ...overrides,
  }
}

function fixedRepository(candidates: SearchRepositoryCandidates) {
  const calls: number[] = []
  return {
    repository: {
      loadCandidates: async () => {
        calls.push(calls.length + 1)
        return candidates
      },
    },
    getCalls: () => calls.length,
  }
}

describe("search controller scope and identity", () => {
  it("does not scan persistence for a blank query", async () => {
    const fake = fixedRepository(emptyCandidates())
    const controller = createSearchController({ repository: fake.repository })

    await controller.search({ query: "   ", runtime: buildRuntime() })

    expect(fake.getCalls()).toBe(0)
    expect(controller.getSnapshot().results).toEqual([])
  })

  it("resolves every result to its own canonical identity", async () => {
    const candidates = emptyCandidates()
    candidates.knowledgeItems = [
      buildKnowledgeItem({
        id: "knowledge-youtube",
        contentKey: "youtube:video-a",
        videoId: "video-a",
      }),
      buildKnowledgeItem({
        id: "knowledge-bilibili-p1",
        contentKey: "bilibili:BV1TEST:p:1",
        platform: "bilibili",
        videoId: "BV1TEST",
        partId: "1",
        text: "part one deployment note",
      }),
    ]
    const controller = createSearchController({ repository: fixedRepository(candidates).repository })

    await controller.search({ query: "deployment", runtime: null })

    const byKey = new Map(controller.getSnapshot().results.map((result) => [result.contentKey, result]))
    expect(byKey.get("youtube:video-a")?.identity).toEqual({
      platform: "youtube",
      videoId: "video-a",
      contentKey: "youtube:video-a",
    })
    expect(byKey.get("bilibili:BV1TEST:p:1")?.identity).toEqual({
      platform: "bilibili",
      videoId: "BV1TEST",
      contentKey: "bilibili:BV1TEST:p:1",
      partId: "1",
    })
  })

  it("keeps Bilibili parts isolated from each other", async () => {
    const candidates = emptyCandidates()
    candidates.knowledgeItems = [
      buildKnowledgeItem({
        id: "p1",
        contentKey: "bilibili:BV1TEST:p:1",
        platform: "bilibili",
        videoId: "BV1TEST",
        partId: "1",
        videoTitle: "Episode one",
        text: "deployment notes for part one",
      }),
      buildKnowledgeItem({
        id: "p2",
        contentKey: "bilibili:BV1TEST:p:2",
        platform: "bilibili",
        videoId: "BV1TEST",
        partId: "2",
        videoTitle: "Episode two",
        text: "deployment notes for part two",
      }),
    ]
    const controller = createSearchController({ repository: fixedRepository(candidates).repository })

    await controller.search({ query: "deployment", runtime: null })

    const results = controller.getSnapshot().results
    expect(results).toHaveLength(2)
    for (const result of results) {
      expect(result.identity.partId).toBe(result.partId ?? undefined)
      expect(result.contentKey).toBe(
        `bilibili:BV1TEST:p:${result.partId}`,
      )
    }
    expect(new Set(results.map((result) => result.contentKey)).size).toBe(2)
  })

  it("searches transcript cues only through the current runtime projection", async () => {
    const controller = createSearchController({ repository: fixedRepository(emptyCandidates()).repository })

    await controller.search({
      query: "kubernetes",
      runtime: buildRuntime({
        transcript: {
          contentKey: "youtube:video-a",
          cues: [{ startSec: 5, endSec: 9, text: "kubernetes rollout plan" }],
        },
      }),
    })

    const results = controller.getSnapshot().results
    expect(results).toHaveLength(1)
    expect(results[0]?.kind).toBe("current-runtime-content")
    expect(results[0]?.contentKey).toBe("youtube:video-a")
    expect(results[0]?.snippet).toContain("kubernetes")
  })

  it("never surfaces current runtime content that the projection withheld", async () => {
    const controller = createSearchController({ repository: fixedRepository(emptyCandidates()).repository })

    await controller.search({
      query: "kubernetes",
      runtime: buildRuntime({ transcript: { contentKey: null, cues: [] }, analysis: null }),
    })

    expect(controller.getSnapshot().results).toEqual([])
  })

  it("lists bookmarks and notes with their persisted anchors", async () => {
    const candidates = emptyCandidates()
    candidates.knowledgeItems = [
      buildKnowledgeItem({
        id: "bookmark-1",
        kind: "bookmark",
        startSec: 42,
        endSec: 42,
        text: null,
        videoTitle: "Deployment walkthrough",
      }),
      buildKnowledgeItem({
        id: "note-1",
        kind: "note",
        startSec: null,
        endSec: null,
        text: "deployment follow up",
        videoTitle: "Deployment notes",
      }),
    ]
    const controller = createSearchController({ repository: fixedRepository(candidates).repository })

    await controller.search({ query: "deployment", runtime: null })

    const results = controller.getSnapshot().results
    const bookmark = results.find((result) => result.knowledgeItemId === "bookmark-1")
    const note = results.find((result) => result.knowledgeItemId === "note-1")
    expect(bookmark?.kind).toBe("knowledge")
    expect(bookmark?.timestampSeconds).toBe(42)
    expect(note?.timestampSeconds).toBeNull()
  })

  it("keeps point and range timestamps distinct in the result payload", async () => {
    const candidates = emptyCandidates()
    candidates.knowledgeItems = [
      buildKnowledgeItem({
        id: "point",
        startSec: 12,
        endSec: 12,
        kind: "bookmark",
        text: null,
        videoTitle: "Note bookmark",
      }),
      buildKnowledgeItem({
        id: "range",
        startSec: 12,
        endSec: 30,
        kind: "note",
        text: "range note",
        videoTitle: "Note range",
      }),
    ]
    const controller = createSearchController({ repository: fixedRepository(candidates).repository })

    await controller.search({ query: "note", runtime: null })

    const results = controller.getSnapshot().results
    expect(results.find((result) => result.knowledgeItemId === "point")?.timestampSeconds).toBe(12)
    expect(results.find((result) => result.knowledgeItemId === "range")?.timestampSeconds).toBe(12)
  })

  it("includes only QA threads that can be restored to an exact saved run", async () => {
    const candidates = emptyCandidates()
    candidates.analysisRuns = [buildRun()]
    candidates.qaThreads = [
      buildThread({ id: "restorable", title: "deployment question" }),
      buildThread({ id: "orphan", analysisRunId: "missing-run", title: "deployment orphan" }),
    ]
    candidates.qaMessagesByThreadId = new Map([["restorable", [buildMessage()]]])
    const controller = createSearchController({ repository: fixedRepository(candidates).repository })

    await controller.search({ query: "deployment", runtime: null })

    const threadIds = controller.getSnapshot().results.map((result) => result.threadId)
    expect(threadIds).toContain("restorable")
    expect(threadIds).not.toContain("orphan")
  })

  it("prefers a title match over an equivalent body match", async () => {
    const candidates = emptyCandidates()
    candidates.knowledgeItems = [
      buildKnowledgeItem({ id: "title-hit", videoTitle: "Deployment", text: "other words" }),
      buildKnowledgeItem({ id: "body-hit", videoTitle: "Other", text: "deployment mention" }),
    ]
    const controller = createSearchController({ repository: fixedRepository(candidates).repository })

    await controller.search({ query: "deployment", runtime: null })

    expect(controller.getSnapshot().results.map((result) => result.knowledgeItemId))
      .toEqual(["title-hit", "body-hit"])
  })

  it("deduplicates the historical row that is already the current analysis", async () => {
    const candidates = emptyCandidates()
    candidates.analysisRuns = [buildRun()]
    candidates.segmentsByRunId = new Map([["run-1", [buildSegment()]]])
    const controller = createSearchController({ repository: fixedRepository(candidates).repository })

    await controller.search({
      query: "deployment",
      runtime: buildRuntime({
        analysis: {
          analysisRunId: "run-1",
          transcriptFingerprint: "fp-1",
          analysis: {
            summary: "deployment summary",
            keyPoints: [{ text: "deployment point" }],
            chapters: [],
          },
        },
      }),
    })

    const kinds = controller.getSnapshot().results.map((result) => result.kind)
    expect(kinds).toContain("current-runtime-content")
    expect(kinds).not.toContain("historical-analysis")
  })
})

describe("search controller lifecycle", () => {
  it("is deterministic for identical candidates and query", async () => {
    const candidates = emptyCandidates()
    candidates.knowledgeItems = [
      buildKnowledgeItem({ id: "a", updatedAt: "2026-01-03T00:00:00.000Z" }),
      buildKnowledgeItem({ id: "b", updatedAt: "2026-01-03T00:00:00.000Z" }),
    ]
    const controller = createSearchController({ repository: fixedRepository(candidates).repository })

    await controller.search({ query: "deployment", runtime: null })
    const first = controller.getSnapshot().results
    await controller.search({ query: "deployment", runtime: null })

    expect(controller.getSnapshot().results).toEqual(first)
  })

  it("drops a superseded scan instead of publishing stale results", async () => {
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const controller = createSearchController({
      repository: {
        loadCandidates: async () => {
          await gate
          return emptyCandidates()
        },
      },
    })

    const pending = controller.search({ query: "deployment", runtime: null })
    controller.reset()
    release?.()
    await pending

    expect(controller.getSnapshot().results).toEqual([])
    expect(controller.getSnapshot().isSearching).toBe(false)
  })

  it("reports a repository failure without keeping partial results", async () => {
    const controller = createSearchController({
      repository: {
        loadCandidates: async () => {
          throw new Error("db down")
        },
      },
    })

    await controller.search({ query: "deployment", runtime: null })

    expect(controller.getSnapshot().error).toBe("db down")
    expect(controller.getSnapshot().results).toEqual([])
  })

  it("does not scan when only the query text changes", () => {
    const fake = fixedRepository(emptyCandidates())
    const controller = createSearchController({ repository: fake.repository })

    controller.setQuery("deployment")

    expect(controller.getSnapshot().query).toBe("deployment")
    expect(fake.getCalls()).toBe(0)
  })

  it("re-runs the active query for an explicit refresh", async () => {
    const fake = fixedRepository(emptyCandidates())
    const controller = createSearchController({ repository: fake.repository })
    controller.setQuery("deployment")

    await controller.refresh(null)

    expect(fake.getCalls()).toBe(1)
    expect(controller.getSnapshot().query).toBe("deployment")
  })

  it("notifies subscribers for every published snapshot", () => {
    const controller = createSearchController({ repository: fixedRepository(emptyCandidates()).repository })
    let notifications = 0
    const unsubscribe = controller.subscribe(() => {
      notifications += 1
    })

    controller.setQuery("a")
    controller.setQuery("ab")
    unsubscribe()
    controller.setQuery("abc")

    expect(notifications).toBe(2)
  })
})
