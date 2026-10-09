export type AnalysisBudgetPolicy = {
  /** Heuristic context-window estimate; not a provider/model guarantee. */
  contextWindowEstimateTokens: number
  reservedCompletionTokens: number
  reservedRepairTokens: number
}

export const DEFAULT_ANALYSIS_BUDGET_POLICY: Readonly<AnalysisBudgetPolicy> = Object.freeze({
  // Conservative provider-agnostic planning target; deliberately no model-name lookup.
  contextWindowEstimateTokens: 16_000,
  reservedCompletionTokens: 2_000,
  reservedRepairTokens: 2_000
})

export class InvalidAnalysisBudgetPolicyError extends Error {
  constructor(message = "Analysis budget policy is invalid.") {
    super(message)
    this.name = "InvalidAnalysisBudgetPolicyError"
  }
}

export class AnalysisInputBudgetExceededError extends Error {
  constructor(message = "Analysis input exceeds the safe analysis input budget.") {
    super(message)
    this.name = "AnalysisInputBudgetExceededError"
  }
}

export class ReductionCannotProgressError extends Error {
  constructor(message = "Reduction budget is too small to make progress safely.") {
    super(message)
    this.name = "ReductionCannotProgressError"
  }
}

export function deriveAnalysisInputBudget(policy: AnalysisBudgetPolicy): number {
  validateAnalysisBudgetPolicy(policy)
  return policy.contextWindowEstimateTokens - policy.reservedCompletionTokens - policy.reservedRepairTokens
}

export function deriveRepairInputBudget(policy: AnalysisBudgetPolicy): number {
  validateAnalysisBudgetPolicy(policy)
  return policy.contextWindowEstimateTokens - policy.reservedCompletionTokens
}

export function validateAnalysisBudgetPolicy(policy: AnalysisBudgetPolicy): void {
  const values = [
    policy.contextWindowEstimateTokens,
    policy.reservedCompletionTokens,
    policy.reservedRepairTokens
  ]
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new InvalidAnalysisBudgetPolicyError("Analysis budget values must be finite positive numbers.")
  }
  if (policy.reservedCompletionTokens + policy.reservedRepairTokens >= policy.contextWindowEstimateTokens) {
    throw new InvalidAnalysisBudgetPolicyError("Analysis budget reserves leave no positive input budget.")
  }
}
