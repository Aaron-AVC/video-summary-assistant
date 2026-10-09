import { describe, expect, it } from "bun:test"

import { runAnalysis } from "@/features/analysis/lib/run-analysis"

describe("runAnalysis", () => {
  function providerClient(responses: string[], calls: string[]) {
    return {
      provider: {
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-test-placeholder",
        model: "gpt-4.1-mini"
      },
      testConnection: async () => ({ ok: true as const, baseUrl: "https://api.example.com/v1", model: "gpt-4.1-mini", latencyMs: 1 }),
      createChatCompletion: async ({ responseFormat, messages }: { responseFormat?: string, messages: Array<{ content?: string }> }) => {
        calls.push(responseFormat ?? "text")
        if (responseFormat === "json_object") {
          const response = responses.shift()
          if (!response) throw new Error("unexpected structured call")
          return response
        }
        return "chunk summary"
      }
    }
  }

  const transcript = {
    videoId: "video-1",
    title: "Video",
    cues: [{ startSec: 0, endSec: 10, text: "Transcript" }]
  }

  const validResponse = JSON.stringify({
    summary: "Summary",
    keyPoints: [{ text: "Point", startSec: 0, endSec: 10 }],
    chapters: [{ title: "Opening", summary: "Short", detail: "Longer detail", startSec: 0, endSec: 10 }]
  })

  it("repairs invalid first output exactly once", async () => {
    const calls: string[] = []
    const result = await runAnalysis({
      provider: providerClient(["not json", validResponse], calls).provider,
      transcript,
      client: providerClient(["not json", validResponse], calls) as never
    })
    expect(result.repairAttempted).toBe(true)
    expect(calls.filter((call) => call === "json_object")).toHaveLength(2)
  })

  it("repairs a schema-valid but ungrounded first response", async () => {
    const calls: string[] = []
    const ungrounded = JSON.stringify({
      summary: "Summary",
      keyPoints: [{ text: "Point", startSec: 100, endSec: 110 }],
      chapters: [{ title: "Opening", summary: "Short", detail: "Longer detail", startSec: 100, endSec: 110 }]
    })
    const valid = JSON.stringify({
      summary: "Summary",
      keyPoints: [{ text: "Point", startSec: 20, endSec: 30 }],
      chapters: [{ title: "Closing", summary: "Short", detail: "Longer detail", startSec: 20, endSec: 30 }]
    })
    const client = providerClient([ungrounded, valid], calls)
    const result = await runAnalysis({
      provider: client.provider,
      transcript: { ...transcript, cues: [{ startSec: 0, endSec: 10, text: "one" }, { startSec: 20, endSec: 30, text: "two" }] },
      client: client as never
    })
    expect(result.repairAttempted).toBe(true)
    expect(result.analysis.chapters[0].startSec).toBe(20)
    expect(calls.filter((call) => call === "json_object")).toHaveLength(2)
  })

  it("fails after one retry when both ranges remain ungrounded", async () => {
    const calls: string[] = []
    const ungrounded = JSON.stringify({
      summary: "Summary",
      keyPoints: [{ text: "Point", startSec: 100, endSec: 110 }],
      chapters: [{ title: "Opening", summary: "Short", detail: "Longer detail", startSec: 100, endSec: 110 }]
    })
    const client = providerClient([ungrounded, ungrounded], calls)
    await expect(runAnalysis({
      provider: client.provider,
      transcript,
      client: client as never
    })).rejects.toThrow("after one repair attempt")
    expect(calls.filter((call) => call === "json_object")).toHaveLength(2)
  })

  it("fails after exactly one repair retry when both outputs are invalid", async () => {
    const calls: string[] = []
    const client = providerClient(["not json", "still not json"], calls)
    await expect(runAnalysis({ provider: client.provider, transcript, client: client as never })).rejects.toThrow(
      "after one repair attempt"
    )
    expect(calls.filter((call) => call === "json_object")).toHaveLength(2)
  })

  it("does not retry after cancellation", async () => {
    const calls: string[] = []
    const controller = new AbortController()
    const client = providerClient(["not json"], calls)
    controller.abort()
    await expect(runAnalysis({ provider: client.provider, transcript, client: client as never, signal: controller.signal })).rejects.toThrow(
      "cancelled"
    )
    expect(calls).toEqual([])
  })

  it("summarizes chunks before requesting a final merge", async () => {
    const prompts: string[] = []
    let structuredCalls = 0
    const result = await runAnalysis({
      provider: {
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-test-placeholder",
        model: "gpt-4.1-mini"
      },
      transcript: {
        videoId: "video-1",
        title: "Deep dive",
          durationSec: 15,
        cues: [
          { startSec: 0, endSec: 5, text: "intro section" },
          { startSec: 5, endSec: 10, text: "middle section" },
          { startSec: 10, endSec: 15, text: "closing section" }
        ]
      },
      chunking: {
        maxCharacters: 20
      },
      client: {
        provider: {
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test-placeholder",
          model: "gpt-4.1-mini"
        },
        testConnection: async () => ({
          ok: true as const,
          baseUrl: "https://api.example.com/v1",
          model: "gpt-4.1-mini",
          latencyMs: 1
        }),
        createChatCompletion: async ({ messages, responseFormat }) => {
          prompts.push(messages[1]?.content ?? "")

          if (responseFormat === "json_object") {
            structuredCalls += 1
            return JSON.stringify({
              summary: "merged",
              keyPoints: [
                {
                  text: "point",
                  startSec: 0,
                  endSec: 5
                }
              ],
              chapters: [
                {
                  title: "Opening",
                  summary: "segment",
                  detail: "A fuller segment explanation.",
                  startSec: 0,
                  endSec: 14
                }
              ]
            })
          }

          return `chunk-${prompts.length}`
        }
      }
    })

    expect(result.chunkSummaries).toEqual([
      {
        chunkId: "chunk-1",
        startSec: 0,
        endSec: 5,
        summary: "chunk-1"
      },
      {
        chunkId: "chunk-2",
        startSec: 5,
        endSec: 10,
        summary: "chunk-2"
      },
      {
        chunkId: "chunk-3",
        startSec: 10,
        endSec: 15,
        summary: "chunk-3"
      }
    ])
    expect(result.analysis).toEqual({
      summary: "merged",
      keyPoints: [
        {
          text: "point",
          startSec: 0,
          endSec: 5
        }
      ],
      chapters: [
        {
          title: "Opening",
          summary: "segment",
          detail: "A fuller segment explanation.",
          startSec: 0,
          endSec: 15
        }
      ]
    })
    expect(result.rawResponse).toContain('"summary":"merged"')
    expect(result.repairAttempted).toBe(false)
    expect(structuredCalls).toBe(1)
    expect(prompts[prompts.length - 1]).toContain("Chunk summaries")
  })

  it("fails fast when transcript cues are missing", async () => {
    await expect(
      runAnalysis({
        provider: {
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test-placeholder",
          model: "gpt-4.1-mini"
        },
        transcript: {
          videoId: "video-1",
          cues: []
        }
      })
    ).rejects.toThrow("Transcript cues are required")
  })
})
