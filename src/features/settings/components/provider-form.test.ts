import { describe, expect, it } from "bun:test"

import { mapProviderToDraft } from "@/features/settings/components/provider-form"

describe("ProviderForm secret boundary", () => {
  it("never maps a saved API key into React draft state", () => {
    expect(mapProviderToDraft({
      id: "provider-1",
      name: "Provider",
      baseUrl: "https://api.example.com/v1",
      model: "model-id",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      isDefault: true,
      hasApiKey: true
    })).toEqual(expect.objectContaining({
      apiKey: "",
      hasApiKey: true
    }))
  })
})
