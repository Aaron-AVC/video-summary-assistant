import {
  hasProviderHostPermission
} from "@/features/settings/lib/provider-permissions"
import {
  normalizeProviderBaseUrl,
  parseProviderConnectionInput,
  parseProviderModelDiscoveryInput,
  DEFAULT_PROVIDER_GENERATION_TIMEOUT_SEC,
  type ProviderModelDiscoveryInput,
  type ProviderConnectionInput
} from "@/features/settings/lib/provider-schema"

type ChatCompletionMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
type OpenAICompatibleClientOptions = {
  fetchImpl?: FetchLike
  timeoutMs?: number
  setTimeoutImpl?: (callback: () => void, timeoutMs: number) => unknown
  clearTimeoutImpl?: (handle: unknown) => void
}

type ChatCompletionOptions = {
  messages: ChatCompletionMessage[]
  temperature?: number
  signal?: AbortSignal
  timeoutMs?: number
  timeoutPurpose?: "control" | "generation"
}

export type ConnectionTestResult =
  | {
      ok: true
      model: string
      baseUrl: string
      latencyMs: number
    }
  | {
      ok: false
      model: string
      baseUrl: string
      latencyMs: number
      error: string
    }

export type ProviderModelsResult = {
  models: string[]
  error?: string
}

export const DEFAULT_PROVIDER_CONTROL_TIMEOUT_MS = 30_000
export const DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS = DEFAULT_PROVIDER_GENERATION_TIMEOUT_SEC * 1000
const MANUAL_MODEL_FALLBACK_MESSAGE = "Model list unavailable — enter a model ID manually."

type OpenAICompatibleResponse = {
  error?: {
    message?: string
  }
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
    }
  }>
}

export class OpenAICompatibleClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OpenAICompatibleClientError"
  }
}

export function buildProviderEndpoint(baseUrl: string, suffix: "models" | "chat/completions"): string {
  return `${normalizeProviderBaseUrl(baseUrl)}/${suffix}`
}

export function redactProviderError(value: unknown, apiKey?: string): string {
  let message = value instanceof Error ? value.message : String(value ?? "Unknown provider error.")
  const secret = apiKey?.trim()
  if (secret) message = message.split(secret).join("[REDACTED]")
  return message
    .replace(/Bearer\s+[^\s,;"']+/gi, "Bearer [REDACTED]")
    .replace(/(authorization|api[-_ ]?key)\s*[:=]\s*[^\s,;"']+/gi, "$1: [REDACTED]")
    .replace(/\bheaders?\s*[:=]\s*\{[^}]*\}/gi, "headers: [REDACTED]")
}

function createRequestSignal(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  timers: Pick<OpenAICompatibleClientOptions, "setTimeoutImpl" | "clearTimeoutImpl"> = {},
) {
  const controller = new AbortController()
  let timedOut = false
  let timeoutHandle: unknown
  const setTimeoutImpl = timers.setTimeoutImpl ?? setTimeout
  const clearTimeoutImpl = timers.clearTimeoutImpl ?? clearTimeout

  const abortFromParent = () => controller.abort(parentSignal?.reason)
  if (parentSignal) {
    if (parentSignal.aborted) abortFromParent()
    else parentSignal.addEventListener("abort", abortFromParent, { once: true })
  }

  if (!controller.signal.aborted && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeoutHandle = setTimeoutImpl(() => {
      if (controller.signal.aborted) return
      timedOut = true
      controller.abort()
    }, timeoutMs)
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      if (timeoutHandle !== undefined) clearTimeoutImpl(timeoutHandle)
      parentSignal?.removeEventListener("abort", abortFromParent)
    },
  }
}

function formatTimeoutDuration(timeoutMs: number): string {
  return timeoutMs % 1000 === 0 ? `${timeoutMs / 1000} seconds` : `${timeoutMs} ms`
}

function providerTimeoutMessage(timeoutPurpose: "control" | "generation", timeoutMs: number): string {
  return `Provider ${timeoutPurpose} request timed out after ${formatTimeoutDuration(timeoutMs)}.`
}

export async function assertProviderHostPermission(baseUrl: string): Promise<void> {
  if (!(await hasProviderHostPermission(baseUrl))) {
    throw new OpenAICompatibleClientError(
      "Provider host permission is not granted. Return to Settings to authorize this provider."
    )
  }
}

export async function fetchProviderModels(
  input: ProviderModelDiscoveryInput,
  options: OpenAICompatibleClientOptions = {},
): Promise<ProviderModelsResult> {
  const provider = parseProviderModelDiscoveryInput(input)
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROVIDER_CONTROL_TIMEOUT_MS
  const request = createRequestSignal(undefined, timeoutMs, options)
  try {
    await assertProviderHostPermission(provider.baseUrl)
    const response = await fetchImpl(buildProviderEndpoint(provider.baseUrl, "models"), {
      method: "GET",
      headers: { Authorization: `Bearer ${provider.apiKey}` },
      signal: request.signal,
    })
    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      throw new Error("Model list response was not valid JSON.")
    }
    if (!response.ok) {
      const message = (payload as OpenAICompatibleResponse | null)?.error?.message
      throw new Error(message || `Model list request failed with status ${response.status}.`)
    }
    const entries = (payload as { data?: unknown } | null)?.data
    if (!Array.isArray(entries)) {
      throw new Error("Model list response did not include a model data array.")
    }
    const models: string[] = []
    const seen = new Set<string>()
    for (const entry of entries) {
      const id = typeof entry === "string" ? entry.trim() : (
        entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string"
          ? (entry as { id: string }).id.trim()
          : ""
      )
      if (id && !seen.has(id)) {
        seen.add(id)
        models.push(id)
      }
    }
    if (models.length === 0) {
      return { models, error: `${MANUAL_MODEL_FALLBACK_MESSAGE} No model IDs were returned.` }
    }
    return { models }
  } catch (error) {
    return {
      models: [],
      error: `${MANUAL_MODEL_FALLBACK_MESSAGE} ${request.didTimeout() ? providerTimeoutMessage("control", timeoutMs) : redactProviderError(error, provider.apiKey)}`
    }
  } finally {
    request.cleanup()
  }
}

export function createOpenAICompatibleClient(
  input: ProviderConnectionInput,
  options: OpenAICompatibleClientOptions = {}
) {
  const provider = parseProviderConnectionInput(input)
  const fetchImpl = options.fetchImpl ?? fetch

  async function createChatCompletion({
    messages,
    temperature = 0.2,
    signal,
    timeoutMs: requestTimeoutOverride,
    timeoutPurpose = "generation"
  }: ChatCompletionOptions): Promise<string> {
    await assertProviderHostPermission(provider.baseUrl)
    let response: Response
    let payload: OpenAICompatibleResponse
    const timeoutMs = requestTimeoutOverride
      ?? options.timeoutMs
      ?? (provider.generationTimeoutSec ?? DEFAULT_PROVIDER_GENERATION_TIMEOUT_SEC) * 1000
    const request = createRequestSignal(signal, timeoutMs, options)
    try {
      response = await fetchImpl(buildProviderEndpoint(provider.baseUrl, "chat/completions"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`
        },
        body: JSON.stringify({
          model: provider.model,
          temperature,
          messages
        }),
        signal: request.signal
      })
      payload = (await response.json()) as OpenAICompatibleResponse
    } catch (error) {
      if (signal?.aborted) {
        throw new OpenAICompatibleClientError(redactProviderError(error, provider.apiKey))
      }
      if (request.didTimeout()) {
        throw new OpenAICompatibleClientError(providerTimeoutMessage(timeoutPurpose, timeoutMs))
      }
      throw new OpenAICompatibleClientError(redactProviderError(error, provider.apiKey))
    } finally {
      request.cleanup()
    }

    if (!response.ok) {
      throw new OpenAICompatibleClientError(redactProviderError(
        payload.error?.message ?? `Provider request failed with status ${response.status}.`,
        provider.apiKey,
      ))
    }

    const text = extractMessageText(payload.choices?.[0]?.message?.content)
    if (!text) throw new OpenAICompatibleClientError("Provider response did not include assistant content.")
    return text
  }

  async function testConnection(): Promise<ConnectionTestResult> {
    const startedAt = Date.now()
    try {
      await createChatCompletion({
        messages: [
          { role: "system", content: "You validate API connectivity." },
          { role: "user", content: 'Reply with the single word "pong".' }
        ],
        temperature: 0,
        timeoutMs: options.timeoutMs ?? DEFAULT_PROVIDER_CONTROL_TIMEOUT_MS,
        timeoutPurpose: "control"
      })
      return { ok: true, model: provider.model, baseUrl: provider.baseUrl, latencyMs: Date.now() - startedAt }
    } catch (error) {
      return {
        ok: false,
        model: provider.model,
        baseUrl: provider.baseUrl,
        latencyMs: Date.now() - startedAt,
        error: redactProviderError(error, provider.apiKey)
      }
    }
  }

  return { provider, createChatCompletion, testConnection }
}

function extractMessageText(content: OpenAICompatibleResponse["choices"] extends Array<infer T>
  ? T extends { message?: { content?: infer TContent } } ? TContent : never
  : never) {
  if (typeof content === "string") return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((item) => (item.type === "text" && typeof item.text === "string" ? item.text : ""))
      .join("\n")
      .trim()
  }
  return ""
}

export type { FetchLike, ProviderConnectionInput }
