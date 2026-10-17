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
  SettingsSection,
  StatusBadge,
  SwitchRow
} from "@/features/common/components/settings-ui"
import { settingsStorage } from "@/features/settings/lib/settings-storage"
import {
  clearTranscriptLogs,
  getTranscriptLogs,
  type TranscriptLogEntry,
  type TranscriptLogStep,
} from "@/features/transcript/lib/transcript-log"
import { ClipboardCopy, FileText, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { useCallback, useEffect, useState } from "react"
import { useI18n } from "@/lib/i18n/i18n-provider"
import type { TranslationKey } from "@/lib/i18n/en"

function formatStepDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

type CopyDiagnosticLogsDeps = {
  write: (text: string) => Promise<void>
  notifySuccess: (message: string) => void
  notifyError: (message: string) => void
  t?: (key: TranslationKey, params?: Record<string, string | number>) => string
}

/**
 * Pure helper that copies diagnostic logs to the clipboard and surfaces
 * the result via the supplied notify callbacks. Extracted from the
 * component so the success/error notification path is unit-testable
 * without rendering React.
 */
export async function copyDiagnosticLogsToClipboard(
  logs: TranscriptLogEntry[],
  deps: CopyDiagnosticLogsDeps,
): Promise<void> {
  const fallbackTranslate = (key: TranslationKey, params?: Record<string, string | number>) => {
    const fallback: Partial<Record<TranslationKey, string>> = {
      "diagnostics.copied": `Copied {count} diagnostic {entryLabel} to clipboard.`,
      "diagnostics.entry": "entry",
      "diagnostics.entries": "entries",
      "diagnostics.copyFailed": "Could not copy diagnostic logs to the clipboard.",
      "diagnostics.copyFailedWithDetail": "Could not copy diagnostic logs: {error}",
    }
    return (fallback[key] ?? key).replace(/\{([\w.-]+)\}/g, (match, name: string) => {
      const value = params?.[name]
      return value === undefined ? match : String(value)
    })
  }
  const translate = deps.t ?? fallbackTranslate
  const text = JSON.stringify(logs, null, 2)
  try {
    await deps.write(text)
    deps.notifySuccess(
      translate("diagnostics.copied", {
        count: logs.length,
        entryLabel: translate(logs.length === 1 ? "diagnostics.entry" : "diagnostics.entries"),
      }),
    )
  } catch (error) {
    deps.notifyError(
      error instanceof Error
        ? translate("diagnostics.copyFailedWithDetail", { error: error.message })
        : translate("diagnostics.copyFailed"),
    )
  }
}

function formatTimestamp(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale)
  } catch {
    return iso
  }
}

function StepRow({ step, t }: { step: TranscriptLogStep; t: ReturnType<typeof useI18n>["t"] }) {
  const statusLabel = step.skipped
    ? t("diagnostics.skip")
    : step.ok
      ? t("diagnostics.ok")
      : t("diagnostics.fail")

  const statusTone = step.skipped ? "muted" : step.ok ? "success" : "destructive"

  return (
    <div className="flex items-start gap-3 font-mono text-xs">
      <StatusBadge
        tone={statusTone}
        className="w-12 shrink-0 justify-center font-mono text-[10px]"
      >
        {statusLabel}
      </StatusBadge>
      <span className="w-14 shrink-0 text-right text-muted-foreground">
        {step.skipped ? "—" : formatStepDuration(step.durationMs)}
      </span>
      <span className="shrink-0 text-foreground">{step.step}</span>
      {(step.error || step.details) && (
        <span className="truncate text-muted-foreground">
          {step.error ?? step.details}
        </span>
      )}
    </div>
  )
}

function LogEntryCard({ entry, t, locale }: { entry: TranscriptLogEntry; t: ReturnType<typeof useI18n>["t"]; locale: string }) {
  const [expanded, setExpanded] = useState(false)
  const totalMs = entry.steps.reduce((sum, s) => sum + s.durationMs, 0)
  const isSuccess = entry.outcome === "success"

  return (
    <SettingsSection className="bg-background/60">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <StatusBadge tone={isSuccess ? "success" : "destructive"} showDot>
            {isSuccess ? t("diagnostics.ok") : t("diagnostics.fail")}
          </StatusBadge>
          <span className="font-mono text-sm text-foreground">
            {entry.videoId}
          </span>
          {entry.successStep && (
            <span className="text-xs text-muted-foreground">
              {t("diagnostics.successVia", { step: entry.successStep })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {formatStepDuration(totalMs)}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(entry.timestamp, locale)}
          </span>
          <span className="text-xs text-muted-foreground">
            {expanded ? "▲" : "▼"}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 space-y-1.5 border-t border-border/50 pt-3">
          {entry.steps.map((step, index) => (
            <StepRow key={`${step.step}-${index}`} step={step} t={t} />
          ))}
        </div>
      )}
    </SettingsSection>
  )
}

export function DiagnosticLog() {
  const { t, locale } = useI18n()
  const [enabled, setEnabled] = useState(false)
  const [logs, setLogs] = useState<TranscriptLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const [loggingSetting, entries] = await Promise.all([
      settingsStorage.getDiagnosticLogging(),
      getTranscriptLogs(),
    ])
    setEnabled(loggingSetting)
    setLogs(entries)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleToggle = useCallback(async (value: boolean) => {
    await settingsStorage.setDiagnosticLogging(value)
    setEnabled(value)
  }, [])

  const handleClear = useCallback(async () => {
    await clearTranscriptLogs()
    setLogs([])
  }, [])

  const handleCopy = useCallback(
    () =>
      copyDiagnosticLogsToClipboard(logs, {
        write: (text) => navigator.clipboard.writeText(text),
        notifySuccess: (message) => toast.success(message),
        notifyError: (message) => toast.error(message),
        t,
      }),
    [logs, t],
  )

  if (loading) return null

  return (
    <Card className="border-border/70 bg-card/95 shadow-lg shadow-primary/5">
      <CardHeader className="gap-3">
        <div className="space-y-1.5">
          <Badge
            variant="secondary"
            className="w-fit rounded-full px-3 py-1"
          >
            {t("diagnostics.title")}
          </Badge>
          <CardTitle>{t("diagnostics.transcriptLog")}</CardTitle>
          <CardDescription>
            {t("diagnostics.description")}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <SwitchRow
          checked={enabled}
          description={t("diagnostics.enableDescription", { count: 20 })}
          icon={FileText}
          id="diagnostic-logging"
          label={t("diagnostics.enable")}
          onCheckedChange={handleToggle}
        />

        {logs.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">
                {t("diagnostics.recent", { count: logs.length })}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => void refresh()}
                  size="sm"
                  variant="ghost"
                  className="rounded-xl"
                >
                  <RefreshCw data-icon="inline-start" />
                  {t("common.refresh")}
                </Button>
                <Button
                  onClick={() => void handleCopy()}
                  size="sm"
                  variant="ghost"
                  className="rounded-xl"
                >
                  <ClipboardCopy data-icon="inline-start" />
                  {t("diagnostics.copyJson")}
                </Button>
                <Button
                  onClick={() => void handleClear()}
                  size="sm"
                  variant="ghost"
                  className="rounded-xl text-destructive hover:text-destructive"
                >
                  <Trash2 data-icon="inline-start" />
                  {t("common.clear")}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {logs.map((entry, index) => (
                <LogEntryCard key={`${entry.timestamp}-${index}`} entry={entry} t={t} locale={locale} />
              ))}
            </div>
          </div>
        )}

        {logs.length === 0 && enabled && (
          <SettingsSection>
            <p className="text-center text-sm text-muted-foreground">
              {t("diagnostics.empty")}
            </p>
          </SettingsSection>
        )}
      </CardContent>
    </Card>
  )
}
