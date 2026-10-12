import { describe, expect, it } from "bun:test"

import { readActiveVideoContext } from "@/lib/runtime/current-video"

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
        timedtextCandidates: [],
      }),
    )

    expect(context.title).toBe("Live title")
    expect(context.author).toBe("投机实验室")
  })
})
