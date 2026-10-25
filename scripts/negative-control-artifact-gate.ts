/**
 * Negative control for the artifact runtime gate.
 *
 * Copies the fresh production artifact to a throwaway directory, injects a
 * deterministic module-evaluation failure into the Side Panel bundle, then runs
 * the verifier against the copy. The gate MUST fail and MUST surface the
 * injected marker. The real artifact is never modified.
 *
 * Every failure path runs inside `withControlDir`, so the throwaway copy is
 * removed by a `finally` no matter how the run ends. No helper calls
 * `process.exit()`: failures propagate as `NegativeControlError` and only `main`
 * decides the exit code.
 *
 * Usage: bun scripts/negative-control-artifact-gate.ts
 */

import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

export const MARKER = "RG01_NEGATIVE_CONTROL"
export const WORKSPACE_ROOT = resolve(import.meta.dir, "..")
export const SOURCE_ARTIFACT = join(WORKSPACE_ROOT, "build", "chrome-mv3-prod")
export const CONTROL_DIR = join(WORKSPACE_ROOT, ".buntmp", "rg01-negative-extension")

/** Raised for every expected failure so cleanup runs and `main` owns the exit code. */
export class NegativeControlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NegativeControlError"
  }
}

export type ControlDirOptions = {
  sourceDir?: string
  controlDir?: string
}

/**
 * Copy the production artifact to the throwaway directory and remove it again
 * whatever the body does.
 *
 * A throw in `body` (missing Chrome, spawn crash, unexpected verdict, even an
 * unrelated exception) still hits the `finally`, so `.buntmp/rg01-negative-extension`
 * can never be left behind.
 */
export function withControlDir<T>(
  body: (controlDir: string) => T,
  options: ControlDirOptions = {},
): T {
  const sourceDir = options.sourceDir ?? SOURCE_ARTIFACT
  const controlDir = options.controlDir ?? CONTROL_DIR

  if (!existsSync(sourceDir)) {
    throw new NegativeControlError(`missing ${sourceDir}; run \`bun run build\` first`)
  }

  rmSync(controlDir, { recursive: true, force: true })
  cpSync(sourceDir, controlDir, { recursive: true })
  try {
    return body(controlDir)
  } finally {
    rmSync(controlDir, { recursive: true, force: true })
  }
}

/** Prepend a deterministic module-evaluation failure to the Side Panel bundle. */
export function injectSidePanelFailure(controlDir: string): string {
  const htmlPath = join(controlDir, "sidepanel.html")
  if (!existsSync(htmlPath)) {
    throw new NegativeControlError(`missing ${htmlPath}`)
  }

  // Find the bundle the way the browser does: from the built HTML.
  const scriptMatch = readFileSync(htmlPath, "utf8").match(/<script[^>]+src="([^"]+)"/)
  if (!scriptMatch) {
    throw new NegativeControlError("sidepanel.html does not reference a script bundle")
  }

  const scriptSrc = scriptMatch[1].replace(/^\//, "")
  const bundlePath = join(controlDir, scriptSrc)
  if (!existsSync(bundlePath)) {
    throw new NegativeControlError(`side panel bundle not found: ${scriptSrc}`)
  }

  const original = readFileSync(bundlePath, "utf8")
  writeFileSync(bundlePath, `throw new Error("${MARKER}");\n${original}`, "utf8")
  return scriptSrc
}

/** The two ways the control fails: the gate passed, or the marker stayed hidden. */
export function assessVerifierResult(exitCode: number, combined: string): string[] {
  const problems: string[] = []
  if (exitCode === 0) problems.push("verifier exited 0 on a broken artifact")
  if (!combined.includes(MARKER)) problems.push(`verifier output did not surface ${MARKER}`)
  return problems
}

function main(): number {
  const chromePath = process.env.VSA_CHROME_PATH

  try {
    return withControlDir((controlDir) => {
      const scriptSrc = injectSidePanelFailure(controlDir)
      console.log(`Injected module-evaluation failure into ${scriptSrc}`)

      // Deliberately after the copy and the injection: a missing executable is
      // one of the mid-run failures that must still clean up.
      if (!chromePath) {
        throw new NegativeControlError("VSA_CHROME_PATH is not set")
      }

      const result = Bun.spawnSync(
        [
          process.execPath,
          join(WORKSPACE_ROOT, "scripts", "verify-build-artifact.ts"),
          "--artifact",
          ".buntmp/rg01-negative-extension",
        ],
        {
          cwd: WORKSPACE_ROOT,
          env: { ...process.env, VSA_CHROME_PATH: chromePath },
          stdout: "pipe",
          stderr: "pipe",
        },
      )

      const combined = `${result.stdout.toString()}\n${result.stderr.toString()}`
      console.log("--- verifier output ---")
      console.log(combined.trim())
      console.log("--- end ---")
      console.log(`exit code: ${result.exitCode}`)

      const problems = assessVerifierResult(result.exitCode, combined)
      if (problems.length > 0) {
        for (const problem of problems) {
          console.error(`NEGATIVE CONTROL FAIL: ${problem}`)
        }
        return 1
      }

      console.log(
        "NEGATIVE CONTROL PASS: broken artifact was rejected with the injected failure surfaced",
      )
      return 0
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`NEGATIVE CONTROL ERROR: ${message}`)
    return 2
  }
}

if (import.meta.main) {
  process.exit(main())
}
