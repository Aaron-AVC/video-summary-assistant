import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const project = resolve(import.meta.dir, "../..")
const reviewedCandidate = "48ec9c5348d1fdc28796c91334e2d98c41617ac4"
const baseCommit = "de4bdcf811f93dab72bd748e314d59a414e1f251"
const temp = realpathSync(tmpdir())
const fixturePath = "docs/unclassified-contribution.md"
const historicalPath = "docs/licensing/evidence/R002-B/REVIEW.md"
type MutationResult = { accepted: boolean, error?: string }
let checkout: string | undefined
let evidence: string | undefined
let runtimeCandidate = ""
let baselineVerify: ReturnType<typeof runBun>
let baselinePackage: ReturnType<typeof runBun>
let contributionVerify: ReturnType<typeof runBun>
let contributionPackage: ReturnType<typeof runBun>
let mutationMatrix: ReturnType<typeof runBun>
let mutationResults: Record<string, MutationResult> & { renamePaths?: string[] } = {}
let packageCreatedAfterContribution = false
let baselinePackageDirectories: string[] = []
let renamePaths: string[] = []
let historicalDecision: Buffer
let projectLicense: Buffer
let contributionTerms: Buffer
let productionFiles = new Map<string, string>()

function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: checkout,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

function runBun(args: string[]) {
  return Bun.spawnSync([process.execPath, ...args], {
    cwd: checkout,
    env: {
      ...process.env,
      NODE_PATH: [join(project, "node_modules"), process.env.NODE_PATH].filter(Boolean).join(delimiter),
    },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  })
}

function preserveRun(name: string, result: ReturnType<typeof runBun>): void {
  writeFileSync(join(evidence!, `${name}.stdout.txt`), result.stdout)
  writeFileSync(join(evidence!, `${name}.stderr.txt`), result.stderr)
  writeFileSync(join(evidence!, `${name}.exit.txt`), `${result.exitCode}\n`)
}

function fileHashes(directory: string): Map<string, string> {
  const result = new Map<string, string>()
  const visit = (current: string): void => {
    for (const name of readdirSync(current)) {
      const path = join(current, name)
      if (statSync(path).isDirectory()) visit(path)
      else result.set(path.slice(directory.length + 1), createHash("sha256").update(readFileSync(path)).digest("hex"))
    }
  }
  visit(directory)
  return result
}

function overlayCurrentWorktree(): void {
  const tracked = execFileSync("git", ["diff", "--no-renames", "--name-only", "-z", reviewedCandidate, "--"], {
    cwd: project,
    stdio: ["ignore", "pipe", "pipe"],
  }).toString("utf8").split("\0").filter(Boolean)
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd: project,
    stdio: ["ignore", "pipe", "pipe"],
  }).toString("utf8").split("\0").filter(Boolean)

  for (const path of new Set([...tracked, ...untracked])) {
    const source = join(project, path)
    const target = join(checkout!, path)
    if (!existsSync(source)) {
      if (existsSync(target)) rmSync(target, { force: true })
      continue
    }
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target, { recursive: true, force: true })
  }
}

function commitAs(name: string, email: string, message: string, allowEmpty = false): void {
  execFileSync("git", [
    "-c", `user.name=${name}`,
    "-c", `user.email=${email}`,
    "commit", "--quiet",
    ...(allowEmpty ? ["--allow-empty"] : []),
    "-m", message,
  ], {
    cwd: checkout,
    stdio: ["ignore", "pipe", "pipe"],
  })
}

describe("PR-5 contribution qualification coverage", () => {
  beforeAll(() => {
    checkout = mkdtempSync(join(temp, "vsa-r002-pr5-r1-coverage-"))
    evidence = mkdtempSync(join(temp, "vsa-r002-pr5-r1-green-"))

    execFileSync("git", ["clone", "--quiet", "--shared", "--no-checkout", "--", project, checkout])
    git("config", "--local", "core.autocrlf", "false")
    git("checkout", "--quiet", "--detach", reviewedCandidate)
    historicalDecision = readFileSync(join(checkout, "docs/licensing/evidence/R002-PR5/project-rights-decision-v6.json"))
    projectLicense = readFileSync(join(checkout, "LICENSE"))
    contributionTerms = readFileSync(join(checkout, "CONTRIBUTING.md"))

    cpSync(join(project, "build/chrome-mv3-prod"), join(checkout, "build/chrome-mv3-prod"), {
      recursive: true,
      errorOnExist: true,
    })
    productionFiles = fileHashes(join(checkout, "build/chrome-mv3-prod"))
    expect(productionFiles).toHaveLength(14)

    overlayCurrentWorktree()
    for (const name of [
      "contributor-authority-v12.json",
      "current-ledger-v12.json",
      "current-scope-v12.json",
      "project-rights-decision-v12.json",
      "project-rights-supplement-v12.json",
    ]) {
      rmSync(join(checkout, "docs/licensing/evidence/R002-PR5", name), { force: true })
    }
    rmSync(join(checkout, "docs/licensing/evidence/R002-PR5/notice-preview-v12"), {
      recursive: true,
      force: true,
    })
    const author = execFileSync("git", ["show", "-s", "--format=%an%x09%ae", reviewedCandidate], {
      cwd: checkout,
      encoding: "utf8",
    }).trim().split("\t")
    git("add", "--all")
    commitAs(author[0]!, author[1]!, "test fixture: load current PR-5 qualification implementation")

    const record = runBun(["scripts/licensing/r002-pr5-record.ts", "record"])
    preserveRun("record-current-v12", record)
    expect(record.exitCode).toBe(0)
    git("add", "--all")
    commitAs(author[0]!, author[1]!, "test fixture: record current PR-5 qualification evidence", true)
    runtimeCandidate = git("rev-parse", "HEAD").trim()

    baselineVerify = runBun(["scripts/licensing/r002-pr5-record.ts", "verify"])
    preserveRun("baseline-verify", baselineVerify)
    baselinePackage = runBun(["run", "package"])
    preserveRun("baseline-package", baselinePackage)
    expect(git("status", "--porcelain").trim()).toBe("")
    baselinePackageDirectories = readdirSync(join(checkout, "dist"))
    expect(baselinePackageDirectories.length).toBeGreaterThan(0)

    writeFileSync(
      join(checkout, fixturePath),
      "# Unclassified contribution\n\nThis file is not covered by the PR-5 source-rights record.\n",
    )
    const rightsModule = pathToFileURL(join(checkout, "scripts/licensing/project-rights.ts")).href
    const matrixScript = `
      const { execFileSync } = require("node:child_process")
      const { readFileSync, unlinkSync, writeFileSync } = require("node:fs")
      const rights = await import(${JSON.stringify(rightsModule)})
      const base = ${JSON.stringify(baseCommit)}
      const candidate = ${JSON.stringify(runtimeCandidate)}
      const source = ${JSON.stringify(historicalPath)}
      const results = {}
      const verify = name => {
        try { rights.verifyProjectRightsQualification(); results[name] = { accepted: true } }
        catch (error) { results[name] = { accepted: false, error: error.message } }
      }
      const original = readFileSync(source)
      writeFileSync(${JSON.stringify(fixturePath)}, "untracked contribution")
      verify("untracked")
      unlinkSync(${JSON.stringify(fixturePath)})
      writeFileSync(source, "modified historical evidence")
      verify("modified")
      writeFileSync(source, original)
      unlinkSync(source)
      verify("deleted")
      writeFileSync(source, original)
      unlinkSync(source)
      execFileSync("git", ["add", "--", source])
      writeFileSync(source, original)
      verify("stagedDeletionRestoredInWorktree")
      execFileSync("git", ["reset", "--hard", "--quiet", candidate])
      const frozenPath = "docs/licensing/evidence/R002-PR5/project-rights-decision-v6.json"
      const frozenBytes = readFileSync(frozenPath)
      writeFileSync(frozenPath, Buffer.concat([frozenBytes, Buffer.from("TAMPERED")]))
      verify("alteredHistoricalGeneratedEvidence")
      writeFileSync(frozenPath, frozenBytes)
      unlinkSync(frozenPath)
      verify("deletedHistoricalGeneratedEvidence")
      writeFileSync(frozenPath, frozenBytes)
      writeFileSync("docs/licensing/evidence/R002-PR5/unclassified-extra.md", "not a generated record")
      verify("unrecognizedEvidencePath")
      unlinkSync("docs/licensing/evidence/R002-PR5/unclassified-extra.md")
      execFileSync("git", ["mv", "--", source, "docs/unclassified-renamed.md"])
      results.renamePaths = execFileSync("git", ["diff", "--no-renames", "--name-only", "-z", base, "--"])
        .toString("utf8").split(String.fromCharCode(0)).filter(Boolean).sort()
      verify("renamed")
      execFileSync("git", ["reset", "--hard", "--quiet", candidate])
      const [knownName, knownEmail] = execFileSync("git", [
        "show", "-s", "--format=%an%x09%ae", ${JSON.stringify(reviewedCandidate)},
      ]).toString("utf8").trim().split(String.fromCharCode(9))
      writeFileSync(source, "committed unclassified modification")
      execFileSync("git", ["add", "--", source])
      execFileSync("git", [
        "-c", "user.name=" + knownName,
        "-c", "user.email=" + knownEmail,
        "commit", "--quiet", "-m", "docs: modify an unclassified path",
      ])
      writeFileSync(source, original)
      execFileSync("git", ["add", "--", source])
      verify("committedChangeHiddenByStagedRevert")
      execFileSync("git", ["reset", "--hard", "--quiet", candidate])
      const toolIdentity = execFileSync("git", [
        "show", "-s", "--format=%an%x09%ae", "afc8fc01fbf12d1a154941a4fce2aa411f2f3e28",
      ]).toString("utf8").trim().split(String.fromCharCode(9))
      execFileSync("git", [
        "-c", "user.name=" + toolIdentity[0],
        "-c", "user.email=" + toolIdentity[1],
        "commit", "--allow-empty", "--quiet", "-m", "docs: confirm authorized ChatGPT tool contribution",
      ])
      try {
        const { outputs } = rights.deriveProjectRightsQualification()
        const contributors = JSON.parse(outputs.get(rights.projectRightsConstants.contributorRecord).toString("utf8"))
        results.confirmedChatGPTToolAuthor = {
          accepted: contributors.candidateContributionReview.observedAuthorIdentities
            .some(identity => identity.name === toolIdentity[0]),
        }
      } catch (error) {
        results.confirmedChatGPTToolAuthor = { accepted: false, error: error.message }
      }
      verify("staleEvidenceAfterConfirmedToolAuthor")
      execFileSync("git", ["reset", "--hard", "--quiet", candidate])
      execFileSync("git", [
        "-c", "user.name=Unconfirmed Contributor",
        "-c", "user.email=unconfirmed-contributor@example.invalid",
        "commit", "--allow-empty", "--quiet", "-m", "docs: record an unconfirmed contribution identity",
      ])
      verify("unconfirmedAuthor")
      execFileSync("git", ["reset", "--hard", "--quiet", candidate])
      execFileSync("git", [
        "-c", "user.name=" + knownName,
        "-c", "user.email=" + knownEmail,
        "commit", "--allow-empty", "--quiet",
        "-m", "docs: record an unconfirmed co-author",
        "-m", "Co-authored-by: Unconfirmed Contributor <unconfirmed-contributor@example.invalid>",
      ])
      verify("unconfirmedCoAuthor")
      execFileSync("git", ["reset", "--hard", "--quiet", candidate])
      console.log(JSON.stringify(results))
    `
    mutationMatrix = Bun.spawnSync([process.execPath, "-e", matrixScript], {
      cwd: checkout,
      env: {
        ...process.env,
        NODE_PATH: [join(project, "node_modules"), process.env.NODE_PATH].filter(Boolean).join(delimiter),
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 100_000,
    })
    preserveRun("mutation-matrix", mutationMatrix)
    mutationResults = JSON.parse(mutationMatrix.stdout.toString("utf8")) as typeof mutationResults

    writeFileSync(
      join(checkout, fixturePath),
      "# Unclassified contribution\n\nThis file is not covered by the PR-5 source-rights record.\n",
    )
    git("add", "--", fixturePath)
    commitAs("External Contributor", "external-contributor@example.invalid", "docs: add an unclassified contribution")

    expect(git("status", "--porcelain").trim()).toBe("")
    expect(git("diff", "--cached", "--name-only").trim()).toBe("")
    expect(fileHashes(join(checkout, "build/chrome-mv3-prod"))).toEqual(productionFiles)

    contributionVerify = runBun(["scripts/licensing/r002-pr5-record.ts", "verify"])
    preserveRun("unclassified-verify", contributionVerify)
    contributionPackage = runBun(["run", "package"])
    preserveRun("unclassified-package", contributionPackage)
    packageCreatedAfterContribution = readdirSync(join(checkout, "dist"))
      .some(name => !baselinePackageDirectories.includes(name))

    writeFileSync(join(evidence, "fixture.json"), `${JSON.stringify({
      reviewedCandidate,
      runtimeCandidate,
      fixturePath,
      cleanTrackedWorktree: true,
      cleanIndex: true,
      baselineVerifyExit: baselineVerify.exitCode,
      baselinePackageExit: baselinePackage.exitCode,
      mutationMatrixExit: mutationMatrix.exitCode,
      mutationResults,
      unclassifiedVerifyExit: contributionVerify.exitCode,
      unclassifiedPackageExit: contributionPackage.exitCode,
      packageCreatedAfterContribution,
      productionFileCount: productionFiles.size,
      productionIdentities: Object.fromEntries(productionFiles),
      historicalDecisionSha256: Bun.CryptoHasher.hash("sha256", historicalDecision),
      licenseSha256: Bun.CryptoHasher.hash("sha256", projectLicense),
      contributorTermsSha256: Bun.CryptoHasher.hash("sha256", contributionTerms),
    }, null, 2)}\n`)

    expect(Buffer.compare(
      readFileSync(join(checkout, "docs/licensing/evidence/R002-PR5/project-rights-decision-v6.json")),
      historicalDecision,
    )).toBe(0)
    expect(Buffer.compare(readFileSync(join(checkout, "LICENSE")), projectLicense)).toBe(0)
    expect(Buffer.compare(readFileSync(join(checkout, "CONTRIBUTING.md")), contributionTerms)).toBe(0)
    expect(fileHashes(join(project, "build/chrome-mv3-prod"))).toEqual(productionFiles)
  }, 240_000)

  afterAll(() => {
    if (checkout && dirname(realpathSync(checkout)) === temp) rmSync(checkout, { recursive: true, force: true })
    if (evidence) console.log(`PR-5 R1 coverage evidence: ${evidence}`)
  })

  it("accepts the clean reviewed candidate through the real qualification and packaging entry points", () => {
    expect(baselineVerify.exitCode).toBe(0)
    expect(baselineVerify.stdout.toString()).toContain("QUALIFIED_FOR_LOCAL_CANDIDATE")
    expect(baselinePackage.exitCode).toBe(0)
    expect(baselinePackage.stdout.toString()).toContain("publicationAuthorized=false")
  })

  it("rejects untracked and committed unclassified contributions through the real CLIs", () => {
    expect(mutationMatrix.exitCode).toBe(0)
    expect(mutationResults.untracked).toMatchObject({ accepted: false })
    expect(mutationResults.untracked!.error).toContain("Unclassified contribution path")
    expect(contributionVerify.exitCode).toBe(1)
    expect(contributionVerify.stderr.toString()).toContain("Unclassified contribution path")
    expect(contributionPackage.exitCode).toBe(1)
    expect(contributionPackage.stderr.toString()).toContain("Unclassified contribution path")
    expect(packageCreatedAfterContribution).toBe(false)
  })

  it("rejects unclassified modifications, deletions, and both sides of a rename", () => {
    for (const result of [
      mutationResults.modified,
      mutationResults.deleted,
      mutationResults.stagedDeletionRestoredInWorktree,
      mutationResults.committedChangeHiddenByStagedRevert,
      mutationResults.renamed,
    ]) {
      expect(result).toMatchObject({ accepted: false })
      expect(result!.error).toContain("Unclassified contribution path")
    }
    expect(mutationResults.renamePaths).toContain(historicalPath)
    expect(mutationResults.renamePaths).toContain("docs/unclassified-renamed.md")
  })

  it("accepts only frozen historical output bytes and the current generator output paths", () => {
    expect(mutationResults.alteredHistoricalGeneratedEvidence!.error)
      .toContain("Frozen PR-5 historical evidence changed")
    expect(mutationResults.deletedHistoricalGeneratedEvidence!.error)
      .toContain("Frozen PR-5 historical evidence changed")
    expect(mutationResults.unrecognizedEvidencePath!.error)
      .toContain("Unclassified contribution path")
    expect(baselineVerify.exitCode).toBe(0)
  })

  it("distinguishes an approved identity from the need to re-record changed contributor evidence", () => {
    expect(mutationResults.confirmedChatGPTToolAuthor).toEqual({ accepted: true })
    expect(mutationResults.staleEvidenceAfterConfirmedToolAuthor).toMatchObject({
      accepted: false,
      error: expect.stringContaining("PR-5 current evidence differs from its fixed inputs"),
    })
  })

  it("rejects a new, unconfirmed author even when the commit changes no paths", () => {
    expect(mutationResults.unconfirmedAuthor!.error).toContain("Unconfirmed contribution identity")
    expect(mutationResults.unconfirmedCoAuthor!.error).toContain("Unconfirmed contribution identity")
  })
})
