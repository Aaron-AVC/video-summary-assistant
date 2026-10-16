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
import { historyRepository } from "@/features/history/lib/history-repository"
import {
  performDestructiveOperation,
  type PerformDestructiveOperationOptions
} from "@/features/history/lib/destructive-operation-coordinator"
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
  videoRecords: number
  transcriptCache: number
  analysisCache: number
  qaAnswers: number
  qaThreads: number
  qaMessages: number
  diagnosticLogs: number
}

const EMPTY_INVENTORY: DataInventory = {
  providerConfigs: 0,
  transcriptSnapshots: 0,
  analysisRuns: 0,
  segmentSummaries: 0,
  recentVideos: 0,
  videoRecords: 0,
  transcriptCache: 0,
  analysisCache: 0,
  qaAnswers: 0,
  qaThreads: 0,
  qaMessages: 0,
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
  clearQaData?: () => Promise<void>
  clearTranscriptCache?: () => Promise<void>
  clearAnalysisHistory?: () => Promise<void>
}

const dataManagementDependencies: DataManagementDependencies = {
  exportSettings: () => settingsStorage.exportSettings(),
  exportLocalData: () => historyRepository.exportLocalData(),
  getTranscriptLogs,
  clearSettings: () => settingsStorage.clearSettings(),
  clearLocalData: () => historyRepository.clearAll(),
  clearTranscriptLogs,
  clearQaData: () => historyRepository.clearQaData(),
  clearTranscriptCache: () => historyRepository.clearTranscriptCache(),
  clearAnalysisHistory: () => historyRepository.clearAnalysisHistory()
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

export type DataClearAction =
  | "conversations"
  | "transcript-cache"
  | "analysis-history"
  | "diagnostics"
  | "all"

export async function clearCategorizedData(
  action: DataClearAction,
  dependencies = dataManagementDependencies
): Promise<void> {
  if (action === "conversations") {
    await dependencies.clearQaData?.()
    return
  }
  if (action === "transcript-cache") {
    await dependencies.clearTranscriptCache?.()
    return
  }
  if (action === "analysis-history") {
    await dependencies.clearAnalysisHistory?.()
    return
  }
  if (action === "diagnostics") {
    await dependencies.clearTranscriptLogs()
    return
  }
  await clearDataManagementStores(dependencies)
}

const DESTRUCTIVE_ACTION_FOR_CLEAR: Record<DataClearAction, "clear-conversations" | "clear-transcript-cache" | "clear-analysis-history" | "clear-diagnostics" | "clear-all"> = {
  conversations: "clear-conversations",
  "transcript-cache": "clear-transcript-cache",
  "analysis-history": "clear-analysis-history",
  diagnostics: "clear-diagnostics",
  all: "clear-all"
}

export async function performCategorizedDataClear(
  action: DataClearAction,
  dependencies: Partial<DataManagementDependencies> = {},
  coordinatorOptions: PerformDestructiveOperationOptions = {},
): Promise<void> {
  await performDestructiveOperation(
    DESTRUCTIVE_ACTION_FOR_CLEAR[action],
    {},
    () => clearCategorizedData(action, { ...dataManagementDependencies, ...dependencies }),
    coordinatorOptions,
  )
}

export function DataManagement({ onDataCleared }: DataManagementProps) {
  const [inventory, setInventory] = useState<DataInventory>(EMPTY_INVENTORY)
  const [isExporting, setIsExporting] = useState(false)
  const [clearingAction, setClearingAction] = useState<DataClearAction | null>(null)
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
        inventory.videoRecords,
        inventory.transcriptCache,
        inventory.analysisCache,
        inventory.qaAnswers,
        inventory.qaThreads,
        inventory.qaMessages,
        inventory.diagnosticLogs
      ].reduce((sum, count) => sum + count, 0),
    [inventory]
  )

  async function refreshInventory() {
    const { settings, localData, diagnosticLogs } = await createDataManagementSnapshot()

    setInventory({
      providerConfigs: settings.providerConfigs.length + localData.providerConfigs.length,
      transcriptSnapshots: localData.transcriptSnapshots.length,
      analysisRuns: localData.analysisRuns.length,
      segmentSummaries: localData.segmentSummaries.length,
      recentVideos: localData.recentVideos.length,
      videoRecords: localData.videoRecords?.length ?? 0,
      transcriptCache: localData.transcriptCache?.length ?? 0,
      analysisCache: localData.analysisCache?.length ?? 0,
      qaAnswers: localData.qaAnswers?.length ?? 0,
      qaThreads: localData.qaThreads?.length ?? 0,
      qaMessages: localData.qaMessages?.length ?? 0,
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

  async function handleClear(action: DataClearAction, label: string, explanation: string) {
    if (typeof window !== "undefined" && !window.confirm(`${label}\n\n${explanation}\n\nContinue?`)) return
    if (typeof window !== "undefined" && !window.confirm(`Confirm ${label.toLowerCase()} one more time.`)) return

    setClearingAction(action)
    setFeedback({ state: "idle", title: "", message: "" })

    try {
      await performCategorizedDataClear(action)
      await refreshInventory()
      onDataCleared?.()
      setFeedback({
        state: "success",
        title: `${label} complete`,
        message: explanation
      })
    } catch (error) {
      setFeedback({
        state: "error",
        title: `Could not ${label.toLowerCase()}`,
        message: error instanceof Error ? error.message : "Unknown clear error."
      })
    } finally {
      setClearingAction(null)
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
          <InventoryStat label="Video records" value={inventory.videoRecords} />
          <InventoryStat label="Transcript cache" value={inventory.transcriptCache} />
          <InventoryStat label="Analysis cache" value={inventory.analysisCache} />
          <InventoryStat label="QA answers" value={inventory.qaAnswers} />
          <InventoryStat label="QA threads" value={inventory.qaThreads} />
          <InventoryStat label="QA messages" value={inventory.qaMessages} />
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
                <p className="text-sm font-medium text-foreground">Categorized local data controls</p>
                <p className="text-sm leading-6 text-muted-foreground">
                  Each action has its own confirmation and only removes the named data domain. Current inventory: {totalRecords} records.
                </p>
              </div>
              <Trash2 className="mt-1 h-4 w-4 shrink-0 text-destructive" />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {([
                ["conversations", "Clear conversations", "Ask history/cache only."],
                ["transcript-cache", "Clear transcript cache", "Reusable transcript cache only; saved analysis snapshots stay."],
                ["analysis-history", "Clear analysis history", "Analyses plus dependent Ask conversations; providers and transcript cache stay."],
                ["diagnostics", "Clear diagnostics", "Diagnostic transcript logs only."],
                ["all", "Clear all extension data", "Providers, all local data, and logs."]
              ] as const).map(([action, label, explanation]) => (
                <Button
                  key={action}
                  className="justify-start rounded-xl"
                  disabled={clearingAction !== null}
                  onClick={() => void handleClear(action, label, explanation)}
                  type="button"
                  variant={action === "all" ? "destructive" : "outline"}>
                  {clearingAction === action ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Trash2 data-icon="inline-start" />}
                  {label}
                </Button>
              ))}
            </div>
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
