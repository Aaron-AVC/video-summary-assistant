import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { historyRepository } from "@/features/history/lib/history-repository"
import { performDestructiveOperation } from "@/features/history/lib/destructive-operation-coordinator"
import {
  RecentAnalysisList,
  type RecentAnalysisListItem
} from "@/features/history/components/recent-analysis-list"
import {
  PENDING_HISTORY_OPEN_KEY,
  type PendingHistoryOpenPayload
} from "@/features/history/lib/pending-history-open"
import { useI18n } from "@/lib/i18n/i18n-provider"

const FULL_HISTORY_LIMIT = 200

function toListItem(
  recent: { videoId: string; title: string; channelTitle?: string; updatedAt: string; contentKey?: string; analysisRunId?: string; partId?: string | null; platform?: "youtube" | "bilibili" },
  status: string | null
): RecentAnalysisListItem {
  return {
    videoId: recent.videoId,
    analysisRunId: recent.analysisRunId,
    contentKey: recent.contentKey,
    partId: recent.partId,
    platform: recent.platform,
    title: recent.title,
    channelTitle: recent.channelTitle ?? null,
    status,
    updatedAt: recent.updatedAt
  }
}

export function HistoryPanel() {
  const { t } = useI18n()
  const [items, setItems] = useState<RecentAnalysisListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const records = await historyRepository.listRecentAnalyses(FULL_HISTORY_LIMIT)
      const next = records.map(({ recentVideo, analysis }) =>
        toListItem(recentVideo, analysis?.status ?? null)
      )
      setItems(next)
    } catch {
      setLoadError(t("history.loadFailed"))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    void reload()
  }, [reload])

  const handleSelect = useCallback(async (videoId: string, contentKey?: string, analysisRunId?: string) => {
    // Push the request into chrome.storage so the sidepanel can react
    // whether or not it is currently mounted. The sidepanel listens for
    // changes on this key, loads the referenced analysis, and clears the
    // key on its side. We intentionally bypass chrome.tabs.create so the
    // user is not yanked away from Settings into a YouTube watch page —
    // the sidepanel renders the cached analysis directly.
    const payload: PendingHistoryOpenPayload = {
      videoId,
      contentKey,
      analysisRunId,
      requestedAt: Date.now()
    }
    try {
      await chrome.storage?.local?.set({ [PENDING_HISTORY_OPEN_KEY]: payload })
    } catch {
      // chrome.storage may be unavailable in non-extension test contexts.
    }
    // Best-effort: open the sidepanel for the active window so the user
    // sees the result without having to click the toolbar icon. This call
    // requires a user gesture, which the click on this button satisfies.
    try {
      const win = await chrome.windows?.getCurrent?.()
      if (win?.id != null && chrome.sidePanel?.open) {
        await chrome.sidePanel.open({ windowId: win.id })
      }
    } catch {
      // Older Chrome builds reject sidePanel.open without an active tab —
      // ignore, the sidepanel will pick up the storage signal next time
      // the user opens it.
    }
  }, [])

  const handleDeleteAnalysis = useCallback(async (item: RecentAnalysisListItem) => {
    if (!item.analysisRunId) return
    if (!window.confirm(`${t("history.deleteAnalysis")}\n\n${item.title}`)) return
    try {
      await performDestructiveOperation(
        "delete-analysis-run",
        { analysisRunId: item.analysisRunId, contentKey: item.contentKey },
        () => historyRepository.deleteAnalysisRun(item.analysisRunId!),
      )
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("history.deleteFailed"))
    }
  }, [reload, t])

  const handleDeleteVideo = useCallback(async (item: RecentAnalysisListItem) => {
    if (!item.contentKey) return
    if (!window.confirm(`${t("history.deleteVideoPrompt")}\n\n${item.title}`)) return
    if (!window.confirm(t("history.deleteVideoDetail", { title: item.title }))) return
    try {
      await performDestructiveOperation(
        "delete-video-data",
        { contentKey: item.contentKey },
        () => historyRepository.deleteVideoData(item.contentKey!),
      )
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("history.videoDeleteFailed"))
    }
  }, [reload, t])

  return (
    <RecentAnalysisList
      items={items}
      isLoading={isLoading}
      activeVideoId={null}
      onSelect={handleSelect}
      onDeleteAnalysis={handleDeleteAnalysis}
      onDeleteVideo={handleDeleteVideo}
      loadError={loadError}
      onRetry={() => { void reload() }}
      searchPlaceholder={t("history.search")}
      emptyMatchMessage={t("history.noFullMatch")}
      scrollHeightClassName="h-[32rem]"
    />
  )
}
