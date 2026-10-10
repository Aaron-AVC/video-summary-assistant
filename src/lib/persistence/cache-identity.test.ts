import { describe, expect, it } from "bun:test"

import {
  buildAnalysisCacheIdentity,
  computeAnalysisCacheKey,
  computeQaCacheKey,
  computeTranscriptFingerprint,
  normalizeCacheBaseUrl
} from "@/lib/persistence/cache-identity"

const cues = [
  { startSec: 0, endSec: 2, text: " Hello   world " },
  { startSec: 2, endSec: 5, text: "Next" }
]

describe("content-aware persistence identities", () => {
  it("fingerprints canonical normalized cues and excludes source metadata", async () => {
    const first = await computeTranscriptFingerprint(cues)
    const equivalent = await computeTranscriptFingerprint([
      { startSec: 0, endSec: 2, text: "Hello world" },
      { startSec: 2, endSec: 5, text: "Next" }
    ])
    const changed = await computeTranscriptFingerprint([
      ...cues.slice(0, 1),
      { startSec: 2, endSec: 5, text: "Changed" }
    ])

    expect(first).toBe(equivalent)
    expect(first).not.toBe(changed)
  })

  it("normalizes base URLs without collapsing meaningful path prefixes", () => {
    expect(normalizeCacheBaseUrl("HTTPS://API.EXAMPLE.COM/v1///?ignored=1")).toBe("https://api.example.com/v1")
  })

  it("changes analysis keys for content, transcript, provider, endpoint, and model", async () => {
    const base = {
      contentKey: "youtube:a",
      transcriptFingerprint: "fp-a",
      providerProfileId: "profile-a",
      baseUrl: "https://api.example.com/v1",
      model: "model-a"
    }
    const first = await computeAnalysisCacheKey(base)
    expect(await computeAnalysisCacheKey({ ...base, contentKey: "bilibili:BV:p:1" })).not.toBe(first)
    expect(await computeAnalysisCacheKey({ ...base, transcriptFingerprint: "fp-b" })).not.toBe(first)
    expect(await computeAnalysisCacheKey({ ...base, providerProfileId: "profile-b" })).not.toBe(first)
    expect(await computeAnalysisCacheKey({ ...base, baseUrl: "https://api.example.com/other" })).not.toBe(first)
    expect(await computeAnalysisCacheKey({ ...base, model: "model-b" })).not.toBe(first)
    expect(await computeAnalysisCacheKey({ ...base, schemaVersion: 2 })).not.toBe(first)
    expect(await computeAnalysisCacheKey({ ...base, promptVersion: "video-analysis-v3" })).not.toBe(first)
    expect(buildAnalysisCacheIdentity({ ...base, baseUrl: "https://API.EXAMPLE.COM/v1/" })).toEqual(
      buildAnalysisCacheIdentity(base)
    )
  })

  it("does not include API keys, display names, or generated timestamps", async () => {
    const base = {
      contentKey: "youtube:a",
      transcriptFingerprint: "fp-a",
      providerProfileId: "profile-a",
      baseUrl: "https://api.example.com/v1",
      model: "model-a",
      question: "What happened?",
      analysisRunId: "run-a"
    }
    const first = await computeQaCacheKey(base)
    expect(await computeQaCacheKey({ ...base, question: "  What happened?  " })).toBe(first)
    expect(JSON.stringify(buildAnalysisCacheIdentity(base))).not.toContain("apiKey")
    expect(JSON.stringify(buildAnalysisCacheIdentity(base))).not.toContain("generatedAt")
  })
})
