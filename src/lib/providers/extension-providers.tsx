import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import type { ActiveVideoContext, VideoIdentity } from "@/features/platform/types"
import { createUnsupportedVideoContext } from "@/lib/runtime/current-video"
import {
  ACTIVE_VIDEO_CONTEXT_CHANGED,
  ANALYZE_VIDEO,
  GET_ACTIVE_VIDEO_CONTEXT,
  JUMP_TO_TIMESTAMP,
  OPEN_SIDEPANEL,
  RUNTIME_MESSAGE_NAMESPACE,
  sendRuntimeMessage,
  isActiveVideoContextChangedMessage,
  type RuntimeMessageParseError,
  type RuntimeResponseMessage,
} from "@/lib/runtime/messages"
import { ThemeProvider } from "@/lib/theme/theme-provider"

export type ExtensionSurfaceName = "popup" | "sidepanel" | "options"

type ExtensionSurfaceConfig = {
  name: ExtensionSurfaceName
  title: string
  description: string
  minHeightClassName: string
  minWidthClassName: string
}

const SURFACE_CONFIG: Record<ExtensionSurfaceName, ExtensionSurfaceConfig> = {
  popup: {
    name: "popup",
    title: "Popup workspace",
    description: "Quick context and launch actions for the active video tab.",
    minHeightClassName: "min-h-[480px]",
    minWidthClassName: "min-w-[360px]",
  },
  sidepanel: {
    name: "sidepanel",
    title: "Sidepanel workspace",
    description: "Pinned context for video analysis and future summaries.",
    minHeightClassName: "min-h-screen",
    minWidthClassName: "min-w-[320px]",
  },
  options: {
    name: "options",
    title: "Workspace settings",
    description: "Shared runtime preferences and diagnostics for extension surfaces.",
    minHeightClassName: "min-h-screen",
    minWidthClassName: "min-w-full",
  },
}

const ExtensionSurfaceContext = createContext<ExtensionSurfaceConfig | null>(null)
const EMPTY_CONTEXT = createUnsupportedVideoContext()
type RuntimeStatus = "idle" | "loading" | "ready" | "error"

export type JumpToTimestampResult =
  | { ok: true; openedNewTab: boolean }
  | { ok: false; error: string }

export function deriveJumpToTimestampResult(
  response: RuntimeResponseMessage | RuntimeMessageParseError,
): JumpToTimestampResult {
  if (response.ok === false) return { ok: false, error: response.error }
  if (response.type !== JUMP_TO_TIMESTAMP) {
    return { ok: false, error: "Unexpected runtime response while jumping to timestamp." }
  }
  if (!response.jumped && !response.openedNewTab) {
    return { ok: false, error: "Unable to jump: the active video tab did not respond." }
  }
  return { ok: true, openedNewTab: response.openedNewTab }
}

type RuntimeBridgeContextValue = {
  status: RuntimeStatus
  videoContext: ActiveVideoContext
  lastError: string | null
  refreshCurrentVideo: () => Promise<void>
  openSidepanel: () => Promise<void>
  requestAnalysis: () => Promise<void>
  jumpToTimestamp: (
    identity: VideoIdentity,
    timestampSeconds: number,
  ) => Promise<JumpToTimestampResult>
}

const RuntimeBridgeContext = createContext<RuntimeBridgeContextValue | null>(null)

type ExtensionProvidersProps = PropsWithChildren<{ surface: ExtensionSurfaceName }>

export function ExtensionProviders({ surface, children }: ExtensionProvidersProps) {
  const value = useMemo(() => SURFACE_CONFIG[surface], [surface])
  const [status, setStatus] = useState<RuntimeStatus>(surface === "options" ? "idle" : "loading")
  const [videoContext, setVideoContext] = useState<ActiveVideoContext>(EMPTY_CONTEXT)
  const videoContextGenerationRef = useRef(0)
  const [lastError, setLastError] = useState<string | null>(null)

  const handleResponse = useCallback((response: RuntimeResponseMessage | RuntimeMessageParseError) => {
    if (response.ok === false) {
      setStatus("error")
      setLastError(response.error)
      return response
    }

    setLastError(null)
    if (response.type === GET_ACTIVE_VIDEO_CONTEXT || response.type === ANALYZE_VIDEO) {
      setVideoContext(response.context)
      setStatus("ready")
    }
    return response
  }, [])

  const refreshCurrentVideo = useCallback(async () => {
    const generation = ++videoContextGenerationRef.current
    setStatus("loading")
    const response = await sendRuntimeMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: GET_ACTIVE_VIDEO_CONTEXT,
    })
    if (generation === videoContextGenerationRef.current) handleResponse(response)
  }, [handleResponse])

  const openSidepanel = useCallback(async () => {
    handleResponse(await sendRuntimeMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: OPEN_SIDEPANEL,
    }))
  }, [handleResponse])

  const requestAnalysis = useCallback(async () => {
    handleResponse(await sendRuntimeMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: ANALYZE_VIDEO,
    }))
  }, [handleResponse])

  const jumpToTimestamp = useCallback(async (
    identity: VideoIdentity,
    timestampSeconds: number,
  ): Promise<JumpToTimestampResult> => {
    const response = await sendRuntimeMessage({
      channel: RUNTIME_MESSAGE_NAMESPACE,
      type: JUMP_TO_TIMESTAMP,
      identity,
      timestampSeconds,
    })
    handleResponse(response)
    return deriveJumpToTimestampResult(response)
  }, [handleResponse])

  useEffect(() => {
    if (surface !== "options") void refreshCurrentVideo()
  }, [refreshCurrentVideo, surface])

  useEffect(() => {
    if (surface === "options") return

    const applyContext = (context: ActiveVideoContext) => {
      videoContextGenerationRef.current += 1
      setVideoContext(context)
      setStatus("ready")
      setLastError(null)
    }
    const refreshIfActive = async (tabId?: number) => {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tabId === undefined || activeTab?.id === tabId) await refreshCurrentVideo()
    }
    const handleRuntimeMessage = (message: unknown) => {
      if (!isActiveVideoContextChangedMessage(message)) return
      void chrome.tabs.query({ active: true, currentWindow: true }).then(([activeTab]) => {
        if (activeTab?.id === message.tabId) applyContext(message.context)
      })
    }
    const handleTabActivated = (activeInfo: { tabId: number }) => {
      void refreshIfActive(activeInfo.tabId)
    }
    const handleTabUpdated = (tabId: number, changeInfo: { status?: string; url?: string }) => {
      if (changeInfo.status === "complete" || changeInfo.url) void refreshIfActive(tabId)
    }

    chrome.runtime.onMessage.addListener(handleRuntimeMessage)
    chrome.tabs.onActivated.addListener(handleTabActivated)
    chrome.tabs.onUpdated.addListener(handleTabUpdated)
    return () => {
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage)
      chrome.tabs.onActivated.removeListener(handleTabActivated)
      chrome.tabs.onUpdated.removeListener(handleTabUpdated)
    }
  }, [refreshCurrentVideo, surface])

  const runtimeValue = useMemo<RuntimeBridgeContextValue>(() => ({
    status,
    videoContext,
    lastError,
    refreshCurrentVideo,
    openSidepanel,
    requestAnalysis,
    jumpToTimestamp,
  }), [jumpToTimestamp, lastError, openSidepanel, refreshCurrentVideo, requestAnalysis, status, videoContext])

  return (
    <ThemeProvider>
      <ExtensionSurfaceContext.Provider value={value}>
        <RuntimeBridgeContext.Provider value={runtimeValue}>
          {children}
        </RuntimeBridgeContext.Provider>
      </ExtensionSurfaceContext.Provider>
    </ThemeProvider>
  )
}

export function useExtensionSurface() {
  const context = useContext(ExtensionSurfaceContext)
  if (!context) throw new Error("useExtensionSurface must be used within ExtensionProviders")
  return context
}

export function useRuntimeBridge() {
  const context = useContext(RuntimeBridgeContext)
  if (!context) throw new Error("useRuntimeBridge must be used within ExtensionProviders")
  return context
}
