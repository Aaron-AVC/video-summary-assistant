import { describe, expect, it } from "bun:test"

import {
  getFrozenQaProviderRequest,
  matchesQaThreadIdentity,
} from "@/sidepanel/lib/ask-conversation-identity"

const thread = {
  id: "thread-a",
  contentKey: "youtube:video",
  platform: "youtube" as const,
  videoId: "video",
  partId: null,
  title: "Question",
  analysisRunId: "run-1",
  transcriptFingerprint: "fp-1",
  providerProfileId: "provider-a",
  providerBaseUrl: "https://provider-a.example/v1",
  providerModel: "model-a",
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
}

describe("Ask conversation identity", () => {
  it("reuses a thread only for the same content, run, and transcript", () => {
    expect(matchesQaThreadIdentity(thread, {
      contentKey: "youtube:video",
      analysisRunId: "run-1",
      transcriptFingerprint: "fp-1",
    })).toBe(true)
    expect(matchesQaThreadIdentity(thread, {
      contentKey: "youtube:video",
      analysisRunId: "run-1",
      transcriptFingerprint: "fp-2",
    })).toBe(false)
  })

  it("keeps the frozen thread endpoint and model when the resolved profile is current provider B", () => {
    expect(getFrozenQaProviderRequest(thread, {
      apiKey: "key-b",
      credentialRevision: "credential-revision-b",
      profile: {
        id: "provider-b",
        name: "Provider B",
        baseUrl: "https://provider-b.example/v1",
        model: "model-b",
        generationTimeoutSec: 240,
        isDefault: true,
        hasApiKey: true,
        createdAt: "2026-10-14T00:00:00.000Z",
        updatedAt: "2026-10-14T00:00:00.000Z",
      },
    })).toEqual({
      baseUrl: "https://provider-a.example/v1",
      apiKey: "key-b",
      model: "model-a",
      generationTimeoutSec: 240,
    })
  })
})
