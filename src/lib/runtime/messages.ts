import { z } from "zod"

import type { CurrentVideoContext } from "@/lib/runtime/current-video"
import type { FetchVttSuccess, TranscriptPageMetadata } from "@/features/transcript/lib/transcript-schema"

export const RUNTIME_MESSAGE_NAMESPACE = "yt-summarizer/runtime"

export const GET_ACTIVE_VIDEO_CONTEXT = "get-active-video-context"
export const OPEN_SIDEPANEL = "open-sidepanel"
export const ANALYZE_VIDEO = "analyze-video"
export const JUMP_TO_TIMESTAMP = "jump-to-timestamp"
export const FETCH_VIDEO_TRANSCRIPT = "fetch-video-transcript"

export type RuntimeRequestMessage =
  | {
      channel: typeof RUNTIME_MESSAGE_NAMESPACE
      type: typeof GET_ACTIVE_VIDEO_CONTEXT
    }
  | {
      channel: typeof RUNTIME_MESSAGE_NAMESPACE
      type: typeof OPEN_SIDEPANEL
      tabId?: number
    }
  | {
      channel: typeof RUNTIME_MESSAGE_NAMESPACE
      type: typeof ANALYZE_VIDEO
      tabId?: number
    }
  | {
      channel: typeof RUNTIME_MESSAGE_NAMESPACE
      type: typeof JUMP_TO_TIMESTAMP
      tabId?: number
      videoId: string
      timestampSeconds: number
    }
  | {
      channel: typeof RUNTIME_MESSAGE_NAMESPACE
      type: typeof FETCH_VIDEO_TRANSCRIPT
      tabId?: number
    }

export type RuntimeResponseMessage =
  | {
      ok: true
      type: typeof GET_ACTIVE_VIDEO_CONTEXT
      tabId: number | null
      context: CurrentVideoContext
    }
  | {
      ok: true
      type: typeof OPEN_SIDEPANEL
      tabId: number | null
      opened: boolean
    }
  | {
      ok: true
      type: typeof ANALYZE_VIDEO
      tabId: number | null
      context: CurrentVideoContext
      accepted: boolean
    }
  | {
      ok: true
      type: typeof JUMP_TO_TIMESTAMP
      tabId: number | null
      timestampSeconds: number
      jumped: boolean
      openedNewTab: boolean
    }
  | {
      ok: true
      type: typeof FETCH_VIDEO_TRANSCRIPT
      tabId: number | null
      metadata: TranscriptPageMetadata
      transcript: FetchVttSuccess
    }
  | {
      ok: false
      type:
        | typeof GET_ACTIVE_VIDEO_CONTEXT
        | typeof OPEN_SIDEPANEL
        | typeof ANALYZE_VIDEO
        | typeof JUMP_TO_TIMESTAMP
        | typeof FETCH_VIDEO_TRANSCRIPT
      error: string
      tabId: number | null
    }

export type ContentScriptRequestMessage =
  | {
      channel: typeof RUNTIME_MESSAGE_NAMESPACE
      type: typeof GET_ACTIVE_VIDEO_CONTEXT
    }
  | {
      channel: typeof RUNTIME_MESSAGE_NAMESPACE
      type: typeof JUMP_TO_TIMESTAMP
      timestampSeconds: number
    }
  | {
      channel: typeof RUNTIME_MESSAGE_NAMESPACE
      type: typeof FETCH_VIDEO_TRANSCRIPT
    }

export type ContentScriptResponseMessage =
  | {
      ok: true
      type: typeof GET_ACTIVE_VIDEO_CONTEXT
      context: CurrentVideoContext
    }
  | {
      ok: true
      type: typeof JUMP_TO_TIMESTAMP
      timestampSeconds: number
      jumped: boolean
    }
  | {
      ok: true
      type: typeof FETCH_VIDEO_TRANSCRIPT
      metadata: TranscriptPageMetadata
      transcript: FetchVttSuccess
    }
  | {
      ok: false
      type: typeof GET_ACTIVE_VIDEO_CONTEXT | typeof JUMP_TO_TIMESTAMP | typeof FETCH_VIDEO_TRANSCRIPT
      error: string
    }

export function isRuntimeRequestMessage(value: unknown): value is RuntimeRequestMessage {
  return isRecord(value) && value.channel === RUNTIME_MESSAGE_NAMESPACE && typeof value.type === "string"
}

export function isContentScriptRequestMessage(
  value: unknown
): value is ContentScriptRequestMessage {
  return isRuntimeRequestMessage(value)
}

const responseTypeSchema = z.enum([
  GET_ACTIVE_VIDEO_CONTEXT,
  OPEN_SIDEPANEL,
  ANALYZE_VIDEO,
  JUMP_TO_TIMESTAMP,
  FETCH_VIDEO_TRANSCRIPT,
])

const tabIdSchema = z.number().nullable()

// Inner payload bodies are type-checked at the call site (parseAnalysisResult
// etc); here we only guard the envelope's discriminator + must-have fields so
// malformed dispatches fail loudly without crashing downstream consumers.
const fetchVttSuccessSchema = z.looseObject({
  ok: z.literal(true),
  rawVtt: z.string(),
  track: z.looseObject({
    languageCode: z.string(),
    baseUrl: z.string(),
    name: z.string().nullish(),
  }),
  sourceUrl: z.string(),
  source: z.string(),
})

const transcriptPageMetadataSchema = z.looseObject({
  videoId: z.string(),
  title: z.string().nullable(),
})

const currentVideoContextSchema = z.looseObject({
  pageType: z.string(),
  videoId: z.string().nullable(),
  url: z.string(),
  canonicalUrl: z.string().nullable(),
  title: z.string().nullable(),
  channelName: z.string().nullable(),
  timestampSeconds: z.number(),
  isReady: z.boolean(),
})

const runtimeResponseSuccessSchema = z.discriminatedUnion("type", [
  z.object({
    ok: z.literal(true),
    type: z.literal(GET_ACTIVE_VIDEO_CONTEXT),
    tabId: tabIdSchema,
    context: currentVideoContextSchema,
  }),
  z.object({
    ok: z.literal(true),
    type: z.literal(OPEN_SIDEPANEL),
    tabId: tabIdSchema,
    opened: z.boolean(),
  }),
  z.object({
    ok: z.literal(true),
    type: z.literal(ANALYZE_VIDEO),
    tabId: tabIdSchema,
    context: currentVideoContextSchema,
    accepted: z.boolean(),
  }),
  z.object({
    ok: z.literal(true),
    type: z.literal(JUMP_TO_TIMESTAMP),
    tabId: tabIdSchema,
    timestampSeconds: z.number(),
    jumped: z.boolean(),
    openedNewTab: z.boolean(),
  }),
  z.object({
    ok: z.literal(true),
    type: z.literal(FETCH_VIDEO_TRANSCRIPT),
    tabId: tabIdSchema,
    metadata: transcriptPageMetadataSchema,
    transcript: fetchVttSuccessSchema,
  }),
])

const runtimeResponseFailureSchema = z.object({
  ok: z.literal(false),
  type: responseTypeSchema,
  error: z.string(),
  tabId: tabIdSchema.nullish(),
})

const runtimeResponseMessageSchema = z.union([
  runtimeResponseSuccessSchema,
  runtimeResponseFailureSchema,
])

export type RuntimeMessageParseError = {
  ok: false
  type: "runtime-message-parse-error"
  error: string
  tabId: null
}

/**
 * Sends a runtime message and validates the response against a Zod
 * discriminated union before returning. On parse failure, returns a typed
 * error envelope so callers can distinguish "transport failed" from
 * "response malformed" without crashing the UI.
 */
export async function sendRuntimeMessage<TResponse extends RuntimeResponseMessage>(
  message: RuntimeRequestMessage
): Promise<TResponse | RuntimeMessageParseError> {
  let raw: unknown
  try {
    raw = await chrome.runtime.sendMessage(message)
  } catch (transportError) {
    return {
      ok: false,
      type: "runtime-message-parse-error",
      error:
        transportError instanceof Error
          ? transportError.message
          : "Runtime message transport failed.",
      tabId: null,
    }
  }

  const parsed = runtimeResponseMessageSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      type: "runtime-message-parse-error",
      error: `Runtime response failed validation: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")}`,
      tabId: null,
    }
  }

  return parsed.data as TResponse
}

export function isRuntimeMessageParseError(
  value: unknown
): value is RuntimeMessageParseError {
  return (
    isRecord(value) &&
    value.ok === false &&
    value.type === "runtime-message-parse-error"
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
