import { resolvePlatformAdapter } from "@/features/platform/registry"
import { createActiveVideoBridge, readActiveVideoContext } from "@/lib/runtime/current-video"
import {
  FETCH_VIDEO_TRANSCRIPT,
  GET_ACTIVE_VIDEO_CONTEXT,
  JUMP_TO_TIMESTAMP,
  type ContentScriptRequestMessage,
  type ContentScriptResponseMessage,
  isContentScriptRequestMessage,
} from "@/lib/runtime/messages"

const DIAGNOSTIC_LOGGING_KEY = "yt-summarizer.diagnostic-logging"
const CONTENT_BRIDGE_KEY = "__videoSummaryAssistantContentBridgeMounted"

type WindowWithContentBridge = Window & { [CONTENT_BRIDGE_KEY]?: boolean }

async function isDiagnosticLoggingEnabled(): Promise<boolean> {
  try {
    const data = await chrome.storage.local.get(DIAGNOSTIC_LOGGING_KEY)
    return data[DIAGNOSTIC_LOGGING_KEY] === true
  } catch {
    return false
  }
}

export const config = {
  // Plasmo requires a literal array to emit content_scripts.matches in the build.
  // youtube-url.test.ts asserts these stay aligned with the adapter support helper.
  matches: [
    "https://www.youtube.com/watch*",
    "https://youtube.com/watch*",
  ],
  run_at: "document_idle",
}

if (
  typeof window !== "undefined"
  && typeof chrome !== "undefined"
  && chrome.runtime?.onMessage
  && !(window as WindowWithContentBridge)[CONTENT_BRIDGE_KEY]
) {
  ;(window as WindowWithContentBridge)[CONTENT_BRIDGE_KEY] = true
  createActiveVideoBridge({ document, window })

  chrome.runtime.onMessage.addListener((
    message: ContentScriptRequestMessage,
    _sender,
    sendResponse: (response: ContentScriptResponseMessage) => void,
  ) => {
    if (!isContentScriptRequestMessage(message)) return

    if (message.type === GET_ACTIVE_VIDEO_CONTEXT) {
      void readActiveVideoContext(document, window.location)
        .then((context) => sendResponse({ ok: true, type: GET_ACTIVE_VIDEO_CONTEXT, context }))
        .catch((error) => sendResponse({
          ok: false,
          type: GET_ACTIVE_VIDEO_CONTEXT,
          error: formatError(error, "Unable to read the active video context."),
        }))
      return true
    }

    const adapter = resolvePlatformAdapter(window.location.href)
    if (!adapter) {
      sendResponse({
        ok: false,
        type: message.type,
        error: "Open a supported video page before continuing.",
      })
      return
    }

    const env = {
      document,
      location: new URL(window.location.href),
      fetch: (input: string | URL, init?: RequestInit) => fetch(input, init),
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
      void Promise.all([
        adapter.readVideoInfo(env),
        isDiagnosticLoggingEnabled().then((enabled) => adapter.getTranscript({
          ...env,
          diagnosticLoggingEnabled: enabled,
        })),
      ]).then(([video, transcript]) => sendResponse({
        ok: true,
        type: FETCH_VIDEO_TRANSCRIPT,
        video,
        transcript,
      })).catch((error) => sendResponse({
        ok: false,
        type: FETCH_VIDEO_TRANSCRIPT,
        error: formatError(error, "Unable to fetch the video transcript."),
      }))
      return true
    }
  })
}

export async function fetchVideoTranscript(
  document: Document,
  locationLike: Location,
): Promise<ContentScriptResponseMessage> {
  const adapter = resolvePlatformAdapter(locationLike.href)
  if (!adapter) {
    return {
      ok: false,
      type: FETCH_VIDEO_TRANSCRIPT,
      error: "Open a supported video page before analyzing.",
    }
  }

  const env = {
    document,
    location: new URL(locationLike.href),
    fetch: (input: string | URL, init?: RequestInit) => fetch(input, init),
    diagnosticLoggingEnabled: await isDiagnosticLoggingEnabled(),
  }

  try {
    const [video, transcript] = await Promise.all([
      adapter.readVideoInfo(env),
      adapter.getTranscript(env),
    ])
    return { ok: true, type: FETCH_VIDEO_TRANSCRIPT, video, transcript }
  } catch (error) {
    return {
      ok: false,
      type: FETCH_VIDEO_TRANSCRIPT,
      error: formatError(error, "Unable to fetch the video transcript."),
    }
  }
}

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
