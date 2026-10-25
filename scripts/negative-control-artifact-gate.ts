/**
 * Negative control for the artifact runtime gate.
 *
 * Copies the fresh production artifact to a throwaway directory, injects a
 * deterministic module-evaluation failure into the Side Panel bundle, then runs
 * the verifier against the copy. The gate MUST fail and MUST surface the
 * injected marker. The real artifact is never modified.
 *
 * Usage: bun scripts/negative-control-artifact-gate.ts
 */

import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const MARKER = "RG01_NEGATIVE_CONTROL"
const WORKSPACE_ROOT = resolve(import.meta.dir, "..")
const SOURCE_ARTIFACT = join(WORKSPACE_ROOT, "build", "chrome-mv3-prod")
const CONTROL_DIR = join(WORKSPACE_ROOT, ".buntmp", "rg01-negative-extension")

function fail(message: string): never {
  console.error(`NEGATIVE CONTROL ERROR: ${message}`)
  process.exit(2)
}

if (!existsSync(SOURCE_ARTIFACT)) {
  fail(`missing ${SOURCE_ARTIFACT}; run \`bun run build\` first`)
}

rmSync(CONTROL_DIR, { recursive: true, force: true })
cpSync(SOURCE_ARTIFACT, CONTROL_DIR, { recursive: true })

// Find the Side Panel bundle the way the browser does: from the built HTML.
const sidePanelHtml = readFileSync(join(CONTROL_DIR, "sidepanel.html"), "utf8")
const scriptMatch = sidePanelHtml.match(/<script[^>]+src="([^"]+)"/)
if (!scriptMatch) fail("sidepanel.html does not reference a script bundle")

const scriptSrc = scriptMatch[1].replace(/^\//, "")
const bundlePath = join(CONTROL_DIR, scriptSrc)
if (!existsSync(bundlePath)) fail(`side panel bundle not found: ${scriptSrc}`)

// Prepend a throw so module evaluation fails before React can mount.
const original = readFileSync(bundlePath, "utf8")
writeFileSync(bundlePath, `throw new Error("${MARKER}");\n${original}`, "utf8")
console.log(`Injected module-evaluation failure into ${scriptSrc}`)

const chromePath = process.env.VSA_CHROME_PATH
if (!chromePath) {
  fail("VSA_CHROME_PATH is not set")
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

const stdout = result.stdout.toString()
const stderr = result.stderr.toString()
const combined = `${stdout}\n${stderr}`

console.log("--- verifier output ---")
console.log(combined.trim())
console.log("--- end ---")
console.log(`exit code: ${result.exitCode}`)

let failed = false
if (result.exitCode === 0) {
  console.error("NEGATIVE CONTROL FAIL: verifier exited 0 on a broken artifact")
  failed = true
}
if (!combined.includes(MARKER)) {
  console.error(`NEGATIVE CONTROL FAIL: verifier output did not surface ${MARKER}`)
  failed = true
}

rmSync(CONTROL_DIR, { recursive: true, force: true })

if (failed) process.exit(1)
console.log("NEGATIVE CONTROL PASS: broken artifact was rejected with the injected failure surfaced")
