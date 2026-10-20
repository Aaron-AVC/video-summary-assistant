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
  type WorkspaceAnalysisCancelledPublicationEffects,
  type WorkspaceAnalysisErrorPublicationEffects,
  type WorkspaceAnalysisResultPublicationEffects,
  type WorkspaceAnalysisTranscriptPublicationEffects,
  type WorkspaceAskCurrentIdentity,
  type WorkspaceAskPublicationEffects,
  type WorkspaceAskRequestedIdentity,
  type WorkspaceHistoryPublicationEffects,
  type WorkspaceHistoryTranscriptPublication,
  type WorkspaceRuntimeResetEffects,
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
// --- Task 6C: Ask result workspace publication -------------------------------

type AskEffectsRecorder = {
  effects: WorkspaceAskPublicationEffects
  order: string[]
  publishAssistantMessage: number
  publishAnswer: number
}

function createAskEffectsRecorder(): AskEffectsRecorder {
  const recorder: AskEffectsRecorder = {
    effects: {
      publishAssistantMessage: () => {
        recorder.order.push("publishAssistantMessage")
        recorder.publishAssistantMessage += 1
      },
      publishAnswer: () => {
        recorder.order.push("publishAnswer")
        recorder.publishAnswer += 1
      },
    },
    order: [],
    publishAssistantMessage: 0,
    publishAnswer: 0,
  }
  return recorder
}

const ASK_REQUESTED: WorkspaceAskRequestedIdentity = {
  contentKey: "youtube:video-a",
  analysisRunId: "run-1",
  threadId: "thread-1",
  transcriptFingerprint: "fp-transcript",
}

function askRequested(
  overrides: Partial<WorkspaceAskRequestedIdentity> = {},
): WorkspaceAskRequestedIdentity {
  return { ...ASK_REQUESTED, ...overrides }
}

function askCurrent(
  overrides: Partial<WorkspaceAskCurrentIdentity> = {},
): WorkspaceAskCurrentIdentity {
  return { ...ASK_REQUESTED, ...overrides }
}

describe("WorkspaceController publishAskResult publication", () => {
  it("publishes a matching identity in the assistant-message then answer order", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    const recorder = createAskEffectsRecorder()
    const result = controller.publishAskResult({
      workspaceEpoch: captured,
      requested: askRequested(),
      current: askCurrent(),
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "published" })
    expect(recorder.order).toEqual(["publishAssistantMessage", "publishAnswer"])
    expect(recorder.publishAssistantMessage).toBe(1)
    expect(recorder.publishAnswer).toBe(1)
  })

  it("returns stale with zero effects when the captured workspace epoch is no longer current", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    observe(controller, context({ videoId: "video-b", contentKey: "youtube:video-b" }))

    const recorder = createAskEffectsRecorder()
    const result = controller.publishAskResult({
      workspaceEpoch: captured,
      requested: askRequested(),
      current: askCurrent(),
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "stale" })
    expect(recorder.order).toEqual([])
  })

  it("returns stale with zero effects when the Ask contentKey no longer matches", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    const recorder = createAskEffectsRecorder()
    const result = controller.publishAskResult({
      workspaceEpoch: captured,
      requested: askRequested({ contentKey: "youtube:video-a" }),
      current: askCurrent({ contentKey: "youtube:video-b" }),
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "stale" })
    expect(recorder.order).toEqual([])
  })

  it("returns stale with zero effects when the analysisRunId no longer matches", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    const recorder = createAskEffectsRecorder()
    const result = controller.publishAskResult({
      workspaceEpoch: captured,
      requested: askRequested({ analysisRunId: "run-1" }),
      current: askCurrent({ analysisRunId: "run-2" }),
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "stale" })
    expect(recorder.order).toEqual([])
  })

  it("returns stale with zero effects when the threadId no longer matches", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    const recorder = createAskEffectsRecorder()
    const result = controller.publishAskResult({
      workspaceEpoch: captured,
      requested: askRequested({ threadId: "thread-1" }),
      current: askCurrent({ threadId: "thread-2" }),
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "stale" })
    expect(recorder.order).toEqual([])
  })

  it("returns stale with zero effects when the threadId became null", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    const recorder = createAskEffectsRecorder()
    const result = controller.publishAskResult({
      workspaceEpoch: captured,
      requested: askRequested({ threadId: "thread-1" }),
      current: askCurrent({ threadId: null }),
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "stale" })
    expect(recorder.order).toEqual([])
  })

  it("returns stale with zero effects when the transcriptFingerprint no longer matches", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    const recorder = createAskEffectsRecorder()
    const result = controller.publishAskResult({
      workspaceEpoch: captured,
      requested: askRequested({ transcriptFingerprint: "fp-transcript" }),
      current: askCurrent({ transcriptFingerprint: "fp-other" }),
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "stale" })
    expect(recorder.order).toEqual([])
  })

  it("returns stale with zero effects when the transcriptFingerprint became null", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    const recorder = createAskEffectsRecorder()
    const result = controller.publishAskResult({
      workspaceEpoch: captured,
      requested: askRequested({ transcriptFingerprint: "fp-transcript" }),
      current: askCurrent({ transcriptFingerprint: null }),
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "stale" })
    expect(recorder.order).toEqual([])
  })
})

describe("WorkspaceController publishAskResult workspace semantics", () => {
  it("publishes into a historical display selection that differs from the runtime content", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    const historical = {
      contentKey: "bilibili:historical-video:p:2",
      analysisRunId: "run-historical",
      threadId: "thread-historical",
      transcriptFingerprint: "fp-historical",
    }

    const recorder = createAskEffectsRecorder()
    const result = controller.publishAskResult({
      workspaceEpoch: captured,
      requested: historical,
      current: historical,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "published" })
    expect(recorder.order).toEqual(["publishAssistantMessage", "publishAnswer"])
  })

  it("returns stale when a runtime contentKey transition invalidates the captured epoch even though the Ask identity still matches", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    observe(controller, context({
      platform: "bilibili",
      videoId: "other-video",
      partId: "2",
      contentKey: "bilibili:other-video:p:2",
      title: "Other video",
    }))

    const recorder = createAskEffectsRecorder()
    const result = controller.publishAskResult({
      workspaceEpoch: captured,
      requested: askRequested(),
      current: askCurrent(),
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "stale" })
    expect(recorder.order).toEqual([])
  })

  it("keeps publishing across a same-content metadata refresh", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    observe(controller, context({
      title: "Renamed video",
      author: "Another author",
      canonicalUrl: "https://www.youtube.com/watch?v=video-a&t=5",
      isReady: false,
    }))

    const recorder = createAskEffectsRecorder()
    const result = controller.publishAskResult({
      workspaceEpoch: captured,
      requested: askRequested(),
      current: askCurrent(),
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "published" })
    expect(recorder.order).toEqual(["publishAssistantMessage", "publishAnswer"])
  })

  it("does not re-check the epoch or the identity once publication has started", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    const order: string[] = []
    const result = controller.publishAskResult({
      workspaceEpoch: captured,
      requested: askRequested(),
      current: askCurrent(),
      effects: {
        publishAssistantMessage: () => {
          order.push("publishAssistantMessage")
          observe(controller, context({ videoId: "video-b", contentKey: "youtube:video-b" }))
        },
        publishAnswer: () => {
          order.push("publishAnswer")
        },
      },
    })

    expect(result).toEqual({ kind: "published" })
    expect(order).toEqual(["publishAssistantMessage", "publishAnswer"])
    expect(controller.isEpochCurrent(captured)).toBe(false)
  })

  it("never mutates runtime content while publishing an Ask result", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()
    const before = controller.getSnapshot()

    controller.publishAskResult({
      workspaceEpoch: captured,
      requested: askRequested(),
      current: askCurrent(),
      effects: createAskEffectsRecorder().effects,
    })

    expect(controller.getSnapshot()).toEqual(before)
  })

  it("never mutates runtime content when the Ask result is stale", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()
    const before = controller.getSnapshot()

    controller.publishAskResult({
      workspaceEpoch: captured,
      requested: askRequested({ contentKey: "bilibili:historical-video:p:2" }),
      current: askCurrent({ contentKey: "bilibili:historical-video:p:2" }),
      effects: createAskEffectsRecorder().effects,
    })

    expect(controller.getSnapshot()).toEqual(before)
  })
})
// --- Task 6D: Analysis workspace publication --------------------------------

type AnalysisTranscriptRecorder = {
  effects: WorkspaceAnalysisTranscriptPublicationEffects
  publishTranscript: number
}

function createAnalysisTranscriptRecorder(
  onPublish: () => void = () => {},
): AnalysisTranscriptRecorder {
  const recorder: AnalysisTranscriptRecorder = {
    effects: {
      publishTranscript: () => {
        recorder.publishTranscript += 1
        onPublish()
      },
    },
    publishTranscript: 0,
  }
  return recorder
}

type AnalysisResultRecorder = {
  effects: WorkspaceAnalysisResultPublicationEffects
  order: string[]
  publishAnalysis: number
  setAnalysisCompleted: number
  restoreQaConversation: number
}

function createAnalysisResultRecorder({
  onPublishAnalysis = () => {},
  restoreQaConversation = async () => {},
}: {
  onPublishAnalysis?: () => void
  restoreQaConversation?: () => Promise<void>
} = {}): AnalysisResultRecorder {
  const recorder: AnalysisResultRecorder = {
    effects: {
      publishAnalysis: () => {
        recorder.order.push("publishAnalysis")
        recorder.publishAnalysis += 1
        onPublishAnalysis()
      },
      setAnalysisCompleted: () => {
        recorder.order.push("setAnalysisCompleted")
        recorder.setAnalysisCompleted += 1
      },
      restoreQaConversation: async () => {
        recorder.order.push("restoreQaConversation")
        recorder.restoreQaConversation += 1
        await restoreQaConversation()
      },
    },
    order: [],
    publishAnalysis: 0,
    setAnalysisCompleted: 0,
    restoreQaConversation: 0,
  }
  return recorder
}

type AnalysisCancelledRecorder = {
  effects: WorkspaceAnalysisCancelledPublicationEffects
  order: string[]
}

function createAnalysisCancelledRecorder(
  onClearAnalysisError: () => void = () => {},
): AnalysisCancelledRecorder {
  const recorder: AnalysisCancelledRecorder = {
    effects: {
      clearAnalysisError: () => {
        recorder.order.push("clearAnalysisError")
        onClearAnalysisError()
      },
      setAnalysisCancelled: () => {
        recorder.order.push("setAnalysisCancelled")
      },
    },
    order: [],
  }
  return recorder
}

type AnalysisErrorRecorder = {
  effects: WorkspaceAnalysisErrorPublicationEffects
  order: string[]
}

function createAnalysisErrorRecorder(
  onPublishAnalysisError: () => void = () => {},
): AnalysisErrorRecorder {
  const recorder: AnalysisErrorRecorder = {
    effects: {
      publishAnalysisError: () => {
        recorder.order.push("publishAnalysisError")
        onPublishAnalysisError()
      },
      setAnalysisErrorPhase: () => {
        recorder.order.push("setAnalysisErrorPhase")
      },
      markDisplayedAnalysisError: () => {
        recorder.order.push("markDisplayedAnalysisError")
      },
    },
    order: [],
  }
  return recorder
}

const TASK_CONTENT_KEY = "youtube:video-a"

describe("WorkspaceController publishAnalysisTranscript", () => {
  it("publishes the task transcript exactly once when the target is current", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    const recorder = createAnalysisTranscriptRecorder()
    const result = controller.publishAnalysisTranscript({
      workspaceEpoch: captured,
      taskContentKey: TASK_CONTENT_KEY,
      currentContentKey: TASK_CONTENT_KEY,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "published" })
    expect(recorder.publishTranscript).toBe(1)
  })

  it("returns stale with zero effects when the captured workspace epoch is no longer current", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    observe(controller, context({ videoId: "video-b", contentKey: "youtube:video-b" }))

    const recorder = createAnalysisTranscriptRecorder()
    const result = controller.publishAnalysisTranscript({
      workspaceEpoch: captured,
      taskContentKey: TASK_CONTENT_KEY,
      currentContentKey: TASK_CONTENT_KEY,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "stale" })
    expect(recorder.publishTranscript).toBe(0)
  })

  it("returns stale with zero effects when the current content no longer matches the task", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    const recorder = createAnalysisTranscriptRecorder()
    const result = controller.publishAnalysisTranscript({
      workspaceEpoch: captured,
      taskContentKey: TASK_CONTENT_KEY,
      currentContentKey: "youtube:video-b",
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "stale" })
    expect(recorder.publishTranscript).toBe(0)
  })

  it("returns stale without re-checking once the transcript effect has run", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    const recorder = createAnalysisTranscriptRecorder(() => {
      observe(controller, context({ videoId: "video-b", contentKey: "youtube:video-b" }))
    })
    const result = controller.publishAnalysisTranscript({
      workspaceEpoch: captured,
      taskContentKey: TASK_CONTENT_KEY,
      currentContentKey: TASK_CONTENT_KEY,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "published" })
    expect(recorder.publishTranscript).toBe(1)
    expect(controller.isEpochCurrent(captured)).toBe(false)
  })
})

describe("WorkspaceController publishAnalysisResult", () => {
  it("publishes the analysis result in the analysis-completed-QA order", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    const recorder = createAnalysisResultRecorder()
    const result = await controller.publishAnalysisResult({
      workspaceEpoch: captured,
      taskContentKey: TASK_CONTENT_KEY,
      currentContentKey: TASK_CONTENT_KEY,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "published" })
    expect(recorder.order).toEqual([
      "publishAnalysis",
      "setAnalysisCompleted",
      "restoreQaConversation",
    ])
  })

  it("returns stale with zero effects when the captured workspace epoch is no longer current", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    observe(controller, context({ videoId: "video-b", contentKey: "youtube:video-b" }))

    const recorder = createAnalysisResultRecorder()
    const result = await controller.publishAnalysisResult({
      workspaceEpoch: captured,
      taskContentKey: TASK_CONTENT_KEY,
      currentContentKey: TASK_CONTENT_KEY,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "stale" })
    expect(recorder.order).toEqual([])
  })

  it("returns stale with zero effects when the current content no longer matches the task", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    const recorder = createAnalysisResultRecorder()
    const result = await controller.publishAnalysisResult({
      workspaceEpoch: captured,
      taskContentKey: TASK_CONTENT_KEY,
      currentContentKey: "bilibili:other-video:p:2",
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "stale" })
    expect(recorder.order).toEqual([])
  })

  it("propagates the restoreQaConversation rejection unchanged after the earlier effects ran", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    const failure = new Error("qa restore failed")
    const recorder = createAnalysisResultRecorder({
      restoreQaConversation: async () => {
        throw failure
      },
    })

    let caught: unknown = null
    try {
      await controller.publishAnalysisResult({
        workspaceEpoch: captured,
        taskContentKey: TASK_CONTENT_KEY,
        currentContentKey: TASK_CONTENT_KEY,
        effects: recorder.effects,
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBe(failure)
    expect(recorder.publishAnalysis).toBe(1)
    expect(recorder.setAnalysisCompleted).toBe(1)
    expect(recorder.restoreQaConversation).toBe(1)
  })

  it("uses one policy for the cache-hit and fresh-completion callers", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    const cachedRecorder = createAnalysisResultRecorder()
    const freshRecorder = createAnalysisResultRecorder()

    const cachedResult = await controller.publishAnalysisResult({
      workspaceEpoch: captured,
      taskContentKey: TASK_CONTENT_KEY,
      currentContentKey: TASK_CONTENT_KEY,
      effects: cachedRecorder.effects,
    })
    const freshResult = await controller.publishAnalysisResult({
      workspaceEpoch: captured,
      taskContentKey: TASK_CONTENT_KEY,
      currentContentKey: TASK_CONTENT_KEY,
      effects: freshRecorder.effects,
    })

    expect(cachedResult).toEqual({ kind: "published" })
    expect(freshResult).toEqual({ kind: "published" })
    expect(cachedRecorder.order).toEqual(freshRecorder.order)
    expect(typeof controller.publishAnalysisResult).toBe("function")
    expect((controller as unknown as Record<string, unknown>).publishCachedAnalysis).toBeUndefined()
    expect((controller as unknown as Record<string, unknown>).publishFreshAnalysis).toBeUndefined()
  })

  it("does not re-check eligibility once the first publication effect has run", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    const recorder = createAnalysisResultRecorder({
      onPublishAnalysis: () => {
        observe(controller, context({ videoId: "video-b", contentKey: "youtube:video-b" }))
      },
    })

    const result = await controller.publishAnalysisResult({
      workspaceEpoch: captured,
      taskContentKey: TASK_CONTENT_KEY,
      currentContentKey: TASK_CONTENT_KEY,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "published" })
    expect(recorder.order).toEqual([
      "publishAnalysis",
      "setAnalysisCompleted",
      "restoreQaConversation",
    ])
  })
})

describe("WorkspaceController publishAnalysisCancelled", () => {
  it("publishes the cancelled state in order", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    const recorder = createAnalysisCancelledRecorder()
    const result = controller.publishAnalysisCancelled({
      workspaceEpoch: captured,
      taskContentKey: TASK_CONTENT_KEY,
      currentContentKey: TASK_CONTENT_KEY,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "published" })
    expect(recorder.order).toEqual(["clearAnalysisError", "setAnalysisCancelled"])
  })

  it("returns stale with zero effects when the workspace epoch is stale", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    observe(controller, context({ videoId: "video-b", contentKey: "youtube:video-b" }))

    const recorder = createAnalysisCancelledRecorder()
    const result = controller.publishAnalysisCancelled({
      workspaceEpoch: captured,
      taskContentKey: TASK_CONTENT_KEY,
      currentContentKey: TASK_CONTENT_KEY,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "stale" })
    expect(recorder.order).toEqual([])
  })

  it("does not re-check eligibility once the first cancelled effect has run", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    const recorder = createAnalysisCancelledRecorder(() => {
      observe(controller, context({ videoId: "video-b", contentKey: "youtube:video-b" }))
    })
    const result = controller.publishAnalysisCancelled({
      workspaceEpoch: captured,
      taskContentKey: TASK_CONTENT_KEY,
      currentContentKey: TASK_CONTENT_KEY,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "published" })
    expect(recorder.order).toEqual(["clearAnalysisError", "setAnalysisCancelled"])
  })
})

describe("WorkspaceController publishAnalysisError", () => {
  it("publishes the error state in order", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    const recorder = createAnalysisErrorRecorder()
    const result = controller.publishAnalysisError({
      workspaceEpoch: captured,
      taskContentKey: TASK_CONTENT_KEY,
      currentContentKey: TASK_CONTENT_KEY,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "published" })
    expect(recorder.order).toEqual([
      "publishAnalysisError",
      "setAnalysisErrorPhase",
      "markDisplayedAnalysisError",
    ])
  })

  it("returns stale with zero effects when the workspace epoch is stale", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    observe(controller, context({ videoId: "video-b", contentKey: "youtube:video-b" }))

    const recorder = createAnalysisErrorRecorder()
    const result = controller.publishAnalysisError({
      workspaceEpoch: captured,
      taskContentKey: TASK_CONTENT_KEY,
      currentContentKey: TASK_CONTENT_KEY,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "stale" })
    expect(recorder.order).toEqual([])
  })

  it("does not re-check eligibility once the first error effect has run", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    const recorder = createAnalysisErrorRecorder(() => {
      observe(controller, context({ videoId: "video-b", contentKey: "youtube:video-b" }))
    })
    const result = controller.publishAnalysisError({
      workspaceEpoch: captured,
      taskContentKey: TASK_CONTENT_KEY,
      currentContentKey: TASK_CONTENT_KEY,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "published" })
    expect(recorder.order).toEqual([
      "publishAnalysisError",
      "setAnalysisErrorPhase",
      "markDisplayedAnalysisError",
    ])
  })
})

describe("WorkspaceController analysis publication epoch hardening", () => {
  it("treats an A to B to A round trip as stale even though the current content matches the task again", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    observe(controller, context({ videoId: "video-b", contentKey: "youtube:video-b" }))
    observe(controller, context())

    expect(controller.getSnapshot().runtimeContent.contentKey).toBe(TASK_CONTENT_KEY)
    expect(controller.isEpochCurrent(captured)).toBe(false)

    const transcriptRecorder = createAnalysisTranscriptRecorder()
    expect(controller.publishAnalysisTranscript({
      workspaceEpoch: captured,
      taskContentKey: TASK_CONTENT_KEY,
      currentContentKey: TASK_CONTENT_KEY,
      effects: transcriptRecorder.effects,
    })).toEqual({ kind: "stale" })
    expect(transcriptRecorder.publishTranscript).toBe(0)

    const cancelledRecorder = createAnalysisCancelledRecorder()
    expect(controller.publishAnalysisCancelled({
      workspaceEpoch: captured,
      taskContentKey: TASK_CONTENT_KEY,
      currentContentKey: TASK_CONTENT_KEY,
      effects: cancelledRecorder.effects,
    })).toEqual({ kind: "stale" })
    expect(cancelledRecorder.order).toEqual([])

    const errorRecorder = createAnalysisErrorRecorder()
    expect(controller.publishAnalysisError({
      workspaceEpoch: captured,
      taskContentKey: TASK_CONTENT_KEY,
      currentContentKey: TASK_CONTENT_KEY,
      effects: errorRecorder.effects,
    })).toEqual({ kind: "stale" })
    expect(errorRecorder.order).toEqual([])
  })

  it("treats an A to B to A round trip as stale for the analysis result publication", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    observe(controller, context({ videoId: "video-b", contentKey: "youtube:video-b" }))
    observe(controller, context())

    const recorder = createAnalysisResultRecorder()
    const result = await controller.publishAnalysisResult({
      workspaceEpoch: captured,
      taskContentKey: TASK_CONTENT_KEY,
      currentContentKey: TASK_CONTENT_KEY,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "stale" })
    expect(recorder.order).toEqual([])
  })

  it("publishes across a same-content metadata refresh", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    observe(controller, context({
      title: "Renamed video",
      author: "Another author",
      canonicalUrl: "https://www.youtube.com/watch?v=video-a&t=9",
      isReady: false,
    }))

    expect(controller.isEpochCurrent(captured)).toBe(true)

    const recorder = createAnalysisTranscriptRecorder()
    const result = controller.publishAnalysisTranscript({
      workspaceEpoch: captured,
      taskContentKey: TASK_CONTENT_KEY,
      currentContentKey: TASK_CONTENT_KEY,
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "published" })
    expect(recorder.publishTranscript).toBe(1)
  })

  it("rejects publication when the caller content still differs even though the epoch is current", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()

    expect(controller.isEpochCurrent(captured)).toBe(true)

    const recorder = createAnalysisTranscriptRecorder()
    const result = controller.publishAnalysisTranscript({
      workspaceEpoch: captured,
      taskContentKey: TASK_CONTENT_KEY,
      currentContentKey: "youtube:video-b",
      effects: recorder.effects,
    })

    expect(result).toEqual({ kind: "stale" })
    expect(recorder.publishTranscript).toBe(0)
  })

  it("never mutates runtime content while publishing an analysis result", async () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const captured = controller.captureEpoch()
    const before = controller.getSnapshot()

    await controller.publishAnalysisResult({
      workspaceEpoch: captured,
      taskContentKey: TASK_CONTENT_KEY,
      currentContentKey: TASK_CONTENT_KEY,
      effects: createAnalysisResultRecorder().effects,
    })

    expect(controller.getSnapshot()).toEqual(before)
  })
})

describe("WorkspaceController display selection", () => {
  it("A. starts with no selected analysis and no selected QA thread", () => {
    const controller = new WorkspaceController()

    expect(controller.getDisplaySelection()).toEqual({
      analysis: null,
      qaThreadId: null,
    })
    expect(controller.getSnapshot().displaySelection).toEqual({
      analysis: null,
      qaThreadId: null,
    })
    expect(Object.keys(controller.getSnapshot()).sort()).toEqual([
      "displaySelection",
      "runtimeContent",
      "workspaceEpoch",
    ])
  })

  it("B. syncs the selected analysis reference exactly", () => {
    const controller = new WorkspaceController()

    const returned = controller.syncDisplaySelection({
      analysis: { contentKey: "youtube:video-a", analysisRunId: "run-1" },
      qaThreadId: null,
    })

    expect(returned).toEqual({
      analysis: { contentKey: "youtube:video-a", analysisRunId: "run-1" },
      qaThreadId: null,
    })
    expect(controller.getDisplaySelection()).toEqual({
      analysis: { contentKey: "youtube:video-a", analysisRunId: "run-1" },
      qaThreadId: null,
    })
  })

  it("C. preserves a nullable analysis run identity without normalizing it", () => {
    const controller = new WorkspaceController()

    controller.syncDisplaySelection({
      analysis: { contentKey: "youtube:video-a", analysisRunId: null },
      qaThreadId: null,
    })

    const selection = controller.getDisplaySelection()

    expect(selection.analysis).toEqual({
      contentKey: "youtube:video-a",
      analysisRunId: null,
    })
    expect(selection.analysis?.analysisRunId).toBeNull()
    expect(JSON.stringify(selection)).not.toContain("legacy")
  })

  it("D. syncs the selected QA thread reference", () => {
    const controller = new WorkspaceController()

    controller.syncDisplaySelection({
      analysis: { contentKey: "youtube:video-a", analysisRunId: "run-1" },
      qaThreadId: "thread-1",
    })

    expect(controller.getDisplaySelection().qaThreadId).toBe("thread-1")
  })

  it("E. never advances the workspace epoch on a display selection update", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const epoch = controller.captureEpoch()

    controller.syncDisplaySelection({
      analysis: { contentKey: "youtube:video-a", analysisRunId: "run-1" },
      qaThreadId: "thread-1",
    })
    controller.setSelectedQaThreadId(null)

    expect(controller.captureEpoch()).toBe(epoch)
    expect(controller.isEpochCurrent(epoch)).toBe(true)
  })

  it("F. never mutates runtime content on a display selection update", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const before = controller.getSnapshot().runtimeContent

    controller.syncDisplaySelection({
      analysis: { contentKey: "youtube:video-a", analysisRunId: "run-1" },
      qaThreadId: "thread-1",
    })

    expect(controller.getSnapshot().runtimeContent).toEqual(before)
  })

  it("G. allows a historical analysis selection that differs from runtime content", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const epoch = controller.captureEpoch()

    controller.syncDisplaySelection({
      analysis: {
        contentKey: "bilibili:BV-history:p:2",
        analysisRunId: "run-history",
      },
      qaThreadId: "thread-history",
    })

    const snapshot = controller.getSnapshot()

    expect(snapshot.runtimeContent.contentKey).toBe("youtube:video-a")
    expect(snapshot.displaySelection).toEqual({
      analysis: {
        contentKey: "bilibili:BV-history:p:2",
        analysisRunId: "run-history",
      },
      qaThreadId: "thread-history",
    })
    expect(snapshot.workspaceEpoch).toBe(epoch)
  })

  it("H. updates only the selection when the same content selects a different run", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const epoch = controller.captureEpoch()

    controller.syncDisplaySelection({
      analysis: { contentKey: "youtube:video-a", analysisRunId: "run-1" },
      qaThreadId: null,
    })
    controller.syncDisplaySelection({
      analysis: { contentKey: "youtube:video-a", analysisRunId: "run-2" },
      qaThreadId: null,
    })

    const snapshot = controller.getSnapshot()

    expect(snapshot.displaySelection.analysis?.analysisRunId).toBe("run-2")
    expect(snapshot.workspaceEpoch).toBe(epoch)
    expect(snapshot.runtimeContent.contentKey).toBe("youtube:video-a")
  })

  it("I. preserves the selected analysis when selecting a QA thread", () => {
    const controller = new WorkspaceController()

    controller.syncDisplaySelection({
      analysis: { contentKey: "youtube:video-a", analysisRunId: "run-1" },
      qaThreadId: null,
    })

    controller.setSelectedQaThreadId("thread-2")

    const selection = controller.getDisplaySelection()

    expect(selection.qaThreadId).toBe("thread-2")
    expect(selection.analysis).toEqual({
      contentKey: "youtube:video-a",
      analysisRunId: "run-1",
    })
  })

  it("J. preserves the selected analysis when clearing the selected QA thread", () => {
    const controller = new WorkspaceController()

    controller.syncDisplaySelection({
      analysis: { contentKey: "youtube:video-a", analysisRunId: "run-1" },
      qaThreadId: "thread-2",
    })

    controller.setSelectedQaThreadId(null)

    const selection = controller.getDisplaySelection()

    expect(selection.qaThreadId).toBeNull()
    expect(selection.analysis).toEqual({
      contentKey: "youtube:video-a",
      analysisRunId: "run-1",
    })
  })

  it("K. returns defensive nested display selection copies from getSnapshot", () => {
    const controller = new WorkspaceController()

    controller.syncDisplaySelection({
      analysis: { contentKey: "youtube:video-a", analysisRunId: "run-1" },
      qaThreadId: "thread-1",
    })

    const snapshot = controller.getSnapshot()
    snapshot.displaySelection.qaThreadId = "thread-mutated"
    snapshot.displaySelection.analysis!.contentKey = "youtube:mutated"
    snapshot.displaySelection.analysis!.analysisRunId = "run-mutated"

    expect(controller.getDisplaySelection()).toEqual({
      analysis: { contentKey: "youtube:video-a", analysisRunId: "run-1" },
      qaThreadId: "thread-1",
    })
  })

  it("L. returns defensive display selection copies from getDisplaySelection", () => {
    const controller = new WorkspaceController()

    controller.syncDisplaySelection({
      analysis: { contentKey: "youtube:video-a", analysisRunId: "run-1" },
      qaThreadId: "thread-1",
    })

    const selection = controller.getDisplaySelection()
    selection.analysis!.contentKey = "youtube:mutated"
    selection.qaThreadId = "thread-mutated"

    expect(controller.getDisplaySelection()).toEqual({
      analysis: { contentKey: "youtube:video-a", analysisRunId: "run-1" },
      qaThreadId: "thread-1",
    })
  })

  it("M. does not rewrite display selection on a runtime identity transition", () => {
    const controller = new WorkspaceController()
    observe(controller, context())

    controller.syncDisplaySelection({
      analysis: { contentKey: "youtube:video-a", analysisRunId: "run-1" },
      qaThreadId: "thread-1",
    })

    const transition = observe(controller, context({
      videoId: "video-b",
      contentKey: "youtube:video-b",
      url: "https://www.youtube.com/watch?v=video-b",
      canonicalUrl: "https://www.youtube.com/watch?v=video-b",
      title: "Video B",
    }))

    expect(transition.kind).toBe("identity-changed")
    expect(transition.shouldReset).toBe(true)
    expect(controller.getDisplaySelection()).toEqual({
      analysis: { contentKey: "youtube:video-a", analysisRunId: "run-1" },
      qaThreadId: "thread-1",
    })
  })

  it("N. preserves display selection across a same-content metadata refresh", () => {
    const controller = new WorkspaceController()
    observe(controller, context())

    controller.syncDisplaySelection({
      analysis: { contentKey: "youtube:video-a", analysisRunId: "run-1" },
      qaThreadId: "thread-1",
    })
    const epoch = controller.captureEpoch()

    const transition = observe(controller, context({ title: "Video A renamed" }))

    expect(transition.kind).toBe("same-content")
    expect(controller.captureEpoch()).toBe(epoch)
    expect(controller.getDisplaySelection()).toEqual({
      analysis: { contentKey: "youtube:video-a", analysisRunId: "run-1" },
      qaThreadId: "thread-1",
    })
  })
})

describe("WorkspaceController load generation", () => {
  it("A. captureLoadGeneration is stable and non-mutating", () => {
    const controller = new WorkspaceController()

    const first = controller.captureLoadGeneration()
    const second = controller.captureLoadGeneration()

    expect(second).toBe(first)
    expect(controller.isLoadGenerationCurrent(first)).toBe(true)
  })

  it("B. beginLoadGeneration advances exactly once", () => {
    const controller = new WorkspaceController()

    const before = controller.captureLoadGeneration()
    const begun = controller.beginLoadGeneration()

    expect(begun).toBe(before + 1)
    expect(controller.captureLoadGeneration()).toBe(begun)
    expect(controller.isLoadGenerationCurrent(begun)).toBe(true)
    expect(controller.isLoadGenerationCurrent(before)).toBe(false)
  })

  it("C. beginning a newer load stales the older token", () => {
    const controller = new WorkspaceController()

    const first = controller.beginLoadGeneration()
    const second = controller.beginLoadGeneration()

    expect(second).toBe(first + 1)
    expect(controller.isLoadGenerationCurrent(first)).toBe(false)
    expect(controller.isLoadGenerationCurrent(second)).toBe(true)
  })

  it("D. invalidateLoadGeneration stales the current token", () => {
    const controller = new WorkspaceController()

    const current = controller.beginLoadGeneration()
    const invalidated = controller.invalidateLoadGeneration()

    expect(invalidated).toBe(current + 1)
    expect(controller.isLoadGenerationCurrent(current)).toBe(false)
    expect(controller.isLoadGenerationCurrent(invalidated)).toBe(true)
  })

  it("E. keeps repeated invalidation monotonic and currentness-safe", () => {
    const controller = new WorkspaceController()

    const tokens = [controller.beginLoadGeneration()]
    tokens.push(controller.invalidateLoadGeneration())
    tokens.push(controller.invalidateLoadGeneration())

    for (let index = 1; index < tokens.length; index += 1) {
      expect(tokens[index]).toBe(tokens[index - 1] + 1)
    }
    for (let index = 0; index < tokens.length - 1; index += 1) {
      expect(controller.isLoadGenerationCurrent(tokens[index])).toBe(false)
    }
    expect(controller.isLoadGenerationCurrent(tokens[tokens.length - 1])).toBe(true)
  })

  it("F. never changes the workspace epoch when the load generation advances", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const epoch = controller.captureEpoch()

    controller.beginLoadGeneration()
    expect(controller.captureEpoch()).toBe(epoch)

    controller.invalidateLoadGeneration()
    expect(controller.captureEpoch()).toBe(epoch)
  })

  it("G. advances the epoch on an identity transition but not the load generation", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const epoch = controller.captureEpoch()
    const loadGeneration = controller.beginLoadGeneration()

    const transition = observe(controller, context({
      videoId: "video-b",
      contentKey: "youtube:video-b",
      url: "https://www.youtube.com/watch?v=video-b",
      canonicalUrl: "https://www.youtube.com/watch?v=video-b",
      title: "Video B",
    }))

    expect(transition.kind).toBe("identity-changed")
    expect(controller.captureEpoch()).toBe(epoch + 1)
    expect(controller.captureLoadGeneration()).toBe(loadGeneration)
    expect(controller.isLoadGenerationCurrent(loadGeneration)).toBe(true)
  })

  it("H. changes neither token on a same-content metadata refresh", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const epoch = controller.captureEpoch()
    const loadGeneration = controller.beginLoadGeneration()

    const transition = observe(controller, context({ title: "Video A renamed" }))

    expect(transition.kind).toBe("same-content")
    expect(controller.captureEpoch()).toBe(epoch)
    expect(controller.captureLoadGeneration()).toBe(loadGeneration)
    expect(controller.isLoadGenerationCurrent(loadGeneration)).toBe(true)
  })

  it("I. keeps the load token current across a display-selection sync", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const loadGeneration = controller.beginLoadGeneration()

    controller.syncDisplaySelection({
      analysis: { contentKey: "youtube:video-a", analysisRunId: "run-1" },
      qaThreadId: "thread-1",
    })

    expect(controller.isLoadGenerationCurrent(loadGeneration)).toBe(true)
  })

  it("J. keeps the load token current across setSelectedQaThreadId", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const loadGeneration = controller.beginLoadGeneration()

    controller.setSelectedQaThreadId("thread-2")
    expect(controller.isLoadGenerationCurrent(loadGeneration)).toBe(true)

    controller.setSelectedQaThreadId(null)
    expect(controller.isLoadGenerationCurrent(loadGeneration)).toBe(true)
  })

  it("K. keeps the load token current across a workspace publication", () => {
    const controller = new WorkspaceController()
    observe(controller, context())
    const loadGeneration = controller.beginLoadGeneration()
    const workspaceEpoch = controller.captureEpoch()

    const recorder = createAskEffectsRecorder()
    const result = controller.publishAskResult({
      workspaceEpoch,
      requested: askRequested(),
      current: askCurrent(),
      effects: recorder.effects,
    })

    expect(result.kind).toBe("published")
    expect(recorder.publishAnswer).toBe(1)
    expect(controller.isLoadGenerationCurrent(loadGeneration)).toBe(true)
    expect(controller.captureEpoch()).toBe(workspaceEpoch)
  })

  it("L. isolates load generations between controller instances", () => {
    const first = new WorkspaceController()
    const second = new WorkspaceController()

    expect(second.captureLoadGeneration()).toBe(first.captureLoadGeneration())

    first.beginLoadGeneration()
    first.invalidateLoadGeneration()

    expect(first.isLoadGenerationCurrent(second.captureLoadGeneration())).toBe(false)
    expect(second.isLoadGenerationCurrent(second.captureLoadGeneration())).toBe(true)
  })
})

describe("WorkspaceController applyRuntimeReset", () => {
  function recordEffects(events: string[]): WorkspaceRuntimeResetEffects {
    return {
      invalidateAskThreadLoadGeneration: () => {
        events.push("invalidate-ask-thread-load")
      },
      invalidateTranscriptLoadEpoch: () => {
        events.push("invalidate-transcript-load")
      },
      invalidateAskExecutionGeneration: () => {
        events.push("invalidate-ask-execution")
      },
      clearAnalysis: () => {
        events.push("clear-analysis")
      },
      clearAnalysisError: () => {
        events.push("clear-analysis-error")
      },
      setAnalysisIdle: () => {
        events.push("analysis-idle")
      },
      resetTranscript: () => {
        events.push("reset-transcript")
      },
      clearAskQuestion: () => {
        events.push("clear-ask-question")
      },
      clearAskWorkspace: () => {
        events.push("clear-ask-workspace")
      },
      clearAskError: () => {
        events.push("clear-ask-error")
      },
      clearAnalysisFetching: () => {
        events.push("clear-analysis-fetching")
      },
    }
  }

  it("A. runs the twelve reset steps in the documented order", () => {
    const controller = new WorkspaceController()
    const token = controller.beginLoadGeneration()
    const events: string[] = []
    const effects = recordEffects(events)

    controller.applyRuntimeReset({
      ...effects,
      invalidateAskThreadLoadGeneration: () => {
        events.push(
          controller.isLoadGenerationCurrent(token)
            ? "invalidate-load-still-current"
            : "invalidate-load",
        )
        effects.invalidateAskThreadLoadGeneration()
      },
    })

    expect(events).toEqual([
      "invalidate-load",
      "invalidate-ask-thread-load",
      "invalidate-transcript-load",
      "invalidate-ask-execution",
      "clear-analysis",
      "clear-analysis-error",
      "analysis-idle",
      "reset-transcript",
      "clear-ask-question",
      "clear-ask-workspace",
      "clear-ask-error",
      "clear-analysis-fetching",
    ])
  })

  it("B. advances the load generation exactly once", () => {
    const controller = new WorkspaceController()
    const generation = controller.captureLoadGeneration()
    const events: string[] = []

    controller.applyRuntimeReset(recordEffects(events))

    expect(controller.isLoadGenerationCurrent(generation)).toBe(false)
    expect(controller.captureLoadGeneration()).toBe(generation + 1)
  })

  it("C. never advances the workspace epoch", () => {
    const controller = new WorkspaceController()

    observe(controller, context())
    const epoch = controller.captureEpoch()

    controller.applyRuntimeReset(recordEffects([]))

    expect(controller.captureEpoch()).toBe(epoch)
    expect(controller.isEpochCurrent(epoch)).toBe(true)
  })

  it("D. never mutates runtime content", () => {
    const controller = new WorkspaceController()

    observe(controller, context())
    const before = runtimeContentOf(controller)

    controller.applyRuntimeReset(recordEffects([]))

    expect(runtimeContentOf(controller)).toEqual(before)
  })

  it("E. leaves controller-owned display selection unchanged", () => {
    const controller = new WorkspaceController()

    observe(controller, context())
    controller.syncDisplaySelection({
      analysis: { contentKey: "youtube:history-video", analysisRunId: "run-1" },
      qaThreadId: "thread-1",
    })
    const before = controller.getDisplaySelection()

    controller.applyRuntimeReset(recordEffects([]))

    expect(controller.getDisplaySelection()).toEqual(before)
  })

  it("F. keeps the transition and the explicit reset as two separate steps", () => {
    const controller = new WorkspaceController()

    observe(controller, context())
    const token = controller.beginLoadGeneration()
    const epoch = controller.captureEpoch()
    const events: string[] = []

    const transition = observe(
      controller,
      context({
        videoId: "video-b",
        contentKey: "youtube:video-b",
        url: "https://www.youtube.com/watch?v=video-b",
        canonicalUrl: "https://www.youtube.com/watch?v=video-b",
        title: "Video B",
      }),
    )

    expect(transition.kind).toBe("identity-changed")
    expect(transition.shouldReset).toBe(true)
    expect(controller.captureEpoch()).toBe(epoch + 1)
    expect(controller.isLoadGenerationCurrent(token)).toBe(true)
    expect(events).toEqual([])

    controller.applyRuntimeReset(recordEffects(events))

    expect(controller.isLoadGenerationCurrent(token)).toBe(false)
    expect(events).toEqual([
      "invalidate-ask-thread-load",
      "invalidate-transcript-load",
      "invalidate-ask-execution",
      "clear-analysis",
      "clear-analysis-error",
      "analysis-idle",
      "reset-transcript",
      "clear-ask-question",
      "clear-ask-workspace",
      "clear-ask-error",
      "clear-analysis-fetching",
    ])
  })

  it("G. never resets automatically on a same-content observation", () => {
    const controller = new WorkspaceController()

    observe(controller, context())
    const token = controller.beginLoadGeneration()
    const epoch = controller.captureEpoch()

    const transition = observe(controller, context({ title: "Video A updated" }))

    expect(transition.kind).toBe("same-content")
    expect(transition.shouldReset).toBe(false)
    expect(controller.captureEpoch()).toBe(epoch)
    expect(controller.isLoadGenerationCurrent(token)).toBe(true)
  })

  it("H. propagates a throwing effect unchanged and skips later effects", () => {
    const controller = new WorkspaceController()
    const events: string[] = []
    const effects = recordEffects(events)
    const failure = new Error("reset failed")
    const generation = controller.beginLoadGeneration()

    let thrown: unknown = null

    try {
      controller.applyRuntimeReset({
        ...effects,
        clearAnalysisError: () => {
          events.push("clear-analysis-error")
          throw failure
        },
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBe(failure)
    expect(events).toEqual([
      "invalidate-ask-thread-load",
      "invalidate-transcript-load",
      "invalidate-ask-execution",
      "clear-analysis",
      "clear-analysis-error",
    ])
    expect(controller.isLoadGenerationCurrent(generation)).toBe(false)
  })
})
