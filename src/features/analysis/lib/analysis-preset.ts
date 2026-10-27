import { VIDEO_ANALYSIS_PROMPT_VERSION } from "@/features/analysis/lib/analysis-schema"

/**
 * Built-in analysis presets.
 *
 * A preset only shapes how analysis content is organized, how dense it is, and
 * which emphasis the model prefers. It never selects a provider, model, timeout,
 * API key, or Ask Video answer policy, and the UI may only pass a preset id —
 * the Analysis domain resolves the strategy.
 */
export type AnalysisPresetId = "standard" | "concise" | "detailed"

export const ANALYSIS_PRESET_IDS = ["standard", "concise", "detailed"] as const

export const DEFAULT_ANALYSIS_PRESET_ID: AnalysisPresetId = "standard"

/**
 * Immutable execution strategy for one preset.
 *
 * `promptVersion` is the effective prompt identity used for cache keys, exact
 * cache validation, persistence, and publication. Bump it when this preset's
 * analysis semantics change incompatibly.
 */
export type AnalysisPresetStrategy = {
  readonly id: AnalysisPresetId
  readonly promptVersion: string
  readonly styleInstructions: readonly string[]
}

const CONCISE_STYLE_INSTRUCTIONS = [
  "Favor the highest-value conclusions: lead with the core result, then keep only the distinctions, causal links, and evidence boundaries needed to understand it.",
  "Compress repetition and low-value detail, but never drop information required to understand the video and never invent a conclusion."
] as const

const DETAILED_STYLE_INSTRUCTIONS = [
  "Explain important concepts, the structure of the argument, supporting examples, and key distinctions more fully.",
  "Keep valuable detail and time anchors that the transcript evidence supports.",
  "Separate what the video states explicitly from your own synthesis or inference, and never pad with repeated points or facts absent from the transcript."
] as const

/**
 * Standard contributes no style instructions of its own, so its effective prompt
 * version is exactly `VIDEO_ANALYSIS_PROMPT_VERSION`; the two other strategies
 * append a preset suffix. Every preset therefore inherits the current base
 * version automatically, and rows written under an older base version are not
 * reused — the analysis cache treats a prompt-version change as a miss.
 */
export const ANALYSIS_PRESET_STRATEGIES: Readonly<Record<AnalysisPresetId, AnalysisPresetStrategy>> =
  Object.freeze({
    standard: Object.freeze({
      id: "standard",
      promptVersion: VIDEO_ANALYSIS_PROMPT_VERSION,
      styleInstructions: Object.freeze([] as string[]),
    }),
    concise: Object.freeze({
      id: "concise",
      promptVersion: `${VIDEO_ANALYSIS_PROMPT_VERSION}+preset-concise-v1`,
      styleInstructions: Object.freeze([...CONCISE_STYLE_INSTRUCTIONS]),
    }),
    detailed: Object.freeze({
      id: "detailed",
      promptVersion: `${VIDEO_ANALYSIS_PROMPT_VERSION}+preset-detailed-v1`,
      styleInstructions: Object.freeze([...DETAILED_STYLE_INSTRUCTIONS]),
    }),
  })

export function isAnalysisPresetId(value: unknown): value is AnalysisPresetId {
  return typeof value === "string"
    && (ANALYSIS_PRESET_IDS as readonly string[]).includes(value)
}

/** Missing, invalid, and legacy-unknown ids fall back to the default preset. */
export function normalizeAnalysisPresetId(value: unknown): AnalysisPresetId {
  return isAnalysisPresetId(value) ? value : DEFAULT_ANALYSIS_PRESET_ID
}

export function resolveAnalysisPresetStrategy(value: unknown): AnalysisPresetStrategy {
  return ANALYSIS_PRESET_STRATEGIES[normalizeAnalysisPresetId(value)]
}

export function resolveAnalysisPromptVersion(value: unknown): string {
  return resolveAnalysisPresetStrategy(value).promptVersion
}

/**
 * Frozen copy captured into a task snapshot so a later global preset change can
 * never mutate a running task's strategy.
 */
export function createAnalysisPresetSnapshot(value: unknown): AnalysisPresetStrategy {
  const strategy = resolveAnalysisPresetStrategy(value)
  return Object.freeze({
    id: strategy.id,
    promptVersion: strategy.promptVersion,
    styleInstructions: Object.freeze([...strategy.styleInstructions]),
  })
}

/** The always-available strategy used when a caller supplies none. */
export const DEFAULT_ANALYSIS_PRESET_STRATEGY = ANALYSIS_PRESET_STRATEGIES.standard
