import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import {
  MARKER,
  NegativeControlError,
  assessVerifierResult,
  injectSidePanelFailure,
  withControlDir,
} from "./negative-control-artifact-gate"

/**
 * These tests cover the cleanup contract only: the negative control must never
 * leave `.buntmp/rg01-negative-extension` behind, and no helper may terminate the
 * process before `finally` runs. The real control still has to launch Chromium.
 */

const WORKSPACE_ROOT = resolve(import.meta.dir, "..")
const SCRATCH_ROOT = join(WORKSPACE_ROOT, ".buntmp")
const created: string[] = []

function scratchDir(label: string): string {
  mkdirSync(SCRATCH_ROOT, { recursive: true })
  const dir = mkdtempSync(join(SCRATCH_ROOT, `rg01r-${label}-`))
  created.push(dir)
  return dir
}

/** Build a minimal artifact tree with a Side Panel bundle the injector can reach. */
function fixtureArtifact(label: string): { sourceDir: string; controlDir: string } {
  const root = scratchDir(label)
  const sourceDir = join(root, "artifact")
  const controlDir = join(root, "control")
  mkdirSync(sourceDir, { recursive: true })
  writeFileSync(
    join(sourceDir, "sidepanel.html"),
    '<!doctype html><div id="__plasmo"></div><script src="sidepanel.abc.js"></script>',
    "utf8",
  )
  writeFileSync(join(sourceDir, "sidepanel.abc.js"), "console.log('real bundle')\n", "utf8")
  return { sourceDir, controlDir }
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("negative control cleanup", () => {
  it("removes the control directory after a successful body", () => {
    const { sourceDir, controlDir } = fixtureArtifact("success")

    const seen: string[] = []
    const value = withControlDir(
      (dir) => {
        seen.push(dir)
        expect(existsSync(join(dir, "sidepanel.html"))).toBe(true)
        return "ok" as const
      },
      { sourceDir, controlDir },
    )

    expect(value).toBe("ok")
    expect(seen).toEqual([controlDir])
    expect(existsSync(controlDir)).toBe(false)
  })

  it("removes the control directory when the body throws mid-run", () => {
    const { sourceDir, controlDir } = fixtureArtifact("throw")

    expect(() =>
      withControlDir(
        (dir) => {
          injectSidePanelFailure(dir)
          throw new NegativeControlError("VSA_CHROME_PATH is not set")
        },
        { sourceDir, controlDir },
      ),
    ).toThrow(NegativeControlError)

    expect(existsSync(controlDir)).toBe(false)
  })

  it("removes the control directory when injection itself fails", () => {
    const root = scratchDir("no-bundle")
    const sourceDir = join(root, "artifact")
    const controlDir = join(root, "control")
    mkdirSync(sourceDir, { recursive: true })
    // References a bundle that does not exist, so injection fails after the copy.
    writeFileSync(join(sourceDir, "sidepanel.html"), '<script src="missing.js"></script>', "utf8")

    expect(() => withControlDir((dir) => injectSidePanelFailure(dir), { sourceDir, controlDir })).toThrow(
      NegativeControlError,
    )

    expect(existsSync(controlDir)).toBe(false)
  })

  it("clears a stale directory from a previous run before copying", () => {
    const { sourceDir, controlDir } = fixtureArtifact("stale")
    mkdirSync(controlDir, { recursive: true })
    writeFileSync(join(controlDir, "leftover.txt"), "stale", "utf8")

    withControlDir((dir) => dir, { sourceDir, controlDir })

    expect(existsSync(controlDir)).toBe(false)
  })

  it("fails before creating the control directory when the artifact is missing", () => {
    const root = scratchDir("missing-source")
    const sourceDir = join(root, "absent")
    const controlDir = join(root, "control")

    expect(() => withControlDir((dir) => dir, { sourceDir, controlDir })).toThrow(NegativeControlError)
    expect(existsSync(controlDir)).toBe(false)
  })
})

describe("side panel failure injection", () => {
  it("prepends the marker to the bundle referenced by sidepanel.html", () => {
    const root = scratchDir("inject")
    writeFileSync(join(root, "sidepanel.html"), '<script src="/sidepanel.abc.js"></script>', "utf8")
    writeFileSync(join(root, "sidepanel.abc.js"), "console.log('real bundle')\n", "utf8")

    const scriptSrc = injectSidePanelFailure(root)
    expect(scriptSrc).toBe("sidepanel.abc.js")

    const body = readFileSync(join(root, "sidepanel.abc.js"), "utf8")
    expect(body.startsWith(`throw new Error("${MARKER}");`)).toBe(true)
    expect(body).toContain("console.log('real bundle')")
  })

  it("rejects a Side Panel page without a script reference", () => {
    const root = scratchDir("no-script")
    writeFileSync(join(root, "sidepanel.html"), "<!doctype html><div></div>", "utf8")
    expect(() => injectSidePanelFailure(root)).toThrow(NegativeControlError)
  })

  it("rejects a missing Side Panel page", () => {
    const root = scratchDir("no-html")
    expect(() => injectSidePanelFailure(root)).toThrow(NegativeControlError)
  })
})

describe("verifier verdict assessment", () => {
  it("passes only for a non-zero exit that surfaces the marker", () => {
    expect(assessVerifierResult(1, `... ${MARKER} ...`)).toEqual([])
  })

  it("rejects a verifier that passed on a broken artifact", () => {
    expect(assessVerifierResult(0, `... ${MARKER} ...`)).toEqual([
      "verifier exited 0 on a broken artifact",
    ])
  })

  it("rejects a verifier that failed without surfacing the marker", () => {
    expect(assessVerifierResult(1, "boom")).toEqual([
      `verifier output did not surface ${MARKER}`,
    ])
  })

  it("reports both problems when nothing was proven", () => {
    expect(assessVerifierResult(0, "boom")).toEqual([
      "verifier exited 0 on a broken artifact",
      `verifier output did not surface ${MARKER}`,
    ])
  })
})
