import { isDatabaseUnavailableError } from "@/lib/db/errors"

export type WorkspaceBootstrapLoaders<TProvider, THistory, TPreset> = {
  loadProvider: () => Promise<TProvider>
  loadRecent: () => Promise<THistory>
  loadPreset: () => Promise<TPreset>
}

export type WorkspaceBootstrapResults<TProvider, THistory, TPreset> = {
  provider: PromiseSettledResult<TProvider>
  recent: PromiseSettledResult<THistory>
  preset: PromiseSettledResult<TPreset>
}

export type WorkspaceBootstrapEffects = {
  isRecentCurrent?: () => boolean
  onDatabaseFailure?: (error: unknown) => void
  onHistoryFailure?: (error: unknown) => void
}

export async function loadWorkspaceBranches<TProvider, THistory, TPreset>(
  loaders: WorkspaceBootstrapLoaders<TProvider, THistory, TPreset>,
  effects: WorkspaceBootstrapEffects = {},
): Promise<WorkspaceBootstrapResults<TProvider, THistory, TPreset>> {
  const recentLoad = Promise.resolve()
    .then(loaders.loadRecent)
    .catch((error: unknown) => {
      if (!effects.isRecentCurrent || effects.isRecentCurrent()) {
        if (isDatabaseUnavailableError(error)) effects.onDatabaseFailure?.(error)
        else effects.onHistoryFailure?.(error)
      }
      throw error
    })
  const [provider, recent, preset] = await Promise.allSettled([
    Promise.resolve().then(loaders.loadProvider),
    recentLoad,
    Promise.resolve().then(loaders.loadPreset),
  ])
  return { provider, recent, preset }
}
