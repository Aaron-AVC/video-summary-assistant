import { describe, expect, it } from "bun:test"

import {
  classifyProviderUrlSafety,
  isLoopbackProviderHost,
  parseProviderConfigInput,
  parseProviderProfileInput,
  parseProviderConnectionInput,
  parseProviderModelDiscoveryInput
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
      model: "gpt-4.1-mini",
      generationTimeoutSec: 600
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

  it("accepts model discovery input without a model", () => {
    expect(parseProviderModelDiscoveryInput({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-discovery-placeholder",
    })).toEqual({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-discovery-placeholder",
    })
  })

  it("defaults and validates generation timeout presets", () => {
    expect(parseProviderProfileInput({
      name: "Provider",
      baseUrl: "https://api.example.com/v1",
      model: "model",
    }).generationTimeoutSec).toBe(600)
    for (const seconds of [60, 180, 300, 600, 1200, 1800]) {
      expect(parseProviderProfileInput({
        name: "Provider",
        baseUrl: "https://api.example.com/v1",
        model: "model",
        generationTimeoutSec: seconds,
      }).generationTimeoutSec).toBe(seconds)
    }
    expect(() => parseProviderProfileInput({
      name: "Provider", baseUrl: "https://api.example.com/v1", model: "model", generationTimeoutSec: 59,
    })).toThrow()
    expect(() => parseProviderProfileInput({
      name: "Provider", baseUrl: "https://api.example.com/v1", model: "model", generationTimeoutSec: 1801,
    })).toThrow()
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
    expect(classifyProviderUrlSafety("http://[::1]:8000/v1").kind).toBe("ok")
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

  it("rejects credentials, query strings, fragments, and non-loopback http in saved profiles", () => {
    for (const baseUrl of [
      "http://example.com/v1",
      "https://user:pass@example.com/v1",
      "https://api.example.com/v1?tenant=1",
      "https://api.example.com/v1#fragment",
      "ftp://api.example.com/v1",
      "file:///tmp/provider",
      "data:text/plain,provider",
      "javascript:alert(1)",
    ]) {
      expect(() => parseProviderProfileInput({ name: "Provider", baseUrl, model: "model" })).toThrow()
    }
  })

  it("accepts arbitrary https prefixes and loopback http prefixes without adding /v1", () => {
    expect(parseProviderProfileInput({
      name: "Relay",
      baseUrl: " https://relay.example.com/openai/v1/ ",
      model: "model",
    }).baseUrl).toBe("https://relay.example.com/openai/v1")
    expect(parseProviderProfileInput({
      name: "Local",
      baseUrl: "http://127.0.0.1:8000/v1/",
      model: "model",
    }).baseUrl).toBe("http://127.0.0.1:8000/v1")
  })

  it("identifies loopback hosts case-insensitively", () => {
    expect(isLoopbackProviderHost("127.0.0.1")).toBe(true)
    expect(isLoopbackProviderHost("LocalHost")).toBe(true)
    expect(isLoopbackProviderHost("attacker.example")).toBe(false)
  })
})
