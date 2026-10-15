import { describe, expect, it } from "bun:test"

import {
  askVideo,
  buildAskVideoPrompt,
  deriveTranscriptCitationText,
  MAX_CITATION_TEXT_CHARS,
  parseAskVideoAnswerPayload
} from "@/features/analysis/lib/ask-video"
import {
  createOpenAICompatibleClient,
  DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS,
  OpenAICompatibleClientError
} from "@/features/analysis/lib/openai-compatible-client"
import {
  boundQaConversationContext,
  computeBoundedConversationContextFingerprint,
  computeConversationContextFingerprint,
} from "@/features/analysis/lib/qa-conversation-context"

const TRANSCRIPT_CUES = [
  { startSec: 0, endSec: 10, text: "Intro and setup" },
  { startSec: 10, endSec: 20, text: "Demo begins" },
  { startSec: 20, endSec: 30, text: "Wrap up" }
]

describe("ask video", () => {
  const validAnswer = JSON.stringify({
    answer: "The demo starts after setup.",
    citations: [{ text: "Demo begins", startSec: 10, endSec: 20 }],
    suggestedJumps: [],
    followUps: []
  })

  it("repairs invalid structured output exactly once", async () => {
    const calls: number[] = []
    const responses = ["not json", validAnswer]
    const client = {
      provider: { baseUrl: "https://api.example.com/v1", apiKey: "sk-test-placeholder", model: "gpt-4.1-mini" },
      testConnection: async () => ({ ok: true as const, baseUrl: "https://api.example.com/v1", model: "gpt-4.1-mini", latencyMs: 1 }),
      createChatCompletion: async () => {
        calls.push(1)
        return responses.shift() ?? "unexpected"
      }
    }
    const result = await askVideo({
      provider: client.provider,
      question: "Where does the demo start?",
      transcript: { videoId: "video-1", cues: TRANSCRIPT_CUES },
      client: client as never
    })
    expect(result.repairAttempted).toBe(true)
    expect(calls).toHaveLength(2)
  })

  it("passes the same abort signal to the initial and repair requests", async () => {
    const signalController = new AbortController()
    const signals: AbortSignal[] = []
    const responses = ["not json", validAnswer]
    const client = {
      provider: { baseUrl: "https://api.example.com/v1", apiKey: "sk-test-placeholder", model: "gpt-4.1-mini" },
      testConnection: async () => ({ ok: true as const, baseUrl: "https://api.example.com/v1", model: "gpt-4.1-mini", latencyMs: 1 }),
      createChatCompletion: async ({ signal }: { signal?: AbortSignal }) => {
        if (signal) signals.push(signal)
        return responses.shift() ?? "unexpected"
      }
    }
    await askVideo({
      provider: client.provider,
      question: "Where does the demo start?",
      transcript: { videoId: "video-1", cues: TRANSCRIPT_CUES },
      client: client as never,
      signal: signalController.signal,
    })
    expect(signals).toEqual([signalController.signal, signalController.signal])
  })

  it("repairs citation grounding failures and errors after the second invalid response", async () => {
    const responses = [
      JSON.stringify({ answer: "Outside", citations: [{ startSec: 50, endSec: 60 }] }),
      JSON.stringify({ answer: "Still outside", citations: [{ startSec: 50, endSec: 60 }] })
    ]
    const client = {
      provider: { baseUrl: "https://api.example.com/v1", apiKey: "sk-test-placeholder", model: "gpt-4.1-mini" },
      testConnection: async () => ({ ok: true as const, baseUrl: "https://api.example.com/v1", model: "gpt-4.1-mini", latencyMs: 1 }),
      createChatCompletion: async () => responses.shift() ?? "unexpected"
    }
    await expect(askVideo({
      provider: client.provider,
      question: "Where?",
      transcript: { videoId: "video-1", cues: TRANSCRIPT_CUES },
      client: client as never
    })).rejects.toThrow("after one repair attempt")
  })
  it("builds prompts with transcript context and JSON instructions", () => {
    const prompt = buildAskVideoPrompt({
      question: "Where does the demo start?",
      videoId: "video-1",
      videoTitle: "Demo video",
      transcriptCues: TRANSCRIPT_CUES,
      analysis: null
    })

    expect(prompt.systemPrompt).toContain("JSON only")
    expect(prompt.systemPrompt).not.toContain("YouTube")
    expect(prompt.userPrompt).toContain("Where does the demo start?")
    expect(prompt.userPrompt).toContain("10s-20s")
    expect(prompt.userPrompt).toContain("citations")
    expect(prompt.userPrompt).toContain("suggestedJumps")
    expect(prompt.systemPrompt).toContain("prefer the discourse topic established by the user's previous turns")
    expect(prompt.systemPrompt).toContain("does not directly explain")
    expect(prompt.systemPrompt).toContain("smallest transcript span")
  })

  it("includes bounded conversation history as auxiliary context", () => {
    const prompt = buildAskVideoPrompt({
      question: "Why?",
      videoId: "video-1",
      transcriptCues: TRANSCRIPT_CUES,
      conversationHistory: [
        { role: "user", content: "What happened first?" },
        { role: "assistant", content: "The setup." }
      ]
    })
    expect(prompt.systemPrompt).toContain("conversation history")
    expect(prompt.userPrompt).not.toContain("Recent conversation history")
    expect(prompt.boundedHistory).toEqual([
      { role: "user", content: "What happened first?" },
      { role: "assistant", content: "The setup." }
    ])
  })

  it("uses real chat roles and sends bounded history exactly once", async () => {
    let capturedMessages: Array<{ role: string; content: string }> = []
    const history = Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `message-${index}`
    }))
    await askVideo({
      provider: {
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-test-placeholder",
        model: "gpt-4.1-mini"
      },
      question: "What happened next?",
      transcript: { videoId: "video-1", cues: TRANSCRIPT_CUES },
      conversationHistory: history,
      client: {
        provider: {
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test-placeholder",
          model: "gpt-4.1-mini"
        },
        testConnection: async () => ({ ok: true as const, baseUrl: "https://api.example.com/v1", model: "gpt-4.1-mini", latencyMs: 1 }),
        createChatCompletion: async ({ messages }) => {
          capturedMessages = messages
          return validAnswer
        }
      }
    })
    expect(capturedMessages.map((message) => message.role)).toEqual([
      "system", "user", "assistant", "user", "assistant", "user", "assistant", "user"
    ])
    expect(capturedMessages.filter((message) => message.content.includes("Recent conversation history")).length).toBe(0)
    expect(capturedMessages.at(-1)?.content).toContain("What happened next?")
    expect(capturedMessages.slice(1, -1).map((message) => message.content)).toEqual([
      "message-2", "message-3", "message-4", "message-5", "message-6", "message-7"
    ])
  })

  it("keeps the bounded provider history identical to the fingerprint input", async () => {
    const history = Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `message-${index}`
    }))
    const prompt = buildAskVideoPrompt({
      question: "What happened next?",
      videoId: "video-1",
      transcriptCues: TRANSCRIPT_CUES,
      conversationHistory: history
    })
    const bounded = boundQaConversationContext(history)
    expect(prompt.boundedHistory).toEqual(bounded)
    expect(await computeBoundedConversationContextFingerprint(prompt.boundedHistory))
      .toBe(await computeConversationContextFingerprint(history))
  })

  it("parses structured answers and validates citation ranges", () => {
    expect(
      parseAskVideoAnswerPayload(
        JSON.stringify({
          answer: "The demo starts after setup.",
          citations: [{ text: "1059年...1139年...1274年...", startSec: 10, endSec: 20 }],
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

  it("derives citation text from overlapping transcript cues and ignores model prose", () => {
    const answer = parseAskVideoAnswerPayload(
      JSON.stringify({
        answer: "The demo starts after setup.",
        citations: [{ text: "1059年...1139年...1274年...", startSec: 5, endSec: 25 }],
        suggestedJumps: [],
        followUps: []
      }),
      [
        { startSec: 0, endSec: 10, text: "Intro and setup" },
        { startSec: 10, endSec: 20, text: "Demo begins" },
        { startSec: 20, endSec: 30, text: "Wrap up" }
      ]
    )
    expect(answer.citations[0].text).toBe("Intro and setup Demo begins Wrap up")
    expect(answer.citations[0].text).not.toContain("1059年")
  })

  it("deduplicates adjacent identical cues and truncates excerpts deterministically", () => {
    const repeated = "A source sentence with punctuation. "
    const cues = [
      { startSec: 0, endSec: 5, text: repeated },
      { startSec: 5, endSec: 10, text: repeated },
      { startSec: 10, endSec: 15, text: "…… source punctuation stays intact" },
      { startSec: 15, endSec: 20, text: "x".repeat(400) }
    ]
    const excerpt = deriveTranscriptCitationText({ startSec: 0, endSec: 20, transcriptCues: cues })
    expect(excerpt).toContain("A source sentence with punctuation.")
    expect(excerpt).toContain("…… source punctuation stays intact")
    expect(excerpt.length).toBeLessThanOrEqual(MAX_CITATION_TEXT_CHARS)
    expect(excerpt.endsWith("…")).toBe(true)
    expect(excerpt.slice(0, -1).endsWith("…")).toBe(false)
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

    expect(() =>
      parseAskVideoAnswerPayload(
        {
          answer: "Blank",
          citations: [{ startSec: 0, endSec: 10 }]
        },
        [{ startSec: 0, endSec: 10, text: "   " }]
      )
    ).toThrow("Ask AI returned no citations that line up with the transcript.")
  })

  it("runs Ask AI through the provider with prompt-only JSON instructions", async () => {
    const calls: string[] = []
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
        createChatCompletion: async ({ messages }) => {
          calls.push(messages.at(-1)?.content ?? "")

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

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain("Return JSON with keys answer, citations, suggestedJumps, and followUps.")
    expect(result.answer.answer).toBe("The demo starts after setup.")
  })

  it("uses the generation timeout for Ask Video and structured repair", async () => {
    const provider = {
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-placeholder",
      model: "gpt-4.1-mini"
    }
    const scheduledTimeouts: number[] = []
    const bodies: string[] = []
    const responses = ["not json", validAnswer]
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

    const result = await askVideo({
      provider,
      question: "Where does the demo start?",
      transcript: { videoId: "video-1", cues: TRANSCRIPT_CUES },
      client
    })
    expect(result.repairAttempted).toBe(true)
    expect(scheduledTimeouts).toEqual([
      DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS,
      DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS
    ])
    expect(bodies.every((body) => !body.includes("response_format"))).toBe(true)
  })

  it("does not automatically retry or wrap a provider timeout during Ask Video", async () => {
    const provider = {
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-placeholder",
      model: "gpt-4.1-mini"
    }
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

    await expect(askVideo({
      provider,
      question: "Where does the demo start?",
      transcript: { videoId: "video-1", cues: TRANSCRIPT_CUES },
      client
    })).rejects.toMatchObject({
      name: "OpenAICompatibleClientError",
      message: `Provider generation request timed out after ${DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS / 1000} seconds.`
    })
    expect(fetchCount).toBe(1)
  })

  it("preserves timeout errors from Ask Video structured repair", async () => {
    const provider = {
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-placeholder",
      model: "gpt-4.1-mini"
    }
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

    const error = await askVideo({
      provider,
      question: "Where does the demo start?",
      transcript: { videoId: "video-1", cues: TRANSCRIPT_CUES },
      client
    }).then(() => null, (cause: unknown) => cause)
    expect(error).toBeInstanceOf(OpenAICompatibleClientError)
    expect(error).toMatchObject({
      message: `Provider generation request timed out after ${DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS / 1000} seconds.`
    })
    expect(scheduledTimeouts).toEqual([
      DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS,
      DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS
    ])
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
