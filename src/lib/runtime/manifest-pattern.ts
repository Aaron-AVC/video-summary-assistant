export function matchesManifestPattern(urlString: string, pattern: string): boolean {
  try {
    const url = new URL(urlString)
    const match = pattern.match(/^(\*|https?|file|ftp):\/\/([^/]+)(\/.*)$/)
    if (!match) return false

    const [, scheme, host, path = "/"] = match
    if (scheme !== "*" && `${scheme}:` !== url.protocol) return false

    const hostMatches = host === "*"
      || host === url.hostname
      || (host.startsWith("*.")
        && (url.hostname === host.slice(2) || url.hostname.endsWith(host.slice(1))))
    if (!hostMatches) return false

    const pathRegex = new RegExp(
      `^${path.split("*").map(escapeRegex).join(".*")}$`,
    )
    return pathRegex.test(`${url.pathname}${url.search}`)
  } catch {
    return false
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
