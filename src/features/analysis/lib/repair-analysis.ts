import { parseVideoAnalysis, type VideoAnalysis } from "@/features/analysis/lib/analysis-schema"
import { normalizeVideoAnalysis, type VideoAnalysisNormalizationOptions } from "@/features/analysis/lib/normalize-video-analysis"
import { parseVideoAnalysisPayload } from "@/features/analysis/lib/parse-video-analysis"

/** Compatibility entry point retained for callers of the old module. */
export function repairAnalysisResult(
  input: unknown,
  options: VideoAnalysisNormalizationOptions
): VideoAnalysis {
  return normalizeVideoAnalysis(parseVideoAnalysisPayload(input), options)
}

export function validateAndNormalizeVideoAnalysis(
  input: unknown,
  options: VideoAnalysisNormalizationOptions
): VideoAnalysis {
  return normalizeVideoAnalysis(parseVideoAnalysis(input), options)
}
