import type { VideoPlatformAdapter, PlatformPageEnvironment } from "@/features/platform/adapter"
import type { FetchLike } from "@/features/transcript/lib/transcript-schema"
import { getBilibiliVideoUrlError } from "@/features/platform/bilibili/bilibili-url"
import { ACTIVE_VIDEO_EVENT, createActiveVideoBridge, readActiveVideoContext } from "@/lib/runtime/current-video"
import {
  CONTENT_VIDEO_CONTEXT_CHANGED,
  FETCH_VIDEO_TRANSCRIPT,
  GET_ACTIVE_VIDEO_CONTEXT,
  JUMP_TO_TIMESTAMP,
  READ_YOUTUBE_LIVE_PLAYER_STATE,
  RUNTIME_MESSAGE_NAMESPACE,
  isYouTubeLivePlayerStateResponse,
  type ContentScriptRequestMessage,
  type ContentScriptResponseMessage,
  isContentScriptRequestMessage,
} from "@/lib/runtime/messages"

const DIAGNOSTIC_LOGGING_KEY = "yt-summarizer.diagnostic-logging"
const CONTENT_BRIDGE_KEY = "__videoSummaryAssistantContentBridgeMounted"

type WindowWithContentBridge = Window & { [CONTENT_BRIDGE_KEY]?: boolean }

type PlatformContentBridgeOptions = {
  document: Document
  window: Window
  resolveAdapter: (url: URL | string) => VideoPlatformAdapter | null
  fetch: FetchLike
}

export async function isDiagnosticLoggingEnabled(): Promise<boolean> {
  try {
    const data = await chrome.storage.local.get(DIAGNOSTIC_LOGGING_KEY)
    return data[DIAGNOSTIC_LOGGING_KEY] === true
  } catch {
    return false
  }
}

export function installPlatformContentBridge({
  document,
  window,
  resolveAdapter,
  fetch,
}: PlatformContentBridgeOptions): void {
  if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return
  const bridgeWindow = window as WindowWithContentBridge
  if (bridgeWindow[CONTENT_BRIDGE_KEY]) return
  bridgeWindow[CONTENT_BRIDGE_KEY] = true

  const currentUrl = () => new URL(window.location.href)
  const pageFetch: FetchLike = (input, init) => fetch(input, init)
  const readYouTubeLivePlayerState = async (videoId: string) => {
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        channel: RUNTIME_MESSAGE_NAMESPACE,
        type: READ_YOUTUBE_LIVE_PLAYER_STATE,
        videoId,
      })
      return isYouTubeLivePlayerStateResponse(response) && response.ok
        ? response.playerState
        : null
    } catch {
      return null
    }
  }
  createActiveVideoBridge({ document, window, fetch: pageFetch, readYouTubeLivePlayerState })
  const publishRuntimeContext = (event: Event) => {
    const context = (event as CustomEvent<unknown>).detail
    void chrome.runtime.sendMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: CONTENT_VIDEO_CONTEXT_CHANGED,
      context,
    }).catch(() => undefined)
  }
  window.addEventListener(ACTIVE_VIDEO_EVENT, publishRuntimeContext)

  chrome.runtime.onMessage.addListener((
    message: ContentScriptRequestMessage,
    _sender,
    sendResponse: (response: ContentScriptResponseMessage) => void,
  ) => {
    if (!isContentScriptRequestMessage(message)) return

    if (message.type === GET_ACTIVE_VIDEO_CONTEXT) {
      void readActiveVideoContext(
        document,
        window.location,
        pageFetch,
        currentUrl,
        readYouTubeLivePlayerState,
      )
        .then((context) => sendResponse({ ok: true, type: GET_ACTIVE_VIDEO_CONTEXT, context }))
        .catch((error) => sendResponse({
          ok: false,
          type: GET_ACTIVE_VIDEO_CONTEXT,
          error: formatError(error, "Unable to read the active video context."),
        }))
      return true
    }

    const adapter = resolveAdapter(currentUrl())
    if (!adapter) {
      const specificError = getBilibiliVideoUrlError(currentUrl())
      sendResponse({
        ok: false,
        type: message.type,
        error: specificError ?? "Open a supported video page before continuing.",
      })
      return
    }

    const env: PlatformPageEnvironment = {
      document,
      location: currentUrl(),
      getCurrentUrl: currentUrl,
      fetch: pageFetch,
      readYouTubeLivePlayerState,
    }

    if (message.type === JUMP_TO_TIMESTAMP) {
      sendResponse({
        ok: true,
        type: JUMP_TO_TIMESTAMP,
        timestampSeconds: message.timestampSeconds,
        jumped: adapter.seek(env, message.timestampSeconds),
      })
      return
    }

    if (message.type === FETCH_VIDEO_TRANSCRIPT) {
      void fetchPlatformVideoTranscript(adapter, env, isDiagnosticLoggingEnabled)
        .then(sendResponse)
      return true
    }
  })
}

export async function fetchPlatformVideoTranscript(
  adapter: VideoPlatformAdapter | null,
  env: PlatformPageEnvironment,
  getDiagnosticLogging: () => Promise<boolean> = isDiagnosticLoggingEnabled,
): Promise<ContentScriptResponseMessage> {
  if (!adapter) {
    const specificError = getBilibiliVideoUrlError(env.location)
    return {
      ok: false,
      type: FETCH_VIDEO_TRANSCRIPT,
      error: specificError ?? "Open a supported video page before analyzing.",
    }
  }

  const initialIdentity = adapter.getVideoIdentity(env.location)
  if (!initialIdentity) {
    return {
      ok: false,
      type: FETCH_VIDEO_TRANSCRIPT,
      error: "Open a supported video page before analyzing.",
    }
  }

  try {
    const diagnosticLoggingEnabled = await getDiagnosticLogging()
    const requestEnv = { ...env, diagnosticLoggingEnabled }
    const [video, transcript] = await Promise.all([
      adapter.readVideoInfo(requestEnv),
      adapter.getTranscript(requestEnv),
    ])
    const currentUrl = env.getCurrentUrl?.() ?? env.location
    const currentAdapter = resolveAdapterFromIdentity(adapter, currentUrl)
    const currentIdentity = currentAdapter?.getVideoIdentity(currentUrl)
    if (
      video.contentKey !== initialIdentity.contentKey
      || currentIdentity?.contentKey !== initialIdentity.contentKey
    ) {
      return {
        ok: false,
        type: FETCH_VIDEO_TRANSCRIPT,
        error: "The video part changed while captions were loading. Retry the current part.",
      }
    }
    return { ok: true, type: FETCH_VIDEO_TRANSCRIPT, video, transcript }
  } catch (error) {
    return {
      ok: false,
      type: FETCH_VIDEO_TRANSCRIPT,
      error: formatError(error, "Unable to fetch the video transcript."),
    }
  }
}

function resolveAdapterFromIdentity(
  adapter: VideoPlatformAdapter,
  url: URL,
): VideoPlatformAdapter | null {
  return adapter.canHandle(url) ? adapter : null
}

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
