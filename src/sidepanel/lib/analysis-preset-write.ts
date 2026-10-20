import type { AnalysisPresetId } from "@/features/analysis/lib/analysis-preset"

/**
 * Single-flight coordination for the global analysis preset write.
 *
 * The selector is a global default: only one persistence request may be in
 * flight at a time, so a slow earlier save (or its failure rollback) can never
 * publish over a newer user selection. This helper owns the admission decision
 * and the rollback value; the workspace owns React state and the failure toast.
 */
export type AnalysisPresetPersist = (presetId: AnalysisPresetId) => Promise<AnalysisPresetId>

export type AnalysisPresetWriteRequest = {
  requestedPresetId: AnalysisPresetId
  previousPresetId: AnalysisPresetId
}

export type AnalysisPresetWriteResult =
  | { kind: "ignored" }
  | { kind: "unchanged"; presetId: AnalysisPresetId }
  | { kind: "saved"; presetId: AnalysisPresetId }
  | { kind: "failed"; presetId: AnalysisPresetId }

export type AnalysisPresetWriter = {
  isPending: () => boolean
  submit: (request: AnalysisPresetWriteRequest) => Promise<AnalysisPresetWriteResult>
}

export function createAnalysisPresetWriter(persist: AnalysisPresetPersist): AnalysisPresetWriter {
  let pending = false

  return {
    isPending: () => pending,

    async submit({ requestedPresetId, previousPresetId }) {
      if (pending) return { kind: "ignored" }
      if (requestedPresetId === previousPresetId) {
        return { kind: "unchanged", presetId: previousPresetId }
      }

      pending = true
      try {
        const persistedPresetId = await persist(requestedPresetId)
        return { kind: "saved", presetId: persistedPresetId }
      } catch {
        return { kind: "failed", presetId: previousPresetId }
      } finally {
        pending = false
      }
    },
  }
}
