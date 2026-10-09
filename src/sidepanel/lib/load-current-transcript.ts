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
  isCurrent: () => boolean
  sendMessage?: () => Promise<TranscriptResponse>
}

export type CurrentTranscriptResult = {
  video: VideoInfo
  transcript: VideoTranscript
}

export async function loadCurrentTranscript({
  requestedContentKey,
  isCurrent,
  sendMessage = () => sendRuntimeMessage({
    channel: RUNTIME_MESSAGE_NAMESPACE,
    type: FETCH_VIDEO_TRANSCRIPT,
  }),
}: LoadCurrentTranscriptOptions): Promise<CurrentTranscriptResult> {
  const response = await sendMessage()

  if (response.ok === false) throw new Error(response.error)
  if (response.type !== FETCH_VIDEO_TRANSCRIPT) {
    throw new Error("The active video tab returned an unexpected transcript response.")
  }
  if (response.video.contentKey !== requestedContentKey || !isCurrent()) {
    throw new StaleTranscriptError()
  }

  return {
    video: response.video,
    transcript: response.transcript,
  }
}
