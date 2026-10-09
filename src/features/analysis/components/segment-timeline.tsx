import { Download, Play } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"

export type SegmentTimelineItem = {
  id: string
  title: string
  summary: string
  detail: string
  startSec: number
  endSec: number
}

type SegmentTimelineProps = {
  segments: SegmentTimelineItem[]
  isLoading: boolean
  canDownload: boolean
  onJump: (timestampSeconds: number) => void | Promise<void>
  onDownload: () => void | Promise<void>
  formatTimestamp: (timestampSeconds: number) => string
}

export function SegmentTimeline({
  segments,
  isLoading,
  canDownload,
  onJump,
  onDownload,
  formatTimestamp
}: SegmentTimelineProps) {
  return (
    <Card className="min-w-0 overflow-hidden border-border/70 bg-card/95" data-layout-check="chapters-panel">
      <CardHeader className="flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <CardTitle className="text-base">Chapters</CardTitle>
          <CardDescription className="text-xs">Jump to transcript-backed sections.</CardDescription>
        </div>
        <Button variant="outline" size="sm" className="shrink-0 gap-2" disabled={!canDownload} onClick={onDownload}>
          <Download data-icon="inline-start" />
          VTT
        </Button>
      </CardHeader>
      <CardContent className="min-w-0 overflow-hidden p-4 pt-0">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-20 w-[92%] rounded-lg" />
          </div>
        ) : segments.length > 0 ? (
          <ScrollArea className="h-[24rem] w-full max-w-full overflow-hidden pr-3">
            <div className="flex min-w-0 max-w-full flex-col gap-3">
              {segments.map((segment, index) => (
                <div key={segment.id} className="flex min-w-0 max-w-full flex-col gap-3">
                  <div className="min-w-0 max-w-full overflow-hidden rounded-lg border border-border/70 bg-background/80 p-3">
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 max-w-full flex-col gap-2">
                        <Badge variant="secondary" className="w-fit max-w-full rounded-full px-3 py-1">
                          {formatTimestamp(segment.startSec)} - {formatTimestamp(segment.endSec)}
                        </Badge>
                        <h3 className="max-w-full text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
                          {segment.title}
                        </h3>
                      </div>
                      <Button size="sm" className="shrink-0 gap-2" onClick={() => onJump(segment.startSec)}>
                        <Play data-icon="inline-start" />
                        Jump here
                      </Button>
                    </div>
                    <p className="mt-3 max-w-full text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                      {segment.summary}
                    </p>
                    <p className="mt-2 max-w-full text-sm leading-6 text-foreground/80 [overflow-wrap:anywhere]">
                      {segment.detail}
                    </p>
                  </div>
                  {index < segments.length - 1 ? <Separator /> : null}
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <p className="text-sm text-muted-foreground">
            Chapters will appear here after a completed analysis.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
