const TRANSCRIPT_FETCH_URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi

export function redactTranscriptFetchUrls(value: string): string {
  return value.replace(TRANSCRIPT_FETCH_URL_PATTERN, (candidate) => {
    try {
      const url = new URL(candidate)
      return url.pathname.toLowerCase().includes("timedtext")
        ? "[redacted transcript URL]"
        : candidate
    } catch {
      return candidate
    }
  })
}
