import { describe, expect, it } from "bun:test"

import { runAnalysis } from "@/features/analysis/lib/run-analysis"

describe("runAnalysis", () => {
  it("summarizes chunks before requesting a final merge", async () => {
    const prompts: string[] = []
    const result = await runAnalysis({
      provider: {
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-test-placeholder",
        model: "gpt-4.1-mini"
      },
      transcript: {
        videoId: "video-1",
        title: "Deep dive",
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
            return JSON.stringify({
              summary: "merged",
              keyPoints: [
                {
                  text: "point",
                  startSec: 0,
                  endSec: 5
                }
              ],
              topics: [
                {
                  label: "topic",
                  startSec: 0,
                  endSec: 15
                }
              ],
              segments: [
                {
                  title: "Opening",
                  summary: "segment",
                  startSec: 0,
                  endSec: 14
                }
              ],
              moments: [
                {
                  title: "Opening",
                  summary: "segment",
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
      topics: [
        {
          label: "topic",
          startSec: 0,
          endSec: 15
        }
      ],
      segments: [
        {
          title: "Opening",
          summary: "segment",
          startSec: 0,
          endSec: 15
        }
      ],
      moments: [
        {
          title: "Opening",
          summary: "segment",
          startSec: 0,
          endSec: 15
        }
      ]
    })
    expect(result.rawResponse).toContain('"summary":"merged"')
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
