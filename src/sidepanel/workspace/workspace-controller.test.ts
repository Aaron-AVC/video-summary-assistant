import { describe, expect, it } from "bun:test"

import type { ActiveVideoContext } from "@/features/platform/types"
import {
  projectWorkspaceRuntimeContent,
  type WorkspaceRuntimeContent,
} from "@/sidepanel/workspace/workspace-state"
import {
  WorkspaceController,
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
