import { describe, expect, it } from "bun:test"

import { handleHistoryCardKeyDown } from "@/features/history/components/recent-analysis-list"

function createKeyEvent(key: string, target: object, currentTarget: object) {
  let prevented = false
  return {
    event: {
      key,
      target,
      currentTarget,
      preventDefault: () => { prevented = true }
    },
    wasPrevented: () => prevented
  }
}

describe("RecentAnalysisList keyboard activation", () => {
  it("opens the card exactly once for Enter", () => {
    const card = {}
    const { event, wasPrevented } = createKeyEvent("Enter", card, card)
    let selected = 0

    expect(handleHistoryCardKeyDown(event as never, () => { selected += 1 })).toBe(true)
    expect(selected).toBe(1)
    expect(wasPrevented()).toBe(true)
  })

  it("does not open the card when More actions receives Enter", () => {
    const card = {}
    const summary = {}
    const { event, wasPrevented } = createKeyEvent("Enter", summary, card)
    let selected = 0

    expect(handleHistoryCardKeyDown(event as never, () => { selected += 1 })).toBe(false)
    expect(selected).toBe(0)
    expect(wasPrevented()).toBe(false)
  })

  it("does not open the card when Delete receives Enter", () => {
    const card = {}
    const deleteButton = {}
    const { event, wasPrevented } = createKeyEvent("Enter", deleteButton, card)
    let selected = 0

    expect(handleHistoryCardKeyDown(event as never, () => { selected += 1 })).toBe(false)
    expect(selected).toBe(0)
    expect(wasPrevented()).toBe(false)
  })
})
