import { AlertTriangle, Sparkles } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

type SummaryCardProps = {
  summary: string | null
  isLoading: boolean
  errorMessage: string | null
}

export function SummaryCard({ summary, isLoading, errorMessage }: SummaryCardProps) {
  return (
    <Card className="min-w-0 overflow-hidden border-border/70 bg-card/95">
      <CardHeader className="p-4">
        <CardDescription className="flex items-center gap-2 text-xs font-medium uppercase text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          Summary
        </CardDescription>
        <CardTitle className="text-base">What matters</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-4 pt-0">
        {errorMessage ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Analysis failed</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}
        {isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-[92%]" />
            <Skeleton className="h-4 w-[76%]" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        ) : (
          <p className="max-w-full whitespace-pre-wrap text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
            {summary ?? "Run analysis to generate a concise summary for the current video."}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
