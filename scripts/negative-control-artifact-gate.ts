/**
 * Negative control for the artifact runtime gate.
 *
 * Copies the fresh production artifact to a throwaway directory, injects a
 * deterministic module-evaluation failure into the Side Panel bundle, then runs
 * the verifier against the copy. The gate MUST fail and MUST surface the
 * injected marker. The real artifact is never modified.
 *
 * Two containment rules keep this script from writing outside its own throwaway
 * directory:
 *
 * 1. the `<script src>` read from the copied HTML is validated as an
 *    artifact-relative path before it is used to build a filesystem path, and
 * 2. the resulting path is checked to still resolve inside the control directory
 *    immediately before the bundle is read and rewritten.
 *
 * Every failure path runs inside `withControlDir`, so the throwaway copy — even
 * a half-finished one left by a failed copy — is removed by a `finally` no
 * matter how the run ends. No helper calls `process.exit()`: failures propagate
 * as `NegativeControlError` and only `main` decides the exit code.
 *
 * Usage: bun scripts/negative-control-artifact-gate.ts
 */

import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { isAbsolute, join, relative, resolve, sep } from "node:path"

import { resolveExtensionPagePath } from "./lib/artifact-gate-policy"

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

/**
 * The filesystem operations `withControlDir` and `injectSidePanelFailure` use.
 *
 * Exists so the copy-failure cleanup path is testable without a real partial
 * `cpSync`. It is a seam, not a framework: only what the control actually needs.
 */
export type ControlIo = {
  exists: (path: string) => boolean
  copy: (source: string, destination: string) => void
  remove: (path: string) => void
  readText: (path: string) => string
  writeText: (path: string, text: string) => void
  /** Build a path from segments; overridable so containment can be tested on POSIX and Windows rules. */
  joinPath?: (...segments: string[]) => string
  /** Project `to` relative to `from`; overridable alongside `joinPath`. */
  relativePath?: (from: string, to: string) => string
  /** True when a projected path is absolute, which happens across Windows drives. */
  isAbsolutePath?: (path: string) => boolean
  separator?: string
}

export const defaultControlIo: ControlIo = {
  exists: (path) => existsSync(path),
  copy: (source, destination) => {
    cpSync(source, destination, { recursive: true })
  },
  remove: (path) => {
    rmSync(path, { recursive: true, force: true })
  },
  readText: (path) => readFileSync(path, "utf8"),
  writeText: (path, text) => {
    writeFileSync(path, text, "utf8")
  },
}

export type ControlDirOptions = {
  sourceDir?: string
  controlDir?: string
  io?: ControlIo
}

function resolveIo(io: ControlIo | undefined): Required<ControlIo> {
  return {
    ...defaultControlIo,
    joinPath: join,
    relativePath: relative,
    isAbsolutePath: isAbsolute,
    separator: sep,
    ...io,
  } as Required<ControlIo>
}

/**
 * Copy the production artifact to the throwaway directory and remove it again
 * whatever the body does.
 *
 * Order matches the cleanup contract: clear any stale directory, then run the
 * copy *inside* the guarded region. A copy that dies halfway leaves a partial
 * directory, and that partial directory is removed by the same `finally` that
 * cleans up every other failure.
 */
export function withControlDir<T>(
  body: (controlDir: string) => T,
  options: ControlDirOptions = {},
): T {
  const io = resolveIo(options.io)
  const sourceDir = options.sourceDir ?? SOURCE_ARTIFACT
  const controlDir = options.controlDir ?? CONTROL_DIR

  if (!io.exists(sourceDir)) {
    throw new NegativeControlError(`missing ${sourceDir}; run \`bun run build\` first`)
  }

  io.remove(controlDir)
  try {
    io.copy(sourceDir, controlDir)
    return body(controlDir)
  } finally {
    io.remove(controlDir)
  }
}

/**
 * Validate the `<script src>` read from packaged extension HTML.
 *
 * Returns the artifact-relative path to use, or throws. Rejected forms are
 * anything that could name a location outside the artifact: URL schemes
 * (including Windows drive letters such as `C:`), protocol-relative `//host`,
 * backslashes, and any `..` traversal.
 *
 * A *single* leading `/` is not a filesystem absolute path here: packaged
 * extension HTML writes extension-root-relative URLs that way, and the real
 * production artifact uses `/sidepanel.<hash>.js`. It is stripped exactly once,
 * then the remainder still has to pass `resolveExtensionPagePath` and the
 * containment check in `containBundlePath`.
 */
export function normalizeExtensionScriptSrc(rawSrc: string): string {
  const trimmed = rawSrc.trim()
  if (trimmed.length === 0) {
    throw new NegativeControlError("sidepanel.html references an empty script src")
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    throw new NegativeControlError(`script src uses a URL scheme: ${JSON.stringify(rawSrc)}`)
  }
  if (trimmed.includes("\\")) {
    throw new NegativeControlError(`script src uses backslashes: ${JSON.stringify(rawSrc)}`)
  }
  if (trimmed.startsWith("//")) {
    throw new NegativeControlError(`script src is protocol-relative: ${JSON.stringify(rawSrc)}`)
  }

  const withoutRootSlash = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed
  const safe = resolveExtensionPagePath(withoutRootSlash)
  if (safe === null) {
    throw new NegativeControlError(
      `script src is not a safe artifact-relative path: ${JSON.stringify(rawSrc)}`,
    )
  }
  return safe
}

/**
 * Resolve an already-validated artifact-relative path to an absolute path and
 * prove it is still inside `controlDir`.
 *
 * This is the check that actually gates the write: `normalizeExtensionScriptSrc`
 * rejects known-bad syntax, and this rejects anything that still projects
 * outside — a symlinked parent, a different Windows drive, anything.
 */
export function containBundlePath(
  controlDir: string,
  relativeScriptPath: string,
  io: ControlIo = defaultControlIo,
): string {
  const resolvedIo = resolveIo(io)
  const root = resolve(controlDir)
  const target = resolvedIo.joinPath(root, relativeScriptPath)
  const projected = resolvedIo.relativePath(root, target)
  const segments = projected.split(resolvedIo.separator)

  const escapes =
    projected.length === 0 ||
    projected.startsWith("..") ||
    segments.includes("..") ||
    resolvedIo.isAbsolutePath(projected)
  if (escapes) {
    throw new NegativeControlError(
      `script src escapes the control artifact: ${JSON.stringify(relativeScriptPath)}`,
    )
  }
  return target
}

/** Prepend a deterministic module-evaluation failure to the Side Panel bundle. */
export function injectSidePanelFailure(
  controlDir: string,
  io: ControlIo = defaultControlIo,
): string {
  const resolvedIo = resolveIo(io)
  const htmlPath = resolvedIo.joinPath(controlDir, "sidepanel.html")
  if (!resolvedIo.exists(htmlPath)) {
    throw new NegativeControlError(`missing ${htmlPath}`)
  }

  // Find the bundle the way the browser does: from the built HTML.
  const scriptMatch = resolvedIo.readText(htmlPath).match(/<script[^>]+src="([^"]+)"/)
  if (!scriptMatch) {
    throw new NegativeControlError("sidepanel.html does not reference a script bundle")
  }

  // Validate the reference *before* it is turned into a filesystem path, then
  // prove the resulting path is still inside the control directory.
  const scriptSrc = normalizeExtensionScriptSrc(scriptMatch[1])
  const bundlePath = containBundlePath(controlDir, scriptSrc, resolvedIo)
  if (!resolvedIo.exists(bundlePath)) {
    throw new NegativeControlError(`side panel bundle not found: ${scriptSrc}`)
  }

  const original = resolvedIo.readText(bundlePath)
  resolvedIo.writeText(bundlePath, `throw new Error("${MARKER}");\n${original}`)
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
