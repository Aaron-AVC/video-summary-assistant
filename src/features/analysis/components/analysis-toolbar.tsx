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

type AnalysisToolbarProps = {
  hasProvider: boolean
  canAnalyze: boolean
  isAnalyzing: boolean
  isCancelling?: boolean
  lastAnalyzedAt: string | null
  onAnalyze: () => void | Promise<void>
  onCancel?: () => void
  onOpenOptions: () => void | Promise<void>
}

export function AnalysisToolbar({
  hasProvider,
  canAnalyze,
  isAnalyzing,
  isCancelling = false,
  lastAnalyzedAt,
  onAnalyze,
  onCancel,
  onOpenOptions
}: AnalysisToolbarProps) {
  const actionLabel = isAnalyzing ? "Analyzing…" : lastAnalyzedAt ? "Reanalyze video" : "Analyze video"

  return (
    <Card className="border-border/70 bg-card/95">
      <CardHeader className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Summarize</CardTitle>
            <CardDescription className="text-xs">
              {lastAnalyzedAt ? `Saved ${lastAnalyzedAt}.` : "No saved analysis yet."}
            </CardDescription>
          </div>
          <Badge variant={hasProvider ? "secondary" : "outline"} className="rounded-full px-3 py-1">
            {hasProvider ? "Provider ready" : "Provider required"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 p-4 pt-0 sm:flex-row">
        <div className="flex flex-1 flex-wrap gap-2">
          <Button variant="outline" className="gap-2" onClick={onOpenOptions}>
            <Settings2 data-icon="inline-start" />
            Settings
          </Button>
          <Button className="min-w-40 flex-1 gap-2" disabled={!canAnalyze || isAnalyzing} onClick={onAnalyze}>
            {isAnalyzing ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : lastAnalyzedAt ? (
              <RotateCcw data-icon="inline-start" />
            ) : (
              <PlayCircle data-icon="inline-start" />
            )}
            {actionLabel}
          </Button>
          {isAnalyzing && onCancel ? (
            <Button
              variant="destructive"
              className="gap-2"
              onClick={onCancel}
              disabled={isCancelling}
              aria-label="Cancel analysis">
              <Square data-icon="inline-start" />
              {isCancelling ? "Cancelling…" : "Cancel"}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
