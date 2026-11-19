import type { VideoPlatform } from "@/features/platform/types"

/**
 * Live source identity as read from the Side Panel runtime at the exact moment
 * a Final-only resume is about to consume it.
 *
 * Every field here is runtime-sourced. Nothing may be copied from a resume
 * task snapshot: the defect this module closes was a callback that proved
 * readiness from the *current* video context while reporting the frozen
 * snapshot's platform/videoId/partId/contentKey, so a queued resume could read
 * video B's readiness and still be handed video A's identity.
 */
export type FinalResumeLiveSourceIdentity = {
  isReady: boolean
  sourceTabId: number | null
  platform: VideoPlatform | null
  videoId: string | null
  partId: string | null
  contentKey: string | null
  title: string | null
}

/**
 * The frozen source identity of the checkpoint that owns this resume. Only the
 * fields needed to refuse a different tab/video/part are required.
 */
export type FinalResumeFrozenSource = {
  sourceTabId: number
  platform: VideoPlatform
  videoId: string
  partId: string | null
  contentKey: string
  title: string
}

/** Field that failed the check; never a content value. */
export type FinalResumeSourceField =
  | "not-ready"
  | "tab"
  | "platform"
  | "video"
  | "part"
  | "content-key"

/**
 * Carries the failing field but never the video id, part id, content key or
 * title, so a surfaced error cannot leak source content into a toast or log.
 */
export class FinalResumeSourceMismatchError extends Error {
  readonly field: FinalResumeSourceField

  constructor(field: FinalResumeSourceField) {
    super(`The live source no longer matches the resume task (${field}).`)
    this.name = "FinalResumeSourceMismatchError"
    this.field = field
  }
}

/**
 * Verified live identity, ready to be handed to the coordinator as
 * `sourceVideo`. It is entirely built from the runtime read.
 */
export type FinalResumeVerifiedSource = {
  sourceTabId: number
  platform: VideoPlatform
  videoId: string
  partId: string | null
  contentKey: string
  title: string
}

/**
 * Strict, fail-closed identity gate for `readLiveSource`.
 *
 * It is synchronous and stateless, so the coordinator can call the wiring three
 * times per resume (admission, before the Final request, before persistence)
 * and every call re-validates the live runtime instead of trusting a cache.
 *
 * `title` is deliberately *not* a rejection field: the title legitimately comes
 * from the live runtime (a rename is allowed), and the checkpoint's own strict
 * context comparison already rejects a title that no longer matches the frozen
 * source. The returned identity still has to be internally consistent, so the
 * title is read from the runtime and only falls back to the frozen value when
 * the runtime currently has none.
 *
 * `durationSec` is intentionally absent: the runtime read has no trustworthy
 * duration at this point (it is only known after the transcript is acquired),
 * so this gate never supplies one. The caller binds the last *real* acquisition
 * to its content key instead, and the coordinator's strict comparison decides.
 */
export function assertLiveSourceMatchesTask(input: {
  current: FinalResumeLiveSourceIdentity
  frozen: FinalResumeFrozenSource
}): FinalResumeVerifiedSource {
  const { current, frozen } = input

  if (!current.isReady || !current.contentKey) {
    throw new FinalResumeSourceMismatchError("not-ready")
  }
  if (current.sourceTabId === null || current.sourceTabId !== frozen.sourceTabId) {
    throw new FinalResumeSourceMismatchError("tab")
  }
  if (current.platform === null || current.platform !== frozen.platform) {
    throw new FinalResumeSourceMismatchError("platform")
  }
  if (current.videoId === null || current.videoId !== frozen.videoId) {
    throw new FinalResumeSourceMismatchError("video")
  }
  if ((current.partId ?? null) !== (frozen.partId ?? null)) {
    throw new FinalResumeSourceMismatchError("part")
  }
  if (current.contentKey !== frozen.contentKey) {
    throw new FinalResumeSourceMismatchError("content-key")
  }

  return {
    sourceTabId: current.sourceTabId,
    platform: current.platform,
    videoId: current.videoId,
    partId: current.partId ?? null,
    contentKey: current.contentKey,
    title: current.title ?? frozen.title,
  }
}
