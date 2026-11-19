import {
  DEFAULT_ANALYSIS_BUDGET_POLICY,
  validateAnalysisBudgetPolicy,
  type AnalysisBudgetPolicy
} from "@/features/analysis/lib/analysis-budget"
import {
  finalAnalysisPromptFits,
  planReductionGroups,
  planTranscriptChunks,
  promptMessages,
  selectAnalysisStrategy,
  type AnalysisStrategy
} from "@/features/analysis/lib/analysis-plan"
import { createTranscriptChunkCueRanges } from "@/features/analysis/lib/chunk-transcript"
import type { FinalCheckpointExecution } from "@/features/analysis/lib/final-resume-checkpoint"
import {
  DEFAULT_ANALYSIS_PRESET_STRATEGY,
  type AnalysisPresetStrategy
} from "@/features/analysis/lib/analysis-preset"
import type { VideoAnalysis } from "@/features/analysis/lib/analysis-schema"
import { createOpenAICompatibleClient } from "@/features/analysis/lib/openai-compatible-client"
import {
  buildChunkAnalysisPrompt,
  buildDirectAnalysisPrompt,
  buildFinalAnalysisPrompt,
  buildSummaryReductionPrompt,
  type EvidenceSummary
} from "@/features/analysis/lib/prompts"
import {
  AnalysisAbortedError,
  emitProgress,
  requestCompletion,
  requestStructuredAnalysis,
  throwIfAborted,
  type AnalysisClient,
  type AnalysisProgressEvent
} from "@/features/analysis/lib/structured-analysis"
import type { ProviderConnectionInput } from "@/features/settings/lib/provider-schema"
import type { TranscriptCue } from "@/features/transcript/lib/transcript-schema"

export { AnalysisAbortedError }
export type { AnalysisProgressEvent }

export type FinalAnalysisCheckpointCandidate = Omit<FinalCheckpointExecution, "videoId">

export type FinalAnalysisCheckpointHooks = {
  prepareFinalCandidate: (candidate: FinalAnalysisCheckpointCandidate) => Promise<boolean>
  promoteFinalFailure: (error: unknown) => Promise<boolean>
  discardFinalCandidate: () => void
}

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
  /** Optional in-memory M2 seam; it never retries or issues a provider request itself. */
  finalCheckpoint?: FinalAnalysisCheckpointHooks
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
  let survivingMapChunkIds = chunkSummaries.map((summary) => [summary.chunkId])
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
    const reducedMapChunkIds: string[][] = []
    let groupOffset = 0
    emitProgress(options, { kind: "reduction", level: nextLevel, completed: 0, total: groups.length })
    for (const [groupIndex, group] of groups.entries()) {
      throwIfAborted(signal)
      const mapChunkIds = survivingMapChunkIds.slice(groupOffset, groupOffset + group.length).flat()
      groupOffset += group.length
      reducedMapChunkIds.push(mapChunkIds)
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
    if (groupOffset !== survivingSummaries.length) {
      throw new Error("Reduction groups did not cover the planned summaries.")
    }
    survivingSummaries = reduced
    survivingMapChunkIds = reducedMapChunkIds
    reductionLevels = nextLevel
  }

  const finalPrompt = buildFinalAnalysisPrompt({
    videoTitle: options.transcript.title,
    chunkSummaries: survivingSummaries,
    preset
  })
  const chunkCueRanges = createTranscriptChunkCueRanges(chunks)
  let checkpointPrepared = false
  if (options.finalCheckpoint) {
    try {
      checkpointPrepared = await options.finalCheckpoint.prepareFinalCandidate({
        strategy,
        initialChunkCount: chunks.length,
        reductionLevels,
        mapPlan: chunks.map(({ id, index, startSec, endSec }, chunkIndex) => ({
          id,
          index,
          startSec,
          endSec,
          ...chunkCueRanges[chunkIndex]!,
        })),
        chunkSummaries,
        finalInputSummaries: survivingSummaries,
        finalInputMapChunkIds: survivingMapChunkIds,
        finalPrompt
      })
    } catch {
      checkpointPrepared = false
      options.finalCheckpoint.discardFinalCandidate()
    }
  }
  emitProgress(options, { kind: "final" })
  const structured = await requestStructuredAnalysis({
    client,
    prompt: finalPrompt,
    options,
    onInitialResponse: () => {
      if (checkpointPrepared) options.finalCheckpoint?.discardFinalCandidate()
    },
    onInitialError: async (error) => {
      if (!checkpointPrepared || !options.finalCheckpoint) return
      try {
        await options.finalCheckpoint.promoteFinalFailure(error)
      } catch {
        options.finalCheckpoint.discardFinalCandidate()
      }
    }
  })
  return {
    videoId: options.transcript.videoId,
    strategy,
    initialChunkCount: chunks.length,
    reductionLevels,
    chunkSummaries,
    ...structured
  }
}
