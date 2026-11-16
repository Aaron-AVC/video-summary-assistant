import { describe, expect, it } from "bun:test"

import {
  createOpenAICompatibleClient,
  fetchProviderModels,
} from "@/features/analysis/lib/openai-compatible-client"
import {
  DEFAULT_PROVIDER_RESPONSE_MAX_BYTES,
  ProviderResponseTooLargeError,
  readJsonBodyWithLimit,
} from "@/features/analysis/lib/provider-response-body"

/**
 * 构造一个会记录「被读取了多少字节」的流式 Response。
 *
 * 用流而不是普通字符串，是为了证明超限时读取会提前中止——如果实现先把整个
 * body 读进内存再检查长度，这里的 pulled 就会等于全部字节数。
 */
function streamingResponse(
  totalBytes: number,
  init: { status?: number, contentLength?: string | null, chunkBytes?: number } = {},
) {
  const chunkBytes = init.chunkBytes ?? 64 * 1024
  const state = { pulled: 0, cancelled: false }
  let sent = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close()
        return
      }
      const size = Math.min(chunkBytes, totalBytes - sent)
      sent += size
      state.pulled += size
      controller.enqueue(new Uint8Array(size).fill(0x20))
    },
    cancel() {
      state.cancelled = true
    },
  })
  const headers = new Headers()
  if (init.contentLength !== null) {
    headers.set("content-length", init.contentLength ?? String(totalBytes))
  }
  return {
    response: new Response(body, { status: init.status ?? 200, headers }),
    state,
  }
}

describe("readJsonBodyWithLimit", () => {
  it("parses a body that fits under the ceiling and releases the reader lock", async () => {
    const response = new Response(JSON.stringify({ ok: true }))
    const payload = await readJsonBodyWithLimit(response)
    expect(payload).toEqual({ ok: true })
    expect(response.body?.locked).toBe(false)
  })

  it("rejects on a declared Content-Length above the ceiling without streaming the body", async () => {
    const total = 64 * 1024 * 1024
    const { response, state } = streamingResponse(total, { contentLength: String(total) })
    await expect(readJsonBodyWithLimit(response)).rejects.toBeInstanceOf(ProviderResponseTooLargeError)
    // 构造 Response 时运行时可能预取一个 chunk；关键是绝不把 64 MiB 拉进来。
    expect(state.pulled).toBeLessThan(1024 * 1024)
    expect(state.pulled).toBeLessThan(total)
  })

  it("cancels an abandoned body when a declared Content-Length exceeds the ceiling", async () => {
    const total = 64 * 1024 * 1024
    const { response, state } = streamingResponse(total, { contentLength: String(total) })
    await expect(readJsonBodyWithLimit(response)).rejects.toBeInstanceOf(ProviderResponseTooLargeError)
    // 直接被拒绝的响应体也占着底层连接，必须显式取消而不是留给 GC。
    expect(state.cancelled).toBe(true)
  })

  it("keeps the size error when cancelling the abandoned body itself fails", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(16))
      },
      cancel() {
        throw new Error("cancel failed")
      },
    })
    const response = new Response(body, {
      status: 200,
      headers: { "content-length": String(64 * 1024 * 1024) },
    })
    await expect(readJsonBodyWithLimit(response)).rejects.toBeInstanceOf(ProviderResponseTooLargeError)
  })

  it("returns the size error without waiting for a cancel that never settles", async () => {
    let cancelCalled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(16))
      },
      cancel() {
        cancelCalled = true
        return new Promise<void>(() => undefined)
      },
    })
    const response = new Response(body, {
      status: 200,
      headers: { "content-length": String(64 * 1024 * 1024) },
    })
    const outcome = await Promise.race([
      readJsonBodyWithLimit(response).then(
        () => "resolved",
        (error) => (error instanceof ProviderResponseTooLargeError ? "size-error" : "unexpected"),
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve("blocked"), 50)),
    ])
    expect(outcome).toBe("size-error")
    expect(cancelCalled).toBe(true)
  })

  it("aborts the stream as soon as the running total crosses the ceiling", async () => {
    const { response, state } = streamingResponse(64 * 1024 * 1024, { contentLength: null })
    await expect(readJsonBodyWithLimit(response, 1024 * 1024)).rejects.toBeInstanceOf(ProviderResponseTooLargeError)
    // 只允许越过一个 chunk 的余量，绝不能把 64 MiB 全部拉进来。
    expect(state.pulled).toBeLessThanOrEqual(1024 * 1024 + 64 * 1024)
    expect(state.pulled).toBeLessThan(64 * 1024 * 1024)
  })

  it("cancels an oversized streaming body without waiting for a cancel that never settles", async () => {
    let cancelCalled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(64 * 1024))
      },
      cancel() {
        cancelCalled = true
        return new Promise<void>(() => undefined)
      },
    })
    const response = new Response(body, { status: 200 })
    const outcome = await Promise.race([
      readJsonBodyWithLimit(response, 1024).then(
        () => "resolved",
        (error) => (error instanceof ProviderResponseTooLargeError ? "size-error" : "unexpected"),
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve("blocked"), 50)),
    ])
    expect(outcome).toBe("size-error")
    expect(cancelCalled).toBe(true)
    expect(response.body?.locked).toBe(false)
  })

  it("keeps the size error when the streaming cancel itself fails", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(64 * 1024))
      },
      cancel() {
        throw new Error("streaming cancel failed")
      },
    })
    const response = new Response(body, { status: 200 })
    await expect(readJsonBodyWithLimit(response, 1024)).rejects.toBeInstanceOf(ProviderResponseTooLargeError)
  })

  it("cancels a stream that crosses the ceiling exactly once", async () => {
    let cancelCount = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(64 * 1024))
      },
      cancel() {
        cancelCount += 1
      },
    })
    const response = new Response(body, { status: 200 })
    await expect(readJsonBodyWithLimit(response, 1024 * 1024)).rejects.toBeInstanceOf(ProviderResponseTooLargeError)
    expect(cancelCount).toBe(1)
  })

  it("propagates a body read failure unchanged and releases the reader lock", async () => {
    const failure = new Error("network down")
    let reads = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1
        if (reads === 1) controller.enqueue(new Uint8Array(8))
        else controller.error(failure)
      },
    })
    const response = new Response(body, { status: 200 })
    await expect(readJsonBodyWithLimit(response)).rejects.toBe(failure)
    expect(response.body?.locked).toBe(false)
  })

  it("propagates an AbortError from the body read unchanged", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError")
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(abortError)
      },
    })
    const response = new Response(body, { status: 200 })
    await expect(readJsonBodyWithLimit(response)).rejects.toBe(abortError)
    expect(response.body?.locked).toBe(false)
  })

  it("does not trust a non-numeric Content-Length and still enforces the streaming ceiling", async () => {
    const { response, state } = streamingResponse(8 * 1024 * 1024, { contentLength: "not-a-number" })
    await expect(readJsonBodyWithLimit(response, 1024 * 1024)).rejects.toBeInstanceOf(ProviderResponseTooLargeError)
    expect(state.pulled).toBeLessThan(8 * 1024 * 1024)
  })

  it("surfaces a JSON syntax error unchanged when the body fits", async () => {
    const response = new Response("not-json")
    await expect(readJsonBodyWithLimit(response)).rejects.toBeInstanceOf(SyntaxError)
    expect(response.body?.locked).toBe(false)
  })

  it("keeps the default ceiling large enough for real provider payloads", () => {
    expect(DEFAULT_PROVIDER_RESPONSE_MAX_BYTES).toBeGreaterThanOrEqual(1024 * 1024)
  })
})

describe("provider transport honours the response body ceiling", () => {
  const connection = {
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test-placeholder",
    model: "gpt-4.1-mini",
  }

  it("rejects an oversized chat completion body with the size error, not a JSON error", async () => {
    const client = createOpenAICompatibleClient(connection, {
      fetchImpl: async () => streamingResponse(64 * 1024 * 1024, {
        contentLength: String(64 * 1024 * 1024),
      }).response,
    })
    const result = await client.testConnection()
    expect(result.ok).toBe(false)
    if (result.ok === false) {
      expect(result.error).toContain("byte limit")
      expect(result.error).not.toContain("valid JSON")
    }
  })

  it("rejects an oversized model-list body with the size error", async () => {
    const result = await fetchProviderModels({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-placeholder",
    }, {
      fetchImpl: async () => streamingResponse(64 * 1024 * 1024, {
        contentLength: String(64 * 1024 * 1024),
      }).response,
    })
    expect(result.models).toEqual([])
    expect(result.error).toContain("byte limit")
    expect(result.error).not.toContain("valid JSON")
  })

  it("still parses a normal chat completion payload end to end", async () => {
    const client = createOpenAICompatibleClient(connection, {
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{ message: { content: "pong" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    })
    const result = await client.testConnection()
    expect(result.ok).toBe(true)
  })
})
