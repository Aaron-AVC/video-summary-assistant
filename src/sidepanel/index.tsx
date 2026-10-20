import "@/styles/globals.css"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

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
  boundQaConversationContext,
  computeBoundedConversationContextFingerprint,
} from "@/features/analysis/lib/qa-conversation-context"
import { qaConversationRepository } from "@/features/analysis/lib/qa-conversation-repository"
import {
  captureAnalysisCompletionTimes,
  getAnalysisTaskExecutionPolicy,
  shouldPublishAnalysisToWorkspace,
} from "@/features/analysis/lib/analysis-task-lifecycle"
import {
  AnalysisTaskAlreadyRunningError,
  AnalysisTaskController,
  type ActiveAnalysisTask,
} from "@/features/analysis/lib/analysis-task-controller"
import {
  AskTaskController,
  type ActiveAskTask,
} from "@/features/analysis/lib/ask-task-controller"
import { AnalysisAbortedError, runAnalysis } from "@/features/analysis/lib/run-analysis"
import type { RecentAnalysisListItem } from "@/features/history/components/recent-analysis-list"
import { historyRepository } from "@/features/history/lib/history-repository"
import {
  admitDestructiveTask,
  performDestructiveOperation,
  subscribeToDestructiveOperations,
  type TaskAdmissionHandle,
  type DestructiveTaskSnapshot,
} from "@/features/history/lib/destructive-operation-coordinator"
import {
  computeAnalysisCacheKey,
  computeQaCacheKey,
  isExactCurrentAnalysis,
  VIDEO_QA_PROMPT_VERSION,
  VIDEO_QA_SCHEMA_VERSION,
} from "@/lib/persistence/cache-identity"
import {
  VIDEO_ANALYSIS_PROMPT_VERSION,
  VIDEO_ANALYSIS_SCHEMA_VERSION,
} from "@/features/analysis/lib/analysis-schema"
import {
  persistIfSupportedPlatform,
} from "@/features/platform/persistence-compat"
import type {
  ActiveVideoContext,
  VideoIdentity,
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
  identityFromAnalysis,
  identityFromContext,
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
  resolveAskTranscriptRequestIdentity,
  resolveAskTranscriptFingerprint,
} from "@/sidepanel/lib/ask-transcript-identity"
import type { QaMessageEntity, QaThreadEntity } from "@/lib/schemas/persistence"
import { applySidepanelDataMutation } from "@/sidepanel/lib/apply-data-mutation"
import { I18nProvider, useI18n } from "@/lib/i18n/i18n-provider"
import {
  createHistoryController,
  type HistoryContext,
} from "@/sidepanel/history/history-controller"
import { createPendingHistoryOpenAdapter } from "@/sidepanel/history/pending-history-open-adapter"
import { createAskController } from "@/sidepanel/ask/ask-controller"

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

  const [activeTab, setActiveTab] = useState<SidePanelTab>(INITIAL_SIDE_PANEL_TAB)
  const [provider, setProvider] = useState<ProviderConfigRecord | null>(null)
  const [analysisView, setAnalysisView] = useState<AnalysisView | null>(null)
  const [recentItems, setRecentItems] = useState<RecentAnalysisListItem[]>([])
  const [askQuestion, setAskQuestion] = useState("")
  const [askAnswer, setAskAnswer] = useState<AskVideoAnswer | null>(null)
  const [qaThreadId, setQaThreadId] = useState<string | null>(null)
  const [qaThreads, setQaThreads] = useState<QaThreadEntity[]>([])
  const [qaMessages, setQaMessages] = useState<QaMessageEntity[]>([])
  const [askError, setAskError] = useState<string | null>(null)
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [isAnalysisFetching, setIsAnalysisFetching] = useState(false)
  const [analysisPhase, setAnalysisPhase] = useState<AnalysisPhase>("idle")
  const [analysisError, setAnalysisError] = useState<string | null>(null)

  const analysisTaskControllerRef = useRef<AnalysisTaskController | null>(null)
  if (!analysisTaskControllerRef.current) analysisTaskControllerRef.current = new AnalysisTaskController()
  const analysisTaskController = analysisTaskControllerRef.current
  const askTaskControllerRef = useRef<AskTaskController | null>(null)
  if (!askTaskControllerRef.current) askTaskControllerRef.current = new AskTaskController()
  const askTaskController = askTaskControllerRef.current
  const transcriptControllerRef = useRef<TranscriptController | null>(null)
  if (!transcriptControllerRef.current) {
    transcriptControllerRef.current = new TranscriptController({
      readCached: (contentKey) => historyRepository.getLatestTranscriptByContentKey(contentKey),
      loadRemote: ({ request, isCurrent }) => loadCurrentTranscript({
        requestedContentKey: request.video.contentKey,
        ...(request.sourceTabId === undefined ? {} : { tabId: request.sourceTabId }),
        isCurrent,
      }),
      saveCache: (payload) => historyRepository.saveTranscriptCache(payload),
    })
  }
  const transcriptController = transcriptControllerRef.current
  const historyControllerRef = useRef<ReturnType<typeof createHistoryController> | null>(null)
  if (!historyControllerRef.current) {
    historyControllerRef.current = createHistoryController({
      listRecentAnalyses: (limit) => historyRepository.listRecentAnalyses(limit),
      getCurrentAnalysisByVideoId: (videoId) => historyRepository.getCurrentAnalysisByVideoId(videoId),
      getLatestTranscriptSnapshotByVideoId: (videoId) => historyRepository.getLatestTranscriptSnapshotByVideoId(videoId),
      getCurrentAnalysisByContentKey: (contentKey) => historyRepository.getCurrentAnalysisByContentKey(contentKey),
      getLatestTranscriptByContentKey: (contentKey) => historyRepository.getLatestTranscriptByContentKey(contentKey),
      getSavedAnalysisRunById: (analysisRunId) => historyRepository.getSavedAnalysisRunById(analysisRunId),
      deleteAnalysisRun: (analysisRunId) => historyRepository.deleteAnalysisRun(analysisRunId),
      deleteVideoData: (contentKey) => historyRepository.deleteVideoData(contentKey),
      performDestructiveOperation,
    })
  }
  const historyController = historyControllerRef.current
  const askControllerRef = useRef<ReturnType<typeof createAskController> | null>(null)
  if (!askControllerRef.current) {
    askControllerRef.current = createAskController({
      listQaThreadsForVideo: (contentKey, analysisRunId) => (
        qaConversationRepository.listQaThreadsForVideo(contentKey, analysisRunId)
      ),
      getQaThread: (threadId) => qaConversationRepository.getQaThread(threadId),
      listQaMessages: (threadId) => qaConversationRepository.listQaMessages(threadId),
      deleteQaThread: (threadId) => qaConversationRepository.deleteQaThread(threadId),
      createQaThread: (input) => qaConversationRepository.createQaThread(input),
      resolveProvider: (providerId) => settingsStorage.resolveProvider(providerId),
    })
  }
  const askController = askControllerRef.current
  const [transcriptSnapshot, setTranscriptSnapshot] = useState(
    transcriptController.getSnapshot(),
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
  const [activeAskTask, setActiveAskTask] = useState<ActiveAskTask | null>(
    askTaskController.getSnapshot(),
  )
  const askGenerationRef = useRef(0)
  const askStartLockRef = useRef(false)
  const loadWorkspaceGenerationRef = useRef(0)
  const qaLoadGenerationRef = useRef(0)
  const activeAnalysisContentKeyRef = useRef<string | null>(null)
  const activeAnalysisRunIdRef = useRef<string>("legacy")
  const currentTranscriptFingerprintRef = useRef<string | null>(null)
  const activeQaThreadIdRef = useRef<string | null>(null)
  const pendingAskOperationRef = useRef<DestructiveTaskSnapshot | null>(null)
  const destructiveWorkspaceRef = useRef({
    analysisRunId: null as string | null,
    analysisContentKey: null as string | null,
    hasPersistedAnalysis: false,
    transcriptContentKey: null as string | null,
    videoContextContentKey: null as string | null,
  })
  activeAnalysisContentKeyRef.current = analysisView?.contentKey ?? null
  activeAnalysisRunIdRef.current = analysisView?.analysisRunId ?? "legacy"
  currentTranscriptFingerprintRef.current = transcriptSnapshot.fingerprint
  activeQaThreadIdRef.current = qaThreadId
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
    activeQaThreadIdRef.current = null
    setQaThreadId(null)
    setQaThreads([])
    setQaMessages([])
    setAskAnswer(null)
  }, [])

  const restoreQaConversation = useCallback(async (
    contentKey: string,
    analysisRunId: string | null | undefined,
    generation: number,
    transcriptFingerprint?: string | null,
  ) => {
    const isCurrent = () => generation === loadWorkspaceGenerationRef.current
    const result = await askController.restoreConversation({
      contentKey,
      analysisRunId,
      transcriptFingerprint: transcriptFingerprint ?? null,
      isCurrent,
    })
    if (result.kind === "stale" || !isCurrent()) return
    const { threads, currentThreadId, messages, answer } = result.snapshot
    setQaThreads(threads)
    activeQaThreadIdRef.current = currentThreadId
    setQaThreadId(currentThreadId)
    setQaMessages(messages)
    setAskAnswer(answer)
  }, [askController])

  useEffect(() => analysisTaskController.subscribe(() => {
    setActiveAnalysisTask(analysisTaskController.getSnapshot())
  }), [analysisTaskController])

  useEffect(() => askTaskController.subscribe(() => {
    setActiveAskTask(askTaskController.getSnapshot())
  }), [askTaskController])

  useEffect(() => transcriptController.subscribe(() => {
    setTranscriptSnapshot(transcriptController.getSnapshot())
  }), [transcriptController])

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
    provider
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
          analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
        }
      : null,
  )

  const refreshRecentAnalyses = useCallback(async () => {
    setRecentItems(await historyController.listRecentAnalyses(10))
  }, [historyController])

  const applyMutation = useCallback(async (mutation: Parameters<typeof applySidepanelDataMutation>[0]) => {
    await applySidepanelDataMutation(mutation, destructiveWorkspaceRef.current, {
      invalidateWorkspace: (clearTranscript) => {
        loadWorkspaceGenerationRef.current += 1
        qaLoadGenerationRef.current += 1
        askGenerationRef.current += 1
        if (clearTranscript) transcriptController.invalidateLoadEpoch()
      },
      clearAnalysis: () => {
        setAnalysisView(null)
        setAnalysisError(null)
        setIsAnalysisFetching(false)
      },
      setAnalysisIdle: () => setAnalysisPhase("idle"),
      clearAskWorkspace: () => {
        qaLoadGenerationRef.current += 1
        askGenerationRef.current += 1
        activeQaThreadIdRef.current = null
        clearQaWorkspace()
        setAskQuestion("")
        setAskError(null)
      },
      clearTranscriptWorkspace: () => {
        resetTranscript()
      },
      refreshRecentAnalyses,
      refreshProvider: async () => {
        const providerConfigs = await settingsStorage.getProviderConfigs()
        setProvider(providerConfigs.find((item) => item.isDefault) ?? null)
      },
    })
  }, [clearQaWorkspace, refreshRecentAnalyses, resetTranscript, transcriptController])

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

  const loadSavedAnalysis = useCallback(async (videoId: string, generation: number) => {
    setIsAnalysisFetching(true)
    try {
      const result = await historyController.loadLegacyVideoRestore({
        videoId,
        isCurrent: () => generation === loadWorkspaceGenerationRef.current,
      })
      if (result.kind === "stale" || generation !== loadWorkspaceGenerationRef.current) return
      const { snapshot } = result
      publishTranscript({
        cues: snapshot.transcript.cues,
        identity: snapshot.transcript.identity,
        title: snapshot.transcript.title,
        fingerprint: snapshot.transcript.fingerprint,
        rawVtt: snapshot.transcript.rawVtt,
      })
      transcriptController.setError(null)

      if (!snapshot.analysis) {
        setAnalysisView(null)
        setAnalysisPhase("idle")
        clearQaWorkspace()
        return
      }

      setAnalysisView({
        ...snapshot.analysis,
      })
      setAnalysisPhase("completed")
      await restoreQaConversation(
        snapshot.analysis.contentKey,
        snapshot.analysis.analysisRunId,
        generation,
        snapshot.transcript.fingerprint,
      )
    } finally {
      if (generation === loadWorkspaceGenerationRef.current) {
        setIsAnalysisFetching(false)
      }
    }
  }, [clearQaWorkspace, historyController, publishTranscript, restoreQaConversation, transcriptController])

  const loadSavedAnalysisForContext = useCallback(async (
    context: ActiveVideoContext,
    generation: number,
  ) => {
    if (!context.contentKey || !context.videoId || !context.platform) return
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
        isCurrent: () => generation === loadWorkspaceGenerationRef.current,
      })
      if (result.kind === "stale" || generation !== loadWorkspaceGenerationRef.current) return
      const { snapshot } = result
      publishTranscript({
        cues: snapshot.transcript.cues,
        identity: snapshot.transcript.identity,
        title: snapshot.transcript.title,
        fingerprint: snapshot.transcript.fingerprint,
        rawVtt: snapshot.transcript.rawVtt,
      })
      if (!snapshot.analysis) {
        setAnalysisView(null)
        setAnalysisPhase("idle")
        clearQaWorkspace()
        return
      }
      setAnalysisView({
        ...snapshot.analysis,
      })
      setAnalysisPhase("completed")
      await restoreQaConversation(
        snapshot.analysis.contentKey,
        snapshot.analysis.analysisRunId,
        generation,
        snapshot.transcript.fingerprint,
      )
    } finally {
      if (generation === loadWorkspaceGenerationRef.current) setIsAnalysisFetching(false)
    }
  }, [clearQaWorkspace, historyController, publishTranscript, restoreQaConversation])

  const loadSavedAnalysisRun = useCallback(async (analysisRunId: string, generation: number) => {
    setIsAnalysisFetching(true)
    try {
      const result = await historyController.loadSavedRunRestore({
        analysisRunId,
        isCurrent: () => generation === loadWorkspaceGenerationRef.current,
      })
      if (result.kind === "stale" || generation !== loadWorkspaceGenerationRef.current) return
      const { snapshot } = result

      publishTranscript({
        cues: snapshot.transcript.cues,
        identity: snapshot.transcript.identity,
        title: snapshot.transcript.title,
        fingerprint: snapshot.transcript.fingerprint,
        rawVtt: snapshot.transcript.rawVtt,
      })
      transcriptController.setError(null)

      setAnalysisView({
        ...snapshot.analysis!,
      })
      setAnalysisPhase("completed")
      await restoreQaConversation(
        snapshot.analysis!.contentKey,
        snapshot.analysis!.analysisRunId,
        generation,
        snapshot.transcript.fingerprint,
      )
    } finally {
      if (generation === loadWorkspaceGenerationRef.current) setIsAnalysisFetching(false)
    }
  }, [historyController, publishTranscript, restoreQaConversation, transcriptController])

  const loadWorkspace = useCallback(async () => {
    const generation = ++loadWorkspaceGenerationRef.current
    setIsBootstrapping(true)
    try {
      const [providerConfigs, recent] = await Promise.all([
        settingsStorage.getProviderConfigs(),
        historyController.listRecentAnalyses(10),
      ])
      if (generation !== loadWorkspaceGenerationRef.current) return

      setProvider(providerConfigs.find((item) => item.isDefault) ?? null)
      setRecentItems(recent)

      if (videoContext.platform && videoContext.videoId && videoContext.contentKey) {
        await loadSavedAnalysisForContext(videoContext, generation)
      }
    } finally {
      if (generation === loadWorkspaceGenerationRef.current) {
        setIsBootstrapping(false)
      }
    }
  }, [historyController, loadSavedAnalysisForContext, videoContext.contentKey, videoContext.platform, videoContext.videoId, videoContext.title, videoContext.partId])

  useEffect(() => {
    loadWorkspaceGenerationRef.current += 1
    qaLoadGenerationRef.current += 1
    transcriptController.invalidateLoadEpoch()
    askGenerationRef.current += 1

    setAnalysisView(null)
    setAnalysisError(null)
    setAnalysisPhase("idle")
    resetTranscript()
    setAskQuestion("")
    clearQaWorkspace()
    setAskError(null)
    setIsAnalysisFetching(false)
  }, [clearQaWorkspace, resetTranscript, transcriptController, videoContext.contentKey])

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
        askGenerationRef.current += 1
        clearQaWorkspace()
        setAskQuestion("")
        setAskAnswer(null)
        setAskError(null)
      },
      onPublished: (snapshot) => {
        currentTranscriptFingerprintRef.current = snapshot.fingerprint
      },
    })
  }, [clearQaWorkspace, transcriptController])

  const handleLoadTranscript = useCallback(async () => {
    try {
      await loadTranscriptForCurrent(true)
      toast.success(t("toast.transcriptLoaded"))
    } catch (error) {
      if (error instanceof StaleTranscriptError) return
      toast.error(error instanceof Error ? error.message : t("toast.unknownTranscriptError"))
    }
  }, [loadTranscriptForCurrent])

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

  const handleAnalyze = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
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

    askGenerationRef.current += 1
    qaLoadGenerationRef.current += 1
    clearQaWorkspace()
    const requestedProvider = provider
    const executionPolicy = getAnalysisTaskExecutionPolicy(force)
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
    }
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
          taskPromise = analysisTaskController.start(taskSnapshot, async ({ taskId, signal, setPhase }) => {
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
          if (shouldPublishAnalysisToWorkspace(videoContextRef.current.contentKey, task.snapshot.contentKey)) {
            publishTranscript({
              cues: publication.cues,
              identity: publication.identity,
              title: publication.title,
              fingerprint: transcriptFingerprint,
              rawVtt: publication.rawVtt,
            })
          }

          setPhase("analyzing")
          const resolvedProvider = await settingsStorage.resolveProvider(requestedProvider.id)
          ensureTaskCurrent()
          const cacheKey = await computeAnalysisCacheKey({
            contentKey: task.snapshot.contentKey,
            transcriptFingerprint,
            providerProfileId: task.snapshot.providerProfileId,
            baseUrl: task.snapshot.providerBaseUrl,
            model: task.snapshot.providerModel,
          })
          const transcriptCapturedAt = new Date().toISOString()
          await transcriptController.saveTaskCache({
            sourceVideo,
            transcript,
            taskContentKey: task.snapshot.contentKey,
            fingerprint: transcriptFingerprint,
            now: transcriptCapturedAt,
          })

          if (!executionPolicy.bypassAnalysisCache) {
            const cached = await historyRepository.getAnalysisCache(cacheKey)
            if (cached?.analysis && isExactCurrentAnalysis({
              contentKey: cached.contentKey,
              transcriptFingerprint: cached.transcriptFingerprint,
              providerProfileId: cached.providerProfileId,
              baseUrl: cached.providerBaseUrl,
              model: cached.providerModel,
              analysisSchemaVersion: cached.analysisSchemaVersion,
              analysisPromptVersion: cached.analysisPromptVersion,
            }, {
              contentKey: task.snapshot.contentKey,
              transcriptFingerprint,
              providerProfileId: task.snapshot.providerProfileId,
              baseUrl: task.snapshot.providerBaseUrl,
              model: task.snapshot.providerModel,
              analysisSchemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
              analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
            })) {
              ensureTaskCurrent()
              if (shouldPublishAnalysisToWorkspace(videoContextRef.current.contentKey, task.snapshot.contentKey)) {
                setAnalysisView({
                  platform: sourceVideo.platform,
                  videoId: sourceVideo.videoId,
                  partId: sourceVideo.partId ?? null,
                  contentKey: sourceVideo.contentKey,
                  title: sourceVideo.title,
                  analysis: cached.analysis,
                  analysisRunId: cached.analysisRunId,
                  transcriptFingerprint,
                  providerProfileId: cached.providerProfileId ?? null,
                  providerBaseUrl: cached.providerBaseUrl ?? null,
                  providerModel: cached.providerModel ?? null,
                  analysisSchemaVersion: cached.analysisSchemaVersion ?? null,
                  analysisPromptVersion: cached.analysisPromptVersion ?? null,
                  lastAnalyzedAt: cached.updatedAt,
                  errorMessage: null,
                })
                setAnalysisPhase("completed")
                await restoreQaConversation(sourceVideo.contentKey, cached.analysisRunId, loadWorkspaceGenerationRef.current, transcriptFingerprint)
              }
              await refreshRecentAnalyses()
              toast.success(t("toast.loadedCached", { title: sourceVideo.title }))
              return
            }
          }

          const completed = await runAnalysis({
            provider: {
              baseUrl: task.snapshot.providerBaseUrl,
              apiKey: resolvedProvider.apiKey,
              model: task.snapshot.providerModel,
              generationTimeoutSec: task.snapshot.generationTimeoutSec,
            },
            transcript: {
              videoId: sourceVideo.videoId,
              title: sourceVideo.title,
              cues: transcript.segments,
              durationSec: sourceVideo.durationSec,
            },
            signal,
          })
          ensureTaskCurrent()
          setPhase("finalizing")
          const { completedAt, taskStartedAt } = captureAnalysisCompletionTimes(task.snapshot.startedAt)

          const analysisRunId = crypto.randomUUID()
          const transcriptSnapshotId = crypto.randomUUID()
          await persistIfSupportedPlatform(sourceVideo, async () => {
            await historyRepository.saveVideoRecord({
              contentKey: task.snapshot.contentKey,
              platform: task.snapshot.platform,
              videoId: task.snapshot.videoId,
              partId: task.snapshot.partId,
              title: sourceVideo.title,
              channelTitle: sourceVideo.author,
              thumbnailUrl: sourceVideo.thumbnailUrl ?? null,
              canonicalUrl: sourceVideo.canonicalUrl || null,
              durationSec: sourceVideo.durationSec ?? null,
              openedAt: taskStartedAt,
              updatedAt: completedAt,
              analyzedAt: completedAt,
            })
            await historyRepository.saveTranscriptSnapshot({
              id: transcriptSnapshotId,
              videoId: task.snapshot.videoId,
              platform: task.snapshot.platform,
              contentKey: task.snapshot.contentKey,
              partId: task.snapshot.partId,
              language: transcript.language ?? null,
              sourceUrl: transcript.raw?.sourceUrl ?? null,
              rawVtt: transcript.raw?.text ?? null,
              cues: transcript.segments,
              createdAt: transcriptCapturedAt,
              updatedAt: transcriptCapturedAt,
            })
            await historyRepository.saveAnalysisRun({
              analysisRun: {
                id: analysisRunId,
                videoId: task.snapshot.videoId,
                platform: task.snapshot.platform,
                contentKey: task.snapshot.contentKey,
                partId: task.snapshot.partId,
                transcriptSnapshotId,
                providerConfigId: task.snapshot.providerProfileId,
                transcriptFingerprint,
                analysisSchemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
                analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
                analysisCacheKey: cacheKey,
                providerProfileId: task.snapshot.providerProfileId,
                providerBaseUrl: task.snapshot.providerBaseUrl,
                providerModel: task.snapshot.providerModel,
                status: "completed",
                summary: completed.analysis.summary,
                keyPoints: completed.analysis.keyPoints,
                topics: [],
                errorMessage: null,
                createdAt: taskStartedAt,
                updatedAt: completedAt,
                completedAt,
              },
              segments: completed.analysis.chapters.map((chapter) => ({
                id: crypto.randomUUID(),
                analysisRunId,
                videoId: task.snapshot.videoId,
                contentKey: task.snapshot.contentKey,
                title: chapter.title,
                summary: chapter.summary,
                detail: chapter.detail,
                startSec: chapter.startSec,
                endSec: chapter.endSec,
                createdAt: taskStartedAt,
                updatedAt: completedAt,
              })),
              recentVideo: {
                videoId: task.snapshot.videoId,
                analysisRunId,
                contentKey: task.snapshot.contentKey,
                title: sourceVideo.title,
                channelTitle: sourceVideo.author,
                thumbnailUrl: sourceVideo.thumbnailUrl ?? null,
                status: "completed",
                openedAt: taskStartedAt,
                analyzedAt: completedAt,
                updatedAt: completedAt,
              },
            })
            await historyRepository.saveAnalysisCache({
              cacheKey,
              contentKey: task.snapshot.contentKey,
              platform: task.snapshot.platform,
              videoId: task.snapshot.videoId,
              partId: task.snapshot.partId,
              transcriptFingerprint,
              analysisSchemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
              analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
              providerProfileId: task.snapshot.providerProfileId,
              providerBaseUrl: task.snapshot.providerBaseUrl,
              providerModel: task.snapshot.providerModel,
              analysisRunId,
              analysis: completed.analysis,
              createdAt: taskStartedAt,
              updatedAt: completedAt,
            })
          })
          await refreshRecentAnalyses()
          if (shouldPublishAnalysisToWorkspace(videoContextRef.current.contentKey, task.snapshot.contentKey)) {
            setAnalysisView({
              platform: task.snapshot.platform,
              videoId: task.snapshot.videoId,
              partId: task.snapshot.partId,
              contentKey: task.snapshot.contentKey,
              title: sourceVideo.title,
              analysis: completed.analysis,
              analysisRunId,
              transcriptFingerprint,
              providerProfileId: task.snapshot.providerProfileId,
              providerBaseUrl: task.snapshot.providerBaseUrl,
              providerModel: task.snapshot.providerModel,
              analysisSchemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
              analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
              lastAnalyzedAt: completedAt,
              errorMessage: null,
            })
            setAnalysisPhase("completed")
            await restoreQaConversation(task.snapshot.contentKey, analysisRunId, loadWorkspaceGenerationRef.current, transcriptFingerprint)
          }
          toast.success(t("toast.analysisCompleted", { title: sourceVideo.title }))
          }, { taskId })
        })
        await taskPromise
      } catch (error) {
        const isAbort = error instanceof AnalysisAbortedError
          || (error instanceof DOMException && error.name === "AbortError")
        const isWorkspaceCurrent = videoContextRef.current.contentKey === taskSnapshot.contentKey
        if (isAbort) {
          if (isWorkspaceCurrent) {
            setAnalysisError(null)
            setAnalysisPhase("cancelled")
          }
          toast.message(t("toast.analysisCancelled"))
          return
        }
        const message = error instanceof StaleTranscriptError
          || (error instanceof Error && error.message.includes("video part changed while captions were loading"))
          ? "Source video changed before its transcript could be captured."
          : error instanceof Error ? error.message : t("toast.unknownAnalysisError")
        if (isWorkspaceCurrent) {
          setAnalysisError(message)
          setAnalysisPhase("error")
          setAnalysisView((current) => current ? { ...current, errorMessage: message } : null)
        }
        toast.error(message)
      } finally {
        admission?.release()
      }
    }

    void runTask()
  }, [activeAnalysisTask, activeTabId, analysisTaskController, clearQaWorkspace, loadTranscriptForTask, provider, publishTranscript, refreshRecentAnalyses, restoreQaConversation, t, transcriptController, videoContext])

  const handleCancelAnalysis = useCallback(() => {
    analysisTaskController.cancel()
  }, [analysisTaskController])

  const handleOpenSavedAnalysis = useCallback(async (
    videoId: string,
    contentKey?: string,
    analysisRunId?: string,
  ) => {
    askGenerationRef.current += 1
    transcriptController.invalidateLoadEpoch()
    setAskQuestion("")
    setAskAnswer(null)
    setAskError(null)
    setAnalysisError(null)
    const generation = ++loadWorkspaceGenerationRef.current
    if (analysisRunId) {
      await loadSavedAnalysisRun(analysisRunId, generation)
    } else if (contentKey) {
      const current = videoContextRef.current
      await loadSavedAnalysisForContext({
        ...current,
        videoId,
        contentKey,
        platform: contentKey.startsWith("bilibili:") ? "bilibili" : "youtube",
        partId: contentKey.startsWith("bilibili:") ? contentKey.split(":p:")[1] ?? null : null,
      }, generation)
    } else {
      await loadSavedAnalysis(videoId, generation)
    }
    toast.success(t("toast.loadedHistory"))
  }, [loadSavedAnalysis, loadSavedAnalysisForContext, loadSavedAnalysisRun, transcriptController])

  const hasActiveTaskForContent = useCallback((contentKey?: string) => {
    if (!contentKey) return false
    return activeAnalysisTask?.snapshot.contentKey === contentKey
      || activeAskTask?.snapshot.contentKey === contentKey
  }, [activeAnalysisTask, activeAskTask])

  const handleDeleteAnalysis = useCallback(async (item: RecentAnalysisListItem) => {
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
  }, [applyMutation, hasActiveTaskForContent, historyController, t])

  const handleDeleteVideo = useCallback(async (item: RecentAnalysisListItem) => {
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
  }, [applyMutation, hasActiveTaskForContent, historyController, t])

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
    if (askStartLockRef.current || activeAskTask) {
      toast.message(t("toast.anotherAsk"))
      return
    }
    if (!analysisView || !provider) return
    const preflightAskGeneration = askGenerationRef.current
    if (isTranscriptLoading || isAnalysisFetching || isAnalysisBusy) {
      const message = t("toast.transcriptStillLoading")
      setAskError(message)
      toast.error(message)
      return
    }
    const requestedTranscriptLoadGeneration = transcriptController.captureLoadEpoch()
    const requestIdentity = await resolveAskTranscriptRequestIdentity({
      analysisFingerprint: analysisView.transcriptFingerprint,
      currentFingerprint: currentTranscriptFingerprintRef.current,
      transcriptCues,
      contentMatches: transcriptIdentity?.contentKey === analysisView.contentKey,
    })
    if (!transcriptController.isLoadEpochCurrent(requestedTranscriptLoadGeneration)) {
      const message = t("toast.transcriptChangedWhileLoading")
      setAskError(message)
      toast.error(message)
      return
    }
    if (askGenerationRef.current !== preflightAskGeneration) return
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
    const requestedThreadId = qaThreadId ?? activeQaThreadIdRef.current
    const generation = ++askGenerationRef.current
    let requestThreadId = requestedThreadId
    const isCurrentAsk = () => (
      askGenerationRef.current === generation
      && matchesAskRequestWorkspaceIdentity({
        contentKey: requestedContentKey,
        analysisRunId: requestedAnalysisRunId,
        threadId: requestThreadId,
        transcriptFingerprint: requestedTranscriptFingerprint,
      }, {
        contentKey: activeAnalysisContentKeyRef.current,
        analysisRunId: activeAnalysisRunIdRef.current,
        threadId: activeQaThreadIdRef.current,
        transcriptFingerprint: currentTranscriptFingerprintRef.current,
      })
      && transcriptController.isLoadEpochCurrent(requestedTranscriptLoadGeneration)
    )

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
        activeQaThreadIdRef.current = thread.id
        setQaThreadId(thread.id)
        setQaThreads((current) => [thread, ...current.filter((item) => item.id !== thread.id)])
      }
      if (!isCurrentAsk()) return

      const threadProviderProfileId = thread.providerProfileId
      const threadProviderBaseUrl = thread.providerBaseUrl
      const threadProviderModel = thread.providerModel
      const threadTranscriptFingerprint = thread.transcriptFingerprint
      const previousMessages = await qaConversationRepository.listQaMessages(thread.id)
      const conversationHistory = boundQaConversationContext(previousMessages.map((message) => ({
        role: message.role,
        content: message.content,
      })))
      const userMessage = await qaConversationRepository.appendQaMessage({
        threadId: thread.id,
        role: "user",
        content: submittedQuestion,
      })
      setAskQuestion("")
      if (isCurrentAsk()) {
        setQaMessages((current) => [...current.filter((message) => message.id !== userMessage.id), userMessage])
      }
      const conversationContextFingerprint = await computeBoundedConversationContextFingerprint(conversationHistory)
      const qaCacheKey = await computeQaCacheKey({
        contentKey: requestedContentKey,
        transcriptFingerprint: threadTranscriptFingerprint,
        analysisRunId: thread.analysisRunId,
        providerProfileId: threadProviderProfileId,
        baseUrl: threadProviderBaseUrl,
        model: threadProviderModel,
        question: submittedQuestion,
        conversationContextFingerprint,
      })
      const taskThread = thread
      const taskAnalysis = analysisView
      const taskTranscriptCues = [...transcriptCues]
      const taskConversationHistory = [...conversationHistory]
      const taskSnapshot = {
        contentKey: requestedContentKey,
        analysisRunId: requestedAnalysisRunId,
        transcriptFingerprint: threadTranscriptFingerprint,
        threadId: taskThread.id,
        platform: taskAnalysis.platform,
        videoId: taskAnalysis.videoId,
        partId: taskAnalysis.partId,
        videoTitle: taskAnalysis.title,
        question: submittedQuestion,
        providerProfileId: threadProviderProfileId,
        providerBaseUrl: threadProviderBaseUrl,
        providerModel: threadProviderModel,
        generationTimeoutSec: frozenProviderRequest.generationTimeoutSec ?? 600,
      }
      const taskPromise = askTaskController.start(taskSnapshot, async ({ taskId, signal, setPhase }) => {
        askSignal = signal
        const ensureTaskActive = () => {
          if (!askTaskController.isCurrent(taskId)) throw new Error("Ask Video task is no longer active.")
          if (signal.aborted) throw new DOMException("The Ask Video request was cancelled.", "AbortError")
        }
        ensureTaskActive()
        const cachedAnswer = await historyRepository.getQaAnswer(qaCacheKey)
        ensureTaskActive()
        let answer: AskVideoAnswer
        if (cachedAnswer) {
          answer = cachedAnswer.answer
        } else {
          const result = await askVideo({
            provider: { ...frozenProviderRequest },
            question: taskSnapshot.question,
            transcript: {
              videoId: taskSnapshot.videoId,
              title: taskSnapshot.videoTitle,
              cues: taskTranscriptCues,
            },
            analysis: taskAnalysis.analysis,
            conversationHistory: taskConversationHistory,
            signal,
            onRepairStart: () => setPhase("repairing"),
          })
          answer = result.answer
        }
        ensureTaskActive()
        setPhase("finalizing")
        if (!cachedAnswer) {
          const now = new Date().toISOString()
          await historyRepository.saveQaAnswer({
            cacheKey: qaCacheKey,
            contentKey: taskSnapshot.contentKey,
            transcriptFingerprint: taskSnapshot.transcriptFingerprint,
            analysisRunId: taskSnapshot.analysisRunId,
            providerProfileId: taskSnapshot.providerProfileId,
            providerBaseUrl: taskSnapshot.providerBaseUrl,
            providerModel: taskSnapshot.providerModel,
            question: taskSnapshot.question,
            schemaVersion: VIDEO_QA_SCHEMA_VERSION,
            promptVersion: VIDEO_QA_PROMPT_VERSION,
            answer,
            createdAt: now,
            updatedAt: now,
          })
        }
        const assistantMessage = await qaConversationRepository.appendQaMessage({
          threadId: taskSnapshot.threadId,
          role: "assistant",
          content: answer.answer,
          citations: answer.citations,
          suggestedJumps: answer.suggestedJumps,
          followUps: answer.followUps,
        })
        const isWorkspaceCurrent = matchesAskRequestWorkspaceIdentity({
          contentKey: taskSnapshot.contentKey,
          analysisRunId: taskSnapshot.analysisRunId,
          threadId: taskSnapshot.threadId,
          transcriptFingerprint: taskSnapshot.transcriptFingerprint,
        }, {
          contentKey: activeAnalysisContentKeyRef.current,
          analysisRunId: activeAnalysisRunIdRef.current,
          threadId: activeQaThreadIdRef.current,
          transcriptFingerprint: currentTranscriptFingerprintRef.current,
        })
        if (isWorkspaceCurrent) {
          setQaMessages((current) => [...current, assistantMessage])
          setAskAnswer(answer)
        }
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
  }, [activeAskTask, analysisView, askQuestion, askTaskController, isAnalysisBusy, isAnalysisFetching, isTranscriptLoading, provider, qaThreadId, setTranscriptFingerprint, t, transcriptController, transcriptCues, transcriptIdentity])

  const handleCancelAsk = useCallback(() => {
    askTaskController.cancel()
  }, [askTaskController])

  const handleNewQaChat = useCallback(() => {
    if (isAsking) return
    askGenerationRef.current += 1
    qaLoadGenerationRef.current += 1
    activeQaThreadIdRef.current = null
    setQaThreadId(null)
    setQaMessages([])
    setAskAnswer(null)
    setAskQuestion("")
    setAskError(null)
  }, [isAsking])

  const handleOpenQaThread = useCallback(async (threadId: string) => {
    if (isAsking || isTranscriptLoading || isAnalysisFetching || isAnalysisBusy) return
    const requestedContentKey = analysisView?.contentKey
    const requestedAnalysisRunId = analysisView?.analysisRunId ?? "legacy"
    const requestedTranscriptFingerprint = await resolveAskTranscriptFingerprint({
      currentFingerprint: currentTranscriptFingerprintRef.current,
      transcriptCues,
    })
    const requestedTranscriptLoadGeneration = transcriptController.captureLoadEpoch()
    askGenerationRef.current += 1
    const generation = ++qaLoadGenerationRef.current
    const isCurrent = () => (
      qaLoadGenerationRef.current === generation
      && transcriptController.isLoadEpochCurrent(requestedTranscriptLoadGeneration)
      && activeAnalysisContentKeyRef.current === requestedContentKey
      && activeAnalysisRunIdRef.current === requestedAnalysisRunId
      && currentTranscriptFingerprintRef.current === requestedTranscriptFingerprint
    )
    const result = await askController.openThread({
      threadId,
      contentKey: requestedContentKey,
      analysisRunId: requestedAnalysisRunId,
      transcriptFingerprint: requestedTranscriptFingerprint,
      isCurrent,
    })
    if (result.kind !== "ready" || !isCurrent()) return
    activeQaThreadIdRef.current = threadId
    setQaThreadId(threadId)
    setQaMessages(result.thread.messages)
    setAskQuestion("")
    setAskAnswer(result.thread.answer)
  }, [analysisView, askController, isAnalysisBusy, isAnalysisFetching, isAsking, isTranscriptLoading, transcriptController, transcriptCues])

  const handleDeleteQaThread = useCallback(async (threadId: string) => {
    if (isAsking) return
    await askController.deleteThread({ threadId })
    setQaThreads((current) => current.filter((thread) => thread.id !== threadId))
    if (qaThreadId === threadId || activeQaThreadIdRef.current === threadId) handleNewQaChat()
  }, [askController, handleNewQaChat, isAsking, qaThreadId])

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
        return
      case "jumped-active":
        toast.success(t("runtime.jumpedActive", { timestamp: formatTimestamp(timestampSeconds) }))
        return
      case "opened-new-tab":
        toast.success(t("runtime.openedVideoAt", { timestamp: formatTimestamp(timestampSeconds) }))
        return
      case "runtime-failure":
        toast.error(outcome.error)
    }
  }, [jumpToTimestamp, t])

  const handleAnalysisJump = useCallback((timestampSeconds: number) => {
    const identity = analysisView
      ? identityFromAnalysis(analysisView)
      : identityFromContext(videoContextRef.current)
    return jumpWithIdentity(identity, timestampSeconds)
  }, [analysisView, jumpWithIdentity])

  const handleTranscriptJump = useCallback((timestampSeconds: number) => (
    jumpWithIdentity(transcriptIdentity, timestampSeconds)
  ), [jumpWithIdentity, transcriptIdentity])

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

  return (
    <main className="min-h-screen min-w-0 overflow-x-hidden bg-background px-3 py-3 text-foreground sm:px-4">
      <SidePanelShell
        activeTab={activeTab}
        onTabChange={setActiveTab}
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
              && provider
              && !activeAnalysisTask
              && !isAnalysisBusy
              && !isTranscriptLoading
              && !isAnalysisFetching,
            )}
            lastAnalyzedAt={analysisView?.lastAnalyzedAt
              ? new Date(analysisView.lastAnalyzedAt).toLocaleString(locale)
              : null}
            recentItems={recentItems}
            isHistoryLoading={isBootstrapping}
            activeVideoId={analysisView?.videoId ?? videoContext.videoId}
            activeAnalysisRunId={analysisView?.analysisRunId}
            onAnalyze={handleAnalyze}
            onCancel={handleCancelAnalysis}
            onConfigureProvider={() => setActiveTab("settings")}
            onJump={handleAnalysisJump}
            onSelectHistory={handleOpenSavedAnalysis}
            onDeleteAnalysis={handleDeleteAnalysis}
            onDeleteVideo={handleDeleteVideo}
            onOpenFullHistory={() => {
              const url = chrome.runtime.getURL("options.html#history")
              void chrome.tabs.create({ url })
            }}
            formatTimestamp={formatTimestamp}
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
