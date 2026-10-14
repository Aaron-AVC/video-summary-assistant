import { describe, expect, it } from "bun:test"

import {
  boundQaConversationContext,
  computeConversationContextFingerprint,
  formatQaConversationContext
} from "@/features/analysis/lib/qa-conversation-context"

describe("Ask Video conversation context", () => {
  it("keeps only the bounded recent messages and drops oldest text first", () => {
    const messages = Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `message-${index}`
    }))
    expect(boundQaConversationContext(messages, 6)).toEqual(messages.slice(2))
    expect(formatQaConversationContext(messages.slice(2, 4))).toContain("User: message-2")
  })

  it("changes the fingerprint when conversation context changes", async () => {
    const first = await computeConversationContextFingerprint([{ role: "user", content: "Why?" }])
    const second = await computeConversationContextFingerprint([{ role: "user", content: "What?" }])
    const empty = await computeConversationContextFingerprint([])
    expect(first).not.toBe(second)
    expect(empty).toBeNull()
  })
})
