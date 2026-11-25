export type SmokeConditionClock = {
  now: () => number
  sleep: (milliseconds: number) => Promise<void>
}

export type SmokeConditionWaitOptions = {
  timeoutMs: number
  intervalMs?: number
  clock?: SmokeConditionClock
}

const systemClock: SmokeConditionClock = {
  now: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}

export async function waitForSmokeCondition<T>(
  read: () => Promise<T>,
  isReady: (value: T) => boolean,
  label: string,
  options: SmokeConditionWaitOptions,
): Promise<T> {
  const intervalMs = options.intervalMs ?? 100
  const clock = options.clock ?? systemClock
  const deadline = clock.now() + options.timeoutMs

  while (true) {
    const value = await read()
    if (isReady(value)) return value

    const remainingMs = deadline - clock.now()
    if (remainingMs <= 0) {
      throw new Error(`timed out waiting for ${label}`)
    }
    await clock.sleep(Math.min(intervalMs, remainingMs))
  }
}

export async function actWhenSmokeReady<T, R>(
  read: () => Promise<T>,
  isReady: (value: T) => boolean,
  action: (value: T) => Promise<R>,
  label: string,
  options: SmokeConditionWaitOptions,
): Promise<{ observation: T; result: R }> {
  const observation = await waitForSmokeCondition(read, isReady, label, options)
  const result = await action(observation)
  return { observation, result }
}

export async function waitForSmokeOutcome<T>(
  read: () => Promise<T>,
  isComplete: (value: T) => boolean,
  isExpected: (value: T) => boolean,
  label: string,
  describeOutcome: (value: T) => string,
  options: SmokeConditionWaitOptions,
): Promise<T> {
  const outcome = await waitForSmokeCondition(read, isComplete, `${label} feedback`, options)
  if (!isExpected(outcome)) {
    throw new Error(`${label} returned an unexpected outcome: ${describeOutcome(outcome)}`)
  }
  return outcome
}
