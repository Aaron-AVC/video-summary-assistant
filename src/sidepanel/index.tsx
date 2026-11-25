import "@/styles/globals.css"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/sonner"
import { CurrentVideoCard } from "@/features/analysis/components/current-video-card"
import { ActiveAnalysisTaskBanner } from "@/features/analysis/components/active-analysis-task"
import { ActiveAskTaskBanner } from "@/features/analysis/components/active-ask-task"
import type {
  AskVideoAnswer,
  VideoAnalysis,
} from "@/features/analysis/lib/analysis-schema"
import { askVideo } from "@/features/analysis/lib/ask-video"
import {
  DEFAULT_ANALYSIS_PRESET_ID,
  createAnalysisPresetSnapshot,
  resolveAnalysisPromptVersion,
  type AnalysisPresetId,
} from "@/features/analysis/lib/analysis-preset"
import { qaConversationRepository } from "@/features/analysis/lib/qa-conversation-repository"
import {
  knowledgeRepository,
  normalizeKnowledgeTimestamp,
} from "@/features/knowledge/lib/knowledge-repository"
import {
  getAnalysisTaskExecutionPolicy,
} from "@/features/analysis/lib/analysis-task-lifecycle"
import {
  AnalysisTaskAlreadyRunningError,
  AnalysisTaskController,
  type ActiveAnalysisTask,
  type AnalysisTaskSnapshot,
} from "@/features/analysis/lib/analysis-task-controller"
import {
  AskTaskController,
  type ActiveAskTask,
} from "@/features/analysis/lib/ask-task-controller"
import { AnalysisAbortedError, runAnalysis } from "@/features/analysis/lib/run-analysis"
import { OpenAICompatibleClientError } from "@/features/analysis/lib/openai-compatible-client"
import type { RecentAnalysisListItem } from "@/features/history/components/recent-analysis-list"
import { historyRepository } from "@/features/history/lib/history-repository"
import { isDatabaseUnavailableError } from "@/lib/db/errors"
import { isDatabaseReady, verifyDatabaseReady } from "@/lib/db/readiness"
import {
  admitDestructiveTask,
  performDestructiveOperation,
  subscribeToDestructiveOperations,
  type TaskAdmissionHandle,
  type DestructiveTaskSnapshot,
} from "@/features/history/lib/destructive-operation-coordinator"
import {
  computeAnalysisCacheKey,
  isExactCurrentAnalysis,
} from "@/lib/persistence/cache-identity"
import { VIDEO_ANALYSIS_SCHEMA_VERSION } from "@/features/analysis/lib/analysis-schema"
import type {
  ActiveVideoContext,
  VideoIdentity,
  VideoInfo,
} from "@/features/platform/types"
import {
  settingsStorage,
  type ProviderConfigRecord,
} from "@/features/settings/lib/settings-storage"
import { downloadRawVtt } from "@/features/transcript/lib/download-vtt"
import {
  ExtensionProviders,
  useRuntimeBridge,
} from "@/lib/providers/extension-providers"
import { AskTab } from "@/sidepanel/components/ask-tab"
import { createAnalysisController, type AnalysisExecutionPublication } from "@/sidepanel/analysis/analysis-controller"
import {
  createFinalResumeCheckpointController,
  type FinalCheckpointMetadata,
  type FinalResumeCheckpointController,
} from "@/features/analysis/lib/final-resume-checkpoint"
import { SidePanelFinalCheckpointLifecycle } from "@/sidepanel/analysis/final-checkpoint-lifecycle"
import {
  FINAL_RESUME_TTL_FALLBACK_MS,
  computeFinalResumeConflict,
  createFinalResumeAvailability,
  createFinalResumeTtlScheduler,
  resolveCheckpointIdentityTransition,
  shouldRefreshFinalResumeOnTaskAdmission,
  shouldRefreshFinalResumeOnTaskRelease,
  type FinalResumeAvailability,
  type FinalResumeView,
} from "@/sidepanel/analysis/final-resume-availability"
import { assertLiveSourceMatchesTask } from "@/sidepanel/analysis/final-resume-source-identity"
import { runFinalOnlyAnalysis } from "@/features/analysis/lib/run-final-only-analysis"
import {
  createFinalResumeCoordinator,
  type FinalResumeResult,
} from "@/features/analysis/lib/final-resume-coordinator"
import { OverviewTab } from "@/sidepanel/components/overview-tab"
import { SettingsTab } from "@/sidepanel/components/settings-tab"
import { SidePanelShell } from "@/sidepanel/components/sidepanel-shell"
import { TranscriptTab } from "@/sidepanel/components/transcript-tab"
import {
  StaleTranscriptError,
  loadCurrentTranscript,
  type CurrentTranscriptResult,
} from "@/sidepanel/lib/load-current-transcript"
import {
  INITIAL_SIDE_PANEL_TAB,
  type AnalysisPhase,
  type SidePanelTab,
} from "@/sidepanel/lib/sidepanel-ux"
import {
  formatTimestamp,
  historyContextIdentityFromContentKey,
  identityFromAnalysis,
  identityFromContext,
  type ContentKeyHistoryIdentity,
} from "@/sidepanel/lib/sidepanel-pure-helpers"
import { getAnalysisHeaderPresentation } from "@/sidepanel/lib/task-presentation"
import { navigateToTimestamp } from "@/sidepanel/navigation/timestamp-navigation"
import {
  type TranscriptAcquisitionRequest,
  type TranscriptSessionSnapshot,
} from "@/sidepanel/transcript/transcript-acquisition"
import {
  TranscriptController,
  type TranscriptPublication,
} from "@/sidepanel/transcript/transcript-controller"
import {
  compareAskTranscriptIdentity,
  matchesAskRequestWorkspaceIdentity,
} from "@/sidepanel/lib/ask-transcript-identity"
import type { QaMessageEntity, QaThreadEntity } from "@/lib/schemas/persistence"
import { applySidepanelDataMutation } from "@/sidepanel/lib/apply-data-mutation"
import { createAnalysisPresetWriter } from "@/sidepanel/lib/analysis-preset-write"
import { I18nProvider, useI18n } from "@/lib/i18n/i18n-provider"
import {
  createHistoryController,
  type HistoryContext,
  type HistoryRestoreSnapshot,
} from "@/sidepanel/history/history-controller"
import { createPendingHistoryOpenAdapter } from "@/sidepanel/history/pending-history-open-adapter"
import {
  DEFAULT_MARKDOWN_EXPORT_SECTIONS,
  buildMarkdownExport,
  resolveMarkdownExportAvailability,
  type MarkdownExportSections,
} from "@/features/export/lib/markdown-export"
import {
  copyMarkdownExport,
  downloadMarkdownExport,
} from "@/features/export/lib/markdown-delivery"
import { downloadMarkdownFile } from "@/sidepanel/lib/markdown-download"
import { createAskController } from "@/sidepanel/ask/ask-controller"
import { createKnowledgeController } from "@/sidepanel/knowledge/knowledge-controller"
import {
  createSearchController,
  type SearchResult,
  type SearchRuntimeProjection,
} from "@/sidepanel/search/search-controller"
import { searchRepository } from "@/features/search/lib/search-repository"
import { SearchTab } from "@/sidepanel/components/search-tab"
import {
  createSearchOpener,
  type SearchOpener,
  type SearchOpenerEffects,
} from "@/sidepanel/search/search-opening"
import { publishCompletedAnalysis } from "@/sidepanel/workspace/analysis-publication"
import { commitRestoredDisplaySelection } from "@/sidepanel/workspace/restored-display-selection"
import {
  WorkspaceController,
  type WorkspaceHistoryRestoreMode,
  type WorkspaceRestoredAnalysisIdentity,
} from "@/sidepanel/workspace/workspace-controller"
import { DatabaseAvailabilityController } from "@/sidepanel/workspace/database-availability"
import { loadWorkspaceBranches } from "@/sidepanel/workspace/workspace-bootstrap"

/** Content-free identity used to decide whether a resume entry still applies. */
type FinalResumeIdentitySnapshot = {
  sourceTabId: number | null
  contentKey: string | null
  partId: string | null
  title: string | null
  durationSec: number | null
  transcriptFingerprint: string | null
  providerProfileId: string | null
  analysisPresetId: AnalysisPresetId
}

type AnalysisView = {
  platform: "youtube" | "bilibili"
  videoId: string
  partId: string | null
  contentKey: string
  title: string
  analysis: VideoAnalysis
  analysisRunId: string | null
  transcriptFingerprint: string | null
  providerProfileId: string | null
  providerBaseUrl: string | null
  providerModel: string | null
  analysisSchemaVersion: number | null
  analysisPromptVersion: string | null
  lastAnalyzedAt: string | null
  errorMessage: string | null
}

function SidepanelWorkspace() {
  const { t, locale } = useI18n()
  const { activeTabId, jumpToTimestamp, refreshCurrentVideo, status, videoContext } = useRuntimeBridge()
  const videoContextRef = useRef(videoContext)
  videoContextRef.current = videoContext
  // The live tab id is part of the source identity a resume must re-verify, so
  // it is mirrored into a ref for the same reason as the video context: the
  // coordinator reads it from inside async work that outlives this render.
  const activeTabIdRef = useRef(activeTabId)
  activeTabIdRef.current = activeTabId

  const databaseAvailabilityControllerRef = useRef<DatabaseAvailabilityController | null>(null)
  if (!databaseAvailabilityControllerRef.current) {
    databaseAvailabilityControllerRef.current = new DatabaseAvailabilityController({
      probe: () => verifyDatabaseReady(),
    })
  }
  const databaseAvailabilityController = databaseAvailabilityControllerRef.current
  const [databaseAvailability, setDatabaseAvailability] = useState(
    databaseAvailabilityController.getSnapshot(),
  )
  const databaseAvailabilityRef = useRef(databaseAvailability.status)
  databaseAvailabilityRef.current = databaseAvailability.status

  const [activeTab, setActiveTab] = useState<SidePanelTab>(INITIAL_SIDE_PANEL_TAB)
  const [provider, setProvider] = useState<ProviderConfigRecord | null>(null)
  const [analysisPresetId, setAnalysisPresetId] = useState<AnalysisPresetId>(DEFAULT_ANALYSIS_PRESET_ID)
  const [isAnalysisPresetSaving, setIsAnalysisPresetSaving] = useState(false)
  const [analysisView, setAnalysisView] = useState<AnalysisView | null>(null)
  const [recentItems, setRecentItems] = useState<RecentAnalysisListItem[]>([])
  const [askQuestion, setAskQuestion] = useState("")
  const [askAnswer, setAskAnswer] = useState<AskVideoAnswer | null>(null)
  const [qaThreadId, setQaThreadId] = useState<string | null>(null)
  const [qaThreads, setQaThreads] = useState<QaThreadEntity[]>([])
  const [qaMessages, setQaMessages] = useState<QaMessageEntity[]>([])
  const [askError, setAskError] = useState<string | null>(null)
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null)
  const [isAnalysisFetching, setIsAnalysisFetching] = useState(false)
  const [analysisPhase, setAnalysisPhase] = useState<AnalysisPhase>("idle")
  const [analysisError, setAnalysisError] = useState<string | null>(null)

  const reportDatabaseFailure = useCallback((error: unknown, failureGeneration: number) => {
    if (isDatabaseUnavailableError(error)) {
      databaseAvailabilityController.markUnavailable(error, failureGeneration)
    }
  }, [databaseAvailabilityController])

  const runDatabaseOperation = <T,>(operation: () => Promise<T>): Promise<T> => {
    const failureGeneration = databaseAvailabilityController.captureFailureGeneration()
    let result: Promise<T>
    try {
      result = Promise.resolve(operation())
    } catch (error) {
      reportDatabaseFailure(error, failureGeneration)
      return Promise.reject(error)
    }
    return result.catch((error: unknown) => {
      reportDatabaseFailure(error, failureGeneration)
      throw error
    })
  }

  const ensureDatabaseAvailable = useCallback(() => {
    if (isDatabaseReady(databaseAvailabilityRef.current)) return true
    toast.error(t("database.unavailable"))
    return false
  }, [t])

  const analysisTaskControllerRef = useRef<AnalysisTaskController | null>(null)
  if (!analysisTaskControllerRef.current) analysisTaskControllerRef.current = new AnalysisTaskController()
  const analysisTaskController = analysisTaskControllerRef.current
  const askTaskControllerRef = useRef<AskTaskController | null>(null)
  if (!askTaskControllerRef.current) askTaskControllerRef.current = new AskTaskController()
  const askTaskController = askTaskControllerRef.current
  const transcriptControllerRef = useRef<TranscriptController | null>(null)
  if (!transcriptControllerRef.current) {
    transcriptControllerRef.current = new TranscriptController({
      readCached: (contentKey) => runDatabaseOperation(
        () => historyRepository.getLatestTranscriptByContentKey(contentKey),
      ),
      loadRemote: ({ request, isCurrent }) => loadCurrentTranscript({
        requestedContentKey: request.video.contentKey,
        ...(request.sourceTabId === undefined ? {} : { tabId: request.sourceTabId }),
        isCurrent,
      }),
      saveCache: (payload) => runDatabaseOperation(
        () => historyRepository.saveTranscriptCache(payload),
      ),
    })
  }
  const transcriptController = transcriptControllerRef.current
  const historyControllerRef = useRef<ReturnType<typeof createHistoryController> | null>(null)
  if (!historyControllerRef.current) {
    historyControllerRef.current = createHistoryController({
      listRecentAnalyses: (limit) => runDatabaseOperation(
        () => historyRepository.listRecentAnalyses(limit),
      ),
      getCurrentAnalysisByVideoId: (videoId) => runDatabaseOperation(
        () => historyRepository.getCurrentAnalysisByVideoId(videoId),
      ),
      getLatestTranscriptSnapshotByVideoId: (videoId) => runDatabaseOperation(
        () => historyRepository.getLatestTranscriptSnapshotByVideoId(videoId),
      ),
      getCurrentAnalysisByContentKey: (contentKey) => runDatabaseOperation(
        () => historyRepository.getCurrentAnalysisByContentKey(contentKey),
      ),
      getLatestTranscriptByContentKey: (contentKey) => runDatabaseOperation(
        () => historyRepository.getLatestTranscriptByContentKey(contentKey),
      ),
      getSavedAnalysisRunById: (analysisRunId) => runDatabaseOperation(
        () => historyRepository.getSavedAnalysisRunById(analysisRunId),
      ),
      deleteAnalysisRun: (analysisRunId) => runDatabaseOperation(
        () => historyRepository.deleteAnalysisRun(analysisRunId),
      ),
      deleteVideoData: (contentKey) => runDatabaseOperation(
        () => historyRepository.deleteVideoData(contentKey),
      ),
      performDestructiveOperation,
    })
  }
  const historyController = historyControllerRef.current
  const askControllerRef = useRef<ReturnType<typeof createAskController> | null>(null)
  if (!askControllerRef.current) {
    askControllerRef.current = createAskController({
      listQaThreadsForVideo: (contentKey, analysisRunId) => (
        runDatabaseOperation(() => qaConversationRepository.listQaThreadsForVideo(contentKey, analysisRunId))
      ),
      getQaThread: (threadId) => runDatabaseOperation(() => qaConversationRepository.getQaThread(threadId)),
      listQaMessages: (threadId) => runDatabaseOperation(() => qaConversationRepository.listQaMessages(threadId)),
      deleteQaThread: (threadId) => runDatabaseOperation(() => qaConversationRepository.deleteQaThread(threadId)),
      createQaThread: (input) => runDatabaseOperation(() => qaConversationRepository.createQaThread(input)),
      resolveProvider: (providerId) => settingsStorage.resolveProvider(providerId),
      appendQaMessage: (input) => runDatabaseOperation(() => qaConversationRepository.appendQaMessage(input)),
      getQaAnswer: (cacheKey) => runDatabaseOperation(() => historyRepository.getQaAnswer(cacheKey)),
      saveQaAnswer: (input) => runDatabaseOperation(() => historyRepository.saveQaAnswer(input)),
      runAskVideo: (input) => {
        if (!isDatabaseReady(databaseAvailabilityRef.current)) {
          throw new Error("Local database is unavailable.")
        }
        return askVideo(input)
      },
      appendAssistantMessage: (input) => runDatabaseOperation(
        () => qaConversationRepository.appendQaMessage(input),
      ),
    })
  }
  const askController = askControllerRef.current
  const analysisControllerRef = useRef<ReturnType<typeof createAnalysisController> | null>(null)
  if (!analysisControllerRef.current) {
    analysisControllerRef.current = createAnalysisController({
      resolveProvider: async (providerId) => {
        const resolved = await settingsStorage.resolveProvider(providerId)
        return {
          apiKey: resolved.apiKey,
          credentialRevision: resolved.credentialRevision,
          profileUpdatedAt: resolved.profile.updatedAt,
          profileBaseUrl: resolved.profile.baseUrl,
          profileModel: resolved.profile.model,
          profileGenerationTimeoutSec: resolved.profile.generationTimeoutSec,
        }
      },
      saveTaskTranscriptCache: (input) => transcriptController.saveTaskCache(input),
      getAnalysisCache: (cacheKey) => runDatabaseOperation(
        () => historyRepository.getAnalysisCache(cacheKey),
      ),
      saveVideoRecord: (input) => runDatabaseOperation(
        () => historyRepository.saveVideoRecord(input),
      ),
      saveTranscriptSnapshot: (input) => runDatabaseOperation(
        () => historyRepository.saveTranscriptSnapshot(input),
      ),
      saveAnalysisRun: (input) => runDatabaseOperation(
        () => historyRepository.saveAnalysisRun(input),
      ),
      saveAnalysisCache: (input) => runDatabaseOperation(
        () => historyRepository.saveAnalysisCache(input),
      ),
      runAnalysis: (options) => {
        if (!isDatabaseReady(databaseAvailabilityRef.current)) {
          throw new Error("Local database is unavailable.")
        }
        return runAnalysis(options)
      },
    })
  }
  const analysisController = analysisControllerRef.current
  const finalCheckpointLifecycleRef = useRef<SidePanelFinalCheckpointLifecycle<FinalResumeCheckpointController> | null>(null)
  if (!finalCheckpointLifecycleRef.current) {
    const hasChromeEvents = typeof chrome !== "undefined"
    finalCheckpointLifecycleRef.current = new SidePanelFinalCheckpointLifecycle(
      createFinalResumeCheckpointController(),
      hasChromeEvents ? {
        storage: {
          addListener: (listener) => chrome.storage.onChanged.addListener(listener),
          removeListener: (listener) => chrome.storage.onChanged.removeListener(listener),
        },
        tabs: {
          onUpdated: {
            addListener: (listener) => chrome.tabs.onUpdated.addListener(listener),
            removeListener: (listener) => chrome.tabs.onUpdated.removeListener(listener),
          },
          onRemoved: {
            addListener: (listener) => chrome.tabs.onRemoved.addListener(listener),
            removeListener: (listener) => chrome.tabs.onRemoved.removeListener(listener),
          },
        },
      } : {},
    )
  }
  const finalCheckpointLifecycle = finalCheckpointLifecycleRef.current
  /**
   * Duration captured by the last real transcript acquisition, together with
   * the content key it belongs to. The key turns the value from "the last
   * duration we saw" into "the duration of *this* content", so a resume can
   * never borrow a duration recorded for a different video or Bilibili part.
   */
  const finalCheckpointDurationRef = useRef<{ contentKey: string; durationSec: number | null } | null>(null)
  const readFinalCheckpointDuration = (contentKey: string | null): number | null => {
    const captured = finalCheckpointDurationRef.current
    if (!captured || contentKey === null || captured.contentKey !== contentKey) return null
    return captured.durationSec
  }
  /**
   * M2 only exposes a synchronous metadata read, so the panel owns the
   * subscription, TTL watch and phase state needed for a live resume entry.
   */
  const finalResumeIdentityRef = useRef<FinalResumeIdentitySnapshot>({
    sourceTabId: null,
    contentKey: null,
    partId: null,
    title: null,
    durationSec: null,
    transcriptFingerprint: null,
    providerProfileId: null,
    analysisPresetId: DEFAULT_ANALYSIS_PRESET_ID,
  })
  const finalResumeCheckpointIdentityRef = useRef<FinalResumeIdentitySnapshot>(
    finalResumeIdentityRef.current,
  )
  /**
   * Last checkpoint state this panel reconciled against.
   *
   * The checkpoint controller exposes only a synchronous `getMetadata()` and has
   * no subscription, so "the checkpoint just appeared" cannot be observed from
   * React alone. This mirror plus `checkpointStateVersion` turn that transition
   * into a real render, and the reconcile below seeds the *expected* identity
   * exactly once per checkpoint.
   */
  const checkpointStateRef = useRef<FinalCheckpointMetadata["state"]>("empty")
  const [checkpointStateVersion, setCheckpointStateVersion] = useState(0)
  const finalResumeConflictRef = useRef<() => boolean>(() => false)
  const finalResumeAvailabilityRef = useRef<FinalResumeAvailability | null>(null)
  if (!finalResumeAvailabilityRef.current) {
    finalResumeAvailabilityRef.current = createFinalResumeAvailability({
      readMetadata: () => finalCheckpointLifecycle.controller.getMetadata(),
      readIdentity: () => finalCheckpointLifecycle.controller.getMetadata().state === "empty"
        ? finalResumeIdentityRef.current
        : finalResumeCheckpointIdentityRef.current,
      readCurrentIdentity: () => finalResumeIdentityRef.current,
      hasConflict: () => finalResumeConflictRef.current(),
    })
  }
  const finalResumeAvailability = finalResumeAvailabilityRef.current
  /**
   * Reconciles the *expected* checkpoint identity against the real checkpoint
   * state, and turns a state transition into a render.
   *
   * `expected` is the source snapshot the checkpoint is bound to. It is seeded
   * once when a checkpoint appears and is never overwritten while it lives:
   * overwriting it with the live identity would make expected equal current on
   * every video/part switch and silently disable the identity protection, so a
   * checkpoint created for video A could be resumed against video B. The
   * decision itself lives in the pure `resolveCheckpointIdentityTransition`.
   *
   * The controller exposes only a synchronous `getMetadata()` and has no
   * subscription, so this is invoked from every place a transition can be
   * observed (identity effect, task notifications, TTL wake-up).
   */
  const reconcileCheckpointIdentityRef = useRef<(input: {
    currentIdentity: FinalResumeIdentitySnapshot
    taskIdentity?: FinalResumeIdentitySnapshot | null
  }) => boolean>(() => false)
  const reconcileCheckpointIdentity = (input: {
    currentIdentity: FinalResumeIdentitySnapshot
    taskIdentity?: FinalResumeIdentitySnapshot | null
  }): boolean => {
    const nextState = finalCheckpointLifecycle.controller.getMetadata().state
    const transition = resolveCheckpointIdentityTransition({
      previousState: checkpointStateRef.current,
      nextState,
      previousExpected: finalResumeCheckpointIdentityRef.current,
      currentIdentity: input.currentIdentity,
      taskIdentity: input.taskIdentity ?? null,
    })
    if (transition.kind === "unchanged") return false
    // The panel's snapshot narrows `analysisPresetId` to AnalysisPresetId; the
    // resolver only ever echoes the preset it was given, so this cast is safe.
    finalResumeCheckpointIdentityRef.current = transition.expected as FinalResumeIdentitySnapshot
    checkpointStateRef.current = nextState
    // Publish immediately so the entry appears in this same frame instead of
    // waiting for the next TTL wake-up.
    finalResumeAvailability.refresh({ kind: `checkpoint-${transition.kind}` })
    setCheckpointStateVersion((version) => version + 1)
    return true
  }
  // Stable handle for the task subscription, which is created once.
  reconcileCheckpointIdentityRef.current = reconcileCheckpointIdentity

  const workspaceControllerRef = useRef<WorkspaceController | null>(null)
  if (!workspaceControllerRef.current) workspaceControllerRef.current = new WorkspaceController()
  const workspaceController = workspaceControllerRef.current
  const analysisPresetWriterRef = useRef<ReturnType<typeof createAnalysisPresetWriter> | null>(null)
  if (!analysisPresetWriterRef.current) {
    analysisPresetWriterRef.current = createAnalysisPresetWriter(
      (presetId) => settingsStorage.setAnalysisPresetId(presetId),
    )
  }
  const analysisPresetWriter = analysisPresetWriterRef.current
  const knowledgeControllerRef = useRef<ReturnType<typeof createKnowledgeController> | null>(null)
  if (!knowledgeControllerRef.current) {
    knowledgeControllerRef.current = createKnowledgeController({
      repository: {
        listByContentKey: (contentKey) => runDatabaseOperation(
          () => knowledgeRepository.listByContentKey(contentKey),
        ),
        toggleBookmark: (input) => runDatabaseOperation(() => knowledgeRepository.toggleBookmark(input)),
        createNote: (input) => runDatabaseOperation(() => knowledgeRepository.createNote(input)),
        updateNote: (input) => runDatabaseOperation(() => knowledgeRepository.updateNote(input)),
        deleteItem: (id) => runDatabaseOperation(() => knowledgeRepository.deleteItem(id)),
      },
    })
  }
  const knowledgeController = knowledgeControllerRef.current
  const searchControllerRef = useRef<ReturnType<typeof createSearchController> | null>(null)
  if (!searchControllerRef.current) {
    searchControllerRef.current = createSearchController({
      repository: {
        loadCandidates: () => runDatabaseOperation(() => searchRepository.loadCandidates()),
      },
    })
  }
  const searchController = searchControllerRef.current
  const [transcriptSnapshot, setTranscriptSnapshot] = useState(
    transcriptController.getSnapshot(),
  )
  const [knowledgeSnapshot, setKnowledgeSnapshot] = useState(knowledgeController.getSnapshot())
  const [searchSnapshot, setSearchSnapshot] = useState(searchController.getSnapshot())
  useEffect(() => {
    setDatabaseAvailability(databaseAvailabilityController.getSnapshot())
    const unsubscribe = databaseAvailabilityController.subscribe((snapshot) => {
      databaseAvailabilityRef.current = snapshot.status
      setDatabaseAvailability(snapshot)
    })
    void databaseAvailabilityController.initialize()
    return unsubscribe
  }, [databaseAvailabilityController])
  useEffect(() => {
    const root = document.getElementById("__plasmo")
    if (!root) return
    root.setAttribute("data-database-status", databaseAvailability.status)
    return () => {
      if (root.getAttribute("data-database-status") === databaseAvailability.status) {
        root.removeAttribute("data-database-status")
      }
    }
  }, [databaseAvailability.status])
  useEffect(() => searchController.subscribe(() => {
    setSearchSnapshot(searchController.getSnapshot())
  }), [searchController])

  const [transcriptFocusTimestamp, setTranscriptFocusTimestamp] = useState<number | null>(null)
  const [markdownExportSections, setMarkdownExportSections] = useState<MarkdownExportSections>(
    DEFAULT_MARKDOWN_EXPORT_SECTIONS,
  )
  const {
    cues: transcriptCues,
    identity: transcriptIdentity,
    title: transcriptTitle,
    fingerprint: currentTranscriptFingerprint,
    rawVtt,
    error: transcriptError,
    isLoading: isTranscriptLoading,
  } = transcriptSnapshot
  const [activeAnalysisTask, setActiveAnalysisTask] = useState<ActiveAnalysisTask | null>(
    analysisTaskController.getSnapshot(),
  )
  // Mirrors the state for the subscription callback: it needs the *previous*
  // task to tell a release from an unrelated notification.
  const activeAnalysisTaskRef = useRef<ActiveAnalysisTask | null>(activeAnalysisTask)
  /**
   * Authority mirrors for the conflict decision.
   *
   * The conflict closure is invoked from inside refresh(), i.e. from the task
   * controller's own notification or from a timer, never from a render. Reading
   * Render-state variables there is one render behind: at the instant a task
   * finished, React still held the finished task and the entry published a
   * `conflict` snapshot for an already-free workspace. These refs are written
   * synchronously at the point the authority changes.
   */
  const analysisTaskActiveRef = useRef(activeAnalysisTask !== null)
  const analysisTaskReleasedRef = useRef(false)
  const analysisPhaseRef = useRef<AnalysisPhase>(analysisPhase)
  // Keep the authority mirror in step with the render as well: the subscription
  // writes it at the transition, and this covers a state set from anywhere else.
  analysisTaskActiveRef.current = activeAnalysisTask !== null
  // The phase is React state, so the ref has to follow a render. Refreshing on
  // a real change keeps the published snapshot in step with it: leaving the
  // conflict phases is what makes the entry evaluable again after a failure.
  useEffect(() => {
    if (analysisPhaseRef.current === analysisPhase) return
    analysisPhaseRef.current = analysisPhase
    finalResumeAvailability.refresh({ kind: "analysis-phase" })
  }, [analysisPhase, finalResumeAvailability])
  const [activeAskTask, setActiveAskTask] = useState<ActiveAskTask | null>(
    askTaskController.getSnapshot(),
  )
  const askStartLockRef = useRef(false)
  const currentTranscriptFingerprintRef = useRef<string | null>(null)
  const pendingAskOperationRef = useRef<DestructiveTaskSnapshot | null>(null)
  const destructiveWorkspaceRef = useRef({
    analysisRunId: null as string | null,
    analysisContentKey: null as string | null,
    hasPersistedAnalysis: false,
    transcriptContentKey: null as string | null,
    videoContextContentKey: null as string | null,
  })
  currentTranscriptFingerprintRef.current = transcriptSnapshot.fingerprint
  workspaceController.syncDisplaySelection({
    analysis: analysisView
      ? {
          contentKey: analysisView.contentKey,
          analysisRunId: analysisView.analysisRunId,
        }
      : null,
    qaThreadId,
  })
  destructiveWorkspaceRef.current = {
    analysisRunId: analysisView?.analysisRunId ?? null,
    analysisContentKey: analysisView?.contentKey ?? null,
    hasPersistedAnalysis: Boolean(analysisView),
    transcriptContentKey: transcriptIdentity?.contentKey ?? null,
    videoContextContentKey: videoContext.contentKey,
  }

  const publishTranscript = useCallback((publication: TranscriptPublication) => {
    const next = transcriptController.publish(publication)
    currentTranscriptFingerprintRef.current = next.fingerprint
  }, [transcriptController])

  const setTranscriptFingerprint = useCallback((fingerprint: string | null) => {
    const next = transcriptController.setFingerprint(fingerprint)
    currentTranscriptFingerprintRef.current = next.fingerprint
  }, [transcriptController])

  const resetTranscript = useCallback(() => {
    const next = transcriptController.reset()
    currentTranscriptFingerprintRef.current = next.fingerprint
  }, [transcriptController])

  const clearQaWorkspace = useCallback(() => {
    workspaceController.setSelectedQaThreadId(null)
    setQaThreadId(null)
    setQaThreads([])
    setQaMessages([])
    setAskAnswer(null)
  }, [workspaceController])

  const restoreQaConversation = useCallback(async (
    contentKey: string,
    analysisRunId: string | null | undefined,
    generation: number,
    transcriptFingerprint?: string | null,
    isPublicationCurrent?: () => boolean,
  ) => {
    const isCurrent = () => (
      workspaceController.isLoadGenerationCurrent(generation)
      && (isPublicationCurrent === undefined || isPublicationCurrent())
    )
    const result = await askController.restoreConversation({
      contentKey,
      analysisRunId,
      transcriptFingerprint: transcriptFingerprint ?? null,
      isCurrent,
    })
    if (result.kind === "stale" || !isCurrent()) return
    const { threads, currentThreadId, messages, answer } = result.snapshot
    setQaThreads(threads)
    workspaceController.setSelectedQaThreadId(currentThreadId)
    setQaThreadId(currentThreadId)
    setQaMessages(messages)
    setAskAnswer(answer)
  }, [askController, workspaceController])

  const publishHistoryRestore = useCallback(async ({
    mode,
    snapshot,
    workspaceEpoch,
    generation,
    displayGeneration,
  }: {
    mode: WorkspaceHistoryRestoreMode
    snapshot: HistoryRestoreSnapshot
    workspaceEpoch: number
    generation: number
    displayGeneration: number
  }) => {
    const isRequestCurrent = () => workspaceController.isLoadGenerationCurrent(generation)
    return workspaceController.publishHistoryRestore({
      mode,
      snapshot,
      workspaceEpoch,
      isRequestCurrent,
      displayGeneration,
      effects: {
        publishTranscript: (publication) => publishTranscript(publication),
        clearTranscriptError: () => transcriptController.setError(null),
        clearAnalysis: () => setAnalysisView(null),
        setAnalysisIdle: () => setAnalysisPhase("idle"),
        publishAnalysis: (analysis) => setAnalysisView({ ...analysis }),
        setAnalysisCompleted: () => setAnalysisPhase("completed"),
        clearAskWorkspace: () => clearQaWorkspace(),
        restoreQaConversation: (input) => restoreQaConversation(
          input.contentKey,
          input.analysisRunId,
          generation,
          input.transcriptFingerprint,
          input.isCurrent,
        ),
      },
    })
  }, [clearQaWorkspace, publishTranscript, restoreQaConversation, transcriptController, workspaceController])

  useEffect(() => analysisTaskController.subscribe(() => {
    const next = analysisTaskController.getSnapshot()
    const previousContentKey = activeAnalysisTaskRef.current?.snapshot.contentKey ?? null
    const nextContentKey = next?.snapshot.contentKey ?? null
    activeAnalysisTaskRef.current = next
    setActiveAnalysisTask(next)
    // The controller is the authority for "is a task running", so mirror it
    // synchronously for the conflict closure. React state is one render behind
    // this callback, and reading it here published a wrong `conflict` snapshot
    // at the exact instant a task finished.
    analysisTaskActiveRef.current = next !== null
    // A release clears the workspace even though `analysisPhase` is still the
    // phase of the run that just ended (React has not re-rendered it yet).
    if (previousContentKey !== null && nextContentKey === null) {
      analysisTaskReleasedRef.current = true
    } else if (nextContentKey !== null) {
      analysisTaskReleasedRef.current = false
    }
    // A released task stops being a conflict, but the state update above only
    // reaches React on the next render. Recompute here so the entry is correct
    // at the release instant, which is what makes the button come back after a
    // first Final attempt failed. Admission/rotation is refreshed too, so a
    // hidden action never outlives its reason.
    //
    // The checkpoint may have appeared or disappeared during this task (the
    // Final failure path promotes a candidate to `available` right before the
    // task settles), so reconcile the expected identity first and only then
    // refresh: the refresh must observe the seeded identity, not a stale null.
    reconcileCheckpointIdentityRef.current({
      currentIdentity: finalResumeIdentityRef.current,
      taskIdentity: next
        ? {
            sourceTabId: next.snapshot.sourceTabId,
            contentKey: next.snapshot.contentKey,
            partId: next.snapshot.partId,
            title: next.snapshot.title,
            durationSec: readFinalCheckpointDuration(next.snapshot.contentKey),
            transcriptFingerprint: currentTranscriptFingerprintRef.current,
            providerProfileId: next.snapshot.providerProfileId,
            analysisPresetId: next.snapshot.analysisPresetId,
          }
        : null,
    })
    if (shouldRefreshFinalResumeOnTaskRelease({ previousTaskContentKey: previousContentKey, nextTaskContentKey: nextContentKey })
      || shouldRefreshFinalResumeOnTaskAdmission({ previousTaskContentKey: previousContentKey, nextTaskContentKey: nextContentKey })) {
      finalResumeAvailability.refresh({ kind: "task-transition" })
    }
  }), [analysisTaskController, finalResumeAvailability])

  useEffect(() => () => finalCheckpointLifecycle.destroy(), [finalCheckpointLifecycle])

  const [finalResumeView, setFinalResumeView] = useState<FinalResumeView>(
    finalResumeAvailability.getSnapshot(),
  )
  useEffect(() => {
    setFinalResumeView(finalResumeAvailability.getSnapshot())
    return finalResumeAvailability.subscribe(() => {
      setFinalResumeView(finalResumeAvailability.getSnapshot())
    })
  }, [finalResumeAvailability])

  // The action must disappear on its own when the TTL elapses; a manual refresh
  // is not part of the contract. The scheduler arms a single wake-up at the real
  // `metadata.expiresAt`, so the button disappears at the expiry instant instead
  // of up to a poll interval later. It re-reads the expiry on every wake-up, so
  // a replacement checkpoint is picked up without restarting the panel, and it
  // keeps a bounded idle re-check while no checkpoint exists yet (the normal
  // state after mount, and after a checkpoint was discarded). Refreshing only
  // re-reads a synchronous view.
  useEffect(() => {
    const scheduler = createFinalResumeTtlScheduler({
      readExpiresAt: () => finalCheckpointLifecycle.controller.getMetadata().expiresAt,
      refresh: () => finalResumeAvailability.refresh({ kind: "ttl" }),
      // The wake-up targets the real expiry. This only covers the "no checkpoint
      // yet" state, which must still self-heal when one appears later.
      idleRecheckMs: FINAL_RESUME_TTL_FALLBACK_MS,
    })
    scheduler.start()
    return () => scheduler.stop()
  }, [finalCheckpointLifecycle, finalResumeAvailability])

  useEffect(() => () => finalResumeAvailability.destroy(), [finalResumeAvailability])

  // A workspace conflict (another analysis or a destructive operation) hides the
  // entry without discarding the checkpoint itself.
  //
  // This closure is called from refresh(), which runs from the task controller's
  // own notification and from timers, never from a render. It therefore reads
  // the authority mirrors rather than the render-era state: otherwise the
  // release notification (which fires before React re-renders) would decide on
  // the task that just finished. See computeFinalResumeConflict.
  finalResumeConflictRef.current = () => computeFinalResumeConflict({
    taskActive: analysisTaskActiveRef.current,
    phase: analysisPhaseRef.current,
    taskReleased: analysisTaskReleasedRef.current,
  })

  useEffect(() => {
    const identity: FinalResumeIdentitySnapshot = {
      sourceTabId: activeTabId,
      contentKey: videoContext.contentKey,
      partId: videoContext.partId,
      title: videoContext.title ?? videoContext.videoId,
      durationSec: readFinalCheckpointDuration(videoContext.contentKey),
      transcriptFingerprint: currentTranscriptFingerprint,
      providerProfileId: provider?.id ?? null,
      analysisPresetId,
    }
    finalResumeIdentityRef.current = identity
    // A checkpoint binds the source of the analysis task that created it, so
    // the task snapshot wins over the (possibly already drifted) live context.
    // Seeding happens once per checkpoint; while one lives this never
    // overwrites `expected`, which is what keeps the identity protection real.
    reconcileCheckpointIdentity({
      currentIdentity: identity,
      taskIdentity: activeAnalysisTask
        ? {
            sourceTabId: activeAnalysisTask.snapshot.sourceTabId,
            contentKey: activeAnalysisTask.snapshot.contentKey,
            partId: activeAnalysisTask.snapshot.partId,
            title: activeAnalysisTask.snapshot.title,
            durationSec: readFinalCheckpointDuration(activeAnalysisTask.snapshot.contentKey),
            transcriptFingerprint: currentTranscriptFingerprint,
            providerProfileId: activeAnalysisTask.snapshot.providerProfileId,
            analysisPresetId: activeAnalysisTask.snapshot.analysisPresetId,
          }
        : null,
    })
    finalCheckpointLifecycle.syncSource({
      sourceTabId: activeTabId,
      platform: videoContext.platform,
      videoId: videoContext.videoId,
      partId: videoContext.partId,
      contentKey: videoContext.contentKey,
      title: videoContext.title ?? videoContext.videoId,
      durationSec: readFinalCheckpointDuration(videoContext.contentKey),
      workspaceEpoch: workspaceController.captureEpoch(),
      transcriptFingerprint: currentTranscriptFingerprint,
      providerProfileId: provider?.id ?? null,
      analysisPresetId,
    })
    finalResumeAvailability.refresh({ kind: "identity" })
  }, [
    activeTabId,
    analysisPresetId,
    activeAnalysisTask,
    // Re-runs when a checkpoint appeared or disappeared, so the expected side
    // is reconciled even though `getMetadata()` cannot subscribe by itself.
    checkpointStateVersion,
    currentTranscriptFingerprint,
    finalCheckpointLifecycle,
    provider?.id,
    videoContext.contentKey,
    videoContext.partId,
    videoContext.platform,
    videoContext.title,
    videoContext.videoId,
    finalResumeAvailability,
    workspaceController,
  ])

  useEffect(() => askTaskController.subscribe(() => {
    setActiveAskTask(askTaskController.getSnapshot())
  }), [askTaskController])

  useEffect(() => transcriptController.subscribe(() => {
    setTranscriptSnapshot(transcriptController.getSnapshot())
  }), [transcriptController])

  useEffect(() => knowledgeController.subscribe(() => {
    setKnowledgeSnapshot(knowledgeController.getSnapshot())
  }), [knowledgeController])

  const title = videoContext.title ?? "Open a supported video page to start"
  const canonicalUrl = videoContext.canonicalUrl ?? videoContext.url ?? "No supported video page detected"
  const workspaceTask = activeAnalysisTask?.snapshot.contentKey === videoContext.contentKey
    ? activeAnalysisTask
    : null
  const isAnalysisBusy = Boolean(workspaceTask) || analysisPhase === "loading-transcript"
    || analysisPhase === "analyzing"
    || analysisPhase === "finalizing"
    || analysisPhase === "cancelling"
  const isAnalysisLoading = isBootstrapping || isAnalysisFetching || isAnalysisBusy
  const hasMatchingTranscript = Boolean(
    analysisView
    && transcriptIdentity?.contentKey === analysisView.contentKey
    && transcriptCues.length > 0,
  )
  const askTranscriptMatch = compareAskTranscriptIdentity({
    analysisFingerprint: analysisView?.transcriptFingerprint,
    currentFingerprint: currentTranscriptFingerprint,
  })
  const hasMatchingAskTranscript = hasMatchingTranscript && askTranscriptMatch === "match"
  const hasAskTranscriptMismatch = Boolean(
    hasMatchingTranscript
    && askTranscriptMatch === "mismatch",
  )
  const isAsking = Boolean(activeAskTask)
  const canAsk = Boolean(
    isDatabaseReady(databaseAvailability.status)
    && provider
    && analysisView
    && hasMatchingAskTranscript
    && askQuestion.trim()
    && !isAsking
    && !isTranscriptLoading
    && !isAnalysisFetching
    && !isAnalysisBusy,
  )
  const isExactCurrentDisplayedAnalysis = isExactCurrentAnalysis(
    analysisView
      ? {
          contentKey: analysisView.contentKey,
          transcriptFingerprint: analysisView.transcriptFingerprint,
          providerProfileId: analysisView.providerProfileId,
          baseUrl: analysisView.providerBaseUrl,
          model: analysisView.providerModel,
          analysisSchemaVersion: analysisView.analysisSchemaVersion,
          analysisPromptVersion: analysisView.analysisPromptVersion,
        }
      : null,
    videoContext.contentKey && provider
      ? {
          contentKey: videoContext.contentKey,
          transcriptFingerprint: currentTranscriptFingerprint,
          providerProfileId: provider.id,
          baseUrl: provider.baseUrl,
          model: provider.model,
          analysisSchemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
          analysisPromptVersion: resolveAnalysisPromptVersion(analysisPresetId),
        }
      : null,
  )

  const refreshRecentAnalyses = useCallback(async () => {
    try {
      const recent = await historyController.listRecentAnalyses(10)
      setRecentItems(recent)
      setHistoryLoadError(null)
    } catch (error) {
      if (!isDatabaseUnavailableError(error)) setHistoryLoadError(t("history.loadFailed"))
      throw error
    }
  }, [historyController, reportDatabaseFailure, t])

  const applyMutation = useCallback(async (mutation: Parameters<typeof applySidepanelDataMutation>[0]) => {
    finalCheckpointLifecycle.handleMutation(mutation)
    await applySidepanelDataMutation(mutation, destructiveWorkspaceRef.current, {
      invalidateWorkspace: (clearTranscript) => {
        workspaceController.invalidateLoadGeneration()
        askController.invalidateThreadLoadGeneration()
        askController.invalidateExecutionGeneration()
        if (clearTranscript) transcriptController.invalidateLoadEpoch()
      },
      clearAnalysis: () => {
        setAnalysisView(null)
        setAnalysisError(null)
        setIsAnalysisFetching(false)
      },
      setAnalysisIdle: () => setAnalysisPhase("idle"),
      clearAskWorkspace: () => {
        askController.invalidateThreadLoadGeneration()
        askController.invalidateExecutionGeneration()
        clearQaWorkspace()
        setAskQuestion("")
        setAskError(null)
      },
      clearTranscriptWorkspace: () => {
        resetTranscript()
      },
      clearKnowledgeWorkspace: () => {
        knowledgeController.reset()
      },
      refreshRecentAnalyses,
      refreshProvider: async () => {
        const providerConfigs = await settingsStorage.getProviderConfigs()
        setProvider(providerConfigs.find((item) => item.isDefault) ?? null)
      },
      refreshAnalysisPreset: async () => {
        // clear-all wipes Settings, so re-read the global default instead of
        // assuming the previously selected preset survived.
        setAnalysisPresetId(await settingsStorage.getAnalysisPresetId())
      },
    })
  }, [askController, clearQaWorkspace, finalCheckpointLifecycle, knowledgeController, refreshRecentAnalyses, resetTranscript, transcriptController, workspaceController])

  useEffect(() => {
    const getTasks = () => {
      const tasks: DestructiveTaskSnapshot[] = []
      const analysisTask = analysisTaskController.getSnapshot()
      const askTask = askTaskController.getSnapshot()
      if (analysisTask) {
        tasks.push({
          kind: "analysis",
          taskId: analysisTask.snapshot.taskId,
          contentKey: analysisTask.snapshot.contentKey,
          analysisRunId: destructiveWorkspaceRef.current.analysisRunId ?? undefined,
          phase: analysisTask.phase,
        })
      }
      if (askTask) {
        tasks.push({
          kind: "ask",
          taskId: askTask.snapshot.taskId,
          contentKey: askTask.snapshot.contentKey,
          analysisRunId: askTask.snapshot.analysisRunId,
          threadId: askTask.snapshot.threadId,
          phase: askTask.phase,
        })
      } else if (pendingAskOperationRef.current) {
        tasks.push(pendingAskOperationRef.current)
      }
      return tasks
    }
    return subscribeToDestructiveOperations(getTasks, async (mutation) => {
      try {
        await applyMutation(mutation)
      } catch {
        toast.error(t("toast.localDataChanged"))
      }
    })
  }, [analysisTaskController, askTaskController, applyMutation])

  const loadSavedAnalysis = useCallback(async (
    videoId: string,
    generation: number,
    displayGeneration: number,
  ) => {
    const workspaceEpoch = workspaceController.captureEpoch()
    const isRestoreCurrent = () => (
      workspaceController.isLoadGenerationCurrent(generation)
      && workspaceController.isEpochCurrent(workspaceEpoch)
    )
    setIsAnalysisFetching(true)
    try {
      const result = await historyController.loadLegacyVideoRestore({
        videoId,
        isCurrent: isRestoreCurrent,
      })
      if (result.kind !== "ready") return null
      const publication = await publishHistoryRestore({
        mode: "legacy-video",
        snapshot: result.snapshot,
        workspaceEpoch,
        generation,
        displayGeneration,
      })
      return publication.kind === "published" ? publication.restored : null
    } finally {
      if (workspaceController.isLoadGenerationCurrent(generation)) {
        setIsAnalysisFetching(false)
      }
    }
  }, [historyController, publishHistoryRestore, workspaceController])

  const loadSavedAnalysisForContext = useCallback(async (
    context: ActiveVideoContext,
    generation: number,
    displayGeneration: number,
  ) => {
    if (!context.contentKey || !context.videoId || !context.platform) return
    const workspaceEpoch = workspaceController.captureEpoch()
    const isRestoreCurrent = () => (
      workspaceController.isLoadGenerationCurrent(generation)
      && workspaceController.isEpochCurrent(workspaceEpoch)
    )
    setIsAnalysisFetching(true)
    try {
      const historyContext: HistoryContext = {
        platform: context.platform,
        videoId: context.videoId,
        partId: context.partId,
        contentKey: context.contentKey,
        title: context.title,
      }
      const result = await historyController.loadCurrentContextRestore({
        context: historyContext,
        isCurrent: isRestoreCurrent,
      })
      if (result.kind !== "ready") return null
      const publication = await publishHistoryRestore({
        mode: "current-context",
        snapshot: result.snapshot,
        workspaceEpoch,
        generation,
        displayGeneration,
      })
      return publication.kind === "published" ? publication.restored : null
    } finally {
      if (workspaceController.isLoadGenerationCurrent(generation)) setIsAnalysisFetching(false)
    }
  }, [historyController, publishHistoryRestore, workspaceController])

  const loadSavedAnalysisRun = useCallback(async (
    analysisRunId: string,
    generation: number,
    displayGeneration: number,
  ) => {
    const workspaceEpoch = workspaceController.captureEpoch()
    const isRestoreCurrent = () => (
      workspaceController.isLoadGenerationCurrent(generation)
      && workspaceController.isEpochCurrent(workspaceEpoch)
    )
    setIsAnalysisFetching(true)
    try {
      const result = await historyController.loadSavedRunRestore({
        analysisRunId,
        isCurrent: isRestoreCurrent,
      })
      if (result.kind !== "ready") return null
      const publication = await publishHistoryRestore({
        mode: "saved-run",
        snapshot: result.snapshot,
        workspaceEpoch,
        generation,
        displayGeneration,
      })
      return publication.kind === "published" ? publication.restored : null
    } finally {
      if (workspaceController.isLoadGenerationCurrent(generation)) setIsAnalysisFetching(false)
    }
  }, [historyController, publishHistoryRestore, workspaceController])

  const loadWorkspace = useCallback(async ({ retryDatabase = false }: { retryDatabase?: boolean } = {}) => {
    const generation = workspaceController.beginLoadGeneration()
    const displayGenerationAtLoadStart = workspaceController.getDisplayGeneration()
    const isCurrent = () => workspaceController.isLoadGenerationCurrent(generation)
    setIsBootstrapping(true)
    setHistoryLoadError(null)
    try {
      const branches = await loadWorkspaceBranches({
        loadProvider: async () => {
          const providerConfigs = await settingsStorage.getProviderConfigs()
          if (isCurrent()) setProvider(providerConfigs.find((item) => item.isDefault) ?? null)
          return providerConfigs
        },
        loadPreset: async () => {
          const persistedPresetId = await settingsStorage.getAnalysisPresetId()
          if (isCurrent()) setAnalysisPresetId(persistedPresetId)
          return persistedPresetId
        },
        loadRecent: async () => {
          const readiness = retryDatabase
            ? await databaseAvailabilityController.retry()
            : await databaseAvailabilityController.initialize()
          if (!isDatabaseReady(readiness)) {
            throw new Error("Local database is unavailable.")
          }
          const recent = await historyController.listRecentAnalyses(10)
          if (!isCurrent()) return recent
          setRecentItems(recent)
          setHistoryLoadError(null)

          if (videoContext.platform && videoContext.videoId && videoContext.contentKey) {
            await loadSavedAnalysisForContext(
              videoContext,
              generation,
              displayGenerationAtLoadStart,
            )
          }
          return recent
        },
      }, {
        isRecentCurrent: isCurrent,
        onHistoryFailure: () => {
          if (databaseAvailabilityController.getSnapshot().status !== "unavailable") {
            setHistoryLoadError(t("history.loadFailed"))
          }
        },
      })

      if (!isCurrent()) return
      if (branches.provider.status === "rejected") {
        console.error("Side Panel provider settings initialization failed.", branches.provider.reason)
      }
      if (branches.preset.status === "rejected") {
        console.error("Side Panel analysis preset initialization failed.", branches.preset.reason)
      }
    } catch (error) {
      if (isCurrent()) {
        if (!isDatabaseUnavailableError(error)) {
          setHistoryLoadError(t("history.loadFailed"))
        }
        console.error("Side Panel workspace initialization failed.", error)
      }
    } finally {
      if (isCurrent()) setIsBootstrapping(false)
    }
  }, [
    databaseAvailabilityController,
    historyController,
    loadSavedAnalysisForContext,
    t,
    videoContext,
    activeTabId,
    workspaceController,
  ])

  useEffect(() => {
    const transition = workspaceController.observeRuntimeContent({
      videoContext,
      activeTabId,
    })

    if (!transition.shouldReset) return

    workspaceController.applyRuntimeReset({
      invalidateAskThreadLoadGeneration: () => askController.invalidateThreadLoadGeneration(),
      invalidateTranscriptLoadEpoch: () => transcriptController.invalidateLoadEpoch(),
      invalidateAskExecutionGeneration: () => askController.invalidateExecutionGeneration(),
      clearAnalysis: () => setAnalysisView(null),
      clearAnalysisError: () => setAnalysisError(null),
      setAnalysisIdle: () => setAnalysisPhase("idle"),
      resetTranscript,
      clearAskQuestion: () => setAskQuestion(""),
      clearAskWorkspace: () => clearQaWorkspace(),
      clearAskError: () => setAskError(null),
      clearAnalysisFetching: () => setIsAnalysisFetching(false),
    })
  }, [
    activeTabId,
    askController,
    clearQaWorkspace,
    resetTranscript,
    transcriptController,
    videoContext.author,
    videoContext.canonicalUrl,
    videoContext.contentKey,
    videoContext.isReady,
    videoContext.partId,
    videoContext.platform,
    videoContext.title,
    videoContext.url,
    videoContext.videoId,
    workspaceController,
  ])

  /**
   * Knowledge follows the authoritative runtime contentKey only. Unsupported or
   * missing content resets the controller so the previous video's collection can
   * never leak into the next one.
   */
  useEffect(() => {
    const context = videoContextRef.current
    const identity = context.isReady && context.contentKey
      ? identityFromContext(context)
      : null
    if (!identity) {
      knowledgeController.reset()
      return
    }
    if (!isDatabaseReady(databaseAvailability.status)) return
    void knowledgeController.loadForContent({ identity })
  }, [
    databaseAvailability.status,
    knowledgeController,
    videoContext.contentKey,
    videoContext.isReady,
    videoContext.partId,
    videoContext.platform,
    videoContext.videoId,
  ])

  useEffect(() => {
    void loadWorkspace()
  }, [loadWorkspace])

  const loadTranscriptForCurrent = useCallback(async (forceReload = false): Promise<CurrentTranscriptResult> => {
    const current = videoContextRef.current
    if (!current.isReady || !current.contentKey) {
      throw new Error("Open a supported video page before loading its transcript.")
    }

    const request: TranscriptAcquisitionRequest = {
      video: {
        platform: current.platform!,
        videoId: current.videoId!,
        contentKey: current.contentKey,
        ...(current.partId ? { partId: current.partId } : {}),
        title: current.title ?? current.videoId!,
        author: current.author,
        canonicalUrl: current.canonicalUrl ?? current.url,
      },
    }
    return transcriptController.loadCurrent({
      request,
      forceReload,
      isTargetCurrent: () => videoContextRef.current.contentKey === request.video.contentKey,
      onFingerprintChanged: () => {
        askController.invalidateExecutionGeneration()
        clearQaWorkspace()
        setAskQuestion("")
        setAskAnswer(null)
        setAskError(null)
      },
      onPublished: (snapshot) => {
        currentTranscriptFingerprintRef.current = snapshot.fingerprint
      },
    })
  }, [askController, clearQaWorkspace, transcriptController])

  const handleLoadTranscript = useCallback(async () => {
    try {
      await loadTranscriptForCurrent(true)
      toast.success(t("toast.transcriptLoaded"))
    } catch (error) {
      if (error instanceof StaleTranscriptError) return
      toast.error(error instanceof Error ? error.message : t("toast.unknownTranscriptError"))
    }
  }, [loadTranscriptForCurrent, reportDatabaseFailure, t])

  const loadTranscriptForTask = useCallback(async (
    task: ActiveAnalysisTask,
    forceReloadTranscript: boolean,
  ): Promise<CurrentTranscriptResult> => {
    const { snapshot } = task
    const isCurrentTask = () => analysisTaskController.isCurrent(snapshot.taskId)
    const request: TranscriptAcquisitionRequest = {
      video: {
        platform: snapshot.platform,
        videoId: snapshot.videoId,
        contentKey: snapshot.contentKey,
        ...(snapshot.partId ? { partId: snapshot.partId } : {}),
        title: snapshot.title,
        author: snapshot.author,
        canonicalUrl: snapshot.canonicalUrl
          ?? (snapshot.platform === "youtube"
            ? `https://www.youtube.com/watch?v=${snapshot.videoId}`
            : `https://www.bilibili.com/video/${snapshot.videoId}?p=${snapshot.partId ?? "1"}`),
      },
      sourceTabId: snapshot.sourceTabId,
      cachedPartIdFallback: snapshot.partId,
    }
    const session: TranscriptSessionSnapshot = {
      identity: transcriptIdentity,
      segments: transcriptCues,
      rawVtt,
    }

    const result = await transcriptController.acquireForTask({
      request,
      session,
      forceReload: forceReloadTranscript,
      isTaskCurrent: isCurrentTask,
    })
    return result
  }, [analysisTaskController, rawVtt, transcriptCues, transcriptIdentity, transcriptController])

  // Publishing a completed analysis replaces the displayed analysis without
  // starting a workspace load. Recording the selection synchronously keeps an
  // in-flight History restore from committing a stale analysis identity. Both
  // the cached and the fresh completion paths must go through this helper so
  // they cannot drift apart again.
  const publishCompleted = useCallback((publication: AnalysisExecutionPublication) => {
    publishCompletedAnalysis(publication, {
      publishAnalysisView: setAnalysisView,
      readSelectedQaThreadId: () => workspaceController.getDisplaySelection().qaThreadId,
      syncDisplaySelection: (selection) => {
        workspaceController.syncDisplaySelection(selection)
      },
    })
  }, [workspaceController])

  const handleAnalyze = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    if (!ensureDatabaseAvailable()) return
    if (analysisPresetWriter.isPending()) return
    if (activeAnalysisTask) {
      toast.error(t("toast.anotherAnalysis"))
      return
    }
    if (!videoContext.isReady || !videoContext.videoId || !videoContext.contentKey || activeTabId === null) {
      toast.error(t("toast.openSupportedPage"))
      return
    }
    if (!provider) {
      setActiveTab("settings")
      return
    }

    finalCheckpointLifecycle.invalidate()
    askController.invalidateExecutionGeneration()
    askController.invalidateThreadLoadGeneration()
    clearQaWorkspace()
    const requestedProvider = provider
    const executionPolicy = getAnalysisTaskExecutionPolicy(force)
    const requestedPreset = createAnalysisPresetSnapshot(analysisPresetId)
    const taskSnapshot = {
      sourceTabId: activeTabId,
      platform: videoContext.platform!,
      videoId: videoContext.videoId,
      partId: videoContext.partId,
      contentKey: videoContext.contentKey,
      title: videoContext.title ?? videoContext.videoId,
      author: videoContext.author,
      canonicalUrl: videoContext.canonicalUrl ?? videoContext.url ?? null,
      providerProfileId: requestedProvider.id,
      providerBaseUrl: requestedProvider.baseUrl,
      providerModel: requestedProvider.model,
      generationTimeoutSec: requestedProvider.generationTimeoutSec ?? 600,
      analysisPresetId: requestedPreset.id,
      analysisPromptVersion: requestedPreset.promptVersion,
    }
    const requestedWorkspaceEpoch = workspaceController.captureEpoch()
    setAnalysisError(null)
    setAskAnswer(null)
    setAskError(null)

    const runTask = async () => {
      let admission: TaskAdmissionHandle | null = null
      let taskPromise: Promise<void> | null = null
      try {
        admission = await admitDestructiveTask({
          kind: "analysis",
          contentKey: taskSnapshot.contentKey,
          analysisRunId: destructiveWorkspaceRef.current.analysisRunId ?? undefined,
          phase: "loading-transcript",
        }, (taskId) => {
          taskPromise = analysisTaskController.start(taskSnapshot, async ({ taskId, signal, setPhase, setProgress }) => {
          const task = analysisTaskController.getSnapshot()
          if (!task || task.snapshot.taskId !== taskId) throw new Error("Analysis task is no longer active.")
          const ensureTaskCurrent = () => {
            if (!analysisTaskController.isCurrent(taskId)) throw new Error("Analysis task is no longer active.")
            if (signal.aborted) throw new AnalysisAbortedError()
          }

          const result = await loadTranscriptForTask(
            task,
            executionPolicy.forceReloadTranscript,
          )
          ensureTaskCurrent()
          const transcriptFinalization = await transcriptController.prepareTaskFinalization({
            result,
            taskSource: task.snapshot,
          })
          ensureTaskCurrent()
          const {
            sourceVideo,
            transcriptFingerprint,
            publication,
          } = transcriptFinalization
          const { transcript } = result
          workspaceController.publishAnalysisTranscript({
            workspaceEpoch: requestedWorkspaceEpoch,
            taskContentKey: task.snapshot.contentKey,
            currentContentKey: videoContextRef.current.contentKey,
            effects: {
              publishTranscript: () => {
                publishTranscript({
                  cues: publication.cues,
                  identity: publication.identity,
                  title: publication.title,
                  fingerprint: transcriptFingerprint,
                  rawVtt: publication.rawVtt,
                })
              },
            },
          })

          finalCheckpointDurationRef.current = {
            contentKey: task.snapshot.contentKey,
            durationSec: sourceVideo.durationSec ?? null,
          }
          finalCheckpointLifecycle.syncSource({
            sourceTabId: task.snapshot.sourceTabId,
            platform: task.snapshot.platform,
            videoId: task.snapshot.videoId,
            partId: task.snapshot.partId,
            contentKey: task.snapshot.contentKey,
            title: sourceVideo.title,
            durationSec: sourceVideo.durationSec ?? null,
            workspaceEpoch: requestedWorkspaceEpoch,
            transcriptFingerprint,
            providerProfileId: task.snapshot.providerProfileId,
            analysisPresetId: task.snapshot.analysisPresetId,
          })
          const execution = await analysisController.runExecutionTask({
            taskSnapshot: task.snapshot,
            sourceVideo,
            transcript,
            transcriptFingerprint,
            executionPolicy,
            finalCheckpoint: {
              controller: finalCheckpointLifecycle.controller,
              workspaceEpoch: requestedWorkspaceEpoch,
            },
            signal,
            setPhase,
            onProgress: setProgress,
            ensureTaskCurrent,
          })

          if (execution.kind === "cached") {
            await workspaceController.publishAnalysisResult({
              workspaceEpoch: requestedWorkspaceEpoch,
              taskContentKey: task.snapshot.contentKey,
              currentContentKey: videoContextRef.current.contentKey,
              effects: {
                publishAnalysis: () => {
                  publishCompleted(execution.publication)
                },
                setAnalysisCompleted: () => {
                  setAnalysisPhase("completed")
                },
                restoreQaConversation: async (input) => {
                  await restoreQaConversation(
                    execution.publication.contentKey,
                    execution.publication.analysisRunId,
                    workspaceController.captureLoadGeneration(),
                    execution.publication.transcriptFingerprint,
                    input.isCurrent,
                  )
                },
              },
            })
            await refreshRecentAnalyses()
            toast.success(t("toast.loadedCached", { title: sourceVideo.title }))
            return
          }

          await refreshRecentAnalyses()
          await workspaceController.publishAnalysisResult({
            workspaceEpoch: requestedWorkspaceEpoch,
            taskContentKey: task.snapshot.contentKey,
            currentContentKey: videoContextRef.current.contentKey,
            effects: {
              publishAnalysis: () => {
                publishCompleted(execution.publication)
              },
              setAnalysisCompleted: () => {
                setAnalysisPhase("completed")
              },
              restoreQaConversation: async (input) => {
                await restoreQaConversation(
                  execution.publication.contentKey,
                  execution.publication.analysisRunId,
                  workspaceController.captureLoadGeneration(),
                  execution.publication.transcriptFingerprint,
                  input.isCurrent,
                )
              },
            },
          })
          toast.success(t("toast.analysisCompleted", { title: sourceVideo.title }))
          }, { taskId })
        })
        await taskPromise
      } catch (error) {
        const isAbort = error instanceof AnalysisAbortedError
          || (error instanceof DOMException && error.name === "AbortError")
        if (isAbort) {
          finalCheckpointLifecycle.invalidate()
          workspaceController.publishAnalysisCancelled({
            workspaceEpoch: requestedWorkspaceEpoch,
            taskContentKey: taskSnapshot.contentKey,
            currentContentKey: videoContextRef.current.contentKey,
            effects: {
              clearAnalysisError: () => {
                setAnalysisError(null)
              },
              setAnalysisCancelled: () => {
                setAnalysisPhase("cancelled")
              },
            },
          })
          toast.message(t("toast.analysisCancelled"))
          return
        }
        const message = error instanceof StaleTranscriptError
          || (error instanceof Error && error.message.includes("video part changed while captions were loading"))
          ? "Source video changed before its transcript could be captured."
          : error instanceof Error ? error.message : t("toast.unknownAnalysisError")
        finalResumeAvailability.refresh({ kind: "analysis-failed" })
        workspaceController.publishAnalysisError({
          workspaceEpoch: requestedWorkspaceEpoch,
          taskContentKey: taskSnapshot.contentKey,
          currentContentKey: videoContextRef.current.contentKey,
          effects: {
            publishAnalysisError: () => {
              setAnalysisError(message)
            },
            setAnalysisErrorPhase: () => {
              setAnalysisPhase("error")
            },
            markDisplayedAnalysisError: () => {
              setAnalysisView((current) => current ? { ...current, errorMessage: message } : null)
            },
          },
        })
        toast.error(message)
      } finally {
        admission?.release()
      }
    }

    void runTask()
  }, [activeAnalysisTask, activeTabId, analysisController, analysisPresetId, analysisPresetWriter, analysisTaskController, askController, clearQaWorkspace, ensureDatabaseAvailable, finalCheckpointLifecycle, loadTranscriptForTask, provider, publishCompleted, publishTranscript, refreshRecentAnalyses, reportDatabaseFailure, restoreQaConversation, t, transcriptController, videoContext, workspaceController])

  const handleCancelAnalysis = useCallback(() => {
    finalCheckpointLifecycle.invalidate()
    analysisTaskController.cancel()
  }, [analysisTaskController, finalCheckpointLifecycle])

  /**
   * Explicit Final-only resume.
   *
   * It is deliberately not a variant of `handleAnalyze`: that path starts by
   * invalidating the checkpoint and always runs a full analysis. Here the
   * checkpoint is the input, the source is re-collected and re-verified, and a
   * dedicated admission owns the task. A failure before the Final request costs
   * zero AI calls.
   */
  const handleResumeFinal = useCallback(async () => {
    if (!ensureDatabaseAvailable()) return
    if (analysisPresetWriter.isPending()) return
    if (activeAnalysisTask) {
      toast.error(t("toast.anotherAnalysis"))
      return
    }
    if (!videoContext.isReady || !videoContext.contentKey || activeTabId === null) {
      toast.error(t("toast.openSupportedPage"))
      return
    }
    if (!provider) {
      setActiveTab("settings")
      return
    }
    if (finalCheckpointLifecycle.controller.getMetadata().state !== "available") {
      toast.error(t("finalResume.toast.unavailable"))
      return
    }

    const requestedProvider = provider
    const requestedPreset = createAnalysisPresetSnapshot(analysisPresetId)
    type ResumeTaskSnapshot = Omit<AnalysisTaskSnapshot, "taskId" | "startedAt">
    const taskSnapshot: ResumeTaskSnapshot = {
      sourceTabId: activeTabId,
      platform: videoContext.platform!,
      videoId: videoContext.videoId!,
      partId: videoContext.partId,
      contentKey: videoContext.contentKey,
      title: videoContext.title ?? videoContext.videoId!,
      author: videoContext.author,
      canonicalUrl: videoContext.canonicalUrl ?? videoContext.url ?? null,
      providerProfileId: requestedProvider.id,
      providerBaseUrl: requestedProvider.baseUrl,
      providerModel: requestedProvider.model,
      generationTimeoutSec: requestedProvider.generationTimeoutSec ?? 600,
      analysisPresetId: requestedPreset.id,
      analysisPromptVersion: requestedPreset.promptVersion,
    }
    const requestedWorkspaceEpoch = workspaceController.captureEpoch()
    finalResumeAvailability.setPhase("resuming")

    const runResume = async () => {
      let admission: TaskAdmissionHandle | null = null
      let taskPromise: Promise<void> | null = null
      let settled: FinalResumeResult | null = null
      try {
        admission = await admitDestructiveTask({
          kind: "analysis",
          contentKey: taskSnapshot.contentKey,
          analysisRunId: destructiveWorkspaceRef.current.analysisRunId ?? undefined,
          phase: "loading-transcript",
        }, (taskId) => {
          taskPromise = analysisTaskController.start(
            taskSnapshot,
            async ({ taskId, signal, setPhase, setProgress }) => {
              const task = analysisTaskController.getSnapshot()
              if (!task || task.snapshot.taskId !== taskId) {
                throw new Error("Analysis task is no longer active.")
              }
              const ensureTaskCurrent = () => {
                if (!analysisTaskController.isCurrent(taskId)) {
                  throw new Error("Analysis task is no longer active.")
                }
                if (signal.aborted) throw new AnalysisAbortedError()
              }

              const coordinator = createFinalResumeCoordinator({
                // F-02: readiness *and* identity come from the same live runtime
                // read. The frozen resume task only supplies what to compare
                // against, never what to report, so a video/part switch while
                // this resume waits can only fail closed. The coordinator calls
                // this once per real re-capture (admission, before the Final
                // request, before persistence), so it must stay uncached.
                readLiveSource: async () => {
                  const active = analysisTaskController.getSnapshot()
                  if (!active || active.snapshot.taskId !== taskId) {
                    throw new Error("Analysis task is no longer active.")
                  }
                  const current = videoContextRef.current
                  // Throws FinalResumeSourceMismatchError on any divergence
                  // (tab, platform, video, part, content key) before returning.
                  const live = assertLiveSourceMatchesTask({
                    current: {
                      isReady: current.isReady,
                      sourceTabId: activeTabIdRef.current,
                      platform: current.platform,
                      videoId: current.videoId,
                      partId: current.partId,
                      contentKey: current.contentKey,
                      title: current.title,
                    },
                    frozen: {
                      sourceTabId: taskSnapshot.sourceTabId,
                      platform: taskSnapshot.platform,
                      videoId: taskSnapshot.videoId,
                      partId: taskSnapshot.partId,
                      contentKey: taskSnapshot.contentKey,
                      title: taskSnapshot.title,
                    },
                  })
                  const video: VideoInfo = {
                    platform: live.platform,
                    videoId: live.videoId,
                    partId: live.partId ?? undefined,
                    contentKey: live.contentKey,
                    title: live.title,
                    author: current.author,
                    // Only a duration captured for this exact content key may be
                    // reused. `finalCheckpointDurationRef` is written from the
                    // last real transcript acquisition and is keyed by content
                    // key, so a value recorded for another video or part can
                    // never leak into this resume's identity. When no trustworthy
                    // duration exists it stays null and the coordinator's strict
                    // checkpoint comparison decides.
                    durationSec: readFinalCheckpointDuration(live.contentKey),
                    thumbnailUrl: null,
                    canonicalUrl: current.canonicalUrl ?? current.url ?? null,
                  }
                  return {
                    taskSnapshot: active.snapshot,
                    sourceVideo: video,
                    workspaceEpoch: requestedWorkspaceEpoch,
                  }
                },
                loadTranscript: async (live) => {
                  const result = await transcriptController.acquireForTask({
                    request: {
                      video: {
                        platform: live.sourceVideo.platform,
                        videoId: live.sourceVideo.videoId,
                        contentKey: live.sourceVideo.contentKey,
                        ...(live.sourceVideo.partId ? { partId: live.sourceVideo.partId } : {}),
                        title: live.sourceVideo.title,
                        author: live.sourceVideo.author,
                        canonicalUrl: live.sourceVideo.canonicalUrl,
                      },
                      sourceTabId: taskSnapshot.sourceTabId,
                      cachedPartIdFallback: taskSnapshot.partId,
                    },
                    session: {
                      identity: transcriptIdentity,
                      segments: transcriptCues,
                      rawVtt,
                    },
                    forceReload: false,
                    isTaskCurrent: () => analysisTaskController.isCurrent(taskId) && !signal.aborted,
                  })
                  // The audit time of the transcript this resume actually used.
                  // An ordinary run records the moment captions were acquired,
                  // so the resume path must not substitute the save time; taken
                  // right here, between acquisition and finalization.
                  const capturedAt = new Date().toISOString()
                  ensureTaskCurrent()
                  const finalized = await transcriptController.prepareTaskFinalization({
                    result,
                    taskSource: task.snapshot,
                  })
                  ensureTaskCurrent()
                  return {
                    transcript: result.transcript,
                    fingerprint: finalized.transcriptFingerprint,
                    capturedAt,
                  }
                },
                resolveProvider: (providerId) => settingsStorage.resolveProvider(providerId).then((resolved) => ({
                  apiKey: resolved.apiKey,
                  credentialRevision: resolved.credentialRevision,
                  profileUpdatedAt: resolved.profile.updatedAt,
                  profileBaseUrl: resolved.profile.baseUrl,
                  profileModel: resolved.profile.model,
                  profileGenerationTimeoutSec: resolved.profile.generationTimeoutSec,
                })),
                getAnalysisCache: (cacheKey) => runDatabaseOperation(
                  () => historyRepository.getAnalysisCache(cacheKey),
                ),
                runFinalOnlyAnalysis: (options) => {
                  if (!isDatabaseReady(databaseAvailabilityRef.current)) {
                    throw new Error("Local database is unavailable.")
                  }
                  return runFinalOnlyAnalysis(options)
                },
                persistCompletedAnalysis: async (input) => {
                  const cacheKey = await computeAnalysisCacheKey({
                    contentKey: input.taskSnapshot.contentKey,
                    transcriptFingerprint: input.transcriptFingerprint,
                    providerProfileId: input.taskSnapshot.providerProfileId,
                    baseUrl: input.taskSnapshot.providerBaseUrl,
                    model: input.taskSnapshot.providerModel,
                    promptVersion: input.taskSnapshot.analysisPromptVersion,
                  })
                  const result = await analysisController.persistCompletedAnalysis({
                    taskSnapshot: input.taskSnapshot,
                    sourceVideo: input.sourceVideo,
                    transcript: input.transcript,
                    transcriptFingerprint: input.transcriptFingerprint,
                    analysis: input.analysis,
                    cacheKey,
                    analysisPromptVersion: input.taskSnapshot.analysisPromptVersion,
                    // The real transcript acquisition time carried by the
                    // coordinator, never the save time: an ordinary run records
                    // the capture moment, so a resumed write must match it.
                    transcriptCapturedAt: input.transcriptCapturedAt,
                    taskStartedAt: input.taskStartedAt,
                    completedAt: input.completedAt,
                    analysisRunId: input.analysisRunId,
                    transcriptSnapshotId: input.transcriptSnapshotId,
                  })
                  return { analysisRunId: result.analysisRunId }
                },
              })

              settled = await coordinator.resume({
                taskSnapshot: task.snapshot,
                workspaceEpoch: requestedWorkspaceEpoch,
                signal,
                setPhase,
                onProgress: setProgress,
                ensureTaskCurrent,
                checkpoint: finalCheckpointLifecycle.controller,
                checkpointMetadata: () => finalCheckpointLifecycle.controller.getMetadata(),
              })
              finalResumeAvailability.refresh({ kind: "resume-settled" })
            },
            { taskId },
          )
        })
        await taskPromise
      } catch (error) {
        const message = error instanceof Error ? error.message : t("toast.unknownAnalysisError")
        toast.error(message)
      } finally {
        admission?.release()
      }

      const outcome = settled
      finalResumeAvailability.setPhase("available")
      if (!outcome) return
      switch (outcome.kind) {
        case "completed":
        case "cached": {
          await workspaceController.publishAnalysisResult({
            workspaceEpoch: requestedWorkspaceEpoch,
            taskContentKey: taskSnapshot.contentKey,
            currentContentKey: videoContextRef.current.contentKey,
            effects: {
              publishAnalysis: () => publishCompleted(outcome.publication),
              setAnalysisCompleted: () => setAnalysisPhase("completed"),
              restoreQaConversation: async (input) => {
                await restoreQaConversation(
                  outcome.publication.contentKey,
                  outcome.publication.analysisRunId,
                  workspaceController.captureLoadGeneration(),
                  outcome.publication.transcriptFingerprint,
                  input.isCurrent,
                )
              },
            },
          })
          await refreshRecentAnalyses()
          setAnalysisError(null)
          toast.success(outcome.kind === "cached"
            ? t("finalResume.toast.cached")
            : t("finalResume.toast.completed", { title: taskSnapshot.title }))
          return
        }
        case "final-retryable":
          finalResumeAvailability.refresh({ kind: "retryable" })
          toast.error(t("finalResume.toast.retryable", {
            status: outcome.error instanceof OpenAICompatibleClientError
              ? (outcome.error.status ?? 0)
              : 0,
          }))
          return
        case "cancelled":
          finalResumeAvailability.refresh({ kind: "cancelled" })
          workspaceController.publishAnalysisCancelled({
            workspaceEpoch: requestedWorkspaceEpoch,
            taskContentKey: taskSnapshot.contentKey,
            currentContentKey: videoContextRef.current.contentKey,
            effects: {
              clearAnalysisError: () => setAnalysisError(null),
              setAnalysisCancelled: () => setAnalysisPhase("cancelled"),
            },
          })
          toast.message(t("finalResume.toast.cancelled"))
          return
        case "persistence-failed":
          toast.error(t("finalResume.toast.persistence", {
            error: outcome.error instanceof Error ? outcome.error.message : t("toast.unknownAnalysisError"),
          }))
          return
        case "structured-output-failed":
          finalResumeAvailability.refresh({ kind: "structured" })
          toast.error(t("finalResume.toast.structured"))
          return
        case "fatal-failure":
          finalResumeAvailability.refresh({ kind: "fatal" })
          toast.error(t("finalResume.toast.fatal", {
            error: outcome.error instanceof Error ? outcome.error.message : t("toast.unknownAnalysisError"),
          }))
          return
        default:
          finalResumeAvailability.refresh({ kind: outcome.kind })
          toast.error(t("finalResume.toast.unavailable"))
      }
    }

    void runResume()
  }, [activeAnalysisTask, activeTabId, analysisController, analysisPresetId, analysisPresetWriter, analysisTaskController, ensureDatabaseAvailable, finalCheckpointLifecycle, finalResumeAvailability, provider, publishCompleted, rawVtt, refreshRecentAnalyses, reportDatabaseFailure, restoreQaConversation, t, transcriptController, transcriptCues, transcriptIdentity, videoContext, workspaceController])

  const handleOpenSavedAnalysis = useCallback(async (
    videoId: string,
    contentKey?: string,
    analysisRunId?: string,
  ) => {
    if (!ensureDatabaseAvailable()) return null
    // Resolve the saved content identity before any workspace side effect.
    // The content-key restore clears the displayed analysis before it can
    // report that nothing matched, so an unparsable key has to be rejected
    // here: returning now leaves the current analysis, transcript and Ask
    // workspace exactly as they were. A run id always wins, mirroring the
    // branch priority below, so a malformed key never blocks that restore.
    let savedIdentity: ContentKeyHistoryIdentity | null = null
    if (!analysisRunId && contentKey) {
      savedIdentity = historyContextIdentityFromContentKey(contentKey)
      if (!savedIdentity) return null
    }
    askController.invalidateExecutionGeneration()
    transcriptController.invalidateLoadEpoch()
    setAskQuestion("")
    setAskAnswer(null)
    setAskError(null)
    setAnalysisError(null)
    const generation = workspaceController.beginLoadGeneration()
    // Ownership of the displayed analysis, captured before any await. A
    // competing analysis publication replaces the displayed analysis without
    // starting a workspace load, so the load generation alone cannot see it.
    const displayGeneration = workspaceController.getDisplayGeneration()
    let restored: WorkspaceRestoredAnalysisIdentity | null = null
    try {
      if (analysisRunId) {
        restored = await loadSavedAnalysisRun(analysisRunId, generation, displayGeneration)
      } else if (contentKey && savedIdentity) {
        const current = videoContextRef.current
        restored = await loadSavedAnalysisForContext({
          ...current,
          videoId,
          contentKey,
          platform: savedIdentity.platform,
          partId: savedIdentity.partId,
        }, generation, displayGeneration)
      } else {
        restored = await loadSavedAnalysis(videoId, generation, displayGeneration)
      }
    } catch (error) {
      if (workspaceController.isLoadGenerationCurrent(generation)) {
        toast.error(t("database.unavailable"))
      }
      return null
    }
    // A finished restore is not proof that this request is still current: the
    // publication boundary permits a newer load to start while an older one is
    // awaiting its QA restore, and does not roll back. Commit the displayed
    // selection only when the captured generation is still current, and keep
    // that check and the update in one synchronous segment.
    const committed = commitRestoredDisplaySelection({
      generation,
      displayGeneration,
      restored,
      effects: {
        isLoadGenerationCurrent: (value) => workspaceController.isLoadGenerationCurrent(value),
        readDisplayedAnalysis: () => workspaceController.getDisplaySelection().analysis,
        readDisplayGeneration: () => workspaceController.getDisplayGeneration(),
        readSelectedQaThreadId: () => workspaceController.getDisplaySelection().qaThreadId,
        syncDisplaySelection: (selection) => workspaceController.syncDisplaySelection(selection),
      },
    })

    if (!committed) return null

    toast.success(t("toast.loadedHistory"))
    return committed
  }, [askController, ensureDatabaseAvailable, loadSavedAnalysis, loadSavedAnalysisForContext, loadSavedAnalysisRun, reportDatabaseFailure, t, transcriptController, workspaceController])

  const hasActiveTaskForContent = useCallback((contentKey?: string) => {
    if (!contentKey) return false
    return activeAnalysisTask?.snapshot.contentKey === contentKey
      || activeAskTask?.snapshot.contentKey === contentKey
  }, [activeAnalysisTask, activeAskTask])

  const handleDeleteAnalysis = useCallback(async (item: RecentAnalysisListItem) => {
    if (!ensureDatabaseAvailable()) return
    if (!item.analysisRunId) return
    if (hasActiveTaskForContent(item.contentKey)) {
      toast.error(t("history.cancelFirst"))
      return
    }
    if (!window.confirm(`${t("history.deleteAnalysis")}\n\n${item.title}`)) return
    try {
      const mutation = await historyController.deleteAnalysisRun({
        analysisRunId: item.analysisRunId,
        contentKey: item.contentKey,
      })
      await applyMutation(mutation)
      toast.success(t("history.deleted"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("history.deleteFailed"))
    }
  }, [applyMutation, ensureDatabaseAvailable, hasActiveTaskForContent, historyController, reportDatabaseFailure, t])

  const handleDeleteVideo = useCallback(async (item: RecentAnalysisListItem) => {
    if (!ensureDatabaseAvailable()) return
    if (!item.contentKey) return
    if (hasActiveTaskForContent(item.contentKey)) {
      toast.error(t("history.cancelFirst"))
      return
    }
    if (!window.confirm(`${t("history.deleteVideo")}\n\n${item.title}`)) return
    if (!window.confirm(t("history.deleteVideoDetail", { title: item.title }))) return
    try {
      const mutation = await historyController.deleteVideoData({ contentKey: item.contentKey })
      await applyMutation(mutation)
      toast.success(t("history.allDeleted"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("history.videoDeleteFailed"))
    }
  }, [applyMutation, ensureDatabaseAvailable, hasActiveTaskForContent, historyController, reportDatabaseFailure, t])

  useEffect(() => {
    const adapter = createPendingHistoryOpenAdapter({
      onOpen: async (payload) => {
        await handleOpenSavedAnalysis(payload.videoId, payload.contentKey, payload.analysisRunId)
      },
    })

    adapter.start()

    return () => adapter.stop()
  }, [handleOpenSavedAnalysis])

  const handleAsk = useCallback(async () => {
    if (!ensureDatabaseAvailable()) return
    if (askStartLockRef.current || activeAskTask) {
      toast.message(t("toast.anotherAsk"))
      return
    }
    if (!analysisView || !provider) return
    const preflightAskGeneration = askController.captureExecutionGeneration()
    if (isTranscriptLoading || isAnalysisFetching || isAnalysisBusy) {
      const message = t("toast.transcriptStillLoading")
      setAskError(message)
      toast.error(message)
      return
    }
    const requestedTranscriptLoadGeneration = transcriptController.captureLoadEpoch()
    let requestIdentity: Awaited<ReturnType<typeof askController.prepareExecutionTranscriptIdentity>>
    try {
      requestIdentity = await askController.prepareExecutionTranscriptIdentity({
        analysisFingerprint: analysisView.transcriptFingerprint,
        currentFingerprint: currentTranscriptFingerprintRef.current,
        transcriptCues,
        contentMatches: transcriptIdentity?.contentKey === analysisView.contentKey,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : t("toast.unknownAskError")
      setAskError(message)
      toast.error(message)
      return
    }
    if (!transcriptController.isLoadEpochCurrent(requestedTranscriptLoadGeneration)) {
      const message = t("toast.transcriptChangedWhileLoading")
      setAskError(message)
      toast.error(message)
      return
    }
    if (!askController.isExecutionGenerationCurrent(preflightAskGeneration)) return
    if (!requestIdentity.ok) {
      const message = "reason" in requestIdentity && requestIdentity.reason === "transcript-mismatch"
        ? "Transcript changed since this analysis. Regenerate the analysis before continuing Ask Video."
        : "Load the current transcript before asking a question."
      setAskError(message)
      toast.error(message)
      return
    }
    const actualTranscriptFingerprint = requestIdentity.transcriptFingerprint
    setTranscriptFingerprint(actualTranscriptFingerprint)
    const requestedContentKey = analysisView.contentKey
    const requestedAnalysisRunId = analysisView.analysisRunId ?? "legacy"
    const requestedTranscriptFingerprint = actualTranscriptFingerprint
    if (askStartLockRef.current || activeAskTask) {
      toast.message(t("toast.anotherAsk"))
      return
    }
    pendingAskOperationRef.current = {
      kind: "ask",
      contentKey: requestedContentKey,
      analysisRunId: requestedAnalysisRunId,
      phase: "preparing",
    }
    const requestedThreadId = qaThreadId
      ?? workspaceController.getDisplaySelection().qaThreadId
    const generation = askController.beginExecutionGeneration()
    let requestThreadId = requestedThreadId
    const isCurrentAsk = () => {
      const currentSelection = workspaceController.getDisplaySelection()

      return (
        askController.isExecutionGenerationCurrent(generation)
        && matchesAskRequestWorkspaceIdentity({
          contentKey: requestedContentKey,
          analysisRunId: requestedAnalysisRunId,
          threadId: requestThreadId,
          transcriptFingerprint: requestedTranscriptFingerprint,
        }, {
          contentKey: currentSelection.analysis?.contentKey ?? null,
          analysisRunId: currentSelection.analysis?.analysisRunId ?? "legacy",
          threadId: currentSelection.qaThreadId,
          transcriptFingerprint: currentTranscriptFingerprintRef.current,
        })
        && transcriptController.isLoadEpochCurrent(requestedTranscriptLoadGeneration)
      )
    }

    setAskError(null)
    const submittedQuestion = askQuestion.trim()
    askStartLockRef.current = true
    let admission: TaskAdmissionHandle | null = null
    let askSignal: AbortSignal | null = null
    try {
      admission = await admitDestructiveTask({
        kind: "ask",
        contentKey: requestedContentKey,
        analysisRunId: requestedAnalysisRunId,
        phase: "preparing",
      }, () => {})
      const preparedThread = await askController.prepareExecutionThread({
        requestedThreadId: requestThreadId,
        contentKey: requestedContentKey,
        analysisRunId: requestedAnalysisRunId,
        transcriptFingerprint: requestedTranscriptFingerprint,
        platform: analysisView.platform,
        videoId: analysisView.videoId,
        partId: analysisView.partId,
        question: submittedQuestion,
        selectedProviderId: provider.id,
        isCurrent: isCurrentAsk,
      })
      if (preparedThread.kind === "stale") return
      const { thread, providerRequest: frozenProviderRequest } = preparedThread
      if (preparedThread.created) {
        requestThreadId = thread.id
        workspaceController.setSelectedQaThreadId(thread.id)
        setQaThreadId(thread.id)
        setQaThreads((current) => [thread, ...current.filter((item) => item.id !== thread.id)])
      }
      if (!isCurrentAsk()) return

      const { conversationHistory, userMessage } = await askController.prepareExecutionTurn({
        threadId: thread.id,
        question: submittedQuestion,
      })
      setAskQuestion("")
      if (isCurrentAsk()) {
        setQaMessages((current) => [...current.filter((message) => message.id !== userMessage.id), userMessage])
      }
      const {
        qaCacheKey,
        taskSnapshot,
        providerRequest: taskProviderRequest,
        taskAnalysis,
        taskTranscriptCues,
        taskConversationHistory,
      } = await askController.prepareExecutionTaskInput({
        thread,
        requestedContentKey,
        requestedAnalysisRunId,
        question: submittedQuestion,
        providerRequest: frozenProviderRequest,
        platform: analysisView.platform,
        videoId: analysisView.videoId,
        partId: analysisView.partId,
        videoTitle: analysisView.title,
        analysis: analysisView.analysis,
        transcriptCues,
        conversationHistory,
      })
      if (!ensureDatabaseAvailable()) return
      const taskPromise = askTaskController.start(taskSnapshot, async ({ taskId, signal, setPhase }) => {
        askSignal = signal
        const { answer, assistantMessage } = await askController.runExecutionTask({
          qaCacheKey,
          taskSnapshot,
          providerRequest: taskProviderRequest,
          taskAnalysis,
          taskTranscriptCues,
          taskConversationHistory,
          signal,
          isTaskCurrent: () => askTaskController.isCurrent(taskId),
          setPhase,
        })
        // Read the live displayed identity at completion time, never the
        // startup-time state: the user may have switched away from this video
        // and back. The exact immutable task identity (not the workspace epoch)
        // decides whether this result may touch the current Ask UI.
        const currentSelection = workspaceController.getDisplaySelection()
        workspaceController.publishAskResult({
          requested: {
            contentKey: taskSnapshot.contentKey,
            analysisRunId: taskSnapshot.analysisRunId,
            threadId: taskSnapshot.threadId,
            transcriptFingerprint: taskSnapshot.transcriptFingerprint,
          },
          current: {
            contentKey: currentSelection.analysis?.contentKey ?? null,
            analysisRunId: currentSelection.analysis?.analysisRunId ?? "legacy",
            threadId: currentSelection.qaThreadId,
            transcriptFingerprint: currentTranscriptFingerprintRef.current,
          },
          effects: {
            publishAssistantMessage: () => {
              setQaMessages((current) => [...current, assistantMessage])
            },
            publishAnswer: () => {
              setAskAnswer(answer)
            },
          },
        })
        toast.success(t("toast.askReady", { title: taskSnapshot.videoTitle }))
      }, { taskId: admission.taskId })
      await taskPromise
    } catch (error) {
      const wasCancelled = askSignal?.aborted
      if (wasCancelled) {
        toast.message(t("toast.askCancelled"))
        return
      }
      const message = error instanceof Error ? error.message : t("toast.unknownAskError")
      if (isCurrentAsk()) setAskError(message)
      toast.error(message)
    } finally {
      admission?.release()
      pendingAskOperationRef.current = null
      askStartLockRef.current = false
    }
  }, [activeAskTask, analysisView, askController, askQuestion, askTaskController, ensureDatabaseAvailable, isAnalysisBusy, isAnalysisFetching, isTranscriptLoading, provider, qaThreadId, reportDatabaseFailure, setTranscriptFingerprint, t, transcriptController, transcriptCues, transcriptIdentity, workspaceController])

  const handleCancelAsk = useCallback(() => {
    askTaskController.cancel()
  }, [askTaskController])

  const handleNewQaChat = useCallback(() => {
    if (isAsking) return
    askController.invalidateExecutionGeneration()
    askController.invalidateThreadLoadGeneration()
    workspaceController.setSelectedQaThreadId(null)
    setQaThreadId(null)
    setQaMessages([])
    setAskAnswer(null)
    setAskQuestion("")
    setAskError(null)
  }, [askController, isAsking, workspaceController])

  const handleOpenQaThread = useCallback(async (threadId: string) => {
    if (!ensureDatabaseAvailable()) return
    if (isAsking || isTranscriptLoading || isAnalysisFetching || isAnalysisBusy) return
    try {
    const requestedContentKey = analysisView?.contentKey
    const requestedAnalysisRunId = analysisView?.analysisRunId ?? "legacy"
    const requestedTranscriptFingerprint = await askController.resolveOpenThreadTranscriptFingerprint({
      currentFingerprint: currentTranscriptFingerprintRef.current,
      transcriptCues,
    })
    const requestedTranscriptLoadGeneration = transcriptController.captureLoadEpoch()
    askController.invalidateExecutionGeneration()
    const generation = askController.beginThreadLoadGeneration()
    const isCurrent = () => {
      const currentSelection = workspaceController.getDisplaySelection()

      return (
        askController.isThreadLoadGenerationCurrent(generation)
        && transcriptController.isLoadEpochCurrent(requestedTranscriptLoadGeneration)
        && (currentSelection.analysis?.contentKey ?? null) === requestedContentKey
        && (currentSelection.analysis?.analysisRunId ?? "legacy") === requestedAnalysisRunId
        && currentTranscriptFingerprintRef.current === requestedTranscriptFingerprint
      )
    }
    const result = await askController.openThread({
      threadId,
      contentKey: requestedContentKey,
      analysisRunId: requestedAnalysisRunId,
      transcriptFingerprint: requestedTranscriptFingerprint,
      isCurrent,
    })
    if (result.kind !== "ready" || !isCurrent()) return
    workspaceController.setSelectedQaThreadId(threadId)
    setQaThreadId(threadId)
    setQaMessages(result.thread.messages)
    setAskQuestion("")
    setAskAnswer(result.thread.answer)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("database.unavailable"))
    }
  }, [analysisView, askController, ensureDatabaseAvailable, isAnalysisBusy, isAnalysisFetching, isAsking, isTranscriptLoading, reportDatabaseFailure, t, transcriptController, transcriptCues, workspaceController])

  const handleDeleteQaThread = useCallback(async (threadId: string) => {
    if (!ensureDatabaseAvailable()) return
    if (isAsking) return
    try {
      await askController.deleteThread({ threadId })
      setQaThreads((current) => current.filter((thread) => thread.id !== threadId))
      if (
        qaThreadId === threadId
        || workspaceController.getDisplaySelection().qaThreadId === threadId
      ) handleNewQaChat()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("database.unavailable"))
    }
  }, [askController, ensureDatabaseAvailable, handleNewQaChat, isAsking, qaThreadId, reportDatabaseFailure, t, workspaceController])

  const jumpWithIdentity = useCallback(async (
    identity: VideoIdentity | null,
    timestampSeconds: number,
  ) => {
    const outcome = await navigateToTimestamp({
      identity,
      timestampSeconds,
      navigate: jumpToTimestamp,
    })
    switch (outcome.kind) {
      case "missing-identity":
        toast.error(t("toast.noVideoContext"))
        break
      case "jumped-active":
        toast.success(t("runtime.jumpedActive", { timestamp: formatTimestamp(timestampSeconds) }))
        break
      case "opened-new-tab":
        toast.success(t("runtime.openedVideoAt", { timestamp: formatTimestamp(timestampSeconds) }))
        break
      case "runtime-failure":
        toast.error(outcome.error)
        break
    }

    // The Search opener needs the real outcome to clear a pending cross-video
    // request when navigation could not reach the target.
    return outcome
  }, [jumpToTimestamp, t])

  /**
   * Latest Search effects. The opener is created once and always forwards to
   * this ref, so a re-render with fresh callbacks never strands it.
   */
  const searchOpeningEffectsRef = useRef<SearchOpenerEffects | null>(null)
  searchOpeningEffectsRef.current = {
    readCurrentContentKey: () => videoContextRef.current.contentKey,
    readDisplayedAnalysis: () => workspaceController.getDisplaySelection().analysis,
    readCurrentTranscriptFingerprint: () => currentTranscriptFingerprintRef.current,
    restoreAnalysis: (input) => handleOpenSavedAnalysis(
      input.videoId,
      input.contentKey,
      input.analysisRunId,
    ),
    openThread: (input) => {
      askController.invalidateExecutionGeneration()
      return askController.openThread(input)
    },
    publishThread: (input) => {
      workspaceController.setSelectedQaThreadId(input.threadId)
      setQaThreadId(input.threadId)
      setQaMessages(input.thread.messages)
      setAskQuestion("")
      setAskAnswer(input.thread.answer)
    },
    jump: (identity, timestampSeconds) => jumpWithIdentity(identity, timestampSeconds),
    showSurface: (surface, timestampSeconds) => {
      if (surface === "ask") {
        setActiveTab("ask")
        return
      }

      setActiveTab(surface)

      if (surface === "transcript") setTranscriptFocusTimestamp(timestampSeconds)
    },
  }

  const searchOpenerRef = useRef<SearchOpener | null>(null)
  if (!searchOpenerRef.current) {
    const current = () => searchOpeningEffectsRef.current as SearchOpenerEffects

    searchOpenerRef.current = createSearchOpener({
      readCurrentContentKey: () => current().readCurrentContentKey(),
      readDisplayedAnalysis: () => current().readDisplayedAnalysis(),
      readCurrentTranscriptFingerprint: () => current().readCurrentTranscriptFingerprint(),
      restoreAnalysis: (input) => current().restoreAnalysis(input),
      openThread: (input) => current().openThread(input),
      publishThread: (input) => current().publishThread(input),
      jump: (identity, timestampSeconds) => current().jump(identity, timestampSeconds),
      showSurface: (surface, timestampSeconds) => current().showSurface(surface, timestampSeconds),
    })
  }

  const handleSearchQueryChange = useCallback((query: string) => {
    searchController.setQuery(query)
  }, [searchController])

  const handleSearchSubmit = useCallback(async () => {
    if (!ensureDatabaseAvailable()) return
    await searchController.search({
      query: searchSnapshot.query,
      runtime: searchRuntimeRef.current,
    })
  }, [ensureDatabaseAvailable, searchController, searchSnapshot.query])

  const handleOpenSearchResult = useCallback(async (result: SearchResult) => {
    if (!ensureDatabaseAvailable()) return
    try {
      await searchOpenerRef.current?.open(result)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("database.unavailable"))
    }
  }, [ensureDatabaseAvailable, reportDatabaseFailure, t])

  useEffect(() => {
    // A pending cross-video request only resumes once the runtime bridge owns
    // the exact contentKey it was queued for.
    if (!isDatabaseReady(databaseAvailability.status)) return
    const failureGeneration = databaseAvailabilityController.captureFailureGeneration()
    void searchOpenerRef.current?.notifyRuntimeContent(videoContext.contentKey).catch((error: unknown) => {
      reportDatabaseFailure(error, failureGeneration)
    })
  }, [databaseAvailability.status, databaseAvailabilityController, reportDatabaseFailure, videoContext.contentKey])

  useEffect(() => {
    if (activeTab !== "search") return
    // The active content identity is part of this effect's inputs: a video or
    // Bilibili part switch must recompute the current-video row for the new
    // exact contentKey instead of leaving the previous runtime's hit visible.
    // A null identity is a real state (navigation, unsupported page) and must
    // also refresh, so it drops the stale current-video row while keeping the
    // query and the global results.
    if (!isDatabaseReady(databaseAvailability.status)) {
      searchController.clearResults()
      return
    }
    void searchController.refresh(searchRuntimeRef.current).catch(() => {
      searchController.clearResults()
    })
  }, [activeTab, databaseAvailability.status, searchController, videoContext.contentKey])

  const handleAnalysisJump = useCallback((timestampSeconds: number) => {
    const identity = analysisView
      ? identityFromAnalysis(analysisView)
      : identityFromContext(videoContextRef.current)
    void jumpWithIdentity(identity, timestampSeconds)
  }, [analysisView, jumpWithIdentity])

  const handleTranscriptJump = useCallback((timestampSeconds: number) => {
    void jumpWithIdentity(transcriptIdentity, timestampSeconds)
  }, [jumpWithIdentity, transcriptIdentity])

  /**
   * Knowledge commands always receive the complete canonical identity captured
   * from the authoritative runtime content; a bare `videoId` is never enough.
   */
  const knowledgeIdentity = videoContext.isReady && videoContext.contentKey
    ? identityFromContext(videoContext)
    : null
  const knowledgeVideoTitle = videoContext.title ?? knowledgeIdentity?.videoId ?? null
  /**
   * Canonical runtime identity for the Knowledge authoring draft. Mirrors the
   * load effect, so an unsupported or missing runtime content clears the draft
   * instead of keeping an editable state from the previous video.
   */
  const knowledgeContentKey = knowledgeIdentity ? knowledgeIdentity.contentKey : null

  const handleToggleKnowledgeBookmark = useCallback(async () => {
    if (!ensureDatabaseAvailable()) return
    if (!knowledgeIdentity || !knowledgeVideoTitle) return
    const timestampSeconds = videoContextRef.current.timestampSeconds
    if (!Number.isFinite(timestampSeconds)) {
      toast.error(t("knowledge.bookmarkUnavailable"))
      return
    }
    const normalized = normalizeKnowledgeTimestamp(timestampSeconds)
    try {
      const result = await knowledgeController.toggleBookmark({
        identity: knowledgeIdentity,
        videoTitle: knowledgeVideoTitle,
        timestampSeconds: normalized,
      })
      if (result.kind === "created") {
        toast.success(t("knowledge.bookmarkSaved", { timestamp: formatTimestamp(normalized) }))
      } else {
        toast.success(t("knowledge.bookmarkRemoved", { timestamp: formatTimestamp(normalized) }))
      }
    } catch (error) {
      toast.error(t("knowledge.bookmarkFailed"))
    }
  }, [ensureDatabaseAvailable, formatTimestamp, knowledgeController, knowledgeIdentity, knowledgeVideoTitle, reportDatabaseFailure, t])

  const handleCreateKnowledgeNote = useCallback(async (input: {
    text: string
    attachTimestamp: boolean
  }) => {
    if (!ensureDatabaseAvailable()) return
    if (!knowledgeIdentity || !knowledgeVideoTitle) return
    const anchor = input.attachTimestamp
      ? normalizeKnowledgeTimestamp(videoContextRef.current.timestampSeconds)
      : null
    try {
      await knowledgeController.createNote({
        identity: knowledgeIdentity,
        videoTitle: knowledgeVideoTitle,
        text: input.text,
        timestampSeconds: anchor,
      })
      toast.success(t("knowledge.noteSaved"))
    } catch (error) {
      toast.error(t("knowledge.noteFailed"))
    }
  }, [ensureDatabaseAvailable, knowledgeController, knowledgeIdentity, knowledgeVideoTitle, reportDatabaseFailure, t])

  const handleUpdateKnowledgeNote = useCallback(async (id: string, text: string) => {
    if (!ensureDatabaseAvailable()) return
    try {
      await knowledgeController.updateNote({ id, text })
      toast.success(t("knowledge.noteSaved"))
    } catch (error) {
      toast.error(t("knowledge.updateFailed"))
    }
  }, [ensureDatabaseAvailable, knowledgeController, reportDatabaseFailure, t])

  const handleDeleteKnowledgeItem = useCallback(async (id: string) => {
    if (!ensureDatabaseAvailable()) return
    try {
      await knowledgeController.deleteItem(id)
    } catch (error) {
      toast.error(t("knowledge.deleteFailed"))
    }
  }, [ensureDatabaseAvailable, knowledgeController, reportDatabaseFailure, t])

  const handleKnowledgeJump = useCallback((timestampSeconds: number) => {
    void jumpWithIdentity(knowledgeIdentity, timestampSeconds)
  }, [jumpWithIdentity, knowledgeIdentity])

  /**
   * Export is scoped to the authoritative runtime content only. The identity is
   * re-derived from the current video context on every render, so a video switch
   * can never keep exporting data captured from the previous video.
   */
  const markdownExportIdentity = (() => {
    if (!videoContext.isReady) return null
    const identity = identityFromContext(videoContext)
    if (!identity) return null
    return {
      contentKey: identity.contentKey,
      platform: identity.platform,
      videoId: identity.videoId,
      partId: identity.partId ?? null,
    }
  })()

  /**
   * Export sources are rebuilt from the same authoritative runtime identity on
   * every render, so availability and payload can never drift apart.
   */
  const markdownExportSources = {
    analysis: analysisView
      ? {
          contentKey: analysisView.contentKey,
          analysis: analysisView.analysis,
          analysisRunId: analysisView.analysisRunId,
          lastAnalyzedAt: analysisView.lastAnalyzedAt,
        }
      : null,
    transcript: {
      contentKey: transcriptSnapshot.identity?.contentKey ?? null,
      cues: transcriptCues,
    },
    knowledge: knowledgeSnapshot.contentKey
      ? { contentKey: knowledgeSnapshot.contentKey, items: knowledgeSnapshot.items }
      : null,
  }

  const markdownExportAvailability = markdownExportIdentity
    ? resolveMarkdownExportAvailability({
        identity: markdownExportIdentity,
        ...markdownExportSources,
      })
    : { analysis: false, transcript: false, knowledge: false }

  /**
   * Authoritative runtime projection handed to the Search controller. Only
   * sources whose canonical contentKey matches the runtime identity are
   * exposed, so foreign analysis or transcript data can never be searched.
   */
  const searchRuntime = (() => {
    const identity = identityFromContext(videoContext)
    if (!identity) return null
    const analysisMatches = analysisView !== null && analysisView.contentKey === identity.contentKey
    const transcriptMatches = transcriptIdentity?.contentKey === identity.contentKey
    return {
      identity,
      title: videoContext.title ?? identity.videoId,
      author: videoContext.author ?? null,
      analysis: analysisMatches && analysisView
        ? {
            analysisRunId: analysisView.analysisRunId,
            transcriptFingerprint: analysisView.transcriptFingerprint,
            analysis: analysisView.analysis,
          }
        : null,
      transcript: {
        contentKey: transcriptMatches ? identity.contentKey : null,
        cues: transcriptMatches ? transcriptCues : [],
      },
    } satisfies SearchRuntimeProjection
  })()
  const searchRuntimeRef = useRef<SearchRuntimeProjection | null>(null)
  searchRuntimeRef.current = searchRuntime

  const buildMarkdownExportPayload = useCallback(() => {
    if (!markdownExportIdentity) return null
    return buildMarkdownExport({
      identity: markdownExportIdentity,
      title: videoContext.title ?? markdownExportIdentity.videoId ?? markdownExportIdentity.contentKey,
      author: videoContext.author ?? null,
      canonicalUrl: videoContext.canonicalUrl ?? null,
      ...markdownExportSources,
      sections: markdownExportSections,
    })
  }, [
    analysisView,
    knowledgeSnapshot.contentKey,
    knowledgeSnapshot.items,
    markdownExportIdentity,
    markdownExportSections,
    transcriptCues,
    transcriptSnapshot.identity,
    videoContext.author,
    videoContext.canonicalUrl,
    videoContext.title,
  ])

  const handleCopyMarkdown = useCallback(async () => {
    const payload = buildMarkdownExportPayload()
    if (!payload || payload.includedSections.length === 0) {
      toast.error(t("export.empty"))
      return
    }
    try {
      await copyMarkdownExport(payload, (value) => navigator.clipboard.writeText(value))
      toast.success(t("export.copySuccess"))
    } catch {
      toast.error(t("export.copyFailed"))
    }
  }, [buildMarkdownExportPayload, t])

  const handleDownloadMarkdown = useCallback(async () => {
    const payload = buildMarkdownExportPayload()
    if (!payload || payload.includedSections.length === 0) {
      toast.error(t("export.empty"))
      return
    }
    try {
      downloadMarkdownExport(payload, downloadMarkdownFile)
      toast.success(t("export.downloadSuccess"))
    } catch {
      toast.error(t("export.downloadFailed"))
    }
  }, [buildMarkdownExportPayload, t])

  const handleDownload = useCallback(async () => {
    if (!rawVtt || !transcriptIdentity) {
      toast.error(t("toast.originalUnavailable"))
      return
    }
    await downloadRawVtt({
      rawVtt,
      videoId: transcriptIdentity.videoId,
      title: transcriptTitle ?? transcriptIdentity.videoId,
    })
    toast.success(t("toast.downloadStarted"))
  }, [rawVtt, t, transcriptIdentity, transcriptTitle])

  const handleProvidersChange = useCallback((providers: ProviderConfigRecord[]) => {
    setProvider(providers.find((item) => item.isDefault) ?? null)
  }, [])

  /**
   * Preset changes only move the global default, so the control stays usable
   * while a task runs: the running task keeps the strategy it captured at start.
   *
   * Writes are single-flight: the selector is disabled while a save settles, and
   * the writer refuses an overlapping request, so a stale completion or rollback
   * can never overwrite a newer selection.
   */
  const handleAnalysisPresetChange = useCallback(async (nextPresetId: AnalysisPresetId) => {
    if (analysisPresetWriter.isPending()) return
    const previousPresetId = analysisPresetId
    if (nextPresetId === previousPresetId) return
    setIsAnalysisPresetSaving(true)
    setAnalysisPresetId(nextPresetId)
    try {
      const result = await analysisPresetWriter.submit({
        requestedPresetId: nextPresetId,
        previousPresetId,
      })
      setAnalysisPresetId(result.kind === "ignored" ? previousPresetId : result.presetId)
      if (result.kind === "failed") toast.error(t("toast.analysisPresetSaveFailed"))
    } finally {
      setIsAnalysisPresetSaving(false)
    }
  }, [analysisPresetId, analysisPresetWriter, t])

  const visibleAnalysisError = analysisError
    ?? (activeAnalysisTask && activeAnalysisTask.snapshot.contentKey !== videoContext.contentKey
      ? t("analysis.otherRunning")
      : null)
    ?? analysisView?.errorMessage ?? (
    status === "error" ? t("analysis.unavailable") : null
  )
  const headerAnalysisState = t(getAnalysisHeaderPresentation({
    isAnalysisFetching,
    phase: workspaceTask?.phase ?? analysisPhase,
    hasAnalysis: Boolean(analysisView),
  }).statusKey)
  const visibleHistoryLoadError = historyLoadError
    ?? (databaseAvailability.status === "unavailable" ? t("database.unavailable") : null)

  return (
    <main className="min-h-screen min-w-0 overflow-x-hidden bg-background px-3 py-3 text-foreground sm:px-4">
      <SidePanelShell
        activeTab={activeTab}
        onTabChange={setActiveTab}
        databaseStatus={databaseAvailability.status}
        onDatabaseRetry={() => { void loadWorkspace({ retryDatabase: true }) }}
        systemNotice={historyLoadError && databaseAvailability.status !== "unavailable" ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
            <p className="min-w-0 flex-1 text-sm text-foreground">{historyLoadError}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBootstrapping}
              onClick={() => { void loadWorkspace() }}>
              {t("history.retry")}
            </Button>
          </div>
        ) : null}
        header={(
          <CurrentVideoCard
            platform={videoContext.platform}
            partId={videoContext.partId}
            title={title}
            author={videoContext.author}
            canonicalUrl={canonicalUrl}
            videoId={videoContext.videoId ?? "Unavailable"}
            timestampLabel={t("runtime.playbackAt", { timestamp: formatTimestamp(videoContext.timestampSeconds) })}
            isReady={videoContext.isReady}
            runtimeStatus={status}
            providerName={provider?.name ?? null}
            providerModel={provider?.model ?? null}
            analysisState={headerAnalysisState}
            onRefresh={refreshCurrentVideo}
          />
        )}
        taskBanner={(
          <>
            {activeAnalysisTask ? (
              <ActiveAnalysisTaskBanner task={activeAnalysisTask} onCancel={handleCancelAnalysis} />
            ) : null}
            {activeAskTask ? (
              <ActiveAskTaskBanner task={activeAskTask} onCancel={handleCancelAsk} />
            ) : null}
          </>
        )}
        search={(
          <SearchTab
            query={searchSnapshot.query}
            onQueryChange={handleSearchQueryChange}
            onSubmit={handleSearchSubmit}
            results={searchSnapshot.results}
            isSearching={searchSnapshot.isSearching}
            errorMessage={searchSnapshot.error}
            onOpen={handleOpenSearchResult}
            formatTimestamp={formatTimestamp}
          />
        )}
        overview={(
          <OverviewTab
            analysis={analysisView?.analysis ?? null}
            hasCurrentAnalysis={isExactCurrentDisplayedAnalysis}
            analysisError={visibleAnalysisError}
            analysisPhase={workspaceTask?.phase ?? analysisPhase}
            isLoading={isAnalysisLoading}
            hasProvider={Boolean(provider)}
            canAnalyze={Boolean(
              videoContext.isReady
              && isDatabaseReady(databaseAvailability.status)
              && provider
              && !activeAnalysisTask
              && !isAnalysisBusy
              && !isTranscriptLoading
              && !isAnalysisFetching
              && !isAnalysisPresetSaving,
            )}
            lastAnalyzedAt={analysisView?.lastAnalyzedAt
              ? new Date(analysisView.lastAnalyzedAt).toLocaleString(locale)
              : null}
            analysisPresetId={analysisPresetId}
            isAnalysisPresetLoading={isBootstrapping}
            isAnalysisPresetSaving={isAnalysisPresetSaving}
            onAnalysisPresetChange={handleAnalysisPresetChange}
            recentItems={recentItems}
            isHistoryLoading={isBootstrapping}
            historyLoadError={visibleHistoryLoadError}
            onRetryHistory={() => {
              void loadWorkspace({
                retryDatabase: databaseAvailabilityRef.current === "unavailable",
              })
            }}
            activeVideoId={analysisView?.videoId ?? videoContext.videoId}
            activeAnalysisRunId={analysisView?.analysisRunId}
            onAnalyze={handleAnalyze}
            onCancel={handleCancelAnalysis}
            finalResume={{
              view: finalResumeView,
              onResume: () => {
                void handleResumeFinal()
              },
              onRegenerate: () => {
                void handleAnalyze({ force: true })
              },
              onCancel: handleCancelAnalysis,
            }}
            onConfigureProvider={() => setActiveTab("settings")}
            onJump={handleAnalysisJump}
            onSelectHistory={(videoId, contentKey, analysisRunId) => {
              void handleOpenSavedAnalysis(videoId, contentKey, analysisRunId)
            }}
            onDeleteAnalysis={handleDeleteAnalysis}
            onDeleteVideo={handleDeleteVideo}
            onOpenFullHistory={() => {
              const url = chrome.runtime.getURL("options.html#history")
              void chrome.tabs.create({ url })
            }}
            formatTimestamp={formatTimestamp}
            knowledgeItems={knowledgeSnapshot.items}
            knowledgeContentKey={knowledgeContentKey}
            isKnowledgeLoading={knowledgeSnapshot.isLoading}
            knowledgeError={knowledgeSnapshot.error}
            currentTimestamp={Number.isFinite(videoContext.timestampSeconds)
              ? normalizeKnowledgeTimestamp(videoContext.timestampSeconds)
              : null}
            markdownExport={{
              isAvailable: markdownExportIdentity !== null,
              availability: markdownExportAvailability,
              sections: markdownExportSections,
              onSectionsChange: setMarkdownExportSections,
              onCopy: handleCopyMarkdown,
              onDownload: handleDownloadMarkdown,
            }}
            knowledgeHandlers={{
              onToggleBookmark: handleToggleKnowledgeBookmark,
              onCreateNote: handleCreateKnowledgeNote,
              onUpdateNote: handleUpdateKnowledgeNote,
              onDeleteItem: handleDeleteKnowledgeItem,
              onJump: handleKnowledgeJump,
            }}
          />
        )}
        transcript={(
          <TranscriptTab
            segments={transcriptCues}
            isLoading={isTranscriptLoading}
            errorMessage={transcriptError}
            canLoad={Boolean(videoContext.isReady && videoContext.contentKey)}
            rawVtt={rawVtt}
            onLoad={handleLoadTranscript}
            onDownload={handleDownload}
            onJump={handleTranscriptJump}
            formatTimestamp={formatTimestamp}
            focusTimestamp={transcriptFocusTimestamp}
          />
        )}
        ask={(
          <AskTab
            hasProvider={Boolean(provider)}
            hasAnalysis={Boolean(analysisView)}
            hasTranscript={hasMatchingAskTranscript}
            transcriptMismatch={hasAskTranscriptMismatch}
            question={askQuestion}
            answer={askAnswer}
            messages={qaMessages}
            threads={qaThreads}
            currentThreadId={qaThreadId}
            isAsking={isAsking}
            canAsk={canAsk}
            errorMessage={askError}
            isTranscriptLoading={isTranscriptLoading}
            onQuestionChange={setAskQuestion}
            onAsk={handleAsk}
            onFollowUp={setAskQuestion}
            onNewChat={handleNewQaChat}
            onOpenThread={handleOpenQaThread}
            onDeleteThread={handleDeleteQaThread}
            onJump={handleAnalysisJump}
            onOpenSettings={() => setActiveTab("settings")}
            onOpenOverview={() => setActiveTab("overview")}
            onLoadTranscript={handleLoadTranscript}
            formatTimestamp={formatTimestamp}
          />
        )}
        settings={<SettingsTab onProvidersChange={handleProvidersChange} />}
      />
      <Toaster />
    </main>
  )
}

function SidePanel() {
  return (
    <I18nProvider>
      <ExtensionProviders surface="sidepanel">
        <SidepanelWorkspace />
      </ExtensionProviders>
    </I18nProvider>
  )
}

export default SidePanel
