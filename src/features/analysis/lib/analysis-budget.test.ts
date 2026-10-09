import { describe, expect, it } from "bun:test"

import {
  DEFAULT_ANALYSIS_BUDGET_POLICY,
  deriveAnalysisInputBudget,
  deriveRepairInputBudget,
  InvalidAnalysisBudgetPolicyError,
  validateAnalysisBudgetPolicy
} from "@/features/analysis/lib/analysis-budget"

describe("analysis budget policy", () => {
  it("provides a conservative valid default with positive derived budgets", () => {
    expect(() => validateAnalysisBudgetPolicy(DEFAULT_ANALYSIS_BUDGET_POLICY)).not.toThrow()
    expect(deriveAnalysisInputBudget(DEFAULT_ANALYSIS_BUDGET_POLICY)).toBeGreaterThan(0)
    expect(deriveRepairInputBudget(DEFAULT_ANALYSIS_BUDGET_POLICY)).toBeGreaterThan(
      deriveAnalysisInputBudget(DEFAULT_ANALYSIS_BUDGET_POLICY)
    )
  })

  it("accepts an injected tiny but valid policy", () => {
    const policy = {
      contextWindowEstimateTokens: 100,
      reservedCompletionTokens: 20,
      reservedRepairTokens: 10
    }
    expect(deriveAnalysisInputBudget(policy)).toBe(70)
  })

  it("rejects non-positive and impossible configurations", () => {
    expect(() => validateAnalysisBudgetPolicy({
      contextWindowEstimateTokens: 0,
      reservedCompletionTokens: 1,
      reservedRepairTokens: 1
    })).toThrow(InvalidAnalysisBudgetPolicyError)
    expect(() => validateAnalysisBudgetPolicy({
      contextWindowEstimateTokens: 100,
      reservedCompletionTokens: 50,
      reservedRepairTokens: 50
    })).toThrow("leave no positive input budget")
    expect(() => validateAnalysisBudgetPolicy({
      contextWindowEstimateTokens: 100,
      reservedCompletionTokens: -1,
      reservedRepairTokens: 10
    })).toThrow(InvalidAnalysisBudgetPolicyError)
  })
})
