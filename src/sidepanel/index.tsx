import "@/styles/globals.css"

import { useCallback, useEffect, useRef, useState } from "react"

import { toast } from "sonner"
import { Toaster } from "@/components/ui/sonner"
import type {
  AnalysisKeyPoint,
  AnalysisResult,
  AnalysisTopic,
  AskVideoAnswer
} from "@/features/analysis/lib/analysis-schema"
import { AnalysisToolbar } from "@/features/analysis/components/analysis-toolbar"
import { AskAiPanel } from "@/features/analysis/components/ask-ai-panel"
import { CurrentVideoCard } from "@/features/analysis/components/current-video-card"
import { KeyPointsList } from "@/features/analysis/components/key-points-list"
import { SegmentTimeline, type SegmentTimelineItem } from "@/features/analysis/components/segment-timeline"
import { SummaryCard } from "@/features/analysis/components/summary-card"
import { TopicsPanel } from "@/features/analysis/components/topics-panel"
import { EmptyState } from "@/features/common/components/empty-state"
import { historyRepository } from "@/features/history/lib/history-repository"
import { RecentAnalysisList, type RecentAnalysisListItem } from "@/features/history/components/recent-analysis-list"
import {
  PENDING_HISTORY_OPEN_KEY,
  isPendingHistoryOpenPayload
} from "@/features/history/lib/pending-history-open"
import { askVideo } from "@/features/analysis/lib/ask-video"
import { AnalysisAbortedError, runAnalysis } from "@/features/analysis/lib/run-analysis"
import { settingsStorage, type ProviderConfigRecord } from "@/features/settings/lib/settings-storage"
import { downloadRawVtt } from "@/features/transcript/lib/download-vtt"
import type { TranscriptSegment } from "@/features/platform/types"
import {
  analysisMatchesActiveIdentity,
  persistIfSupportedPlatform,
  projectPersistedVideoIdentity,
} from "@/features/platform/persistence-compat"
import { ExtensionProviders } from "@/lib/providers/extension-providers"
import { useRuntimeBridge } from "@/lib/providers/extension-providers"
import { FETCH_VIDEO_TRANSCRIPT, RUNTIME_MESSAGE_NAMESPACE, sendRuntimeMessage } from "@/lib/runtime/messages"
import { Sparkles } from "lucide-react"

type AnalysisView = {
  platform: "youtube" | "bilibili"
  videoId: string
  partId: string | null
  contentKey: string
  title: string
  summary: string
  keyPoints: AnalysisKeyPoint[]
  topics: AnalysisTopic[]
  segments: SegmentTimelineItem[]
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
  analysis: {
    summary: string
  } | null
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

function createAnalysisContext(view: AnalysisView): AnalysisResult {
  const segments = view.segments.map((segment) => ({
    id: segment.id,
    title: segment.title,
    summary: segment.summary,
    startSec: segment.startSec,
    endSec: segment.endSec
  }))

  return {
    summary: view.summary,
    keyPoints: view.keyPoints,
    topics: view.topics,
    segments,
    moments: segments
  }
}

function SidepanelWorkspace() {
  const { jumpToTimestamp, refreshCurrentVideo, status, videoContext } = useRuntimeBridge()
  const videoContextRef = useRef(videoContext)
  videoContextRef.current = videoContext
  const [provider, setProvider] = useState<ProviderConfigRecord | null>(null)
  const [analysisView, setAnalysisView] = useState<AnalysisView | null>(null)
  const [recentItems, setRecentItems] = useState<RecentAnalysisListItem[]>([])
  const [rawVtt, setRawVtt] = useState<string | null>(null)
  const [transcriptCues, setTranscriptCues] = useState<TranscriptSegment[]>([])
  const [askQuestion, setAskQuestion] = useState("")
  const [askAnswer, setAskAnswer] = useState<AskVideoAnswer | null>(null)
  const [askError, setAskError] = useState<string | null>(null)
  const [isAsking, setIsAsking] = useState(false)
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [isAnalysisFetching, setIsAnalysisFetching] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isCancellingAnalysis, setIsCancellingAnalysis] = useState(false)
  const analysisAbortRef = useRef<AbortController | null>(null)
  const analysisGenerationRef = useRef(0)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const activeAnalysisContentKeyRef = useRef<string | null>(null)
  const loadWorkspaceGenerationRef = useRef(0)

  const title = videoContext.title ?? "Open a supported video page to start"
  const canonicalUrl = videoContext.canonicalUrl ?? videoContext.url ?? "No supported video page detected"
  // Loading state for analysis content only — separate from runtime context status.
  // Skeletons should NOT replace a rendered analysis when the runtime context is
  // merely refreshing (e.g. tab switch, yt-navigate-finish).
  const isAnalysisLoading = isBootstrapping || isAnalysisFetching || isAnalyzing
  const showAnalysisSkeletons = isAnalysisLoading && !analysisView
  const canAsk = Boolean(
    provider &&
      analysisView &&
      transcriptCues.length > 0 &&
      askQuestion.trim().length > 0 &&
      !isAsking
  )
  const askDisabledReason: string | null = isAsking
    ? null
    : !provider
      ? "Configure a provider in Settings before asking questions."
      : !analysisView
        ? "Run an analysis on this video first, then ask follow-ups."
        : transcriptCues.length === 0
          ? "Reanalyze this video to load its transcript before asking."
          : askQuestion.trim().length === 0
            ? "Type a question to enable Ask AI."
            : null

  const loadSavedAnalysis = useCallback(async (videoId: string, generation?: number) => {
    setIsAnalysisFetching(true)
    try {
      const [analysis, latestTranscriptSnapshot] = await Promise.all([
        historyRepository.getCurrentAnalysisByVideoId(videoId),
        historyRepository.getLatestTranscriptSnapshotByVideoId(videoId)
      ])

      // Drop stale results: a newer load began while these reads were in flight.
      // Preserves lane 6's generation-token guard.
      if (generation !== undefined && generation !== loadWorkspaceGenerationRef.current) {
        return
      }

      setRawVtt(latestTranscriptSnapshot?.rawVtt ?? null)
      setTranscriptCues(latestTranscriptSnapshot?.cues ?? [])
      setAskAnswer(null)
      setAskError(null)

      if (!analysis) {
        setAnalysisView(null)
        return
      }

      const recent = ((await historyRepository.listRecentAnalyses(25)) as HistoryEntry[]).find(
        (entry) => entry.recentVideo.videoId === videoId
      )?.recentVideo

      if (generation !== undefined && generation !== loadWorkspaceGenerationRef.current) {
        return
      }

      setAnalysisView({
        platform: "youtube",
        videoId,
        partId: null,
        contentKey: `youtube:${videoId}`,
        title: recent?.title ?? videoId,
        summary: analysis.summary,
        keyPoints: analysis.keyPoints,
        topics: analysis.topics,
        segments: analysis.segments.map((segment) => ({
          id: segment.id,
          title: segment.title,
          summary: segment.summary,
          startSec: segment.startSec,
          endSec: segment.endSec
        })),
        lastAnalyzedAt: analysis.completedAt,
        errorMessage: analysis.errorMessage
      })
    } finally {
      setIsAnalysisFetching(false)
    }
  }, [])

  const loadWorkspace = useCallback(async () => {
    const generation = loadWorkspaceGenerationRef.current + 1
    loadWorkspaceGenerationRef.current = generation
    setIsBootstrapping(true)

    try {
      const [providerConfigs, recent] = await Promise.all([
        settingsStorage.getProviderConfigs(),
        historyRepository.listRecentAnalyses(10)
      ])

      // Stale read guard: another loadWorkspace started while we were waiting.
      if (generation !== loadWorkspaceGenerationRef.current) {
        return
      }

      const defaultProvider = providerConfigs.find((item) => item.isDefault) ?? null
      setProvider(defaultProvider)
      setRecentItems(
        (recent as HistoryEntry[])
          .filter((entry) => Boolean(entry.analysis))
          .map((entry) => ({
            videoId: entry.recentVideo.videoId,
            title: entry.recentVideo.title,
            channelTitle: entry.recentVideo.channelTitle,
            status: entry.recentVideo.status,
            updatedAt: entry.recentVideo.updatedAt
          }))
      )

      if (videoContext.videoId && videoContext.platform === "youtube") {
        await loadSavedAnalysis(videoContext.videoId, generation)
      } else if (videoContext.platform === "bilibili") {
        setAnalysisView(null)
        setTranscriptCues([])
        setRawVtt(null)
        setAskAnswer(null)
        setAskError(null)
      }
    } finally {
      if (generation === loadWorkspaceGenerationRef.current) {
        setIsBootstrapping(false)
      }
    }
  }, [loadSavedAnalysis, videoContext.contentKey, videoContext.platform, videoContext.videoId])

  useEffect(() => {
    void loadWorkspace()
  }, [loadWorkspace])

  // Drop a stale analysisView the moment the current video changes so the
  // toolbar, summary, and key-point cards don't keep showing the previous
  // video's data while loadSavedAnalysis re-reads Dexie. Without this the
  // Reanalyze button + Saved-at line linger from the prior analysis.
  useEffect(() => {
    setAnalysisView((current) => {
      if (current && !analysisMatchesActiveIdentity(current, videoContext)) {
        return null
      }
      return current
    })
  }, [videoContext.contentKey, videoContext.platform, videoContext.videoId])

  useEffect(() => {
    activeAnalysisContentKeyRef.current = analysisView?.contentKey ?? null
  }, [analysisView?.contentKey])

  useEffect(() => {
    analysisGenerationRef.current += 1
    analysisAbortRef.current?.abort()
    setAnalysisError(null)
    setAskAnswer(null)
    setAskError(null)
    setTranscriptCues([])
    setRawVtt(null)
    setIsAsking(false)
    setIsAnalysisFetching(false)
    setIsAnalyzing(false)
  }, [videoContext.contentKey])

  const handleAnalyze = useCallback(async () => {
    if (!videoContext.isReady || !videoContext.videoId) {
      toast.error("Open a supported video page before analyzing.")
      return
    }

    if (!provider) {
      toast.error("Configure a default provider in Settings before analyzing.")
      return
    }

    const requestedContentKey = videoContext.contentKey
    const analysisGeneration = ++analysisGenerationRef.current
    const isCurrentAnalysis = () => (
      analysisGenerationRef.current === analysisGeneration
      && videoContextRef.current.contentKey === requestedContentKey
    )

    // Replace any prior controller (defensive — should never happen
    // because the Analyze button is disabled while isAnalyzing is true).
    analysisAbortRef.current?.abort()
    const controller = new AbortController()
    analysisAbortRef.current = controller

    setIsAnalyzing(true)
    setIsCancellingAnalysis(false)
    setAnalysisError(null)
    setAskAnswer(null)
    setAskError(null)

    try {
      const transcriptResponse = await sendRuntimeMessage({
        channel: RUNTIME_MESSAGE_NAMESPACE,
        type: FETCH_VIDEO_TRANSCRIPT,
      })

      if (transcriptResponse.ok === false || transcriptResponse.type !== FETCH_VIDEO_TRANSCRIPT) {
        throw new Error(
          transcriptResponse.ok === false
            ? transcriptResponse.error
            : "The active video tab returned an unexpected transcript response.",
        )
      }

      const { video, transcript } = transcriptResponse
      if (video.contentKey !== requestedContentKey || !isCurrentAnalysis()) {
        throw new Error("The video part changed while captions were loading. Retry the current part.")
      }
      const cues = transcript.segments
      setTranscriptCues(cues)
      setRawVtt(transcript.raw?.text ?? null)
      const resolvedProvider = await settingsStorage.resolveProvider(provider.id)
      const completed = await runAnalysis({
        provider: {
          baseUrl: resolvedProvider.profile.baseUrl,
          apiKey: resolvedProvider.apiKey,
          model: resolvedProvider.profile.model
        },
        transcript: {
          videoId: video.videoId,
          title: video.title,
          cues
        },
        signal: controller.signal
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
          cues,
          createdAt: now,
          updatedAt: now
        })

        await historyRepository.saveAnalysisRun({
          analysisRun: {
            id: analysisRunId,
            videoId: video.videoId,
            transcriptSnapshotId,
            providerConfigId: provider.id,
            status: "completed",
            summary: completed.analysis.summary,
            keyPoints: completed.analysis.keyPoints,
            topics: completed.analysis.topics,
            errorMessage: null,
            createdAt: now,
            updatedAt: now,
            completedAt: now
          },
          segments: completed.analysis.moments.map((segment) => ({
            id: crypto.randomUUID(),
            analysisRunId,
            videoId: video.videoId,
            title: segment.title,
            summary: segment.summary,
            startSec: segment.startSec,
            endSec: segment.endSec,
            createdAt: now,
            updatedAt: now
          })),
          recentVideo: {
            videoId: video.videoId,
            title: video.title ?? videoContext.title ?? video.videoId,
            channelTitle: videoContext.author,
            thumbnailUrl: video.thumbnailUrl ?? null,
            status: "completed",
            openedAt: now,
            analyzedAt: now,
            updatedAt: now
          }
        })
      })

      if (!isCurrentAnalysis()) {
        throw new Error("The active video changed before the analysis could be finalized.")
      }

      if (wasPersisted) {
        await loadWorkspace()
        toast.success("Analysis saved locally.")
      } else {
        setAnalysisView({
          platform: "bilibili",
          videoId: video.videoId,
          partId: video.partId ?? null,
          contentKey: video.contentKey,
          title: video.title,
          summary: completed.analysis.summary,
          keyPoints: completed.analysis.keyPoints,
          topics: completed.analysis.topics,
          segments: completed.analysis.moments.map((segment) => ({
            id: segment.id,
            title: segment.title,
            summary: segment.summary,
            startSec: segment.startSec,
            endSec: segment.endSec,
          })),
          lastAnalyzedAt: now,
          errorMessage: null,
        })
        toast.success("Analysis ready for this session; Bilibili history is not saved.")
      }
    } catch (error) {
      if (!isCurrentAnalysis()) return
      const isAbort =
        error instanceof AnalysisAbortedError ||
        (error instanceof DOMException && error.name === "AbortError")
      if (isAbort) {
        setAnalysisError(null)
        toast.message("Analysis cancelled.")
      } else {
        const message = error instanceof Error ? error.message : "Unknown analysis error."
        setAnalysisError(message)
        setAnalysisView((current) =>
          current
            ? {
                ...current,
                errorMessage: message
              }
            : null
        )
        toast.error(message)
      }
    } finally {
      if (analysisAbortRef.current === controller) {
        analysisAbortRef.current = null
      }
      if (isCurrentAnalysis()) {
        setIsAnalyzing(false)
        setIsCancellingAnalysis(false)
      }
    }
  }, [loadWorkspace, provider, videoContext])

  const handleCancelAnalysis = useCallback(() => {
    const controller = analysisAbortRef.current
    if (!controller) return
    setIsCancellingAnalysis(true)
    controller.abort()
  }, [])

  const handleOpenSavedAnalysis = useCallback(async (videoId: string) => {
    await loadSavedAnalysis(videoId)
    toast.success("Loaded saved analysis from local history.")
  }, [loadSavedAnalysis])

  // Pick up "open this saved analysis" requests from the Options History
  // tab. The Options page writes a payload to chrome.storage; we drain it
  // on mount and listen for further changes so the sidepanel reacts
  // without the user having to click Refresh.
  useEffect(() => {
    let isCurrent = true

    const consumePayload = async (rawValue: unknown) => {
      if (!isPendingHistoryOpenPayload(rawValue)) return
      if (!isCurrent) return
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
      areaName: string
    ) => {
      if (areaName !== "local") return
      const change = changes[PENDING_HISTORY_OPEN_KEY]
      if (!change) return
      void consumePayload(change.newValue)
    }
    chrome.storage?.onChanged?.addListener(handleChange)

    return () => {
      isCurrent = false
      chrome.storage?.onChanged?.removeListener(handleChange)
    }
  }, [handleOpenSavedAnalysis])

  const handleDownload = useCallback(async () => {
    if (!rawVtt || !analysisView) {
      toast.error("No saved VTT is available for the selected analysis.")
      return
    }

    await downloadRawVtt({
      rawVtt,
      videoId: analysisView.videoId,
      title: analysisView.title
    })

    toast.success("Transcript download started.")
  }, [analysisView, rawVtt])

  const handleAsk = useCallback(async () => {
    if (!analysisView) {
      toast.error("Run or open an analysis before asking AI.")
      return
    }

    if (!provider) {
      toast.error("Configure a default provider in Settings before asking AI.")
      return
    }

    if (transcriptCues.length === 0) {
      toast.error("A saved transcript is required before asking AI.")
      return
    }

    const requestedContentKey = analysisView.contentKey

    setIsAsking(true)
    setAskAnswer(null)
    setAskError(null)

    try {
      const resolvedProvider = await settingsStorage.resolveProvider(provider.id)
      const result = await askVideo({
        provider: {
          baseUrl: resolvedProvider.profile.baseUrl,
          apiKey: resolvedProvider.apiKey,
          model: resolvedProvider.profile.model
        },
        question: askQuestion,
        transcript: {
          videoId: analysisView.videoId,
          title: analysisView.title,
          cues: transcriptCues
        },
        analysis: createAnalysisContext(analysisView)
      })

      if (activeAnalysisContentKeyRef.current !== requestedContentKey) {
        return
      }

      setAskAnswer(result.answer)
      toast.success("Ask AI answer ready.")
    } catch (error) {
      if (activeAnalysisContentKeyRef.current !== requestedContentKey) {
        return
      }

      const message = error instanceof Error ? error.message : "Unknown Ask AI error."
      setAskError(message)
      toast.error(message)
    } finally {
      setIsAsking(false)
    }
  }, [analysisView, askQuestion, provider, transcriptCues])

  const handleJump = useCallback(
    async (timestampSeconds: number) => {
      const videoId = analysisView?.videoId
      if (!videoId) {
        toast.error("No video context available.")
        return
      }

      const identity = analysisView?.platform === "bilibili"
        ? {
            platform: "bilibili" as const,
            videoId,
            partId: analysisView.partId ?? "1",
            contentKey: analysisView.contentKey,
          }
        : projectPersistedVideoIdentity(videoId)
      const result = await jumpToTimestamp(identity, timestampSeconds)
      if (result.ok === true) {
        if (result.openedNewTab) {
          toast.success(`Opened video at ${formatTimestamp(timestampSeconds)} in a new tab.`)
        } else {
          toast.success(`Jumped to ${formatTimestamp(timestampSeconds)} in the active tab.`)
        }
      } else {
        toast.error(result.error)
      }
    },
    [jumpToTimestamp, analysisView]
  )

  return (
    <main className="min-h-screen overflow-x-hidden bg-background px-3 py-3 text-foreground sm:px-4">
      <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-3">
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
          onRefresh={refreshCurrentVideo}
        />
        <AnalysisToolbar
          hasProvider={Boolean(provider)}
          canAnalyze={videoContext.isReady && Boolean(provider)}
          isAnalyzing={isAnalyzing}
          isCancelling={isCancellingAnalysis}
          lastAnalyzedAt={
            analysisView?.lastAnalyzedAt &&
            analysisView.contentKey === videoContext.contentKey
              ? new Date(analysisView.lastAnalyzedAt).toLocaleString()
              : null
          }
          onAnalyze={handleAnalyze}
          onCancel={handleCancelAnalysis}
          onOpenOptions={() => globalThis.chrome?.runtime.openOptionsPage()}
        />
        <div className="grid min-w-0 gap-3 xl:grid-cols-[1.15fr,0.85fr]">
          <SummaryCard
            summary={analysisView?.summary ?? null}
            isLoading={showAnalysisSkeletons}
            errorMessage={analysisError ?? analysisView?.errorMessage ?? (status === "error" ? "Unable to load analysis context." : null)}
          />
          <div className="grid min-w-0 gap-3">
            <KeyPointsList
              keyPoints={analysisView?.keyPoints ?? []}
              isLoading={showAnalysisSkeletons}
              onJump={handleJump}
              formatTimestamp={formatTimestamp}
            />
            <TopicsPanel topics={analysisView?.topics ?? []} isLoading={showAnalysisSkeletons} />
          </div>
        </div>
        <div className="grid min-w-0 gap-3 xl:grid-cols-[1.05fr,0.95fr]">
          <SegmentTimeline
            segments={analysisView?.segments ?? []}
            isLoading={showAnalysisSkeletons}
            canDownload={Boolean(rawVtt && analysisView)}
            onJump={handleJump}
            onDownload={handleDownload}
            formatTimestamp={formatTimestamp}
          />
          <AskAiPanel
            question={askQuestion}
            answer={askAnswer}
            isAsking={isAsking}
            canAsk={canAsk}
            disabledReason={askDisabledReason}
            errorMessage={askError}
            onQuestionChange={setAskQuestion}
            onAsk={handleAsk}
            onFollowUp={setAskQuestion}
            onJump={handleJump}
            formatTimestamp={formatTimestamp}
          />
        </div>
        <div className="min-w-0">
          <RecentAnalysisList
            items={recentItems}
            isLoading={isBootstrapping}
            activeVideoId={analysisView?.videoId ?? videoContext.videoId}
            onSelect={handleOpenSavedAnalysis}
            onOpenFullHistory={() => {
              const url = chrome.runtime.getURL("options.html#history")
              void chrome.tabs.create({ url })
            }}
          />
        </div>
        {!isAnalysisLoading && !analysisView ? (
          <EmptyState
            className="border border-dashed border-border/70 bg-card/70"
            icon={<Sparkles />}
            title="Analysis results will appear here"
            description="Connect a default provider, run analysis on the current watch page, or reopen one of your saved local analyses from the history list."
          />
        ) : null}
      </div>
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
