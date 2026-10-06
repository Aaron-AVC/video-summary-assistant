import { z } from "zod"

const providerUrlSchema = z
  .string()
  .trim()
  .min(1, "Base URL is required.")
  .url("Base URL must be a valid URL.")
  .refine((value) => {
    const url = new URL(value)

    return url.protocol === "http:" || url.protocol === "https:"
  }, "Base URL must use http or https.")
  .transform((value) => value.replace(/\/+$/, ""))

export const providerConfigInputSchema = z.object({
  name: z.string().trim().min(1, "Provider name is required."),
  baseUrl: providerUrlSchema,
  apiKey: z.string().trim().min(1, "API key is required."),
  model: z.string().trim().min(1, "Model is required.")
})

export const providerConnectionInputSchema = providerConfigInputSchema.pick({
  baseUrl: true,
  apiKey: true,
  model: true
})

export type ProviderConfigInput = z.infer<typeof providerConfigInputSchema>
export type ProviderConnectionInput = z.infer<typeof providerConnectionInputSchema>

export function parseProviderConfigInput(input: unknown): ProviderConfigInput {
  return providerConfigInputSchema.parse(input)
}

export function parseProviderConnectionInput(input: unknown): ProviderConnectionInput {
  return providerConnectionInputSchema.parse(input)
}

/**
 * Hosts that are always treated as safe http targets even without TLS.
 * Covers Ollama, LM Studio, llama.cpp server, and other in-machine providers.
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])

export type ProviderUrlSafety =
  | { kind: "ok" }
  | { kind: "invalid"; reason: string }
  | { kind: "untrusted-http"; host: string }

/**
 * Classifies a provider base URL for SSRF / accidental-key-leak risk.
 *
 * - `ok`: https URL, or http URL on the loopback allowlist.
 * - `untrusted-http`: http URL aimed at a non-loopback host. The caller MUST
 *   warn the user and refuse to send the API key without explicit confirmation.
 * - `invalid`: cannot be parsed or uses an unsupported scheme.
 */
export function classifyProviderUrlSafety(baseUrl: string): ProviderUrlSafety {
  const trimmed = baseUrl.trim()

  if (trimmed.length === 0) {
    return { kind: "invalid", reason: "Base URL is empty." }
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { kind: "invalid", reason: "Base URL is not a valid URL." }
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { kind: "invalid", reason: "Base URL must use http or https." }
  }

  if (parsed.protocol === "https:") {
    return { kind: "ok" }
  }

  const host = parsed.hostname.toLowerCase()

  if (LOOPBACK_HOSTS.has(host) || host === "[::1]") {
    return { kind: "ok" }
  }

  return { kind: "untrusted-http", host }
}

export function isLoopbackProviderHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase())
}
