import * as z from "zod"

import type {
  ActiveVideoContext,
  VideoIdentity,
  VideoInfo,
  VideoTranscript,
} from "@/features/platform/types"
import type {
  YouTubeLivePlayerState,
  YouTubeTimedtextCandidate,
} from "@/features/platform/youtube/youtube-live-state"
import { isAllowedBilibiliResourceUrl } from "@/features/platform/bilibili/bilibili-transport-policy"
import { MAX_TRANSCRIPT_CUES } from "@/lib/schemas/container-limits"

export const RUNTIME_MESSAGE_NAMESPACE = "video-summary-assistant/runtime"

export const GET_ACTIVE_VIDEO_CONTEXT = "get-active-video-context"
export const OPEN_SIDEPANEL = "open-sidepanel"
export const ANALYZE_VIDEO = "analyze-video"
export const JUMP_TO_TIMESTAMP = "jump-to-timestamp"
export const FETCH_VIDEO_TRANSCRIPT = "fetch-video-transcript"
export const READ_YOUTUBE_LIVE_PLAYER_STATE = "read-youtube-live-player-state"
export const REFRESH_YOUTUBE_CAPTION_RESOURCE = "refresh-youtube-caption-resource"
export const FETCH_BILIBILI_RESOURCE = "fetch-bilibili-resource"
export const CONTENT_VIDEO_CONTEXT_CHANGED = "content-video-context-changed"
export const ACTIVE_VIDEO_CONTEXT_CHANGED = "active-video-context-changed"

export type ContentVideoContextChangedMessage = {
  channel: typeof RUNTIME_MESSAGE_NAMESPACE
  type: typeof CONTENT_VIDEO_CONTEXT_CHANGED
  context: ActiveVideoContext
}

export type ActiveVideoContextChangedMessage = {
  channel: typeof RUNTIME_MESSAGE_NAMESPACE
  type: typeof ACTIVE_VIDEO_CONTEXT_CHANGED
  tabId: number
  context: ActiveVideoContext
}

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
  | {
      channel: typeof RUNTIME_MESSAGE_NAMESPACE
      type: typeof READ_YOUTUBE_LIVE_PLAYER_STATE
      videoId: string
    }
  | {
      channel: typeof RUNTIME_MESSAGE_NAMESPACE
      type: typeof REFRESH_YOUTUBE_CAPTION_RESOURCE
      videoId: string
      previousStartTime: number
    }
  | {
      channel: typeof RUNTIME_MESSAGE_NAMESPACE
      type: typeof FETCH_BILIBILI_RESOURCE
      url: string
    }

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
      ok: true
      type: typeof READ_YOUTUBE_LIVE_PLAYER_STATE
      tabId: number | null
      playerState: YouTubeLivePlayerState | null
    }
  | {
      ok: true
      type: typeof REFRESH_YOUTUBE_CAPTION_RESOURCE
      tabId: number | null
      candidate: YouTubeTimedtextCandidate | null
    }
  | {
      ok: true
      type: typeof FETCH_BILIBILI_RESOURCE
      tabId: number | null
      status: number
      body: string
      encoding: "utf8" | "base64"
    }
  | {
      ok: false
      type:
        | typeof GET_ACTIVE_VIDEO_CONTEXT
        | typeof OPEN_SIDEPANEL
        | typeof ANALYZE_VIDEO
        | typeof JUMP_TO_TIMESTAMP
        | typeof FETCH_VIDEO_TRANSCRIPT
        | typeof READ_YOUTUBE_LIVE_PLAYER_STATE
        | typeof FETCH_BILIBILI_RESOURCE
        | typeof REFRESH_YOUTUBE_CAPTION_RESOURCE
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
  READ_YOUTUBE_LIVE_PLAYER_STATE,
  REFRESH_YOUTUBE_CAPTION_RESOURCE,
  FETCH_BILIBILI_RESOURCE,
])

export function isRuntimeRequestMessage(value: unknown): value is RuntimeRequestMessage {
  if (!(
    isRecord(value)
    && value.channel === RUNTIME_MESSAGE_NAMESPACE
    && requestTypeSchema.safeParse(value.type).success
  )) return false
  if (value.type === FETCH_BILIBILI_RESOURCE) return isAllowedBilibiliResourceUrl(value.url)
  if (value.type === READ_YOUTUBE_LIVE_PLAYER_STATE) {
    return typeof value.videoId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value.videoId)
  }
  if (value.type === REFRESH_YOUTUBE_CAPTION_RESOURCE) {
    return typeof value.videoId === "string"
      && /^[a-zA-Z0-9_-]{1,128}$/.test(value.videoId)
      && typeof value.previousStartTime === "number"
      && Number.isFinite(value.previousStartTime)
      && value.previousStartTime >= 0
  }
  return true
}

// Page-derived display/identity strings cross the runtime message boundary here.
// These limits bound message size at the earliest shared validator; they are
// safety ceilings, not platform business rules.
//
// Zod counts string length in Unicode code points, not UTF-16 code units: an
// astral character (for example an emoji surrogate pair) counts once here even
// though `String.prototype.length` reports two. BMP text such as ASCII or CJK
// counts identically under both measures.
const MAX_ACTIVE_CONTEXT_VIDEO_ID_LENGTH = 128
const MAX_ACTIVE_CONTEXT_PART_ID_LENGTH = 16
const MAX_ACTIVE_CONTEXT_CONTENT_KEY_LENGTH = 256
const MAX_ACTIVE_CONTEXT_URL_LENGTH = 16_384
const MAX_ACTIVE_CONTEXT_TEXT_LENGTH = 4_096

const activeVideoContextSchema = z.object({
  pageType: z.enum(["video", "unsupported"]),
  platform: z.enum(["youtube", "bilibili"]).nullable(),
  videoId: z.string().min(1).max(MAX_ACTIVE_CONTEXT_VIDEO_ID_LENGTH).nullable(),
  partId: z.string().min(1).max(MAX_ACTIVE_CONTEXT_PART_ID_LENGTH).nullable(),
  contentKey: z.string().min(1).max(MAX_ACTIVE_CONTEXT_CONTENT_KEY_LENGTH).nullable(),
  url: z.string().max(MAX_ACTIVE_CONTEXT_URL_LENGTH),
  canonicalUrl: z.string().url().max(MAX_ACTIVE_CONTEXT_URL_LENGTH).nullable(),
  title: z.string().min(1).max(MAX_ACTIVE_CONTEXT_TEXT_LENGTH).nullable(),
  author: z.string().max(MAX_ACTIVE_CONTEXT_TEXT_LENGTH).nullable(),
  timestampSeconds: z.number().finite().nonnegative(),
  isReady: z.boolean(),
}).superRefine((context, issueContext) => {
  if (context.platform === "bilibili") {
    const expected = context.videoId && context.partId
      ? `bilibili:${context.videoId}:p:${context.partId}`
      : null
    if (!expected || context.contentKey !== expected) {
      issueContext.addIssue({ code: "custom", path: ["contentKey"], message: "Bilibili context identity is inconsistent." })
    }
  } else if (context.platform === "youtube" && context.videoId && context.contentKey !== `youtube:${context.videoId}`) {
    issueContext.addIssue({ code: "custom", path: ["contentKey"], message: "YouTube context identity is inconsistent." })
  }
})

const contentVideoContextChangedSchema = z.object({
  channel: z.literal(RUNTIME_MESSAGE_NAMESPACE),
  type: z.literal(CONTENT_VIDEO_CONTEXT_CHANGED),
  context: activeVideoContextSchema,
})
const activeVideoContextChangedSchema = z.object({
  channel: z.literal(RUNTIME_MESSAGE_NAMESPACE),
  type: z.literal(ACTIVE_VIDEO_CONTEXT_CHANGED),
  tabId: z.number().int().nonnegative(),
  context: activeVideoContextSchema,
})

export function isContentVideoContextChangedMessage(
  value: unknown,
): value is ContentVideoContextChangedMessage {
  return contentVideoContextChangedSchema.safeParse(value).success
}

export function isActiveVideoContextChangedMessage(
  value: unknown,
): value is ActiveVideoContextChangedMessage {
  return activeVideoContextChangedSchema.safeParse(value).success
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
const videoPlatformSchema = z.enum(["youtube", "bilibili"])
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
  text: z.string().trim().min(1),
}).refine((segment) => segment.endSec >= segment.startSec, {
  path: ["endSec"],
  message: "Transcript segment end must not precede its start.",
})
const youtubeLivePlayerStateSchema = z.object({
  videoId: z.string().min(1).max(128),
  title: z.string().nullable(),
  author: z.string().nullable(),
  captionTracks: z.array(z.object({
    languageCode: z.string().min(1).max(64),
    languageName: z.string().nullable(),
    displayName: z.string().nullable(),
    kind: z.string().nullable(),
    vssId: z.string().nullable(),
  })).max(100),
  subtitlesOn: z.boolean().nullable().optional(),
  currentCaptionTrack: z.object({
    languageCode: z.string().min(1).max(64),
    kind: z.string().max(512).nullable().optional(),
    vssId: z.string().max(512).nullable().optional(),
  }).nullable().optional(),
  timedtextCandidates: z.array(z.object({
    url: z.string().min(1).max(16_384),
    videoId: z.string().min(1).max(128),
    languageCode: z.string().min(1).max(64),
    format: z.string().max(32).nullable(),
    startTime: z.number().finite().nonnegative(),
  })).max(100),
})
const youtubeTimedtextCandidateSchema = z.object({
  url: z.string().min(1).max(16_384),
  videoId: z.string().min(1).max(128),
  languageCode: z.string().min(1).max(64),
  format: z.string().max(32).nullable(),
  startTime: z.number().finite().nonnegative(),
})
const videoTranscriptSchema = z.object({
  segments: z.array(transcriptSegmentSchema).max(MAX_TRANSCRIPT_CUES),
  language: z.string().nullable().optional(),
  source: z.enum(["manual", "auto", "unknown"]),
  raw: z.object({
    format: z.literal("vtt"),
    text: z.string(),
    sourceUrl: z.string().url().nullable().optional(),
  }).optional(),
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
  z.object({
    ok: z.literal(true), type: z.literal(READ_YOUTUBE_LIVE_PLAYER_STATE), tabId: tabIdSchema,
    playerState: youtubeLivePlayerStateSchema.nullable(),
  }),
  z.object({
    ok: z.literal(true), type: z.literal(REFRESH_YOUTUBE_CAPTION_RESOURCE), tabId: tabIdSchema,
    candidate: youtubeTimedtextCandidateSchema.nullable(),
  }),
  z.object({
    ok: z.literal(true), type: z.literal(FETCH_BILIBILI_RESOURCE), tabId: tabIdSchema,
    status: z.number().int().min(100).max(599), body: z.string().max(12 * 1024 * 1024),
    encoding: z.enum(["utf8", "base64"]).default("utf8"),
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

export function isYouTubeLivePlayerStateResponse(
  value: unknown,
): value is Extract<RuntimeResponseMessage, { type: typeof READ_YOUTUBE_LIVE_PLAYER_STATE }> {
  return runtimeResponseMessageSchema.safeParse(value).success
    && isRecord(value)
    && value.ok === true
    && value.type === READ_YOUTUBE_LIVE_PLAYER_STATE
}

export function isYouTubeCaptionResourceRefreshResponse(
  value: unknown,
): value is Extract<RuntimeResponseMessage, { type: typeof REFRESH_YOUTUBE_CAPTION_RESOURCE }> {
  return runtimeResponseMessageSchema.safeParse(value).success
    && isRecord(value)
    && value.ok === true
    && value.type === REFRESH_YOUTUBE_CAPTION_RESOURCE
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
