import type { VideoPlatformAdapter } from "@/features/platform/adapter"
import type { VideoIdentity } from "@/features/platform/types"
import { youtubeAdapter } from "@/features/platform/youtube/youtube-adapter"

export const PLATFORM_ADAPTERS: readonly VideoPlatformAdapter[] = [youtubeAdapter]

export function resolvePlatformAdapter(
  urlLike: URL | string,
): VideoPlatformAdapter | null {
  let url: URL
  try {
    url = typeof urlLike === "string" ? new URL(urlLike) : urlLike
  } catch {
    return null
  }

  return PLATFORM_ADAPTERS.find((adapter) => adapter.canHandle(url)) ?? null
}

export function resolvePlatformAdapterForIdentity(
  identity: VideoIdentity,
): VideoPlatformAdapter | null {
  return PLATFORM_ADAPTERS.find((adapter) => adapter.platform === identity.platform) ?? null
}
