import { ChevronDown, Film, RefreshCcw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"

type CurrentVideoCardProps = {
  title: string
  channelName: string | null
  canonicalUrl: string
  videoId: string
  timestampLabel: string
  isReady: boolean
  runtimeStatus: string
  providerName: string | null
  onRefresh: () => void | Promise<void>
}

export function CurrentVideoCard({
  title,
  channelName,
  canonicalUrl,
  videoId,
  timestampLabel,
  isReady,
  runtimeStatus,
  providerName,
  onRefresh
}: CurrentVideoCardProps) {
  return (
    <Card className="overflow-hidden border-border/70 bg-card/95">
      <CardHeader className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1 rounded-full px-3 py-1">
              <Film className="h-3.5 w-3.5" />
              Current video
            </Badge>
            <Badge variant={isReady ? "default" : "outline"} className="rounded-full px-3 py-1">
              {isReady ? "Watch page ready" : "Unsupported tab"}
            </Badge>
          </div>
          <Button variant="ghost" size="icon" onClick={onRefresh} aria-label="Refresh video context">
            <RefreshCcw data-icon="inline-start" />
          </Button>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <CardTitle className="line-clamp-2 text-base leading-snug sm:text-lg">{title}</CardTitle>
          <CardDescription className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm">
            <span>{channelName ?? "Unknown channel"}</span>
            <span className="hidden text-border sm:inline">•</span>
            <span>{timestampLabel}</span>
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="border-t border-border/60 p-0">
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">
              {providerName ?? "Provider not configured"} · {runtimeStatus}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="flex flex-col gap-2 border-t border-border/60 px-4 py-3 text-xs">
            <div className="flex min-w-0 justify-between gap-3">
              <span className="shrink-0 text-muted-foreground">Video ID</span>
              <span className="min-w-0 truncate font-medium text-foreground">{videoId}</span>
            </div>
            <div className="flex min-w-0 justify-between gap-3">
              <span className="shrink-0 text-muted-foreground">URL</span>
              <span className="min-w-0 break-all text-right font-medium text-foreground">
                {canonicalUrl}
              </span>
            </div>
          </div>
        </details>
      </CardContent>
    </Card>
  )
}
