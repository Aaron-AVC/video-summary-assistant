import { describe, expect, it } from "bun:test"

import {
  ANALYSIS_PRESET_IDS,
  ANALYSIS_PRESET_STRATEGIES,
  DEFAULT_ANALYSIS_PRESET_ID,
  DEFAULT_ANALYSIS_PRESET_STRATEGY,
  createAnalysisPresetSnapshot,
  isAnalysisPresetId,
  normalizeAnalysisPresetId,
  resolveAnalysisPresetStrategy,
  resolveAnalysisPromptVersion,
} from "@/features/analysis/lib/analysis-preset"
import type { AnalysisPresetId } from "@/features/analysis/lib/analysis-preset"
import {
  VIDEO_ANALYSIS_PROMPT_VERSION,
  VIDEO_ANALYSIS_SCHEMA_VERSION,
} from "@/features/analysis/lib/analysis-schema"
import { isExactCurrentAnalysis } from "@/lib/persistence/cache-identity"

describe("analysis presets", () => {
  it("defaults to standard", () => {
    expect(DEFAULT_ANALYSIS_PRESET_ID).toBe("standard")
    expect(DEFAULT_ANALYSIS_PRESET_STRATEGY.id).toBe("standard")
    expect(DEFAULT_ANALYSIS_PRESET_STRATEGY).toBe(ANALYSIS_PRESET_STRATEGIES.standard)
  })

  it("exposes exactly three stable, unique preset ids", () => {
    expect([...ANALYSIS_PRESET_IDS]).toEqual(["standard", "concise", "detailed"])
    expect(new Set(ANALYSIS_PRESET_IDS).size).toBe(3)
    for (const presetId of ANALYSIS_PRESET_IDS) {
      expect(isAnalysisPresetId(presetId)).toBe(true)
      expect(ANALYSIS_PRESET_STRATEGIES[presetId].id).toBe(presetId)
    }
  })

  it("normalizes missing, invalid and legacy values back to standard", () => {
    for (const value of [undefined, null, "", "legacy-unknown", "Standard", "CONCISE", 42, {}, []]) {
      expect(normalizeAnalysisPresetId(value)).toBe("standard")
      expect(resolveAnalysisPromptVersion(value)).toBe(VIDEO_ANALYSIS_PROMPT_VERSION)
      expect(resolveAnalysisPresetStrategy(value)).toBe(ANALYSIS_PRESET_STRATEGIES.standard)
    }
  })

  it("keeps standard on the existing prompt version and gives the new presets their own", () => {
    expect(resolveAnalysisPromptVersion("standard")).toBe(VIDEO_ANALYSIS_PROMPT_VERSION)
    expect(resolveAnalysisPromptVersion("concise")).toBe(
      `${VIDEO_ANALYSIS_PROMPT_VERSION}+preset-concise-v1`,
    )
    expect(resolveAnalysisPromptVersion("detailed")).toBe(
      `${VIDEO_ANALYSIS_PROMPT_VERSION}+preset-detailed-v1`,
    )
    const versions = ANALYSIS_PRESET_IDS.map(resolveAnalysisPromptVersion)
    expect(new Set(versions).size).toBe(3)
  })

  it("keeps standard free of style instructions so its prompt stays compatible", () => {
    expect(ANALYSIS_PRESET_STRATEGIES.standard.styleInstructions).toEqual([])
    for (const presetId of ["concise", "detailed"] as const) {
      expect(ANALYSIS_PRESET_STRATEGIES[presetId].styleInstructions.length).toBeGreaterThan(0)
    }
  })

  it("freezes the strategy table so an execution strategy cannot drift", () => {
    expect(Object.isFrozen(ANALYSIS_PRESET_STRATEGIES)).toBe(true)
    expect(Object.isFrozen(ANALYSIS_PRESET_STRATEGIES.standard)).toBe(true)
    expect(Object.isFrozen(ANALYSIS_PRESET_STRATEGIES.concise)).toBe(true)
    expect(Object.isFrozen(ANALYSIS_PRESET_STRATEGIES.standard.styleInstructions)).toBe(true)
    expect(() => {
      (ANALYSIS_PRESET_STRATEGIES.concise.styleInstructions as string[]).push("mutated")
    }).toThrow()
  })

  it("captures an immutable snapshot that later lookups cannot mutate", () => {
    const snapshot = createAnalysisPresetSnapshot("detailed")
    const before = [...snapshot.styleInstructions]

    expect(snapshot.id).toBe("detailed")
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.styleInstructions)).toBe(true)
    expect(() => {
      (snapshot.styleInstructions as string[]).push("mutated")
    }).toThrow()

    expect(createAnalysisPresetSnapshot("standard"))
    expect([...ANALYSIS_PRESET_STRATEGIES.detailed.styleInstructions]).toEqual(before)
    expect([...snapshot.styleInstructions]).toEqual(before)
  })

  it("creates independent snapshot arrays per call", () => {
    const first = createAnalysisPresetSnapshot("concise")
    const second = createAnalysisPresetSnapshot("concise")

    expect(first.styleInstructions).toEqual(second.styleInstructions)
    expect(first.styleInstructions).not.toBe(second.styleInstructions)
    expect(first.styleInstructions).not.toBe(ANALYSIS_PRESET_STRATEGIES.concise.styleInstructions)
  })
})

describe("analysis preset current-analysis identity", () => {
  type Identity = Parameters<typeof isExactCurrentAnalysis>[0]

  function displayedIdentity(promptVersion: string): Identity {
    return {
      contentKey: "youtube:video-a",
      transcriptFingerprint: "fp-1",
      providerProfileId: "profile-1",
      baseUrl: "https://api.example.com",
      model: "model-1",
      analysisSchemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
      analysisPromptVersion: promptVersion,
    }
  }

  /** Mirrors the root: the expected identity follows the selected preset. */
  function expectedIdentity(selectedPresetId: AnalysisPresetId): Identity {
    return displayedIdentity(resolveAnalysisPromptVersion(selectedPresetId))
  }

  it("A. accepts a concise analysis while concise is selected", () => {
    const displayed = displayedIdentity(resolveAnalysisPromptVersion("concise"))

    expect(isExactCurrentAnalysis(displayed, expectedIdentity("concise"))).toBe(true)
    expect(displayed.analysisPromptVersion).toBe(
      `${VIDEO_ANALYSIS_PROMPT_VERSION}+preset-concise-v1`,
    )
  })

  it("B. accepts a detailed analysis while detailed is selected", () => {
    const displayed = displayedIdentity(resolveAnalysisPromptVersion("detailed"))

    expect(isExactCurrentAnalysis(displayed, expectedIdentity("detailed"))).toBe(true)
    expect(displayed.analysisPromptVersion).toBe(
      `${VIDEO_ANALYSIS_PROMPT_VERSION}+preset-detailed-v1`,
    )
  })

  it("C. rejects a standard analysis while concise is selected", () => {
    const displayed = displayedIdentity(VIDEO_ANALYSIS_PROMPT_VERSION)

    expect(isExactCurrentAnalysis(displayed, expectedIdentity("concise"))).toBe(false)
  })

  it("D. rejects a concise analysis while detailed is selected", () => {
    const displayed = displayedIdentity(resolveAnalysisPromptVersion("concise"))

    expect(isExactCurrentAnalysis(displayed, expectedIdentity("detailed"))).toBe(false)
  })

  it("keeps a standard analysis exact while standard is selected", () => {
    const displayed = displayedIdentity(VIDEO_ANALYSIS_PROMPT_VERSION)

    expect(isExactCurrentAnalysis(displayed, expectedIdentity("standard"))).toBe(true)
  })

  it("keeps the pre-preset standard cache identity intact", () => {
    expect(resolveAnalysisPromptVersion("standard")).toBe(VIDEO_ANALYSIS_PROMPT_VERSION)
    expect(resolveAnalysisPromptVersion(undefined)).toBe(VIDEO_ANALYSIS_PROMPT_VERSION)
  })
})
