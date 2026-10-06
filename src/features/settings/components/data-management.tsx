import { DatabaseZap, Download, Loader2, ShieldCheck, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { historyRepository } from "@/features/history/lib/history-repository"
import {
  settingsStorage,
  type SettingsExportSnapshot
} from "@/features/settings/lib/settings-storage"
import {
  clearTranscriptLogs,
  getTranscriptLogs,
  type TranscriptLogEntry
} from "@/features/transcript/lib/transcript-log"
import { SettingsSection } from "@/features/common/components/settings-ui"
import type { PersistenceExport } from "@/lib/schemas/persistence"

type DataManagementProps = {
  onDataCleared?: () => void
}

type DataInventory = {
  providerConfigs: number
  transcriptSnapshots: number
  analysisRuns: number
  segmentSummaries: number
  recentVideos: number
  diagnosticLogs: number
}

const EMPTY_INVENTORY: DataInventory = {
  providerConfigs: 0,
  transcriptSnapshots: 0,
  analysisRuns: 0,
  segmentSummaries: 0,
  recentVideos: 0,
  diagnosticLogs: 0
}

type DataManagementSnapshot = {
  generatedAt: string
  settings: SettingsExportSnapshot
  localData: PersistenceExport
  diagnosticLogs: TranscriptLogEntry[]
}

type DataManagementDependencies = {
  exportSettings: () => Promise<SettingsExportSnapshot>
  exportLocalData: () => Promise<PersistenceExport>
  getTranscriptLogs: () => Promise<TranscriptLogEntry[]>
  clearSettings: () => Promise<void>
  clearLocalData: () => Promise<void>
  clearTranscriptLogs: () => Promise<void>
}

const dataManagementDependencies: DataManagementDependencies = {
  exportSettings: () => settingsStorage.exportSettings(),
  exportLocalData: () => historyRepository.exportLocalData(),
  getTranscriptLogs,
  clearSettings: () => settingsStorage.clearSettings(),
  clearLocalData: () => historyRepository.clearAll(),
  clearTranscriptLogs
}

export async function createDataManagementSnapshot(
  dependencies = dataManagementDependencies,
  generatedAt = new Date().toISOString()
): Promise<DataManagementSnapshot> {
  const [settings, localData, diagnosticLogs] = await Promise.all([
    dependencies.exportSettings(),
    dependencies.exportLocalData(),
    dependencies.getTranscriptLogs()
  ])

  return {
    generatedAt,
    settings,
    localData,
    diagnosticLogs
  }
}

export async function clearDataManagementStores(
  dependencies = dataManagementDependencies
): Promise<void> {
  await Promise.all([
    dependencies.clearSettings(),
    dependencies.clearLocalData(),
    dependencies.clearTranscriptLogs()
  ])
}

export function DataManagement({ onDataCleared }: DataManagementProps) {
  const [inventory, setInventory] = useState<DataInventory>(EMPTY_INVENTORY)
  const [isExporting, setIsExporting] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [isArmed, setIsArmed] = useState(false)
  const [feedback, setFeedback] = useState<{
    state: "idle" | "success" | "error"
    title: string
    message: string
  }>({
    state: "idle",
    title: "",
    message: ""
  })

  useEffect(() => {
    void refreshInventory()
  }, [])

  const totalRecords = useMemo(
    () =>
      [
        inventory.providerConfigs,
        inventory.transcriptSnapshots,
        inventory.analysisRuns,
        inventory.segmentSummaries,
        inventory.recentVideos,
        inventory.diagnosticLogs
      ].reduce((sum, count) => sum + count, 0),
    [inventory]
  )

  async function refreshInventory() {
    const { settings, localData, diagnosticLogs } = await createDataManagementSnapshot()

    setInventory({
      providerConfigs: settings.providerConfigs.length,
      transcriptSnapshots: localData.transcriptSnapshots.length,
      analysisRuns: localData.analysisRuns.length,
      segmentSummaries: localData.segmentSummaries.length,
      recentVideos: localData.recentVideos.length,
      diagnosticLogs: diagnosticLogs.length
    })
  }

  async function handleExport() {
    setIsExporting(true)
    setFeedback({ state: "idle", title: "", message: "" })

    try {
      const payload = await createDataManagementSnapshot()

      downloadJson(
        `video-summary-assistant-export-${new Date().toISOString().slice(0, 10)}.json`,
        payload
      )
      await refreshInventory()
      setFeedback({
        state: "success",
        title: "Local data exported",
        message: "A JSON snapshot of settings, IndexedDB records, and diagnostic logs was downloaded."
      })
    } catch (error) {
      setFeedback({
        state: "error",
        title: "Could not export local data",
        message: error instanceof Error ? error.message : "Unknown export error."
      })
    } finally {
      setIsExporting(false)
    }
  }

  async function handleClear() {
    if (!isArmed) {
      setFeedback({
        state: "error",
        title: "Confirm destructive action first",
        message: "Enable the confirmation switch before clearing local data."
      })
      return
    }

    setIsClearing(true)
    setFeedback({ state: "idle", title: "", message: "" })

    try {
      await clearDataManagementStores()
      await refreshInventory()
      setIsArmed(false)
      onDataCleared?.()
      setFeedback({
        state: "success",
        title: "Local data cleared",
        message: "Saved providers, transcripts, runs, recent video history, and diagnostic logs were removed."
      })
    } catch (error) {
      setFeedback({
        state: "error",
        title: "Could not clear local data",
        message: error instanceof Error ? error.message : "Unknown clear error."
      })
    } finally {
      setIsClearing(false)
    }
  }

  return (
    <Card className="border-border/70 bg-card/95 shadow-lg shadow-primary/5" data-layout-check="data-management-panel">
      <CardHeader className="gap-3">
        <div className="space-y-1.5">
          <Badge variant="secondary" className="w-fit rounded-full px-3 py-1">
            Local data
          </Badge>
          <CardTitle>Inspect, export, or clear browser data</CardTitle>
          <CardDescription>
            Keep destructive actions intentional while still making it easy to
            snapshot or reset your local-first analysis workspace.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <InventoryStat label="Providers" value={inventory.providerConfigs} />
          <InventoryStat label="Transcripts" value={inventory.transcriptSnapshots} />
          <InventoryStat label="Runs" value={inventory.analysisRuns} />
          <InventoryStat label="Segments" value={inventory.segmentSummaries} />
          <InventoryStat label="Recent videos" value={inventory.recentVideos} />
          <InventoryStat label="Diagnostic logs" value={inventory.diagnosticLogs} />
        </div>

        <div className="grid items-stretch gap-4 lg:grid-cols-2">
          <SettingsSection className="flex h-full min-w-0 flex-col justify-between gap-4">
            <div className="flex min-w-0 items-start justify-between gap-4">
              <div className="min-w-0 space-y-2">
                <p className="text-sm font-medium text-foreground">
                  Export a local recovery snapshot
                </p>
                <p className="text-sm leading-6 text-muted-foreground">
                  Download settings, IndexedDB analysis records, and transcript
                  diagnostic logs as one JSON file before you migrate machines
                  or reset the extension.
                </p>
              </div>
              <DatabaseZap className="mt-1 h-4 w-4 shrink-0 text-primary" />
            </div>
            <Button
              className="w-fit rounded-xl"
              disabled={isExporting}
              onClick={handleExport}
              type="button"
              variant="secondary">
              {isExporting ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Download data-icon="inline-start" />
              )}
              Export data
            </Button>
          </SettingsSection>

          <SettingsSection className="flex h-full min-w-0 flex-col gap-4 border-destructive/20 bg-destructive/5">
            <div className="flex min-w-0 items-start justify-between gap-4">
              <div className="min-w-0 space-y-2">
                <p className="text-sm font-medium text-foreground">
                  Clear all local analysis data
                </p>
                <p className="text-sm leading-6 text-muted-foreground">
                  This removes {totalRecords} locally stored record{totalRecords === 1 ? "" : "s"} including
                  provider settings, transcript caches, saved analysis history,
                  and diagnostic logs.
                </p>
              </div>
              <Trash2 className="mt-1 h-4 w-4 shrink-0 text-destructive" />
            </div>

            <label className="flex min-w-0 items-center justify-between gap-4 rounded-2xl border border-destructive/20 bg-background/90 px-4 py-3">
              <div className="min-w-0 space-y-1">
                <span className="text-sm font-medium text-foreground">
                  I understand this cannot be undone
                </span>
                <p className="text-xs leading-5 text-muted-foreground">
                  Turn this on to enable the destructive clear action.
                </p>
              </div>
              <Switch checked={isArmed} onCheckedChange={setIsArmed} />
            </label>

            <Button
              className="w-fit rounded-xl"
              disabled={isClearing || !isArmed}
              onClick={handleClear}
              type="button"
              variant="destructive">
              {isClearing ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Trash2 data-icon="inline-start" />
              )}
              Clear local data
            </Button>
          </SettingsSection>
        </div>

        {feedback.state !== "idle" ? (
          <Alert variant={feedback.state === "error" ? "destructive" : "default"}>
            <AlertTitle>{feedback.title}</AlertTitle>
            <AlertDescription>{feedback.message}</AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>Intentional local-first controls</AlertTitle>
            <AlertDescription>
              Export keeps a portable snapshot, while clear requires an explicit
              confirmation step before anything is removed.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

function InventoryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/70 px-3 py-2">
      <p className="min-w-0 truncate text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="shrink-0 text-lg font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  )
}

const OBJECT_URL_REVOKE_DELAY_MS = 1000

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement("a")

  anchor.href = objectUrl
  anchor.download = filename
  anchor.click()

  // Defer revoke so the browser has time to start the download.
  // Revoking synchronously can race the navigation and produce empty files.
  setTimeout(() => URL.revokeObjectURL(objectUrl), OBJECT_URL_REVOKE_DELAY_MS)
}
