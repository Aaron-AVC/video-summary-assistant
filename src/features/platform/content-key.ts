import { isValidBvid } from "@/features/platform/bilibili/bilibili-url"

/**
 * Canonical content identity is the authoritative cross-platform key:
 *
 * - `youtube:<videoId>`
 * - `bilibili:<bvid>:p:<N>`
 *
 * `parseContentKey` is the single reverse mapping from that canonical string
 * back into the existing domain vocabulary (`platform`, `videoId`, `partId`).
 *
 * The parser is deliberately strict and total:
 *
 * - it never trims, repairs, or normalizes its input;
 * - it never throws for ordinary input, malformed values resolve to `null`;
 * - a value it accepts is exactly the canonical string it was given, so callers
 *   can never manufacture an identity the adapters would not have produced.
 *
 * Bilibili BVID validity is delegated to the existing platform validator so
 * there is no second BVID rule in the code base.
 */

export type ParsedYouTubeContentKey = {
  platform: "youtube"
  videoId: string
  contentKey: string
}

export type ParsedBilibiliContentKey = {
  platform: "bilibili"
  videoId: string
  partId: string
  pageIndex: number
  contentKey: string
}

export type ParsedContentKey = ParsedYouTubeContentKey | ParsedBilibiliContentKey

const YOUTUBE_PLATFORM = "youtube"
const BILIBILI_PLATFORM = "bilibili"
const BILIBILI_PART_SEGMENT = "p"

/**
 * Canonical decimal positive integer: no sign, no leading zeros, no exponent,
 * no fraction. `Number()` is then still guarded by `isSafeInteger`.
 */
const CANONICAL_PAGE_INDEX = /^[1-9]\d*$/

export function parseContentKey(value: string): ParsedContentKey | null {
  const segments = value.split(":")

  if (segments.length === 2) return parseYouTubeContentKey(segments, value)
  if (segments.length === 4) return parseBilibiliContentKey(segments, value)
  return null
}

function parseYouTubeContentKey(
  segments: string[],
  contentKey: string,
): ParsedYouTubeContentKey | null {
  const [platform, videoId = ""] = segments
  if (platform !== YOUTUBE_PLATFORM) return null
  if (videoId.length === 0) return null

  // Reject, never repair. A videoId with leading or trailing whitespace is not
  // the canonical value an adapter would have produced for this key, so the
  // parse fails instead of trimming it into acceptance or handing callers an
  // identity that no lookup can match.
  if (videoId.trim() !== videoId) return null

  return { platform: "youtube", videoId, contentKey }
}

function parseBilibiliContentKey(
  segments: string[],
  contentKey: string,
): ParsedBilibiliContentKey | null {
  const [platform, bvid, partSegment, pageSegment] = segments
  if (platform !== BILIBILI_PLATFORM) return null
  if (!isValidBvid(bvid)) return null
  if (partSegment !== BILIBILI_PART_SEGMENT) return null

  const pageText = pageSegment ?? ""
  if (!CANONICAL_PAGE_INDEX.test(pageText)) return null

  const pageIndex = Number(pageText)
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 1) return null

  return {
    platform: "bilibili",
    videoId: bvid,
    partId: String(pageIndex),
    pageIndex,
    contentKey,
  }
}
