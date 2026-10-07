import { z } from "zod"

import type {
  ActiveVideoContext,
  VideoIdentity,
  VideoInfo,
  VideoTranscript,
} from "@/features/platform/types"

export const RUNTIME_MESSAGE_NAMESPACE = "video-summary-assistant/runtime"

export const GET_ACTIVE_VIDEO_CONTEXT = "get-active-video-context"
export const OPEN_SIDEPANEL = "open-sidepanel"
export const ANALYZE_VIDEO = "analyze-video"
export const JUMP_TO_TIMESTAMP = "jump-to-timestamp"
export const FETCH_VIDEO_TRANSCRIPT = "fetch-video-transcript"

export type RuntimeRequestMessage =
  | { channel: typeof RUNTIME_MESSAGE_NAMESPACE; type: typeof GET_ACTIVE_VIDEO_CONTEXT }
  | { channel: typeof RUNTIME_MESSAGE_NAMESPACE; type: typeof OPEN_SIDEPANEL; tabId?: number }
  | { channel: typeof RUNTIME_MESSAGE_NAMESPACE; type: typeof ANALYZE_VIDEO; tabId?: number }
  | {
      channel: typeof RUNTIME_MESSAGE_NAMESPACE
      type: typeof JUMP_TO_TIMESTAMP
      tabId?: number
      identity: VideoIdentity
      timestampSeconds: number
    }
  | { channel: typeof RUNTIME_MESSAGE_NAMESPACE; type: typeof FETCH_VIDEO_TRANSCRIPT; tabId?: number }

export type RuntimeResponseMessage =
  | { ok: true; type: typeof GET_ACTIVE_VIDEO_CONTEXT; tabId: number | null; context: ActiveVideoContext }
  | { ok: true; type: typeof OPEN_SIDEPANEL; tabId: number | null; opened: boolean }
  | {
      ok: true
      type: typeof ANALYZE_VIDEO
      tabId: number | null
      context: ActiveVideoContext
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
      video: VideoInfo
      transcript: VideoTranscript
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
  | { channel: typeof RUNTIME_MESSAGE_NAMESPACE; type: typeof GET_ACTIVE_VIDEO_CONTEXT }
  | {
      channel: typeof RUNTIME_MESSAGE_NAMESPACE
      type: typeof JUMP_TO_TIMESTAMP
      timestampSeconds: number
    }
  | { channel: typeof RUNTIME_MESSAGE_NAMESPACE; type: typeof FETCH_VIDEO_TRANSCRIPT }

export type ContentScriptResponseMessage =
  | { ok: true; type: typeof GET_ACTIVE_VIDEO_CONTEXT; context: ActiveVideoContext }
  | { ok: true; type: typeof JUMP_TO_TIMESTAMP; timestampSeconds: number; jumped: boolean }
  | {
      ok: true
      type: typeof FETCH_VIDEO_TRANSCRIPT
      video: VideoInfo
      transcript: VideoTranscript
    }
  | {
      ok: false
      type: typeof GET_ACTIVE_VIDEO_CONTEXT | typeof JUMP_TO_TIMESTAMP | typeof FETCH_VIDEO_TRANSCRIPT
      error: string
    }

const requestTypeSchema = z.enum([
  GET_ACTIVE_VIDEO_CONTEXT,
  OPEN_SIDEPANEL,
  ANALYZE_VIDEO,
  JUMP_TO_TIMESTAMP,
  FETCH_VIDEO_TRANSCRIPT,
])

export function isRuntimeRequestMessage(value: unknown): value is RuntimeRequestMessage {
  return (
    isRecord(value)
    && value.channel === RUNTIME_MESSAGE_NAMESPACE
    && requestTypeSchema.safeParse(value.type).success
  )
}

export function isContentScriptRequestMessage(value: unknown): value is ContentScriptRequestMessage {
  if (!isRuntimeRequestMessage(value)) {
    return false
  }

  return value.type === GET_ACTIVE_VIDEO_CONTEXT
    || value.type === JUMP_TO_TIMESTAMP
    || value.type === FETCH_VIDEO_TRANSCRIPT
}

const tabIdSchema = z.number().int().nonnegative().nullable()
const videoPlatformSchema = z.literal("youtube")
const videoIdentitySchema = z.object({
  platform: videoPlatformSchema,
  videoId: z.string().min(1),
  partId: z.string().min(1).optional(),
  contentKey: z.string().min(1),
})
const videoInfoSchema = videoIdentitySchema.extend({
  title: z.string().min(1),
  author: z.string().nullable().optional(),
  durationSec: z.number().finite().nonnegative().nullable().optional(),
  thumbnailUrl: z.string().url().nullable().optional(),
  canonicalUrl: z.string().url(),
})
const transcriptSegmentSchema = z.object({
  startSec: z.number().finite().nonnegative(),
  endSec: z.number().finite().nonnegative(),
  text: z.string(),
})
const videoTranscriptSchema = z.object({
  segments: z.array(transcriptSegmentSchema),
  language: z.string().nullable().optional(),
  source: z.enum(["manual", "auto", "unknown"]),
  raw: z.object({
    format: z.literal("vtt"),
    text: z.string(),
    sourceUrl: z.string().url().nullable().optional(),
  }).optional(),
})
const activeVideoContextSchema = z.object({
  pageType: z.enum(["video", "unsupported"]),
  platform: videoPlatformSchema.nullable(),
  videoId: z.string().min(1).nullable(),
  partId: z.string().min(1).nullable(),
  contentKey: z.string().min(1).nullable(),
  url: z.string(),
  canonicalUrl: z.string().url().nullable(),
  title: z.string().min(1).nullable(),
  author: z.string().nullable(),
  timestampSeconds: z.number().finite().nonnegative(),
  isReady: z.boolean(),
})

const runtimeResponseSuccessSchema = z.discriminatedUnion("type", [
  z.object({
    ok: z.literal(true), type: z.literal(GET_ACTIVE_VIDEO_CONTEXT), tabId: tabIdSchema,
    context: activeVideoContextSchema,
  }),
  z.object({
    ok: z.literal(true), type: z.literal(OPEN_SIDEPANEL), tabId: tabIdSchema,
    opened: z.boolean(),
  }),
  z.object({
    ok: z.literal(true), type: z.literal(ANALYZE_VIDEO), tabId: tabIdSchema,
    context: activeVideoContextSchema, accepted: z.boolean(),
  }),
  z.object({
    ok: z.literal(true), type: z.literal(JUMP_TO_TIMESTAMP), tabId: tabIdSchema,
    timestampSeconds: z.number().finite(), jumped: z.boolean(), openedNewTab: z.boolean(),
  }),
  z.object({
    ok: z.literal(true), type: z.literal(FETCH_VIDEO_TRANSCRIPT), tabId: tabIdSchema,
    video: videoInfoSchema, transcript: videoTranscriptSchema,
  }),
])
const runtimeResponseFailureSchema = z.object({
  ok: z.literal(false), type: requestTypeSchema, error: z.string(), tabId: tabIdSchema.nullish(),
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

export async function sendRuntimeMessage<TResponse extends RuntimeResponseMessage>(
  message: RuntimeRequestMessage,
): Promise<TResponse | RuntimeMessageParseError> {
  let raw: unknown
  try {
    raw = await chrome.runtime.sendMessage(message)
  } catch (transportError) {
    return {
      ok: false,
      type: "runtime-message-parse-error",
      error: transportError instanceof Error
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

export function isRuntimeMessageParseError(value: unknown): value is RuntimeMessageParseError {
  return isRecord(value) && value.ok === false && value.type === "runtime-message-parse-error"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
