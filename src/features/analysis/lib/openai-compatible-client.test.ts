import { describe, expect, it } from "bun:test"

import {
  createOpenAICompatibleClient,
  OpenAICompatibleClientError
} from "@/features/analysis/lib/openai-compatible-client"

describe("createOpenAICompatibleClient", () => {
  it("posts chat completions and returns assistant text", async () => {
    const requests: RequestInit[] = []
    const client = createOpenAICompatibleClient(
      {
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-test-placeholder",
        model: "gpt-4.1-mini"
      },
      {
        fetchImpl: async (_input, init) => {
          requests.push(init ?? {})

          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "  hello world  "
                  }
                }
              ]
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" }
            }
          )
        }
      }
    )

    await expect(
      client.createChatCompletion({
        messages: [{ role: "user", content: "hi" }]
      })
    ).resolves.toBe("hello world")

    expect(requests).toHaveLength(1)
    expect(requests[0]?.method).toBe("POST")
    expect(requests[0]?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer sk-test-placeholder"
      })
    )
  })

  it("flattens structured text content", async () => {
    const client = createOpenAICompatibleClient(
      {
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-test-placeholder",
        model: "gpt-4.1-mini"
      },
      {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: [
                      { type: "text", text: "first line" },
                      { type: "text", text: "second line" }
                    ]
                  }
                }
              ]
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" }
            }
          )
      }
    )

    await expect(
      client.createChatCompletion({
        messages: [{ role: "user", content: "hi" }],
        responseFormat: "json_object"
      })
    ).resolves.toBe("first line\nsecond line")
  })

  it("surfaces provider errors in connection probes", async () => {
    const client = createOpenAICompatibleClient(
      {
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-test-placeholder",
        model: "gpt-4.1-mini"
      },
      {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              error: {
                message: "invalid api key"
              }
            }),
            {
              status: 401,
              headers: { "Content-Type": "application/json" }
            }
          )
      }
    )

    await expect(
      client.createChatCompletion({
        messages: [{ role: "user", content: "hi" }]
      })
    ).rejects.toBeInstanceOf(OpenAICompatibleClientError)

    await expect(client.testConnection()).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: "invalid api key"
      })
    )
  })
})
