import { Download, FileText, Loader2, Play, Search } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

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
import type { TranscriptSegment } from "@/features/platform/types"
import { useI18n } from "@/lib/i18n/i18n-provider"

export function filterTranscriptSegments(
  segments: TranscriptSegment[],
  query: string,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return segments
  return segments.filter((segment) =>
    segment.text.toLocaleLowerCase().includes(normalizedQuery),
  )
}

export function splitTranscriptHighlight(text: string, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return [{ text, isMatch: false }]

  const normalizedText = text.toLocaleLowerCase()
  const parts: Array<{ text: string; isMatch: boolean }> = []
  let cursor = 0

  while (cursor < text.length) {
    const matchIndex = normalizedText.indexOf(normalizedQuery, cursor)
    if (matchIndex < 0) {
      parts.push({ text: text.slice(cursor), isMatch: false })
      break
    }
    if (matchIndex > cursor) {
      parts.push({ text: text.slice(cursor, matchIndex), isMatch: false })
    }
    const matchEnd = matchIndex + normalizedQuery.length
    parts.push({ text: text.slice(matchIndex, matchEnd), isMatch: true })
    cursor = matchEnd
  }

  return parts.length > 0 ? parts : [{ text, isMatch: false }]
}

export function HighlightedTranscriptText({
  text,
  query,
}: {
  text: string
  query: string
}) {
  return (
    <>
      {splitTranscriptHighlight(text, query).map((part, index) =>
        part.isMatch ? (
          <mark key={`${part.text}-${index}`} className="rounded bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-700/70">
            {part.text}
          </mark>
        ) : (
          <span key={`${part.text}-${index}`}>{part.text}</span>
        ),
      )}
    </>
  )
}

type TranscriptTabProps = {
  segments: TranscriptSegment[]
  isLoading: boolean
  errorMessage: string | null
  canLoad: boolean
  rawVtt: string | null
  onLoad: () => void | Promise<void>
  onDownload: () => void | Promise<void>
  onJump: (timestampSeconds: number) => void | Promise<void>
  formatTimestamp: (timestampSeconds: number) => string
  /** Segment a Search hit asked to reveal; scrolled into view once. */
  focusTimestamp?: number | null
}

export function TranscriptTab({
  segments,
  isLoading,
  errorMessage,
  canLoad,
  rawVtt,
  onLoad,
  onDownload,
  onJump,
  formatTimestamp,
  focusTimestamp = null,
}: TranscriptTabProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState("")
  const listRef = useRef<HTMLDivElement | null>(null)
  const filteredSegments = useMemo(
    () => filterTranscriptSegments(segments, query),
    [query, segments],
  )

  useEffect(() => {
    if (focusTimestamp === null) return

    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-segment-start="${focusTimestamp}"]`,
    )

    node?.scrollIntoView({ block: "center" })
  }, [focusTimestamp])

  if (!canLoad && segments.length === 0) {
    return (
      <EmptyState
        className="border border-dashed border-border/70 bg-card/70"
        icon={<FileText />}
        title={t("video.unsupported")}
        description={t("transcript.loadDescription")}
      />
    )
  }

  return (
    <Card className="min-w-0 overflow-hidden border-border/70 bg-card/95" data-layout-check="transcript-tab">
      <CardHeader className="min-w-0 gap-3 p-4">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">{t("side.transcript")}</CardTitle>
            <CardDescription className="mt-1 text-xs">
              {t("transcript.description")}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!rawVtt}
              title={rawVtt ? t("transcript.downloadOriginal") : t("transcript.unavailable")}
              onClick={onDownload}>
              <Download data-icon="inline-start" />
              {t("transcript.download")}
            </Button>
            <Button type="button" size="sm" disabled={!canLoad || isLoading} onClick={onLoad}>
              {isLoading ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
              {segments.length > 0 ? t("transcript.reload") : t("transcript.load")}
            </Button>
          </div>
        </div>
        {segments.length > 0 ? (
          <label className="relative block min-w-0">
            <span className="sr-only">{t("transcript.search")}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("transcript.search")}
              className="min-w-0 pl-9"
            />
          </label>
        ) : null}
      </CardHeader>
      <CardContent className="min-w-0 p-4 pt-0">
        {errorMessage ? (
          <p role="alert" className="mb-3 max-w-full rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive [overflow-wrap:anywhere]">
            {errorMessage}
          </p>
        ) : null}
        {isLoading && segments.length === 0 ? (
          <div role="status" aria-label={t("transcript.loading")} className="space-y-2">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-[92%] rounded-lg" />
          </div>
        ) : segments.length === 0 ? (
          <EmptyState
            className="border border-dashed border-border/70 bg-background/60"
            icon={<FileText />}
            title={t("transcript.notLoaded")}
            description={t("transcript.loadDescription")}
            action={(
              <Button type="button" disabled={!canLoad || isLoading} onClick={onLoad}>
                {t("transcript.load")}
              </Button>
            )}
          />
        ) : filteredSegments.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
            {t("transcript.noMatch", { query })}
          </div>
        ) : (
          <ScrollArea className="h-[28rem] w-full max-w-full pr-3">
            <div ref={listRef} className="flex min-w-0 flex-col gap-2">
              {filteredSegments.map((segment, index) => (
                <button
                  key={`${segment.startSec}-${segment.endSec}-${index}`}
                  type="button"
                  data-segment-start={segment.startSec}
                  aria-current={focusTimestamp === segment.startSec ? "true" : undefined}
                  onClick={() => onJump(segment.startSec)}
                  aria-label={t("transcript.jump", { timestamp: formatTimestamp(segment.startSec) })}
                  className="flex min-w-0 max-w-full items-start gap-3 rounded-lg border border-border/70 bg-background/80 p-3 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                  <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    {formatTimestamp(segment.startSec)}
                  </span>
                  <span className="min-w-0 flex-1 text-sm leading-6 text-foreground [overflow-wrap:anywhere]">
                    <HighlightedTranscriptText text={segment.text} query={query} />
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
