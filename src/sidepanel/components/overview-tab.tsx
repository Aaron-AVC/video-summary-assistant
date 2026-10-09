import { Sparkles } from "lucide-react"

import { AnalysisToolbar } from "@/features/analysis/components/analysis-toolbar"
import { KeyPointsList } from "@/features/analysis/components/key-points-list"
import { SegmentTimeline } from "@/features/analysis/components/segment-timeline"
import { SummaryCard } from "@/features/analysis/components/summary-card"
import type { VideoAnalysis } from "@/features/analysis/lib/analysis-schema"
import { EmptyState } from "@/features/common/components/empty-state"
import {
  RecentAnalysisList,
  type RecentAnalysisListItem,
} from "@/features/history/components/recent-analysis-list"
import type { AnalysisPhase } from "@/sidepanel/lib/sidepanel-ux"

type OverviewTabProps = {
  analysis: VideoAnalysis | null
  analysisError: string | null
  analysisPhase: AnalysisPhase
  isLoading: boolean
  hasProvider: boolean
  canAnalyze: boolean
  lastAnalyzedAt: string | null
  recentItems: RecentAnalysisListItem[]
  isHistoryLoading: boolean
  activeVideoId: string | null
  onAnalyze: () => void | Promise<void>
  onCancel: () => void
  onConfigureProvider: () => void
  onJump: (timestampSeconds: number) => void | Promise<void>
  onSelectHistory: (videoId: string) => void | Promise<void>
  onOpenFullHistory: () => void
  formatTimestamp: (timestampSeconds: number) => string
}

export function OverviewTab({
  analysis,
  analysisError,
  analysisPhase,
  isLoading,
  hasProvider,
  canAnalyze,
  lastAnalyzedAt,
  recentItems,
  isHistoryLoading,
  activeVideoId,
  onAnalyze,
  onCancel,
  onConfigureProvider,
  onJump,
  onSelectHistory,
  onOpenFullHistory,
  formatTimestamp,
}: OverviewTabProps) {
  const chapters = analysis?.chapters.map((chapter, index) => ({
    ...chapter,
    id: `chapter-${index}`,
  })) ?? []

  return (
    <div className="flex min-w-0 flex-col gap-3" data-layout-check="overview-tab">
      <AnalysisToolbar
        hasProvider={hasProvider}
        hasAnalysis={Boolean(analysis)}
        canAnalyze={canAnalyze}
        status={analysisPhase}
        lastAnalyzedAt={lastAnalyzedAt}
        onAnalyze={onAnalyze}
        onCancel={onCancel}
        onConfigureProvider={onConfigureProvider}
      />
      <div className="grid min-w-0 gap-3 min-[720px]:grid-cols-[1.15fr_0.85fr]">
        <SummaryCard
          summary={analysis?.summary ?? null}
          isLoading={isLoading && !analysis}
          errorMessage={analysisError}
        />
        <KeyPointsList
          keyPoints={analysis?.keyPoints ?? []}
          isLoading={isLoading && !analysis}
          onJump={onJump}
          formatTimestamp={formatTimestamp}
        />
      </div>
      <SegmentTimeline
        segments={chapters}
        isLoading={isLoading && !analysis}
        onJump={onJump}
        formatTimestamp={formatTimestamp}
      />
      {!isLoading && !analysis ? (
        <EmptyState
          className="border border-dashed border-border/70 bg-card/70"
          icon={<Sparkles />}
          title="Generate an analysis"
          description="Use the action above to create transcript-grounded Summary, Key Points, and Chapters for the current video."
        />
      ) : null}
      <RecentAnalysisList
        items={recentItems}
        isLoading={isHistoryLoading}
        activeVideoId={activeVideoId}
        onSelect={onSelectHistory}
        onOpenFullHistory={onOpenFullHistory}
        scrollHeightClassName="h-[16rem]"
      />
    </div>
  )
}
