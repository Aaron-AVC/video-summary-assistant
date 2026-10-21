/**
 * Search text normalization, token matching and deterministic ranking.
 *
 * Every rule here is intentionally literal and locale-independent:
 *  - NFKC compatibility normalization (full-width -> half-width, etc.)
 *  - lowercase folding
 *  - whitespace collapse into single spaces
 *  - whitespace token split with AND semantics
 *  - substring matching only (no fuzzy, no stemming, no synonyms)
 */

export const MAX_SEARCH_RESULTS = 50

export type WeightedSearchField = {
  text: string
  weight: number
}

/** A scoring hit counts each query token at most once, at its best field. */
const NO_MATCH = -1

export function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim()
}

export function tokenizeSearchQuery(query: string): string[] {
  const normalized = normalizeSearchText(query)

  if (!normalized) return []

  return [...new Set(normalized.split(" "))]
}

export function matchesSearchTokens(haystack: string, tokens: string[]): boolean {
  if (tokens.length === 0) return false

  const normalized = normalizeSearchText(haystack)
  return tokens.every((token) => normalized.includes(token))
}

/**
 * Scores one candidate. Each token must appear somewhere, otherwise there is
 * no match. A token contributes the weight of the strongest field it appears
 * in, so a title hit always outranks an equivalent body hit.
 */
export function scoreSearchFields(
  fields: WeightedSearchField[],
  tokens: string[],
): number {
  if (tokens.length === 0) return NO_MATCH

  const normalizedFields = fields
    .filter((field) => field.text.trim().length > 0)
    .map((field) => ({ text: normalizeSearchText(field.text), weight: field.weight }))

  let score = 0

  for (const token of tokens) {
    let best = NO_MATCH

    for (const field of normalizedFields) {
      if (!field.text.includes(token)) continue
      if (field.weight > best) best = field.weight
    }

    if (best === NO_MATCH) return NO_MATCH
    score += best
  }

  return score
}

export type RankedSearchResult<T> = {
  item: T
  score: number
  updatedAt: string
  tieBreak: string
}

/**
 * Deterministic ordering: score descending, then most recently updated, then
 * a stable identity string ascending. No locale collation, no randomness.
 */
export function rankSearchResults<T>(
  results: RankedSearchResult<T>[],
  limit: number = MAX_SEARCH_RESULTS,
): RankedSearchResult<T>[] {
  const sorted = [...results].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    if (right.updatedAt !== left.updatedAt) {
      return right.updatedAt < left.updatedAt ? -1 : 1
    }
    return left.tieBreak < right.tieBreak ? -1 : left.tieBreak > right.tieBreak ? 1 : 0
  })

  return sorted.slice(0, Math.max(0, limit))
}

/** Trims a matching excerpt down to a stable, whitespace-collapsed window. */
export function buildSearchSnippet(
  text: string,
  tokens: string[],
  maxLength: number = 160,
): string {
  const collapsed = text.replace(/\s+/gu, " ").trim()

  if (collapsed.length <= maxLength) return collapsed

  const normalized = normalizeSearchText(collapsed)
  const firstHit = tokens
    .map((token) => normalized.indexOf(token))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0] ?? 0
  // Keep the window anchored slightly before the first hit so the matching
  // token itself always stays inside the excerpt.
  const start = Math.max(
    0,
    Math.min(firstHit - Math.floor(maxLength / 4), collapsed.length - maxLength),
  )
  const window = collapsed.slice(start, start + maxLength)

  return `${start > 0 ? "…" : ""}${window.trim()}${start + maxLength < collapsed.length ? "…" : ""}`
}
