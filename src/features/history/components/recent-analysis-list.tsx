import { Clock3, FolderOpen, History, Search } from "lucide-react"
import { useMemo, useState } from "react"

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

export type RecentAnalysisListItem = {
  videoId: string
  contentKey?: string
  partId?: string | null
  platform?: "youtube" | "bilibili"
  title: string
  channelTitle: string | null
  status: string | null
  updatedAt: string
}

type RecentAnalysisListProps = {
  items: RecentAnalysisListItem[]
  isLoading: boolean
  activeVideoId: string | null
  onSelect: (videoId: string, contentKey?: string) => void | Promise<void>
  onOpenFullHistory?: () => void
  searchable?: boolean
  searchPlaceholder?: string
  emptyMatchMessage?: string
  scrollHeightClassName?: string
}

export function RecentAnalysisList({
  items,
  isLoading,
  activeVideoId,
  onSelect,
  onOpenFullHistory,
  searchable = true,
  searchPlaceholder = "Search saved analyses",
  emptyMatchMessage = "No saved analyses match your search.",
  scrollHeightClassName = "h-[20rem]"
}: RecentAnalysisListProps) {
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
        <CardTitle className="text-lg">Recent analyses</CardTitle>
        <CardDescription>
          Reopen locally saved summaries without rerunning the model.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {searchable && items.length > 0 ? (
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label="Search saved analyses"
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
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
            Completed analyses will build a local history list here.
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
            {emptyMatchMessage}
          </div>
        ) : (
          <ScrollArea className={scrollHeightClassName}>
            <div className="space-y-3">
              {filteredItems.map((item) => {
                const isActive = item.videoId === activeVideoId

                return (
                  <button
                    key={item.contentKey ?? item.videoId}
                    type="button"
                    onClick={() => onSelect(item.videoId, item.contentKey)}
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
                          {item.channelTitle ?? "Unknown channel"}
                        </p>
                      </div>
                      <Badge variant="secondary" className="rounded-full px-3 py-1">
                        {item.status ?? "saved"}
                      </Badge>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock3 className="h-3.5 w-3.5" />
                        {new Date(item.updatedAt).toLocaleString()}
                      </span>
                      <span className="flex items-center gap-1 text-sm font-medium text-primary">
                        <FolderOpen className="h-4 w-4" />
                        Open
                      </span>
                    </div>
                  </button>
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
              aria-label="Open full history in Settings">
              <History className="h-3.5 w-3.5" />
              Open full history
            </Button>
          ) : (
            <span />
          )}
          <Button variant="ghost" size="sm" disabled={items.length === 0}>
            {normalizedQuery
              ? `${filteredItems.length} of ${items.length}`
              : `${items.length} saved`}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
