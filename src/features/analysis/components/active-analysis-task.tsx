import { Loader2, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { ActiveAnalysisTask } from "@/features/analysis/lib/analysis-task-controller"
import { useI18n } from "@/lib/i18n/i18n-provider"

type ActiveAnalysisTaskBannerProps = {
  task: ActiveAnalysisTask
  onCancel: () => void
}
export function ActiveAnalysisTaskBanner({ task, onCancel }: ActiveAnalysisTaskBannerProps) {
  const { t } = useI18n()
  const isCancelling = task.phase === "cancelling"
  const isFinalizing = task.phase === "finalizing"
  const phaseLabel = task.phase === "loading-transcript"
    ? t("task.loadingTranscript")
    : isCancelling
      ? t("task.cancelling")
      : isFinalizing
        ? t("task.savingAnalysis")
        : t("task.analyzing")

  return (
    <Card className="border-amber-500/40 bg-amber-500/10">
      <CardContent className="flex min-w-0 items-center justify-between gap-3 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <Loader2 className={`h-4 w-4 shrink-0 ${isCancelling ? "" : "animate-spin"}`} />
          <div className="min-w-0 text-xs">
            <div className="font-medium [overflow-wrap:anywhere]">{t("task.activeAnalysis", { title: task.snapshot.title })}</div>
            <div className="text-muted-foreground [overflow-wrap:anywhere]">
              {phaseLabel} · {task.snapshot.providerModel}
            </div>
          </div>
        </div>
        <Button
          variant="destructive"
          size="sm"
          className="shrink-0 gap-2"
          disabled={isCancelling || isFinalizing}
          onClick={onCancel}
          aria-label={t("common.cancel")}>
          <Square data-icon="inline-start" />
          {isCancelling ? t("task.cancelling") : t("common.cancel")}
        </Button>
      </CardContent>
    </Card>
  )
}
