/**
 * Provider-agnostic, deterministic token heuristic.
 * This is intentionally not an exact tokenizer count: it is a conservative
 * guard against obviously oversized prompts for arbitrary OpenAI-compatible
 * relays.
 */
const ASCII_CHARS_PER_TOKEN = 4
const SAFETY_MULTIPLIER = 1.25
const MESSAGE_OVERHEAD_TOKENS = 8
const CHAT_OVERHEAD_TOKENS = 2

export type EstimatedChatMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

export function estimateTextTokens(text: string): number {
  if (text.length === 0) return 0
  let asciiUnits = 0
  let nonAsciiUnits = 0
  for (const character of text) {
    if (character.codePointAt(0)! <= 0x7f) asciiUnits += 1
    else nonAsciiUnits += 1
  }
  return Math.ceil((asciiUnits / ASCII_CHARS_PER_TOKEN + nonAsciiUnits) * SAFETY_MULTIPLIER)
}

export function estimateChatPromptTokens(messages: EstimatedChatMessage[]): number {
  const contentTokens = messages.reduce(
    (total, message) => total + estimateTextTokens(message.content) + MESSAGE_OVERHEAD_TOKENS,
    0
  )
  return Math.ceil((contentTokens + CHAT_OVERHEAD_TOKENS) * SAFETY_MULTIPLIER)
}
