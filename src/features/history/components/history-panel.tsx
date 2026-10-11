import { useCallback, useEffect, useState } from "react"

import { historyRepository } from "@/features/history/lib/history-repository"
import {
  RecentAnalysisList,
  type RecentAnalysisListItem
} from "@/features/history/components/recent-analysis-list"
import {
  PENDING_HISTORY_OPEN_KEY,
  type PendingHistoryOpenPayload
} from "@/features/history/lib/pending-history-open"

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
  const [items, setItems] = useState<RecentAnalysisListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const reload = useCallback(async () => {
    setIsLoading(true)
    const records = await historyRepository.listRecentAnalyses(FULL_HISTORY_LIMIT)
    const next = records.map(({ recentVideo, analysis }) =>
      toListItem(recentVideo, analysis?.status ?? null)
    )
    setItems(next)
    setIsLoading(false)
  }, [])

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

  return (
    <RecentAnalysisList
      items={items}
      isLoading={isLoading}
      activeVideoId={null}
      onSelect={handleSelect}
      searchPlaceholder="Search history (title, channel, video ID)"
      emptyMatchMessage="No history entries match your search."
      scrollHeightClassName="h-[32rem]"
    />
  )
}
