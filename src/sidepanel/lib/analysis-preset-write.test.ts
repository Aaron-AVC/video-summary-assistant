import { describe, expect, it } from "bun:test"

import type { AnalysisPresetId } from "@/features/analysis/lib/analysis-preset"
import {
  createAnalysisPresetWriter,
} from "@/sidepanel/lib/analysis-preset-write"

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function createDeferred<T = AnalysisPresetId>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

describe("analysis preset write coordination", () => {
  it("F. refuses a second write while the first request is still pending", async () => {
    const first = createDeferred()
    const persisted: AnalysisPresetId[] = []
    const writer = createAnalysisPresetWriter((presetId) => {
      persisted.push(presetId)
      return first.promise
    })

    const inFlight = writer.submit({ requestedPresetId: "concise", previousPresetId: "standard" })
    expect(writer.isPending()).toBe(true)

    const second = await writer.submit({
      requestedPresetId: "detailed",
      previousPresetId: "concise",
    })

    expect(second).toEqual({ kind: "ignored" })
    expect(persisted).toEqual(["concise"])

    first.resolve("concise")
    expect(await inFlight).toEqual({ kind: "saved", presetId: "concise" })
    expect(writer.isPending()).toBe(false)
  })

  it("G. restores the previous stable preset when persistence fails", async () => {
    const failure = new Error("settings write failed")
    const writer = createAnalysisPresetWriter(() => Promise.reject(failure))

    const result = await writer.submit({
      requestedPresetId: "detailed",
      previousPresetId: "standard",
    })

    expect(result).toEqual({ kind: "failed", presetId: "standard" })
    expect(writer.isPending()).toBe(false)
  })

  it("H. publishes the persisted preset so UI and storage agree", async () => {
    const persisted: AnalysisPresetId = "detailed"
    const writer = createAnalysisPresetWriter(() => Promise.resolve(persisted))

    const result = await writer.submit({
      requestedPresetId: "detailed",
      previousPresetId: "standard",
    })

    expect(result).toEqual({ kind: "saved", presetId: "detailed" })
    expect(writer.isPending()).toBe(false)
  })

  it("keeps the queued write available again once the first settles", async () => {
    const first = createDeferred()
    const calls: AnalysisPresetId[] = []
    const writer = createAnalysisPresetWriter((presetId) => {
      calls.push(presetId)
      return calls.length === 1 ? first.promise : Promise.resolve(presetId)
    })

    const inFlight = writer.submit({ requestedPresetId: "concise", previousPresetId: "standard" })
    expect(writer.isPending()).toBe(true)
    first.resolve("concise")
    await inFlight

    const next = await writer.submit({ requestedPresetId: "detailed", previousPresetId: "concise" })

    expect(next).toEqual({ kind: "saved", presetId: "detailed" })
    expect(calls).toEqual(["concise", "detailed"])
    expect(writer.isPending()).toBe(false)
  })

  it("does not persist an unchanged selection", async () => {
    const calls: AnalysisPresetId[] = []
    const writer = createAnalysisPresetWriter((presetId) => {
      calls.push(presetId)
      return Promise.resolve(presetId)
    })

    const result = await writer.submit({
      requestedPresetId: "standard",
      previousPresetId: "standard",
    })

    expect(result).toEqual({ kind: "unchanged", presetId: "standard" })
    expect(calls).toEqual([])
    expect(writer.isPending()).toBe(false)
  })
})
