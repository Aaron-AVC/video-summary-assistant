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
import {
  getAnalysisAction,
  getAnalysisStatusLabel,
  type AnalysisPhase,
} from "@/sidepanel/lib/sidepanel-ux"

type AnalysisToolbarProps = {
  hasProvider: boolean
  hasAnalysis: boolean
  canAnalyze: boolean
  status: AnalysisPhase
  lastAnalyzedAt: string | null
  onAnalyze: () => void | Promise<void>
  onCancel: () => void
  onConfigureProvider: () => void
}

export function AnalysisToolbar({
  hasProvider,
  hasAnalysis,
  canAnalyze,
  status,
  lastAnalyzedAt,
  onAnalyze,
  onCancel,
  onConfigureProvider,
}: AnalysisToolbarProps) {
  const isAnalyzing = status === "loading-transcript" || status === "analyzing" || status === "cancelling"
  const action = getAnalysisAction({ hasProvider, hasAnalysis, isAnalyzing })
  const isCancelling = status === "cancelling"
  const statusLabel = getAnalysisStatusLabel(status, hasAnalysis)

  return (
    <Card className="border-border/70 bg-card/95">
      <CardHeader className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Analysis</CardTitle>
            <CardDescription role="status" className="text-xs">
              {statusLabel}{lastAnalyzedAt ? ` · ${lastAnalyzedAt}` : ""}
            </CardDescription>
          </div>
          <Badge variant={hasProvider ? "secondary" : "outline"} className="rounded-full px-3 py-1">
            {hasProvider ? "Provider ready" : "Provider required"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-2 p-4 pt-0 sm:flex-row">
        <div className="flex flex-1 flex-wrap gap-2">
          {action.kind === "configure-provider" ? (
            <Button className="min-w-0 flex-1 gap-2" onClick={onConfigureProvider}>
              <Settings2 data-icon="inline-start" />
              Configure provider
            </Button>
          ) : action.kind === "cancel" ? (
            <Button
              variant="destructive"
              className="min-w-0 flex-1 gap-2"
              onClick={onCancel}
              disabled={isCancelling}
              aria-label="Cancel analysis">
              <Square data-icon="inline-start" />
              {isCancelling ? "Cancelling…" : "Cancel"}
            </Button>
          ) : (
            <Button className="min-w-0 flex-1 gap-2" disabled={!canAnalyze} onClick={onAnalyze}>
              {status === "loading-transcript" || status === "analyzing" ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : action.kind === "regenerate" ? (
                <RotateCcw data-icon="inline-start" />
              ) : (
                <PlayCircle data-icon="inline-start" />
              )}
              {action.label}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
