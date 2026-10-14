import { canonicalJson, sha256Hex } from "@/lib/persistence/cache-identity"

export const MAX_QA_CONTEXT_MESSAGES = 6
export const MAX_QA_CONTEXT_CHARS = 12000

export type QaConversationContextMessage = {
  role: "user" | "assistant"
  content: string
}

export function boundQaConversationContext(
  messages: QaConversationContextMessage[],
  maxMessages = MAX_QA_CONTEXT_MESSAGES,
  maxChars = MAX_QA_CONTEXT_CHARS,
) {
  const recent = messages
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({ role: message.role, content: message.content.trim() }))
    .slice(-maxMessages)

  let start = 0
  let total = recent.reduce((sum, message) => sum + message.content.length, 0)
  while (start < recent.length && total > maxChars) {
    total -= recent[start].content.length
    start += 1
  }
  return recent.slice(start)
}

export async function computeConversationContextFingerprint(
  messages: QaConversationContextMessage[],
) {
  const bounded = boundQaConversationContext(messages)
  if (bounded.length === 0) return null
  return sha256Hex(canonicalJson({ version: 1, messages: bounded }))
}

export function formatQaConversationContext(messages: QaConversationContextMessage[]) {
  const bounded = boundQaConversationContext(messages)
  if (bounded.length === 0) return "No previous conversation history."
  return bounded.map((message, index) => (
    `${index + 1}. ${message.role === "user" ? "User" : "Assistant"}: ${message.content}`
  )).join("\n")
}
