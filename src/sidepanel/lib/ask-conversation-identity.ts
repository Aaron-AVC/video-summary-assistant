import type { QaThreadEntity } from "@/lib/schemas/persistence"
import type { ResolvedProvider } from "@/features/settings/lib/settings-storage"

export type QaThreadIdentity = Pick<
  QaThreadEntity,
  "contentKey" | "analysisRunId" | "transcriptFingerprint"
>

export function matchesQaThreadIdentity(
  thread: QaThreadEntity | null,
  identity: QaThreadIdentity,
): thread is QaThreadEntity {
  return Boolean(
    thread
    && thread.contentKey === identity.contentKey
    && thread.analysisRunId === identity.analysisRunId
    && thread.transcriptFingerprint === identity.transcriptFingerprint,
  )
}

export function getFrozenQaProviderRequest(
  thread: QaThreadEntity,
  resolvedProvider: ResolvedProvider,
) {
  return {
    baseUrl: thread.providerBaseUrl,
    apiKey: resolvedProvider.apiKey,
    model: thread.providerModel,
    generationTimeoutSec: resolvedProvider.profile.generationTimeoutSec ?? 600,
  }
}
