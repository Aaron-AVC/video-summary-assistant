/**
 * Bounded JSON body reader for provider HTTP responses.
 *
 * `Response.json()` buffers the entire body before it can be inspected, so a
 * hostile or misconfigured provider endpoint can hand the extension an
 * arbitrarily large payload and force the side panel to allocate it. This helper
 * enforces a byte ceiling while the body is still streaming.
 *
 * Behaviour:
 * 1. A declared `Content-Length` above the ceiling is rejected before any body
 *    byte is read.
 * 2. Otherwise the body is read incrementally; the moment the running total
 *    crosses the ceiling the stream is cancelled and the read aborts, so the
 *    remainder is never buffered.
 * 3. Only a body that fits is concatenated and decoded, then parsed as JSON.
 *
 * It deliberately does not change timeout, abort, or redaction semantics: the
 * caller's `AbortSignal` still governs `reader.read()`, and every error this
 * helper throws is a plain message with no request headers in it, so existing
 * `redactProviderError` paths keep working unchanged.
 */

/**
 * Upper bound for a single provider HTTP response body.
 *
 * Real chat-completion and model-list payloads are tens to hundreds of
 * kilobytes. 8 MiB is roughly two orders of magnitude above the largest
 * plausible legitimate response while remaining small enough that a hostile
 * payload is rejected long before it can pressure the renderer's heap.
 */
export const DEFAULT_PROVIDER_RESPONSE_MAX_BYTES = 8 * 1024 * 1024

export class ProviderResponseTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Provider response exceeded the ${maxBytes} byte limit.`)
    this.name = "ProviderResponseTooLargeError"
  }
}

function assertWithinLimit(declaredBytes: number, maxBytes: number): void {
  if (declaredBytes > maxBytes) {
    throw new ProviderResponseTooLargeError(maxBytes)
  }
}

/**
 * Reads a response body as JSON without ever buffering more than `maxBytes`.
 *
 * Throws `ProviderResponseTooLargeError` when the ceiling is exceeded and the
 * underlying `SyntaxError` when the payload is not valid JSON.
 */
export async function readJsonBodyWithLimit(
  response: Response,
  maxBytes: number = DEFAULT_PROVIDER_RESPONSE_MAX_BYTES
): Promise<unknown> {
  const declared = response.headers.get("content-length")
  if (declared !== null) {
    const declaredBytes = Number(declared)
    // A non-numeric Content-Length is malformed; fall through to the streaming
    // guard rather than trusting it.
    if (Number.isFinite(declaredBytes) && declaredBytes >= 0) {
      if (declaredBytes > maxBytes) {
        // Rejecting before the first byte is read must still release the
        // response body: an abandoned stream keeps the underlying connection
        // held until the runtime garbage collects it. Cancelling is best
        // effort so the size error stays the error the caller sees.
        if (response.body) {
          // Do not await: cancel() can stay pending on a stuck transport, and
          // the size error must reach the caller immediately. The rejection is
          // still handled so no unhandled rejection escapes.
          void response.body.cancel().catch(() => undefined)
        }
      }
      assertWithinLimit(declaredBytes, maxBytes)
    }
  }

  if (!response.body) {
    return response.json()
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.byteLength === 0) continue
      total += value.byteLength
      if (total > maxBytes) {
        // Cancel before the rest of the body can be pulled into memory, but
        // never await it: a cancel that stays pending must not delay the size
        // error or hold the reader lock. The rejection is handled so no
        // unhandled rejection escapes.
        void reader.cancel().catch(() => undefined)
        throw new ProviderResponseTooLargeError(maxBytes)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}
