import {
  DEFAULT_ANALYSIS_BUDGET_POLICY,
  AnalysisInputBudgetExceededError,
  validateAnalysisBudgetPolicy,
  type AnalysisBudgetPolicy
} from "@/features/analysis/lib/analysis-budget"
import {
  finalAnalysisPromptFits,
  planReductionGroups,
  planTranscriptChunks,
  promptMessages,
  repairPromptFitsBudget,
  selectAnalysisStrategy,
  type AnalysisStrategy
} from "@/features/analysis/lib/analysis-plan"
import {
  DEFAULT_ANALYSIS_PRESET_STRATEGY,
  type AnalysisPresetStrategy
} from "@/features/analysis/lib/analysis-preset"
import type { VideoAnalysis } from "@/features/analysis/lib/analysis-schema"
import {
  createOpenAICompatibleClient,
  OpenAICompatibleClientError
} from "@/features/analysis/lib/openai-compatible-client"
import { normalizeVideoAnalysis } from "@/features/analysis/lib/normalize-video-analysis"
import { parseVideoAnalysisPayload } from "@/features/analysis/lib/parse-video-analysis"
import {
  buildChunkAnalysisPrompt,
  buildDirectAnalysisPrompt,
  buildFinalAnalysisPrompt,
  buildSummaryReductionPrompt,
  type AnalysisPrompt,
  type EvidenceSummary
} from "@/features/analysis/lib/prompts"
import { buildVideoAnalysisRepairPrompt } from "@/features/analysis/lib/structured-output-repair"
import type { ProviderConnectionInput } from "@/features/settings/lib/provider-schema"
import type { TranscriptCue } from "@/features/transcript/lib/transcript-schema"

type AnalysisClient = ReturnType<typeof createOpenAICompatibleClient>

/** Content-free progress events for UI and future phase-aware recovery. */
export type AnalysisProgressEvent =
  | { kind: "direct" }
  | { kind: "map"; completed: number; total: number }
  | { kind: "reduction"; level: number; completed: number; total: number }
  | { kind: "final" }
  | { kind: "repair" }

export type RunAnalysisOptions = {
  provider: ProviderConnectionInput
  transcript: {
    videoId: string
    title?: string | null
    cues: TranscriptCue[]
    durationSec?: number | null
  }
  /** Immutable preset strategy captured into the running task's snapshot. */
  preset?: AnalysisPresetStrategy | null
  budgetPolicy?: AnalysisBudgetPolicy
  client?: AnalysisClient
  signal?: AbortSignal
  /** Emits stage names and integer counters only, without provider or transcript text. */
  onProgress?: (event: AnalysisProgressEvent) => void
}

export class AnalysisAbortedError extends Error {
  constructor(message = "Analysis was cancelled before it finished.") {
    super(message)
    this.name = "AnalysisAbortedError"
  }
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new AnalysisAbortedError()
}

function emitProgress(options: RunAnalysisOptions, event: AnalysisProgressEvent) {
  throwIfAborted(options.signal)
  options.onProgress?.(event)
  throwIfAborted(options.signal)
}

export type ChunkAnalysisResult = EvidenceSummary

export type RunAnalysisResult = {
  videoId: string
  strategy: AnalysisStrategy
  initialChunkCount: number
  reductionLevels: number
  chunkSummaries: ChunkAnalysisResult[]
  analysis: VideoAnalysis
  rawResponse: string
  repairAttempted: boolean
}

export async function runAnalysis(options: RunAnalysisOptions): Promise<RunAnalysisResult> {
  if (options.transcript.cues.length === 0) {
    throw new Error("Transcript cues are required to run analysis.")
  }

  const budgetPolicy = options.budgetPolicy ?? DEFAULT_ANALYSIS_BUDGET_POLICY
  validateAnalysisBudgetPolicy(budgetPolicy)
  const preset = options.preset ?? DEFAULT_ANALYSIS_PRESET_STRATEGY
  const strategy = selectAnalysisStrategy({
    videoTitle: options.transcript.title,
    cues: options.transcript.cues,
    budgetPolicy,
    preset
  })
  const client = options.client ?? createOpenAICompatibleClient(options.provider)
  const { signal } = options
  throwIfAborted(signal)

  if (strategy === "single-pass") {
    const prompt = buildDirectAnalysisPrompt({
      videoTitle: options.transcript.title,
      cues: options.transcript.cues,
      preset
    })
    emitProgress(options, { kind: "direct" })
    const structured = await requestStructuredAnalysis({ client, prompt, options })
    return {
      videoId: options.transcript.videoId,
      strategy,
      initialChunkCount: 0,
      reductionLevels: 0,
      chunkSummaries: [],
      ...structured
    }
  }

  const chunks = planTranscriptChunks({
    videoTitle: options.transcript.title,
    cues: options.transcript.cues,
    budgetPolicy,
    preset
  })
  const chunkSummaries: ChunkAnalysisResult[] = []
  emitProgress(options, { kind: "map", completed: 0, total: chunks.length })

  for (const [chunkIndex, chunk] of chunks.entries()) {
    throwIfAborted(signal)
    const prompt = buildChunkAnalysisPrompt({
      chunk,
      videoTitle: options.transcript.title,
      preset
    })
    const summary = await requestCompletion(client, {
      messages: promptMessages(prompt),
      signal
    }, signal)
    chunkSummaries.push({
      chunkId: chunk.id,
      startSec: chunk.startSec,
      endSec: chunk.endSec,
      summary
    })
    emitProgress(options, { kind: "map", completed: chunkIndex + 1, total: chunks.length })
  }

  let survivingSummaries: EvidenceSummary[] = chunkSummaries
  let reductionLevels = 0
  while (!finalAnalysisPromptFits({
    videoTitle: options.transcript.title,
    summaries: survivingSummaries,
    budgetPolicy,
    preset
  })) {
    const nextLevel = reductionLevels + 1
    const groups = planReductionGroups({
      level: nextLevel,
      summaries: survivingSummaries,
      budgetPolicy,
      preset
    })
    const reduced: EvidenceSummary[] = []
    emitProgress(options, { kind: "reduction", level: nextLevel, completed: 0, total: groups.length })
    for (const [groupIndex, group] of groups.entries()) {
      throwIfAborted(signal)
      if (group.length === 1) {
        reduced.push(group[0])
        emitProgress(options, {
          kind: "reduction", level: nextLevel, completed: groupIndex + 1, total: groups.length
        })
        continue
      }

      const prompt = buildSummaryReductionPrompt({ level: nextLevel, summaries: group, preset })
      const summary = await requestCompletion(client, {
        messages: promptMessages(prompt),
        signal
      }, signal)
      reduced.push({
        chunkId: `reduction-${nextLevel}-${groupIndex + 1}`,
        startSec: Math.min(...group.map((node) => node.startSec)),
        endSec: Math.max(...group.map((node) => node.endSec)),
        summary
      })
      emitProgress(options, {
        kind: "reduction", level: nextLevel, completed: groupIndex + 1, total: groups.length
      })
    }
    if (reduced.length >= survivingSummaries.length) {
      throw new Error("Reduction budget is too small to make progress safely.")
    }
    survivingSummaries = reduced
    reductionLevels = nextLevel
  }

  const finalPrompt = buildFinalAnalysisPrompt({
    videoTitle: options.transcript.title,
    chunkSummaries: survivingSummaries,
    preset
  })
  emitProgress(options, { kind: "final" })
  const structured = await requestStructuredAnalysis({ client, prompt: finalPrompt, options })
  return {
    videoId: options.transcript.videoId,
    strategy,
    initialChunkCount: chunks.length,
    reductionLevels,
    chunkSummaries,
    ...structured
  }
}

async function requestStructuredAnalysis(input: {
  client: AnalysisClient
  prompt: AnalysisPrompt
  options: RunAnalysisOptions
}): Promise<Pick<RunAnalysisResult, "analysis" | "rawResponse" | "repairAttempted">> {
  const { signal } = input.options
  throwIfAborted(signal)
  let rawResponse = await requestCompletion(input.client, {
    messages: promptMessages(input.prompt),
    signal
  }, signal)
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

function parseAndNormalize(rawResponse: string, options: RunAnalysisOptions) {
  return normalizeVideoAnalysis(parseVideoAnalysisPayload(rawResponse), {
    transcriptCues: options.transcript.cues,
    durationSec: options.transcript.durationSec
  })
}

async function requestCompletion(
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
