import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"

import type { ActiveVideoContext } from "@/features/platform/types"
import {
  ACTIVE_VIDEO_CONTEXT_CHANGED,
  CONTENT_VIDEO_CONTEXT_CHANGED,
  FETCH_BILIBILI_RESOURCE,
  GET_ACTIVE_VIDEO_CONTEXT,
  JUMP_TO_TIMESTAMP,
  OPEN_SIDEPANEL,
  READ_YOUTUBE_LIVE_PLAYER_STATE,
  REFRESH_YOUTUBE_CAPTION_RESOURCE,
  RUNTIME_MESSAGE_NAMESPACE,
} from "@/lib/runtime/messages"

/**
 * The background service worker is the only inbound privileged message boundary in
 * the extension. These tests drive the real `src/background/index.ts` listener with a
 * test-only `chrome` fake so the boundary can never regress silently:
 * a message that is not recognized, not authorized, or not consistent with its sender
 * must not reach `tabs.create`, `scripting.executeScript`, `fetch`, `sidePanel.open`,
 * or the side-panel broadcast.
 */

const MISSING_RECEIVER = "Could not establish connection. Receiving end does not exist."
const SIZE_LIMIT_ERROR = "Bilibili resource response exceeded the size limit."

const YOUTUBE_VIDEO_ID = "dQw4w9WgXcQ"
const YOUTUBE_URL = `https://www.youtube.com/watch?v=${YOUTUBE_VIDEO_ID}`
const OTHER_YOUTUBE_URL = "https://www.youtube.com/watch?v=otherVideo1"
const BILIBILI_VIDEO_URL = "https://www.bilibili.com/video/BV1xx411c7mD/?p=2"
const BILIBILI_RESOURCE_URL =
  "https://api.bilibili.com/x/player/v2?aid=1&cid=2&bvid=BV1xx411c7mD"
const BILIBILI_BINARY_URL =
  "https://api.bilibili.com/x/v2/subtitle/web/view?oid=2&pid=9001&context_ext=%7B%22video_type%22%3A1%7D&type=1&cur_production_type=0"

type ChromeMessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | undefined

type InjectionCall = {
  target?: { tabId?: number }
  world?: string
  func?: unknown
  args?: unknown[]
  files?: string[]
}

type Harness = {
  calls: {
    runtimeMessages: unknown[]
    tabsCreated: Array<{ url?: string; active?: boolean }>
    tabMessages: Array<{ tabId: number; message: unknown }>
    injections: InjectionCall[]
    sidePanelOpens: Array<{ tabId: number }>
    tabQueries: unknown[]
    fetches: Array<{ url: string; init?: RequestInit }>
  }
  tabLookup: (tabId: number) => { id?: number; url?: string } | null
  activeTabs: chrome.tabs.Tab[]
  injectionResult: unknown
  tabMessageResponder: (tabId: number, message: unknown) => Promise<unknown>
  fetchResponder: (url: string, init?: RequestInit) => Response
}

function createHarness(): Harness {
  return {
    calls: {
      runtimeMessages: [],
      tabsCreated: [],
      tabMessages: [],
      injections: [],
      sidePanelOpens: [],
      tabQueries: [],
      fetches: [],
    },
    tabLookup: () => null,
    activeTabs: [],
    injectionResult: null,
    tabMessageResponder: async () => {
      throw new Error(MISSING_RECEIVER)
    },
    fetchResponder: () => new Response("{}"),
  }
}

let harness = createHarness()
let messageListener: ChromeMessageListener | null = null

const globalScope = globalThis as unknown as { chrome?: unknown; fetch: typeof fetch }
const originalChrome = globalScope.chrome
const originalFetch = globalScope.fetch

globalScope.chrome = {
  action: { onClicked: { addListener: () => undefined } },
  runtime: {
    onMessage: {
      addListener: (listener: ChromeMessageListener) => {
        messageListener = listener
      },
    },
    sendMessage: async (message: unknown) => {
      harness.calls.runtimeMessages.push(message)
    },
    getManifest: () => ({ content_scripts: [] }),
  },
  tabs: {
    query: async (query: unknown) => {
      harness.calls.tabQueries.push(query)
      return harness.activeTabs
    },
    get: async (tabId: number) => {
      const tab = harness.tabLookup(tabId)
      if (!tab) throw new Error(`No tab with id: ${tabId}.`)
      return tab
    },
    create: async (properties: { url?: string; active?: boolean }) => {
      harness.calls.tabsCreated.push(properties)
      return { id: 900 + harness.calls.tabsCreated.length }
    },
    sendMessage: async (tabId: number, message: unknown) => {
      harness.calls.tabMessages.push({ tabId, message })
      return harness.tabMessageResponder(tabId, message)
    },
  },
  scripting: {
    executeScript: async (injection: unknown) => {
      harness.calls.injections.push(injection as InjectionCall)
      return [{ result: harness.injectionResult }]
    },
  },
  sidePanel: {
    open: async (options: { tabId: number }) => {
      harness.calls.sidePanelOpens.push(options)
    },
  },
} as unknown as typeof chrome

globalScope.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  harness.calls.fetches.push({ url, init })
  return harness.fetchResponder(url, init)
}) as unknown as typeof fetch

beforeAll(async () => {
  await import("@/background/index")
  if (!messageListener) throw new Error("The background runtime.onMessage listener was not registered.")
})

afterAll(() => {
  globalScope.chrome = originalChrome
  globalScope.fetch = originalFetch
})

beforeEach(() => {
  harness = createHarness()
})

type DispatchResult = {
  returned: boolean | undefined
  responded: boolean
  response: unknown
}

function dispatch(
  message: unknown,
  sender: chrome.runtime.MessageSender = {},
): DispatchResult {
  if (!messageListener) throw new Error("The background runtime.onMessage listener was not registered.")
  const result: DispatchResult = { returned: undefined, responded: false, response: undefined }
  result.returned = messageListener(message, sender, (response?: unknown) => {
    result.responded = true
    result.response = response
  })
  return result
}

async function settle(
  message: unknown,
  sender: chrome.runtime.MessageSender = {},
): Promise<DispatchResult> {
  const result = dispatch(message, sender)
  await drainAsyncWork()
  return result
}

async function drainAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function senderFor(url: string, tabId = 1, frameId = 0): chrome.runtime.MessageSender {
  return {
    id: "test-extension-id",
    tab: { id: tabId, url } as chrome.tabs.Tab,
    url,
    frameId,
  }
}

function expectNoPrivilegedCalls(): void {
  expect(harness.calls.tabsCreated).toHaveLength(0)
  expect(harness.calls.injections).toHaveLength(0)
  expect(harness.calls.fetches).toHaveLength(0)
  expect(harness.calls.sidePanelOpens).toHaveLength(0)
  expect(harness.calls.runtimeMessages).toHaveLength(0)
  expect(harness.calls.tabMessages).toHaveLength(0)
}

/** Every privileged side effect except the side-panel broadcast, which is asserted separately. */
function expectNoPrivilegedCallsExceptBroadcast(): void {
  expect(harness.calls.tabsCreated).toHaveLength(0)
  expect(harness.calls.injections).toHaveLength(0)
  expect(harness.calls.fetches).toHaveLength(0)
  expect(harness.calls.sidePanelOpens).toHaveLength(0)
  expect(harness.calls.tabMessages).toHaveLength(0)
}

function youtubeContext(overrides: Partial<ActiveVideoContext> = {}): ActiveVideoContext {
  return {
    pageType: "video",
    platform: "youtube",
    videoId: YOUTUBE_VIDEO_ID,
    partId: null,
    contentKey: `youtube:${YOUTUBE_VIDEO_ID}`,
    url: YOUTUBE_URL,
    canonicalUrl: YOUTUBE_URL,
    title: "Boundary test video",
    author: null,
    timestampSeconds: 0,
    isReady: true,
    ...overrides,
  }
}

describe("background inbound boundary: deny by default", () => {
  it("ignores unknown message types without touching any privileged API", async () => {
    const messages: unknown[] = [
      { channel: RUNTIME_MESSAGE_NAMESPACE, type: "delete-everything" },
      { channel: "video-summary-assistant/other", type: JUMP_TO_TIMESTAMP, timestampSeconds: 5 },
      { type: JUMP_TO_TIMESTAMP, identity: { platform: "youtube", videoId: YOUTUBE_VIDEO_ID }, timestampSeconds: 5 },
      {},
      null,
      undefined,
      "jump-to-timestamp",
      42,
    ]

    for (const message of messages) {
      const result = await settle(message)
      expect(result.returned).toBeUndefined()
      expect(result.responded).toBe(false)
    }

    expectNoPrivilegedCalls()
    expect(harness.calls.tabQueries).toHaveLength(0)
  })

  it("rejects recognized types whose payload fails the inbound guard", async () => {
    const messages: unknown[] = [
      { channel: RUNTIME_MESSAGE_NAMESPACE, type: READ_YOUTUBE_LIVE_PLAYER_STATE },
      { channel: RUNTIME_MESSAGE_NAMESPACE, type: READ_YOUTUBE_LIVE_PLAYER_STATE, videoId: "" },
      { channel: RUNTIME_MESSAGE_NAMESPACE, type: READ_YOUTUBE_LIVE_PLAYER_STATE, videoId: "bad id with spaces" },
      {
        channel: RUNTIME_MESSAGE_NAMESPACE,
        type: REFRESH_YOUTUBE_CAPTION_RESOURCE,
        videoId: YOUTUBE_VIDEO_ID,
        previousStartTime: -1,
      },
      {
        channel: RUNTIME_MESSAGE_NAMESPACE,
        type: REFRESH_YOUTUBE_CAPTION_RESOURCE,
        videoId: YOUTUBE_VIDEO_ID,
        previousStartTime: "0",
      },
      { channel: RUNTIME_MESSAGE_NAMESPACE, type: FETCH_BILIBILI_RESOURCE },
    ]

    for (const message of messages) {
      const result = await settle(message, senderFor(YOUTUBE_URL))
      expect(result.returned).toBeUndefined()
      expect(result.responded).toBe(false)
    }

    expectNoPrivilegedCalls()
  })

  it("drops a context notification whose payload is not a valid context", async () => {
    const messages: unknown[] = [
      { channel: RUNTIME_MESSAGE_NAMESPACE, type: CONTENT_VIDEO_CONTEXT_CHANGED },
      { channel: RUNTIME_MESSAGE_NAMESPACE, type: CONTENT_VIDEO_CONTEXT_CHANGED, context: null },
      { channel: RUNTIME_MESSAGE_NAMESPACE, type: CONTENT_VIDEO_CONTEXT_CHANGED, context: {} },
      {
        channel: RUNTIME_MESSAGE_NAMESPACE,
        type: CONTENT_VIDEO_CONTEXT_CHANGED,
        context: youtubeContext({ contentKey: "bilibili:BV1xx411c7mD:p:1" }),
      },
      {
        channel: RUNTIME_MESSAGE_NAMESPACE,
        type: CONTENT_VIDEO_CONTEXT_CHANGED,
        context: youtubeContext({ timestampSeconds: Number.POSITIVE_INFINITY }),
      },
    ]

    for (const message of messages) {
      await settle(message, senderFor(YOUTUBE_URL))
    }

    expectNoPrivilegedCalls()
  })

  it("does not broadcast a context that belongs to no supported platform", async () => {
    const context: ActiveVideoContext = {
      pageType: "unsupported",
      platform: null,
      videoId: null,
      partId: null,
      contentKey: null,
      url: "https://example.com/watch",
      canonicalUrl: null,
      title: null,
      author: null,
      timestampSeconds: 0,
      isReady: false,
    }

    await settle(
      { channel: RUNTIME_MESSAGE_NAMESPACE, type: CONTENT_VIDEO_CONTEXT_CHANGED, context },
      senderFor("https://example.com/watch"),
    )

    expectNoPrivilegedCalls()
  })

  it("keeps serving valid requests after rejecting malformed ones", async () => {
    await settle({ channel: RUNTIME_MESSAGE_NAMESPACE, type: "delete-everything" }, senderFor(YOUTUBE_URL))
    await settle({ channel: RUNTIME_MESSAGE_NAMESPACE, type: JUMP_TO_TIMESTAMP }, senderFor(YOUTUBE_URL))

    const result = await settle(
      { channel: RUNTIME_MESSAGE_NAMESPACE, type: GET_ACTIVE_VIDEO_CONTEXT },
      senderFor(YOUTUBE_URL),
    )

    expect(result.responded).toBe(true)
    expect(result.response).toMatchObject({ ok: true, type: GET_ACTIVE_VIDEO_CONTEXT, tabId: null })
    expect((result.response as { context: ActiveVideoContext }).context.pageType).toBe("unsupported")
    expectNoPrivilegedCalls()
  })
})

describe("background inbound boundary: content identity relay", () => {
  it("relays a context that matches the sender tab exactly once", async () => {
    const context = youtubeContext()

    const result = await settle(
      { channel: RUNTIME_MESSAGE_NAMESPACE, type: CONTENT_VIDEO_CONTEXT_CHANGED, context },
      senderFor(YOUTUBE_URL, 5),
    )

    expect(result.returned).toBeUndefined()
    expect(harness.calls.runtimeMessages).toHaveLength(1)
    expect(harness.calls.runtimeMessages[0]).toEqual({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: ACTIVE_VIDEO_CONTEXT_CHANGED,
      tabId: 5,
      context,
    })
    expectNoPrivilegedCallsExceptBroadcast()
  })

  it("drops a context that claims a different video than the sender tab", async () => {
    const context = youtubeContext({
      videoId: "otherVideo1",
      contentKey: "youtube:otherVideo1",
      url: OTHER_YOUTUBE_URL,
    })

    const result = await settle(
      { channel: RUNTIME_MESSAGE_NAMESPACE, type: CONTENT_VIDEO_CONTEXT_CHANGED, context },
      senderFor(YOUTUBE_URL, 5),
    )

    expect(result.responded).toBe(false)
    expect(harness.calls.runtimeMessages).toHaveLength(0)
  })

  it("drops a context whose identity matches but whose url does not", async () => {
    const context = youtubeContext({ url: OTHER_YOUTUBE_URL })

    await settle(
      { channel: RUNTIME_MESSAGE_NAMESPACE, type: CONTENT_VIDEO_CONTEXT_CHANGED, context },
      senderFor(YOUTUBE_URL, 5),
    )

    expect(harness.calls.runtimeMessages).toHaveLength(0)
  })

  it("drops a context relayed without a sender tab id", async () => {
    await settle(
      {
        channel: RUNTIME_MESSAGE_NAMESPACE,
        type: CONTENT_VIDEO_CONTEXT_CHANGED,
        context: youtubeContext(),
      },
      { url: YOUTUBE_URL, frameId: 0 },
    )

    expect(harness.calls.runtimeMessages).toHaveLength(0)
  })

  it("drops a bilibili context relayed from a youtube tab", async () => {
    const context: ActiveVideoContext = {
      pageType: "video",
      platform: "bilibili",
      videoId: "BV1xx411c7mD",
      partId: "2",
      contentKey: "bilibili:BV1xx411c7mD:p:2",
      url: BILIBILI_VIDEO_URL,
      canonicalUrl: "https://www.bilibili.com/video/BV1xx411c7mD?p=2",
      title: "Bilibili video",
      author: null,
      timestampSeconds: 0,
      isReady: true,
    }

    await settle(
      { channel: RUNTIME_MESSAGE_NAMESPACE, type: CONTENT_VIDEO_CONTEXT_CHANGED, context },
      senderFor(YOUTUBE_URL, 5),
    )

    expect(harness.calls.runtimeMessages).toHaveLength(0)
  })
})

describe("background inbound boundary: MAIN world injection gating", () => {
  function livePlayerStateMessage(videoId = YOUTUBE_VIDEO_ID) {
    return {
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: READ_YOUTUBE_LIVE_PLAYER_STATE,
      videoId,
    }
  }

  it("injects into the MAIN world only for the requesting top frame on the same video", async () => {
    harness.tabLookup = (tabId) => ({ id: tabId, url: YOUTUBE_URL })

    const result = await settle(livePlayerStateMessage(), senderFor(YOUTUBE_URL, 3, 0))

    expect(result.response).toEqual({
      ok: true,
      type: READ_YOUTUBE_LIVE_PLAYER_STATE,
      tabId: 3,
      playerState: null,
    })
    expect(harness.calls.injections).toHaveLength(1)
    const injection = harness.calls.injections[0]
    expect(injection.target).toEqual({ tabId: 3 })
    expect(injection.world).toBe("MAIN")
    expect(injection.args).toEqual([YOUTUBE_VIDEO_ID])
    expect(typeof injection.func).toBe("function")
  })

  it("refuses to inject from a sub frame", async () => {
    harness.tabLookup = (tabId) => ({ id: tabId, url: YOUTUBE_URL })

    const result = await settle(livePlayerStateMessage(), senderFor(YOUTUBE_URL, 3, 7))

    expect(result.response).toEqual({
      ok: true,
      type: READ_YOUTUBE_LIVE_PLAYER_STATE,
      tabId: 3,
      playerState: null,
    })
    expect(harness.calls.injections).toHaveLength(0)
  })

  it("refuses to inject for a sender that is not a supported YouTube watch page", async () => {
    for (const url of [
      BILIBILI_VIDEO_URL,
      "https://www.youtube.com/feed/subscriptions",
      "https://example.com/watch?v=" + YOUTUBE_VIDEO_ID,
      "chrome-extension://test-extension-id/sidepanel.html",
      "not a url",
    ]) {
      harness.tabLookup = (tabId) => ({ id: tabId, url })
      harness.calls.injections.length = 0

      const result = await settle(livePlayerStateMessage(), senderFor(url, 3, 0))

      expect(result.response).toMatchObject({ ok: true, playerState: null })
      expect(harness.calls.injections).toHaveLength(0)
    }
  })

  it("refuses to inject when the sender page shows a different video", async () => {
    harness.tabLookup = (tabId) => ({ id: tabId, url: OTHER_YOUTUBE_URL })

    const result = await settle(livePlayerStateMessage(), senderFor(OTHER_YOUTUBE_URL, 3, 0))

    expect(result.response).toMatchObject({ ok: true, playerState: null })
    expect(harness.calls.injections).toHaveLength(0)
  })

  it("refuses to inject when the tab navigated away before the message arrived", async () => {
    harness.tabLookup = (tabId) => ({ id: tabId, url: OTHER_YOUTUBE_URL })

    await settle(livePlayerStateMessage(), senderFor(YOUTUBE_URL, 3, 0))

    expect(harness.calls.injections).toHaveLength(0)
  })

  it("discards an injection result when the tab navigated away during the read", async () => {
    let lookups = 0
    harness.tabLookup = (tabId) => ({
      id: tabId,
      url: lookups++ === 0 ? YOUTUBE_URL : OTHER_YOUTUBE_URL,
    })
    harness.injectionResult = { videoId: YOUTUBE_VIDEO_ID, captionsEnabled: true }

    const result = await settle(livePlayerStateMessage(), senderFor(YOUTUBE_URL, 3, 0))

    expect(harness.calls.injections).toHaveLength(1)
    expect(result.response).toEqual({
      ok: true,
      type: READ_YOUTUBE_LIVE_PLAYER_STATE,
      tabId: 3,
      playerState: null,
    })
  })

  it("applies the same gating to caption resource refreshes", async () => {
    const message = {
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: REFRESH_YOUTUBE_CAPTION_RESOURCE,
      videoId: YOUTUBE_VIDEO_ID,
      previousStartTime: 12.5,
    }

    const subFrame = await settle(message, senderFor(YOUTUBE_URL, 3, 1))
    expect(subFrame.response).toMatchObject({ ok: true, candidate: null })
    expect(harness.calls.injections).toHaveLength(0)

    harness.tabLookup = (tabId) => ({ id: tabId, url: YOUTUBE_URL })
    const topFrame = await settle(message, senderFor(YOUTUBE_URL, 3, 0))
    expect(topFrame.response).toMatchObject({ ok: true, candidate: null })
    expect(harness.calls.injections).toHaveLength(1)
    expect(harness.calls.injections[0].args).toEqual([YOUTUBE_VIDEO_ID, 12.5])
  })
})

describe("background inbound boundary: malformed privileged requests", () => {
  const validIdentity = {
    platform: "youtube" as const,
    videoId: YOUTUBE_VIDEO_ID,
    contentKey: `youtube:${YOUTUBE_VIDEO_ID}`,
  }

  function jumpMessage(identity: unknown, timestampSeconds: unknown = 5) {
    return {
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: JUMP_TO_TIMESTAMP,
      identity,
      timestampSeconds,
    }
  }

  it("never opens a tab for a non-finite timestamp", async () => {
    for (const timestampSeconds of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "5", null]) {
      const result = await settle(
        {
          channel: RUNTIME_MESSAGE_NAMESPACE,
          type: JUMP_TO_TIMESTAMP,
          identity: validIdentity,
          timestampSeconds,
        },
        senderFor(YOUTUBE_URL),
      )

      expect(result.responded).toBe(true)
      expect(result.response).toMatchObject({
        ok: false,
        type: JUMP_TO_TIMESTAMP,
        tabId: null,
        error: "Timestamp must be a finite number.",
      })
      expectNoPrivilegedCalls()
    }
  })

  it("never opens a tab for an invalid or unsupported identity", async () => {
    const bilibiliVideoId = "BV1xx411c7mD"
    const canonicalBilibiliKey = `bilibili:${bilibiliVideoId}:p:2`

    for (const identity of [
      null,
      undefined,
      {},
      // A platform alone is not an identity: it must not reach the privileged action.
      { platform: "youtube" },
      { platform: "youtube", videoId: "" },
      { platform: "youtube", videoId: YOUTUBE_VIDEO_ID },
      { platform: "youtube", videoId: YOUTUBE_VIDEO_ID, contentKey: "youtube:OTHER" },
      {
        platform: "youtube",
        videoId: YOUTUBE_VIDEO_ID,
        contentKey: `youtube:${YOUTUBE_VIDEO_ID}`,
        partId: "1",
      },
      {
        platform: "youtube",
        videoId: YOUTUBE_VIDEO_ID,
        contentKey: `youtube:${YOUTUBE_VIDEO_ID}`,
        partId: null,
      },
      { platform: "youtube", videoId: "javascript:alert(1)//evil.example", contentKey: "youtube:x" },
      { platform: "vimeo", videoId: YOUTUBE_VIDEO_ID },
      { platform: "bilibili" },
      { platform: "bilibili", videoId: "not-a-bv-id" },
      { platform: "bilibili", videoId: bilibiliVideoId },
      { platform: "bilibili", videoId: bilibiliVideoId, contentKey: `bilibili:${bilibiliVideoId}` },
      { platform: "bilibili", videoId: bilibiliVideoId, contentKey: `bilibili:${bilibiliVideoId}:p:0` },
      {
        platform: "bilibili",
        videoId: bilibiliVideoId,
        contentKey: "bilibili:BV1yy411c7mD:p:2",
      },
      { platform: "bilibili", videoId: bilibiliVideoId, contentKey: canonicalBilibiliKey, partId: "1" },
      { platform: "bilibili", videoId: bilibiliVideoId, contentKey: canonicalBilibiliKey, partId: null },
    ]) {
      const result = await settle(
        {
          channel: RUNTIME_MESSAGE_NAMESPACE,
          type: JUMP_TO_TIMESTAMP,
          identity,
          timestampSeconds: 5,
        },
        senderFor(YOUTUBE_URL),
      )

      expect(result.responded).toBe(true)
      expect((result.response as { ok: boolean }).ok).toBe(false)
      expect(typeof (result.response as { error: unknown }).error).toBe("string")
      expectNoPrivilegedCalls()
    }
  })

  it("does not throw out of the listener for any malformed jump request", () => {
    for (const message of [
      { channel: RUNTIME_MESSAGE_NAMESPACE, type: JUMP_TO_TIMESTAMP },
      { channel: RUNTIME_MESSAGE_NAMESPACE, type: JUMP_TO_TIMESTAMP, identity: null },
      { channel: RUNTIME_MESSAGE_NAMESPACE, type: JUMP_TO_TIMESTAMP, identity: "youtube", timestampSeconds: 1 },
    ]) {
      expect(() => dispatch(message, senderFor(YOUTUBE_URL))).not.toThrow()
    }
  })

  it("rejects a forged videoId instead of laundering it into a tab", async () => {
    const result = await settle(
      {
        channel: RUNTIME_MESSAGE_NAMESPACE,
        type: JUMP_TO_TIMESTAMP,
        identity: {
          platform: "youtube",
          videoId: "javascript:alert(1)//evil.example",
          contentKey: "youtube:x",
        },
        timestampSeconds: 5,
      },
      senderFor(YOUTUBE_URL),
    )

    // The identity itself is refused; no tab is opened at all, so the origin of a tab
    // is no longer the only thing standing between a forged identity and navigation.
    expect(result.response).toMatchObject({
      ok: false,
      type: JUMP_TO_TIMESTAMP,
      error: "The target video identity is invalid.",
    })
    expect(harness.calls.tabsCreated).toHaveLength(0)
    expectNoPrivilegedCalls()
  })

  it("still opens the canonical YouTube timestamp for a valid identity", async () => {
    const result = await settle(jumpMessage(validIdentity), senderFor(YOUTUBE_URL))

    expect(result.response).toMatchObject({ ok: true, openedNewTab: true })
    expect(harness.calls.tabsCreated).toHaveLength(1)
    expect(harness.calls.tabsCreated[0].url).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5",
    )
  })

  it("keeps the canonical bilibili part when the request omits partId", async () => {
    // The canonical key says p:2 while no partId is supplied: the parser result is
    // authoritative, so the jump must not silently fall back to the first part.
    const result = await settle(
      jumpMessage({
        platform: "bilibili",
        videoId: "BV1xx411c7mD",
        contentKey: "bilibili:BV1xx411c7mD:p:2",
      }),
      senderFor(BILIBILI_VIDEO_URL),
    )

    expect(result.response).toMatchObject({ ok: true, openedNewTab: true })
    expect(harness.calls.tabsCreated).toHaveLength(1)
    expect(harness.calls.tabsCreated[0].url).toBe(
      "https://www.bilibili.com/video/BV1xx411c7mD/?p=2&t=5",
    )
  })

  it("still seeks inside the current tab when it shows the same canonical contentKey", async () => {
    harness.activeTabs = [{ id: 7, url: YOUTUBE_URL } as chrome.tabs.Tab]
    harness.tabLookup = (tabId) => ({ id: tabId, url: YOUTUBE_URL })
    harness.tabMessageResponder = async () => ({
      ok: true,
      type: JUMP_TO_TIMESTAMP,
      jumped: true,
    })

    const result = await settle(jumpMessage(validIdentity), senderFor(YOUTUBE_URL))

    // Identity normalization must not break the in-tab path: the canonical identity is
    // still recognized by `isTabShowingVideo`, so no tab is created.
    expect(result.response).toMatchObject({
      ok: true,
      tabId: 7,
      jumped: true,
      openedNewTab: false,
    })
    expect(harness.calls.tabsCreated).toHaveLength(0)
    expect(harness.calls.tabMessages).toHaveLength(1)
    expect(harness.calls.tabMessages[0].message).toEqual({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: JUMP_TO_TIMESTAMP,
      timestampSeconds: 5,
    })
  })
})

describe("background inbound boundary: bilibili network gating", () => {
  function resourceMessage(url = BILIBILI_RESOURCE_URL) {
    return { channel: RUNTIME_MESSAGE_NAMESPACE, type: FETCH_BILIBILI_RESOURCE, url }
  }

  it("pins the request init for an authorized bilibili sender", async () => {
    const result = await settle(resourceMessage(), senderFor(BILIBILI_VIDEO_URL, 11))

    expect(result.response).toEqual({
      ok: true,
      type: FETCH_BILIBILI_RESOURCE,
      tabId: 11,
      status: 200,
      body: "{}",
      encoding: "utf8",
    })
    expect(harness.calls.fetches).toHaveLength(1)
    const [request] = harness.calls.fetches
    expect(request.url).toBe(BILIBILI_RESOURCE_URL)
    expect(request.init?.method).toBe("GET")
    expect(request.init?.redirect).toBe("error")
    expect(request.init?.credentials).toBe("include")
    expect(request.init?.cache).toBe("no-store")
    expect(request.init?.referrer).toBe("https://www.bilibili.com/")
    expect(request.init?.referrerPolicy).toBe("strict-origin-when-cross-origin")
    expect(request.init?.headers).toEqual({ Accept: "application/json, text/plain, */*" })
  })

  it("refuses to fetch for a sender that is not a supported bilibili video page", async () => {
    for (const url of [
      "https://example.com/",
      "https://www.bilibili.com/",
      "https://m.bilibili.com/video/BV1xx411c7mD",
      "chrome-extension://test-extension-id/sidepanel.html",
    ]) {
      const result = await settle(resourceMessage(), senderFor(url, 12))

      expect(result.responded).toBe(true)
      expect(result.response).toMatchObject({
        ok: false,
        type: FETCH_BILIBILI_RESOURCE,
        error: "Bilibili resource request is not allowed from this page.",
      })
      expect(harness.calls.fetches).toHaveLength(0)
    }
  })

  it("refuses to fetch when no sender context is available at all", async () => {
    const result = await settle(resourceMessage(), {})

    expect(result.response).toMatchObject({ ok: false, type: FETCH_BILIBILI_RESOURCE })
    expect(harness.calls.fetches).toHaveLength(0)
  })

  it("rejects non-allowlisted resource urls before the handler runs", async () => {
    for (const url of [
      "https://api.bilibili.com.evil.example/x/player/v2",
      "https://evil-hdslb.com/subtitle.json",
      "http://api.bilibili.com/x/player/v2",
      "file:///C:/private.txt",
      "javascript:alert(1)",
    ]) {
      const result = await settle(resourceMessage(url), senderFor(BILIBILI_VIDEO_URL, 11))

      expect(result.returned).toBeUndefined()
      expect(result.responded).toBe(false)
      expect(harness.calls.fetches).toHaveLength(0)
    }
  })

  it("base64 encodes the binary subtitle endpoint", async () => {
    harness.fetchResponder = () => new Response(new Uint8Array([1, 2, 3]))

    const result = await settle(resourceMessage(BILIBILI_BINARY_URL), senderFor(BILIBILI_VIDEO_URL, 11))

    expect(result.response).toEqual({
      ok: true,
      type: FETCH_BILIBILI_RESOURCE,
      tabId: 11,
      status: 200,
      body: "AQID",
      encoding: "base64",
    })
  })

  it("surfaces an oversized response as a failure instead of a truncated body", async () => {
    harness.fetchResponder = () =>
      new Response("", { headers: { "content-length": String(9 * 1024 * 1024) } })

    const result = await settle(resourceMessage(), senderFor(BILIBILI_VIDEO_URL, 11))

    expect(harness.calls.fetches).toHaveLength(1)
    expect(result.response).toMatchObject({
      ok: false,
      type: FETCH_BILIBILI_RESOURCE,
      error: SIZE_LIMIT_ERROR,
    })
  })
})

describe("background inbound boundary: privileged actions stay reachable", () => {
  it("opens the side panel only for a recognized request", async () => {
    const result = await settle(
      { channel: RUNTIME_MESSAGE_NAMESPACE, type: OPEN_SIDEPANEL, tabId: 42 },
      senderFor(YOUTUBE_URL),
    )

    expect(result.response).toEqual({ ok: true, type: OPEN_SIDEPANEL, tabId: 42, opened: true })
    expect(harness.calls.sidePanelOpens).toEqual([{ tabId: 42 }])
    expect(harness.calls.tabQueries).toHaveLength(0)
  })
})
