import type Dexie from "dexie"

import { db } from "@/lib/db"

export type DatabaseReadinessState = "initializing" | "available" | "unavailable" | "retrying"
export const DATABASE_READINESS_TIMEOUT_MS = 25_000

export function isDatabaseReady(status: unknown): status is "available" {
  return status === "available"
}

/** Open the existing database and perform a read-only request against its schema. */
export async function verifyDatabaseReady(database: Dexie = db): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      database.open().then(() => database.table("recentVideos").count()),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`Database readiness check timed out after ${DATABASE_READINESS_TIMEOUT_MS}ms.`)),
          DATABASE_READINESS_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
  }
}
