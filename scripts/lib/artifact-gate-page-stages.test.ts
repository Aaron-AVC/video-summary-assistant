import { describe, expect, it } from "bun:test"

import { isNormalApplicationReady } from "./artifact-gate-readiness"
import { runArtifactGatePageStages } from "./artifact-gate-page-stages"

type ScenarioOptions = {
  afterOptionsStability?: () => void
  failFinalSidePanelRead?: boolean
}

function createScenario(options: ScenarioOptions = {}) {
  let databaseStatus: string | null = "available"
  let sidePanelReads = 0
  let stabilityWindows = 0
  let optionsMounted = false
  let sidePanelStopped = false
  let optionsStopped = false
  let finalReadSawSidePanelListener = false
  let finalReadSawOptionsListener = false
  const events: string[] = []

  const dependencies = {
    openSidePanel: async () => {
      events.push("sidepanel:open")
      return {
        waitForMount: async () => {
          events.push("sidepanel:mount")
        },
        readSnapshot: async () => {
          sidePanelReads += 1
          if (sidePanelReads === 1) {
            events.push("sidepanel:stable-read")
          } else {
            events.push("sidepanel:final-read")
            finalReadSawSidePanelListener = !sidePanelStopped
            finalReadSawOptionsListener = !optionsStopped
            if (!optionsMounted) throw new Error("Final Side Panel read ran before Options mounted.")
            if (options.failFinalSidePanelRead) throw new Error("Final CDP state read failed.")
          }
          return {
            readyState: "complete",
            rootChildCount: 1,
            bodyChildCount: 1,
            databaseStatus,
          }
        },
        stop: () => {
          sidePanelStopped = true
          events.push("sidepanel:stop")
        },
      }
    },
    openOptions: async () => {
      events.push("options:open")
      return {
        waitForMount: async () => {
          optionsMounted = true
          events.push("options:mount")
        },
        stop: () => {
          optionsStopped = true
          events.push("options:stop")
        },
      }
    },
    stabilityWindow: async () => {
      stabilityWindows += 1
      events.push(`stability:${stabilityWindows}`)
      if (stabilityWindows === 2) options.afterOptionsStability?.()
    },
    hasFatal: () => false,
    failOnFatal: (stage: "sidePanel" | "options") => {
      throw new Error(`Fatal runtime exception in ${stage}.`)
    },
    isReady: isNormalApplicationReady,
    failOnSidePanelNotReady: (snapshot: { databaseStatus: unknown }) => {
      throw new Error(`Side Panel failed its stability check: ${String(snapshot.databaseStatus)}`)
    },
    failOnFinalSidePanelNotReady: (snapshot: { databaseStatus: unknown }) => {
      throw new Error(`Side Panel failed its final readiness check: ${String(snapshot.databaseStatus)}`)
    },
    onSidePanelPassed: () => {
      events.push("sidepanel:pass")
    },
    onOptionsPassed: () => {
      events.push("options:pass")
    },
  }

  return {
    dependencies,
    events,
    setDatabaseStatus(status: string | null) {
      databaseStatus = status
    },
    get databaseStatus() {
      return databaseStatus
    },
    get sidePanelReads() {
      return sidePanelReads
    },
    get sidePanelStopped() {
      return sidePanelStopped
    },
    get optionsStopped() {
      return optionsStopped
    },
    get finalReadSawSidePanelListener() {
      return finalReadSawSidePanelListener
    },
    get finalReadSawOptionsListener() {
      return finalReadSawOptionsListener
    },
  }
}

describe("artifact Gate page stages", () => {
  it("fails if Side Panel loses database readiness during Options acceptance", async () => {
    const scenario = createScenario({
      afterOptionsStability: () => {
        scenario.setDatabaseStatus("unavailable")
      },
    })

    await expect(runArtifactGatePageStages(scenario.dependencies))
      .rejects.toThrow("Side Panel failed its final readiness check: unavailable")

    expect(scenario.sidePanelReads).toBe(2)
    expect(scenario.events.indexOf("options:pass")).toBeLessThan(
      scenario.events.indexOf("sidepanel:final-read"),
    )
    expect(scenario.sidePanelStopped).toBe(true)
    expect(scenario.optionsStopped).toBe(true)
  })

  it("passes only after both pages pass and the final Side Panel state is available", async () => {
    const scenario = createScenario()

    await expect(runArtifactGatePageStages(scenario.dependencies)).resolves.toBeUndefined()

    expect(scenario.databaseStatus).toBe("available")
    expect(scenario.sidePanelReads).toBe(2)
    expect(scenario.finalReadSawSidePanelListener).toBe(true)
    expect(scenario.finalReadSawOptionsListener).toBe(false)
    expect(scenario.sidePanelStopped).toBe(true)
    expect(scenario.optionsStopped).toBe(true)
    expect(scenario.events.indexOf("options:pass")).toBeLessThan(
      scenario.events.indexOf("sidepanel:final-read"),
    )
  })

  it("fails if the final Side Panel database state cannot be read", async () => {
    const scenario = createScenario({ failFinalSidePanelRead: true })

    await expect(runArtifactGatePageStages(scenario.dependencies))
      .rejects.toThrow("Final CDP state read failed.")

    expect(scenario.sidePanelReads).toBe(2)
    expect(scenario.sidePanelStopped).toBe(true)
    expect(scenario.optionsStopped).toBe(true)
  })
})
