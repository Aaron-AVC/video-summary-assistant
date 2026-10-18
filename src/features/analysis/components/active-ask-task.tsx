import { Loader2, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { ActiveAskTask } from "@/features/analysis/lib/ask-task-controller"
import { useI18n } from "@/lib/i18n/i18n-provider"
import { getAskTaskPresentation } from "@/sidepanel/lib/task-presentation"

type ActiveAskTaskBannerProps = {
  task: ActiveAskTask
  onCancel: () => void
}

export function ActiveAskTaskBanner({ task, onCancel }: ActiveAskTaskBannerProps) {
  const { t } = useI18n()
  const presentation = getAskTaskPresentation(task.phase)

  return (
    <Card className="border-sky-500/40 bg-sky-500/10">
      <CardContent className="flex min-w-0 items-center justify-between gap-3 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <Loader2 className={`h-4 w-4 shrink-0 ${presentation.spinnerAnimated ? "animate-spin" : ""}`} />
          <div className="min-w-0 text-xs">
            <div className="font-medium [overflow-wrap:anywhere]">{t("task.activeAsk", { title: task.snapshot.videoTitle })}</div>
            <div className="text-muted-foreground [overflow-wrap:anywhere]">{t(presentation.phaseLabelKey)} · {task.snapshot.question}</div>
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
