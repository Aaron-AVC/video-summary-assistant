import { describe, expect, it } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import {
  FinalResumePanel,
  createFinalResumeTranslate,
} from "@/features/analysis/components/final-resume-panel"
import type { FinalResumeView } from "@/sidepanel/analysis/final-resume-availability"

const noop = () => undefined

function view(overrides: Partial<FinalResumeView> = {}): FinalResumeView {
  return {
    visible: true,
    canStart: true,
    phaseLabel: "available",
    remainingMinutes: 27,
    status: { kind: "http", status: 502 },
    reason: null,
    ...overrides,
  }
}

function render(element: React.ReactElement) {
  return renderToStaticMarkup(element)
}

const en = createFinalResumeTranslate("en")
const zh = createFinalResumeTranslate("zh-CN")

describe("FinalResumePanel", () => {
  it("shows the continue action, cost notice and remaining TTL for an available checkpoint", () => {
    const markup = render(
      <FinalResumePanel
        view={view()}
        errorMessage="Final summary failed: provider HTTP 502."
        videoTitle="Video"
        onResume={noop}
        onRegenerate={noop}
        onCancel={noop}
        translate={en}
      />,
)

    expect(markup).toContain("Continue final summary")
    expect(markup).toContain("Regenerate")
    expect(markup).toContain("may bill you a second time")
    expect(markup).toContain("27 minutes left")
    expect(markup).toContain("HTTP 502")
    expect(markup).toContain("data-resume-phase=\"available\"")
    expect(markup).not.toContain("sk-")
  })

  it("renders the Chinese continue action with the explicit cost difference", () => {
    const markup = render(
      <FinalResumePanel
        view={view()}
        errorMessage={null}
        videoTitle="视频"
        onResume={noop}
        onRegenerate={noop}
        onCancel={noop}
        translate={zh}
      />,
    )

    expect(markup).toContain("继续最终总结")
    expect(markup).toContain("完整重新生成")
    expect(markup).toContain("可能再次计费")
    expect(markup).toContain("剩余 27 分钟")
  })

  it("disables the continue action while resuming and offers cancel", () => {
    const markup = render(
      <FinalResumePanel
        view={view({ phaseLabel: "resuming", canStart: false })}
        errorMessage={null}
        videoTitle="Video"
        onResume={noop}
        onRegenerate={noop}
        onCancel={noop}
        translate={en}
      />,
)

    expect(markup).toContain("Continuing final summary")
    expect(markup).toContain("Cancel")
    expect(markup).toContain("disabled")
    expect(markup).not.toContain("data-testid=\"final-resume-continue\"")
  })

  it("shows the saving phase without a cancel action", () => {
    const markup = render(
      <FinalResumePanel
        view={view({ phaseLabel: "saving", canStart: false })}
        errorMessage={null}
        videoTitle="Video"
        onResume={noop}
        onRegenerate={noop}
        onCancel={noop}
        translate={en}
      />,
)

    expect(markup).toContain("Saving analysis")
    expect(markup).not.toContain("Cancel")
  })

  it("offers only a fresh regeneration once the checkpoint is gone", () => {
    const markup = render(
      <FinalResumePanel
        view={view({
          visible: false,
          canStart: false,
          phaseLabel: "unavailable",
          reason: "expired",
        })}
        errorMessage={null}
        videoTitle="Video"
        onResume={noop}
        onRegenerate={noop}
        onCancel={noop}
        translate={en}
      />,
)

    expect(markup).toContain("data-resume-reason=\"expired\"")
    expect(markup).toContain("Regenerate")
    expect(markup).not.toContain("Continue final summary")
  })

  it("explains an identity change instead of silently re-running the full analysis", () => {
    const markup = render(
      <FinalResumePanel
        view={view({
          visible: false,
          canStart: false,
          phaseLabel: "unavailable",
          reason: "provider-changed",
        })}
        errorMessage={null}
        videoTitle="Video"
        onResume={noop}
        onRegenerate={noop}
        onCancel={noop}
        translate={en}
      />,
)

    expect(markup).toContain("no longer applies")
    expect(markup).not.toContain("Continue final summary")
  })

  it("renders nothing when there is no checkpoint and no error", () => {
    const markup = render(
      <FinalResumePanel
        view={view({
          visible: false,
          canStart: false,
          phaseLabel: "unavailable",
          reason: "no-checkpoint",
          status: null,
        })}
        errorMessage={null}
        videoTitle={null}
        onResume={noop}
        onRegenerate={noop}
        onCancel={noop}
        translate={en}
      />,
)

    expect(markup).toBe("")
  })
})
