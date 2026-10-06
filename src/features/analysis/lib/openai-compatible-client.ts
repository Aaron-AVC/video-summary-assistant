import { parseProviderConnectionInput, type ProviderConnectionInput } from "@/features/settings/lib/provider-schema"

type ChatCompletionMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

type OpenAICompatibleClientOptions = {
  fetchImpl?: FetchLike
}

type ChatCompletionOptions = {
  messages: ChatCompletionMessage[]
  temperature?: number
  responseFormat?: "json_object" | "text"
  signal?: AbortSignal
}

type ConnectionTestResult =
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

export function createOpenAICompatibleClient(
  input: ProviderConnectionInput,
  options: OpenAICompatibleClientOptions = {}
) {
  const provider = parseProviderConnectionInput(input)
  const fetchImpl = options.fetchImpl ?? fetch

  async function createChatCompletion({
    messages,
    temperature = 0.2,
    responseFormat = "text",
    signal
  }: ChatCompletionOptions): Promise<string> {
    const response = await fetchImpl(buildEndpoint(provider.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: provider.model,
        temperature,
        messages,
        ...(responseFormat === "json_object"
          ? {
              response_format: {
                type: "json_object"
              }
            }
          : {})
      }),
      signal
    })

    const payload = (await response.json()) as OpenAICompatibleResponse

    if (!response.ok) {
      throw new OpenAICompatibleClientError(
        payload.error?.message ?? `Provider request failed with status ${response.status}.`
      )
    }

    const content = payload.choices?.[0]?.message?.content
    const text = extractMessageText(content)

    if (!text) {
      throw new OpenAICompatibleClientError("Provider response did not include assistant content.")
    }

    return text
  }

  async function testConnection(): Promise<ConnectionTestResult> {
    const startedAt = Date.now()

    try {
      await createChatCompletion({
        messages: [
          {
            role: "system",
            content: "You validate API connectivity."
          },
          {
            role: "user",
            content: 'Reply with the single word "pong".'
          }
        ],
        temperature: 0,
        responseFormat: "text"
      })

      return {
        ok: true,
        model: provider.model,
        baseUrl: provider.baseUrl,
        latencyMs: Date.now() - startedAt
      }
    } catch (error) {
      return {
        ok: false,
        model: provider.model,
        baseUrl: provider.baseUrl,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "Unknown provider error."
      }
    }
  }

  return {
    provider,
    createChatCompletion,
    testConnection
  }
}

function buildEndpoint(baseUrl: string) {
  return `${baseUrl}/chat/completions`
}

function extractMessageText(
  content: OpenAICompatibleResponse["choices"] extends Array<infer T>
    ? T extends { message?: { content?: infer TContent } }
      ? TContent
      : never
    : never
) {
  if (typeof content === "string") {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => (item.type === "text" && typeof item.text === "string" ? item.text : ""))
      .join("\n")
      .trim()
  }

  return ""
}
