import { describe, expect, it } from "bun:test"

import {
  finalAnalysisPromptFits,
  planReductionGroups,
  planTranscriptChunks,
  selectAnalysisStrategy
} from "@/features/analysis/lib/analysis-plan"
import {
  AnalysisInputBudgetExceededError,
  ReductionCannotProgressError,
  type AnalysisBudgetPolicy
} from "@/features/analysis/lib/analysis-budget"
import type { EvidenceSummary } from "@/features/analysis/lib/prompts"
import {
  createOpenAICompatibleClient,
  DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS,
  OpenAICompatibleClientError
} from "@/features/analysis/lib/openai-compatible-client"
import {
  AnalysisAbortedError,
  runAnalysis,
  type AnalysisProgressEvent,
  type FinalAnalysisCheckpointCandidate
} from "@/features/analysis/lib/run-analysis"
import type { TranscriptCue } from "@/features/transcript/lib/transcript-schema"

type Call = {
  structured: boolean
  system: string
  user: string
  signal?: AbortSignal
}

const provider = {
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-test-placeholder",
  model: "test-model"
}

const shortTranscript = {
  videoId: "video-1",
  title: "Video",
  cues: [{ startSec: 0, endSec: 10, text: "Transcript" }]
}

function validResponse(endSec = 10) {
  return JSON.stringify({
    summary: "Summary",
    keyPoints: [{ text: "Point", startSec: 0, endSec }],
    chapters: [{
      title: "Opening",
      summary: "Short",
      detail: "Longer detail",
      startSec: 0,
      endSec
    }]
  })
}

function createClient(
  calls: Call[],
  respond: (call: Call, callIndex: number) => string | Promise<string>
) {
  return {
    provider,
    testConnection: async () => ({
      ok: true as const,
      baseUrl: provider.baseUrl,
      model: provider.model,
      latencyMs: 1
    }),
    createChatCompletion: async ({ messages, signal }: {
      messages: Array<{ role: string, content: string }>
      signal?: AbortSignal
    }) => {
      const promptText = messages.map((message) => message.content).join("\n")
      const call: Call = {
        structured: /JSON only|valid JSON object/i.test(promptText),
        system: messages[0]?.content ?? "",
        user: messages[1]?.content ?? "",
        signal
      }
      calls.push(call)
      return respond(call, calls.length - 1)
    }
  }
}

describe("runAnalysis", () => {

  it("emits only typed direct/repair progress without source text", async () => {
    const events: AnalysisProgressEvent[] = []
    const calls: Call[] = []
    const responses = ["not json", validResponse()]
    const result = await runAnalysis({
      provider, transcript: shortTranscript,
      client: createClient(calls, () => responses.shift()!) as never,
      onProgress: (event) => { events.push(event) }
    })
    expect(result.repairAttempted).toBe(true)
    expect(events).toEqual([{ kind: "direct" }, { kind: "repair" }])
    expect(JSON.stringify(events)).not.toContain("Transcript")
    expect(JSON.stringify(events)).not.toContain(provider.apiKey)
    expect(calls).toHaveLength(2)
  })

  it("emits ordered map completion counts and final before the provider request", async () => {
    const cues = longCues(8, 260)
    const scenario = findScenario(cues, "brief map summary", "condensed", (value) =>
      value.chunkCount >= 3 && value.reductionLevels === 0
    )
    const events: AnalysisProgressEvent[] = []
    const calls: Call[] = []
    await runAnalysis({
      provider,
      transcript: { videoId: "long", title: "Long", cues },
      budgetPolicy: scenario.policy,
      client: createClient(calls, (call) =>
        call.structured ? validResponse(cues.at(-1)!.endSec) : "brief map summary"
      ) as never,
      onProgress: (event) => events.push(event)
    })
    const expectedEvents: AnalysisProgressEvent[] = [
      ...Array.from({ length: scenario.chunkCount + 1 }, (_, completed) => ({
        kind: "map" as const, completed, total: scenario.chunkCount
      })),
      { kind: "final" }
    ]
    expect(events).toEqual(expectedEvents)
    expect(calls).toHaveLength(scenario.chunkCount + 1)
  })

  it("counts every reduction group including deterministic pass-through groups", async () => {
    const cues = longCues(10, 280)
    const mapSummary = `map ${"m".repeat(260)}`
    const scenario = findScenario(cues, mapSummary, "condensed reduction", (value) =>
      value.chunkCount >= 4 && value.reductionLevels === 1
    )
    const events: AnalysisProgressEvent[] = []
    await runAnalysis({
      provider, transcript: { videoId: "reduce", title: "Reduce", cues },
      budgetPolicy: scenario.policy,
      client: createClient([], (call) => {
        if (call.structured) return validResponse(cues.at(-1)!.endSec)
        return call.user.includes("Reduction level:") ? "condensed reduction" : mapSummary
      }) as never,
      onProgress: (event) => events.push(event)
    })
    const reduction = events.filter((event) => event.kind === "reduction")
    expect(reduction.length).toBeGreaterThan(1)
    const first = reduction[0]
    if (!first || first.kind !== "reduction") throw new Error("Missing reduction events")
    expect(reduction.map((event) => event.kind === "reduction" ? event.completed : -1))
      .toEqual(Array.from({ length: first.total + 1 }, (_, index) => index))
    expect(events.at(-1)).toEqual({ kind: "final" })
  })

  it("emits final exactly once before an upstream HTTP failure; no implicit retry", async () => {
    const cues = longCues(8, 260)
    const scenario = findScenario(cues, "brief map summary", "condensed", (value) =>
      value.chunkCount >= 3 && value.reductionLevels === 0
    )
    const events: AnalysisProgressEvent[] = []
    const calls: Call[] = []
    const error = await runAnalysis({
      provider,
      transcript: { videoId: "long", title: "Long", cues },
      budgetPolicy: scenario.policy,
      client: createClient(calls, (call) => {
        if (call.structured) throw new OpenAICompatibleClientError(
          "Provider request failed with status 502.", { kind: "http", status: 502 }
        )
        return "brief map summary"
      }) as never,
      onProgress: (event) => events.push(event)
    }).then(() => null, (reason: unknown) => reason)
    expect(error).toMatchObject({ kind: "http", status: 502 })
    expect(events.filter((event) => event.kind === "final")).toHaveLength(1)
    expect(events.at(-1)).toEqual({ kind: "final" })
    expect(calls).toHaveLength(scenario.chunkCount + 1)
  })


  it("uses one structured request for a valid short transcript", async () => {
    const calls: Call[] = []
    const client = createClient(calls, () => validResponse())
    const result = await runAnalysis({ provider, transcript: shortTranscript, client: client as never })

    expect(result.strategy).toBe("single-pass")
    expect(result.initialChunkCount).toBe(0)
    expect(result.reductionLevels).toBe(0)
    expect(result.chunkSummaries).toEqual([])
    expect(result.repairAttempted).toBe(false)
    expect(calls.map((call) => call.structured)).toEqual([true])
    expect(calls[0].user).toContain("1. 0s-10s: Transcript")
  })

  it("repairs one schema-invalid short response exactly once", async () => {
    const calls: Call[] = []
    const responses = [
      JSON.stringify({
        summary: "Summary",
        keyPoints: [{ text: "Point" }],
        chapters: [{ title: "Opening", summary: "Short", startSec: 0, endSec: 10 }]
      }),
      validResponse()
    ]
    const client = createClient(calls, () => responses.shift() ?? "unexpected")
    const result = await runAnalysis({ provider, transcript: shortTranscript, client: client as never })
    expect(result.strategy).toBe("single-pass")
    expect(result.repairAttempted).toBe(true)
    expect(calls.map((call) => call.structured)).toEqual([true, true])
    expect(calls[1].user).toContain("chapters.0.detail")
  })

  it("uses the generation timeout for the initial analysis and structured repair", async () => {
    const scheduledTimeouts: number[] = []
    const bodies: string[] = []
    const responses = ["not json", validResponse()]
    const client = createOpenAICompatibleClient(provider, {
      setTimeoutImpl: (_callback, timeoutMs) => {
        scheduledTimeouts.push(timeoutMs)
        return 1
      },
      clearTimeoutImpl: () => undefined,
      fetchImpl: async (_input, init) => {
        bodies.push(String(init?.body))
        return new Response(JSON.stringify({
          choices: [{ message: { content: responses.shift() ?? "unexpected" } }]
        }), { status: 200 })
      }
    })

    const result = await runAnalysis({ provider, transcript: shortTranscript, client })
    expect(result.repairAttempted).toBe(true)
    expect(scheduledTimeouts).toEqual([
      DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS,
      DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS
    ])
    expect(bodies.every((body) => !body.includes("response_format"))).toBe(true)
  })

  it("does not retry a provider timeout during analysis", async () => {
    let fetchCount = 0
    const client = createOpenAICompatibleClient(provider, {
      setTimeoutImpl: (callback) => {
        callback()
        return 1
      },
      clearTimeoutImpl: () => undefined,
      fetchImpl: async (_input, init) => {
        fetchCount += 1
        if (init?.signal?.aborted) throw new Error("aborted")
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
        })
      }
    })

    await expect(runAnalysis({ provider, transcript: shortTranscript, client })).rejects.toMatchObject({
      name: "OpenAICompatibleClientError",
      message: `Provider generation request timed out after ${DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS / 1000} seconds.`
    })
    expect(fetchCount).toBe(1)
  })

  it("reports parent cancellation through the existing AnalysisAbortedError flow", async () => {
    const controller = new AbortController()
    let markFetchStarted: (() => void) | undefined
    const fetchStarted = new Promise<void>((resolve) => { markFetchStarted = resolve })
    const client = createOpenAICompatibleClient(provider, {
      setTimeoutImpl: () => 1,
      clearTimeoutImpl: () => undefined,
      fetchImpl: async (_input, init) => {
        markFetchStarted?.()
        if (init?.signal?.aborted) throw new Error("aborted by user")
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted by user")), { once: true })
        })
      }
    })

    const analysis = runAnalysis({
      provider,
      transcript: shortTranscript,
      client,
      signal: controller.signal
    })
    await fetchStarted
    controller.abort("user cancelled")
    await expect(analysis).rejects.toBeInstanceOf(AnalysisAbortedError)
  })

  it("preserves a generation timeout from structured repair", async () => {
    const responses = ["not json"]
    const scheduledTimeouts: number[] = []
    const client = createOpenAICompatibleClient(provider, {
      setTimeoutImpl: (callback, timeoutMs) => {
        scheduledTimeouts.push(timeoutMs)
        if (scheduledTimeouts.length === 2) callback()
        return 1
      },
      clearTimeoutImpl: () => undefined,
      fetchImpl: async (_input, init) => {
        if (init?.signal?.aborted) throw new Error("aborted")
        return new Response(JSON.stringify({
          choices: [{ message: { content: responses.shift() ?? "unexpected" } }]
        }), { status: 200 })
      }
    })

    const error = await runAnalysis({ provider, transcript: shortTranscript, client })
      .then(() => null, (cause: unknown) => cause)
    expect(error).toBeInstanceOf(OpenAICompatibleClientError)
    expect(error).toMatchObject({
      message: `Provider generation request timed out after ${DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS / 1000} seconds.`
    })
    expect(scheduledTimeouts).toEqual([
      DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS,
      DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS
    ])
  })

  it("repairs CR-05 grounding failures and fails after the second invalid response", async () => {
    const ungrounded = JSON.stringify({
      summary: "Summary",
      keyPoints: [{ text: "Point", startSec: 100, endSec: 110 }],
      chapters: [{
        title: "Opening",
        summary: "Short",
        detail: "Longer detail",
        startSec: 100,
        endSec: 110
      }]
    })
    const repairedCalls: Call[] = []
    const repairedResponses = [ungrounded, validResponse()]
    const repairedClient = createClient(repairedCalls, () => repairedResponses.shift()!)
    const repaired = await runAnalysis({
      provider,
      transcript: shortTranscript,
      client: repairedClient as never
    })
    expect(repaired.repairAttempted).toBe(true)
    expect(repairedCalls).toHaveLength(2)
    expect(repairedCalls[1].user).toContain("does not overlap transcript evidence")

    const failedCalls: Call[] = []
    const failedClient = createClient(failedCalls, () => ungrounded)
    await expect(runAnalysis({
      provider,
      transcript: shortTranscript,
      client: failedClient as never
    })).rejects.toThrow("after one repair attempt")
    expect(failedCalls).toHaveLength(2)
  })

  it("runs sequential maps then one final structured request when summaries fit", async () => {
    const cues = longCues(8, 260)
    const scenario = findScenario(cues, "brief map summary", "condensed", (value) =>
      value.chunkCount >= 3 && value.reductionLevels === 0
    )
    const calls: Call[] = []
    const client = createClient(calls, (call) =>
      call.structured ? validResponse(cues.at(-1)!.endSec) : "brief map summary"
    )
    const result = await runAnalysis({
      provider,
      transcript: { videoId: "long", title: "Long", cues },
      budgetPolicy: scenario.policy,
      client: client as never
    })

    expect(result.strategy).toBe("map-reduce")
    expect(result.initialChunkCount).toBe(scenario.chunkCount)
    expect(result.reductionLevels).toBe(0)
    expect(result.chunkSummaries).toHaveLength(scenario.chunkCount)
    expect(result.chunkSummaries[0].startSec).toBe(0)
    expect(result.chunkSummaries.at(-1)!.endSec).toBe(cues.at(-1)!.endSec)
    expect(calls.slice(0, -1).every((call) => !call.structured)).toBe(true)
    expect(calls.at(-1)!.structured).toBe(true)
    expect(calls).toHaveLength(scenario.chunkCount + 1)
  })

  it("performs deterministic adjacent one-level reduction with local union ranges", async () => {
    const cues = longCues(10, 280)
    const mapSummary = `map ${"m".repeat(260)}`
    const reducedSummary = "condensed reduction"
    const scenario = findScenario(cues, mapSummary, reducedSummary, (value) =>
      value.chunkCount >= 4 && value.reductionLevels === 1
    )
    const calls: Call[] = []
    const client = createClient(calls, (call) => {
      if (call.structured) return validResponse(cues.at(-1)!.endSec)
      if (call.user.includes("Reduction level:")) return reducedSummary
      return mapSummary
    })
    const result = await runAnalysis({
      provider,
      transcript: { videoId: "reduce", title: "Reduce", cues },
      budgetPolicy: scenario.policy,
      client: client as never
    })

    expect(result.reductionLevels).toBe(1)
    const reductionCalls = calls.filter((call) => call.user.includes("Reduction level: 1"))
    expect(reductionCalls.length).toBeGreaterThan(0)
    for (const call of reductionCalls) {
      const ranges = Array.from(call.user.matchAll(/chunk-\d+ \/ (\d+)s-(\d+)s/g))
      expect(ranges.length).toBeGreaterThanOrEqual(2)
      for (let index = 1; index < ranges.length; index += 1) {
        expect(Number(ranges[index][1])).toBe(Number(ranges[index - 1][2]))
      }
    }
    expect(calls.at(-1)!.user).toContain("reduction-1-")
    expect(calls.at(-1)!.user).toContain("0s-")
  })

  it("supports multiple bounded reduction levels", async () => {
    const cues = longCues(24, 300)
    const mapSummary = `map ${"m".repeat(300)}`
    const reducedSummary = `reduced ${"r".repeat(180)}`
    const scenario = findScenario(cues, mapSummary, reducedSummary, (value) =>
      value.chunkCount >= 8 && value.reductionLevels >= 2
    )
    const calls: Call[] = []
    const client = createClient(calls, (call) => {
      if (call.structured) return validResponse(cues.at(-1)!.endSec)
      if (call.user.includes("Reduction level:")) return reducedSummary
      return mapSummary
    })
    const result = await runAnalysis({
      provider,
      transcript: { videoId: "multi", title: "Multi", cues },
      budgetPolicy: scenario.policy,
      client: client as never
    })
    expect(result.reductionLevels).toBeGreaterThanOrEqual(2)
    expect(calls.some((call) => call.user.includes("Reduction level: 1"))).toBe(true)
    expect(calls.some((call) => call.user.includes("Reduction level: 2"))).toBe(true)
    expect(calls.at(-1)!.structured).toBe(true)
  })

  it("fails before provider calls for an oversized cue", async () => {
    const calls: Call[] = []
    const client = createClient(calls, () => "unexpected")
    await expect(runAnalysis({
      provider,
      transcript: {
        videoId: "oversized",
        cues: [{ startSec: 0, endSec: 5, text: "x".repeat(20_000) }]
      },
      budgetPolicy: policyForInputBudget(300),
      client: client as never
    })).rejects.toThrow(AnalysisInputBudgetExceededError)
    expect(calls).toEqual([])
  })

  it("fails with bounded calls when reduction cannot make progress", async () => {
    const cues = longCues(8, 280)
    const mapSummary = `large ${"x".repeat(500)}`
    const scenario = findNoProgressScenario(cues, mapSummary)
    const calls: Call[] = []
    const client = createClient(calls, () => mapSummary)
    await expect(runAnalysis({
      provider,
      transcript: { videoId: "no-progress", cues },
      budgetPolicy: scenario.policy,
      client: client as never
    })).rejects.toThrow(ReductionCannotProgressError)
    expect(calls).toHaveLength(scenario.chunkCount)
    expect(calls.every((call) => !call.structured)).toBe(true)
  })

  it("stops subsequent calls when cancelled during map or reduction", async () => {
    const mapCues = longCues(8, 260)
    const mapScenario = findScenario(mapCues, "brief", "condensed", (value) =>
      value.chunkCount >= 3 && value.reductionLevels === 0
    )
    const mapController = new AbortController()
    const mapCalls: Call[] = []
    const mapClient = createClient(mapCalls, () => {
      mapController.abort()
      return "brief"
    })
    await expect(runAnalysis({
      provider,
      transcript: { videoId: "cancel-map", cues: mapCues },
      budgetPolicy: mapScenario.policy,
      signal: mapController.signal,
      client: mapClient as never
    })).rejects.toThrow("cancelled")
    expect(mapCalls).toHaveLength(1)

    const reduceCues = longCues(10, 280)
    const mapSummary = `map ${"m".repeat(260)}`
    const reduceScenario = findScenario(reduceCues, mapSummary, "condensed", (value) =>
      value.chunkCount >= 4 && value.reductionLevels === 1
    )
    const reduceController = new AbortController()
    const reduceCalls: Call[] = []
    const reduceClient = createClient(reduceCalls, (call) => {
      if (call.user.includes("Reduction level:")) {
        reduceController.abort()
        return "condensed"
      }
      return mapSummary
    })
    await expect(runAnalysis({
      provider,
      transcript: { videoId: "cancel-reduce", cues: reduceCues },
      budgetPolicy: reduceScenario.policy,
      signal: reduceController.signal,
      client: reduceClient as never
    })).rejects.toThrow("cancelled")
    expect(reduceCalls.filter((call) => call.user.includes("Reduction level:"))).toHaveLength(1)
    expect(reduceCalls.some((call) => call.structured)).toBe(false)
  })

  it("keeps CR-05 repair on the map-reduce final result", async () => {
    const cues = longCues(8, 260)
    const scenario = findScenario(cues, "brief", "condensed", (value) =>
      value.chunkCount >= 3 && value.reductionLevels === 0
    )
    const calls: Call[] = []
    const ungrounded = JSON.stringify({
      summary: "Summary",
      keyPoints: [{ text: "Point" }],
      chapters: [{
        title: "Wrong",
        summary: "Short",
        detail: "Longer",
        startSec: 1000,
        endSec: 1100
      }]
    })
    const structuredResponses = [ungrounded, validResponse(cues.at(-1)!.endSec)]
    const client = createClient(calls, (call) =>
      call.structured ? structuredResponses.shift()! : "brief"
    )
    const result = await runAnalysis({
      provider,
      transcript: { videoId: "long-grounding", cues },
      budgetPolicy: scenario.policy,
      client: client as never
    })
    expect(result.strategy).toBe("map-reduce")
    expect(result.repairAttempted).toBe(true)
    expect(calls.filter((call) => call.structured)).toHaveLength(2)
    // The repair request carries the final prompt as its original-task context.
    // The evidence fence lives in the user prompt (it is payload, not policy),
    // and its nonce is chosen at build time, so assert the structure rather
    // than a fixed nonce.
    const repairCall = calls.at(-1)!
    expect(repairCall.user).toMatch(/<<<UNTRUSTED_ORIGINAL_TASK_BEGIN:n\d+>>>/)
    expect(repairCall.user).toMatch(/<<<UNTRUSTED_PARTIAL_ANALYSES_BEGIN:n\d+>>>/)
    expect(repairCall.user).toMatch(/<<<UNTRUSTED_PARTIAL_ANALYSES_END:n\d+>>>/)
    expect(repairCall.user).toContain("untrusted model-derived evidence")
    // The system layer carries the authoritative repair contract instead.
    expect(repairCall.system).toContain("authoritative")
    expect(repairCall.system).not.toContain("<<<UNTRUSTED_PARTIAL_ANALYSES_BEGIN")
  })

  it("prepares the real map/final input once and publishes only the initial Final failure", async () => {
    const cues = longCues(8, 260)
    const scenario = findScenario(cues, "brief map summary", "condensed", (value) =>
      value.chunkCount >= 3 && value.reductionLevels === 0
    )
    const checkpoint = createCheckpointRecorder()
    const calls: Call[] = []
    const error = await runAnalysis({
      provider,
      transcript: { videoId: "checkpoint-long", title: "Checkpoint", cues },
      budgetPolicy: scenario.policy,
      client: createClient(calls, (call) => {
        if (call.structured) {
          checkpoint.order.push("final-request")
          throw new OpenAICompatibleClientError("temporary", { kind: "http", status: 502 })
        }
        return "brief map summary"
      }) as never,
      finalCheckpoint: checkpoint.hook
    }).then(() => null, (reason: unknown) => reason)

    expect(error).toMatchObject({ kind: "http", status: 502 })
    expect(checkpoint.prepared).toHaveLength(1)
    expect(checkpoint.published).toHaveLength(1)
    expect(checkpoint.order).toEqual(["prepare", "final-request", "publish"])
    expect(calls).toHaveLength(scenario.chunkCount + 1)
    const candidate = checkpoint.prepared[0]!
    expect(candidate.strategy).toBe("map-reduce")
    expect(candidate.initialChunkCount).toBe(scenario.chunkCount)
    expect(candidate.mapPlan).toHaveLength(scenario.chunkCount)
    expect(candidate.chunkSummaries).toHaveLength(scenario.chunkCount)
    expect(candidate.finalInputSummaries).toEqual(candidate.chunkSummaries)
    expect(candidate.finalPrompt.userPrompt).toBe(calls.at(-1)!.user)
    expect(candidate.finalPrompt.systemPrompt).toBe(calls.at(-1)!.system)
  })

  it("discards on the first Final response and never publishes a Repair failure", async () => {
    const cues = longCues(8, 260)
    const scenario = findScenario(cues, "brief map summary", "condensed", (value) =>
      value.chunkCount >= 3 && value.reductionLevels === 0
    )
    const checkpoint = createCheckpointRecorder()
    let structuredCalls = 0
    const error = await runAnalysis({
      provider,
      transcript: { videoId: "checkpoint-repair", cues },
      budgetPolicy: scenario.policy,
      client: createClient([], (call) => {
        if (!call.structured) return "brief map summary"
        structuredCalls += 1
        if (structuredCalls === 1) return "not json"
        throw new OpenAICompatibleClientError("repair upstream", { kind: "http", status: 502 })
      }) as never,
      finalCheckpoint: checkpoint.hook
    }).then(() => null, (reason: unknown) => reason)

    expect(error).toMatchObject({ kind: "http", status: 502 })
    expect(checkpoint.prepared).toHaveLength(1)
    expect(checkpoint.published).toEqual([])
    expect(checkpoint.discarded).toBe(1)
    expect(structuredCalls).toBe(2)
  })

  it("does not prepare or publish for Map, Reduction, or single-pass failures", async () => {
    const cues = longCues(8, 260)
    const scenario = findScenario(cues, "brief map summary", "condensed", (value) =>
      value.chunkCount >= 3 && value.reductionLevels === 0
    )
    const mapCheckpoint = createCheckpointRecorder()
    await expect(runAnalysis({
      provider,
      transcript: { videoId: "map-failure", cues },
      budgetPolicy: scenario.policy,
      client: createClient([], () => {
        throw new OpenAICompatibleClientError("map upstream", { kind: "http", status: 502 })
      }) as never,
      finalCheckpoint: mapCheckpoint.hook
    })).rejects.toMatchObject({ status: 502 })
    expect(mapCheckpoint.prepared).toEqual([])
    expect(mapCheckpoint.published).toEqual([])

    const reductionCues = longCues(10, 280)
    const reductionScenario = findScenario(
      reductionCues,
      `map ${"m".repeat(260)}`,
      "condensed reduction",
      (value) => value.chunkCount >= 4 && value.reductionLevels === 1
    )
    const reductionCheckpoint = createCheckpointRecorder()
    await expect(runAnalysis({
      provider,
      transcript: { videoId: "reduction-failure", cues: reductionCues },
      budgetPolicy: reductionScenario.policy,
      client: createClient([], (call) => {
        if (call.user.includes("Reduction level:")) {
          throw new OpenAICompatibleClientError("reduction upstream", { kind: "http", status: 503 })
        }
        return `map ${"m".repeat(260)}`
      }) as never,
      finalCheckpoint: reductionCheckpoint.hook
    })).rejects.toMatchObject({ status: 503 })
    expect(reductionCheckpoint.prepared).toEqual([])
    expect(reductionCheckpoint.published).toEqual([])

    const directCheckpoint = createCheckpointRecorder()
    await expect(runAnalysis({
      provider,
      transcript: shortTranscript,
      client: createClient([], () => {
        throw new OpenAICompatibleClientError("direct upstream", { kind: "http", status: 502 })
      }) as never,
      finalCheckpoint: directCheckpoint.hook
    })).rejects.toMatchObject({ status: 502 })
    expect(directCheckpoint.prepared).toEqual([])
    expect(directCheckpoint.published).toEqual([])
  })

  it("does not publish when candidate preparation declines or fails", async () => {
    const cues = longCues(8, 260)
    const scenario = findScenario(cues, "brief map summary", "condensed", (value) =>
      value.chunkCount >= 3 && value.reductionLevels === 0
    )
    for (const mode of ["decline", "throw"] as const) {
      const checkpoint = createCheckpointRecorder(mode)
      await expect(runAnalysis({
        provider,
        transcript: { videoId: `prepare-${mode}`, cues },
        budgetPolicy: scenario.policy,
        client: createClient([], (call) => {
          if (call.structured) {
            throw new OpenAICompatibleClientError("temporary", { kind: "http", status: 504 })
          }
          return "brief map summary"
        }) as never,
        finalCheckpoint: checkpoint.hook
      })).rejects.toMatchObject({ status: 504 })
      expect(checkpoint.published).toEqual([])
    }
  })

  it("fails fast when transcript cues are missing", async () => {
    await expect(runAnalysis({
      provider,
      transcript: { videoId: "video-1", cues: [] }
    })).rejects.toThrow("Transcript cues are required")
  })
})

function createCheckpointRecorder(mode: "prepare" | "decline" | "throw" = "prepare") {
  const prepared: FinalAnalysisCheckpointCandidate[] = []
  const published: unknown[] = []
  const order: string[] = []
  let discardCount = 0
  return {
    prepared,
    published,
    order,
    get discarded() { return discardCount },
    hook: {
      prepareFinalCandidate: async (candidate: FinalAnalysisCheckpointCandidate) => {
        order.push("prepare")
        prepared.push(candidate)
        if (mode === "throw") throw new Error("preparation failed")
        return mode === "prepare"
      },
      promoteFinalFailure: async (error: unknown) => {
        order.push("publish")
        published.push(error)
        return true
      },
      discardFinalCandidate: () => { discardCount += 1 }
    }
  }
}

function longCues(count: number, textLength: number): TranscriptCue[] {
  return Array.from({ length: count }, (_, index) => ({
    startSec: index * 10,
    endSec: (index + 1) * 10,
    text: `${index} ${String.fromCharCode(97 + index % 26).repeat(textLength)}`
  }))
}

function policyForInputBudget(inputBudget: number): AnalysisBudgetPolicy {
  return {
    contextWindowEstimateTokens: inputBudget + 510,
    reservedCompletionTokens: 10,
    reservedRepairTokens: 500
  }
}

function findScenario(
  cues: TranscriptCue[],
  mapSummary: string,
  reducedSummary: string,
  predicate: (value: { chunkCount: number, reductionLevels: number }) => boolean
) {
  for (let inputBudget = 100; inputBudget <= 5_000; inputBudget += 5) {
    const policy = policyForInputBudget(inputBudget)
    try {
      if (selectAnalysisStrategy({ cues, budgetPolicy: policy }) !== "map-reduce") continue
      const chunks = planTranscriptChunks({ cues, budgetPolicy: policy })
      let summaries: EvidenceSummary[] = chunks.map((chunk) => ({
        chunkId: chunk.id,
        startSec: chunk.startSec,
        endSec: chunk.endSec,
        summary: mapSummary
      }))
      let reductionLevels = 0
      while (!finalAnalysisPromptFits({ summaries, budgetPolicy: policy })) {
        reductionLevels += 1
        if (reductionLevels > 8) throw new Error("test scenario did not converge")
        const groups = planReductionGroups({ level: reductionLevels, summaries, budgetPolicy: policy })
        summaries = groups.map((group, index) => group.length === 1 ? group[0] : ({
          chunkId: `reduction-${reductionLevels}-${index + 1}`,
          startSec: Math.min(...group.map((node) => node.startSec)),
          endSec: Math.max(...group.map((node) => node.endSec)),
          summary: reducedSummary
        }))
      }
      const value = { chunkCount: chunks.length, reductionLevels }
      if (predicate(value)) return { policy, ...value }
    } catch {
      // Search the next deterministic injected budget.
    }
  }
  throw new Error("No deterministic analysis budget matched the requested test scenario.")
}

function findNoProgressScenario(cues: TranscriptCue[], mapSummary: string) {
  for (let inputBudget = 100; inputBudget <= 5_000; inputBudget += 5) {
    const policy = policyForInputBudget(inputBudget)
    try {
      if (selectAnalysisStrategy({ cues, budgetPolicy: policy }) !== "map-reduce") continue
      const chunks = planTranscriptChunks({ cues, budgetPolicy: policy })
      if (chunks.length < 2) continue
      const summaries = chunks.map((chunk) => ({
        chunkId: chunk.id,
        startSec: chunk.startSec,
        endSec: chunk.endSec,
        summary: mapSummary
      }))
      if (finalAnalysisPromptFits({ summaries, budgetPolicy: policy })) continue
      try {
        planReductionGroups({ level: 1, summaries, budgetPolicy: policy })
      } catch (error) {
        if (error instanceof ReductionCannotProgressError) {
          return { policy, chunkCount: chunks.length }
        }
      }
    } catch {
      // Search the next deterministic injected budget.
    }
  }
  throw new Error("No deterministic no-progress budget matched the requested test scenario.")
}
