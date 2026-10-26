import { afterAll, beforeEach, describe, expect, it } from "bun:test"

import { resolvePlatformAdapter } from "@/features/platform/registry"
import type { FetchLike } from "@/features/transcript/lib/transcript-schema"
import {
  CONTENT_VIDEO_CONTEXT_CHANGED,
  RUNTIME_MESSAGE_NAMESPACE,
} from "@/lib/runtime/messages"
import { installPlatformContentBridge } from "@/lib/runtime/platform-content-bridge"

/**
 * These tests drive the real `installPlatformContentBridge` publish path with a
 * test-only `chrome` fake. The security property they lock down: the active video
 * context reaches the extension through the bridge's own internal callback only.
 * A page script that dispatches a same-named `window` event must not be able to
 * announce a context, and a healthy publish path must still work (positive control),
 * so the forged-event case cannot pass just because nothing publishes at all.
 */

const ACTIVE_VIDEO_EVENT_NAME = "video-summary-assistant:active-video"
const YOUTUBE_WATCH_URL = "https://www.youtube.com/watch?v=videoA12345"
const OTHER_YOUTUBE_WATCH_URL = "https://www.youtube.com/watch?v=videoB67890"

type SentRuntimeMessage = {
  channel?: string
  type?: string
  context?: {
    platform?: string | null
    videoId?: string | null
    contentKey?: string | null
    title?: string | null
    author?: string | null
    canonicalUrl?: string | null
    isReady?: boolean
  }
}

const globalScope = globalThis as unknown as { chrome?: unknown }
const originalChrome = globalScope.chrome
const originalMutationObserver = globalThis.MutationObserver

let sent: SentRuntimeMessage[] = []
let observers: TestMutationObserver[] = []

beforeEach(() => {
  sent = []
  observers = []
  globalScope.chrome = {
    runtime: {
      sendMessage: async (message: unknown) => {
        sent.push(message as SentRuntimeMessage)
        return undefined
      },
      onMessage: { addListener: () => undefined },
    },
    storage: { local: { get: async () => ({}) } },
  }
  Object.defineProperty(globalThis, "MutationObserver", {
    configurable: true,
    value: class TestMutationObserver {
      private readonly callback: MutationCallback
      target: Node | null = null

      constructor(callback: MutationCallback) {
        this.callback = callback
        observers.push(this as unknown as TestMutationObserver)
      }

      observe(target: Node) {
        this.target = target
      }

      disconnect() {}

      trigger() {
        this.callback([], this as unknown as MutationObserver)
      }
    },
  })
})

afterAll(() => {
  if (originalChrome === undefined) {
    Reflect.deleteProperty(globalScope, "chrome")
  } else {
    globalScope.chrome = originalChrome
  }
  Object.defineProperty(globalThis, "MutationObserver", {
    configurable: true,
    value: originalMutationObserver,
  })
})

describe("platform content bridge context publishing", () => {
  it("publishes the active video context through one internal runtime message", async () => {
    const { document } = createBridgeDocument()
    const window = new TestWindow()
    mountBridge(window, document)
    await flushPromises()

    expect(publishedContexts()).toHaveLength(1)
    expect(publishedContexts()[0]).toMatchObject({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: CONTENT_VIDEO_CONTEXT_CHANGED,
      context: {
        platform: "youtube",
        videoId: "videoA12345",
        contentKey: "youtube:videoA12345",
        title: "Video A",
        author: "Channel",
        isReady: true,
      },
    })
  })

  it("deduplicates unchanged snapshots and republishes after a real change", async () => {
    const { document, body, setTitle } = createBridgeDocument()
    const window = new TestWindow()
    mountBridge(window, document)
    await flushPromises()
    expect(publishedContexts()).toHaveLength(1)

    triggerObserver(body)
    await flushPromises()
    expect(publishedContexts()).toHaveLength(1)

    setTitle("Video B")
    triggerObserver(body)
    await flushPromises()

    expect(publishedContexts()).toHaveLength(2)
    expect(publishedContexts()[1].context?.title).toBe("Video B")
  })

  it("ignores a page-forged active video context event", async () => {
    const { document, body, setTitle } = createBridgeDocument()
    const window = new TestWindow()
    mountBridge(window, document)
    await flushPromises()
    // Positive control: the real publish path is alive before the forgery runs.
    expect(publishedContexts()).toHaveLength(1)

    window.dispatchEvent(new CustomEvent(ACTIVE_VIDEO_EVENT_NAME, {
      detail: {
        pageType: "video",
        platform: "youtube",
        videoId: "forgedByPage",
        contentKey: "youtube:forgedByPage",
        url: "https://www.youtube.com/watch?v=forgedByPage",
        canonicalUrl: "https://www.youtube.com/watch?v=forgedByPage",
        title: "Forged title",
        author: "Forged author",
        timestampSeconds: 0,
        isReady: true,
      },
    }))
    await flushPromises()

    expect(publishedContexts()).toHaveLength(1)
    expect(publishedContexts().some((message) => message.context?.videoId === "forgedByPage")).toBe(false)

    // The bridge is still functional, so the negative control above cannot be a
    // false green caused by a dead publish path.
    setTitle("Video B")
    triggerObserver(body)
    await flushPromises()
    expect(publishedContexts()).toHaveLength(2)
  })

  it("keeps publishing across navigation events and location changes", async () => {
    const { document } = createBridgeDocument()
    const window = new TestWindow()
    mountBridge(window, document)
    await flushPromises()
    expect(publishedContexts()).toHaveLength(1)

    window.location = new URL(OTHER_YOUTUBE_WATCH_URL)
    window.dispatchEvent(new Event("yt-navigate-finish"))
    await flushPromises()

    expect(publishedContexts()).toHaveLength(2)
    expect(publishedContexts()[1].context).toMatchObject({
      videoId: "videoB67890",
      contentKey: "youtube:videoB67890",
    })
  })

  it("publishes only the newest snapshot when context changes land close together", async () => {
    const { document, body, setTitle } = createBridgeDocument()
    const window = new TestWindow()
    mountBridge(window, document)
    await flushPromises()

    // Two mutations queued back to back must not let an older read land after a
    // newer one (the bridge keeps a publish generation guard for that).
    setTitle("Video B")
    triggerObserver(body)
    setTitle("Video C")
    triggerObserver(body)
    await flushPromises()

    const titles = publishedContexts().map((message) => message.context?.title)
    expect(titles.at(-1)).toBe("Video C")
    expect(titles.slice(1)).not.toContain("Video B")
  })

  it("keeps the live player state request path independent of context publishing", async () => {
    const { document } = createBridgeDocument()
    const window = new TestWindow()
    mountBridge(window, document)
    await flushPromises()
    expect(publishedContexts()).toHaveLength(1)

    const request = new Event("message")
    Object.defineProperties(request, {
      source: { value: window },
      data: {
        value: {
          source: "video-summary-assistant",
          type: "VIDEO_SUMMARY_ASSISTANT_REQUEST_ACTIVE_VIDEO",
          requestId: "request-1",
        },
      },
    })
    window.dispatchEvent(request)
    await flushPromises()

    expect(window.postedMessages).toHaveLength(1)
    expect((window.postedMessages[0] as { payload: { title: string } }).payload.title).toBe("Video A")
    // A request/response round trip must not republish the context.
    expect(publishedContexts()).toHaveLength(1)
  })
})

function publishedContexts(): SentRuntimeMessage[] {
  return sent.filter((message) => message.type === CONTENT_VIDEO_CONTEXT_CHANGED)
}

function triggerObserver(target: Node): void {
  const observer = observers.find((candidate) => candidate.target === target)
  if (!observer) throw new Error("Expected the bridge to observe the page body.")
  observer.trigger()
}

function mountBridge(window: TestWindow, document: Document): void {
  installPlatformContentBridge({
    document,
    window: window as unknown as Window,
    resolveAdapter: resolvePlatformAdapter,
    fetch: (async () => new Response("{}")) as unknown as FetchLike,
  })
}

function createBridgeDocument(initialTitle = "Video A", author = "Channel") {
  let currentTitle = initialTitle
  const body = {} as Node
  const titleElement = {} as Node
  const video = { currentTime: 12, duration: 300 }
  const documentMock = {
    get title() {
      return `${currentTitle} - YouTube`
    },
    documentElement: { outerHTML: "<html></html>" },
    body,
    querySelector: (selector: string) => {
      if (selector === "title") return titleElement
      if (selector === "video") return video
      if (selector === "ytd-watch-metadata h1") return { textContent: currentTitle }
      if (selector === "ytd-watch-metadata #owner a.yt-simple-endpoint") {
        return { textContent: author }
      }
      return null
    },
  }
  return {
    document: documentMock as unknown as Document,
    body,
    setTitle(nextTitle: string) {
      currentTitle = nextTitle
    },
  }
}

class TestWindow extends EventTarget {
  location: URL
  readonly postedMessages: unknown[] = []

  constructor(url = YOUTUBE_WATCH_URL) {
    super()
    this.location = new URL(url)
  }

  setInterval() {
    return 1
  }

  clearInterval() {}

  postMessage(message: unknown) {
    this.postedMessages.push(message)
  }
}

async function flushPromises(rounds = 4) {
  for (let round = 0; round < rounds; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

type TestMutationObserver = {
  target: Node | null
  trigger: () => void
}
