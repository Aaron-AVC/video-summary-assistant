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
import { useI18n } from "@/lib/i18n/i18n-provider"

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
  knowledgeItems: number
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
  knowledgeItems: 0,
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
  const { t } = useI18n()
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
        inventory.knowledgeItems,
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
      knowledgeItems: localData.knowledgeItems?.length ?? 0,
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
        title: t("data.exported"),
        message: t("data.exportedMessage")
      })
    } catch (error) {
      setFeedback({
        state: "error",
        title: t("data.exportFailed"),
        message: error instanceof Error ? error.message : t("data.unknownClearError")
      })
    } finally {
      setIsExporting(false)
    }
  }

  async function handleClear(action: DataClearAction, label: string, explanation: string) {
    if (typeof window !== "undefined" && !window.confirm(`${label}\n\n${explanation}\n\n${t("data.continue")}`)) return
    if (typeof window !== "undefined" && !window.confirm(t("data.confirmAgain", { label }))) return

    setClearingAction(action)
    setFeedback({ state: "idle", title: "", message: "" })

    try {
      await performCategorizedDataClear(action)
      await refreshInventory()
      onDataCleared?.()
      setFeedback({
        state: "success",
        title: t("data.clearComplete", { label }),
        message: explanation
      })
    } catch (error) {
      setFeedback({
        state: "error",
        title: t("data.clearFailed", { label }),
        message: error instanceof Error ? error.message : t("data.unknownClearError")
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
            {t("data.local")}
          </Badge>
          <CardTitle>{t("data.title")}</CardTitle>
          <CardDescription>
            {t("data.description")}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <InventoryStat label={t("data.providers")} value={inventory.providerConfigs} />
          <InventoryStat label={t("data.transcripts")} value={inventory.transcriptSnapshots} />
          <InventoryStat label={t("data.runs")} value={inventory.analysisRuns} />
          <InventoryStat label={t("data.segments")} value={inventory.segmentSummaries} />
          <InventoryStat label={t("data.recentVideos")} value={inventory.recentVideos} />
          <InventoryStat label={t("data.videoRecords")} value={inventory.videoRecords} />
          <InventoryStat label={t("data.transcriptCache")} value={inventory.transcriptCache} />
          <InventoryStat label={t("data.analysisCache")} value={inventory.analysisCache} />
          <InventoryStat label={t("data.qaAnswers")} value={inventory.qaAnswers} />
          <InventoryStat label={t("data.qaThreads")} value={inventory.qaThreads} />
          <InventoryStat label={t("data.qaMessages")} value={inventory.qaMessages} />
          <InventoryStat label={t("data.knowledgeItems")} value={inventory.knowledgeItems} />
          <InventoryStat label={t("data.diagnosticLogs")} value={inventory.diagnosticLogs} />
        </div>

        <div className="grid items-stretch gap-4 lg:grid-cols-2">
          <SettingsSection className="flex h-full min-w-0 flex-col justify-between gap-4">
            <div className="flex min-w-0 items-start justify-between gap-4">
              <div className="min-w-0 space-y-2">
                <p className="text-sm font-medium text-foreground">
                  {t("data.exportSnapshot")}
                </p>
                <p className="text-sm leading-6 text-muted-foreground">
                  {t("data.exportDescription")}
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
              {t("data.exportData")}
            </Button>
          </SettingsSection>

          <SettingsSection className="flex h-full min-w-0 flex-col gap-4 border-destructive/20 bg-destructive/5">
            <div className="flex min-w-0 items-start justify-between gap-4">
              <div className="min-w-0 space-y-2">
                <p className="text-sm font-medium text-foreground">{t("data.categorizedControls")}</p>
                <p className="text-sm leading-6 text-muted-foreground">
                  {t("data.currentInventory", { count: totalRecords })}
                </p>
              </div>
              <Trash2 className="mt-1 h-4 w-4 shrink-0 text-destructive" />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {([
                ["conversations", t("data.clearConversations"), t("data.clearConversationsExplanation")],
                ["transcript-cache", t("data.clearTranscriptCache"), t("data.clearTranscriptCacheExplanation")],
                ["analysis-history", t("data.clearAnalysisHistory"), t("data.clearAnalysisHistoryExplanation")],
                ["diagnostics", t("data.clearDiagnostics"), t("data.clearDiagnosticsExplanation")],
                ["all", t("data.clearAll"), t("data.clearAllExplanation")]
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
            <AlertTitle>{t("data.intentional")}</AlertTitle>
            <AlertDescription>
              {t("data.intentionalDescription")}
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
