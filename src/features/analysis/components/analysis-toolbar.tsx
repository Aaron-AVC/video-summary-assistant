import { Loader2, PlayCircle, RotateCcw, Settings2, Square } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  ANALYSIS_PRESET_IDS,
  type AnalysisPresetId,
} from "@/features/analysis/lib/analysis-preset"
import {
  getAnalysisAction,
  type AnalysisPhase,
} from "@/sidepanel/lib/sidepanel-ux"
import { useI18n } from "@/lib/i18n/i18n-provider"

type AnalysisToolbarProps = {
  hasProvider: boolean
  hasAnalysis: boolean
  canAnalyze: boolean
  status: AnalysisPhase
  lastAnalyzedAt: string | null
  analysisPresetId: AnalysisPresetId
  isAnalysisPresetLoading?: boolean
  onAnalysisPresetChange: (presetId: AnalysisPresetId) => void | Promise<void>
  onAnalyze: (options?: { force?: boolean }) => void | Promise<void>
  onCancel: () => void
  onConfigureProvider: () => void
}

export function AnalysisToolbar({
  hasProvider,
  hasAnalysis,
  canAnalyze,
  status,
  lastAnalyzedAt,
  analysisPresetId,
  isAnalysisPresetLoading = false,
  onAnalysisPresetChange,
  onAnalyze,
  onCancel,
  onConfigureProvider,
}: AnalysisToolbarProps) {
  const { t } = useI18n()
  const isAnalyzing = status === "loading-transcript" || status === "analyzing" || status === "cancelling"
  const isFinalizing = status === "finalizing"
  const action = getAnalysisAction({ hasProvider, hasAnalysis, isAnalyzing, isFinalizing })
  const isCancelling = status === "cancelling"
  const statusKey = status === "loading-transcript" ? "runtime.statusLoadingTranscript"
    : status === "analyzing" ? "runtime.statusAnalyzing"
      : status === "finalizing" ? "runtime.statusSaving"
        : status === "cancelling" ? "runtime.statusCancelling"
          : status === "error" ? "runtime.statusError"
            : status === "cancelled" ? "runtime.statusCancelled"
              : hasAnalysis ? "runtime.statusReady" : "runtime.statusNotAnalyzed"

  return (
    <Card className="border-border/70 bg-card/95">
      <CardHeader className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">{t("toolbar.title")}</CardTitle>
            <CardDescription role="status" className="text-xs">
              {t(statusKey)}{lastAnalyzedAt ? ` · ${lastAnalyzedAt}` : ""}
            </CardDescription>
          </div>
          <Badge variant={hasProvider ? "secondary" : "outline"} className="rounded-full px-3 py-1">
            {hasProvider ? t("overview.providerReady") : t("overview.providerRequired")}
          </Badge>
        </div>
        <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span id="analysis-preset-label" className="text-xs font-medium text-foreground">
              {t("toolbar.presetLabel")}
            </span>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              aria-labelledby="analysis-preset-label"
              className="justify-start"
              disabled={isAnalysisPresetLoading}
              value={analysisPresetId}
              onValueChange={(value) => {
                if (!value) return
                void onAnalysisPresetChange(value as AnalysisPresetId)
              }}>
              {ANALYSIS_PRESET_IDS.map((presetId) => (
                <ToggleGroupItem
                  key={presetId}
                  value={presetId}
                  title={t(`analysisPreset.${presetId}Description`)}
                  aria-label={t(`analysisPreset.${presetId}Description`)}
                  className="px-2.5 text-xs">
                  {t(`analysisPreset.${presetId}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("toolbar.presetHint")}
          </p>
        </div>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-2 p-4 pt-0 sm:flex-row">
        <div className="flex flex-1 flex-wrap gap-2">
          {action.kind === "configure-provider" ? (
            <Button className="min-w-0 flex-1 gap-2" onClick={onConfigureProvider}>
              <Settings2 data-icon="inline-start" />
              {t("overview.configureProvider")}
            </Button>
          ) : action.kind === "cancel" ? (
            <Button
              variant="destructive"
              className="min-w-0 flex-1 gap-2"
              onClick={onCancel}
              disabled={isCancelling}
              aria-label={t("toolbar.cancelAnalysis")}>
              <Square data-icon="inline-start" />
              {isCancelling ? t("task.cancelling") : t("common.cancel")}
            </Button>
          ) : action.kind === "finalizing" ? (
            <Button
              variant="secondary"
              className="min-w-0 flex-1 gap-2"
              disabled
              aria-label={t("toolbar.savingAnalysis")}>
              <Loader2 data-icon="inline-start" className="animate-spin" />
              {t("task.savingAnalysis")}
            </Button>
          ) : (
            <Button
              className="min-w-0 flex-1 gap-2"
              disabled={!canAnalyze}
              onClick={() => onAnalyze({ force: action.kind === "regenerate" })}>
              {status === "loading-transcript" || status === "analyzing" ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : action.kind === "regenerate" ? (
                <RotateCcw data-icon="inline-start" />
              ) : (
                <PlayCircle data-icon="inline-start" />
              )}
              {action.kind === "regenerate" ? t("overview.regenerate") : t("overview.generate")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
