import {
  AnalysisInputBudgetExceededError,
  deriveAnalysisInputBudget,
  deriveRepairInputBudget,
  ReductionCannotProgressError,
  type AnalysisBudgetPolicy
} from "@/features/analysis/lib/analysis-budget"
import {
  createTranscriptChunk,
  type TranscriptChunk
} from "@/features/analysis/lib/chunk-transcript"
import {
  buildChunkAnalysisPrompt,
  buildDirectAnalysisPrompt,
  buildFinalAnalysisPrompt,
  buildSummaryReductionPrompt,
  type AnalysisPrompt,
  type EvidenceSummary
} from "@/features/analysis/lib/prompts"
import { estimateChatPromptTokens } from "@/features/analysis/lib/token-estimate"
import type { TranscriptCue } from "@/features/transcript/lib/transcript-schema"

export type AnalysisStrategy = "single-pass" | "map-reduce"

export function promptMessages(prompt: AnalysisPrompt) {
  return [
    { role: "system" as const, content: prompt.systemPrompt },
    { role: "user" as const, content: prompt.userPrompt }
  ]
}

export function promptFitsBudget(prompt: AnalysisPrompt, policy: AnalysisBudgetPolicy): boolean {
  return estimateChatPromptTokens(promptMessages(prompt)) <= deriveAnalysisInputBudget(policy)
}

export function repairPromptFitsBudget(
  prompt: AnalysisPrompt,
  policy: AnalysisBudgetPolicy
): boolean {
  return estimateChatPromptTokens(promptMessages(prompt)) <= deriveRepairInputBudget(policy)
}

export function selectAnalysisStrategy(input: {
  videoTitle?: string | null
  cues: TranscriptCue[]
  budgetPolicy: AnalysisBudgetPolicy
}): AnalysisStrategy {
  const prompt = buildDirectAnalysisPrompt({
    videoTitle: input.videoTitle,
    cues: input.cues
  })
  return promptFitsBudget(prompt, input.budgetPolicy) ? "single-pass" : "map-reduce"
}

export function planTranscriptChunks(input: {
  videoTitle?: string | null
  cues: TranscriptCue[]
  budgetPolicy: AnalysisBudgetPolicy
}): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = []
  let currentCues: TranscriptCue[] = []

  for (const cue of input.cues) {
    const candidateCues = [...currentCues, cue]
    const candidateChunk = createTranscriptChunk(chunks.length, candidateCues)
    const candidatePrompt = buildChunkAnalysisPrompt({
      chunk: candidateChunk,
      videoTitle: input.videoTitle
    })

    if (promptFitsBudget(candidatePrompt, input.budgetPolicy)) {
      currentCues = candidateCues
      continue
    }

    if (currentCues.length === 0) {
      throw new AnalysisInputBudgetExceededError(
        "A single transcript segment exceeds the safe analysis input budget."
      )
    }

    chunks.push(createTranscriptChunk(chunks.length, currentCues))
    currentCues = [cue]
    const singleCuePrompt = buildChunkAnalysisPrompt({
      chunk: createTranscriptChunk(chunks.length, currentCues),
      videoTitle: input.videoTitle
    })
    if (!promptFitsBudget(singleCuePrompt, input.budgetPolicy)) {
      throw new AnalysisInputBudgetExceededError(
        "A single transcript segment exceeds the safe analysis input budget."
      )
    }
  }

  if (currentCues.length > 0) {
    chunks.push(createTranscriptChunk(chunks.length, currentCues))
  }
  return chunks
}

export function finalAnalysisPromptFits(input: {
  videoTitle?: string | null
  summaries: EvidenceSummary[]
  budgetPolicy: AnalysisBudgetPolicy
}): boolean {
  return promptFitsBudget(
    buildFinalAnalysisPrompt({
      videoTitle: input.videoTitle,
      chunkSummaries: input.summaries
    }),
    input.budgetPolicy
  )
}

export function planReductionGroups(input: {
  level: number
  summaries: EvidenceSummary[]
  budgetPolicy: AnalysisBudgetPolicy
}): EvidenceSummary[][] {
  const groups: EvidenceSummary[][] = []
  let current: EvidenceSummary[] = []

  for (const summary of input.summaries) {
    const candidate = [...current, summary]
    const candidatePrompt = buildSummaryReductionPrompt({
      level: input.level,
      summaries: candidate
    })
    if (promptFitsBudget(candidatePrompt, input.budgetPolicy)) {
      current = candidate
      continue
    }

    if (current.length === 0) {
      throw new AnalysisInputBudgetExceededError(
        "A partial analysis exceeds the safe reduction input budget."
      )
    }

    groups.push(current)
    current = [summary]
    const singleSummaryPrompt = buildSummaryReductionPrompt({
      level: input.level,
      summaries: current
    })
    if (!promptFitsBudget(singleSummaryPrompt, input.budgetPolicy)) {
      throw new AnalysisInputBudgetExceededError(
        "A partial analysis exceeds the safe reduction input budget."
      )
    }
  }

  if (current.length > 0) groups.push(current)
  if (groups.every((group) => group.length === 1)) {
    throw new ReductionCannotProgressError()
  }
  return groups
}
