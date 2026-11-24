import {
  runStableSidePanelReadinessGate,
  type SidePanelReadinessSnapshot,
} from "./artifact-gate-readiness"

export type ArtifactGatePage = {
  waitForMount: () => Promise<void>
  stop: () => void
}

export type ArtifactGateSidePanelPage = ArtifactGatePage & {
  readSnapshot: () => Promise<SidePanelReadinessSnapshot>
}

export type ArtifactGatePageStagesDependencies = {
  openSidePanel: () => Promise<ArtifactGateSidePanelPage>
  openOptions: () => Promise<ArtifactGatePage>
  stabilityWindow: () => Promise<void>
  hasFatal: () => boolean
  failOnFatal: (stage: "sidePanel" | "options") => never
  isReady: (snapshot: SidePanelReadinessSnapshot) => boolean
  failOnSidePanelNotReady: (snapshot: SidePanelReadinessSnapshot) => never
  failOnFinalSidePanelNotReady: (snapshot: SidePanelReadinessSnapshot) => never
  onSidePanelPassed: () => void
  onOptionsPassed: () => void
}

export async function runArtifactGatePageStages(
  dependencies: ArtifactGatePageStagesDependencies,
): Promise<void> {
  let sidePanel: ArtifactGateSidePanelPage | null = null

  try {
    const sidePanelPage = await dependencies.openSidePanel()
    sidePanel = sidePanelPage
    await runStableSidePanelReadinessGate({
      waitForMount: sidePanelPage.waitForMount,
      stabilityWindow: dependencies.stabilityWindow,
      hasFatal: dependencies.hasFatal,
      failOnFatal: () => dependencies.failOnFatal("sidePanel"),
      readSnapshot: sidePanelPage.readSnapshot,
      isReady: dependencies.isReady,
      failOnNotReady: dependencies.failOnSidePanelNotReady,
    })
    if (dependencies.hasFatal()) dependencies.failOnFatal("sidePanel")
    dependencies.onSidePanelPassed()

    const options = await dependencies.openOptions()
    try {
      await options.waitForMount()
      await dependencies.stabilityWindow()
      if (dependencies.hasFatal()) dependencies.failOnFatal("options")
      dependencies.onOptionsPassed()
    } finally {
      options.stop()
    }

    if (dependencies.hasFatal()) dependencies.failOnFatal("sidePanel")
    const finalSnapshot = await sidePanelPage.readSnapshot()
    if (!dependencies.isReady(finalSnapshot)) {
      dependencies.failOnFinalSidePanelNotReady(finalSnapshot)
    }
    if (dependencies.hasFatal()) dependencies.failOnFatal("sidePanel")
  } finally {
    sidePanel?.stop()
  }
}
