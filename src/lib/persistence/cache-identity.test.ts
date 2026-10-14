import { describe, expect, it } from "bun:test"

import {
  buildAnalysisCacheIdentity,
  computeAnalysisCacheKey,
  computeQaCacheKey,
  computeTranscriptFingerprint,
  isExactCurrentAnalysis,
  normalizeCacheBaseUrl
} from "@/lib/persistence/cache-identity"

const cues = [
  { startSec: 0, endSec: 2, text: " Hello   world " },
  { startSec: 2, endSec: 5, text: "Next" }
]

describe("content-aware persistence identities", () => {
  it("fingerprints cue text byte-for-byte and excludes source metadata", async () => {
    const first = await computeTranscriptFingerprint(cues)
    const equivalent = await computeTranscriptFingerprint([
      { startSec: 0, endSec: 2, text: "Hello world" },
      { startSec: 2, endSec: 5, text: "Next" }
    ])
    const changed = await computeTranscriptFingerprint([
      ...cues.slice(0, 1),
      { startSec: 2, endSec: 5, text: "Changed" }
    ])

    expect(first).not.toBe(equivalent)
    expect(first).not.toBe(changed)
  })

  it("keeps identical normalized cues stable while preserving whitespace changes", async () => {
    const first = await computeTranscriptFingerprint([
      { startSec: 0, endSec: 2, text: "a  b" }
    ])
    const same = await computeTranscriptFingerprint([
      { startSec: 0, endSec: 2, text: "a  b" }
    ])
    const changed = await computeTranscriptFingerprint([
      { startSec: 0, endSec: 2, text: "a b" }
    ])
    expect(first).toBe(same)
    expect(first).not.toBe(changed)
  })

  it("recognizes only an exact current analysis identity", () => {
    const identity = {
      contentKey: "youtube:a",
      transcriptFingerprint: "fp",
      providerProfileId: "profile",
      baseUrl: "https://api.example.com/v1",
      model: "model",
      analysisSchemaVersion: 1,
      analysisPromptVersion: "prompt"
    }
    expect(isExactCurrentAnalysis(identity, { ...identity, baseUrl: "https://API.EXAMPLE.COM/v1/" })).toBe(true)
    expect(isExactCurrentAnalysis(identity, { ...identity, transcriptFingerprint: "other" })).toBe(false)
    expect(isExactCurrentAnalysis(identity, { ...identity, model: "model-2" })).toBe(false)
    expect(isExactCurrentAnalysis({ ...identity, baseUrl: null }, identity)).toBe(false)
    expect(isExactCurrentAnalysis({ ...identity, providerProfileId: "other-profile" }, identity)).toBe(false)
    expect(isExactCurrentAnalysis({ ...identity, baseUrl: "https://other.example.com/v1" }, identity)).toBe(false)
    expect(isExactCurrentAnalysis({ ...identity, analysisSchemaVersion: 2 }, identity)).toBe(false)
    expect(isExactCurrentAnalysis({ ...identity, analysisPromptVersion: "other-prompt" }, identity)).toBe(false)
    expect(isExactCurrentAnalysis({ ...identity, transcriptFingerprint: null }, identity)).toBe(false)
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

  it("does not include the provider generation timeout", async () => {
    const base = {
      contentKey: "youtube:a",
      transcriptFingerprint: "fp-a",
      providerProfileId: "profile-a",
      baseUrl: "https://api.example.com/v1",
      model: "model-a",
    }
    expect(await computeAnalysisCacheKey(base)).toBe(await computeAnalysisCacheKey({ ...base, generationTimeoutSec: 1800 } as never))
  })

  it("separates the same question across conversation contexts while retaining legacy empty identity", async () => {
    const base = {
      contentKey: "youtube:video",
      transcriptFingerprint: "fp",
      analysisRunId: "run",
      providerProfileId: "provider",
      baseUrl: "https://api.example.com/v1",
      model: "model",
      question: "Why?"
    }
    const empty = await computeQaCacheKey(base)
    const first = await computeQaCacheKey({ ...base, conversationContextFingerprint: "context-a" })
    const second = await computeQaCacheKey({ ...base, conversationContextFingerprint: "context-b" })
    expect(first).not.toBe(second)
    expect(first).not.toBe(empty)
  })
})
