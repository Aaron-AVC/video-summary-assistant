import { describe, expect, it } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { SidePanelShell } from "@/sidepanel/components/sidepanel-shell"

const noop = () => undefined
const content = (label: string) => <div>{label}</div>

function renderShell(status: "unavailable" | "retrying") {
  return renderToStaticMarkup(
    <SidePanelShell
      activeTab="settings"
      onTabChange={noop}
      header={content("Header")}
      databaseStatus={status}
      onDatabaseRetry={noop}
      overview={content("Overview")}
      transcript={content("Transcript")}
      ask={content("Ask")}
      search={content("Search")}
      settings={content("Settings")}
    />,
  )
}

describe("Side Panel database notice", () => {
  it("shows a retry action when local history is unavailable", () => {
    const markup = renderShell("unavailable")

    expect(markup).toContain('role="alert"')
    expect(markup).toContain("Local data is temporarily unavailable.")
    expect(markup).toContain(">Retry local data access<")
    expect(markup).toContain("Settings")
  })

  it("disables repeated retry clicks while the database check is running", () => {
    const markup = renderShell("retrying")

    expect(markup).toContain('role="status"')
    expect(markup).toContain("Checking local data…")
    expect(markup).toMatch(/<button[^>]*disabled=""/)
  })
})
