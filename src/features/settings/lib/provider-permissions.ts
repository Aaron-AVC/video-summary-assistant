import { normalizeProviderBaseUrl } from "@/features/settings/lib/provider-schema"

type PermissionsLike = {
  contains: (details: chrome.permissions.Permissions) => Promise<boolean>
  request: (details: chrome.permissions.Permissions) => Promise<boolean>
  remove?: (details: chrome.permissions.Permissions) => Promise<boolean>
}

function getPermissions(): PermissionsLike | null {
  return globalThis.chrome?.permissions ?? null
}

export function deriveProviderPermissionPattern(baseUrl: string): string {
  const normalized = normalizeProviderBaseUrl(baseUrl)
  const url = new URL(normalized)
  const host = url.hostname.includes(":") ? `[${url.hostname.replace(/^\[|\]$/g, "")}]` : url.hostname
  // Chrome extension match patterns scope by scheme + host, not port. The
  // normalized base URL still retains its port for the actual fetch endpoint.
  return `${url.protocol}//${host}/*`
}

export async function hasProviderHostPermission(
  baseUrl: string,
  permissions: PermissionsLike | null = getPermissions(),
): Promise<boolean> {
  if (!permissions) return true
  return permissions.contains({ origins: [deriveProviderPermissionPattern(baseUrl)] })
}

export async function requestProviderHostPermission(
  baseUrl: string,
  permissions: PermissionsLike | null = getPermissions(),
): Promise<boolean> {
  if (!permissions) return true
  const pattern = deriveProviderPermissionPattern(baseUrl)
  if (await permissions.contains({ origins: [pattern] })) return true
  return permissions.request({ origins: [pattern] })
}

export async function removeProviderHostPermission(
  baseUrl: string,
  permissions: PermissionsLike | null = getPermissions(),
): Promise<boolean> {
  if (!permissions?.remove) return false
  return permissions.remove({ origins: [deriveProviderPermissionPattern(baseUrl)] })
}

export type { PermissionsLike }
