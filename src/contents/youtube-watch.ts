import {
  createCurrentVideoBridge,
  isSupportedCurrentVideoPage,
  jumpToVideoTimestamp,
  readCurrentVideoContext
} from "@/lib/runtime/current-video"
import {
  FETCH_VIDEO_TRANSCRIPT,
  GET_ACTIVE_VIDEO_CONTEXT,
  JUMP_TO_TIMESTAMP,
  type ContentScriptRequestMessage,
  type ContentScriptResponseMessage,
  isContentScriptRequestMessage
} from "@/lib/runtime/messages"
import { fetchTranscriptDom } from "@/features/transcript/lib/fetch-transcript-dom"
import { fetchTranscriptPanel } from "@/features/transcript/lib/fetch-transcript-panel"
import { createLogCollector } from "@/features/transcript/lib/transcript-log"
import { fetchVtt } from "@/features/transcript/lib/fetch-vtt"
import { readPageMetadata } from "@/features/youtube/lib/read-page-metadata"
import {
  TranscriptUnsupportedError,
  type FetchVttFailure,
  type FetchVttResult,
} from "@/features/transcript/lib/transcript-schema"

const DIAGNOSTIC_LOGGING_KEY = "yt-summarizer.diagnostic-logging"
const CONTENT_BRIDGE_KEY = "__ytSummarizerContentBridgeMounted"

type WindowWithContentBridge = Window & {
  [CONTENT_BRIDGE_KEY]?: boolean
}

async function isDiagnosticLoggingEnabled(): Promise<boolean> {
  try {
    const data = await chrome.storage.local.get(DIAGNOSTIC_LOGGING_KEY)
    return data[DIAGNOSTIC_LOGGING_KEY] === true
  } catch {
    return false
  }
}

export const config = {
  matches: [
    "https://www.youtube.com/watch*",
    "https://youtube.com/watch*",
    "https://m.youtube.com/watch*"
  ],
  run_at: "document_idle"
}

if (
  typeof window !== "undefined"
  && typeof chrome !== "undefined"
  && chrome.runtime?.onMessage
  && !(window as WindowWithContentBridge)[CONTENT_BRIDGE_KEY]
) {
  ;(window as WindowWithContentBridge)[CONTENT_BRIDGE_KEY] = true

  createCurrentVideoBridge({
    document,
    window
  })

  chrome.runtime.onMessage.addListener(
    (
      message: ContentScriptRequestMessage,
      _sender,
      sendResponse: (response: ContentScriptResponseMessage) => void
    ) => {
      if (!isContentScriptRequestMessage(message)) {
        return
      }

      if (message.type === GET_ACTIVE_VIDEO_CONTEXT) {
        sendResponse({
          ok: true,
          type: GET_ACTIVE_VIDEO_CONTEXT,
          context: readCurrentVideoContext(document, window.location)
        })

        return
      }

      if (message.type === JUMP_TO_TIMESTAMP) {
        sendResponse({
          ok: true,
          type: JUMP_TO_TIMESTAMP,
          timestampSeconds: message.timestampSeconds,
          jumped: jumpToVideoTimestamp(document, message.timestampSeconds)
        })

        return
      }

      if (message.type === FETCH_VIDEO_TRANSCRIPT) {
        void fetchVideoTranscript(document, window.location)
          .then(sendResponse)
          .catch((error) => {
            sendResponse({
              ok: false,
              type: FETCH_VIDEO_TRANSCRIPT,
              error: error instanceof Error ? error.message : "Unable to fetch the YouTube transcript."
            })
          })

        return true
      }
    }
  )
}

export async function fetchVideoTranscript(
  document: Document,
  locationLike: Location,
): Promise<ContentScriptResponseMessage> {
  if (!isSupportedCurrentVideoPage(locationLike)) {
    return {
      ok: false,
      type: FETCH_VIDEO_TRANSCRIPT,
      error: "Open a supported YouTube watch page before analyzing.",
    }
  }

  const html = document.documentElement.outerHTML
  const pageUrl = locationLike.href
  const metadata = readPageMetadata(pageUrl, html)
  const loggingEnabled = await isDiagnosticLoggingEnabled()
  const collector = loggingEnabled
    ? createLogCollector(metadata.videoId, pageUrl)
    : null

  // Step 1: In-page timedtext endpoints
  const transcript = await runTranscriptStep({
    stepName: "fetchVtt",
    run: () => fetchVtt({ tracks: metadata.tracks, fetchImpl: (input, init) => fetch(input, init) }),
    collector,
    details: `${metadata.tracks.length} track(s) found`,
  })

  if (transcript.ok) {
    collector?.finalize("success", "fetchVtt")
    return {
      ok: true,
      type: FETCH_VIDEO_TRANSCRIPT,
      metadata,
      transcript,
    }
  }

  // Step 2: Innertube transcript panel API
  const panelResult = await runTranscriptStep({
    stepName: "fetchTranscriptPanel",
    run: () => fetchTranscriptPanel({ metadata, pageUrl, fetchImpl: (input, init) => fetch(input, init) }),
    collector,
    details: metadata.transcriptPanel ? "panel bootstrap available" : "no panel bootstrap",
  })

  if (panelResult?.ok) {
    collector?.finalize("success", "fetchTranscriptPanel")
    return {
      ok: true,
      type: FETCH_VIDEO_TRANSCRIPT,
      metadata,
      transcript: panelResult,
    }
  }

  // Step 3: Rendered DOM transcript
  const transcriptDomResult = await runTranscriptStep({
    stepName: "fetchTranscriptDom",
    run: () => fetchTranscriptDom({ document, metadata }),
    collector,
  })

  if (transcriptDomResult.ok) {
    collector?.finalize("success", "fetchTranscriptDom")
    return {
      ok: true,
      type: FETCH_VIDEO_TRANSCRIPT,
      metadata,
      transcript: transcriptDomResult,
    }
  }

  // All browser transcript paths exhausted — collect error details from each step
  const errors: string[] = []

  if (transcript.ok === false) {
    errors.push(transcript.error.details ?? transcript.error.message)
  }
  if (panelResult !== null && panelResult.ok === false) {
    errors.push(`Panel: ${panelResult.error.details ?? panelResult.error.message}`)
  }
  if (transcriptDomResult.ok === false) {
    errors.push(`DOM: ${transcriptDomResult.error.details ?? transcriptDomResult.error.message}`)
  }
  collector?.finalize("all_failed")

  const details = errors.join("; ")

  return {
    ok: false,
    type: FETCH_VIDEO_TRANSCRIPT,
    error: details,
  }
}

async function runTranscriptStep<T extends FetchVttResult | null>({
  stepName,
  run,
  collector,
  details,
}: {
  stepName: string
  run: () => Promise<T>
  collector: ReturnType<typeof createLogCollector> | null
  details?: string
}): Promise<T | FetchVttFailure> {
  try {
    return collector
      ? await collector.logStep(stepName, run, details)
      : await run()
  } catch (error) {
    return {
      ok: false,
      error: new TranscriptUnsupportedError(
        "transcript_request_failed",
        `${stepName} failed: ${formatThrownError(error)}`,
      ),
    }
  }
}

function formatThrownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  return "Unknown transcript fallback error"
}
