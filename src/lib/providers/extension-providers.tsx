import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react"

import type { CurrentVideoContext } from "@/lib/runtime/current-video"
import {
  ANALYZE_VIDEO,
  GET_ACTIVE_VIDEO_CONTEXT,
  JUMP_TO_TIMESTAMP,
  OPEN_SIDEPANEL,
  sendRuntimeMessage,
  type RuntimeMessageParseError,
  type RuntimeResponseMessage
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
    description: "Quick context and launch actions for the active YouTube tab.",
    minHeightClassName: "min-h-[480px]",
    minWidthClassName: "min-w-[360px]"
  },
  sidepanel: {
    name: "sidepanel",
    title: "Sidepanel workspace",
    description: "Pinned context for watch-page analysis and future summaries.",
    minHeightClassName: "min-h-screen",
    minWidthClassName: "min-w-[400px]"
  },
  options: {
    name: "options",
    title: "Workspace settings",
    description: "Shared runtime preferences and diagnostics for extension surfaces.",
    minHeightClassName: "min-h-screen",
    minWidthClassName: "min-w-full"
  }
}

const ExtensionSurfaceContext = createContext<ExtensionSurfaceConfig | null>(null)
const EMPTY_CONTEXT: CurrentVideoContext = {
  pageType: "unsupported",
  videoId: null,
  url: "",
  canonicalUrl: null,
  title: null,
  channelName: null,
  timestampSeconds: 0,
  isReady: false
}

type RuntimeStatus = "idle" | "loading" | "ready" | "error"

export type JumpToTimestampResult =
  | { ok: true; openedNewTab: boolean }
  | { ok: false; error: string }

/**
 * Pure helper that maps a runtime response into the public discriminated
 * `JumpToTimestampResult` consumed by the sidepanel toaster. Keeping it pure
 * makes the success/failure narrowing unit-testable without spinning up a full
 * React tree or mocking `chrome.runtime`.
 */
export function deriveJumpToTimestampResult(
  response: RuntimeResponseMessage | RuntimeMessageParseError
): JumpToTimestampResult {
  if (response.ok === false) {
    return { ok: false, error: response.error }
  }

  if (response.type !== JUMP_TO_TIMESTAMP) {
    return {
      ok: false,
      error: "Unexpected runtime response while jumping to timestamp."
    }
  }

  if (!response.jumped && !response.openedNewTab) {
    return {
      ok: false,
      error: "Unable to jump: the active YouTube tab did not respond."
    }
  }

  return { ok: true, openedNewTab: response.openedNewTab }
}

type RuntimeBridgeContextValue = {
  status: RuntimeStatus
  videoContext: CurrentVideoContext
  lastError: string | null
  refreshCurrentVideo: () => Promise<void>
  openSidepanel: () => Promise<void>
  requestAnalysis: () => Promise<void>
  jumpToTimestamp: (videoId: string, timestampSeconds: number) => Promise<JumpToTimestampResult>
}

const RuntimeBridgeContext = createContext<RuntimeBridgeContextValue | null>(null)

type ExtensionProvidersProps = PropsWithChildren<{
  surface: ExtensionSurfaceName
}>

export function ExtensionProviders({
  surface,
  children
}: ExtensionProvidersProps) {
  const value = useMemo(() => SURFACE_CONFIG[surface], [surface])
  const [status, setStatus] = useState<RuntimeStatus>(surface === "options" ? "idle" : "loading")
  const [videoContext, setVideoContext] = useState<CurrentVideoContext>(EMPTY_CONTEXT)
  const [lastError, setLastError] = useState<string | null>(null)

  const handleResponse = useCallback(
    (response: RuntimeResponseMessage | RuntimeMessageParseError) => {
      if (response.ok === false) {
        setStatus("error")
        setLastError(response.error)
        return response
      }

      setLastError(null)

      if (response.type === GET_ACTIVE_VIDEO_CONTEXT || response.type === ANALYZE_VIDEO) {
        // Zod schema parses to a structural object; cast to the canonical
        // CurrentVideoContext type used by the rest of the app.
        setVideoContext(response.context as unknown as CurrentVideoContext)
        setStatus("ready")
      }

      return response
    },
    []
  )

  const refreshCurrentVideo = useCallback(async () => {
    setStatus("loading")
    const response = await sendRuntimeMessage({
      channel: "yt-summarizer/runtime",
      type: GET_ACTIVE_VIDEO_CONTEXT
    })

    handleResponse(response)
  }, [handleResponse])

  const openSidepanel = useCallback(async () => {
    const response = await sendRuntimeMessage({
      channel: "yt-summarizer/runtime",
      type: OPEN_SIDEPANEL
    })

    handleResponse(response)
  }, [handleResponse])

  const requestAnalysis = useCallback(async () => {
    const response = await sendRuntimeMessage({
      channel: "yt-summarizer/runtime",
      type: ANALYZE_VIDEO
    })

    handleResponse(response)
  }, [handleResponse])

  const jumpToTimestamp = useCallback(
    async (videoId: string, timestampSeconds: number): Promise<JumpToTimestampResult> => {
      const response = await sendRuntimeMessage({
        channel: "yt-summarizer/runtime",
        type: JUMP_TO_TIMESTAMP,
        videoId,
        timestampSeconds
      })

      handleResponse(response)
      return deriveJumpToTimestampResult(response)
    },
    [handleResponse]
  )

  useEffect(() => {
    if (surface === "options") {
      return
    }

    void refreshCurrentVideo()
  }, [refreshCurrentVideo, surface])

  const runtimeValue = useMemo<RuntimeBridgeContextValue>(
    () => ({
      status,
      videoContext,
      lastError,
      refreshCurrentVideo,
      openSidepanel,
      requestAnalysis,
      jumpToTimestamp
    }),
    [jumpToTimestamp, lastError, openSidepanel, refreshCurrentVideo, requestAnalysis, status, videoContext]
  )

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

  if (!context) {
    throw new Error("useExtensionSurface must be used within ExtensionProviders")
  }

  return context
}

export function useRuntimeBridge() {
  const context = useContext(RuntimeBridgeContext)

  if (!context) {
    throw new Error("useRuntimeBridge must be used within ExtensionProviders")
  }

  return context
}
