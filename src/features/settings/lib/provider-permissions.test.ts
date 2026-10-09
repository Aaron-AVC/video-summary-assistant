import { describe, expect, it, mock } from "bun:test"

import {
  deriveProviderPermissionPattern,
  hasProviderHostPermission,
  requestProviderHostPermission,
} from "@/features/settings/lib/provider-permissions"

describe("provider host permissions", () => {
  it("derives one concrete origin pattern without exposing a path", () => {
    expect(deriveProviderPermissionPattern("https://relay.example.com/openai/v1"))
      .toBe("https://relay.example.com/*")
    expect(deriveProviderPermissionPattern("http://127.0.0.1:8000/v1"))
      .toBe("http://127.0.0.1/*")
    expect(deriveProviderPermissionPattern("http://localhost:1234/v1"))
      .toBe("http://localhost/*")
    expect(deriveProviderPermissionPattern("https://relay.example.com:8443/v1"))
      .toBe("https://relay.example.com/*")
    expect(deriveProviderPermissionPattern("http://[::1]:8000/v1"))
      .toBe("http://[::1]/*")
  })

  it("does not request an already granted permission", async () => {
    const permissions = {
      contains: mock(async () => true),
      request: mock(async () => false),
    }
    await expect(hasProviderHostPermission("https://api.example.com/v1", permissions)).resolves.toBe(true)
    await expect(requestProviderHostPermission("https://api.example.com/v1", permissions)).resolves.toBe(true)
    expect(permissions.request).not.toHaveBeenCalled()
  })

  it("requests only the current provider host when missing", async () => {
    const permissions = {
      contains: mock(async () => false),
      request: mock(async (details: chrome.permissions.Permissions) => details.origins?.[0] === "https://api.example.com/*"),
    }
    await expect(requestProviderHostPermission("https://api.example.com/v1", permissions)).resolves.toBe(true)
    expect(permissions.request).toHaveBeenCalledWith({ origins: ["https://api.example.com/*"] })
  })

  it("propagates a denied permission without retrying", async () => {
    const permissions = {
      contains: mock(async () => false),
      request: mock(async () => false),
    }
    await expect(requestProviderHostPermission("https://denied.example.com/v1", permissions)).resolves.toBe(false)
    expect(permissions.request).toHaveBeenCalledTimes(1)
  })

  it("omits ports from contains and request origins", async () => {
    const permissions = {
      contains: mock(async (details: chrome.permissions.Permissions) => {
        expect(details.origins).toEqual(["http://127.0.0.1/*"])
        return false
      }),
      request: mock(async (details: chrome.permissions.Permissions) => {
        expect(details.origins).toEqual(["http://127.0.0.1/*"])
        return true
      }),
    }

    await expect(requestProviderHostPermission("http://127.0.0.1:8000/v1", permissions)).resolves.toBe(true)
    expect(permissions.contains).toHaveBeenCalledTimes(1)
    expect(permissions.request).toHaveBeenCalledTimes(1)
  })
})
