import type { ProviderConfigExportEntity } from "@/lib/schemas/persistence"
import { DEFAULT_PROVIDER_GENERATION_TIMEOUT_SEC } from "@/features/settings/lib/provider-schema"

type ProviderConfigExportSource = {
  id: string
  name: string
  baseUrl: string
  model: string
  generationTimeoutSec?: unknown
  createdAt: string
  updatedAt: string
  isDefault?: boolean
  hasApiKey?: boolean
  /** Legacy rows may still contain this field at runtime; it is never returned. */
  apiKey?: unknown
}

export function sanitizeProviderConfigForExport(
  provider: ProviderConfigExportSource,
): ProviderConfigExportEntity {
  const metadata: ProviderConfigExportEntity = {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    model: provider.model,
    generationTimeoutSec: typeof provider.generationTimeoutSec === "number"
      ? provider.generationTimeoutSec
      : DEFAULT_PROVIDER_GENERATION_TIMEOUT_SEC,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
    hasApiKey: typeof provider.hasApiKey === "boolean"
      ? provider.hasApiKey
      : typeof provider.apiKey === "string" && provider.apiKey.trim().length > 0,
  }

  if (typeof provider.isDefault === "boolean") metadata.isDefault = provider.isDefault
  return metadata
}
