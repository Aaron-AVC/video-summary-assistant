import { z } from "zod"

export const DEFAULT_PROVIDER_GENERATION_TIMEOUT_SEC = 600
export const MIN_PROVIDER_GENERATION_TIMEOUT_SEC = 60
export const MAX_PROVIDER_GENERATION_TIMEOUT_SEC = 1800

const providerGenerationTimeoutSchema = z
  .number()
  .int("Generation timeout must be a whole number of seconds.")
  .min(MIN_PROVIDER_GENERATION_TIMEOUT_SEC, `Generation timeout must be at least ${MIN_PROVIDER_GENERATION_TIMEOUT_SEC} seconds.`)
  .max(MAX_PROVIDER_GENERATION_TIMEOUT_SEC, `Generation timeout must be at most ${MAX_PROVIDER_GENERATION_TIMEOUT_SEC} seconds.`)
  .optional()
  .transform((value) => value ?? DEFAULT_PROVIDER_GENERATION_TIMEOUT_SEC)

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])

function normalizeProviderBaseUrl(value: string): string {
  const trimmed = value.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error("Base URL must be a valid URL.")
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Base URL must use http or https.")
  }
  if (parsed.username || parsed.password) {
    throw new Error("Base URL must not contain username or password.")
  }
  if (parsed.search || parsed.hash) {
    throw new Error("Base URL must not contain a query or fragment.")
  }
  if (parsed.protocol === "http:" && !isLoopbackProviderHost(parsed.hostname)) {
    throw new Error("Non-loopback HTTP provider URLs are not allowed.")
  }

  return trimmed.replace(/\/+$/, "")
}

const providerUrlSchema = z
  .string()
  .trim()
  .min(1, "Base URL is required.")
  .transform((value, context) => {
    try {
      return normalizeProviderBaseUrl(value)
    } catch (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "Base URL is invalid."
      })
      return z.NEVER
    }
  })

export const providerProfileInputSchema = z.object({
  name: z.string().trim().min(1, "Provider name is required."),
  baseUrl: providerUrlSchema,
  model: z.string().trim().min(1, "Model is required."),
  generationTimeoutSec: providerGenerationTimeoutSchema,
})

export const providerConfigInputSchema = providerProfileInputSchema.extend({
  apiKey: z.string().trim().min(1, "API key is required.")
})

export const providerConnectionInputSchema = z.object({
  baseUrl: providerUrlSchema,
  apiKey: z.string().trim().min(1, "API key is required."),
  model: z.string().trim().min(1, "Model is required."),
  generationTimeoutSec: providerGenerationTimeoutSchema,
})

export const providerModelDiscoveryInputSchema = z.object({
  baseUrl: providerUrlSchema,
  apiKey: z.string().trim().min(1, "API key is required.")
})

export type ProviderProfileInput = z.input<typeof providerProfileInputSchema>
export type ProviderConfigInput = z.input<typeof providerConfigInputSchema>
export type ProviderConnectionInput = z.input<typeof providerConnectionInputSchema>
export type ProviderModelDiscoveryInput = z.input<typeof providerModelDiscoveryInputSchema>

export function parseProviderProfileInput(input: unknown): z.output<typeof providerProfileInputSchema> {
  return providerProfileInputSchema.parse(input)
}

export function parseProviderConfigInput(input: unknown): z.output<typeof providerConfigInputSchema> {
  return providerConfigInputSchema.parse(input)
}

export function parseProviderConnectionInput(input: unknown): z.output<typeof providerConnectionInputSchema> {
  return providerConnectionInputSchema.parse(input)
}

export function parseProviderModelDiscoveryInput(input: unknown): z.output<typeof providerModelDiscoveryInputSchema> {
  return providerModelDiscoveryInputSchema.parse(input)
}

export type ProviderUrlSafety =
  | { kind: "ok" }
  | { kind: "invalid"; reason: string }
  | { kind: "untrusted-http"; host: string }

export function classifyProviderUrlSafety(baseUrl: string): ProviderUrlSafety {
  const trimmed = baseUrl.trim()
  if (!trimmed) return { kind: "invalid", reason: "Base URL is empty." }

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { kind: "invalid", reason: "Base URL must use http or https." }
    }
    if (parsed.username || parsed.password) {
      return { kind: "invalid", reason: "Base URL must not contain username or password." }
    }
    if (parsed.search || parsed.hash) {
      return { kind: "invalid", reason: "Base URL must not contain a query or fragment." }
    }
    if (parsed.protocol === "http:" && !isLoopbackProviderHost(parsed.hostname)) {
      return { kind: "untrusted-http", host: parsed.hostname.toLowerCase() }
    }
    return { kind: "ok" }
  } catch {
    return { kind: "invalid", reason: "Base URL is not a valid URL." }
  }
}

export function isLoopbackProviderHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase())
}

export { normalizeProviderBaseUrl }
