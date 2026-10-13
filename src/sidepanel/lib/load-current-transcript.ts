import type { VideoInfo, VideoTranscript } from "@/features/platform/types"
import {
  FETCH_VIDEO_TRANSCRIPT,
  RUNTIME_MESSAGE_NAMESPACE,
  sendRuntimeMessage,
  type RuntimeMessageParseError,
  type RuntimeResponseMessage,
} from "@/lib/runtime/messages"

export class StaleTranscriptError extends Error {
  constructor() {
    super("The video part changed while captions were loading. Retry the current part.")
    this.name = "StaleTranscriptError"
  }
}

type TranscriptResponse = RuntimeResponseMessage | RuntimeMessageParseError

type LoadCurrentTranscriptOptions = {
  requestedContentKey: string
  tabId?: number
  isCurrent: () => boolean
  sendMessage?: () => Promise<TranscriptResponse>
}

export type CurrentTranscriptResult = {
  video: VideoInfo
  transcript: VideoTranscript
}

export async function resolveCurrentTranscript({
  requestedContentKey,
  isCurrent,
  forceReload = false,
  sessionResult,
  loadCached,
  loadRemote = () => loadCurrentTranscript({ requestedContentKey, isCurrent }),
}: {
  requestedContentKey: string
  isCurrent: () => boolean
  forceReload?: boolean
  sessionResult?: CurrentTranscriptResult | null
  loadCached?: () => Promise<CurrentTranscriptResult | null>
  loadRemote?: () => Promise<CurrentTranscriptResult>
}): Promise<CurrentTranscriptResult> {
  if (
    !forceReload
    && sessionResult?.video.contentKey === requestedContentKey
    && sessionResult.transcript.segments.length > 0
  ) {
    return sessionResult
  }
  if (!forceReload && loadCached) {
    const cached = await loadCached()
    if (cached && isCurrent()) return cached
  }
  return loadRemote()
}

export async function loadCurrentTranscript({
  requestedContentKey,
  tabId,
  isCurrent,
  sendMessage = () => sendRuntimeMessage({
    channel: RUNTIME_MESSAGE_NAMESPACE,
    type: FETCH_VIDEO_TRANSCRIPT,
    ...(tabId === undefined ? {} : { tabId }),
  }),
}: LoadCurrentTranscriptOptions): Promise<CurrentTranscriptResult> {
  const response = await sendMessage()

  if (response.ok === false) throw new Error(response.error)
  if (response.type !== FETCH_VIDEO_TRANSCRIPT) {
    throw new Error("The active video tab returned an unexpected transcript response.")
  }
  if (
    response.video.contentKey !== requestedContentKey
    || (tabId !== undefined && response.tabId !== tabId)
    || !isCurrent()
  ) {
    throw new StaleTranscriptError()
  }

  return {
    video: response.video,
    transcript: response.transcript,
  }
}
