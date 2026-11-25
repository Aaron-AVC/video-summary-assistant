import { describe, expect, it } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { RecentAnalysisList } from "@/features/history/components/recent-analysis-list"

const noop = () => undefined

describe("RecentAnalysisList history load failure", () => {
  it("shows a retry action instead of reporting empty history", () => {
    const markup = renderToStaticMarkup(
      <RecentAnalysisList
        items={[]}
        isLoading={false}
        activeVideoId={null}
        onSelect={noop}
        loadError="Local history could not be loaded."
        onRetry={noop}
      />,
    )

    expect(markup).toContain('role="alert"')
    expect(markup).toContain("Local history could not be loaded.")
    expect(markup).toContain(">Retry<")
    expect(markup).not.toContain("No saved analyses yet.")
  })
})
