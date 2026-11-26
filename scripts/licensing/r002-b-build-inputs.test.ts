import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"

const project = resolve(import.meta.dir, "../..")
const fixedMain = "b847cc99cf559a2af3a7552c4a8ab906f9c3ef26"
const candidateScript = "scripts/licensing/r002-b-candidate.ts"
const integrationTimeout = 30_000
const temp = realpathSync(tmpdir())
let checkout: string | undefined

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: checkout, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
}

function writeFixture(path: string, value = "export {}\n"): string {
  const file = join(checkout!, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, value, { flag: "wx" })
  return file
}

function candidateLedger() {
  const nodePath = [join(project, "node_modules"), process.env.NODE_PATH].filter(Boolean).join(delimiter)
  return Bun.spawnSync([process.execPath, candidateScript, "ledger"], {
    cwd: checkout,
    env: { ...process.env, NODE_PATH: nodePath },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20_000,
  })
}

function expectRejected(path: string) {
  const result = candidateLedger()
  expect(result.exitCode).toBe(1)
  expect(result.stderr.toString().trim()).toBe(`Candidate product files differ from captured source: ${path}`)
}

describe("F-01 candidate build inputs in Git", () => {
  beforeAll(() => {
    checkout = mkdtempSync(join(temp, "vsa-r002-pr4-r1-"))
    execFileSync("git", ["clone", "--quiet", "--shared", "--no-checkout", "--", project, checkout])
    git("config", "--local", "core.autocrlf", "false")
    // The historical checkout predates the PR-5 attribute for the captured CRLF ledger.
    appendFileSync(join(checkout, ".git/info/attributes"), "\n/docs/licensing/third-party-license-ledger.json text eol=crlf\n")
    git("checkout", "--quiet", "--detach", fixedMain)
    git("config", "--local", "diff.renames", "true")
    copyFileSync(join(project, candidateScript), join(checkout, candidateScript))
    copyFileSync(join(project, "package.json"), join(checkout, "package.json"))
  }, integrationTimeout)

  afterAll(() => {
    if (checkout && dirname(realpathSync(checkout)) === temp) rmSync(checkout, { recursive: true, force: true })
  })

  it("allows the approved package scripts, documentation, and tooling test paths", () => {
    const paths = ["docs/r1-review.md", "scripts/r1-tooling.test.ts"]
    const [doc, test] = paths.map(path => writeFixture(path))
    const cliPath = "scripts/release-package.ts"
    const cli = join(checkout!, cliPath)
    appendFileSync(join(checkout!, ".git/info/exclude"), "\n/docs/r1-local/\n")
    const ignoredDoc = writeFixture("docs/r1-local/.env.example", "EXAMPLE=value\n")
    copyFileSync(join(project, cliPath), cli)
    try {
      git("add", "--", paths[0], cliPath)
      const result = candidateLedger()
      expect(result.stderr.toString()).toBe("")
      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("THIRD_PARTY_NOTICES_COMPLETE_RELEASE_HOLD")
    } finally {
      git("restore", "--staged", "--", paths[0], cliPath)
      for (const file of [doc, test, cli, ignoredDoc]) rmSync(file)
    }
  }, integrationTimeout)

  it("rejects a staged new root contents file", () => {
    const path = "contents/r1-staged.tsx"
    const file = writeFixture(path)
    try {
      git("add", "--", path)
      expectRejected(path)
    } finally {
      git("restore", "--staged", "--", path)
      rmSync(file)
    }
  }, integrationTimeout)

  it.each(["contents/r1-untracked.tsx", "tabs/r1-page.tsx", "sandboxes/r1-page.tsx", "content.chrome.ts"])(
    "rejects an untracked build input at %s",
    path => {
      const file = writeFixture(path)
      try {
        expectRejected(path)
      } finally {
        rmSync(file)
      }
    },
    integrationTimeout,
  )

  it.each([
    ["contents/r1-local/index.tsx", "/contents/r1-local/", "export {}\n"],
    ["OpTiOnS/index.chrome.html", "/OpTiOnS/", "<!doctype html>\n"],
    ["PuBlIc/r1-local.txt", "/PuBlIc/", "fixture\n"],
    [".browserslistrc", "/.browserslistrc", "Chrome 120\n"],
  ])("rejects an ignored build input at %s", (path, exclude, bytes) => {
    appendFileSync(join(checkout!, ".git/info/exclude"), `\n${exclude}\n`)
    const file = writeFixture(path, bytes)
    try {
      expect(git("check-ignore", "--", path).trim()).toBe(path)
      expectRejected(path)
    } finally {
      rmSync(file)
    }
  }, integrationTimeout)

  it("rejects a product file moved to docs with Git rename detection enabled", () => {
    const source = "src/lib/utils.ts"
    const destination = "docs/r1-moved-utils.ts"
    git("mv", "--", source, destination)
    try {
      expect(git("diff", "--name-status", "HEAD", "--")).toContain(`R100\t${source}\t${destination}`)
      expectRejected(source)
    } finally {
      git("mv", "--", destination, source)
    }
  }, integrationTimeout)
})
