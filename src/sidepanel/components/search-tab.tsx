import { Bookmark, History, Loader2, MessageSquare, Play, Search, Video } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/features/common/components/empty-state"
import type { SearchResult, SearchResultKind } from "@/sidepanel/search/search-controller"
import { useI18n } from "@/lib/i18n/i18n-provider"

const KIND_LABEL_KEYS: Record<SearchResultKind, string> = {
  "current-runtime-content": "search.kind.current",
  "historical-analysis": "search.kind.historical",
  "knowledge": "search.kind.knowledge",
  "qa-thread": "search.kind.ask",
}

function KindIcon({ kind }: { kind: SearchResultKind }) {
  switch (kind) {
    case "current-runtime-content":
      return <Video className="h-3.5 w-3.5" aria-hidden="true" />
    case "historical-analysis":
      return <History className="h-3.5 w-3.5" aria-hidden="true" />
    case "knowledge":
      return <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
    case "qa-thread":
      return <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
  }
}

type SearchTabProps = {
  query: string
  onQueryChange: (query: string) => void
  onSubmit: () => void | Promise<void>
  results: SearchResult[]
  isSearching: boolean
  errorMessage: string | null
  onOpen: (result: SearchResult) => void | Promise<void>
  formatTimestamp: (timestampSeconds: number) => string
}

export function SearchTab({
  query,
  onQueryChange,
  onSubmit,
  results,
  isSearching,
  errorMessage,
  onOpen,
  formatTimestamp,
}: SearchTabProps) {
  const { t } = useI18n()
  const trimmedQuery = query.trim()

  return (
    <Card
      className="min-w-0 overflow-hidden border-border/70 bg-card/95"
      data-layout-check="search-tab">
      <CardHeader className="min-w-0 gap-3 p-4">
        <div className="min-w-0">
          <CardTitle className="text-base">{t("side.search")}</CardTitle>
          <CardDescription className="mt-1 text-xs">
            {t("search.description")}
          </CardDescription>
        </div>
        <form
          className="flex min-w-0 flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault()
            void onSubmit()
          }}>
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">{t("search.placeholder")}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={t("search.placeholder")}
              className="min-w-0 pl-9"
            />
          </label>
          <Button type="submit" disabled={trimmedQuery.length === 0 || isSearching}>
            {isSearching ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
            {t("search.submit")}
          </Button>
        </form>
      </CardHeader>
      <CardContent className="min-w-0 p-4 pt-0">
        {errorMessage ? (
          <p
            role="alert"
            className="mb-3 max-w-full rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive [overflow-wrap:anywhere]">
            {errorMessage}
          </p>
        ) : null}
        {isSearching && results.length === 0 ? (
          <div role="status" aria-label={t("search.loading")} className="space-y-2">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-[92%] rounded-lg" />
          </div>
        ) : trimmedQuery.length === 0 ? (
          <EmptyState
            className="border border-dashed border-border/70 bg-background/60"
            icon={<Search />}
            title={t("search.idle")}
            description={t("search.description")}
          />
        ) : results.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
            {t("search.noResults", { query: trimmedQuery })}
          </div>
        ) : (
          <ScrollArea className="h-[30rem] w-full max-w-full pr-3">
            <div className="flex min-w-0 flex-col gap-2">
              {results.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => void onOpen(result)}
                  data-search-kind={result.kind}
                  aria-label={t("search.open", { title: result.title })}
                  className="flex min-w-0 max-w-full flex-col gap-1 rounded-lg border border-border/70 bg-background/80 p-3 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                      <KindIcon kind={result.kind} />
                      {t(KIND_LABEL_KEYS[result.kind] as never)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {result.title}
                    </span>
                    {result.timestampSeconds !== null ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">
                        <Play className="h-3 w-3" aria-hidden="true" />
                        {formatTimestamp(result.timestampSeconds)}
                      </span>
                    ) : null}
                  </span>
                  {result.snippet ? (
                    <span className="min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {result.snippet}
                    </span>
                  ) : null}
                  {result.subtitle ? (
                    <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                      {result.subtitle}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
