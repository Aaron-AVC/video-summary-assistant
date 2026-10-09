import { z } from "zod"

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
  model: z.string().trim().min(1, "Model is required.")
})

export const providerConfigInputSchema = providerProfileInputSchema.extend({
  apiKey: z.string().trim().min(1, "API key is required.")
})

export const providerConnectionInputSchema = z.object({
  baseUrl: providerUrlSchema,
  apiKey: z.string().trim().min(1, "API key is required."),
  model: z.string().trim().min(1, "Model is required.")
})

export const providerModelDiscoveryInputSchema = z.object({
  baseUrl: providerUrlSchema,
  apiKey: z.string().trim().min(1, "API key is required.")
})

export type ProviderProfileInput = z.infer<typeof providerProfileInputSchema>
export type ProviderConfigInput = z.infer<typeof providerConfigInputSchema>
export type ProviderConnectionInput = z.infer<typeof providerConnectionInputSchema>
export type ProviderModelDiscoveryInput = z.infer<typeof providerModelDiscoveryInputSchema>

export function parseProviderProfileInput(input: unknown): ProviderProfileInput {
  return providerProfileInputSchema.parse(input)
}

export function parseProviderConfigInput(input: unknown): ProviderConfigInput {
  return providerConfigInputSchema.parse(input)
}

export function parseProviderConnectionInput(input: unknown): ProviderConnectionInput {
  return providerConnectionInputSchema.parse(input)
}

export function parseProviderModelDiscoveryInput(input: unknown): ProviderModelDiscoveryInput {
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
