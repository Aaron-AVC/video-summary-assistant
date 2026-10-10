import type { AskVideoAnswer, VideoAnalysis } from "@/features/analysis/lib/analysis-schema"
import {
  VIDEO_ANALYSIS_PROMPT_VERSION,
  VIDEO_ANALYSIS_SCHEMA_VERSION
} from "@/features/analysis/lib/analysis-schema"
import type { TranscriptCue } from "@/features/transcript/lib/transcript-schema"

/** Bump when the canonical cue serialization changes. */
export const TRANSCRIPT_FINGERPRINT_VERSION = 1
export const VIDEO_QA_SCHEMA_VERSION = 1
export const VIDEO_QA_PROMPT_VERSION = "video-qa-v1"

export type AnalysisCacheIdentityInput = {
  contentKey: string
  transcriptFingerprint: string
  schemaVersion?: number
  promptVersion?: string
  providerProfileId: string
  baseUrl: string
  model: string
}

export type QaCacheIdentityInput = {
  contentKey: string
  transcriptFingerprint: string
  analysisRunId: string
  providerProfileId: string
  baseUrl: string
  model: string
  question: string
  schemaVersion?: number
  promptVersion?: string
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    )
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function normalizeCacheBaseUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl.trim())
  parsed.protocol = parsed.protocol.toLowerCase()
  parsed.hostname = parsed.hostname.toLowerCase()
  parsed.hash = ""
  parsed.search = ""
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/"
  return parsed.toString().replace(/\/$/, "")
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  )
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function normalizeCue(cue: TranscriptCue) {
  return {
    startSec: Number(cue.startSec),
    endSec: Number(cue.endSec),
    text: cue.text.trim().replace(/\s+/g, " ")
  }
}

export function canonicalTranscriptCues(cues: TranscriptCue[]) {
  return cues.map(normalizeCue)
}

export async function computeTranscriptFingerprint(cues: TranscriptCue[]): Promise<string> {
  return sha256Hex(canonicalJson({
    version: TRANSCRIPT_FINGERPRINT_VERSION,
    cues: canonicalTranscriptCues(cues)
  }))
}

export function buildAnalysisCacheIdentity(input: AnalysisCacheIdentityInput) {
  return {
    contentKey: input.contentKey,
    transcriptFingerprint: input.transcriptFingerprint,
    schemaVersion: input.schemaVersion ?? VIDEO_ANALYSIS_SCHEMA_VERSION,
    promptVersion: input.promptVersion ?? VIDEO_ANALYSIS_PROMPT_VERSION,
    providerProfileId: input.providerProfileId,
    baseUrl: normalizeCacheBaseUrl(input.baseUrl),
    model: input.model.trim()
  }
}

export async function computeAnalysisCacheKey(input: AnalysisCacheIdentityInput): Promise<string> {
  return sha256Hex(canonicalJson(buildAnalysisCacheIdentity(input)))
}

export function buildQaCacheIdentity(input: QaCacheIdentityInput) {
  return {
    contentKey: input.contentKey,
    transcriptFingerprint: input.transcriptFingerprint,
    analysisRunId: input.analysisRunId,
    providerProfileId: input.providerProfileId,
    baseUrl: normalizeCacheBaseUrl(input.baseUrl),
    model: input.model.trim(),
    question: input.question.trim(),
    schemaVersion: input.schemaVersion ?? VIDEO_QA_SCHEMA_VERSION,
    promptVersion: input.promptVersion ?? VIDEO_QA_PROMPT_VERSION
  }
}

export async function computeQaCacheKey(input: QaCacheIdentityInput): Promise<string> {
  return sha256Hex(canonicalJson(buildQaCacheIdentity(input)))
}

export function isPersistedVideoAnalysis(value: unknown): value is VideoAnalysis {
  return Boolean(value && typeof value === "object" && "summary" in value && "chapters" in value)
}

export function isPersistedQaAnswer(value: unknown): value is AskVideoAnswer {
  return Boolean(value && typeof value === "object" && "answer" in value && "citations" in value)
}
