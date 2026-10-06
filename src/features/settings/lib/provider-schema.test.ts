import { describe, expect, it } from "bun:test"

import {
  classifyProviderUrlSafety,
  isLoopbackProviderHost,
  parseProviderConfigInput,
  parseProviderConnectionInput
} from "@/features/settings/lib/provider-schema"

describe("provider schema", () => {
  it("normalizes whitespace and strips trailing slashes", () => {
    expect(
      parseProviderConfigInput({
        name: "  Local provider  ",
        baseUrl: " https://api.example.com/v1/ ",
        apiKey: "  sk-test-placeholder  ",
        model: "  gpt-4.1-mini  "
      })
    ).toEqual({
      name: "Local provider",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-placeholder",
      model: "gpt-4.1-mini"
    })
  })

  it("rejects invalid connection inputs", () => {
    expect(() =>
      parseProviderConnectionInput({
        baseUrl: "ftp://example.com",
        apiKey: "",
        model: ""
      })
    ).toThrow()
  })
})

describe("provider URL safety classifier", () => {
  it("treats https URLs as ok", () => {
    expect(classifyProviderUrlSafety("https://api.openai.com/v1")).toEqual({
      kind: "ok"
    })
  })

  it("treats loopback http URLs as ok so Ollama and LM Studio still work", () => {
    expect(classifyProviderUrlSafety("http://127.0.0.1:11434/v1").kind).toBe("ok")
    expect(classifyProviderUrlSafety("http://localhost:1234/v1").kind).toBe("ok")
    expect(classifyProviderUrlSafety("http://LOCALHOST:8080/v1").kind).toBe("ok")
  })

  it("flags http URLs aimed at non-loopback hosts as untrusted-http", () => {
    const result = classifyProviderUrlSafety("http://attacker.example/v1")
    expect(result).toEqual({ kind: "untrusted-http", host: "attacker.example" })
  })

  it("rejects unparseable or unsupported URLs", () => {
    expect(classifyProviderUrlSafety("").kind).toBe("invalid")
    expect(classifyProviderUrlSafety("not a url").kind).toBe("invalid")
    expect(classifyProviderUrlSafety("ftp://example.com").kind).toBe("invalid")
  })

  it("identifies loopback hosts case-insensitively", () => {
    expect(isLoopbackProviderHost("127.0.0.1")).toBe(true)
    expect(isLoopbackProviderHost("LocalHost")).toBe(true)
    expect(isLoopbackProviderHost("attacker.example")).toBe(false)
  })
})
