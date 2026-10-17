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
import { useI18n } from "@/lib/i18n/i18n-provider"

type CurrentVideoCardProps = {
  platform: "youtube" | "bilibili" | null
  partId: string | null
  title: string
  author: string | null
  canonicalUrl: string
  videoId: string
  timestampLabel: string
  isReady: boolean
  runtimeStatus: string
  providerName: string | null
  providerModel: string | null
  analysisState: string
  onRefresh: () => void | Promise<void>
}

export function CurrentVideoCard({
  platform,
  partId,
  title,
  author,
  canonicalUrl,
  videoId,
  timestampLabel,
  isReady,
  runtimeStatus,
  providerName,
  providerModel,
  analysisState,
  onRefresh
}: CurrentVideoCardProps) {
  const { t } = useI18n()
  const localizedRuntimeStatus = runtimeStatus === "idle" ? t("video.runtimeIdle")
    : runtimeStatus === "loading" ? t("video.runtimeLoading")
      : runtimeStatus === "ready" ? t("video.runtimeReady")
        : runtimeStatus === "error" ? t("video.runtimeError")
          : runtimeStatus
  return (
    <Card className="min-w-0 overflow-hidden border-border/70 bg-card/95">
      <CardHeader className="flex min-w-0 flex-col gap-3 p-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1 rounded-full px-3 py-1">
              <Film className="h-3.5 w-3.5" />
              {t("video.current")}
            </Badge>
            <Badge variant={isReady ? "default" : "outline"} className="rounded-full px-3 py-1">
              {isReady ? t("video.ready") : t("video.unsupported")}
            </Badge>
            {platform ? (
              <Badge variant="outline" className="rounded-full px-3 py-1">
                {platform === "bilibili" ? `Bilibili${partId ? ` · P${partId}` : ""}` : "YouTube"}
              </Badge>
            ) : null}
          </div>
          <Button variant="ghost" size="icon" onClick={onRefresh} aria-label={t("video.refreshContext")}>
            <RefreshCcw data-icon="inline-start" />
          </Button>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <CardTitle className="line-clamp-2 max-w-full text-base leading-snug [overflow-wrap:anywhere] sm:text-lg">{title}</CardTitle>
          <CardDescription className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm">
            <span className="min-w-0 [overflow-wrap:anywhere]">{author ?? t("video.unknownAuthor")}</span>
            <span className="hidden text-border sm:inline">•</span>
            <span>{timestampLabel}</span>
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="border-t border-border/60 p-0">
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-xs text-muted-foreground">
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {providerName ?? t("video.notConfigured")}
              {providerModel ? ` · ${providerModel}` : ""}
              {` · ${analysisState}`}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="flex flex-col gap-2 border-t border-border/60 px-4 py-3 text-xs">
            <div className="flex min-w-0 justify-between gap-3">
              <span className="shrink-0 text-muted-foreground">{t("video.runtime")}</span>
              <span className="min-w-0 text-right font-medium text-foreground [overflow-wrap:anywhere]">{localizedRuntimeStatus}</span>
            </div>
            <div className="flex min-w-0 justify-between gap-3">
              <span className="shrink-0 text-muted-foreground">{t("video.videoId")}</span>
              <span className="min-w-0 text-right font-medium text-foreground [overflow-wrap:anywhere]">{videoId}</span>
            </div>
            <div className="flex min-w-0 justify-between gap-3">
              <span className="shrink-0 text-muted-foreground">{t("video.url")}</span>
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
