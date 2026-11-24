/**
 * Structured errors raised at IndexedDB write boundaries so UI consumers can
 * distinguish "the user's quota is full" from generic write failures and show
 * actionable messaging instead of a generic toast.
 */

export type PersistenceErrorReason = "quota_exceeded" | "write_failed"

const DATABASE_UNAVAILABLE_NAMES = new Set([
  "DatabaseClosedError",
  "DatabaseOpenError",
  "OpenFailedError",
  "UnknownError",
  "InvalidStateError",
  "NoSuchDatabaseError",
  "MissingAPIError",
  "VersionError",
])

/** Identify IndexedDB/Dexie availability failures, including nested wrappers. */
export function isDatabaseUnavailableError(error: unknown): boolean {
  const seen = new Set<object>()
  const visit = (candidate: unknown): boolean => {
    if (typeof candidate !== "object" || candidate === null || seen.has(candidate)) return false
    seen.add(candidate)
    const record = candidate as { name?: unknown; inner?: unknown; cause?: unknown }
    if (typeof record.name === "string" && DATABASE_UNAVAILABLE_NAMES.has(record.name)) return true
    return visit(record.inner) || visit(record.cause)
  }
  return visit(error)
}

export class PersistenceError extends Error {
  readonly reason: PersistenceErrorReason
  readonly cause: unknown

  constructor(reason: PersistenceErrorReason, message: string, cause?: unknown) {
    super(message)
    this.name = "PersistenceError"
    this.reason = reason
    this.cause = cause
  }
}

export function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false
  }
  const candidate = error as { name?: unknown; code?: unknown; inner?: unknown; cause?: unknown }
  if (candidate.name === "QuotaExceededError") {
    return true
  }
  // Dexie often wraps the underlying DOMException; check nested inner/cause.
  if (typeof candidate.code === "number" && candidate.code === 22) {
    // legacy DOMException QUOTA_EXCEEDED_ERR
    return true
  }
  if (candidate.inner && isQuotaExceededError(candidate.inner)) {
    return true
  }
  if (candidate.cause && candidate.cause !== error && isQuotaExceededError(candidate.cause)) {
    return true
  }
  return false
}

/**
 * Wraps a write call so consumers receive a `PersistenceError` whose `reason`
 * encodes whether the failure was a quota issue. Re-throws all other errors as
 * `PersistenceError` with `reason: "write_failed"` so callers always see the
 * same surface type at this boundary.
 */
export async function runWriteWithQuotaGuard<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (isQuotaExceededError(error)) {
      throw new PersistenceError(
        "quota_exceeded",
        "Local storage is full. Clear history or export your data to free space.",
        error
      )
    }
    if (error instanceof PersistenceError) {
      throw error
    }
    throw new PersistenceError(
      "write_failed",
      error instanceof Error ? error.message : "Failed to write to local database.",
      error
    )
  }
}
