const STORAGE_KEY = "yt-summarizer.transcript-log"
const MAX_ENTRIES = 20

export type TranscriptLogStep = {
  step: string
  durationMs: number
  ok: boolean
  skipped?: boolean
  error?: string
  details?: string
}

export type TranscriptLogEntry = {
  videoId: string
  pageUrl: string
  timestamp: string
  outcome: "success" | "all_failed"
  successStep?: string
  steps: TranscriptLogStep[]
}

export type TranscriptLogCollector = {
  logStep: <T>(
    stepName: string,
    fn: () => Promise<T>,
    details?: string | (() => string),
  ) => Promise<T>
  skipStep: (stepName: string, reason: string) => void
  finalize: (outcome: "success" | "all_failed", successStep?: string) => void
}

export function createLogCollector(
  videoId: string,
  pageUrl: string,
): TranscriptLogCollector {
  const steps: TranscriptLogStep[] = []
  let finalized = false

  return {
    async logStep<T>(
      stepName: string,
      fn: () => Promise<T>,
      details?: string | (() => string),
    ): Promise<T> {
      const start = performance.now()
      const resolveDetails = () => typeof details === "function" ? details() : details
      try {
        const result = await fn()
        const durationMs = Math.round(performance.now() - start)

        // Detect { ok: false, error: ... } result objects from fetchers
        const resultObj = result as Record<string, unknown> | null
        const isFailResult = resultObj !== null && typeof resultObj === "object" && resultObj.ok === false
        const errorMessage = isFailResult && resultObj.error
          ? extractErrorMessage(resultObj.error)
          : undefined

        steps.push({
          step: stepName,
          durationMs,
          ok: !isFailResult,
          error: errorMessage,
          details: resolveDetails(),
        })
        return result
      } catch (error) {
        steps.push({
          step: stepName,
          durationMs: Math.round(performance.now() - start),
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          details: resolveDetails(),
        })
        throw error
      }
    },

    skipStep(stepName: string, reason: string) {
      steps.push({
        step: stepName,
        durationMs: 0,
        ok: false,
        skipped: true,
        details: reason,
      })
    },

    finalize(outcome: "success" | "all_failed", successStep?: string) {
      if (finalized) return
      finalized = true

      const entry: TranscriptLogEntry = {
        videoId,
        pageUrl,
        timestamp: new Date().toISOString(),
        outcome,
        successStep,
        steps: [...steps],
      }

      void saveTranscriptLog(entry)
    },
  }
}

function extractErrorMessage(error: unknown): string {
  if (typeof error === "string") return error
  if (error && typeof error === "object") {
    const obj = error as Record<string, unknown>
    if (typeof obj.details === "string") return obj.details
    if (typeof obj.message === "string") return obj.message
  }
  return String(error)
}

export async function saveTranscriptLog(entry: TranscriptLogEntry): Promise<void> {
  try {
    const storage = globalThis.chrome?.storage?.local
    if (!storage) return

    const data = await storage.get(STORAGE_KEY)
    const existing: TranscriptLogEntry[] = Array.isArray(data[STORAGE_KEY])
      ? data[STORAGE_KEY]
      : []

    existing.unshift(entry)

    if (existing.length > MAX_ENTRIES) {
      existing.length = MAX_ENTRIES
    }

    await storage.set({ [STORAGE_KEY]: existing })
  } catch {
    // Silent fail — logging should never break the app
  }
}

export async function getTranscriptLogs(): Promise<TranscriptLogEntry[]> {
  try {
    const storage = globalThis.chrome?.storage?.local
    if (!storage) return []

    const data = await storage.get(STORAGE_KEY)
    return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : []
  } catch {
    return []
  }
}

export async function clearTranscriptLogs(): Promise<void> {
  try {
    const storage = globalThis.chrome?.storage?.local
    if (!storage) return

    await storage.remove(STORAGE_KEY)
  } catch {
    // Silent fail
  }
}
