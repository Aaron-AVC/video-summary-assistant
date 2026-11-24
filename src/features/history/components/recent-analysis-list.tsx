import { Clock3, FolderOpen, History, MoreVertical, Search, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import type { KeyboardEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n/i18n-provider"

export type RecentAnalysisListItem = {
  videoId: string
  analysisRunId?: string
  contentKey?: string
  partId?: string | null
  platform?: "youtube" | "bilibili"
  title: string
  channelTitle: string | null
  status: string | null
  updatedAt: string
}

export function handleHistoryCardKeyDown(
  event: Pick<KeyboardEvent<HTMLElement>, "key" | "target" | "currentTarget" | "preventDefault">,
  activate: () => void,
): boolean {
  if (event.target !== event.currentTarget) return false
  if (event.key !== "Enter" && event.key !== " ") return false
  event.preventDefault()
  activate()
  return true
}

type RecentAnalysisListProps = {
  items: RecentAnalysisListItem[]
  isLoading: boolean
  activeVideoId: string | null
  activeAnalysisRunId?: string | null
  onSelect: (videoId: string, contentKey?: string, analysisRunId?: string) => void | Promise<void>
  onDeleteAnalysis?: (item: RecentAnalysisListItem) => void | Promise<void>
  onDeleteVideo?: (item: RecentAnalysisListItem) => void | Promise<void>
  onOpenFullHistory?: () => void
  searchable?: boolean
  searchPlaceholder?: string
  emptyMatchMessage?: string
  loadError?: string | null
  onRetry?: () => void
  scrollHeightClassName?: string
}

export function RecentAnalysisList({
  items,
  isLoading,
  activeVideoId,
  activeAnalysisRunId = null,
  onSelect,
  onDeleteAnalysis,
  onDeleteVideo,
  onOpenFullHistory,
  searchable = true,
  searchPlaceholder,
  emptyMatchMessage,
  loadError = null,
  onRetry,
  scrollHeightClassName = "h-[20rem]"
}: RecentAnalysisListProps) {
  const { t, locale } = useI18n()
  const resolvedSearchPlaceholder = searchPlaceholder ?? t("history.search")
  const resolvedEmptyMatchMessage = emptyMatchMessage ?? t("history.noMatch")
  const [query, setQuery] = useState("")
  const normalizedQuery = query.trim().toLowerCase()
  const filteredItems = useMemo(() => {
    if (!normalizedQuery) return items
    return items.filter((item) => {
      const haystack = [
        item.title,
        item.channelTitle ?? "",
        item.videoId,
        item.contentKey ?? "",
        item.status ?? ""
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [items, normalizedQuery])

  return (
    <Card className="border-border/70 bg-card/95 shadow-lg shadow-primary/5">
      <CardHeader>
          <CardTitle className="text-lg">{t("history.recent")}</CardTitle>
        <CardDescription>
          {t("history.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loadError ? (
          <div
            role="alert"
            className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
            <p className="text-sm text-foreground">{loadError}</p>
            {onRetry ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isLoading}
                onClick={onRetry}>
                {t("history.retry")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {searchable && items.length > 0 ? (
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={resolvedSearchPlaceholder}
              aria-label={t("history.search")}
              className="pl-9"
            />
          </div>
        ) : null}
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full rounded-2xl" />
            <Skeleton className="h-20 w-full rounded-2xl" />
            <Skeleton className="h-20 w-[90%] rounded-2xl" />
          </div>
        ) : items.length === 0 && loadError ? null : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
            {t("history.empty")}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
            {resolvedEmptyMatchMessage}
          </div>
        ) : (
          <ScrollArea className={scrollHeightClassName}>
            <div className="space-y-3">
              {filteredItems.map((item) => {
                const isActive = item.analysisRunId
                  ? item.analysisRunId === activeAnalysisRunId
                  : item.videoId === activeVideoId

                return (
                  <div
                    key={item.analysisRunId ?? item.contentKey ?? item.videoId}
                    onClick={() => onSelect(item.videoId, item.contentKey, item.analysisRunId)}
                    onKeyDown={(event) => handleHistoryCardKeyDown(
                      event,
                      () => void onSelect(item.videoId, item.contentKey, item.analysisRunId),
                    )}
                    role="button"
                    tabIndex={0}
                    className={cn(
                      "w-full rounded-2xl border p-4 text-left transition-colors",
                      isActive
                        ? "border-primary/50 bg-primary/10"
                        : "border-border/70 bg-background/80 hover:bg-accent/50"
                    )}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="line-clamp-2 text-sm font-semibold text-foreground">{item.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.channelTitle ?? t("history.unknownChannel")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="rounded-full px-3 py-1">
                          {item.status
                            ? translateHistoryStatus(item.status, t)
                            : t("history.saved")}
                        </Badge>
                        {(item.analysisRunId && onDeleteAnalysis) || (item.contentKey && onDeleteVideo) ? (
                          <details className="relative" onClick={(event) => event.stopPropagation()}>
                            <summary
                              className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                              aria-label={t("common.open")}>
                              <MoreVertical className="h-4 w-4" />
                            </summary>
                            <div className="absolute right-0 z-10 mt-1 min-w-48 rounded-xl border border-border bg-popover p-1 shadow-xl">
                              {item.analysisRunId && onDeleteAnalysis ? (
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-destructive hover:bg-destructive/10"
                                  onClick={() => void onDeleteAnalysis(item)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                  {t("history.deleteAnalysis")}
                                </button>
                              ) : null}
                              {item.contentKey && onDeleteVideo ? (
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-destructive hover:bg-destructive/10"
                                  onClick={() => void onDeleteVideo(item)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                  {t("history.deleteVideo")}
                                </button>
                              ) : null}
                            </div>
                          </details>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock3 className="h-3.5 w-3.5" />
                        {new Date(item.updatedAt).toLocaleString(locale)}
                      </span>
                      <span className="flex items-center gap-1 text-sm font-medium text-primary">
                        <FolderOpen className="h-4 w-4" />
                        {t("history.open")}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        )}
        <div className="mt-4 flex items-center justify-between gap-2">
          {onOpenFullHistory ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenFullHistory}
              className="gap-2"
              aria-label={t("history.openFull")}>
              <History className="h-3.5 w-3.5" />
              {t("history.openFull")}
            </Button>
          ) : (
            <span />
          )}
          <Button variant="ghost" size="sm" disabled={items.length === 0}>
            {normalizedQuery
              ? t("history.searchCount", { count: filteredItems.length })
              : `${items.length} ${t("history.saved")}`}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function translateHistoryStatus(
  status: string,
  t: ReturnType<typeof useI18n>["t"],
) {
  const statusKeys: Record<string, Parameters<typeof t>[0]> = {
    completed: "history.status.completed",
    error: "history.status.error",
    cancelled: "history.status.cancelled",
  }
  return statusKeys[status] ? t(statusKeys[status]) : status
}
