import {
  DEFAULT_ANALYSIS_BUDGET_POLICY,
  AnalysisInputBudgetExceededError,
  type AnalysisBudgetPolicy
} from "@/features/analysis/lib/analysis-budget"
import {
  promptMessages,
  repairPromptFitsBudget
} from "@/features/analysis/lib/analysis-plan"
import type { AnalysisPrompt } from "@/features/analysis/lib/prompts"
import type { AnalysisPresetStrategy } from "@/features/analysis/lib/analysis-preset"
import {
  createOpenAICompatibleClient,
  OpenAICompatibleClientError
} from "@/features/analysis/lib/openai-compatible-client"
import { normalizeVideoAnalysis } from "@/features/analysis/lib/normalize-video-analysis"
import { parseVideoAnalysisPayload } from "@/features/analysis/lib/parse-video-analysis"
import { buildVideoAnalysisRepairPrompt } from "@/features/analysis/lib/structured-output-repair"
import type { VideoAnalysis } from "@/features/analysis/lib/analysis-schema"
import type { TranscriptCue } from "@/features/transcript/lib/transcript-schema"

export type AnalysisClient = ReturnType<typeof createOpenAICompatibleClient>

/** Content-free progress events for UI and phase-aware recovery. */
export type AnalysisProgressEvent =
  | { kind: "direct" }
  | { kind: "map"; completed: number; total: number }
  | { kind: "reduction"; level: number; completed: number; total: number }
  | { kind: "final" }
  | { kind: "repair" }

export class AnalysisAbortedError extends Error {
  constructor(message = "Analysis was cancelled before it finished.") {
    super(message)
    this.name = "AnalysisAbortedError"
  }
}

/**
 * The subset of analysis options a structured request needs. Both a full run and
 * the Final-only resume satisfy it, so parsing, schema validation, cue
 * normalization, the single Repair attempt and abort behaviour cannot drift.
 */
export type StructuredAnalysisContext = {
  transcript: {
    cues: TranscriptCue[]
    durationSec?: number | null
  }
  preset?: AnalysisPresetStrategy | null
  budgetPolicy?: AnalysisBudgetPolicy
  signal?: AbortSignal
  onProgress?: (event: AnalysisProgressEvent) => void
}

export type StructuredAnalysisOutcome = {
  analysis: VideoAnalysis
  rawResponse: string
  repairAttempted: boolean
}

export function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new AnalysisAbortedError()
}

export function emitProgress(
  options: Pick<StructuredAnalysisContext, "signal" | "onProgress">,
  event: AnalysisProgressEvent,
) {
  throwIfAborted(options.signal)
  options.onProgress?.(event)
  throwIfAborted(options.signal)
}

/**
 * One structured request plus the existing single Repair attempt.
 *
 * `onInitialResponse` fires after a response body arrives and before parsing, so
 * a returned response ends transient-failure eligibility even when parsing or
 * Repair later fails. `onInitialError` observes the first request failure before
 * it propagates. Neither hook can issue another request.
 */
export async function requestStructuredAnalysis(input: {
  client: AnalysisClient
  prompt: AnalysisPrompt
  options: StructuredAnalysisContext
  onInitialResponse?: () => void
  onInitialError?: (error: unknown) => Promise<void> | void
}): Promise<StructuredAnalysisOutcome> {
  const { signal } = input.options
  throwIfAborted(signal)
  let rawResponse: string
  try {
    rawResponse = await requestCompletion(input.client, {
      messages: promptMessages(input.prompt),
      signal
    }, signal)
  } catch (error) {
    await input.onInitialError?.(error)
    throw error
  }
  // A response ends Final-request eligibility even when parsing or Repair later fails.
  input.onInitialResponse?.()
  let repairAttempted = false
  try {
    return {
      analysis: parseAndNormalize(rawResponse, input.options),
      rawResponse,
      repairAttempted
    }
  } catch (initialError) {
    throwIfAborted(signal)
    repairAttempted = true
    const repairPrompt = buildVideoAnalysisRepairPrompt({
      originalTask: input.prompt.userPrompt,
      validationError: initialError,
      previousResponse: rawResponse,
      preset: input.options.preset
    })
    const budgetPolicy = input.options.budgetPolicy ?? DEFAULT_ANALYSIS_BUDGET_POLICY
    if (!repairPromptFitsBudget(repairPrompt, budgetPolicy)) {
      throw new AnalysisInputBudgetExceededError(
        "Structured repair exceeds the safe analysis input budget."
      )
    }
    try {
      throwIfAborted(signal)
      emitProgress(input.options, { kind: "repair" })
      rawResponse = await requestCompletion(input.client, {
        messages: promptMessages(repairPrompt),
        signal
      }, signal)
      return {
        analysis: parseAndNormalize(rawResponse, input.options),
        rawResponse,
        repairAttempted
      }
    } catch (repairError) {
      if (repairError instanceof AnalysisAbortedError || signal?.aborted) {
        throw new AnalysisAbortedError()
      }
      if (repairError instanceof OpenAICompatibleClientError) throw repairError
      const issue = repairError instanceof Error ? repairError.message : "invalid schema"
      throw new Error(
        `Provider returned invalid structured video analysis after one repair attempt. ${issue}`
      )
    }
  }
}

function parseAndNormalize(
  rawResponse: string,
  options: Pick<StructuredAnalysisContext, "transcript">,
) {
  return normalizeVideoAnalysis(parseVideoAnalysisPayload(rawResponse), {
    transcriptCues: options.transcript.cues,
    durationSec: options.transcript.durationSec
  })
}

export async function requestCompletion(
  client: AnalysisClient,
  request: Parameters<AnalysisClient["createChatCompletion"]>[0],
  signal: AbortSignal | undefined
) {
  try {
    return await client.createChatCompletion(request)
  } catch (error) {
    if (signal?.aborted) throw new AnalysisAbortedError()
    throw error
  }
}
