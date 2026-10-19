import type { VideoIdentity } from "@/features/platform/types"

/**
 * The runtime bridge owns transport and response normalization. This boundary
 * accepts only its already-normalized timestamp result shape.
 */
export type TimestampNavigatorResult =
  | { ok: true; openedNewTab: boolean }
  | { ok: false; error: string }

export type TimestampNavigator = (
  identity: VideoIdentity,
  timestampSeconds: number,
) => Promise<TimestampNavigatorResult>

export type TimestampNavigationOutcome =
  | { kind: "missing-identity" }
  | { kind: "jumped-active" }
  | { kind: "opened-new-tab" }
  | { kind: "runtime-failure"; error: string }

export type NavigateToTimestampOptions = {
  identity: VideoIdentity | null
  timestampSeconds: number
  navigate: TimestampNavigator
}

export async function navigateToTimestamp({
  identity,
  timestampSeconds,
  navigate,
}: NavigateToTimestampOptions): Promise<TimestampNavigationOutcome> {
  if (!identity) return { kind: "missing-identity" }

  const result = await navigate(identity, timestampSeconds)
  if (result.ok === false) {
    return { kind: "runtime-failure", error: result.error }
  }

  return { kind: result.openedNewTab ? "opened-new-tab" : "jumped-active" }
}
