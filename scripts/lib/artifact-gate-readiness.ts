export type SidePanelReadinessSnapshot = {
  readyState: string
  rootChildCount: number
  bodyChildCount: number
  databaseStatus: unknown
}

export type StableSidePanelReadinessDependencies = {
  waitForMount: () => Promise<void>
  stabilityWindow: () => Promise<void>
  hasFatal: () => boolean
  failOnFatal: () => never
  readSnapshot: () => Promise<SidePanelReadinessSnapshot>
  isReady: (snapshot: SidePanelReadinessSnapshot) => boolean
  failOnNotReady: (snapshot: SidePanelReadinessSnapshot) => never
}

export function isNormalApplicationReady(
  snapshot: SidePanelReadinessSnapshot,
): boolean {
  const mounted = (
    (snapshot.readyState === "complete" || snapshot.readyState === "interactive")
    && snapshot.rootChildCount > 0
    && snapshot.bodyChildCount > 0
  )
  return mounted && snapshot.databaseStatus === "available"
}

export async function runStableSidePanelReadinessGate(
  dependencies: StableSidePanelReadinessDependencies,
): Promise<void> {
  await dependencies.waitForMount()
  await dependencies.stabilityWindow()
  if (dependencies.hasFatal()) dependencies.failOnFatal()
  const snapshot = await dependencies.readSnapshot()
  if (!dependencies.isReady(snapshot)) dependencies.failOnNotReady(snapshot)
}
