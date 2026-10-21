import { describe, expect, it } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { SearchTab } from "@/sidepanel/components/search-tab"
import type { SearchResult } from "@/sidepanel/search/search-controller"
import { en } from "@/lib/i18n/en"
import { zhCN } from "@/lib/i18n/zh-CN"

function buildResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "knowledge:item-1",
    kind: "knowledge",
    title: "Deployment walkthrough",
    subtitle: "youtube · video-a",
    snippet: "remember the deployment checklist",
    updatedAt: "2026-01-01T00:00:00.000Z",
    identity: {
      platform: "youtube",
      videoId: "video-a",
      contentKey: "youtube:video-a",
    },
    contentKey: "youtube:video-a",
    platform: "youtube",
    videoId: "video-a",
    partId: null,
    analysisRunId: null,
    transcriptFingerprint: null,
    knowledgeItemId: "item-1",
    threadId: null,
    timestampSeconds: null,
    ...overrides,
  }
}

const noop = () => {}

function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element)
}

describe("Search tab", () => {
  it("shows the idle state with a disabled submit for an empty query", () => {
    const markup = render(
      <SearchTab
        query=""
        onQueryChange={noop}
        onSubmit={noop}
        results={[]}
        isSearching={false}
        errorMessage={null}
        onOpen={noop}
        formatTimestamp={(seconds) => `t${seconds}`}
      />,
    )

    expect(markup).toContain("Search your local knowledge")
    expect(markup).toContain("Search local knowledge")
    expect(markup).toContain("disabled")
  })

  it("renders result rows with their typed kind and formatted anchor", () => {
    const markup = render(
      <SearchTab
        query="deployment"
        onQueryChange={noop}
        onSubmit={noop}
        results={[
          buildResult({
            id: "knowledge:item-1",
            kind: "knowledge",
            timestampSeconds: 42,
          }),
          buildResult({
            id: "qa-thread:thread-1",
            kind: "qa-thread",
            title: "Why deployment failed",
            snippet: "The deployment failed because of a missing secret.",
            subtitle: "youtube · video-a",
            knowledgeItemId: null,
            threadId: "thread-1",
            analysisRunId: "run-1",
            transcriptFingerprint: "fp-1",
          }),
        ]}
        isSearching={false}
        errorMessage={null}
        onOpen={noop}
        formatTimestamp={(seconds) => `t${seconds}`}
      />,
    )

    expect(markup).toContain("Deployment walkthrough")
    expect(markup).toContain("remember the deployment checklist")
    expect(markup).toContain("Knowledge")
    expect(markup).toContain("Ask Video")
    expect(markup).toContain("t42")
    expect(markup).toContain("Open Deployment walkthrough")
    expect(markup).toContain("youtube · video-a")
  })

  it("announces the searching state while a scan is running", () => {
    const markup = render(
      <SearchTab
        query="deployment"
        onQueryChange={noop}
        onSubmit={noop}
        results={[]}
        isSearching
        errorMessage={null}
        onOpen={noop}
        formatTimestamp={(seconds) => `t${seconds}`}
      />,
    )

    expect(markup).toContain("Searching")
    expect(markup).toContain("Search")
  })

  it("reports a failed scan without hiding the query", () => {
    const markup = render(
      <SearchTab
        query="deployment"
        onQueryChange={noop}
        onSubmit={noop}
        results={[]}
        isSearching={false}
        errorMessage="db down"
        onOpen={noop}
        formatTimestamp={(seconds) => `t${seconds}`}
      />,
    )

    expect(markup).toContain("db down")
    expect(markup).toContain("No results for")
    expect(markup).toContain("deployment")
  })

  it("renders an explicit empty result state", () => {
    const markup = render(
      <SearchTab
        query="nothing"
        onQueryChange={noop}
        onSubmit={noop}
        results={[]}
        isSearching={false}
        errorMessage={null}
        onOpen={noop}
        formatTimestamp={(seconds) => `t${seconds}`}
      />,
    )

    expect(markup).toContain("No results for &quot;nothing&quot;.")
  })
})

describe("Search localization parity", () => {
  it("ships every search string in both supported locales", () => {
    const keys = Object.keys(en).filter(
      (key) => key.startsWith("search.") || key === "side.search",
    )
    expect(keys.length).toBeGreaterThan(10)
    for (const key of keys) {
      expect(zhCN[key as keyof typeof zhCN]).toBeTruthy()
    }
  })
})
