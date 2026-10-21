import { describe, expect, it } from "bun:test"

import {
  MAX_SEARCH_RESULTS,
  buildSearchSnippet,
  matchesSearchTokens,
  normalizeSearchText,
  rankSearchResults,
  scoreSearchFields,
  tokenizeSearchQuery,
} from "@/features/search/lib/search-query"

describe("search query normalization", () => {
  it("folds full-width characters and case into a stable comparison form", () => {
    expect(normalizeSearchText("  Ｈｅｌｌｏ　ＷＯＲＬＤ  ")).toBe("hello world")
  })

  it("collapses interior whitespace into single spaces", () => {
    expect(normalizeSearchText("a \n\t b   c")).toBe("a b c")
  })

  it("splits distinct tokens and drops duplicates", () => {
    expect(tokenizeSearchQuery("React react   hooks")).toEqual(["react", "hooks"])
  })

  it("returns no tokens for a blank query", () => {
    expect(tokenizeSearchQuery("   \n ")).toEqual([])
  })
})

describe("search token matching", () => {
  it("requires every token to match", () => {
    expect(matchesSearchTokens("alpha beta gamma", ["alpha", "beta"])).toBe(true)
    expect(matchesSearchTokens("alpha beta gamma", ["alpha", "delta"])).toBe(false)
  })

  it("never matches without tokens", () => {
    expect(matchesSearchTokens("alpha", [])).toBe(false)
  })
})

describe("search field scoring", () => {
  it("prefers the strongest field and rewards additional tokens", () => {
    const fields = [
      { text: "Release notes", weight: 5 },
      { text: "the deployment notes describe release steps", weight: 3 },
    ]
    expect(scoreSearchFields(fields, ["release"])).toBe(5)
    expect(scoreSearchFields(fields, ["release", "deployment"])).toBe(8)
  })

  it("rejects a candidate when one token is missing anywhere", () => {
    expect(scoreSearchFields([{ text: "alpha", weight: 5 }], ["alpha", "beta"])).toBe(-1)
  })

  it("rejects an empty query", () => {
    expect(scoreSearchFields([{ text: "alpha", weight: 5 }], [])).toBe(-1)
  })

  it("ignores blank fields", () => {
    expect(scoreSearchFields([{ text: "   ", weight: 9 }], ["alpha"])).toBe(-1)
  })
})

describe("deterministic search ranking", () => {
  it("orders by score, then recency, then stable tie break", () => {
    const ranked = rankSearchResults([
      { item: "low", score: 1, updatedAt: "2026-01-01T00:00:00.000Z", tieBreak: "a" },
      { item: "high-old", score: 9, updatedAt: "2026-01-01T00:00:00.000Z", tieBreak: "b" },
      { item: "high-new", score: 9, updatedAt: "2026-02-01T00:00:00.000Z", tieBreak: "c" },
      { item: "high-new-a", score: 9, updatedAt: "2026-02-01T00:00:00.000Z", tieBreak: "a" },
    ])
    expect(ranked.map((entry) => entry.item)).toEqual([
      "high-new-a",
      "high-new",
      "high-old",
      "low",
    ])
  })

  it("caps the result count at the deterministic maximum", () => {
    const many = Array.from({ length: MAX_SEARCH_RESULTS + 10 }, (_, index) => ({
      item: `item-${index}`,
      score: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      tieBreak: `t-${String(index).padStart(3, "0")}`,
    }))
    expect(rankSearchResults(many)).toHaveLength(MAX_SEARCH_RESULTS)
  })

  it("produces the same order for the same input", () => {
    const input = [
      { item: "b", score: 3, updatedAt: "2026-01-02T00:00:00.000Z", tieBreak: "x" },
      { item: "a", score: 3, updatedAt: "2026-01-02T00:00:00.000Z", tieBreak: "y" },
    ]
    expect(rankSearchResults(input)).toEqual(rankSearchResults(input))
  })
})

describe("search snippets", () => {
  it("keeps a short matching text unchanged apart from whitespace collapse", () => {
    expect(buildSearchSnippet("alpha   beta", ["beta"])).toBe("alpha beta")
  })

  it("windows a long text around the first token hit", () => {
    const text = `${"filler ".repeat(60)}needle ${"tail ".repeat(60)}`
    const snippet = buildSearchSnippet(text, ["needle"], 40)
    expect(snippet).toContain("needle")
    expect(snippet.startsWith("…")).toBe(true)
    expect(snippet.endsWith("…")).toBe(true)
    expect(snippet.length).toBeLessThanOrEqual(42)
  })

  it("is deterministic for the same input", () => {
    const text = `${"filler ".repeat(50)}needle`
    expect(buildSearchSnippet(text, ["needle"], 30)).toBe(
      buildSearchSnippet(text, ["needle"], 30),
    )
  })
})
