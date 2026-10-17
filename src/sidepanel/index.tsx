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
import { persistedLegacyAnalysisToVideoAnalysis } from "@/features/analysis/lib/analysis-compat"
import { AnalysisAbortedError, runAnalysis } from "@/features/analysis/lib/run-analysis"
import type { RecentAnalysisListItem } from "@/features/history/components/recent-analysis-list"
import {
  PENDING_HISTORY_OPEN_KEY,
  isPendingHistoryOpenPayload,
} from "@/features/history/lib/pending-history-open"
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
  computeTranscriptFingerprint,
  isExactCurrentAnalysis,
  TRANSCRIPT_FINGERPRINT_VERSION,
  VIDEO_QA_PROMPT_VERSION,
  VIDEO_QA_SCHEMA_VERSION,
} from "@/lib/persistence/cache-identity"
import {
  VIDEO_ANALYSIS_PROMPT_VERSION,
  VIDEO_ANALYSIS_SCHEMA_VERSION,
} from "@/features/analysis/lib/analysis-schema"
import {
  persistIfSupportedPlatform,
  projectPersistedVideoIdentity,
} from "@/features/platform/persistence-compat"
import type {
  ActiveVideoContext,
  TranscriptSegment,
  VideoIdentity,
} from "@/features/platform/types"
import {
  settingsStorage,
  type ResolvedProvider,
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
  resolveCurrentTranscript,
  type CurrentTranscriptResult,
} from "@/sidepanel/lib/load-current-transcript"
import {
  INITIAL_SIDE_PANEL_TAB,
  getAnalysisStatusLabel,
  type AnalysisPhase,
  type SidePanelTab,
} from "@/sidepanel/lib/sidepanel-ux"
import {
  getFrozenQaProviderRequest,
  matchesQaThreadIdentity,
} from "@/sidepanel/lib/ask-conversation-identity"
import {
  compareAskTranscriptIdentity,
  filterQaThreadsByTranscript,
  matchesAskRequestWorkspaceIdentity,
  resolveAskTranscriptRequestIdentity,
  resolveAskTranscriptFingerprint,
} from "@/sidepanel/lib/ask-transcript-identity"
import type { QaMessageEntity, QaThreadEntity } from "@/lib/schemas/persistence"
import { applySidepanelDataMutation } from "@/sidepanel/lib/apply-data-mutation"

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

type HistoryEntry = {
  recentVideo: {
    videoId: string
    analysisRunId?: string
    contentKey?: string
    platform?: "youtube" | "bilibili"
    partId?: string | null
    title: string
    channelTitle: string | null
    status: string | null
    updatedAt: string
  }
  analysis: { summary: string } | null
}

function formatTimestamp(timestampSeconds: number) {
  const totalSeconds = Math.round(timestampSeconds)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

function identityFromContext(context: ActiveVideoContext): VideoIdentity | null {
  if (!context.platform || !context.videoId || !context.contentKey) return null
  return {
    platform: context.platform,
    videoId: context.videoId,
    contentKey: context.contentKey,
    ...(context.partId ? { partId: context.partId } : {}),
  }
}

function identityFromAnalysis(view: AnalysisView): VideoIdentity {
  return {
    platform: view.platform,
    videoId: view.videoId,
    contentKey: view.contentKey,
    ...(view.partId ? { partId: view.partId } : {}),
  }
}

function SidepanelWorkspace() {
  const { activeTabId, jumpToTimestamp, refreshCurrentVideo, status, videoContext } = useRuntimeBridge()
  const videoContextRef = useRef(videoContext)
  videoContextRef.current = videoContext

  const [activeTab, setActiveTab] = useState<SidePanelTab>(INITIAL_SIDE_PANEL_TAB)
  const [provider, setProvider] = useState<ProviderConfigRecord | null>(null)
  const [analysisView, setAnalysisView] = useState<AnalysisView | null>(null)
  const [recentItems, setRecentItems] = useState<RecentAnalysisListItem[]>([])
  const [transcriptCues, setTranscriptCues] = useState<TranscriptSegment[]>([])
  const [transcriptIdentity, setTranscriptIdentity] = useState<VideoIdentity | null>(null)
  const [transcriptTitle, setTranscriptTitle] = useState<string | null>(null)
  const [currentTranscriptFingerprint, setCurrentTranscriptFingerprint] = useState<string | null>(null)
  const [rawVtt, setRawVtt] = useState<string | null>(null)
  const [transcriptError, setTranscriptError] = useState<string | null>(null)
  const [isTranscriptLoading, setIsTranscriptLoading] = useState(false)
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
  const [activeAnalysisTask, setActiveAnalysisTask] = useState<ActiveAnalysisTask | null>(
    analysisTaskController.getSnapshot(),
  )
  const [activeAskTask, setActiveAskTask] = useState<ActiveAskTask | null>(
    askTaskController.getSnapshot(),
  )
  const transcriptLoadGenerationRef = useRef(0)
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
  currentTranscriptFingerprintRef.current = currentTranscriptFingerprint
  activeQaThreadIdRef.current = qaThreadId
  destructiveWorkspaceRef.current = {
    analysisRunId: analysisView?.analysisRunId ?? null,
    analysisContentKey: analysisView?.contentKey ?? null,
    hasPersistedAnalysis: Boolean(analysisView),
    transcriptContentKey: transcriptIdentity?.contentKey ?? null,
    videoContextContentKey: videoContext.contentKey,
  }

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
    if (!analysisRunId) {
      if (generation === loadWorkspaceGenerationRef.current) clearQaWorkspace()
      return
    }
    const threads = filterQaThreadsByTranscript(
      await qaConversationRepository.listQaThreadsForVideo(contentKey, analysisRunId),
      transcriptFingerprint ?? null,
    )
    const current = threads[0] ?? null
    const messages = current ? await qaConversationRepository.listQaMessages(current.id) : []
    if (generation !== loadWorkspaceGenerationRef.current) return
    setQaThreads(threads)
    activeQaThreadIdRef.current = current?.id ?? null
    setQaThreadId(current?.id ?? null)
    setQaMessages(messages)
    const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant")
    setAskAnswer(latestAssistant?.citations ? {
      answer: latestAssistant.content,
      citations: latestAssistant.citations.map((citation) => ({
        text: citation.text,
        startSec: citation.startSec,
        endSec: citation.endSec ?? citation.startSec,
      })),
      followUps: latestAssistant.followUps ?? [],
      suggestedJumps: latestAssistant.suggestedJumps ?? [],
    } : null)
  }, [clearQaWorkspace])

  useEffect(() => analysisTaskController.subscribe(() => {
    setActiveAnalysisTask(analysisTaskController.getSnapshot())
  }), [analysisTaskController])

  useEffect(() => askTaskController.subscribe(() => {
    setActiveAskTask(askTaskController.getSnapshot())
  }), [askTaskController])

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
    const recent = await historyRepository.listRecentAnalyses(10) as HistoryEntry[]
    setRecentItems(
      recent
        .filter((entry) => Boolean(entry.analysis))
        .map((entry) => ({
          videoId: entry.recentVideo.videoId,
          analysisRunId: entry.recentVideo.analysisRunId,
          contentKey: entry.recentVideo.contentKey,
          platform: entry.recentVideo.platform,
          partId: entry.recentVideo.partId,
          title: entry.recentVideo.title,
          channelTitle: entry.recentVideo.channelTitle,
          status: entry.recentVideo.status,
          updatedAt: entry.recentVideo.updatedAt,
        })),
    )
  }, [])

  const applyMutation = useCallback(async (mutation: Parameters<typeof applySidepanelDataMutation>[0]) => {
    await applySidepanelDataMutation(mutation, destructiveWorkspaceRef.current, {
      invalidateWorkspace: (clearTranscript) => {
        loadWorkspaceGenerationRef.current += 1
        qaLoadGenerationRef.current += 1
        askGenerationRef.current += 1
        if (clearTranscript) transcriptLoadGenerationRef.current += 1
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
        currentTranscriptFingerprintRef.current = null
        setTranscriptCues([])
        setTranscriptIdentity(null)
        setTranscriptTitle(null)
        setCurrentTranscriptFingerprint(null)
        setRawVtt(null)
        setTranscriptError(null)
        setIsTranscriptLoading(false)
      },
      refreshRecentAnalyses,
      refreshProvider: async () => {
        const providerConfigs = await settingsStorage.getProviderConfigs()
        setProvider(providerConfigs.find((item) => item.isDefault) ?? null)
      },
    })
  }, [clearQaWorkspace, refreshRecentAnalyses])

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
        toast.error("Local data changed, but this Side Panel could not refresh completely.")
      }
    })
  }, [analysisTaskController, askTaskController, applyMutation])

  const loadSavedAnalysis = useCallback(async (videoId: string, generation: number) => {
    setIsAnalysisFetching(true)
    try {
      const [analysis, latestTranscriptSnapshot, recent] = await Promise.all([
        historyRepository.getCurrentAnalysisByVideoId(videoId),
        historyRepository.getLatestTranscriptSnapshotByVideoId(videoId),
        historyRepository.listRecentAnalyses(25) as Promise<HistoryEntry[]>,
      ])

      if (generation !== loadWorkspaceGenerationRef.current) return

      const identity = projectPersistedVideoIdentity(videoId)
      const loadedTranscriptFingerprint = await resolveAskTranscriptFingerprint({
        currentFingerprint: latestTranscriptSnapshot?.fingerprint ?? null,
        transcriptCues: latestTranscriptSnapshot?.cues ?? [],
      })
      setRawVtt(latestTranscriptSnapshot?.rawVtt ?? null)
      setTranscriptCues(latestTranscriptSnapshot?.cues ?? [])
      setTranscriptIdentity(latestTranscriptSnapshot ? identity : null)
      currentTranscriptFingerprintRef.current = loadedTranscriptFingerprint
      setCurrentTranscriptFingerprint(loadedTranscriptFingerprint)
      setTranscriptTitle(
        recent.find((entry) => entry.recentVideo.videoId === videoId)?.recentVideo.title ?? videoId,
      )
      setTranscriptError(null)

      if (!analysis) {
        setAnalysisView(null)
        setAnalysisPhase("idle")
        clearQaWorkspace()
        return
      }

      const recentVideo = recent.find((entry) => entry.recentVideo.videoId === videoId)?.recentVideo
      const canonical = persistedLegacyAnalysisToVideoAnalysis(analysis, analysis.segments)
      setAnalysisView({
        platform: "youtube",
        videoId,
        partId: null,
        contentKey: identity.contentKey,
        title: recentVideo?.title ?? videoId,
        analysis: canonical,
        analysisRunId: analysis.id,
        transcriptFingerprint: analysis.transcriptFingerprint ?? null,
        providerProfileId: null,
        providerBaseUrl: null,
        providerModel: null,
        analysisSchemaVersion: null,
        analysisPromptVersion: null,
        lastAnalyzedAt: analysis.completedAt,
        errorMessage: analysis.errorMessage,
      })
      setAnalysisPhase("completed")
      await restoreQaConversation(identity.contentKey, analysis.id, generation, loadedTranscriptFingerprint)
    } finally {
      if (generation === loadWorkspaceGenerationRef.current) {
        setIsAnalysisFetching(false)
      }
    }
  }, [clearQaWorkspace, restoreQaConversation])

  const loadSavedAnalysisForContext = useCallback(async (
    context: ActiveVideoContext,
    generation: number,
  ) => {
    if (!context.contentKey || !context.videoId || !context.platform) return
    setIsAnalysisFetching(true)
    try {
      const [analysis, latestTranscript] = await Promise.all([
        historyRepository.getCurrentAnalysisByContentKey(context.contentKey),
        historyRepository.getLatestTranscriptByContentKey(context.contentKey),
      ])
      if (generation !== loadWorkspaceGenerationRef.current) return
      const loadedTranscriptFingerprint = await resolveAskTranscriptFingerprint({
        currentFingerprint: latestTranscript?.fingerprint ?? null,
        transcriptCues: latestTranscript?.cues ?? [],
      })
      setRawVtt(latestTranscript?.rawVtt ?? null)
      setTranscriptCues(latestTranscript?.cues ?? [])
      setTranscriptIdentity(latestTranscript ? {
        platform: latestTranscript.platform ?? context.platform,
        videoId: latestTranscript.videoId,
        contentKey: latestTranscript.contentKey ?? context.contentKey,
        ...(latestTranscript.partId ?? context.partId
          ? { partId: latestTranscript.partId ?? context.partId }
          : {}),
      } : null)
      currentTranscriptFingerprintRef.current = loadedTranscriptFingerprint
      setCurrentTranscriptFingerprint(loadedTranscriptFingerprint)
      setTranscriptTitle(context.title)
      if (!analysis) {
        setAnalysisView(null)
        setAnalysisPhase("idle")
        clearQaWorkspace()
        return
      }
      const canonical = persistedLegacyAnalysisToVideoAnalysis(analysis, analysis.segments)
      setAnalysisView({
        platform: context.platform,
        videoId: context.videoId,
        partId: context.partId,
        contentKey: context.contentKey,
        title: context.title ?? context.videoId,
        analysis: canonical,
        analysisRunId: analysis.id ?? null,
        transcriptFingerprint: analysis.transcriptFingerprint ?? null,
        providerProfileId: analysis.providerProfileId ?? null,
        providerBaseUrl: analysis.providerBaseUrl ?? null,
        providerModel: analysis.providerModel ?? null,
        analysisSchemaVersion: analysis.analysisSchemaVersion ?? null,
        analysisPromptVersion: analysis.analysisPromptVersion ?? null,
        lastAnalyzedAt: analysis.completedAt,
        errorMessage: analysis.errorMessage,
      })
      setAnalysisPhase("completed")
      await restoreQaConversation(context.contentKey, analysis.id, generation, loadedTranscriptFingerprint)
    } finally {
      if (generation === loadWorkspaceGenerationRef.current) setIsAnalysisFetching(false)
    }
  }, [clearQaWorkspace, restoreQaConversation])

  const loadSavedAnalysisRun = useCallback(async (analysisRunId: string, generation: number) => {
    setIsAnalysisFetching(true)
    try {
      const aggregate = await historyRepository.getSavedAnalysisRunById(analysisRunId)
      if (!aggregate) throw new Error("Saved analysis run was not found in local history.")
      const { analysisRun, segments, transcript, videoRecord } = aggregate
      const contentKey = videoRecord?.contentKey ?? analysisRun.contentKey
      if (!contentKey) throw new Error("Saved analysis run has no persisted content identity.")
      const platform = videoRecord?.platform ?? analysisRun.platform ?? "youtube"
      const videoId = videoRecord?.videoId ?? analysisRun.videoId
      const partId = videoRecord?.partId ?? analysisRun.partId ?? null
      const title = videoRecord?.title ?? videoId
      if (generation !== loadWorkspaceGenerationRef.current) return
      const loadedTranscriptFingerprint = await resolveAskTranscriptFingerprint({
        currentFingerprint: transcript?.fingerprint ?? analysisRun.transcriptFingerprint ?? null,
        transcriptCues: transcript?.cues ?? [],
      })

      setRawVtt(transcript?.rawVtt ?? null)
      setTranscriptCues(transcript?.cues ?? [])
      setTranscriptIdentity(transcript ? {
        platform,
        videoId: transcript.videoId,
        contentKey: transcript.contentKey ?? contentKey,
        ...(transcript.partId ? { partId: transcript.partId } : partId ? { partId } : {}),
      } : null)
      currentTranscriptFingerprintRef.current = loadedTranscriptFingerprint
      setCurrentTranscriptFingerprint(loadedTranscriptFingerprint)
      setTranscriptTitle(title)
      setTranscriptError(null)

      const canonical = persistedLegacyAnalysisToVideoAnalysis(analysisRun, segments)
      setAnalysisView({
        platform,
        videoId,
        partId,
        contentKey,
        title,
        analysis: canonical,
        analysisRunId: analysisRun.id,
        transcriptFingerprint: analysisRun.transcriptFingerprint ?? null,
        providerProfileId: analysisRun.providerProfileId ?? null,
        providerBaseUrl: analysisRun.providerBaseUrl ?? null,
        providerModel: analysisRun.providerModel ?? null,
        analysisSchemaVersion: analysisRun.analysisSchemaVersion ?? null,
        analysisPromptVersion: analysisRun.analysisPromptVersion ?? null,
        lastAnalyzedAt: analysisRun.completedAt,
        errorMessage: analysisRun.errorMessage,
      })
      setAnalysisPhase("completed")
      await restoreQaConversation(contentKey, analysisRun.id, generation, loadedTranscriptFingerprint)
    } finally {
      if (generation === loadWorkspaceGenerationRef.current) setIsAnalysisFetching(false)
    }
  }, [restoreQaConversation])

  const loadWorkspace = useCallback(async () => {
    const generation = ++loadWorkspaceGenerationRef.current
    setIsBootstrapping(true)
    try {
      const [providerConfigs, recent] = await Promise.all([
        settingsStorage.getProviderConfigs(),
        historyRepository.listRecentAnalyses(10) as Promise<HistoryEntry[]>,
      ])
      if (generation !== loadWorkspaceGenerationRef.current) return

      setProvider(providerConfigs.find((item) => item.isDefault) ?? null)
      setRecentItems(
        recent
          .filter((entry) => Boolean(entry.analysis))
          .map((entry) => ({
            videoId: entry.recentVideo.videoId,
            analysisRunId: entry.recentVideo.analysisRunId,
            contentKey: entry.recentVideo.contentKey,
            platform: entry.recentVideo.platform,
            partId: entry.recentVideo.partId,
            title: entry.recentVideo.title,
            channelTitle: entry.recentVideo.channelTitle,
            status: entry.recentVideo.status,
            updatedAt: entry.recentVideo.updatedAt,
          })),
      )

      if (videoContext.platform && videoContext.videoId && videoContext.contentKey) {
        await loadSavedAnalysisForContext(videoContext, generation)
      }
    } finally {
      if (generation === loadWorkspaceGenerationRef.current) {
        setIsBootstrapping(false)
      }
    }
  }, [loadSavedAnalysisForContext, videoContext.contentKey, videoContext.platform, videoContext.videoId, videoContext.title, videoContext.partId])

  useEffect(() => {
    loadWorkspaceGenerationRef.current += 1
    qaLoadGenerationRef.current += 1
    transcriptLoadGenerationRef.current += 1
    askGenerationRef.current += 1

    setAnalysisView(null)
    setAnalysisError(null)
    setAnalysisPhase("idle")
    setTranscriptCues([])
    setTranscriptIdentity(null)
    setTranscriptTitle(null)
    currentTranscriptFingerprintRef.current = null
    setCurrentTranscriptFingerprint(null)
    setRawVtt(null)
    setTranscriptError(null)
    setIsTranscriptLoading(false)
    setAskQuestion("")
    clearQaWorkspace()
    setAskError(null)
    setIsAnalysisFetching(false)
  }, [clearQaWorkspace, videoContext.contentKey])

  useEffect(() => {
    void loadWorkspace()
  }, [loadWorkspace])

  const loadTranscriptForCurrent = useCallback(async (forceReload = false): Promise<CurrentTranscriptResult> => {
    const current = videoContextRef.current
    if (!current.isReady || !current.contentKey) {
      throw new Error("Open a supported video page before loading its transcript.")
    }

    const requestedContentKey = current.contentKey
    const generation = ++transcriptLoadGenerationRef.current
    const isCurrent = () => (
      transcriptLoadGenerationRef.current === generation
      && videoContextRef.current.contentKey === requestedContentKey
    )

    setIsTranscriptLoading(true)
    setTranscriptError(null)
    try {
      const sessionResult = transcriptIdentity?.contentKey === requestedContentKey && transcriptCues.length > 0
        ? {
            video: {
              platform: current.platform!,
              videoId: current.videoId!,
              contentKey: current.contentKey!,
              ...(current.partId ? { partId: current.partId } : {}),
              title: current.title ?? current.videoId!,
              author: current.author,
              canonicalUrl: current.canonicalUrl ?? current.url,
            },
            transcript: {
              segments: transcriptCues,
              source: "unknown" as const,
              raw: rawVtt ? { format: "vtt" as const, text: rawVtt } : undefined,
            },
          }
        : null
      const result = await resolveCurrentTranscript({
        requestedContentKey,
        isCurrent,
        forceReload,
        sessionResult,
        loadCached: async () => {
          const cached = await historyRepository.getLatestTranscriptByContentKey(requestedContentKey)
          if (!cached) return null
          const cachedVideo = {
            platform: cached.platform,
            videoId: cached.videoId,
            contentKey: cached.contentKey,
            ...(cached.partId ? { partId: cached.partId } : {}),
            title: current.title ?? cached.videoId,
            author: current.author,
            canonicalUrl: current.canonicalUrl ?? current.url,
          }
          const cachedTranscript = {
            segments: cached.cues,
            source: "unknown" as const,
            language: cached.language,
            raw: cached.rawVtt
              ? { format: "vtt" as const, text: cached.rawVtt, sourceUrl: cached.sourceUrl }
              : undefined,
          }
          return { video: cachedVideo, transcript: cachedTranscript }
        },
        loadRemote: () => loadCurrentTranscript({ requestedContentKey, isCurrent }),
      })
      if (!isCurrent()) throw new StaleTranscriptError()

      const previousFingerprint = currentTranscriptFingerprintRef.current
      const fingerprint = await resolveAskTranscriptFingerprint({
        currentFingerprint: previousFingerprint,
        transcriptCues: result.transcript.segments,
      })
      if (!isCurrent()) throw new StaleTranscriptError()
      if (previousFingerprint && previousFingerprint !== fingerprint) {
        askGenerationRef.current += 1
        clearQaWorkspace()
        setAskQuestion("")
        setAskAnswer(null)
        setAskError(null)
      }
      currentTranscriptFingerprintRef.current = fingerprint
      setCurrentTranscriptFingerprint(fingerprint)
      setTranscriptCues(result.transcript.segments)
      setRawVtt(result.transcript.raw?.text ?? null)
      setTranscriptIdentity({
        platform: result.video.platform,
        videoId: result.video.videoId,
        contentKey: result.video.contentKey,
        ...(result.video.partId ? { partId: result.video.partId } : {}),
      })
      setTranscriptTitle(result.video.title)
      const now = new Date().toISOString()
      await historyRepository.saveTranscriptCache({
        id: `transcript:${result.video.contentKey}:${fingerprint}`,
        contentKey: result.video.contentKey,
        platform: result.video.platform,
        videoId: result.video.videoId,
        partId: result.video.partId ?? null,
        fingerprint,
        fingerprintVersion: TRANSCRIPT_FINGERPRINT_VERSION,
        language: result.transcript.language ?? null,
        sourceUrl: result.transcript.raw?.sourceUrl ?? null,
        rawVtt: result.transcript.raw?.text ?? null,
        cues: result.transcript.segments,
        createdAt: now,
        updatedAt: now,
      })
      return result
    } catch (error) {
      if (isCurrent()) {
        setTranscriptError(error instanceof Error ? error.message : "Unknown transcript error.")
      }
      throw error
    } finally {
      if (isCurrent()) setIsTranscriptLoading(false)
    }
  }, [clearQaWorkspace, rawVtt, transcriptCues, transcriptIdentity])

  const handleLoadTranscript = useCallback(async () => {
    try {
      await loadTranscriptForCurrent(true)
      toast.success("Transcript loaded.")
    } catch (error) {
      if (error instanceof StaleTranscriptError) return
      toast.error(error instanceof Error ? error.message : "Unknown transcript error.")
    }
  }, [loadTranscriptForCurrent])

  const loadTranscriptForTask = useCallback(async (
    task: ActiveAnalysisTask,
    forceReloadTranscript: boolean,
  ): Promise<CurrentTranscriptResult> => {
    const { snapshot } = task
    const isCurrentTask = () => analysisTaskController.isCurrent(snapshot.taskId)
    const fallbackVideo = (cached: {
      videoId: string
      contentKey: string
      platform: "youtube" | "bilibili"
      partId: string | null
      title: string
      author: string | null
      canonicalUrl: string
    }) => ({
      platform: cached.platform,
      videoId: cached.videoId,
      contentKey: cached.contentKey,
      ...(cached.partId ? { partId: cached.partId } : {}),
      title: cached.title,
      author: cached.author,
      canonicalUrl: cached.canonicalUrl,
    })

    const sessionResult = transcriptIdentity?.contentKey === snapshot.contentKey && transcriptCues.length > 0
      ? {
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
          transcript: {
            segments: transcriptCues,
            source: "unknown" as const,
            raw: rawVtt ? { format: "vtt" as const, text: rawVtt } : undefined,
          },
        }
      : null

    const result = await resolveCurrentTranscript({
      requestedContentKey: snapshot.contentKey,
      isCurrent: isCurrentTask,
      forceReload: forceReloadTranscript,
      sessionResult,
      loadCached: async () => {
        const cached = await historyRepository.getLatestTranscriptByContentKey(snapshot.contentKey)
        if (!cached) return null
        return {
          video: fallbackVideo({
            videoId: cached.videoId,
            contentKey: cached.contentKey,
            platform: cached.platform,
            partId: cached.partId ?? snapshot.partId,
            title: snapshot.title,
            author: snapshot.author,
            canonicalUrl: snapshot.canonicalUrl
              ?? (snapshot.platform === "youtube"
                ? `https://www.youtube.com/watch?v=${snapshot.videoId}`
                : `https://www.bilibili.com/video/${snapshot.videoId}?p=${snapshot.partId ?? "1"}`),
          }),
          transcript: {
            segments: cached.cues,
            source: "unknown" as const,
            language: cached.language,
            raw: cached.rawVtt
              ? { format: "vtt" as const, text: cached.rawVtt, sourceUrl: cached.sourceUrl }
              : undefined,
          },
        }
      },
      loadRemote: () => loadCurrentTranscript({
        requestedContentKey: snapshot.contentKey,
        tabId: snapshot.sourceTabId,
        isCurrent: isCurrentTask,
      }),
    })
    if (!isCurrentTask()) throw new StaleTranscriptError()
    return result
  }, [analysisTaskController, rawVtt, transcriptCues, transcriptIdentity])

  const handleAnalyze = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    if (activeAnalysisTask) {
      toast.error("Another analysis is already running.")
      return
    }
    if (!videoContext.isReady || !videoContext.videoId || !videoContext.contentKey || activeTabId === null) {
      toast.error("Open a supported video page before analyzing.")
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

          const { video, transcript } = await loadTranscriptForTask(
            task,
            executionPolicy.forceReloadTranscript,
          )
          ensureTaskCurrent()
          const sourceVideo = {
            ...video,
            title: video.title || task.snapshot.title,
            author: video.author ?? task.snapshot.author,
            canonicalUrl: video.canonicalUrl || task.snapshot.canonicalUrl || "",
          }
          const transcriptFingerprint = await computeTranscriptFingerprint(transcript.segments)
          ensureTaskCurrent()
          if (shouldPublishAnalysisToWorkspace(videoContextRef.current.contentKey, task.snapshot.contentKey)) {
            currentTranscriptFingerprintRef.current = transcriptFingerprint
            setCurrentTranscriptFingerprint(transcriptFingerprint)
            setTranscriptCues(transcript.segments)
            setRawVtt(transcript.raw?.text ?? null)
            setTranscriptIdentity({
              platform: sourceVideo.platform,
              videoId: sourceVideo.videoId,
              contentKey: sourceVideo.contentKey,
              ...(sourceVideo.partId ? { partId: sourceVideo.partId } : {}),
            })
            setTranscriptTitle(sourceVideo.title)
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
          await historyRepository.saveTranscriptCache({
            id: `transcript:${task.snapshot.contentKey}:${transcriptFingerprint}`,
            contentKey: task.snapshot.contentKey,
            platform: sourceVideo.platform,
            videoId: sourceVideo.videoId,
            partId: sourceVideo.partId ?? null,
            fingerprint: transcriptFingerprint,
            fingerprintVersion: TRANSCRIPT_FINGERPRINT_VERSION,
            language: transcript.language ?? null,
            sourceUrl: transcript.raw?.sourceUrl ?? null,
            rawVtt: transcript.raw?.text ?? null,
            cues: transcript.segments,
            createdAt: transcriptCapturedAt,
            updatedAt: transcriptCapturedAt,
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
              toast.success(`Loaded cached analysis: ${sourceVideo.title}`)
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
          toast.success(`Analysis completed: ${sourceVideo.title}`)
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
          toast.message("Analysis cancelled.")
          return
        }
        const message = error instanceof StaleTranscriptError
          || (error instanceof Error && error.message.includes("video part changed while captions were loading"))
          ? "Source video changed before its transcript could be captured."
          : error instanceof Error ? error.message : "Unknown analysis error."
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
  }, [activeAnalysisTask, activeTabId, analysisTaskController, clearQaWorkspace, loadTranscriptForTask, provider, refreshRecentAnalyses, restoreQaConversation, videoContext])

  const handleCancelAnalysis = useCallback(() => {
    analysisTaskController.cancel()
  }, [analysisTaskController])

  const handleOpenSavedAnalysis = useCallback(async (
    videoId: string,
    contentKey?: string,
    analysisRunId?: string,
  ) => {
    askGenerationRef.current += 1
    transcriptLoadGenerationRef.current += 1
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
    toast.success("Loaded saved analysis from local history.")
  }, [loadSavedAnalysis, loadSavedAnalysisForContext, loadSavedAnalysisRun])

  const hasActiveTaskForContent = useCallback((contentKey?: string) => {
    if (!contentKey) return false
    return activeAnalysisTask?.snapshot.contentKey === contentKey
      || activeAskTask?.snapshot.contentKey === contentKey
  }, [activeAnalysisTask, activeAskTask])

  const handleDeleteAnalysis = useCallback(async (item: RecentAnalysisListItem) => {
    if (!item.analysisRunId) return
    if (hasActiveTaskForContent(item.contentKey)) {
      toast.error("Cancel the active task before deleting this analysis.")
      return
    }
    if (!window.confirm(`Delete this saved analysis?\n\n${item.title}`)) return
    try {
      await performDestructiveOperation(
        "delete-analysis-run",
        { analysisRunId: item.analysisRunId, contentKey: item.contentKey },
        () => historyRepository.deleteAnalysisRun(item.analysisRunId!),
      )
      await applyMutation({ type: "delete-analysis-run", analysisRunId: item.analysisRunId })
      toast.success("Saved analysis deleted.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete this analysis.")
    }
  }, [applyMutation, hasActiveTaskForContent])

  const handleDeleteVideo = useCallback(async (item: RecentAnalysisListItem) => {
    if (!item.contentKey) return
    if (hasActiveTaskForContent(item.contentKey)) {
      toast.error("Cancel the active task before deleting this video data.")
      return
    }
    if (!window.confirm(`Delete all local data for this video?\n\n${item.title}`)) return
    if (!window.confirm(`This removes analyses, Ask data, transcript cache, and the video record for “${item.title}”. Continue?`)) return
    try {
      await performDestructiveOperation(
        "delete-video-data",
        { contentKey: item.contentKey },
        () => historyRepository.deleteVideoData(item.contentKey!),
      )
      await applyMutation({ type: "delete-video-data", contentKey: item.contentKey })
      toast.success("All local data for this video was deleted.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete this video's data.")
    }
  }, [applyMutation, hasActiveTaskForContent])

  useEffect(() => {
    let isCurrent = true
    const consumePayload = async (rawValue: unknown) => {
      if (!isCurrent || !isPendingHistoryOpenPayload(rawValue)) return
      try {
          await handleOpenSavedAnalysis(rawValue.videoId, rawValue.contentKey, rawValue.analysisRunId)
      } finally {
        try {
          await chrome.storage?.local?.remove(PENDING_HISTORY_OPEN_KEY)
        } catch {
          // Storage may not be writable in some sandboxes; ignore.
        }
      }
    }

    void (async () => {
      try {
        const stored = await chrome.storage?.local?.get(PENDING_HISTORY_OPEN_KEY)
        await consumePayload(stored?.[PENDING_HISTORY_OPEN_KEY])
      } catch {
        // chrome.storage unavailable; nothing to drain.
      }
    })()

    const handleChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ) => {
      if (areaName !== "local") return
      const change = changes[PENDING_HISTORY_OPEN_KEY]
      if (change) void consumePayload(change.newValue)
    }
    chrome.storage?.onChanged?.addListener(handleChange)
    return () => {
      isCurrent = false
      chrome.storage?.onChanged?.removeListener(handleChange)
    }
  }, [handleOpenSavedAnalysis])

  const handleAsk = useCallback(async () => {
    if (askStartLockRef.current || activeAskTask) {
      toast.message("Another Ask Video request is already running.")
      return
    }
    if (!analysisView || !provider) return
    const preflightAskGeneration = askGenerationRef.current
    if (isTranscriptLoading || isAnalysisFetching || isAnalysisBusy) {
      const message = "Transcript is still loading. Wait before asking a question."
      setAskError(message)
      toast.error(message)
      return
    }
    const requestedTranscriptLoadGeneration = transcriptLoadGenerationRef.current
    const requestIdentity = await resolveAskTranscriptRequestIdentity({
      analysisFingerprint: analysisView.transcriptFingerprint,
      currentFingerprint: currentTranscriptFingerprintRef.current,
      transcriptCues,
      contentMatches: transcriptIdentity?.contentKey === analysisView.contentKey,
    })
    if (transcriptLoadGenerationRef.current !== requestedTranscriptLoadGeneration) {
      const message = "Transcript changed while it was loading. Try again."
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
    currentTranscriptFingerprintRef.current = actualTranscriptFingerprint
    setCurrentTranscriptFingerprint(actualTranscriptFingerprint)
    const requestedContentKey = analysisView.contentKey
    const requestedAnalysisRunId = analysisView.analysisRunId ?? "legacy"
    const requestedTranscriptFingerprint = actualTranscriptFingerprint
    if (askStartLockRef.current || activeAskTask) {
      toast.message("Another Ask Video request is already running.")
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
      && transcriptLoadGenerationRef.current === requestedTranscriptLoadGeneration
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
      let thread = requestThreadId
        ? await qaConversationRepository.getQaThread(requestThreadId)
        : null
      const canReuseThread = matchesQaThreadIdentity(thread, {
        contentKey: requestedContentKey,
        analysisRunId: requestedAnalysisRunId,
        transcriptFingerprint: requestedTranscriptFingerprint,
      })

      if (!isCurrentAsk()) return

      let resolvedProviderForAsk: ResolvedProvider
      if (canReuseThread && thread) {
        try {
          resolvedProviderForAsk = await settingsStorage.resolveProvider(thread.providerProfileId)
        } catch {
          throw new Error("The provider used by this conversation is no longer available. Start a new chat to use the current provider.")
        }
      } else {
        resolvedProviderForAsk = await settingsStorage.resolveProvider(provider.id)
        thread = await qaConversationRepository.createQaThread({
          contentKey: requestedContentKey,
          platform: analysisView.platform,
          videoId: analysisView.videoId,
          partId: analysisView.partId,
          title: submittedQuestion.slice(0, 60),
          analysisRunId: requestedAnalysisRunId,
          transcriptFingerprint: requestedTranscriptFingerprint,
          providerProfileId: provider.id,
          providerBaseUrl: resolvedProviderForAsk.profile.baseUrl,
          providerModel: resolvedProviderForAsk.profile.model,
        })
        requestThreadId = thread.id
        activeQaThreadIdRef.current = thread.id
        setQaThreadId(thread.id)
        setQaThreads((current) => [thread!, ...current.filter((item) => item.id !== thread!.id)])
      }
      if (!thread || !isCurrentAsk()) return

      const threadProviderProfileId = thread.providerProfileId
      const threadProviderBaseUrl = thread.providerBaseUrl
      const threadProviderModel = thread.providerModel
      const frozenProviderRequest = getFrozenQaProviderRequest(thread, resolvedProviderForAsk)
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
        toast.success(`Ask Video answer ready: ${taskSnapshot.videoTitle}`)
      }, { taskId: admission.taskId })
      await taskPromise
    } catch (error) {
      const wasCancelled = askSignal?.aborted
      if (wasCancelled) {
        toast.message("Ask Video request cancelled.")
        return
      }
      const message = error instanceof Error ? error.message : "Unknown Ask Video error."
      if (isCurrentAsk()) setAskError(message)
      toast.error(message)
    } finally {
      admission?.release()
      pendingAskOperationRef.current = null
      askStartLockRef.current = false
    }
  }, [activeAskTask, analysisView, askQuestion, askTaskController, isAnalysisBusy, isAnalysisFetching, isTranscriptLoading, provider, qaThreadId, transcriptCues, transcriptIdentity])

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
    const requestedTranscriptLoadGeneration = transcriptLoadGenerationRef.current
    askGenerationRef.current += 1
    const generation = ++qaLoadGenerationRef.current
    const thread = await qaConversationRepository.getQaThread(threadId)
    if (
      !thread
      || thread.contentKey !== requestedContentKey
      || thread.analysisRunId !== requestedAnalysisRunId
      || !requestedTranscriptFingerprint
      || thread.transcriptFingerprint !== requestedTranscriptFingerprint
    ) return
    const messages = await qaConversationRepository.listQaMessages(threadId)
    if (
      qaLoadGenerationRef.current !== generation
      || transcriptLoadGenerationRef.current !== requestedTranscriptLoadGeneration
      || activeAnalysisContentKeyRef.current !== requestedContentKey
      || activeAnalysisRunIdRef.current !== requestedAnalysisRunId
      || currentTranscriptFingerprintRef.current !== requestedTranscriptFingerprint
    ) return
    activeQaThreadIdRef.current = threadId
    setQaThreadId(threadId)
    setQaMessages(messages)
    setAskQuestion("")
    const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant")
    setAskAnswer(latestAssistant?.citations ? {
      answer: latestAssistant.content,
      citations: latestAssistant.citations.map((citation) => ({ text: citation.text, startSec: citation.startSec, endSec: citation.endSec ?? citation.startSec })),
      suggestedJumps: latestAssistant.suggestedJumps ?? [],
      followUps: latestAssistant.followUps ?? [],
    } : null)
  }, [analysisView, isAnalysisBusy, isAnalysisFetching, isAsking, isTranscriptLoading, transcriptCues])

  const handleDeleteQaThread = useCallback(async (threadId: string) => {
    if (isAsking) return
    await qaConversationRepository.deleteQaThread(threadId)
    setQaThreads((current) => current.filter((thread) => thread.id !== threadId))
    if (qaThreadId === threadId || activeQaThreadIdRef.current === threadId) handleNewQaChat()
  }, [handleNewQaChat, isAsking, qaThreadId])

  const jumpWithIdentity = useCallback(async (
    identity: VideoIdentity | null,
    timestampSeconds: number,
  ) => {
    if (!identity) {
      toast.error("No video context available.")
      return
    }
    const result = await jumpToTimestamp(identity, timestampSeconds)
    if (result.ok === true) {
      toast.success(
        result.openedNewTab
          ? `Opened video at ${formatTimestamp(timestampSeconds)} in a new tab.`
          : `Jumped to ${formatTimestamp(timestampSeconds)} in the active tab.`,
      )
    } else {
      toast.error(result.error)
    }
  }, [jumpToTimestamp])

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
      toast.error("Original VTT is unavailable for this transcript.")
      return
    }
    await downloadRawVtt({
      rawVtt,
      videoId: transcriptIdentity.videoId,
      title: transcriptTitle ?? transcriptIdentity.videoId,
    })
    toast.success("Transcript download started.")
  }, [rawVtt, transcriptIdentity, transcriptTitle])

  const handleProvidersChange = useCallback((providers: ProviderConfigRecord[]) => {
    setProvider(providers.find((item) => item.isDefault) ?? null)
  }, [])

  const visibleAnalysisError = analysisError
    ?? (activeAnalysisTask && activeAnalysisTask.snapshot.contentKey !== videoContext.contentKey
      ? "Another analysis is already running."
      : null)
    ?? analysisView?.errorMessage ?? (
    status === "error" ? "Unable to load the active video context." : null
  )
  const headerAnalysisState = isAnalysisFetching
    ? "Loading analysis…"
    : getAnalysisStatusLabel(workspaceTask?.phase ?? analysisPhase, Boolean(analysisView))

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
            timestampLabel={`Current playback: ${formatTimestamp(videoContext.timestampSeconds)}`}
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
              ? new Date(analysisView.lastAnalyzedAt).toLocaleString()
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
    <ExtensionProviders surface="sidepanel">
      <SidepanelWorkspace />
    </ExtensionProviders>
  )
}

export default SidePanel
