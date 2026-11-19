import { Sparkles } from "lucide-react"

import { AnalysisToolbar } from "@/features/analysis/components/analysis-toolbar"
import { FinalResumePanel } from "@/features/analysis/components/final-resume-panel"
import { KeyPointsList } from "@/features/analysis/components/key-points-list"
import { SegmentTimeline } from "@/features/analysis/components/segment-timeline"
import { SummaryCard } from "@/features/analysis/components/summary-card"
import type { VideoAnalysis } from "@/features/analysis/lib/analysis-schema"
import type { AnalysisPresetId } from "@/features/analysis/lib/analysis-preset"
import { DEFAULT_ANALYSIS_PRESET_ID } from "@/features/analysis/lib/analysis-preset"
import { EmptyState } from "@/features/common/components/empty-state"
import {
  MarkdownExportPanel,
  type MarkdownExportPanelProps,
} from "@/features/export/components/markdown-export-panel"
import {
  KnowledgePanel,
  type KnowledgePanelHandlers,
} from "@/features/knowledge/components/knowledge-panel"
import type { KnowledgeItemEntity } from "@/lib/schemas/persistence"
import {
  RecentAnalysisList,
  type RecentAnalysisListItem,
} from "@/features/history/components/recent-analysis-list"
import type { FinalResumeView } from "@/sidepanel/analysis/final-resume-availability"
import type { AnalysisPhase } from "@/sidepanel/lib/sidepanel-ux"
import { useI18n } from "@/lib/i18n/i18n-provider"

type OverviewTabProps = {
  analysis: VideoAnalysis | null
  hasCurrentAnalysis?: boolean
  analysisError: string | null
  analysisPhase: AnalysisPhase
  isLoading: boolean
  hasProvider: boolean
  canAnalyze: boolean
  lastAnalyzedAt: string | null
  analysisPresetId?: AnalysisPresetId
  isAnalysisPresetLoading?: boolean
  isAnalysisPresetSaving?: boolean
  onAnalysisPresetChange?: (presetId: AnalysisPresetId) => void | Promise<void>
  recentItems: RecentAnalysisListItem[]
  isHistoryLoading: boolean
  activeVideoId: string | null
  activeAnalysisRunId?: string | null
  onAnalyze: (options?: { force?: boolean }) => void | Promise<void>
  onCancel: () => void
  onConfigureProvider: () => void
  onJump: (timestampSeconds: number) => void | Promise<void>
  onSelectHistory: (videoId: string, contentKey?: string, analysisRunId?: string) => void | Promise<void>
  onDeleteAnalysis?: (item: RecentAnalysisListItem) => void | Promise<void>
  onDeleteVideo?: (item: RecentAnalysisListItem) => void | Promise<void>
  onOpenFullHistory: () => void
  formatTimestamp: (timestampSeconds: number) => string
  knowledgeItems?: KnowledgeItemEntity[]
  knowledgeContentKey?: string | null
  isKnowledgeLoading?: boolean
  knowledgeError?: string | null
  currentTimestamp?: number | null
  knowledgeHandlers?: KnowledgePanelHandlers
  markdownExport?: MarkdownExportPanelProps
  finalResume?: {
    view: FinalResumeView
    onResume: () => void
    onRegenerate: () => void
    onCancel: () => void
  } | null
}

export function OverviewTab({
  analysis,
  hasCurrentAnalysis = Boolean(analysis),
  analysisError,
  analysisPhase,
  isLoading,
  hasProvider,
  canAnalyze,
  lastAnalyzedAt,
  analysisPresetId = DEFAULT_ANALYSIS_PRESET_ID,
  isAnalysisPresetLoading = false,
  isAnalysisPresetSaving = false,
  onAnalysisPresetChange,
  recentItems,
  isHistoryLoading,
  activeVideoId,
  activeAnalysisRunId,
  onAnalyze,
  onCancel,
  onConfigureProvider,
  onJump,
  onSelectHistory,
  onDeleteAnalysis,
  onDeleteVideo,
  onOpenFullHistory,
  formatTimestamp,
  knowledgeItems,
  knowledgeContentKey = null,
  isKnowledgeLoading = false,
  knowledgeError = null,
  currentTimestamp = null,
  knowledgeHandlers,
  markdownExport,
  finalResume = null,
}: OverviewTabProps) {
  const { t } = useI18n()
  const chapters = analysis?.chapters.map((chapter, index) => ({
    ...chapter,
    id: `chapter-${index}`,
  })) ?? []

  return (
    <div className="flex min-w-0 flex-col gap-3" data-layout-check="overview-tab">
      <AnalysisToolbar
        hasProvider={hasProvider}
        hasAnalysis={hasCurrentAnalysis}
        canAnalyze={canAnalyze}
        status={analysisPhase}
        lastAnalyzedAt={lastAnalyzedAt}
        analysisPresetId={analysisPresetId}
        isAnalysisPresetLoading={isAnalysisPresetLoading}
        isAnalysisPresetSaving={isAnalysisPresetSaving}
        onAnalysisPresetChange={onAnalysisPresetChange ?? (() => {})}
        onAnalyze={onAnalyze}
        onCancel={onCancel}
        onConfigureProvider={onConfigureProvider}
      />
      {finalResume ? (
        <FinalResumePanel
          view={finalResume.view}
          errorMessage={analysisError}
          videoTitle={activeVideoId}
          onResume={finalResume.onResume}
          onRegenerate={finalResume.onRegenerate}
          onCancel={finalResume.onCancel}
        />
      ) : null}
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
      {knowledgeHandlers ? (
        <KnowledgePanel
          items={knowledgeItems ?? []}
          contentKey={knowledgeContentKey ?? null}
          isLoading={isKnowledgeLoading}
          error={knowledgeError}
          currentTimestamp={currentTimestamp ?? null}
          formatTimestamp={formatTimestamp}
          handlers={knowledgeHandlers}
        />
      ) : null}
      {markdownExport ? <MarkdownExportPanel {...markdownExport} /> : null}
      {!isLoading && !analysis ? (
        <EmptyState
          className="border border-dashed border-border/70 bg-card/70"
          icon={<Sparkles />}
          title={t("overview.emptyTitle")}
          description={t("overview.emptyDescription")}
        />
      ) : null}
      <RecentAnalysisList
        items={recentItems}
        isLoading={isHistoryLoading}
        activeVideoId={activeVideoId}
        activeAnalysisRunId={activeAnalysisRunId}
        onSelect={onSelectHistory}
        onDeleteAnalysis={onDeleteAnalysis}
        onDeleteVideo={onDeleteVideo}
        onOpenFullHistory={onOpenFullHistory}
        scrollHeightClassName="h-[16rem]"
      />
    </div>
  )
}
