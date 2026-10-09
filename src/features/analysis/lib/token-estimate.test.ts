import { describe, expect, it } from "bun:test"

import {
  estimateChatPromptTokens,
  estimateTextTokens
} from "@/features/analysis/lib/token-estimate"

describe("analysis token estimator", () => {
  it("is deterministic and monotonic for empty and ASCII text", () => {
    expect(estimateTextTokens("")).toBe(0)
    const short = estimateTextTokens("hello")
    const long = estimateTextTokens("hello world, this is longer")
    expect(short).toBeGreaterThan(0)
    expect(long).toBeGreaterThanOrEqual(short)
    expect(estimateTextTokens("hello")).toBe(short)
  })

  it("does not estimate CJK as English characters divided by four", () => {
    const cjk = "这是一个中文测试"
    expect(estimateTextTokens(cjk)).toBeGreaterThanOrEqual(Array.from(cjk).length)
    expect(estimateTextTokens(cjk)).toBeGreaterThan(estimateTextTokens("abcdefgh"))
  })

  it("includes deterministic chat and per-message overhead", () => {
    const contentOnly = estimateTextTokens("systemuser")
    const estimate = estimateChatPromptTokens([
      { role: "system", content: "system" },
      { role: "user", content: "user" }
    ])
    expect(estimate).toBeGreaterThan(contentOnly)
    expect(estimateChatPromptTokens([
      { role: "system", content: "system" },
      { role: "user", content: "user" }
    ])).toBe(estimate)
  })
})
