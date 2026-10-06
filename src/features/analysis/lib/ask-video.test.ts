import { describe, expect, it } from "bun:test"

import {
  askVideo,
  buildAskVideoPrompt,
  parseAskVideoAnswerPayload
} from "@/features/analysis/lib/ask-video"

const TRANSCRIPT_CUES = [
  { startSec: 0, endSec: 10, text: "Intro and setup" },
  { startSec: 10, endSec: 20, text: "Demo begins" },
  { startSec: 20, endSec: 30, text: "Wrap up" }
]

describe("ask video", () => {
  it("builds prompts with transcript context and JSON instructions", () => {
    const prompt = buildAskVideoPrompt({
      question: "Where does the demo start?",
      videoId: "video-1",
      videoTitle: "Demo video",
      transcriptCues: TRANSCRIPT_CUES,
      analysis: null
    })

    expect(prompt.systemPrompt).toContain("JSON only")
    expect(prompt.userPrompt).toContain("Where does the demo start?")
    expect(prompt.userPrompt).toContain("10s-20s")
    expect(prompt.userPrompt).toContain("citations")
    expect(prompt.userPrompt).toContain("suggestedJumps")
  })

  it("parses structured answers and validates citation ranges", () => {
    expect(
      parseAskVideoAnswerPayload(
        JSON.stringify({
          answer: "The demo starts after setup.",
          citations: [
            {
              text: "Demo begins",
              startSec: 10,
              endSec: 20
            }
          ],
          suggestedJumps: [
            {
              title: "Demo",
              reason: "The walkthrough starts here.",
              startSec: 10,
              endSec: 20
            }
          ],
          followUps: ["What happens next?"]
        }),
        TRANSCRIPT_CUES
      )
    ).toEqual({
      answer: "The demo starts after setup.",
      citations: [
        {
          text: "Demo begins",
          startSec: 10,
          endSec: 20
        }
      ],
      suggestedJumps: [
        {
          title: "Demo",
          reason: "The walkthrough starts here.",
          startSec: 10,
          endSec: 20
        }
      ],
      followUps: ["What happens next?"]
    })
  })

  it("rejects malformed JSON and drops citations that don't overlap any cue", () => {
    expect(() => parseAskVideoAnswerPayload("not json", TRANSCRIPT_CUES)).toThrow(
      "Ask AI returned invalid JSON."
    )

    expect(() =>
      parseAskVideoAnswerPayload(
        {
          answer: "Outside",
          citations: [
            {
              startSec: 50,
              endSec: 60
            }
          ]
        },
        TRANSCRIPT_CUES
      )
    ).toThrow("Ask AI returned no citations that line up with the transcript.")

    expect(() =>
      parseAskVideoAnswerPayload(
        {
          answer: "Gap",
          citations: [
            {
              startSec: 12,
              endSec: 18
            }
          ]
        },
        [
          { startSec: 0, endSec: 10, text: "Intro" },
          { startSec: 20, endSec: 30, text: "Wrap up" }
        ]
      )
    ).toThrow("Ask AI returned no citations that line up with the transcript.")
  })

  it("runs Ask AI through the provider with JSON response format", async () => {
    const calls: Array<"json_object" | "text" | undefined> = []
    const result = await askVideo({
      provider: {
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-test-placeholder",
        model: "gpt-4.1-mini"
      },
      question: "Where does the demo start?",
      transcript: {
        videoId: "video-1",
        title: "Demo video",
        cues: TRANSCRIPT_CUES
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
        createChatCompletion: async ({ responseFormat }) => {
          calls.push(responseFormat)

          return JSON.stringify({
            answer: "The demo starts after setup.",
            citations: [
              {
                text: "Demo begins",
                startSec: 10,
                endSec: 20
              }
            ],
            suggestedJumps: [],
            followUps: []
          })
        }
      }
    })

    expect(calls).toEqual(["json_object"])
    expect(result.answer.answer).toBe("The demo starts after setup.")
  })

  it("returns clear errors for missing provider, transcript, and provider failures", async () => {
    await expect(
      askVideo({
        provider: null,
        question: "Question?",
        transcript: {
          videoId: "video-1",
          cues: TRANSCRIPT_CUES
        }
      })
    ).rejects.toThrow("Configure a default provider")

    await expect(
      askVideo({
        provider: {
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test-placeholder",
          model: "gpt-4.1-mini"
        },
        question: "Question?",
        transcript: {
          videoId: "video-1",
          cues: []
        }
      })
    ).rejects.toThrow("Transcript cues are required")

    await expect(
      askVideo({
        provider: {
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test-placeholder",
          model: "gpt-4.1-mini"
        },
        question: "Question?",
        transcript: {
          videoId: "video-1",
          cues: TRANSCRIPT_CUES
        },
        client: {
          provider: {
            baseUrl: "https://api.example.com/v1",
            apiKey: "sk-test-placeholder",
            model: "gpt-4.1-mini"
          },
          testConnection: async () => ({
            ok: false as const,
            baseUrl: "https://api.example.com/v1",
            model: "gpt-4.1-mini",
            latencyMs: 1,
            error: "Provider unavailable."
          }),
          createChatCompletion: async () => {
            throw new Error("Provider unavailable.")
          }
        }
      })
    ).rejects.toThrow("Provider unavailable.")
  })
})
