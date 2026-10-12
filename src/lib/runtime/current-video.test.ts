import { describe, expect, it } from "bun:test"

import { createActiveVideoBridge, readActiveVideoContext } from "@/lib/runtime/current-video"

function createDocument(title: string, author = "Channel") {
  const video = { currentTime: 12 }
  const documentMock = {
    title: `${title} - YouTube`,
    documentElement: { outerHTML: "<html></html>" },
    querySelector: (selector: string) => {
      if (selector === "video") return video
      if (selector.includes("h1")) {
        return { textContent: documentMock.title.replace(/ - YouTube$/, "") }
      }
      if (selector.includes("#owner") || selector.includes("ytd-channel-name")) {
        return { textContent: author }
      }
      return null
    },
  } as unknown as Document
  return documentMock
}

describe("active video context", () => {
  it("projects adapter video information into the neutral runtime context", async () => {
    const context = await readActiveVideoContext(
      createDocument("Video A"),
      new URL("https://www.youtube.com/watch?v=videoA12345"),
    )

    expect(context).toMatchObject({
      pageType: "video",
      platform: "youtube",
      videoId: "videoA12345",
      partId: null,
      contentKey: "youtube:videoA12345",
      title: "Video A",
      author: "Channel",
      timestampSeconds: 12,
      isReady: true,
    })
  })

  it("returns an unsupported neutral context when no adapter matches", async () => {
    const context = await readActiveVideoContext(
      createDocument("Home"),
      new URL("https://www.youtube.com/"),
    )

    expect(context.pageType).toBe("unsupported")
    expect(context.platform).toBeNull()
    expect(context.videoId).toBeNull()
    expect(context.contentKey).toBeNull()
    expect(context.isReady).toBe(false)
  })

  it("does not retain stale identity across a YouTube SPA navigation", async () => {
    const document = createDocument("Video A")
    const first = await readActiveVideoContext(
      document,
      new URL("https://www.youtube.com/watch?v=videoA12345"),
    )
    document.title = "Video B - YouTube"
    const second = await readActiveVideoContext(
      document,
      new URL("https://www.youtube.com/watch?v=videoB67890"),
    )

    expect(first.contentKey).toBe("youtube:videoA12345")
    expect(second).toMatchObject({
      videoId: "videoB67890",
      contentKey: "youtube:videoB67890",
      title: "Video B",
    })
    expect(second.videoId).not.toBe(first.videoId)
  })

  it("uses matching live player metadata for the active context author", async () => {
    const context = await readActiveVideoContext(
      createDocument("DOM title", "Mrs. GREEN APPLE"),
      new URL("https://www.youtube.com/watch?v=videoA12345"),
      undefined,
      undefined,
      async () => ({
        videoId: "videoA12345",
        title: "Live title",
        author: "投机实验室",
        captionTracks: [],
        subtitlesOn: null,
        currentCaptionTrack: null,
        timedtextCandidates: [],
      }),
    )

    expect(context.title).toBe("Live title")
    expect(context.author).toBe("投机实验室")
  })

  it("keeps observer-driven publishes on the cheap metadata path", async () => {
    const observers: TestMutationObserver[] = []
    const previousMutationObserver = globalThis.MutationObserver
    Object.defineProperty(globalThis, "MutationObserver", {
      configurable: true,
      value: class TestMutationObserver {
        private readonly callback: MutationCallback
        target: Node | null = null

        constructor(callback: MutationCallback) {
          this.callback = callback
          observers.push(this)
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

    try {
      const { document, body } = createBridgeDocument()
      const window = new TestWindow()
      let liveReads = 0
      const cleanup = createActiveVideoBridge({
        document,
        window: window as unknown as Window,
        readYouTubeLivePlayerState: async () => {
          liveReads += 1
          return {
            videoId: "videoA12345",
            title: "Live title",
            author: "投机实验室",
            captionTracks: [],
            subtitlesOn: null,
            currentCaptionTrack: null,
            timedtextCandidates: [],
          }
        },
      })

      await flushPromises()
      observers.find((observer) => observer.target === body)?.trigger()
      await flushPromises()

      expect(liveReads).toBe(0)
      cleanup()
    } finally {
      if (previousMutationObserver) {
        Object.defineProperty(globalThis, "MutationObserver", {
          configurable: true,
          value: previousMutationObserver,
        })
      } else {
        Reflect.deleteProperty(globalThis, "MutationObserver")
      }
    }
  })

  it("keeps explicit active-context requests on the live metadata path", async () => {
    const observers: TestMutationObserver[] = []
    const previousMutationObserver = globalThis.MutationObserver
    Object.defineProperty(globalThis, "MutationObserver", {
      configurable: true,
      value: class TestMutationObserver {
        private readonly callback: MutationCallback
        target: Node | null = null

        constructor(callback: MutationCallback) {
          this.callback = callback
          observers.push(this)
        }

        observe(target: Node) {
          this.target = target
        }

        disconnect() {}
      },
    })

    try {
      const { document } = createBridgeDocument("Mrs. GREEN APPLE")
      const window = new TestWindow()
      let liveReads = 0
      const cleanup = createActiveVideoBridge({
        document,
        window: window as unknown as Window,
        readYouTubeLivePlayerState: async () => {
          liveReads += 1
          return {
            videoId: "videoA12345",
            title: "Live title",
            author: "投机实验室",
            captionTracks: [],
            subtitlesOn: null,
            currentCaptionTrack: null,
            timedtextCandidates: [],
          }
        },
      })

      await flushPromises()
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

      expect(liveReads).toBe(1)
      expect(window.postedMessages).toHaveLength(1)
      expect((window.postedMessages[0] as { payload: { author: string } }).payload.author).toBe("投机实验室")
      cleanup()
    } finally {
      if (previousMutationObserver) {
        Object.defineProperty(globalThis, "MutationObserver", {
          configurable: true,
          value: previousMutationObserver,
        })
      } else {
        Reflect.deleteProperty(globalThis, "MutationObserver")
      }
    }
  })
})

class TestWindow extends EventTarget {
  readonly location = new URL("https://www.youtube.com/watch?v=videoA12345")
  readonly postedMessages: unknown[] = []

  setInterval() {
    return 1
  }

  clearInterval() {}

  postMessage(message: unknown) {
    this.postedMessages.push(message)
  }
}

function createBridgeDocument(unrelatedAuthor = "Channel") {
  const body = {} as Node
  const titleElement = {} as Node
  const video = { currentTime: 12 }
  const document = {
    title: "Video A - YouTube",
    body,
    documentElement: { outerHTML: "<html></html>" },
    querySelector: (selector: string) => {
      if (selector === "title") return titleElement
      if (selector === "video") return video
      if (selector === "ytd-watch-metadata h1") return { textContent: "Video A" }
      if (selector === "ytd-watch-metadata #owner a.yt-simple-endpoint") {
        return { textContent: unrelatedAuthor }
      }
      return null
    },
  } as unknown as Document
  return { document, body }
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

type TestMutationObserver = {
  target: Node | null
  trigger?: () => void
}
