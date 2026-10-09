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
  lastAnalyzedAt: string | null
  errorMessage: string | null
}

type HistoryEntry = {
  recentVideo: {
    videoId: string
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
            title: entry.recentVideo.title,
            channelTitle: entry.recentVideo.channelTitle,
            status: entry.recentVideo.status,
            updatedAt: entry.recentVideo.updatedAt,
          })),
      )

      if (videoContext.platform === "youtube" && videoContext.videoId) {
        await loadSavedAnalysis(videoContext.videoId, generation)
      }
    } finally {
      if (generation === loadWorkspaceGenerationRef.current) {
        setIsBootstrapping(false)
      }
    }
  }, [loadSavedAnalysis, videoContext.contentKey, videoContext.platform, videoContext.videoId])

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

  const loadTranscriptForCurrent = useCallback(async (): Promise<CurrentTranscriptResult> => {
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
      const result = await loadCurrentTranscript({ requestedContentKey, isCurrent })
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
      return result
    } catch (error) {
      if (isCurrent()) {
        setTranscriptError(error instanceof Error ? error.message : "Unknown transcript error.")
      }
      throw error
    } finally {
      if (isCurrent()) setIsTranscriptLoading(false)
    }
  }, [])

  const handleLoadTranscript = useCallback(async () => {
    try {
      await loadTranscriptForCurrent()
      toast.success("Transcript loaded.")
    } catch (error) {
      if (error instanceof StaleTranscriptError) return
      toast.error(error instanceof Error ? error.message : "Unknown transcript error.")
    }
  }, [loadTranscriptForCurrent])

  const handleAnalyze = useCallback(async () => {
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
      const { video, transcript } = await loadTranscriptForCurrent()
      if (!isCurrentAnalysis()) throw new StaleTranscriptError()

      setAnalysisPhase("analyzing")
      const resolvedProvider = await settingsStorage.resolveProvider(requestedProvider.id)
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
      const wasPersisted = await persistIfSupportedPlatform(video, async () => {
        const transcriptSnapshotId = crypto.randomUUID()
        const analysisRunId = crypto.randomUUID()
        await historyRepository.saveTranscriptSnapshot({
          id: transcriptSnapshotId,
          videoId: video.videoId,
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
            transcriptSnapshotId,
            providerConfigId: requestedProvider.id,
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
            title: video.title ?? videoContext.title ?? video.videoId,
            channelTitle: videoContext.author,
            thumbnailUrl: video.thumbnailUrl ?? null,
            status: "completed",
            openedAt: now,
            analyzedAt: now,
            updatedAt: now,
          },
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
        lastAnalyzedAt: now,
        errorMessage: null,
      })
      setAnalysisPhase("completed")
      if (wasPersisted) {
        await refreshRecentAnalyses()
        toast.success("Analysis saved locally.")
      } else {
        toast.success("Analysis ready for this session; Bilibili history is not saved.")
      }
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

  const handleOpenSavedAnalysis = useCallback(async (videoId: string) => {
    analysisGenerationRef.current += 1
    askGenerationRef.current += 1
    transcriptLoadGenerationRef.current += 1
    analysisAbortRef.current?.abort()
    setAskQuestion("")
    setAskAnswer(null)
    setAskError(null)
    setAnalysisError(null)
    const generation = ++loadWorkspaceGenerationRef.current
    await loadSavedAnalysis(videoId, generation)
    toast.success("Loaded saved analysis from local history.")
  }, [loadSavedAnalysis])

  useEffect(() => {
    let isCurrent = true
    const consumePayload = async (rawValue: unknown) => {
      if (!isCurrent || !isPendingHistoryOpenPayload(rawValue)) return
      try {
        await handleOpenSavedAnalysis(rawValue.videoId)
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
      const resolvedProvider = await settingsStorage.resolveProvider(provider.id)
      const result = await askVideo({
        provider: {
          baseUrl: resolvedProvider.profile.baseUrl,
          apiKey: resolvedProvider.apiKey,
          model: resolvedProvider.profile.model,
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
