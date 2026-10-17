import { CheckCircle2, ListChecks, Play } from "lucide-react"

import type { AnalysisKeyPoint } from "@/features/analysis/lib/analysis-schema"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useI18n } from "@/lib/i18n/i18n-provider"

type KeyPointsListProps = {
  keyPoints: AnalysisKeyPoint[]
  isLoading: boolean
  onJump: (timestampSeconds: number) => void | Promise<void>
  formatTimestamp: (timestampSeconds: number) => string
}

function hasJumpRange(point: AnalysisKeyPoint): point is AnalysisKeyPoint & {
  startSec: number
  endSec: number
} {
  return "startSec" in point && "endSec" in point
}

export function KeyPointsList({
  keyPoints,
  isLoading,
  onJump,
  formatTimestamp
}: KeyPointsListProps) {
  const { t } = useI18n()
  return (
    <Card className="min-w-0 overflow-hidden border-border/70 bg-card/95">
      <CardHeader className="p-4">
        <CardDescription className="flex items-center gap-2 text-xs font-medium uppercase text-primary">
          <ListChecks className="h-3.5 w-3.5" />
          {t("overview.keyPoints")}
        </CardDescription>
        <CardTitle className="text-base">{t("overview.scanJump")}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-[88%] rounded-lg" />
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {keyPoints.map((point, index) => (
              <li
                key={`kp-${index}`}
                className="flex min-w-0 gap-3 rounded-lg border border-border/70 bg-background/80 p-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="max-w-full text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">{point.text}</span>
                  {hasJumpRange(point) ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="rounded-full px-2 py-0.5">
                        {formatTimestamp(point.startSec)} - {formatTimestamp(point.endSec)}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-2"
                        onClick={() => onJump(point.startSec)}>
                        <Play data-icon="inline-start" />
                        {t("overview.jump")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
            {keyPoints.length === 0 ? (
              <li className="rounded-lg border border-dashed border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
                {t("overview.runPoints")}
              </li>
            ) : null}
          </ul>
        )}
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>{t("overview.readable")}</span>
          <Badge variant="secondary">{t("overview.itemCount", { count: keyPoints.length })}</Badge>
        </div>
      </CardContent>
    </Card>
  )
}
