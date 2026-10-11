import "@/styles/globals.css"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { Toaster } from "@/components/ui/sonner"
import { CurrentVideoCard } from "@/features/analysis/components/current-video-card"
import type {
  AskVideoAnswer,
  VideoAnalysis,
} from "@/features/analysis/lib/analysis-schema"
import { askVideo } from "@/features/analysis/lib/ask-video"
import { persistedLegacyAnalysisToVideoAnalysis } from "@/features/analysis/lib/analysis-compat"
import { AnalysisAbortedError, runAnalysis } from "@/features/analysis/lib/run-analysis"
import type { RecentAnalysisListItem } from "@/features/history/components/recent-analysis-list"
import {
  PENDING_HISTORY_OPEN_KEY,
  isPendingHistoryOpenPayload,
} from "@/features/history/lib/pending-history-open"
import { historyRepository } from "@/features/history/lib/history-repository"
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
  const { jumpToTimestamp, refreshCurrentVideo, status, videoContext } = useRuntimeBridge()
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
  const [askError, setAskError] = useState<string | null>(null)
  const [isAsking, setIsAsking] = useState(false)
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [isAnalysisFetching, setIsAnalysisFetching] = useState(false)
  const [analysisPhase, setAnalysisPhase] = useState<AnalysisPhase>("idle")
  const [analysisError, setAnalysisError] = useState<string | null>(null)

  const analysisAbortRef = useRef<AbortController | null>(null)
  const analysisGenerationRef = useRef(0)
  const transcriptLoadGenerationRef = useRef(0)
  const askGenerationRef = useRef(0)
  const loadWorkspaceGenerationRef = useRef(0)
  const activeAnalysisContentKeyRef = useRef<string | null>(null)

  const title = videoContext.title ?? "Open a supported video page to start"
  const canonicalUrl = videoContext.canonicalUrl ?? videoContext.url ?? "No supported video page detected"
  const isAnalysisBusy = analysisPhase === "loading-transcript"
    || analysisPhase === "analyzing"
    || analysisPhase === "cancelling"
  const isAnalysisLoading = isBootstrapping || isAnalysisFetching || isAnalysisBusy
  const hasMatchingTranscript = Boolean(
    analysisView
    && transcriptIdentity?.contentKey === analysisView.contentKey
    && transcriptCues.length > 0,
  )
  const canAsk = Boolean(
    provider
    && analysisView
    && hasMatchingTranscript
    && askQuestion.trim()
    && !isAsking,
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

  useEffect(() => {
    activeAnalysisContentKeyRef.current = analysisView?.contentKey ?? null
  }, [analysisView?.contentKey])

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
      setRawVtt(latestTranscriptSnapshot?.rawVtt ?? null)
      setTranscriptCues(latestTranscriptSnapshot?.cues ?? [])
      setTranscriptIdentity(latestTranscriptSnapshot ? identity : null)
      setCurrentTranscriptFingerprint(latestTranscriptSnapshot?.fingerprint ?? analysis?.transcriptFingerprint ?? null)
      setTranscriptTitle(
        recent.find((entry) => entry.recentVideo.videoId === videoId)?.recentVideo.title ?? videoId,
      )
      setTranscriptError(null)

      if (!analysis) {
        setAnalysisView(null)
        setAnalysisPhase("idle")
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
    } finally {
      if (generation === loadWorkspaceGenerationRef.current) {
        setIsAnalysisFetching(false)
      }
    }
  }, [])

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
      setCurrentTranscriptFingerprint(latestTranscript?.fingerprint ?? null)
      setTranscriptTitle(context.title)
      if (!analysis) {
        setAnalysisView(null)
        setAnalysisPhase("idle")
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
    } finally {
      if (generation === loadWorkspaceGenerationRef.current) setIsAnalysisFetching(false)
    }
  }, [])

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

      setRawVtt(transcript?.rawVtt ?? null)
      setTranscriptCues(transcript?.cues ?? [])
      setTranscriptIdentity(transcript ? {
        platform,
        videoId: transcript.videoId,
        contentKey: transcript.contentKey ?? contentKey,
        ...(transcript.partId ? { partId: transcript.partId } : partId ? { partId } : {}),
      } : null)
      setCurrentTranscriptFingerprint(transcript?.fingerprint ?? analysisRun.transcriptFingerprint ?? null)
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
    } finally {
      if (generation === loadWorkspaceGenerationRef.current) setIsAnalysisFetching(false)
    }
  }, [])

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
    analysisGenerationRef.current += 1
    transcriptLoadGenerationRef.current += 1
    askGenerationRef.current += 1
    analysisAbortRef.current?.abort()
    analysisAbortRef.current = null

    setAnalysisView(null)
    setAnalysisError(null)
    setAnalysisPhase("idle")
    setTranscriptCues([])
    setTranscriptIdentity(null)
    setTranscriptTitle(null)
    setCurrentTranscriptFingerprint(null)
    setRawVtt(null)
    setTranscriptError(null)
    setIsTranscriptLoading(false)
    setAskQuestion("")
    setAskAnswer(null)
    setAskError(null)
    setIsAsking(false)
    setIsAnalysisFetching(false)
  }, [videoContext.contentKey])

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
          setTranscriptCues(cached.cues)
          setRawVtt(cached.rawVtt)
          setTranscriptIdentity({
            platform: cached.platform,
            videoId: cached.videoId,
            contentKey: cached.contentKey,
            ...(cached.partId ? { partId: cached.partId } : {}),
          })
          setCurrentTranscriptFingerprint(cached.fingerprint ?? null)
          setTranscriptTitle(cachedVideo.title)
          return { video: cachedVideo, transcript: cachedTranscript }
        },
        loadRemote: () => loadCurrentTranscript({ requestedContentKey, isCurrent }),
      })
      if (!isCurrent()) throw new StaleTranscriptError()

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
      const fingerprint = await computeTranscriptFingerprint(result.transcript.segments)
      setCurrentTranscriptFingerprint(fingerprint)
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
  }, [rawVtt, transcriptCues, transcriptIdentity])

  const handleLoadTranscript = useCallback(async () => {
    try {
      await loadTranscriptForCurrent(true)
      toast.success("Transcript loaded.")
    } catch (error) {
      if (error instanceof StaleTranscriptError) return
      toast.error(error instanceof Error ? error.message : "Unknown transcript error.")
    }
  }, [loadTranscriptForCurrent])

  const handleAnalyze = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    if (!videoContext.isReady || !videoContext.videoId || !videoContext.contentKey) {
      toast.error("Open a supported video page before analyzing.")
      return
    }
    if (!provider) {
      setActiveTab("settings")
      return
    }

    const requestedContentKey = videoContext.contentKey
    const requestedProvider = provider
    const analysisGeneration = ++analysisGenerationRef.current
    const isCurrentAnalysis = () => (
      analysisGenerationRef.current === analysisGeneration
      && videoContextRef.current.contentKey === requestedContentKey
    )

    analysisAbortRef.current?.abort()
    const controller = new AbortController()
    analysisAbortRef.current = controller
    setAnalysisPhase("loading-transcript")
    setAnalysisError(null)
    setAskAnswer(null)
    setAskError(null)

    try {
      const { video, transcript } = await loadTranscriptForCurrent(false)
      if (!isCurrentAnalysis()) throw new StaleTranscriptError()

      setAnalysisPhase("analyzing")
      const resolvedProvider = await settingsStorage.resolveProvider(requestedProvider.id)
      const transcriptFingerprint = await computeTranscriptFingerprint(transcript.segments)
      const cacheKey = await computeAnalysisCacheKey({
        contentKey: requestedContentKey,
        transcriptFingerprint,
        providerProfileId: requestedProvider.id,
        baseUrl: resolvedProvider.profile.baseUrl,
        model: resolvedProvider.profile.model,
      })
      await historyRepository.saveTranscriptCache({
        id: `transcript:${requestedContentKey}:${transcriptFingerprint}`,
        contentKey: requestedContentKey,
        platform: video.platform,
        videoId: video.videoId,
        partId: video.partId ?? null,
        fingerprint: transcriptFingerprint,
        fingerprintVersion: TRANSCRIPT_FINGERPRINT_VERSION,
        language: transcript.language ?? null,
        sourceUrl: transcript.raw?.sourceUrl ?? null,
        rawVtt: transcript.raw?.text ?? null,
        cues: transcript.segments,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      if (!force) {
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
          contentKey: requestedContentKey,
          transcriptFingerprint,
          providerProfileId: requestedProvider.id,
          baseUrl: resolvedProvider.profile.baseUrl,
          model: resolvedProvider.profile.model,
          analysisSchemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
          analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
        })) {
          if (!isCurrentAnalysis()) throw new StaleTranscriptError()
          setAnalysisView({
            platform: video.platform,
            videoId: video.videoId,
            partId: video.partId ?? null,
            contentKey: video.contentKey,
            title: video.title,
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
          await refreshRecentAnalyses()
          toast.success("Loaded cached analysis.")
          return
        }
      }
      const completed = await runAnalysis({
        provider: {
          baseUrl: resolvedProvider.profile.baseUrl,
          apiKey: resolvedProvider.apiKey,
          model: resolvedProvider.profile.model,
        },
        transcript: {
          videoId: video.videoId,
          title: video.title,
          cues: transcript.segments,
          durationSec: video.durationSec,
        },
        signal: controller.signal,
      })
      if (!isCurrentAnalysis()) {
        throw new Error("The video part changed while analysis was running. Its result was discarded.")
      }

      const now = new Date().toISOString()
      const analysisRunId = crypto.randomUUID()
      const transcriptSnapshotId = crypto.randomUUID()
      await persistIfSupportedPlatform(video, async () => {
        await historyRepository.saveVideoRecord({
          contentKey: video.contentKey,
          platform: video.platform,
          videoId: video.videoId,
          partId: video.partId ?? null,
          title: video.title,
          channelTitle: videoContext.author,
          thumbnailUrl: video.thumbnailUrl ?? null,
          canonicalUrl: video.canonicalUrl ?? null,
          durationSec: video.durationSec ?? null,
          openedAt: now,
          updatedAt: now,
          analyzedAt: now,
        })
        await historyRepository.saveTranscriptSnapshot({
          id: transcriptSnapshotId,
          videoId: video.videoId,
          platform: video.platform,
          contentKey: video.contentKey,
          partId: video.partId ?? null,
          language: transcript.language ?? null,
          sourceUrl: transcript.raw?.sourceUrl ?? null,
          rawVtt: transcript.raw?.text ?? null,
          cues: transcript.segments,
          createdAt: now,
          updatedAt: now,
        })
        await historyRepository.saveAnalysisRun({
          analysisRun: {
            id: analysisRunId,
            videoId: video.videoId,
            platform: video.platform,
            contentKey: video.contentKey,
            partId: video.partId ?? null,
            transcriptSnapshotId,
            providerConfigId: requestedProvider.id,
            transcriptFingerprint,
            analysisSchemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
            analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
            analysisCacheKey: cacheKey,
            providerProfileId: requestedProvider.id,
            providerBaseUrl: resolvedProvider.profile.baseUrl,
            providerModel: resolvedProvider.profile.model,
            status: "completed",
            summary: completed.analysis.summary,
            keyPoints: completed.analysis.keyPoints,
            topics: [],
            errorMessage: null,
            createdAt: now,
            updatedAt: now,
            completedAt: now,
          },
          segments: completed.analysis.chapters.map((chapter) => ({
            id: crypto.randomUUID(),
            analysisRunId,
            videoId: video.videoId,
            contentKey: video.contentKey,
            title: chapter.title,
            summary: chapter.summary,
            detail: chapter.detail,
            startSec: chapter.startSec,
            endSec: chapter.endSec,
            createdAt: now,
            updatedAt: now,
          })),
          recentVideo: {
            videoId: video.videoId,
            analysisRunId,
            contentKey: video.contentKey,
            title: video.title ?? videoContext.title ?? video.videoId,
            channelTitle: videoContext.author,
            thumbnailUrl: video.thumbnailUrl ?? null,
            status: "completed",
            openedAt: now,
            analyzedAt: now,
            updatedAt: now,
          },
        })
        await historyRepository.saveAnalysisCache({
          cacheKey,
          contentKey: video.contentKey,
          platform: video.platform,
          videoId: video.videoId,
          partId: video.partId ?? null,
          transcriptFingerprint,
          analysisSchemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
          analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
          providerProfileId: requestedProvider.id,
          providerBaseUrl: resolvedProvider.profile.baseUrl,
          providerModel: resolvedProvider.profile.model,
          analysisRunId,
          analysis: completed.analysis,
          createdAt: now,
          updatedAt: now,
        })
      })
      if (!isCurrentAnalysis()) {
        throw new Error("The active video changed before the analysis could be finalized.")
      }

      setAnalysisView({
        platform: video.platform,
        videoId: video.videoId,
        partId: video.partId ?? null,
        contentKey: video.contentKey,
        title: video.title,
        analysis: completed.analysis,
        analysisRunId,
        transcriptFingerprint,
        providerProfileId: requestedProvider.id,
        providerBaseUrl: resolvedProvider.profile.baseUrl,
        providerModel: resolvedProvider.profile.model,
        analysisSchemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
        analysisPromptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
        lastAnalyzedAt: now,
        errorMessage: null,
      })
      setAnalysisPhase("completed")
      await refreshRecentAnalyses()
      toast.success("Analysis saved locally.")
    } catch (error) {
      if (!isCurrentAnalysis()) return
      const isAbort = error instanceof AnalysisAbortedError
        || (error instanceof DOMException && error.name === "AbortError")
      if (isAbort) {
        setAnalysisError(null)
        setAnalysisPhase("cancelled")
        toast.message("Analysis cancelled.")
      } else {
        const message = error instanceof Error ? error.message : "Unknown analysis error."
        setAnalysisError(message)
        setAnalysisPhase("error")
        setAnalysisView((current) => current ? { ...current, errorMessage: message } : null)
        toast.error(message)
      }
    } finally {
      if (analysisAbortRef.current === controller) analysisAbortRef.current = null
    }
  }, [loadTranscriptForCurrent, provider, refreshRecentAnalyses, videoContext])

  const handleCancelAnalysis = useCallback(() => {
    if (!analysisAbortRef.current) return
    setAnalysisPhase("cancelling")
    analysisAbortRef.current.abort()
  }, [])

  const handleOpenSavedAnalysis = useCallback(async (
    videoId: string,
    contentKey?: string,
    analysisRunId?: string,
  ) => {
    analysisGenerationRef.current += 1
    askGenerationRef.current += 1
    transcriptLoadGenerationRef.current += 1
    analysisAbortRef.current?.abort()
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
    if (!analysisView || !provider || !hasMatchingTranscript) return
    const requestedContentKey = analysisView.contentKey
    const generation = ++askGenerationRef.current
    const isCurrentAsk = () => (
      askGenerationRef.current === generation
      && activeAnalysisContentKeyRef.current === requestedContentKey
    )

    setIsAsking(true)
    setAskAnswer(null)
    setAskError(null)
    try {
      const resolvedProviderForAsk = await settingsStorage.resolveProvider(provider.id)
      const transcriptFingerprint = analysisView.transcriptFingerprint
        ?? await computeTranscriptFingerprint(transcriptCues)
      const qaCacheKey = await computeQaCacheKey({
        contentKey: requestedContentKey,
        transcriptFingerprint,
        analysisRunId: analysisView.analysisRunId ?? "legacy",
        providerProfileId: provider.id,
        baseUrl: resolvedProviderForAsk.profile.baseUrl,
        model: resolvedProviderForAsk.profile.model,
        question: askQuestion,
      })
      const cachedAnswer = await historyRepository.getQaAnswer(qaCacheKey)
      if (cachedAnswer) {
        if (!isCurrentAsk()) return
        setAskAnswer(cachedAnswer.answer)
        setIsAsking(false)
        toast.success("Loaded cached answer.")
        return
      }
      const result = await askVideo({
        provider: {
          baseUrl: resolvedProviderForAsk.profile.baseUrl,
          apiKey: resolvedProviderForAsk.apiKey,
          model: resolvedProviderForAsk.profile.model,
        },
        question: askQuestion,
        transcript: {
          videoId: analysisView.videoId,
          title: analysisView.title,
          cues: transcriptCues,
        },
        analysis: analysisView.analysis,
      })
      if (!isCurrentAsk()) return
      await historyRepository.saveQaAnswer({
        cacheKey: qaCacheKey,
        contentKey: requestedContentKey,
        transcriptFingerprint,
        analysisRunId: analysisView.analysisRunId ?? "legacy",
        providerProfileId: provider.id,
        providerBaseUrl: resolvedProviderForAsk.profile.baseUrl,
        providerModel: resolvedProviderForAsk.profile.model,
        question: askQuestion.trim(),
        schemaVersion: VIDEO_QA_SCHEMA_VERSION,
        promptVersion: VIDEO_QA_PROMPT_VERSION,
        answer: result.answer,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      setAskAnswer(result.answer)
      toast.success("Ask Video answer ready.")
    } catch (error) {
      if (!isCurrentAsk()) return
      const message = error instanceof Error ? error.message : "Unknown Ask Video error."
      setAskError(message)
      toast.error(message)
    } finally {
      if (isCurrentAsk()) setIsAsking(false)
    }
  }, [analysisView, askQuestion, hasMatchingTranscript, provider, transcriptCues])

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

  const visibleAnalysisError = analysisError ?? analysisView?.errorMessage ?? (
    status === "error" ? "Unable to load the active video context." : null
  )
  const headerAnalysisState = isAnalysisFetching
    ? "Loading analysis…"
    : getAnalysisStatusLabel(analysisPhase, Boolean(analysisView))

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
        overview={(
          <OverviewTab
            analysis={analysisView?.analysis ?? null}
            hasCurrentAnalysis={isExactCurrentDisplayedAnalysis}
            analysisError={visibleAnalysisError}
            analysisPhase={analysisPhase}
            isLoading={isAnalysisLoading}
            hasProvider={Boolean(provider)}
            canAnalyze={Boolean(
              videoContext.isReady
              && provider
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
            hasTranscript={hasMatchingTranscript}
            question={askQuestion}
            answer={askAnswer}
            isAsking={isAsking}
            canAsk={canAsk}
            errorMessage={askError}
            isTranscriptLoading={isTranscriptLoading}
            onQuestionChange={setAskQuestion}
            onAsk={handleAsk}
            onFollowUp={setAskQuestion}
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
