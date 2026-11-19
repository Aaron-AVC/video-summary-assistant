import {
  DEFAULT_ANALYSIS_BUDGET_POLICY,
  validateAnalysisBudgetPolicy,
  type AnalysisBudgetPolicy
} from "@/features/analysis/lib/analysis-budget"
import {
  DEFAULT_ANALYSIS_PRESET_STRATEGY,
  type AnalysisPresetStrategy
} from "@/features/analysis/lib/analysis-preset"
import { createOpenAICompatibleClient } from "@/features/analysis/lib/openai-compatible-client"
import type { AnalysisPrompt, EvidenceSummary } from "@/features/analysis/lib/prompts"
import type { RunAnalysisResult } from "@/features/analysis/lib/run-analysis"
import {
  AnalysisAbortedError,
  emitProgress,
  requestStructuredAnalysis,
  throwIfAborted,
  type AnalysisClient,
  type AnalysisProgressEvent
} from "@/features/analysis/lib/structured-analysis"
import type { ProviderConnectionInput } from "@/features/settings/lib/provider-schema"
import type { TranscriptCue } from "@/features/transcript/lib/transcript-schema"

/**
 * The frozen execution material a resume may reuse. It comes from the M2
 * in-memory checkpoint payload and is validated again before any request is
 * issued; nothing here is invented during resume.
 */
export type FinalOnlyExecution = {
  strategy: "map-reduce"
  initialChunkCount: number
  reductionLevels: number
  chunkSummaries: EvidenceSummary[]
  finalPrompt: AnalysisPrompt
}

export type RunFinalOnlyAnalysisOptions = {
  provider: ProviderConnectionInput
  transcript: {
    videoId: string
    title?: string | null
    cues: TranscriptCue[]
    durationSec?: number | null
  }
  preset?: AnalysisPresetStrategy | null
  budgetPolicy?: AnalysisBudgetPolicy
  client?: AnalysisClient
  signal?: AbortSignal
  onProgress?: (event: AnalysisProgressEvent) => void
  /** Frozen Final input taken from an already validated resume checkpoint. */
  execution: FinalOnlyExecution
  /**
   * Called as soon as the first Final response body arrives. A returned response
   * ends transient-failure eligibility even when parsing or Repair later fails.
   */
  onFinalResponseReceived?: () => void
  /** Called with the first Final request failure, before it propagates. */
  onFinalRequestError?: (error: unknown) => Promise<void> | void
}

/**
 * Executes only the structured Final stage of an existing map-reduce plan.
 *
 * Map and Reduction are never re-run here: the caller must already own a
 * validated checkpoint whose frozen summaries produced `execution.finalPrompt`.
 * Request shaping, JSON parsing, schema validation, cue normalization, the
 * single Repair attempt and abort behaviour come from the same shared
 * structured-analysis helpers a full run uses, so the two paths cannot drift.
 */
export async function runFinalOnlyAnalysis(
  options: RunFinalOnlyAnalysisOptions,
): Promise<RunAnalysisResult> {
  const { execution } = options
  if (options.transcript.cues.length === 0) {
    throw new Error("Transcript cues are required to resume final analysis.")
  }
  if (execution.chunkSummaries.length === 0) {
    throw new Error("A resume requires frozen map summaries.")
  }
  if (!execution.finalPrompt.systemPrompt || !execution.finalPrompt.userPrompt) {
    throw new Error("A resume requires the frozen final prompt.")
  }

  const budgetPolicy = options.budgetPolicy ?? DEFAULT_ANALYSIS_BUDGET_POLICY
  validateAnalysisBudgetPolicy(budgetPolicy)
  const preset = options.preset ?? DEFAULT_ANALYSIS_PRESET_STRATEGY
  const client = options.client ?? createOpenAICompatibleClient(options.provider)
  const { signal } = options
  throwIfAborted(signal)

  emitProgress(options, { kind: "final" })
  const structured = await requestStructuredAnalysis({
    client,
    prompt: execution.finalPrompt,
    options: { ...options, budgetPolicy, preset },
    ...(options.onFinalResponseReceived
      ? { onInitialResponse: options.onFinalResponseReceived }
      : {}),
    ...(options.onFinalRequestError
      ? { onInitialError: options.onFinalRequestError }
      : {}),
  })

  return {
    videoId: options.transcript.videoId,
    strategy: execution.strategy,
    initialChunkCount: execution.initialChunkCount,
    reductionLevels: execution.reductionLevels,
    chunkSummaries: execution.chunkSummaries,
    ...structured,
  }
}

export { AnalysisAbortedError }
