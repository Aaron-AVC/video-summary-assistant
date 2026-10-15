import { Loader2, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { ActiveAskTask } from "@/features/analysis/lib/ask-task-controller"

type ActiveAskTaskBannerProps = {
  task: ActiveAskTask
  onCancel: () => void
}

export function ActiveAskTaskBanner({ task, onCancel }: ActiveAskTaskBannerProps) {
  const isCancelling = task.phase === "cancelling"
  const isFinalizing = task.phase === "finalizing"
  const phaseLabel = isCancelling
    ? "Cancelling…"
    : isFinalizing
      ? "Saving answer…"
      : task.phase === "repairing"
        ? "Repairing answer…"
        : "Answering…"

  return (
    <Card className="border-sky-500/40 bg-sky-500/10">
      <CardContent className="flex min-w-0 items-center justify-between gap-3 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <Loader2 className={`h-4 w-4 shrink-0 ${isCancelling ? "" : "animate-spin"}`} />
          <div className="min-w-0 text-xs">
            <div className="font-medium [overflow-wrap:anywhere]">Active Ask · {task.snapshot.videoTitle}</div>
            <div className="text-muted-foreground [overflow-wrap:anywhere]">{phaseLabel} · {task.snapshot.question}</div>
          </div>
        </div>
        <Button
          variant="destructive"
          size="sm"
          className="shrink-0 gap-2"
          disabled={isCancelling || isFinalizing}
          onClick={onCancel}
          aria-label="Cancel active Ask Video request">
          <Square data-icon="inline-start" />
          {isCancelling ? "Cancelling…" : "Cancel"}
        </Button>
      </CardContent>
    </Card>
  )
}
