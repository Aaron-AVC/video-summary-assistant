import { describe, expect, it } from "bun:test"

import {
  createOpenAICompatibleClient,
  OpenAICompatibleClientError,
  buildProviderEndpoint,
  fetchProviderModels,
  redactProviderError,
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

  it("handles 404, malformed, and network connection failures without exposing request details", async () => {
    const cases = [
      {
        fetchImpl: async () => new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 }),
        expected: "not found",
      },
      {
        fetchImpl: async () => new Response("not-json", { status: 200 }),
        expected: "JSON",
      },
      {
        fetchImpl: async () => { throw new Error("network unavailable") },
        expected: "network unavailable",
      },
    ]

    for (const testCase of cases) {
      const client = createOpenAICompatibleClient({
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-connection-case",
        model: "manual-model",
      }, { fetchImpl: testCase.fetchImpl })
      await expect(client.testConnection()).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining(testCase.expected),
      })
    }
  })
})

describe("provider transport boundaries", () => {
  it("joins endpoints against the configured prefix exactly once", () => {
    expect(buildProviderEndpoint("https://x.example/v1/", "models")).toBe("https://x.example/v1/models")
    expect(buildProviderEndpoint("https://x.example/v1", "chat/completions")).toBe("https://x.example/v1/chat/completions")
  })

  it("discovers unique model IDs without making failure fatal", async () => {
    const requests: string[] = []
    const result = await fetchProviderModels({
      baseUrl: "https://models.example/v1",
      apiKey: "sk-model-sentinel",
      model: "manual-model",
    }, {
      fetchImpl: async (input) => {
        requests.push(String(input))
        return new Response(JSON.stringify({ data: [
          { id: "b" }, { id: "a" }, { id: "a" }, { id: "" }, "c"
        ] }), { status: 200 })
      }
    })
    expect(result).toEqual({ models: ["b", "a", "c"] })
    expect(requests).toEqual(["https://models.example/v1/models"])

    await expect(fetchProviderModels({
      baseUrl: "https://models.example/v1",
      apiKey: "sk-model-sentinel",
      model: "manual-model",
    }, {
      fetchImpl: async () => new Response("not-json", { status: 404 })
    })).resolves.toMatchObject({ models: [], error: expect.stringContaining("Model list unavailable") })

    await expect(fetchProviderModels({
      baseUrl: "https://models.example/v1",
      apiKey: "sk-model-sentinel",
      model: "manual-model",
    }, {
      fetchImpl: async () => new Response(JSON.stringify({ data: [] }), { status: 200 })
    })).resolves.toEqual({
      models: [],
      error: expect.stringContaining("Model list unavailable — enter a model ID manually.")
    })

    await expect(fetchProviderModels({
      baseUrl: "https://models.example/v1",
      apiKey: "sk-model-sentinel",
      model: "manual-model",
    }, {
      fetchImpl: async () => new Response(JSON.stringify({ models: ["not-data"] }), { status: 200 })
    })).resolves.toEqual({
      models: [],
      error: expect.stringContaining("Model list unavailable — enter a model ID manually.")
    })
  })

  it("shares timeout handling across provider requests", async () => {
    const client = createOpenAICompatibleClient({
      baseUrl: "https://timeout.example/v1",
      apiKey: "sk-timeout-sentinel",
      model: "manual-model",
    }, {
      timeoutMs: 5,
      fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
      })
    })

    await expect(client.testConnection()).resolves.toMatchObject({
      ok: false,
      error: "Provider request timed out."
    })
  })

  it("redacts key, bearer, authorization, and header dumps", () => {
    const message = redactProviderError(
      new Error("echo sk-secret-must-not-export Authorization: Bearer sk-secret-must-not-export headers: { Authorization: Bearer sk-secret-must-not-export }"),
      "sk-secret-must-not-export",
    )
    expect(message).not.toContain("sk-secret-must-not-export")
    expect(message).toContain("[REDACTED]")
  })

  it("includes the explicit model in connection requests and redacts echoed provider errors", async () => {
    let body = ""
    const secret = "sk-connection-secret"
    const client = createOpenAICompatibleClient({
      baseUrl: "https://relay.example/v1",
      apiKey: secret,
      model: "manual-model",
    }, {
      fetchImpl: async (_input, init) => {
        body = String(init?.body)
        return new Response(JSON.stringify({ error: { message: `provider echoed ${secret}` } }), { status: 401 })
      }
    })
    const result = await client.testConnection()
    expect(body).toContain('"model":"manual-model"')
    expect(result.ok).toBe(false)
    if (result.ok === false) expect(result.error).not.toContain(secret)
  })
})
