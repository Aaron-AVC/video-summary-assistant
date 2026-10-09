import { describe, expect, it } from "bun:test"

import {
  planReductionGroups,
  planTranscriptChunks
} from "@/features/analysis/lib/analysis-plan"
import {
  AnalysisInputBudgetExceededError,
  ReductionCannotProgressError,
  type AnalysisBudgetPolicy
} from "@/features/analysis/lib/analysis-budget"
import type { TranscriptCue } from "@/features/transcript/lib/transcript-schema"

describe("budget-aware transcript planning", () => {
  const cues: TranscriptCue[] = [
    { startSec: 0, endSec: 5, text: `alpha ${"a".repeat(180)}` },
    { startSec: 5, endSec: 10, text: `beta ${"b".repeat(180)}` },
    { startSec: 10, endSec: 15, text: `gamma ${"c".repeat(180)}` },
    { startSec: 15, endSec: 20, text: `delta ${"d".repeat(180)}` }
  ]

  it("greedily preserves cue order exactly once without splitting and is deterministic", () => {
    const policy = findPolicy((candidate) => {
      try {
        const chunks = planTranscriptChunks({ cues, budgetPolicy: candidate })
        return chunks.length >= 2 && chunks.length < cues.length
      } catch {
        return false
      }
    })
    const first = planTranscriptChunks({ cues, budgetPolicy: policy })
    const second = planTranscriptChunks({ cues, budgetPolicy: policy })

    expect(second).toEqual(first)
    expect(first.flatMap((chunk) => chunk.cues)).toEqual(cues)
    expect(first.flatMap((chunk) => chunk.cues).map((cue) => cue.text)).toEqual(cues.map((cue) => cue.text))
    for (const chunk of first) {
      expect(chunk.startSec).toBe(chunk.cues[0].startSec)
      expect(chunk.endSec).toBe(chunk.cues[chunk.cues.length - 1].endSec)
    }
  })

  it("rejects an oversized single cue instead of splitting or truncating it", () => {
    const oversized = [{ startSec: 0, endSec: 5, text: "x".repeat(10_000) }]
    expect(() => planTranscriptChunks({
      cues: oversized,
      budgetPolicy: policyForInputBudget(300)
    })).toThrow(AnalysisInputBudgetExceededError)
    expect(oversized[0].text).toHaveLength(10_000)
  })

  it("groups only adjacent summaries and rejects a budget that cannot merge any pair", () => {
    const summaries = Array.from({ length: 4 }, (_, index) => ({
      chunkId: `chunk-${index + 1}`,
      startSec: index * 10,
      endSec: (index + 1) * 10,
      summary: `summary-${index + 1} ${"x".repeat(100)}`
    }))
    const groupingPolicy = findPolicy((candidate) => {
      try {
        const groups = planReductionGroups({ level: 1, summaries, budgetPolicy: candidate })
        return groups.length > 1 && groups.some((group) => group.length > 1)
      } catch {
        return false
      }
    })
    const groups = planReductionGroups({ level: 1, summaries, budgetPolicy: groupingPolicy })
    expect(groups.flat()).toEqual(summaries)
    expect(groups.every((group) => group.every(
      (summary, index) => index === 0 || summary.startSec === group[index - 1].endSec
    ))).toBe(true)

    const noProgressPolicy = findPolicy((candidate) => {
      try {
        planReductionGroups({ level: 1, summaries, budgetPolicy: candidate })
        return false
      } catch (error) {
        return error instanceof ReductionCannotProgressError
      }
    })
    expect(() => planReductionGroups({
      level: 1,
      summaries,
      budgetPolicy: noProgressPolicy
    })).toThrow(ReductionCannotProgressError)
  })
})

function policyForInputBudget(inputBudget: number): AnalysisBudgetPolicy {
  return {
    contextWindowEstimateTokens: inputBudget + 20,
    reservedCompletionTokens: 10,
    reservedRepairTokens: 10
  }
}

function findPolicy(predicate: (policy: AnalysisBudgetPolicy) => boolean): AnalysisBudgetPolicy {
  for (let inputBudget = 50; inputBudget <= 5_000; inputBudget += 5) {
    const policy = policyForInputBudget(inputBudget)
    if (predicate(policy)) return policy
  }
  throw new Error("No deterministic test budget matched the requested scenario.")
}
