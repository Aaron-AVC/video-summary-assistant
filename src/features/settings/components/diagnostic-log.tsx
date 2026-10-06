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

function formatStepDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

type CopyDiagnosticLogsDeps = {
  write: (text: string) => Promise<void>
  notifySuccess: (message: string) => void
  notifyError: (message: string) => void
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
  const text = JSON.stringify(logs, null, 2)
  try {
    await deps.write(text)
    deps.notifySuccess(
      `Copied ${logs.length} diagnostic ${logs.length === 1 ? "entry" : "entries"} to clipboard.`,
    )
  } catch (error) {
    deps.notifyError(
      error instanceof Error
        ? `Could not copy diagnostic logs: ${error.message}`
        : "Could not copy diagnostic logs to the clipboard.",
    )
  }
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function StepRow({ step }: { step: TranscriptLogStep }) {
  const statusLabel = step.skipped
    ? "SKIP"
    : step.ok
      ? "OK"
      : "FAIL"

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

function LogEntryCard({ entry }: { entry: TranscriptLogEntry }) {
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
            {isSuccess ? "OK" : "FAIL"}
          </StatusBadge>
          <span className="font-mono text-sm text-foreground">
            {entry.videoId}
          </span>
          {entry.successStep && (
            <span className="text-xs text-muted-foreground">
              via {entry.successStep}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {formatStepDuration(totalMs)}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(entry.timestamp)}
          </span>
          <span className="text-xs text-muted-foreground">
            {expanded ? "▲" : "▼"}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 space-y-1.5 border-t border-border/50 pt-3">
          {entry.steps.map((step, index) => (
            <StepRow key={`${step.step}-${index}`} step={step} />
          ))}
        </div>
      )}
    </SettingsSection>
  )
}

export function DiagnosticLog() {
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
        notifySuccess: toast.success,
        notifyError: toast.error,
      }),
    [logs],
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
            Diagnostics
          </Badge>
          <CardTitle>Transcript fetch log</CardTitle>
          <CardDescription>
            When enabled, logs each step of the transcript fallback chain so you
            can see exactly what happened when fetching fails.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <SwitchRow
          checked={enabled}
          description={<>Records timing and results for each transcript extraction step. Keeps the last {20} runs.</>}
          icon={FileText}
          id="diagnostic-logging"
          label="Enable diagnostic logging"
          onCheckedChange={handleToggle}
        />

        {logs.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">
                Recent logs ({logs.length})
              </p>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => void refresh()}
                  size="sm"
                  variant="ghost"
                  className="rounded-xl"
                >
                  <RefreshCw data-icon="inline-start" />
                  Refresh
                </Button>
                <Button
                  onClick={() => void handleCopy()}
                  size="sm"
                  variant="ghost"
                  className="rounded-xl"
                >
                  <ClipboardCopy data-icon="inline-start" />
                  Copy JSON
                </Button>
                <Button
                  onClick={() => void handleClear()}
                  size="sm"
                  variant="ghost"
                  className="rounded-xl text-destructive hover:text-destructive"
                >
                  <Trash2 data-icon="inline-start" />
                  Clear
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {logs.map((entry, index) => (
                <LogEntryCard key={`${entry.timestamp}-${index}`} entry={entry} />
              ))}
            </div>
          </div>
        )}

        {logs.length === 0 && enabled && (
          <SettingsSection>
            <p className="text-center text-sm text-muted-foreground">
              No logs yet. Try fetching a transcript and check back here.
            </p>
          </SettingsSection>
        )}
      </CardContent>
    </Card>
  )
}
