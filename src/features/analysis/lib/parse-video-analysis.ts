import { z } from "zod"

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

export function conciseStructuredIssues(error: unknown): string {
  if (error instanceof StructuredOutputError && error.issues.length > 0) {
    return error.issues.slice(0, 8).map((issue) => `${issue.path}: ${issue.message}`).join("; ")
  }
  return error instanceof Error ? error.message : "invalid structured output"
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
