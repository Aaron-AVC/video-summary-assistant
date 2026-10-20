import { describe, expect, it } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { AskTab } from "@/sidepanel/components/ask-tab"
import { OverviewTab } from "@/sidepanel/components/overview-tab"
import { SettingsTab } from "@/sidepanel/components/settings-tab"
import { SidePanelShell } from "@/sidepanel/components/sidepanel-shell"
import { TranscriptTab } from "@/sidepanel/components/transcript-tab"

const noop = () => undefined
const formatTimestamp = (seconds: number) => `0:${String(seconds).padStart(2, "0")}`

describe("Side Panel V1 components", () => {
  it("renders canonical Summary, Key Points, chapter detail, and Regenerate in Overview", () => {
    const markup = renderToStaticMarkup(
      <OverviewTab
        analysis={{
          summary: "Complete summary text",
          keyPoints: [
            { text: "Untimed point" },
            { text: "Timed point", startSec: 5, endSec: 10 },
          ],
          chapters: [{
            title: "Opening",
            summary: "Chapter summary",
            detail: "Chapter detail stays visible",
            startSec: 0,
            endSec: 10,
          }],
        }}
        analysisError={null}
        analysisPhase="completed"
        isLoading={false}
        hasProvider
        canAnalyze
        lastAnalyzedAt="10/10/2026"
        recentItems={[]}
        isHistoryLoading={false}
        activeVideoId="video-a"
        onAnalyze={noop}
        onCancel={noop}
        onConfigureProvider={noop}
        onJump={noop}
        onSelectHistory={noop}
        onOpenFullHistory={noop}
        formatTimestamp={formatTimestamp}
      />,
    )

    expect(markup).toContain("Regenerate")
    expect(markup).toContain("Complete summary text")
    expect(markup).toContain("Untimed point")
    expect(markup).toContain("Timed point")
    expect(markup).toContain("Chapters")
    expect(markup).toContain("Chapter detail stays visible")
    expect(markup).not.toContain("Ask AI")
  })

  it("shows Generate when displayed history is not the exact current identity", () => {
    const markup = renderToStaticMarkup(
      <OverviewTab
        analysis={{
          summary: "History summary",
          keyPoints: [],
          chapters: [],
        }}
        hasCurrentAnalysis={false}
        analysisError={null}
        analysisPhase="completed"
        isLoading={false}
        hasProvider
        canAnalyze
        lastAnalyzedAt="10/10/2026"
        recentItems={[]}
        isHistoryLoading={false}
        activeVideoId="video-a"
        onAnalyze={noop}
        onCancel={noop}
        onConfigureProvider={noop}
        onJump={noop}
        onSelectHistory={noop}
        onOpenFullHistory={noop}
        formatTimestamp={formatTimestamp}
      />,
    )

    expect(markup).toContain("Generate analysis")
    expect(markup).not.toContain("Regenerate")
  })

  it("renders actionable Ask prerequisites and the grounded answer surface", () => {
    const missingProvider = renderToStaticMarkup(
      <AskTab
        hasProvider={false}
        hasAnalysis={false}
        hasTranscript={false}
        question=""
        answer={null}
        isAsking={false}
        canAsk={false}
        errorMessage={null}
        isTranscriptLoading={false}
        onQuestionChange={noop}
        onAsk={noop}
        onFollowUp={noop}
        onJump={noop}
        onOpenSettings={noop}
        onOpenOverview={noop}
        onLoadTranscript={noop}
        formatTimestamp={formatTimestamp}
      />,
    )
    expect(missingProvider).toContain("Configure provider")

    const missingAnalysis = renderToStaticMarkup(
      <AskTab
        hasProvider
        hasAnalysis={false}
        hasTranscript={false}
        question=""
        answer={null}
        isAsking={false}
        canAsk={false}
        errorMessage={null}
        isTranscriptLoading={false}
        onQuestionChange={noop}
        onAsk={noop}
        onFollowUp={noop}
        onJump={noop}
        onOpenSettings={noop}
        onOpenOverview={noop}
        onLoadTranscript={noop}
        formatTimestamp={formatTimestamp}
      />,
    )
    expect(missingAnalysis).toContain("Generate analysis first")

    const missingTranscript = renderToStaticMarkup(
      <AskTab
        hasProvider
        hasAnalysis
        hasTranscript={false}
        question=""
        answer={null}
        isAsking={false}
        canAsk={false}
        errorMessage={null}
        isTranscriptLoading={false}
        onQuestionChange={noop}
        onAsk={noop}
        onFollowUp={noop}
        onJump={noop}
        onOpenSettings={noop}
        onOpenOverview={noop}
        onLoadTranscript={noop}
        formatTimestamp={formatTimestamp}
      />,
    )
    expect(missingTranscript).toContain("Load transcript")

    const answer = renderToStaticMarkup(
      <AskTab
        hasProvider
        hasAnalysis
        hasTranscript
        question="What happened?"
        answer={{
          answer: "Grounded answer",
          citations: [{ startSec: 5, endSec: 10, text: "Evidence text" }],
          suggestedJumps: [{ title: "Review evidence", startSec: 5, endSec: 10 }],
          followUps: ["What happened next?"],
        }}
        isAsking={false}
        canAsk
        errorMessage={null}
        isTranscriptLoading={false}
        onQuestionChange={noop}
        onAsk={noop}
        onFollowUp={noop}
        onJump={noop}
        onOpenSettings={noop}
        onOpenOverview={noop}
        onLoadTranscript={noop}
        formatTimestamp={formatTimestamp}
      />,
    )
    expect(answer).toContain("Grounded answer")
    expect(answer).toContain("Evidence text")
    expect(answer).toContain("What happened next?")
    expect(answer).toContain("Jump")
  })

  it("disables Ask conversation switching while an answer is in flight", () => {
    const markup = renderToStaticMarkup(
      <AskTab
        hasProvider
        hasAnalysis
        hasTranscript
        question="What happened?"
        answer={null}
        messages={[{
          id: "message-1",
          threadId: "thread-1",
          sequence: 0,
          role: "user",
          content: "Earlier question",
          createdAt: "2026-10-14T00:00:00.000Z",
        }]}
        threads={[{
          id: "thread-1",
          contentKey: "youtube:video",
          platform: "youtube",
          videoId: "video",
          partId: null,
          title: "Earlier question",
          analysisRunId: "run-1",
          transcriptFingerprint: "fp-1",
          providerProfileId: "provider-a",
          providerBaseUrl: "https://api.example.com/v1",
          providerModel: "model-a",
          createdAt: "2026-10-14T00:00:00.000Z",
          updatedAt: "2026-10-14T00:00:00.000Z",
        }]}
        currentThreadId="thread-1"
        isAsking
        canAsk={false}
        errorMessage={null}
        isTranscriptLoading={false}
        onQuestionChange={noop}
        onAsk={noop}
        onFollowUp={noop}
        onJump={noop}
        onOpenSettings={noop}
        onOpenOverview={noop}
        onLoadTranscript={noop}
        formatTimestamp={formatTimestamp}
      />,
    )

    expect(markup).toContain('aria-label="Delete Earlier question"')
    expect(markup.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(3)
    expect(markup).toContain("max-w-[calc(100vw-1.5rem)]")
    expect(markup).toContain("overflow-x-hidden")
  })

  it("renders transcript rows in a bounded panel and disables fake VTT download", () => {
    const markup = renderToStaticMarkup(
      <TranscriptTab
        segments={[{ startSec: 12, endSec: 18, text: "Transcript row" }]}
        isLoading={false}
        errorMessage={null}
        canLoad
        rawVtt={null}
        onLoad={noop}
        onDownload={noop}
        onJump={noop}
        formatTimestamp={formatTimestamp}
      />,
    )
    expect(markup).toContain("Transcript row")
    expect(markup).toContain("h-[28rem]")
    expect(markup).toContain("Original VTT is unavailable")
    expect(markup).toContain("disabled")
  })

  it("shows an analysis/transcript identity mismatch instead of a misleading load prompt", () => {
    const markup = renderToStaticMarkup(
      <AskTab
        hasProvider
        hasAnalysis
        hasTranscript={false}
        transcriptMismatch
        question=""
        answer={null}
        isAsking={false}
        canAsk={false}
        errorMessage={null}
        isTranscriptLoading={false}
        onQuestionChange={noop}
        onAsk={noop}
        onFollowUp={noop}
        onJump={noop}
        onOpenSettings={noop}
        onOpenOverview={noop}
        onLoadTranscript={noop}
        formatTimestamp={formatTimestamp}
      />,
    )

    expect(markup).toContain("Transcript changed since this analysis")
    expect(markup).toContain("Regenerate the analysis before continuing Ask Video.")
    expect(markup).toContain("Go to Overview")
    expect(markup).not.toContain("Load transcript")
  })

  it("embeds the existing Provider form and Connection Test in Settings", () => {
    const markup = renderToStaticMarkup(<SettingsTab onProvidersChange={noop} />)
    expect(markup).toContain("Provider configuration")
    expect(markup).toContain("API key")
    expect(markup).toContain("Fetch models")
    expect(markup).toContain("Save provider")
    expect(markup).toContain("Test connection")
  })

  it("keeps all four accessible tabs usable at narrow widths", () => {
    const markup = renderToStaticMarkup(
      <SidePanelShell
        activeTab="overview"
        onTabChange={noop}
        header={<div>Header</div>}
        overview={<div>Overview content</div>}
        transcript={<div>Transcript content</div>}
        ask={<div>Ask content</div>}
        settings={<div>Settings content</div>}
      />,
    )
    expect(markup).toContain("Overview")
    expect(markup).toContain("Transcript")
    expect(markup).toContain("Ask")
    expect(markup).toContain("Settings")
    expect(markup).toContain("grid-cols-2")
    expect(markup).toContain("min-[420px]:grid-cols-4")
  })
})

describe("Analysis preset selector", () => {
  const baseOverview = {
    analysis: null,
    analysisError: null,
    analysisPhase: "idle" as const,
    isLoading: false,
    hasProvider: true,
    canAnalyze: true,
    lastAnalyzedAt: null,
    recentItems: [],
    isHistoryLoading: false,
    activeVideoId: "video-a",
    onAnalyze: noop,
    onCancel: noop,
    onConfigureProvider: noop,
    onJump: noop,
    onSelectHistory: noop,
    onOpenFullHistory: noop,
    formatTimestamp,
  }

  it("renders the three built-in presets with localized labels", () => {
    const markup = renderToStaticMarkup(
      <OverviewTab
        {...baseOverview}
        analysisPresetId="standard"
        onAnalysisPresetChange={noop}
      />,
    )

    expect(markup).toContain("Standard")
    expect(markup).toContain("Concise")
    expect(markup).toContain("Detailed")
    expect(markup).toContain("Analysis preset")
    expect(markup).toContain("Global default for every video")
  })

  it("marks the persisted preset as the selected option", () => {
    const markup = renderToStaticMarkup(
      <OverviewTab
        {...baseOverview}
        analysisPresetId="detailed"
        onAnalysisPresetChange={noop}
      />,
    )

    expect(markup).toMatch(/data-state="on"[^>]*title="Fuller explanations/)
    expect(markup).toMatch(/data-state="off"[^>]*title="Balanced summary/)
  })

  it("disables the selector while the persisted preset is still loading", () => {
    const markup = renderToStaticMarkup(
      <OverviewTab
        {...baseOverview}
        analysisPresetId="standard"
        isAnalysisPresetLoading
        onAnalysisPresetChange={noop}
      />,
    )

    const selector = markup.slice(markup.indexOf('id="analysis-preset-label"'))
    expect(selector).toContain('disabled=""')
    expect(selector).toMatch(/disabled=""[^>]*>Standard</)
  })

  it("keeps the selector independent from the analyze action", () => {
    const markup = renderToStaticMarkup(
      <OverviewTab
        {...baseOverview}
        analysisPresetId="concise"
        onAnalysisPresetChange={noop}
      />,
    )

    expect(markup).toContain("Generate")
    expect(markup).not.toContain("Regenerate")
    expect(markup).toContain("Not analyzed")
  })

  it("E. disables the selector while a preset save is pending", () => {
    const markup = renderToStaticMarkup(
      <OverviewTab
        {...baseOverview}
        analysisPresetId="concise"
        isAnalysisPresetSaving
        onAnalysisPresetChange={noop}
      />,
    )

    const selector = markup.slice(markup.indexOf('id="analysis-preset-label"'))
    expect(selector).toContain('disabled=""')
    expect(selector).toMatch(/disabled=""[^>]*>Standard</)
  })

  it("keeps the selector enabled when no save is pending", () => {
    const markup = renderToStaticMarkup(
      <OverviewTab
        {...baseOverview}
        analysisPresetId="concise"
        isAnalysisPresetSaving={false}
        onAnalysisPresetChange={noop}
      />,
    )

    const selector = markup.slice(
      markup.indexOf('id="analysis-preset-label"'),
      markup.indexOf("Global default for every video"),
    )
    expect(selector).not.toContain('disabled=""')
    expect(selector).toMatch(/data-state="on"[^>]*>Concise</)
  })

  it("keeps Analyze blocked while a preset save is pending", () => {
    const markup = renderToStaticMarkup(
      <OverviewTab
        {...baseOverview}
        canAnalyze={false}
        analysisPresetId="concise"
        isAnalysisPresetSaving
        onAnalysisPresetChange={noop}
      />,
    )

    const analyzeIndex = markup.lastIndexOf("Generate")
    const analyzeButton = markup.slice(
      markup.lastIndexOf("<button", analyzeIndex),
      markup.indexOf("</button>", analyzeIndex),
    )
    expect(analyzeButton).toContain('disabled=""')
    expect(analyzeButton).toContain("Generate")
  })
})
