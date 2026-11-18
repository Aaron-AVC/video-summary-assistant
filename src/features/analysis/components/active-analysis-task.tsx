import { Loader2, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { ActiveAnalysisTask } from "@/features/analysis/lib/analysis-task-controller"
import { useI18n } from "@/lib/i18n/i18n-provider"
import { getAnalysisTaskPresentation } from "@/sidepanel/lib/task-presentation"

type ActiveAnalysisTaskBannerProps = {
  task: ActiveAnalysisTask
  onCancel: () => void
}
export function ActiveAnalysisTaskBanner({ task, onCancel }: ActiveAnalysisTaskBannerProps) {
  const { t } = useI18n()
  const presentation = getAnalysisTaskPresentation(task.phase)
  const progress = task.phase === "analyzing" ? task.progress : undefined
  const progressLabel = progress?.kind === "map"
    ? t("task.analysisMap", { completed: progress.completed, total: progress.total })
    : progress?.kind === "reduction"
      ? t("task.analysisReduction", {
        level: progress.level, completed: progress.completed, total: progress.total
      })
      : progress?.kind === "final"
        ? t("task.analysisFinal")
        : progress?.kind === "repair"
          ? t("task.analysisRepair")
          : progress?.kind === "direct"
            ? t("task.analysisDirect")
            : t(presentation.phaseLabelKey)

  return (
    <Card className="border-amber-500/40 bg-amber-500/10">
      <CardContent className="flex min-w-0 items-center justify-between gap-3 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <Loader2 className={`h-4 w-4 shrink-0 ${presentation.spinnerAnimated ? "animate-spin" : ""}`} />
          <div className="min-w-0 text-xs">
            <div className="font-medium [overflow-wrap:anywhere]">{t("task.activeAnalysis", { title: task.snapshot.title })}</div>
            <div className="text-muted-foreground [overflow-wrap:anywhere]">
              {progressLabel} · {task.snapshot.providerModel}
            </div>
          </div>
        </div>
        <Button
          variant="destructive"
          size="sm"
          className="shrink-0 gap-2"
          disabled={presentation.cancelDisabled}
          onClick={onCancel}
          aria-label={t("common.cancel")}>
          <Square data-icon="inline-start" />
          {t(presentation.cancelling ? "task.cancelling" : "common.cancel")}
        </Button>
      </CardContent>
    </Card>
  )
}
