import { describe, expect, it } from "bun:test"

import { createAnalysisPresetSnapshot } from "@/features/analysis/lib/analysis-preset"
import { OpenAICompatibleClientError } from "@/features/analysis/lib/openai-compatible-client"
import { buildFinalAnalysisPrompt, type EvidenceSummary } from "@/features/analysis/lib/prompts"
import { runFinalOnlyAnalysis } from "@/features/analysis/lib/run-final-only-analysis"
import type { RunAnalysisResult } from "@/features/analysis/lib/run-analysis"
import type { TranscriptCue } from "@/features/transcript/lib/transcript-schema"

const provider = {
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-fixture-never-real",
  model: "test-model",
  generationTimeoutSec: 120,
}

const cueFixture: TranscriptCue[] = [
  { startSec: 0, endSec: 10, text: "First cue." },
  { startSec: 10, endSec: 20, text: "Second cue." },
  { startSec: 20, endSec: 30, text: "Third cue." },
]

function summariesFixture(): EvidenceSummary[] {
  return [
    { chunkId: "chunk-1", startSec: 0, endSec: 20, summary: "Mapped first block." },
    { chunkId: "chunk-2", startSec: 20, endSec: 30, summary: "Mapped second block." },
  ]
}

function finalPromptFixture() {
  return buildFinalAnalysisPrompt({
    videoTitle: "Fixture Video",
    chunkSummaries: summariesFixture(),
    preset: createAnalysisPresetSnapshot("standard"),
  })
}

function validAnalysisJson(): string {
  return JSON.stringify({
    summary: "A concise summary.",
    keyPoints: [{ text: "First point.", startSec: 0, endSec: 10 }],
    chapters: [
      {
        title: "Chapter One",
        startSec: 0,
        endSec: 20,
        summary: "Chapter one summary.",
        detail: "Chapter one detail.",
      },
      {
        title: "Chapter Two",
        startSec: 20,
        endSec: 30,
        summary: "Chapter two summary.",
        detail: "Chapter two detail.",
      },
    ],
  })
}

type Call = { system: string; user: string }

function createClient(calls: Call[], responses: Array<string | Error>) {
  return {
    provider,
    createChatCompletion: async ({ messages }: {
      messages: Array<{ role: string; content: string }>
    }) => {
      calls.push({ system: messages[0]?.content ?? "", user: messages[1]?.content ?? "" })
      const next = responses.shift()
      if (next === undefined) throw new Error("unexpected extra request")
      if (next instanceof Error) throw next
      return next
    },
  }
}

function executionFixture() {
  return {
    strategy: "map-reduce" as const,
    initialChunkCount: 5,
    reductionLevels: 0,
    chunkSummaries: summariesFixture(),
    finalPrompt: finalPromptFixture(),
  }
}

describe("runFinalOnlyAnalysis", () => {
  it("issues exactly one Final request and preserves the original map-reduce shape", async () => {
    const calls: Call[] = []
    const result: RunAnalysisResult = await runFinalOnlyAnalysis({
      provider,
      transcript: {
        videoId: "video-1",
        title: "Fixture Video",
        cues: cueFixture,
        durationSec: 30,
      },
      preset: createAnalysisPresetSnapshot("standard"),
      client: createClient(calls, [validAnalysisJson()]) as never,
      execution: executionFixture(),
    })

    expect(calls).toHaveLength(1)
    expect(result.strategy).toBe("map-reduce")
    expect(result.initialChunkCount).toBe(5)
    expect(result.reductionLevels).toBe(0)
    expect(result.chunkSummaries).toEqual(summariesFixture())
    expect(result.analysis.chapters).toHaveLength(2)
    expect(result.repairAttempted).toBe(false)
    expect(calls[0]!.user).toBe(finalPromptFixture().userPrompt)
  })

  it("reports the final progress stage without emitting map or reduction events", async () => {
    const calls: Call[] = []
    const stages: string[] = []
    await runFinalOnlyAnalysis({
      provider,
      transcript: { videoId: "video-1", title: "Fixture Video", cues: cueFixture, durationSec: 30 },
      client: createClient(calls, [validAnalysisJson()]) as never,
      execution: executionFixture(),
      onProgress: (event) => stages.push(event.kind),
    })

    expect(stages).toEqual(["final"])
  })

  it("performs at most one repair after an invalid structure", async () => {
    const calls: Call[] = []
    const result = await runFinalOnlyAnalysis({
      provider,
      transcript: { videoId: "video-1", title: "Fixture Video", cues: cueFixture, durationSec: 30 },
      client: createClient(calls, ["{\"summary\":", validAnalysisJson()]) as never,
      execution: executionFixture(),
    })

    expect(calls).toHaveLength(2)
    expect(result.repairAttempted).toBe(true)
    expect(result.analysis.summary).toBe("A concise summary.")
  })

  it("surfaces a provider failure without any automatic retry", async () => {
    const calls: Call[] = []
    const failure = new OpenAICompatibleClientError("upstream unavailable", {
      kind: "http",
      status: 502,
    })

    const error = await runFinalOnlyAnalysis({
      provider,
      transcript: { videoId: "video-1", title: "Fixture Video", cues: cueFixture, durationSec: 30 },
      client: createClient(calls, [failure]) as never,
      execution: executionFixture(),
    }).then(() => null, (reason: unknown) => reason)

    expect(error).toBe(failure)
    expect(calls).toHaveLength(1)
  })

  it("stops before the request when the resume task was already aborted", async () => {
    const calls: Call[] = []
    const controller = new AbortController()
    controller.abort()

    await expect(runFinalOnlyAnalysis({
      provider,
      transcript: { videoId: "video-1", title: "Fixture Video", cues: cueFixture, durationSec: 30 },
      client: createClient(calls, [validAnalysisJson()]) as never,
      execution: executionFixture(),
      signal: controller.signal,
    })).rejects.toThrow()

    expect(calls).toHaveLength(0)
  })

  it("notifies the response hook before parsing so a returned response ends resume eligibility", async () => {
    const calls: Call[] = []
    const events: string[] = []
    await runFinalOnlyAnalysis({
      provider,
      transcript: { videoId: "video-1", title: "Fixture Video", cues: cueFixture, durationSec: 30 },
      client: createClient(calls, ["not json at all", validAnalysisJson()]) as never,
      execution: executionFixture(),
      onFinalResponseReceived: () => events.push("response"),
      onFinalRequestError: async () => {
        events.push("error")
      },
    })

    expect(events).toEqual(["response"])
    expect(calls).toHaveLength(2)
  })

  it("forwards the initial request failure to the resume eligibility hook", async () => {
    const calls: Call[] = []
    const failure = new OpenAICompatibleClientError("upstream unavailable", {
      kind: "http",
      status: 503,
    })
    const seen: unknown[] = []

    await runFinalOnlyAnalysis({
      provider,
      transcript: { videoId: "video-1", title: "Fixture Video", cues: cueFixture, durationSec: 30 },
      client: createClient(calls, [failure]) as never,
      execution: executionFixture(),
      onFinalResponseReceived: () => seen.push("response"),
      onFinalRequestError: async (error) => {
        seen.push(error)
      },
    }).then(() => null, (reason: unknown) => reason)

    expect(seen).toEqual([failure])
    expect(calls).toHaveLength(1)
  })
})
