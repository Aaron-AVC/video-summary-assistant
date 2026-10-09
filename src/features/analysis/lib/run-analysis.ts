import type { VideoAnalysis } from "@/features/analysis/lib/analysis-schema"
import { chunkTranscript, type ChunkTranscriptOptions } from "@/features/analysis/lib/chunk-transcript"
import {
  buildChunkAnalysisPrompt,
  buildFinalAnalysisPrompt
} from "@/features/analysis/lib/prompts"
import { normalizeVideoAnalysis } from "@/features/analysis/lib/normalize-video-analysis"
import { parseVideoAnalysisPayload } from "@/features/analysis/lib/parse-video-analysis"
import { buildVideoAnalysisRepairPrompt } from "@/features/analysis/lib/structured-output-repair"
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
    durationSec?: number | null
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
  analysis: VideoAnalysis
  rawResponse: string
  repairAttempted: boolean
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

  let rawResponse = await client.createChatCompletion({
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
  let repairAttempted = false
  let analysis: VideoAnalysis
  try {
    analysis = normalizeVideoAnalysis(parseVideoAnalysisPayload(rawResponse), {
      transcriptCues: options.transcript.cues,
      durationSec: options.transcript.durationSec
    })
  } catch (initialError) {
    throwIfAborted(signal)
    repairAttempted = true
    const repairPrompt = buildVideoAnalysisRepairPrompt({
      originalTask: finalPrompt.userPrompt,
      validationError: initialError,
      previousResponse: rawResponse
    })
    try {
      rawResponse = await client.createChatCompletion({
        messages: [
          { role: "system", content: repairPrompt.systemPrompt },
          { role: "user", content: repairPrompt.userPrompt }
        ],
        responseFormat: "json_object",
        signal
      })
      analysis = normalizeVideoAnalysis(parseVideoAnalysisPayload(rawResponse), {
        transcriptCues: options.transcript.cues,
        durationSec: options.transcript.durationSec
      })
    } catch (repairError) {
      if (repairError instanceof AnalysisAbortedError || signal?.aborted) throw repairError
      const issue = repairError instanceof Error ? repairError.message : "invalid schema"
      throw new Error(`Provider returned invalid structured video analysis after one repair attempt. ${issue}`)
    }
  }

  return {
    videoId: options.transcript.videoId,
    chunkSummaries,
    analysis,
    rawResponse,
    repairAttempted
  }
}
