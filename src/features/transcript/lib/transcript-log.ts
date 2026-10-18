import { redactTranscriptFetchUrls } from "./transcript-url-sanitizer"

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
          error: errorMessage ? redactTranscriptFetchUrls(errorMessage) : undefined,
          details: sanitizeOptionalText(resolveDetails()),
        })
        return result
      } catch (error) {
        steps.push({
          step: stepName,
          durationMs: Math.round(performance.now() - start),
          ok: false,
          error: redactTranscriptFetchUrls(error instanceof Error ? error.message : String(error)),
          details: sanitizeOptionalText(resolveDetails()),
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
        details: redactTranscriptFetchUrls(reason),
      })
    },

    finalize(outcome: "success" | "all_failed", successStep?: string) {
      if (finalized) return
      finalized = true

      const entry: TranscriptLogEntry = {
        videoId,
        pageUrl: redactTranscriptFetchUrls(pageUrl),
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
  if (typeof error === "string") return redactTranscriptFetchUrls(error)
  if (error && typeof error === "object") {
    const obj = error as Record<string, unknown>
    if (typeof obj.details === "string") return redactTranscriptFetchUrls(obj.details)
    if (typeof obj.message === "string") return redactTranscriptFetchUrls(obj.message)
  }
  return redactTranscriptFetchUrls(String(error))
}

function sanitizeOptionalText(value: string | undefined): string | undefined {
  return value === undefined ? undefined : redactTranscriptFetchUrls(value)
}

function sanitizeTranscriptLogEntry(entry: TranscriptLogEntry): TranscriptLogEntry {
  return {
    ...entry,
    pageUrl: redactTranscriptFetchUrls(entry.pageUrl),
    steps: entry.steps.map((step) => ({
      ...step,
      ...(step.error === undefined ? {} : { error: redactTranscriptFetchUrls(step.error) }),
      ...(step.details === undefined ? {} : { details: redactTranscriptFetchUrls(step.details) })
    }))
  }
}

export async function saveTranscriptLog(entry: TranscriptLogEntry): Promise<void> {
  try {
    const storage = globalThis.chrome?.storage?.local
    if (!storage) return

    const data = await storage.get(STORAGE_KEY)
    const existing: TranscriptLogEntry[] = Array.isArray(data[STORAGE_KEY])
      ? data[STORAGE_KEY]
      : []

    existing.unshift(sanitizeTranscriptLogEntry(entry))

    const sanitizedExisting = existing.map(sanitizeTranscriptLogEntry)

    if (sanitizedExisting.length > MAX_ENTRIES) {
      sanitizedExisting.length = MAX_ENTRIES
    }

    await storage.set({ [STORAGE_KEY]: sanitizedExisting })
  } catch {
    // Silent fail — logging should never break the app
  }
}

export async function getTranscriptLogs(): Promise<TranscriptLogEntry[]> {
  try {
    const storage = globalThis.chrome?.storage?.local
    if (!storage) return []

    const data = await storage.get(STORAGE_KEY)
    if (!Array.isArray(data[STORAGE_KEY])) return []
    const entries = data[STORAGE_KEY].map((entry: TranscriptLogEntry) => sanitizeTranscriptLogEntry(entry))
    try {
      await storage.set({ [STORAGE_KEY]: entries })
    } catch {
      // Keep sanitized logs available even when storage cleanup fails.
    }
    return entries
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
