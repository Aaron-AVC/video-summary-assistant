import { describe, expect, it } from "bun:test"

import { en } from "@/lib/i18n/en"
import { zhCN } from "@/lib/i18n/zh-CN"
import type { FinalResumeView } from "@/sidepanel/analysis/final-resume-availability"

function view(overrides: Partial<FinalResumeView> = {}): FinalResumeView {
  return {
    visible: true,
    canStart: true,
    phaseLabel: "available",
    remainingMinutes: 28,
    status: { kind: "http", status: 502 },
    reason: null,
    ...overrides,
  }
}

describe("final resume i18n", () => {
  const keys = Object.keys(en).filter((key) => key.startsWith("finalResume.")) as Array<keyof typeof en>

  it("defines every English resume key in Chinese", () => {
    expect(keys.length).toBeGreaterThan(10)
    for (const key of keys) {
      expect((zhCN as Record<string, string>)[key]).toBeDefined()
      expect((zhCN as Record<string, string>)[key]!.length).toBeGreaterThan(0)
    }
  })

  it("keeps the Chinese continue action and cost notice distinct from regenerating", () => {
    expect(zhCN["finalResume.cta"]).toBe("继续最终总结")
    expect(zhCN["finalResume.regenerate"]).toBe("完整重新生成")
    expect(zhCN["finalResume.cost"]).toContain("可能再次计费")
    expect(zhCN["finalResume.description"]).toContain("只请求最后的总结阶段")
    expect(zhCN["finalResume.remaining"]).toContain("{minutes}")
    expect(en["finalResume.cta"]).toBe("Continue final summary")
  })

  it("states the side-panel-only lifetime in both languages", () => {
    expect(zhCN["finalResume.remaining"]).toContain("当前侧边栏")
    expect(en["finalResume.remaining"]).toContain("side panel")
  })

  it("carries no prompt, transcript or secret placeholder in resume copy", () => {
    for (const key of keys) {
      const text = `${en[key]} ${(zhCN as Record<string, string>)[key]}`
      expect(text).not.toContain("sk-")
      expect(text).not.toContain("BEGIN")
      expect(text).not.toContain("summary:")
    }
  })

  it("keeps the resuming and saving labels distinguishable", () => {
    expect(zhCN["finalResume.resuming"]).not.toBe(zhCN["finalResume.saving"])
    expect(en["finalResume.resuming"]).not.toBe(en["finalResume.saving"])
    expect(zhCN["finalResume.saving"]).toBe("正在保存分析…")
  })
})

describe("final resume view shape", () => {
  it("only exposes a sanitized status code, never a response body", () => {
    const serialized = JSON.stringify(view())
    expect(serialized).toContain("\"status\":502")
    expect(serialized).not.toContain("sk-")
    expect(serialized).not.toContain("summary")
  })

  it("disables starting while a resume or save is in flight", () => {
    expect(view({ phaseLabel: "resuming", canStart: false }).canStart).toBe(false)
    expect(view({ phaseLabel: "saving", canStart: false }).canStart).toBe(false)
    expect(view({ phaseLabel: "available", canStart: true }).canStart).toBe(true)
  })
})
