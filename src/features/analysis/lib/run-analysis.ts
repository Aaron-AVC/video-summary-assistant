import type { AnalysisResult } from "@/features/analysis/lib/analysis-schema"
import { chunkTranscript, type ChunkTranscriptOptions } from "@/features/analysis/lib/chunk-transcript"
import {
  buildChunkAnalysisPrompt,
  buildFinalAnalysisPrompt
} from "@/features/analysis/lib/prompts"
import { repairAnalysisResult } from "@/features/analysis/lib/repair-analysis"
import { createOpenAICompatibleClient } from "@/features/analysis/lib/openai-compatible-client"
import type { ProviderConnectionInput } from "@/features/settings/lib/provider-schema"
import type { TranscriptCue } from "@/features/transcript/lib/transcript-schema"

type AnalysisClient = ReturnType<typeof createOpenAICompatibleClient>

export type RunAnalysisOptions = {
  provider: ProviderConnectionInput
  transcript: {
    videoId: string
    title?: string | null
    cues: TranscriptCue[]
  }
  chunking?: ChunkTranscriptOptions
  client?: AnalysisClient
  signal?: AbortSignal
}

export class AnalysisAbortedError extends Error {
  constructor(message = "Analysis was cancelled before it finished.") {
    super(message)
    this.name = "AnalysisAbortedError"
  }
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new AnalysisAbortedError()
  }
}

export type ChunkAnalysisResult = {
  chunkId: string
  startSec: number
  endSec: number
  summary: string
}

export type RunAnalysisResult = {
  videoId: string
  chunkSummaries: ChunkAnalysisResult[]
  analysis: AnalysisResult
  rawResponse: string
}

export async function runAnalysis(options: RunAnalysisOptions): Promise<RunAnalysisResult> {
  if (options.transcript.cues.length === 0) {
    throw new Error("Transcript cues are required to run analysis.")
  }

  const client = options.client ?? createOpenAICompatibleClient(options.provider)
  const chunks = chunkTranscript(options.transcript.cues, options.chunking)
  const chunkSummaries: ChunkAnalysisResult[] = []
  const { signal } = options

  for (const chunk of chunks) {
    throwIfAborted(signal)
    const prompt = buildChunkAnalysisPrompt({
      chunk,
      videoTitle: options.transcript.title
    })

    const summary = await client.createChatCompletion({
      messages: [
        {
          role: "system",
          content: prompt.systemPrompt
        },
        {
          role: "user",
          content: prompt.userPrompt
        }
      ],
      signal
    })

    chunkSummaries.push({
      chunkId: chunk.id,
      startSec: chunk.startSec,
      endSec: chunk.endSec,
      summary
    })
  }

  throwIfAborted(signal)

  const finalPrompt = buildFinalAnalysisPrompt({
    videoTitle: options.transcript.title,
    chunkSummaries
  })

  const rawResponse = await client.createChatCompletion({
    messages: [
      {
        role: "system",
        content: finalPrompt.systemPrompt
      },
      {
        role: "user",
        content: finalPrompt.userPrompt
      }
    ],
    responseFormat: "json_object",
    signal
  })
  const analysis = repairAnalysisResult(rawResponse, {
    transcriptCues: options.transcript.cues
  })

  return {
    videoId: options.transcript.videoId,
    chunkSummaries,
    analysis,
    rawResponse
  }
}
