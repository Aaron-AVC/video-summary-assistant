const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/

export function extractVideoId(input: string): string | null {
  const normalizedInput = input.trim()

  if (!normalizedInput) {
    return null
  }

  if (VIDEO_ID_PATTERN.test(normalizedInput)) {
    return normalizedInput
  }

  let url: URL

  try {
    url = new URL(normalizedInput)
  } catch {
    return null
  }

  const host = url.hostname.replace(/^www\./, "")

  if (host === "youtu.be") {
    return validateVideoId(url.pathname.slice(1).split("/")[0] ?? null)
  }

  if (host !== "youtube.com" && !host.endsWith(".youtube.com")) {
    return null
  }

  if (url.pathname === "/watch") {
    return validateVideoId(url.searchParams.get("v"))
  }

  const segments = url.pathname.split("/").filter(Boolean)
  const routedVideoId =
    segments[0] === "embed" || segments[0] === "shorts" || segments[0] === "live"
      ? segments[1]
      : null

  return validateVideoId(routedVideoId ?? null)
}

function validateVideoId(videoId: string | null): string | null {
  if (!videoId) {
    return null
  }

  return VIDEO_ID_PATTERN.test(videoId) ? videoId : null
}
