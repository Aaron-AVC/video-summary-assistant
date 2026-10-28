import * as z from "zod"

import { parseVideoAnalysis, type VideoAnalysis } from "@/features/analysis/lib/analysis-schema"

export type StructuredParseIssue = {
  path: string
  message: string
}

export class StructuredOutputError extends Error {
  readonly issues: StructuredParseIssue[]

  constructor(message: string, issues: StructuredParseIssue[] = []) {
    super(message)
    this.name = "StructuredOutputError"
    this.issues = issues
  }
}

/** Parse only an object-shaped JSON response, after safe single-fence cleanup. */
export function parseStructuredJsonObject(input: unknown): Record<string, unknown> {
  const value = typeof input === "string" ? parseJsonText(input) : input
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StructuredOutputError("Structured output must be a JSON object.")
  }
  return value as Record<string, unknown>
}

export function parseVideoAnalysisPayload(input: unknown): VideoAnalysis {
  try {
    return parseVideoAnalysis(parseStructuredJsonObject(input))
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new StructuredOutputError("Structured video analysis did not satisfy the schema.", formatZodIssues(error))
    }
    throw error
  }
}

export function formatZodIssues(error: z.ZodError): StructuredParseIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join(".") : "root",
    message: issue.message
  }))
}

/**
 * Upper bound for one rendered diagnostic. Schema messages can embed values
 * taken from the model output — `Unrecognized key: "<raw key>"` is the common
 * case — so an unbounded message would let a response choose the size of the
 * repair prompt, and could smuggle a multi-line instruction past the fence
 * scanner's expectations.
 */
export const MAX_DIAGNOSTIC_CHARS = 240

/** Upper bound for the whole rendered diagnostic string. */
export const MAX_DIAGNOSTIC_TOTAL_CHARS = 1_200

const MAX_DIAGNOSTIC_ISSUES = 8

function clampDiagnostic(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit - 1))}…`
}

/**
 * Collect the structured issues behind an error. `ZodError` is included on
 * purpose: the Ask path lets a raw `ZodError` escape `parseAskVideoAnswerPayload`,
 * and `error.message` for that class is the full JSON-serialized issue list —
 * unbounded and useless to the model.
 */
function collectDiagnosticIssues(error: unknown): StructuredParseIssue[] {
  if (error instanceof StructuredOutputError && error.issues.length > 0) {
    return error.issues
  }
  if (error instanceof z.ZodError) {
    return formatZodIssues(error)
  }
  return []
}

/**
 * Render validation diagnostics for a repair prompt.
 *
 * The result is untrusted data: issue paths and messages can carry text taken
 * from the model response. Callers must fence it. It is also bounded, so a
 * hostile response cannot grow the repair prompt without limit.
 */
export function conciseStructuredIssues(error: unknown): string {
  const issues = collectDiagnosticIssues(error)
  if (issues.length === 0) {
    const fallback = error instanceof Error ? error.message : ""
    return clampDiagnostic(fallback.length > 0 ? fallback : "invalid structured output", MAX_DIAGNOSTIC_TOTAL_CHARS)
  }
  const rendered = issues
    .slice(0, MAX_DIAGNOSTIC_ISSUES)
    .map((issue) => clampDiagnostic(`${issue.path}: ${issue.message}`, MAX_DIAGNOSTIC_CHARS))
    .join("; ")
  return clampDiagnostic(rendered, MAX_DIAGNOSTIC_TOTAL_CHARS)
}

function parseJsonText(input: string): unknown {
  const trimmed = input.trim()
  const unfenced = stripSingleCodeFence(trimmed)
  try {
    return JSON.parse(unfenced) as unknown
  } catch {
    throw new StructuredOutputError("Structured output was not valid JSON.")
  }
}

function stripSingleCodeFence(input: string): string {
  const match = input.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return match ? match[1].trim() : input
}
