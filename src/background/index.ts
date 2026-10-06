import type { CurrentVideoContext } from "@/lib/runtime/current-video"
import { getYouTubeWatchPage, normalizeWatchUrl } from "@/lib/runtime/page-detection"
import {
  ANALYZE_VIDEO,
  FETCH_VIDEO_TRANSCRIPT,
  GET_ACTIVE_VIDEO_CONTEXT,
  JUMP_TO_TIMESTAMP,
  OPEN_SIDEPANEL,
  RUNTIME_MESSAGE_NAMESPACE,
  type ContentScriptRequestMessage,
  type ContentScriptResponseMessage,
  type RuntimeRequestMessage,
  type RuntimeResponseMessage,
  isRuntimeRequestMessage
} from "@/lib/runtime/messages"

const UNSUPPORTED_CONTEXT: CurrentVideoContext = {
  pageType: "unsupported",
  videoId: null,
  url: "",
  canonicalUrl: null,
  title: null,
  channelName: null,
  timestampSeconds: 0,
  isReady: false
}

// Open the sidepanel when the toolbar icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    await openSidepanel(tab.id)
  }
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isRuntimeRequestMessage(message)) {
    return
  }

  void handleRuntimeMessage(message).then(sendResponse)

  return true
})

async function handleRuntimeMessage(
  message: RuntimeRequestMessage
): Promise<RuntimeResponseMessage> {
  const tabId = await resolveTabId(getRequestedTabId(message))

  try {
    switch (message.type) {
      case GET_ACTIVE_VIDEO_CONTEXT: {
        const context = await requestCurrentVideoContext(tabId)

        return {
          ok: true,
          type: GET_ACTIVE_VIDEO_CONTEXT,
          tabId,
          context
        }
      }
      case OPEN_SIDEPANEL: {
        const opened = await openSidepanel(tabId)

        return {
          ok: true,
          type: OPEN_SIDEPANEL,
          tabId,
          opened
        }
      }
      case ANALYZE_VIDEO: {
        const context = await requestCurrentVideoContext(tabId)

        return {
          ok: true,
          type: ANALYZE_VIDEO,
          tabId,
          context,
          accepted: context.isReady
        }
      }
      case JUMP_TO_TIMESTAMP: {
        const isCorrectTab = await isTabShowingVideo(tabId, message.videoId)

        if (isCorrectTab) {
          const jumped = await jumpToTimestamp(tabId, message.timestampSeconds)
          return {
            ok: true,
            type: JUMP_TO_TIMESTAMP,
            tabId,
            timestampSeconds: message.timestampSeconds,
            jumped,
            openedNewTab: false
          }
        }

        const seconds = Math.floor(message.timestampSeconds)
        const newTab = await chrome.tabs.create({
          url: `https://www.youtube.com/watch?v=${encodeURIComponent(message.videoId)}&t=${seconds}`,
          active: true
        })

        return {
          ok: true,
          type: JUMP_TO_TIMESTAMP,
          tabId: newTab.id ?? null,
          timestampSeconds: message.timestampSeconds,
          jumped: true,
          openedNewTab: true
        }
      }
      case FETCH_VIDEO_TRANSCRIPT: {
        const transcript = await requestVideoTranscript(tabId)

        return {
          ok: true,
          type: FETCH_VIDEO_TRANSCRIPT,
          tabId,
          metadata: transcript.metadata,
          transcript: transcript.transcript,
        }
      }
    }
  } catch (error) {
    return {
      ok: false,
      type: message.type,
      tabId,
      error: error instanceof Error ? error.message : "Unknown background failure."
    }
  }
}

function getRequestedTabId(message: RuntimeRequestMessage): number | undefined {
  return "tabId" in message ? message.tabId : undefined
}

async function resolveTabId(explicitTabId?: number): Promise<number | null> {
  if (typeof explicitTabId === "number") {
    return explicitTabId
  }

  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  })

  return activeTab?.id ?? null
}

async function requestCurrentVideoContext(tabId: number | null) {
  if (tabId === null) {
    return UNSUPPORTED_CONTEXT
  }

  const tab = await getTab(tabId)
  if (!tab?.url) {
    return createUnsupportedContext(tab)
  }

  const watchPage = readWatchPage(tab.url)
  if (!watchPage.isWatchPage) {
    return createUnsupportedContext(tab)
  }

  try {
    return await readCurrentVideoContextFromContent(tabId)
  } catch (error) {
    if (isMissingContentReceiverError(error)) {
      if (await injectYouTubeContentScript(tabId, tab)) {
        return await readCurrentVideoContextFromContent(tabId)
      }

      return createWatchFallbackContext(tab, watchPage.videoId)
    }

    throw error
  }
}

async function sendContentScriptMessage(
  tabId: number,
  message: ContentScriptRequestMessage,
): Promise<ContentScriptResponseMessage> {
  return (await chrome.tabs.sendMessage(tabId, message)) as ContentScriptResponseMessage
}

async function injectYouTubeContentScript(
  tabId: number,
  tab: chrome.tabs.Tab,
): Promise<boolean> {
  if (!tab.url || !readWatchPage(tab.url).isWatchPage) {
    return false
  }

  const files = getYouTubeContentScriptFiles()
  const chromeWithScripting = chrome as typeof chrome & {
    scripting?: {
      executeScript: (details: {
        target: { tabId: number }
        files: string[]
      }) => Promise<unknown> | void
    }
  }

  if (files.length === 0 || !chromeWithScripting.scripting?.executeScript) {
    return false
  }

  try {
    await chromeWithScripting.scripting.executeScript({
      target: { tabId },
      files,
    })
    return true
  } catch {
    return false
  }
}

function getYouTubeContentScriptFiles(): string[] {
  const manifest = chrome.runtime.getManifest() as {
    content_scripts?: Array<{
      matches?: string[]
      js?: string[]
    }>
  }
  const contentScript = manifest.content_scripts?.find((script) =>
    script.js?.some((file) => file.includes("youtube-watch"))
    || script.matches?.some((match) => match.includes("youtube.com"))
  )

  return contentScript?.js ?? []
}

async function readCurrentVideoContextFromContent(tabId: number): Promise<CurrentVideoContext> {
  const response = await sendContentScriptMessage(tabId, {
    channel: RUNTIME_MESSAGE_NAMESPACE,
    type: GET_ACTIVE_VIDEO_CONTEXT,
  })

  if (response.ok === false) {
    throw new Error(response.error)
  }

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

function readWatchPage(url: string) {
  try {
    return getYouTubeWatchPage(url)
  } catch {
    return {
      href: url,
      pathname: "",
      search: "",
      videoId: null,
      isWatchPage: false,
    }
  }
}

function createUnsupportedContext(tab: chrome.tabs.Tab | null = null): CurrentVideoContext {
  return {
    ...UNSUPPORTED_CONTEXT,
    url: tab?.url ?? "",
  }
}

function createWatchFallbackContext(
  tab: chrome.tabs.Tab,
  videoId: string | null,
): CurrentVideoContext {
  return {
    pageType: "watch",
    videoId,
    url: tab.url ?? "",
    canonicalUrl: tab.url ? normalizeWatchUrl(tab.url) : null,
    title: normalizeTabTitle(tab.title),
    channelName: null,
    timestampSeconds: 0,
    isReady: false,
  }
}

function normalizeTabTitle(title: string | undefined): string | null {
  const normalized = title?.replace(/ - YouTube$/, "").trim()

  return normalized ? normalized : null
}

async function isTabShowingVideo(tabId: number | null, videoId: string): Promise<boolean> {
  if (tabId === null) {
    return false
  }

  try {
    const tab = await chrome.tabs.get(tabId)
    if (!tab.url) {
      return false
    }
    const url = new URL(tab.url)
    return (
      (url.hostname === "www.youtube.com" || url.hostname === "youtube.com") &&
      url.searchParams.get("v") === videoId
    )
  } catch {
    return false
  }
}

async function jumpToTimestamp(
  tabId: number | null,
  timestampSeconds: number
): Promise<boolean> {
  if (tabId === null) {
    return false
  }

  let response: ContentScriptResponseMessage

  try {
    response = (await chrome.tabs.sendMessage(tabId, {
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: JUMP_TO_TIMESTAMP,
      timestampSeconds
    })) as ContentScriptResponseMessage
  } catch (error) {
    if (isMissingContentReceiverError(error)) {
      return false
    }

    throw error
  }

  if (response.ok === false) {
    throw new Error(response.error)
  }

  if (response.type !== JUMP_TO_TIMESTAMP) {
    throw new Error("Content script returned an unexpected response type.")
  }

  return response.jumped
}

async function openSidepanel(tabId: number | null): Promise<boolean> {
  if (tabId === null) {
    return false
  }

  const chromeWithSidePanel = chrome as typeof chrome & {
    sidePanel?: {
      open: (options: { tabId: number }) => Promise<void> | void
    }
  }

  if (!chromeWithSidePanel.sidePanel) {
    return false
  }

  await chromeWithSidePanel.sidePanel.open({ tabId })

  return true
}

async function requestVideoTranscript(tabId: number | null) {
  if (tabId === null) {
    throw new Error("Open a supported YouTube watch page before analyzing.")
  }

  const tab = await getTab(tabId)
  if (!tab?.url || !readWatchPage(tab.url).isWatchPage) {
    throw new Error("Open a supported YouTube watch page before analyzing.")
  }

  let response: ContentScriptResponseMessage

  try {
    response = await sendContentScriptMessage(tabId, {
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: FETCH_VIDEO_TRANSCRIPT,
    })
  } catch (error) {
    if (isMissingContentReceiverError(error)) {
      if (await injectYouTubeContentScript(tabId, tab)) {
        response = await sendContentScriptMessage(tabId, {
          channel: RUNTIME_MESSAGE_NAMESPACE,
          type: FETCH_VIDEO_TRANSCRIPT,
        })
      } else {
        throw new Error("Open a supported YouTube watch page before analyzing.")
      }
    } else {
      throw error
    }
  }

  if (response.ok === false) {
    throw new Error(response.error)
  }

  if (response.type !== FETCH_VIDEO_TRANSCRIPT) {
    throw new Error("Content script returned an unexpected response type.")
  }

  return response
}

function isMissingContentReceiverError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes("Could not establish connection. Receiving end does not exist.")
  )
}
