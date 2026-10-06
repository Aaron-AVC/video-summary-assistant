import type { ProviderConfigExportEntity } from "@/lib/schemas/persistence"

type ProviderConfigExportSource = {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  createdAt: string
  updatedAt: string
  isDefault?: boolean
}

export function sanitizeProviderConfigForExport(
  provider: ProviderConfigExportSource
): ProviderConfigExportEntity {
  const metadata: ProviderConfigExportEntity = {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    model: provider.model,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
    hasApiKey: provider.apiKey.trim().length > 0
  }

  if (typeof provider.isDefault === "boolean") {
    metadata.isDefault = provider.isDefault
  }

  return metadata
}
