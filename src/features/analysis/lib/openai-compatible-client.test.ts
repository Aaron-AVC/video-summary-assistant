import { describe, expect, it } from "bun:test"

import {
  createOpenAICompatibleClient,
  DEFAULT_PROVIDER_CONTROL_TIMEOUT_MS,
  DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS,
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
    expect(JSON.parse(String(requests[0]?.body))).not.toHaveProperty("response_format")
  })

  it("keeps final content compatible when a relay misroutes native JSON mode output", async () => {
    const bodies: Array<Record<string, unknown>> = []
    const client = createOpenAICompatibleClient(
      {
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-test-placeholder",
        model: "step-5-preview"
      },
      {
        fetchImpl: async (_input, init) => {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>
          bodies.push(body)
          const message = Object.prototype.hasOwnProperty.call(body, "response_format")
            ? { content: null, reasoning_content: '{"ok":true}' }
            : { content: '{"ok":true}', reasoning_content: "actual reasoning" }
          return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 })
        }
      }
    )

    await expect(client.createChatCompletion({
      messages: [{ role: "user", content: "Return JSON." }]
    })).resolves.toBe('{"ok":true}')
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).not.toHaveProperty("response_format")
  })

  it("does not treat reasoning content as assistant output when content is absent", async () => {
    const client = createOpenAICompatibleClient(
      {
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-test-placeholder",
        model: "step-5-preview"
      },
      {
        fetchImpl: async () => new Response(JSON.stringify({
          choices: [{ message: { content: null, reasoning_content: '{"ok":true}' } }]
        }), { status: 200 })
      }
    )

    await expect(client.createChatCompletion({
      messages: [{ role: "user", content: "Return JSON." }]
    })).rejects.toThrow("Provider response did not include assistant content.")
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
        messages: [{ role: "user", content: "hi" }]
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
    const requestInits: RequestInit[] = []
    const result = await fetchProviderModels({
      baseUrl: "https://models.example/v1",
      apiKey: "sk-model-sentinel",
    }, {
      fetchImpl: async (input, init) => {
        requests.push(String(input))
        requestInits.push(init ?? {})
        return new Response(JSON.stringify({ data: [
          { id: "b" }, { id: "a" }, { id: "a" }, { id: "" }, "c"
        ] }), { status: 200 })
      }
    })
    expect(result).toEqual({ models: ["b", "a", "c"] })
    expect(requests).toEqual(["https://models.example/v1/models"])
    expect(requestInits[0]?.method).toBe("GET")
    expect(requestInits[0]?.headers).toEqual({ Authorization: "Bearer sk-model-sentinel" })

    await expect(fetchProviderModels({
      baseUrl: "https://models.example/v1",
      apiKey: "sk-model-sentinel",
    }, {
      fetchImpl: async () => new Response("not-json", { status: 404 })
    })).resolves.toMatchObject({ models: [], error: expect.stringContaining("Model list unavailable") })

    await expect(fetchProviderModels({
      baseUrl: "https://models.example/v1",
      apiKey: "sk-model-sentinel",
    }, {
      fetchImpl: async () => new Response(JSON.stringify({ data: [] }), { status: 200 })
    })).resolves.toEqual({
      models: [],
      error: expect.stringContaining("Model list unavailable — enter a model ID manually.")
    })

    await expect(fetchProviderModels({
      baseUrl: "https://models.example/v1",
      apiKey: "sk-model-sentinel",
    }, {
      fetchImpl: async () => new Response(JSON.stringify({ models: ["not-data"] }), { status: 200 })
    })).resolves.toEqual({
      models: [],
      error: expect.stringContaining("Model list unavailable — enter a model ID manually.")
    })
  })

  it("uses the control timeout for model discovery by default", async () => {
    let scheduledTimeoutMs = 0
    await fetchProviderModels({
      baseUrl: "https://models.example/v1",
      apiKey: "sk-model-sentinel",
    }, {
      setTimeoutImpl: (callback, timeoutMs) => {
        scheduledTimeoutMs = timeoutMs
        callback()
        return 1
      },
      clearTimeoutImpl: () => undefined,
      fetchImpl: async (_input, init) => {
        if (init?.signal?.aborted) throw new Error("aborted")
        await new Promise<void>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
        })
        throw new Error("unreachable")
      }
    })
    expect(scheduledTimeoutMs).toBe(DEFAULT_PROVIDER_CONTROL_TIMEOUT_MS)
  })

  it("allows an explicit timeoutMs override for model discovery", async () => {
    let scheduledTimeoutMs = 0
    await fetchProviderModels({
      baseUrl: "https://models.example/v1",
      apiKey: "sk-model-sentinel",
    }, {
      timeoutMs: 11,
      setTimeoutImpl: (_callback, timeoutMs) => {
        scheduledTimeoutMs = timeoutMs
        return 1
      },
      clearTimeoutImpl: () => undefined,
      fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: "model-a" }] }), { status: 200 })
    })
    expect(scheduledTimeoutMs).toBe(11)
  })

  it("uses the control timeout for test connection by default", async () => {
    let scheduledTimeoutMs = 0
    const client = createOpenAICompatibleClient({
      baseUrl: "https://timeout.example/v1",
      apiKey: "sk-timeout-sentinel",
      model: "manual-model",
    }, {
      setTimeoutImpl: (callback, timeoutMs) => {
        scheduledTimeoutMs = timeoutMs
        callback()
        return 1
      },
      clearTimeoutImpl: () => undefined,
      fetchImpl: async (_input, init) => {
        if (init?.signal?.aborted) throw new Error("aborted")
        await new Promise<void>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
        })
        throw new Error("unreachable")
      }
    })

    await expect(client.testConnection()).resolves.toMatchObject({
      ok: false,
      error: `Provider control request timed out after ${DEFAULT_PROVIDER_CONTROL_TIMEOUT_MS / 1000} seconds.`
    })
    expect(scheduledTimeoutMs).toBe(DEFAULT_PROVIDER_CONTROL_TIMEOUT_MS)
  })

  it("uses the generation timeout for chat completion by default", async () => {
    let scheduledTimeoutMs = 0
    const client = createOpenAICompatibleClient({
      baseUrl: "https://timeout.example/v1",
      apiKey: "sk-timeout-sentinel",
      model: "manual-model",
    }, {
      setTimeoutImpl: (callback, timeoutMs) => {
        scheduledTimeoutMs = timeoutMs
        callback()
        return 1
      },
      clearTimeoutImpl: () => undefined,
      fetchImpl: async (_input, init) => {
        if (init?.signal?.aborted) throw new Error("aborted")
        await new Promise<void>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
        })
        throw new Error("unreachable")
      }
    })

    await expect(client.createChatCompletion({
      messages: [{ role: "user", content: "hi" }]
    })).rejects.toThrow(
      `Provider generation request timed out after ${DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS / 1000} seconds.`
    )
    expect(scheduledTimeoutMs).toBe(DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS)
    expect(scheduledTimeoutMs).toBeGreaterThan(30_000)
  })

  it("uses the configured provider generation timeout without sending it in the request body", async () => {
    let scheduledTimeoutMs = 0
    let body = ""
    const client = createOpenAICompatibleClient({
      baseUrl: "https://timeout.example/v1",
      apiKey: "sk-timeout-sentinel",
      model: "manual-model",
      generationTimeoutSec: 1800,
    }, {
      setTimeoutImpl: (_callback, timeoutMs) => {
        scheduledTimeoutMs = timeoutMs
        return 1
      },
      clearTimeoutImpl: () => undefined,
      fetchImpl: async (_input, init) => {
        body = String(init?.body)
        return new Response(JSON.stringify({ choices: [{ message: { content: "done" } }] }), { status: 200 })
      }
    })

    await expect(client.createChatCompletion({ messages: [{ role: "user", content: "hi" }] })).resolves.toBe("done")
    expect(scheduledTimeoutMs).toBe(1_800_000)
    expect(body).not.toContain("generationTimeout")
    expect(body).not.toContain("timeoutSec")
  })

  it("allows generation requests to run beyond the former 30-second boundary", async () => {
    const timers = createManualTimers()
    let resolveResponse: ((response: Response) => void) | undefined
    let requestSignal: AbortSignal | undefined
    let markFetchStarted: (() => void) | undefined
    const fetchStarted = new Promise<void>((resolve) => { markFetchStarted = resolve })
    const client = createOpenAICompatibleClient({
      baseUrl: "https://timeout.example/v1",
      apiKey: "sk-timeout-sentinel",
      model: "manual-model",
    }, {
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl,
      fetchImpl: async (_input, init) => {
        requestSignal = init?.signal
        markFetchStarted?.()
        return new Promise<Response>((resolve) => { resolveResponse = resolve })
      }
    })

    const completion = client.createChatCompletion({ messages: [{ role: "user", content: "hi" }] })
    await fetchStarted
    timers.advanceBy(30_001)

    expect(requestSignal?.aborted).toBe(false)
    expect(timers.scheduledTimeouts()).toEqual([DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS])
    resolveResponse?.(new Response(JSON.stringify({
      choices: [{ message: { content: "completed" } }]
    }), { status: 200 }))
    await expect(completion).resolves.toBe("completed")
  })

  it("lets explicit timeoutMs override both control and generation defaults", async () => {
    let scheduledTimeoutMs = 0
    const client = createOpenAICompatibleClient({
      baseUrl: "https://timeout.example/v1",
      apiKey: "sk-timeout-sentinel",
      model: "manual-model",
    }, {
      timeoutMs: 5,
      setTimeoutImpl: (callback, timeoutMs) => {
        scheduledTimeoutMs = timeoutMs
        callback()
        return 1
      },
      clearTimeoutImpl: () => undefined,
      fetchImpl: async (_input, init) => {
        if (init?.signal?.aborted) throw new Error("aborted")
        await new Promise<void>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
        })
        throw new Error("unreachable")
      }
    })

    await expect(client.testConnection()).resolves.toMatchObject({
      error: "Provider control request timed out after 5 ms."
    })
    expect(scheduledTimeoutMs).toBe(5)

    await expect(client.createChatCompletion({
      messages: [{ role: "user", content: "hi" }]
    })).rejects.toThrow("Provider generation request timed out after 5 ms.")
    expect(scheduledTimeoutMs).toBe(5)
  })

  it("does not misreport parent cancellation as a provider timeout", async () => {
    let scheduledTimeoutMs = 0
    let timeoutCallback: (() => void) | undefined
    let markFetchStarted: (() => void) | undefined
    const fetchStarted = new Promise<void>((resolve) => { markFetchStarted = resolve })
    const controller = new AbortController()
    const client = createOpenAICompatibleClient({
      baseUrl: "https://timeout.example/v1",
      apiKey: "sk-timeout-sentinel",
      model: "manual-model",
    }, {
      setTimeoutImpl: (callback, timeoutMs) => {
        scheduledTimeoutMs = timeoutMs
        timeoutCallback = callback
        return 1
      },
      clearTimeoutImpl: () => undefined,
      fetchImpl: async (_input, init) => {
        markFetchStarted?.()
        if (init?.signal?.aborted) throw new Error("aborted by user")
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted by user")), { once: true })
        })
      }
    })

    const request = client.createChatCompletion({
      messages: [{ role: "user", content: "hi" }],
      signal: controller.signal
    })
    await fetchStarted
    controller.abort("user cancelled")
    await expect(request).rejects.toMatchObject({
      name: "OpenAICompatibleClientError",
      message: "aborted by user"
    })
    expect(scheduledTimeoutMs).toBe(DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS)
    expect(timeoutCallback).toBeDefined()
    timeoutCallback?.()
  })

  it("does not automatically retry a generation timeout", async () => {
    const timers = createManualTimers()
    let fetchCount = 0
    let markFetchStarted: (() => void) | undefined
    const fetchStarted = new Promise<void>((resolve) => { markFetchStarted = resolve })
    const client = createOpenAICompatibleClient({
      baseUrl: "https://timeout.example/v1",
      apiKey: "sk-timeout-sentinel",
      model: "manual-model",
    }, {
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl,
      fetchImpl: async (_input, init) => {
        fetchCount += 1
        markFetchStarted?.()
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
        })
      }
    })

    const completion = client.createChatCompletion({ messages: [{ role: "user", content: "hi" }] })
    await fetchStarted
    timers.advanceBy(DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS)

    await expect(completion).rejects.toThrow(
      `Provider generation request timed out after ${DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS / 1000} seconds.`
    )
    expect(fetchCount).toBe(1)
  })

  it("leaves an injected timeout handle with its own scheduler when no clearTimeoutImpl is supplied", async () => {
    const timers = createManualTimers()
    const client = createOpenAICompatibleClient({
      baseUrl: "https://timeout.example/v1",
      apiKey: "sk-timeout-sentinel",
      model: "manual-model",
    }, {
      setTimeoutImpl: timers.setTimeoutImpl,
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{ message: { content: "ok" } }]
      }), { status: 200 })
    })

    await expect(client.createChatCompletion({ messages: [{ role: "user", content: "hi" }] })).resolves.toBe("ok")
    // 只注入 setTimeoutImpl 时，句柄所有权留在注入的调度器，不会交给原生 clearTimeout。
    expect(timers.scheduledTimeouts()).toEqual([DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS])
  })

  it("supports the explicit per-request timeout override", async () => {
    let scheduledTimeoutMs = 0
    const client = createOpenAICompatibleClient({
      baseUrl: "https://timeout.example/v1",
      apiKey: "sk-timeout-sentinel",
      model: "manual-model",
    }, {
      setTimeoutImpl: (callback, timeoutMs) => {
        scheduledTimeoutMs = timeoutMs
        callback()
        return 1
      },
      clearTimeoutImpl: () => undefined,
      fetchImpl: async (_input, init) => {
        if (init?.signal?.aborted) throw new Error("aborted")
        await new Promise<void>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
        })
        throw new Error("unreachable")
      }
    })

    await expect(client.createChatCompletion({
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 7
    })).rejects.toThrow("Provider generation request timed out after 7 ms.")
    expect(scheduledTimeoutMs).toBe(7)
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
      error: "Provider control request timed out after 5 ms."
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

function createManualTimers() {
  type ManualTimer = { callback: () => void, dueAt: number, cancelled: boolean }
  const timers: ManualTimer[] = []
  let now = 0

  return {
    setTimeoutImpl: (callback: () => void, timeoutMs: number) => {
      const timer = { callback, dueAt: now + timeoutMs, cancelled: false }
      timers.push(timer)
      return timer
    },
    clearTimeoutImpl: (handle: unknown) => {
      ;(handle as unknown as ManualTimer).cancelled = true
    },
    advanceBy: (durationMs: number) => {
      now += durationMs
      for (const timer of timers) {
        if (!timer.cancelled && timer.dueAt <= now) {
          timer.cancelled = true
          timer.callback()
        }
      }
    },
    scheduledTimeouts: () => timers.filter((timer) => !timer.cancelled).map((timer) => timer.dueAt),
  }
}
