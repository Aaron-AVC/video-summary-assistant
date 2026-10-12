import { resolvePlatformAdapter, resolvePlatformAdapterForIdentity } from "@/features/platform/registry"
import {
  normalizeYouTubeLivePlayerState,
  readYouTubeLivePlayerStateInMainWorld,
} from "@/features/platform/youtube/youtube-live-state"
import { isAllowedBilibiliTransport } from "@/features/platform/bilibili/bilibili-transport-policy"
import {
  readBilibiliResponseBytes,
  readBilibiliResponseText,
} from "@/features/platform/bilibili/bilibili-transport"
import type { ActiveVideoContext, VideoIdentity } from "@/features/platform/types"
import { createUnsupportedVideoContext } from "@/lib/runtime/current-video"
import { matchesManifestPattern } from "@/lib/runtime/manifest-pattern"
import {
  ANALYZE_VIDEO,
  ACTIVE_VIDEO_CONTEXT_CHANGED,
  CONTENT_VIDEO_CONTEXT_CHANGED,
  FETCH_VIDEO_TRANSCRIPT,
  FETCH_BILIBILI_RESOURCE,
  GET_ACTIVE_VIDEO_CONTEXT,
  JUMP_TO_TIMESTAMP,
  OPEN_SIDEPANEL,
  READ_YOUTUBE_LIVE_PLAYER_STATE,
  RUNTIME_MESSAGE_NAMESPACE,
  type ContentScriptRequestMessage,
  type ContentScriptResponseMessage,
  type RuntimeRequestMessage,
  type RuntimeResponseMessage,
  isRuntimeRequestMessage,
  isActiveVideoContextChangedMessage,
  isContentVideoContextChangedMessage,
} from "@/lib/runtime/messages"

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) await openSidepanel(tab.id)
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isActiveVideoContextChangedMessage(message)) return
  if (isContentVideoContextChangedMessage(message)) {
    void relayActiveVideoContext(message.context, sender)
    return
  }
  if (!isRuntimeRequestMessage(message)) return
  if (message.type === READ_YOUTUBE_LIVE_PLAYER_STATE) {
    void readYouTubeLivePlayerStateFromPage(message, sender).then(sendResponse)
    return true
  }
  void handleRuntimeMessage(message, sender).then(sendResponse)
  return true
})

async function relayActiveVideoContext(context: ActiveVideoContext, sender: chrome.runtime.MessageSender) {
  const tabId = sender.tab?.id
  const senderUrl = sender.url ?? sender.tab?.url ?? ""
  let senderPageUrl: URL
  try {
    senderPageUrl = new URL(senderUrl)
  } catch {
    return
  }
  const adapter = resolvePlatformAdapter(senderPageUrl)
  const identity = adapter?.getVideoIdentity(senderPageUrl)
  if (
    tabId === undefined
    || !identity
    || context.contentKey !== identity.contentKey
    || context.url !== senderUrl
  ) return
  try {
    await chrome.runtime.sendMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: ACTIVE_VIDEO_CONTEXT_CHANGED,
      tabId,
      context,
    })
  } catch {
    // The side panel may not be open; the next explicit context read is authoritative.
  }
}

async function readYouTubeLivePlayerStateFromPage(
  message: Extract<RuntimeRequestMessage, { type: typeof READ_YOUTUBE_LIVE_PLAYER_STATE }>,
  sender?: chrome.runtime.MessageSender,
): Promise<RuntimeResponseMessage> {
  const tabId = sender?.tab?.id ?? null
  const empty = (): RuntimeResponseMessage => ({
    ok: true,
    type: READ_YOUTUBE_LIVE_PLAYER_STATE,
    tabId,
    playerState: null,
  })
  if (tabId === null || sender?.frameId !== 0) return empty()

  const senderUrl = sender.url ?? sender.tab?.url ?? ""
  let senderPageUrl: URL
  try {
    senderPageUrl = new URL(senderUrl)
  } catch {
    return empty()
  }

  const senderAdapter = resolvePlatformAdapter(senderPageUrl)
  const senderIdentity = senderAdapter?.getVideoIdentity(senderPageUrl)
  if (
    senderAdapter?.platform !== "youtube"
    || senderIdentity?.videoId !== message.videoId
  ) return empty()

  try {
    const currentTab = await getTab(tabId)
    const currentUrl = currentTab?.url ? new URL(currentTab.url) : null
    const currentAdapter = currentUrl ? resolvePlatformAdapter(currentUrl) : null
    if (currentAdapter?.getVideoIdentity(currentUrl!)?.videoId !== message.videoId) return empty()

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: readYouTubeLivePlayerStateInMainWorld,
      args: [message.videoId],
    })

    const tabAfterInjection = await getTab(tabId)
    const pageAfterInjection = tabAfterInjection?.url ? new URL(tabAfterInjection.url) : null
    const adapterAfterInjection = pageAfterInjection ? resolvePlatformAdapter(pageAfterInjection) : null
    if (adapterAfterInjection?.getVideoIdentity(pageAfterInjection!)?.videoId !== message.videoId) {
      return empty()
    }

    return {
      ok: true,
      type: READ_YOUTUBE_LIVE_PLAYER_STATE,
      tabId,
      playerState: normalizeYouTubeLivePlayerState(injection?.result, message.videoId),
    }
  } catch {
    // MAIN-world access is an optional fast path; all existing fallbacks remain available.
    return empty()
  }
}

async function handleRuntimeMessage(
  message: RuntimeRequestMessage,
  sender?: chrome.runtime.MessageSender,
): Promise<RuntimeResponseMessage> {
  const tabId = message.type === FETCH_BILIBILI_RESOURCE
    ? sender?.tab?.id ?? null
    : await resolveTabId(getRequestedTabId(message))

  try {
    switch (message.type) {
      case GET_ACTIVE_VIDEO_CONTEXT: {
        const context = await requestActiveVideoContext(tabId)
        return { ok: true, type: GET_ACTIVE_VIDEO_CONTEXT, tabId, context }
      }
      case OPEN_SIDEPANEL: {
        const opened = await openSidepanel(tabId)
        return { ok: true, type: OPEN_SIDEPANEL, tabId, opened }
      }
      case ANALYZE_VIDEO: {
        const context = await requestActiveVideoContext(tabId)
        return { ok: true, type: ANALYZE_VIDEO, tabId, context, accepted: context.isReady }
      }
      case JUMP_TO_TIMESTAMP: {
        if (!Number.isFinite(message.timestampSeconds)) {
          throw new Error("Timestamp must be a finite number.")
        }

        const adapter = resolvePlatformAdapterForIdentity(message.identity)
        if (!adapter) throw new Error("The target video platform is not supported.")

        if (await isTabShowingVideo(tabId, message.identity)) {
          const jumped = await jumpToTimestamp(tabId, message.timestampSeconds)
          return {
            ok: true,
            type: JUMP_TO_TIMESTAMP,
            tabId,
            timestampSeconds: message.timestampSeconds,
            jumped,
            openedNewTab: false,
          }
        }

        const newTab = await chrome.tabs.create({
          url: adapter.buildTimestampUrl(message.identity, message.timestampSeconds),
          active: true,
        })
        return {
          ok: true,
          type: JUMP_TO_TIMESTAMP,
          tabId: newTab.id ?? null,
          timestampSeconds: message.timestampSeconds,
          jumped: true,
          openedNewTab: true,
        }
      }
      case FETCH_VIDEO_TRANSCRIPT: {
        const result = await requestVideoTranscript(tabId)
        return {
          ok: true,
          type: FETCH_VIDEO_TRANSCRIPT,
          tabId,
          video: result.video,
          transcript: result.transcript,
        }
      }
      case FETCH_BILIBILI_RESOURCE: {
        const senderUrl = sender?.url ?? sender?.tab?.url ?? ""
        if (!isAllowedBilibiliTransport(message.url, senderUrl)) {
          throw new Error("Bilibili resource request is not allowed from this page.")
        }

        let response: Response
        try {
          response = await fetch(message.url, {
            method: "GET",
            credentials: "include",
            cache: "no-store",
            redirect: "error",
            referrer: "https://www.bilibili.com/",
            referrerPolicy: "strict-origin-when-cross-origin",
            headers: { Accept: "application/json, text/plain, */*" },
          })
        } catch {
          throw new Error("Bilibili resource request failed.")
        }
        const isBinary = new URL(message.url).pathname === "/x/v2/subtitle/web/view"
        const body = isBinary
          ? encodeBase64(await readBilibiliResponseBytes(response))
          : await readBilibiliResponseText(response)
        return {
          ok: true,
          type: FETCH_BILIBILI_RESOURCE,
          tabId,
          status: response.status,
          body,
          encoding: isBinary ? "base64" : "utf8",
        }
      }
    }
  } catch (error) {
    return {
      ok: false,
      type: message.type,
      tabId,
      error: error instanceof Error ? error.message : "Unknown background failure.",
    }
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function getRequestedTabId(message: RuntimeRequestMessage): number | undefined {
  return "tabId" in message ? message.tabId : undefined
}

async function resolveTabId(explicitTabId?: number): Promise<number | null> {
  if (typeof explicitTabId === "number") return explicitTabId
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return activeTab?.id ?? null
}

async function requestActiveVideoContext(tabId: number | null): Promise<ActiveVideoContext> {
  if (tabId === null) return createUnsupportedVideoContext()

  const tab = await getTab(tabId)
  if (!tab?.url || !resolvePlatformAdapter(tab.url)) {
    return createUnsupportedVideoContext(tab?.url ?? "")
  }

  try {
    return await readActiveVideoContextFromContent(tabId)
  } catch (error) {
    if (!isMissingContentReceiverError(error)) throw error
    if (await injectContentScript(tabId, tab.url)) {
      return await readActiveVideoContextFromContent(tabId)
    }
    return createVideoFallbackContext(tab)
  }
}

async function sendContentScriptMessage(
  tabId: number,
  message: ContentScriptRequestMessage,
): Promise<ContentScriptResponseMessage> {
  return (await chrome.tabs.sendMessage(tabId, message)) as ContentScriptResponseMessage
}

async function injectContentScript(tabId: number, tabUrl: string): Promise<boolean> {
  const files = await findMatchingContentScriptFiles(tabUrl)
  if (files.length === 0) return false
  await chrome.scripting.executeScript({ target: { tabId }, files })
  return true
}

async function findMatchingContentScriptFiles(tabUrl: string): Promise<string[]> {
  const manifest = chrome.runtime.getManifest() as chrome.runtime.Manifest & {
    content_scripts?: Array<{ matches?: string[]; js?: string[] }>
  }
  const entry = manifest.content_scripts?.find((script) =>
    script.matches?.some((pattern) => matchesManifestPattern(tabUrl, pattern)),
  )
  return entry?.js ?? []
}

async function readActiveVideoContextFromContent(tabId: number): Promise<ActiveVideoContext> {
  const response = await sendContentScriptMessage(tabId, {
    channel: RUNTIME_MESSAGE_NAMESPACE,
    type: GET_ACTIVE_VIDEO_CONTEXT,
  })
  if (response.ok === false) throw new Error(response.error)
  if (response.type !== GET_ACTIVE_VIDEO_CONTEXT) {
    throw new Error("Content script returned an unexpected response type.")
  }
  return response.context
}

async function getTab(tabId: number): Promise<chrome.tabs.Tab | null> {
  try {
    return await chrome.tabs.get(tabId)
  } catch {
    return null
  }
}

function createVideoFallbackContext(tab: chrome.tabs.Tab): ActiveVideoContext {
  const url = tab.url ?? ""
  const adapter = resolvePlatformAdapter(url)
  const identity = adapter?.getVideoIdentity(new URL(url)) ?? null
  if (!adapter || !identity) return createUnsupportedVideoContext(url)

  const canonicalUrl = new URL(adapter.buildTimestampUrl(identity, 0))
  canonicalUrl.searchParams.delete("t")
  return {
    pageType: "video",
    platform: identity.platform,
    videoId: identity.videoId,
    partId: identity.partId ?? null,
    contentKey: identity.contentKey,
    url,
    canonicalUrl: canonicalUrl.toString(),
    title: tab.title?.trim() || null,
    author: null,
    timestampSeconds: 0,
    isReady: false,
  }
}

async function isTabShowingVideo(
  tabId: number | null,
  identity: VideoIdentity,
): Promise<boolean> {
  if (tabId === null) return false
  const tab = await getTab(tabId)
  if (!tab?.url) return false
  const adapter = resolvePlatformAdapter(tab.url)
  const tabIdentity = adapter?.getVideoIdentity(new URL(tab.url))
  return tabIdentity?.contentKey === identity.contentKey
}

async function jumpToTimestamp(
  tabId: number | null,
  timestampSeconds: number,
): Promise<boolean> {
  if (tabId === null) return false
  try {
    const response = await sendContentScriptMessage(tabId, {
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: JUMP_TO_TIMESTAMP,
      timestampSeconds,
    })
    if (response.ok === false) throw new Error(response.error)
    if (response.type !== JUMP_TO_TIMESTAMP) {
      throw new Error("Content script returned an unexpected response type.")
    }
    return response.jumped
  } catch (error) {
    if (isMissingContentReceiverError(error)) return false
    throw error
  }
}

async function openSidepanel(tabId: number | null): Promise<boolean> {
  if (tabId === null) return false
  const chromeWithSidePanel = chrome as typeof chrome & {
    sidePanel?: { open: (options: { tabId: number }) => Promise<void> | void }
  }
  if (!chromeWithSidePanel.sidePanel) return false
  await chromeWithSidePanel.sidePanel.open({ tabId })
  return true
}

async function requestVideoTranscript(tabId: number | null) {
  if (tabId === null) throw new Error("Open a supported video page before analyzing.")
  const tab = await getTab(tabId)
  if (!tab?.url || !resolvePlatformAdapter(tab.url)) {
    throw new Error("Open a supported video page before analyzing.")
  }

  let response: ContentScriptResponseMessage
  try {
    response = await sendContentScriptMessage(tabId, {
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: FETCH_VIDEO_TRANSCRIPT,
    })
  } catch (error) {
    if (!isMissingContentReceiverError(error)) throw error
    if (!(await injectContentScript(tabId, tab.url))) {
      throw new Error("Open a supported video page before analyzing.")
    }
    response = await sendContentScriptMessage(tabId, {
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: FETCH_VIDEO_TRANSCRIPT,
    })
  }

  if (response.ok === false) throw new Error(response.error)
  if (response.type !== FETCH_VIDEO_TRANSCRIPT) {
    throw new Error("Content script returned an unexpected response type.")
  }
  return response
}

function isMissingContentReceiverError(error: unknown) {
  return error instanceof Error
    && error.message.includes("Could not establish connection. Receiving end does not exist.")
}
