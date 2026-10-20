import { describe, expect, it } from "bun:test"

import type { ActiveVideoContext } from "@/features/platform/types"
import {
  projectWorkspaceRuntimeContent,
  type WorkspaceRuntimeContent,
} from "@/sidepanel/workspace/workspace-state"
import type {
  HistoryAnalysisSnapshot,
  HistoryRestoreSnapshot,
  HistoryTranscriptSnapshot,
} from "@/sidepanel/history/history-controller"
import {
  WorkspaceController,
  type WorkspaceHistoryPublicationEffects,
  type WorkspaceHistoryTranscriptPublication,
  type WorkspaceRuntimeTransition,
} from "@/sidepanel/workspace/workspace-controller"

function context(overrides: Partial<ActiveVideoContext> = {}): ActiveVideoContext {
  return {
    pageType: "video",
    platform: "youtube",
    videoId: "video-a",
    partId: null,
    contentKey: "youtube:video-a",
    url: "https://www.youtube.com/watch?v=video-a",
    canonicalUrl: "https://www.youtube.com/watch?v=video-a",
    title: "Video A",
    author: "Author A",
    timestampSeconds: 0,
    isReady: true,
    ...overrides,
  }
}

const EMPTY_CONTEXT: ActiveVideoContext = {
  pageType: "unsupported",
  platform: null,
  videoId: null,
  partId: null,
  contentKey: null,
  url: "https://example.com/",
  canonicalUrl: null,
  title: null,
  author: null,
  timestampSeconds: 0,
  isReady: false,
}

function observe(
  controller: WorkspaceController,
  videoContext: ActiveVideoContext,
  activeTabId: number | null = 1,
): WorkspaceRuntimeTransition {
  return controller.observeRuntimeContent({ videoContext, activeTabId })
}

function runtimeContentOf(controller: WorkspaceController): WorkspaceRuntimeContent {
  return controller.getSnapshot().runtimeContent
}

describe("projectWorkspaceRuntimeContent", () => {
  it("preserves the canonical identity and runtime metadata", () => {
    expect(projectWorkspaceRuntimeContent({
      videoContext: context(),
      activeTabId: 7,
    })).toEqual({
      contentKey: "youtube:video-a",
      identity: {
        platform: "youtube",
        videoId: "video-a",
        contentKey: "youtube:video-a",
      },
      title: "Video A",
      author: "Author A",
      canonicalUrl: "https://www.youtube.com/watch?v=video-a",
      isReady: true,
      activeTabId: 7,
    })
  })

  it("falls back to the raw url when no canonical url is available", () => {
    const content = projectWorkspaceRuntimeContent({
      videoContext: context({ canonicalUrl: null, url: "https://www.youtube.com/watch?v=video-a&t=42" }),
      activeTabId: null,
    })

    expect(content.canonicalUrl).toBe("https://www.youtube.com/watch?v=video-a&t=42")
    expect(content.activeTabId).toBeNull()
  })

  it("never projects the playback timestamp", () => {
    const content = projectWorkspaceRuntimeContent({
      videoContext: context({ timestampSeconds: 999 }),
      activeTabId: 1,
    })

    expect(Object.keys(content).sort()).toEqual([
      "activeTabId",
      "author",
      "canonicalUrl",
      "contentKey",
      "identity",
      "isReady",
      "title",
    ])
    expect("timestampSeconds" in content).toBe(false)
  })

  it("preserves a raw contentKey even when the identity is incomplete", () => {
    const content = projectWorkspaceRuntimeContent({
      videoContext: context({ platform: null, videoId: null, contentKey: "youtube:video-a" }),
      activeTabId: 1,
    })

    expect(content.contentKey).toBe("youtube:video-a")
    expect(content.identity).toBeNull()
  })
})

describe("WorkspaceController initial observation", () => {
  it("returns initial + shouldReset for the first null content observation", () => {
    const controller = new WorkspaceController()
    expect(controller.getSnapshot().workspaceEpoch).toBe(0)

    const transition = observe(controller, EMPTY_CONTEXT, null)

    expect(transition.kind).toBe("initial")
    expect(transition.shouldReset).toBe(true)
    expect(transition.previousContentKey).toBeNull()
    expect(transition.currentContentKey).toBeNull()
    expect(transition.snapshot.workspaceEpoch).toBe(1)
    expect(controller.captureEpoch()).toBe(1)
  })

  it("returns initial + shouldReset with a canonical identity for the first YouTube observation", () => {
    const controller = new WorkspaceController()

    const transition = observe(controller, context(), 3)

    expect(transition.kind).toBe("initial")
    expect(transition.shouldReset).toBe(true)
    expect(transition.previousContentKey).toBeNull()
    expect(transition.currentContentKey).toBe("youtube:video-a")
    expect(transition.snapshot.runtimeContent.identity).toEqual({
      platform: "youtube",
      videoId: "video-a",
      contentKey: "youtube:video-a",
    })
    expect(transition.snapshot.runtimeContent.activeTabId).toBe(3)
    expect(transition.snapshot.workspaceEpoch).toBe(1)
  })
})

describe("WorkspaceController same-content observations", () => {
  it("does not reset or advance the epoch when only the title changes", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const epochAfterInitial = controller.captureEpoch()

    const transition = observe(controller, context({ title: "Renamed video" }))

    expect(transition.kind).toBe("same-content")
    expect(transition.shouldReset).toBe(false)
    expect(transition.previousContentKey).toBe("youtube:video-a")
    expect(transition.currentContentKey).toBe("youtube:video-a")
    expect(controller.captureEpoch()).toBe(epochAfterInitial)
    expect(runtimeContentOf(controller).title).toBe("Renamed video")
  })

  it("does not reset or advance the epoch when only the active tab changes", () => {
    const controller = new WorkspaceController()
    observe(controller, context(), 1)
    const epochAfterInitial = controller.captureEpoch()

    const transition = observe(controller, context(), 2)

    expect(transition.kind).toBe("same-content")
    expect(transition.shouldReset).toBe(false)
    expect(controller.captureEpoch()).toBe(epochAfterInitial)
    expect(runtimeContentOf(controller).activeTabId).toBe(2)
  })

  it("updates author, canonical url, and readiness without advancing the epoch", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const epochAfterInitial = controller.captureEpoch()

    const transition = observe(controller, context({
      author: "Another author",
      canonicalUrl: "https://www.youtube.com/watch?v=video-a&list=xyz",
      isReady: false,
    }))

    expect(transition.kind).toBe("same-content")
    expect(transition.shouldReset).toBe(false)
    expect(controller.captureEpoch()).toBe(epochAfterInitial)

    const content = runtimeContentOf(controller)
    expect(content.author).toBe("Another author")
    expect(content.canonicalUrl).toBe("https://www.youtube.com/watch?v=video-a&list=xyz")
    expect(content.isReady).toBe(false)
  })

  it("ignores playback timestamp changes because they are outside the projection", () => {
    const controller = new WorkspaceController()
    observe(controller, context({ timestampSeconds: 0 }))
    const epochAfterInitial = controller.captureEpoch()

    const transition = observe(controller, context({ timestampSeconds: 512 }))

    expect(transition.kind).toBe("same-content")
    expect(transition.shouldReset).toBe(false)
    expect(controller.captureEpoch()).toBe(epochAfterInitial)
    expect("timestampSeconds" in runtimeContentOf(controller)).toBe(false)
  })
})

describe("WorkspaceController identity transitions", () => {
  it("advances the epoch once for YouTube A -> B", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const epochAfterInitial = controller.captureEpoch()

    const transition = observe(controller, context({
      videoId: "video-b",
      contentKey: "youtube:video-b",
      url: "https://www.youtube.com/watch?v=video-b",
      canonicalUrl: "https://www.youtube.com/watch?v=video-b",
      title: "Video B",
    }))

    expect(transition.kind).toBe("identity-changed")
    expect(transition.shouldReset).toBe(true)
    expect(transition.previousContentKey).toBe("youtube:video-a")
    expect(transition.currentContentKey).toBe("youtube:video-b")
    expect(controller.captureEpoch()).toBe(epochAfterInitial + 1)
  })

  it("treats distinct Bilibili parts as distinct identities", () => {
    const controller = new WorkspaceController()
    observe(controller, context({
      platform: "bilibili",
      videoId: "BV-test",
      partId: "1",
      contentKey: "bilibili:BV-test:p:1",
    }))
    const epochAfterInitial = controller.captureEpoch()

    const transition = observe(controller, context({
      platform: "bilibili",
      videoId: "BV-test",
      partId: "2",
      contentKey: "bilibili:BV-test:p:2",
    }))

    expect(transition.kind).toBe("identity-changed")
    expect(transition.shouldReset).toBe(true)
    expect(transition.previousContentKey).toBe("bilibili:BV-test:p:1")
    expect(transition.currentContentKey).toBe("bilibili:BV-test:p:2")
    expect(controller.captureEpoch()).toBe(epochAfterInitial + 1)
    expect(runtimeContentOf(controller).identity).toEqual({
      platform: "bilibili",
      videoId: "BV-test",
      partId: "2",
      contentKey: "bilibili:BV-test:p:2",
    })
  })

  it("advances the epoch for a supported video -> null", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const epochAfterInitial = controller.captureEpoch()

    const transition = observe(controller, EMPTY_CONTEXT, null)

    expect(transition.kind).toBe("identity-changed")
    expect(transition.shouldReset).toBe(true)
    expect(transition.previousContentKey).toBe("youtube:video-a")
    expect(transition.currentContentKey).toBeNull()
    expect(controller.captureEpoch()).toBe(epochAfterInitial + 1)
  })

  it("advances the epoch for null -> supported video after initialization", () => {
    const controller = new WorkspaceController()
    observe(controller, EMPTY_CONTEXT, null)
    const epochAfterInitial = controller.captureEpoch()

    const transition = observe(controller, context())

    expect(transition.kind).toBe("identity-changed")
    expect(transition.shouldReset).toBe(true)
    expect(transition.previousContentKey).toBeNull()
    expect(transition.currentContentKey).toBe("youtube:video-a")
    expect(controller.captureEpoch()).toBe(epochAfterInitial + 1)
  })

  it("follows the raw contentKey when the identity cannot be constructed", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const epochAfterInitial = controller.captureEpoch()

    const transition = observe(controller, context({
      platform: null,
      videoId: null,
      contentKey: "youtube:video-orphan",
    }))

    expect(transition.kind).toBe("identity-changed")
    expect(transition.shouldReset).toBe(true)
    expect(transition.currentContentKey).toBe("youtube:video-orphan")
    expect(controller.captureEpoch()).toBe(epochAfterInitial + 1)

    const content = runtimeContentOf(controller)
    expect(content.contentKey).toBe("youtube:video-orphan")
    expect(content.identity).toBeNull()
  })
})

describe("WorkspaceController epoch guards", () => {
  it("keeps a captured epoch current until an identity transition", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    expect(controller.isEpochCurrent(captured)).toBe(true)

    observe(controller, context({ title: "Same content rename" }))
    expect(controller.isEpochCurrent(captured)).toBe(true)

    observe(controller, context({ videoId: "video-b", contentKey: "youtube:video-b" }))
    expect(controller.isEpochCurrent(captured)).toBe(false)
    expect(controller.captureEpoch()).toBe(captured + 1)
  })

  it("reports an unknown epoch as stale", () => {
    const controller = new WorkspaceController()
    observe(controller, context())

    expect(controller.isEpochCurrent(controller.captureEpoch())).toBe(true)
    expect(controller.isEpochCurrent(0)).toBe(false)
    expect(controller.isEpochCurrent(-1)).toBe(false)
  })
})

describe("WorkspaceController snapshot isolation", () => {
  it("returns a defensive copy that cannot mutate controller state", () => {
    const controller = new WorkspaceController()
    observe(controller, context())

    const snapshot = controller.getSnapshot()
    snapshot.runtimeContent.title = "Mutated"
    snapshot.runtimeContent.contentKey = "youtube:mutated"
    snapshot.workspaceEpoch = 99

    expect(controller.getSnapshot().runtimeContent.title).toBe("Video A")
    expect(controller.getSnapshot().runtimeContent.contentKey).toBe("youtube:video-a")
    expect(controller.captureEpoch()).toBe(1)
  })

  it("does not expose a subscribe API before Stage 6 publication migration", () => {
    const controller = new WorkspaceController()

    expect("subscribe" in controller).toBe(false)
  })
})

type QaRestoreInput = {
  contentKey: string
  analysisRunId: string | null
  transcriptFingerprint: string | null
}

type EffectsRecorder = {
  effects: WorkspaceHistoryPublicationEffects
  order: string[]
  publishTranscript: WorkspaceHistoryTranscriptPublication[]
  clearTranscriptError: number
  clearAnalysis: number
  setAnalysisIdle: number
  publishAnalysis: HistoryAnalysisSnapshot[]
  setAnalysisCompleted: number
  clearAskWorkspace: number
  restoreQaConversation: QaRestoreInput[]
}

function createEffectsRecorder(): EffectsRecorder {
  const recorder: EffectsRecorder = {
    effects: {
      publishTranscript: (publication) => {
        recorder.order.push("publishTranscript")
        recorder.publishTranscript.push(publication)
      },
      clearTranscriptError: () => {
        recorder.order.push("clearTranscriptError")
        recorder.clearTranscriptError += 1
      },
      clearAnalysis: () => {
        recorder.order.push("clearAnalysis")
        recorder.clearAnalysis += 1
      },
      setAnalysisIdle: () => {
        recorder.order.push("setAnalysisIdle")
        recorder.setAnalysisIdle += 1
      },
      publishAnalysis: (analysis) => {
        recorder.order.push("publishAnalysis")
        recorder.publishAnalysis.push(analysis)
      },
      setAnalysisCompleted: () => {
        recorder.order.push("setAnalysisCompleted")
        recorder.setAnalysisCompleted += 1
      },
      clearAskWorkspace: () => {
        recorder.order.push("clearAskWorkspace")
        recorder.clearAskWorkspace += 1
      },
      restoreQaConversation: async (input) => {
        recorder.order.push("restoreQaConversation")
        recorder.restoreQaConversation.push(input)
      },
    },
    order: [],
    publishTranscript: [],
    clearTranscriptError: 0,
    clearAnalysis: 0,
    setAnalysisIdle: 0,
    publishAnalysis: [],
    setAnalysisCompleted: 0,
    clearAskWorkspace: 0,
    restoreQaConversation: [],
  }
  return recorder
}

function transcriptSnapshot(
  overrides: Partial<HistoryTranscriptSnapshot> = {},
): HistoryTranscriptSnapshot {
  return {
    exists: true,
    cues: [
      { startSec: 0, endSec: 12, text: "intro" },
      { startSec: 12, endSec: 30, text: "body" },
    ],
    identity: {
      platform: "youtube",
      videoId: "video-a",
      partId: undefined,
      contentKey: "youtube:video-a",
    },
    title: "Historical title",
    fingerprint: "fp-transcript",
    rawVtt: "WEBVTT\n",
    ...overrides,
  }
}

function analysisSnapshot(
  overrides: Partial<HistoryAnalysisSnapshot> = {},
): HistoryAnalysisSnapshot {
  return {
    platform: "youtube",
    videoId: "video-a",
    partId: null,
    contentKey: "youtube:video-a",
    title: "Historical title",
    analysis: {
      summary: "Summary",
      keyPoints: [{ text: "point" }],
      chapters: [{
        title: "Chapter",
        startSec: 0,
        endSec: 30,
        summary: "Chapter summary",
        detail: "Chapter detail",
      }],
    },
    analysisRunId: "run-1",
    transcriptFingerprint: "fp-analysis",
    providerProfileId: "profile-1",
    providerBaseUrl: "https://api.example.com/v1",
    providerModel: "model-1",
    analysisSchemaVersion: 1,
    analysisPromptVersion: "video-analysis-v1",
    lastAnalyzedAt: "2026-10-20T00:00:00.000Z",
    errorMessage: null,
    ...overrides,
  }
}

function restoreSnapshot({
  analysis = null,
  transcript = transcriptSnapshot(),
}: {
  analysis?: HistoryAnalysisSnapshot | null
  transcript?: HistoryTranscriptSnapshot
} = {}): HistoryRestoreSnapshot {
  return {
    sourceIdentity: {
      platform: "youtube",
      videoId: "video-a",
      partId: undefined,
      contentKey: "youtube:video-a",
    },
    transcript,
    analysis,
  }
}

describe("WorkspaceController publishHistoryRestore stale decisions", () => {
  it("returns stale with zero effects when the captured workspace epoch is no longer current", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const staleEpoch = controller.captureEpoch()

    observe(controller, context({ videoId: "video-b", contentKey: "youtube:video-b" }))
    expect(controller.isEpochCurrent(staleEpoch)).toBe(false)

    const recorder = createEffectsRecorder()
    const result = await controller.publishHistoryRestore({
      mode: "legacy-video",
      snapshot: restoreSnapshot({ analysis: analysisSnapshot() }),
      workspaceEpoch: staleEpoch,
      isRequestCurrent: () => true,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "stale" })
    expect(recorder.order).toEqual([])
  })

  it("returns stale with zero effects when the request generation is no longer current", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const recorder = createEffectsRecorder()

    const result = await controller.publishHistoryRestore({
      mode: "saved-run",
      snapshot: restoreSnapshot({ analysis: analysisSnapshot() }),
      workspaceEpoch: controller.captureEpoch(),
      isRequestCurrent: () => false,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "stale" })
    expect(recorder.order).toEqual([])
  })

  it("does not treat a historical contentKey that differs from runtime content as stale", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const recorder = createEffectsRecorder()

    const historical = restoreSnapshot({
      analysis: analysisSnapshot({ contentKey: "bilibili:other-video", analysisRunId: "run-9" }),
      transcript: transcriptSnapshot({ fingerprint: "fp-other" }),
    })

    const result = await controller.publishHistoryRestore({
      mode: "saved-run",
      snapshot: historical,
      workspaceEpoch: controller.captureEpoch(),
      isRequestCurrent: () => true,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "published", analysisPublished: true })
    expect(recorder.restoreQaConversation).toEqual([{
      contentKey: "bilibili:other-video",
      analysisRunId: "run-9",
      transcriptFingerprint: "fp-other",
    }])
    expect(runtimeContentOf(controller).contentKey).toBe("youtube:video-a")
  })

  it("never mutates runtime content while publishing a historical restore", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const before = runtimeContentOf(controller)

    const recorder = createEffectsRecorder()
    await controller.publishHistoryRestore({
      mode: "current-context",
      snapshot: restoreSnapshot({ analysis: analysisSnapshot() }),
      workspaceEpoch: controller.captureEpoch(),
      isRequestCurrent: () => true,
      effects: recorder.effects,
    })

    expect(runtimeContentOf(controller)).toEqual(before)
  })
})

describe("WorkspaceController publishHistoryRestore no-analysis publication", () => {
  it("publishes the legacy-video no-analysis reset sequence in order", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const recorder = createEffectsRecorder()

    const result = await controller.publishHistoryRestore({
      mode: "legacy-video",
      snapshot: restoreSnapshot({ analysis: null }),
      workspaceEpoch: controller.captureEpoch(),
      isRequestCurrent: () => true,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "published", analysisPublished: false })
    expect(recorder.order).toEqual([
      "publishTranscript",
      "clearTranscriptError",
      "clearAnalysis",
      "setAnalysisIdle",
      "clearAskWorkspace",
    ])
    expect(recorder.publishAnalysis).toEqual([])
    expect(recorder.setAnalysisCompleted).toBe(0)
    expect(recorder.restoreQaConversation).toEqual([])
  })

  it("publishes the current-context no-analysis reset sequence without clearing the transcript error", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const recorder = createEffectsRecorder()

    const result = await controller.publishHistoryRestore({
      mode: "current-context",
      snapshot: restoreSnapshot({ analysis: null }),
      workspaceEpoch: controller.captureEpoch(),
      isRequestCurrent: () => true,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "published", analysisPublished: false })
    expect(recorder.order).toEqual([
      "publishTranscript",
      "clearAnalysis",
      "setAnalysisIdle",
      "clearAskWorkspace",
    ])
    expect(recorder.clearTranscriptError).toBe(0)
  })
})

describe("WorkspaceController publishHistoryRestore analysis publication", () => {
  it("publishes the legacy-video analysis sequence in order", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const recorder = createEffectsRecorder()

    const result = await controller.publishHistoryRestore({
      mode: "legacy-video",
      snapshot: restoreSnapshot({ analysis: analysisSnapshot() }),
      workspaceEpoch: controller.captureEpoch(),
      isRequestCurrent: () => true,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "published", analysisPublished: true })
    expect(recorder.order).toEqual([
      "publishTranscript",
      "clearTranscriptError",
      "publishAnalysis",
      "setAnalysisCompleted",
      "restoreQaConversation",
    ])
  })

  it("publishes the current-context analysis sequence without clearing the transcript error", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const recorder = createEffectsRecorder()

    const result = await controller.publishHistoryRestore({
      mode: "current-context",
      snapshot: restoreSnapshot({ analysis: analysisSnapshot() }),
      workspaceEpoch: controller.captureEpoch(),
      isRequestCurrent: () => true,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "published", analysisPublished: true })
    expect(recorder.order).toEqual([
      "publishTranscript",
      "publishAnalysis",
      "setAnalysisCompleted",
      "restoreQaConversation",
    ])
    expect(recorder.clearTranscriptError).toBe(0)
  })

  it("publishes the saved-run analysis sequence in order", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const recorder = createEffectsRecorder()

    const result = await controller.publishHistoryRestore({
      mode: "saved-run",
      snapshot: restoreSnapshot({ analysis: analysisSnapshot() }),
      workspaceEpoch: controller.captureEpoch(),
      isRequestCurrent: () => true,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "published", analysisPublished: true })
    expect(recorder.order).toEqual([
      "publishTranscript",
      "clearTranscriptError",
      "publishAnalysis",
      "setAnalysisCompleted",
      "restoreQaConversation",
    ])
  })
})

describe("WorkspaceController publishHistoryRestore publication payloads", () => {
  it("projects the transcript publication payload without normalization", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const recorder = createEffectsRecorder()
    const transcript = transcriptSnapshot({
      cues: [
        { startSec: 30, endSec: 40, text: "  second  " },
        { startSec: 0, endSec: 5, text: "first" },
      ],
      title: "  Raw title  ",
      fingerprint: null,
      rawVtt: null,
      identity: null,
    })

    await controller.publishHistoryRestore({
      mode: "legacy-video",
      snapshot: restoreSnapshot({ transcript }),
      workspaceEpoch: controller.captureEpoch(),
      isRequestCurrent: () => true,
      effects: recorder.effects,
    })

    const publication = recorder.publishTranscript[0]!
    expect(publication.cues).toBe(transcript.cues)
    expect(publication.identity).toBeNull()
    expect(publication.title).toBe("  Raw title  ")
    expect(publication.fingerprint).toBeNull()
    expect(publication.rawVtt).toBeNull()
  })

  it("uses the analysis identity and transcript fingerprint for the QA restore", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const recorder = createEffectsRecorder()

    await controller.publishHistoryRestore({
      mode: "saved-run",
      snapshot: restoreSnapshot({
        analysis: analysisSnapshot({
          contentKey: "youtube:analysis-content-key",
          analysisRunId: "run-analysis",
        }),
        transcript: transcriptSnapshot({ fingerprint: "fp-transcript-authoritative" }),
      }),
      workspaceEpoch: controller.captureEpoch(),
      isRequestCurrent: () => true,
      effects: recorder.effects,
    })

    expect(recorder.restoreQaConversation).toEqual([{
      contentKey: "youtube:analysis-content-key",
      analysisRunId: "run-analysis",
      transcriptFingerprint: "fp-transcript-authoritative",
    }])
  })

  it("passes the HistoryController analysis object through without cloning or transforming", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const recorder = createEffectsRecorder()
    const analysis = analysisSnapshot()

    await controller.publishHistoryRestore({
      mode: "saved-run",
      snapshot: restoreSnapshot({ analysis }),
      workspaceEpoch: controller.captureEpoch(),
      isRequestCurrent: () => true,
      effects: recorder.effects,
    })

    expect(recorder.publishAnalysis).toHaveLength(1)
    expect(recorder.publishAnalysis[0]).toBe(analysis)
    expect(recorder.publishAnalysis[0]!.analysis).toBe(analysis.analysis)
  })
})

describe("WorkspaceController publishHistoryRestore failure and timing semantics", () => {
  it("propagates a restoreQaConversation rejection after the prior effects ran", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const recorder = createEffectsRecorder()
    const failure = new Error("QA restore failed")
    const failingEffects: WorkspaceHistoryPublicationEffects = {
      ...recorder.effects,
      restoreQaConversation: async (input) => {
        recorder.order.push("restoreQaConversation")
        recorder.restoreQaConversation.push(input)
        throw failure
      },
    }

    await expect(controller.publishHistoryRestore({
      mode: "saved-run",
      snapshot: restoreSnapshot({ analysis: analysisSnapshot() }),
      workspaceEpoch: controller.captureEpoch(),
      isRequestCurrent: () => true,
      effects: failingEffects,
    })).rejects.toBe(failure)

    expect(recorder.order).toEqual([
      "publishTranscript",
      "clearTranscriptError",
      "publishAnalysis",
      "setAnalysisCompleted",
      "restoreQaConversation",
    ])
  })

  it("checks the request currentness predicate exactly once at the publication boundary", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const recorder = createEffectsRecorder()
    let requestChecks = 0

    await controller.publishHistoryRestore({
      mode: "legacy-video",
      snapshot: restoreSnapshot({ analysis: analysisSnapshot() }),
      workspaceEpoch: controller.captureEpoch(),
      isRequestCurrent: () => {
        requestChecks += 1
        return true
      },
      effects: recorder.effects,
    })

    expect(requestChecks).toBe(1)
    expect(recorder.order).toEqual([
      "publishTranscript",
      "clearTranscriptError",
      "publishAnalysis",
      "setAnalysisCompleted",
      "restoreQaConversation",
    ])
  })

  it("does not re-check stale conditions once publication has started", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const recorder = createEffectsRecorder()
    let requestChecks = 0
    const effects: WorkspaceHistoryPublicationEffects = {
      ...recorder.effects,
      publishTranscript: (publication) => {
        recorder.order.push("publishTranscript")
        recorder.publishTranscript.push(publication)
        // Invalidate both guards from inside the first publication effect.
        observe(controller, context({ videoId: "video-b", contentKey: "youtube:video-b" }))
      },
    }

    const result = await controller.publishHistoryRestore({
      mode: "legacy-video",
      snapshot: restoreSnapshot({ analysis: analysisSnapshot() }),
      workspaceEpoch: controller.captureEpoch(),
      isRequestCurrent: () => {
        requestChecks += 1
        return true
      },
      effects,
    })

    expect(result).toEqual({ kind: "published", analysisPublished: true })
    expect(requestChecks).toBe(1)
    expect(recorder.order).toEqual([
      "publishTranscript",
      "clearTranscriptError",
      "publishAnalysis",
      "setAnalysisCompleted",
      "restoreQaConversation",
    ])
  })

  it("keeps a captured epoch current across a same-content metadata refresh", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    observe(controller, context({ title: "Renamed video" }))
    expect(controller.isEpochCurrent(captured)).toBe(true)

    const recorder = createEffectsRecorder()
    const result = await controller.publishHistoryRestore({
      mode: "current-context",
      snapshot: restoreSnapshot({ analysis: analysisSnapshot() }),
      workspaceEpoch: captured,
      isRequestCurrent: () => true,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "published", analysisPublished: true })
    expect(recorder.order).toEqual([
      "publishTranscript",
      "publishAnalysis",
      "setAnalysisCompleted",
      "restoreQaConversation",
    ])
  })

  it("blocks every publication effect once a runtime contentKey transition makes the captured epoch stale", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    observe(controller, context({ videoId: "video-b", contentKey: "youtube:video-b" }))

    const recorder = createEffectsRecorder()
    const result = await controller.publishHistoryRestore({
      mode: "saved-run",
      snapshot: restoreSnapshot({ analysis: analysisSnapshot() }),
      workspaceEpoch: captured,
      isRequestCurrent: () => true,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "stale" })
    expect(recorder.order).toEqual([])
    expect(recorder.publishTranscript).toEqual([])
    expect(recorder.restoreQaConversation).toEqual([])
  })
})
