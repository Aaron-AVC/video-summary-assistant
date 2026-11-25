export type DatabaseAvailabilityStatus =
  | "initializing"
  | "available"
  | "unavailable"
  | "retrying"

export type DatabaseAvailabilitySnapshot = {
  status: DatabaseAvailabilityStatus
  errorMessage: string | null
}

export type DatabaseAvailabilityControllerDependencies = {
  probe: () => Promise<void>
}

function errorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message.slice(0, 240)
  if (typeof error === "string") return error.slice(0, 240)
  return error === undefined ? null : "Database readiness check failed."
}

export class DatabaseAvailabilityController {
  private snapshot: DatabaseAvailabilitySnapshot = {
    status: "initializing",
    errorMessage: null,
  }
  private readonly listeners = new Set<(snapshot: DatabaseAvailabilitySnapshot) => void>()
  private inFlight: Promise<DatabaseAvailabilityStatus> | null = null
  private generation = 0
  private didInitialize = false

  constructor(private readonly dependencies: DatabaseAvailabilityControllerDependencies) {}

  getSnapshot(): DatabaseAvailabilitySnapshot {
    return this.snapshot
  }

  captureFailureGeneration(): number {
    return this.generation
  }

  subscribe(listener: (snapshot: DatabaseAvailabilitySnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  initialize(): Promise<DatabaseAvailabilityStatus> {
    if (this.inFlight) return this.inFlight
    if (this.didInitialize) return Promise.resolve(this.snapshot.status)
    this.didInitialize = true
    return this.startProbe("initializing")
  }

  retry(): Promise<DatabaseAvailabilityStatus> {
    if (this.inFlight) return this.inFlight
    this.didInitialize = true
    return this.startProbe("retrying")
  }

  markUnavailable(error: unknown, failureGeneration: number): boolean {
    if (failureGeneration !== this.generation) return false
    this.generation += 1
    this.inFlight = null
    this.publish({ status: "unavailable", errorMessage: errorMessage(error) })
    return true
  }

  private startProbe(status: "initializing" | "retrying"): Promise<DatabaseAvailabilityStatus> {
    const generation = ++this.generation
    this.publish({ status, errorMessage: null })
    const pending = Promise.resolve()
      .then(() => this.dependencies.probe())
      .then(() => {
        if (generation !== this.generation) return this.snapshot.status
        this.publish({ status: "available", errorMessage: null })
        return "available" as const
      })
      .catch((error: unknown) => {
        if (generation !== this.generation) return this.snapshot.status
        this.publish({ status: "unavailable", errorMessage: errorMessage(error) })
        return "unavailable" as const
      })
      .finally(() => {
        if (generation === this.generation) this.inFlight = null
      })
    this.inFlight = pending
    return pending
  }

  private publish(snapshot: DatabaseAvailabilitySnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch {
        // A view subscriber cannot change the underlying database state.
      }
    }
  }
}
