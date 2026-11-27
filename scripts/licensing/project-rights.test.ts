import { describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createHash } from "node:crypto"
import {
  deriveProjectRightsQualification,
  loadVerifiedProjectRightsState,
  verifyProjectRightsQualification,
} from "./project-rights"
import { projectRightsConstants } from "./project-rights"

describe("PR-5 project-rights evidence", () => {
  it("classifies exactly the paths in the fixed PR-4 merge diff", () => {
    const actualPaths = execFileSync("git", [
      "diff",
      "--name-only",
      "-z",
      projectRightsConstants.pr4BaseCommit,
      projectRightsConstants.baseCommit,
      "--",
    ], { cwd: process.cwd() }).toString().split("\0").filter(Boolean).sort()
    const recordedPaths = (projectRightsConstants as typeof projectRightsConstants & {
      pr4Paths?: string[]
    }).pr4Paths ?? []

    expect(recordedPaths).toEqual(actualPaths)
  })

  it("pins fixed legal terms and versioned notice snapshots against Git line-ending conversion", () => {
    const paths = [
      "LICENSE",
      "CONTRIBUTING.md",
      "licenses/LICENSE-SCOPE.md",
      "docs/licensing/evidence/R002-PR5/VERSION-STATUS.md",
      "docs/licensing/evidence/R002-PR5/project-rights-decision-v6.json",
      "docs/licensing/evidence/R002-PR5/notice-preview-v6/THIRD_PARTY/manifest.json",
      "docs/licensing/evidence/R002-PR5/notice-preview-v6/THIRD_PARTY/LICENSES/cb5e8e7e5f4a3988e1063c142c60dc2df75605f4c46515e776e3aca6df976e14/LICENSE",
    ]
    const output = execFileSync("git", [
      "check-attr",
      "text",
      "whitespace",
      "--",
      ...paths,
    ], { cwd: process.cwd(), encoding: "utf8" }).trimEnd()

    expect(output.split(/\r?\n/)).toEqual(paths.flatMap(path => [
      `${path}: text: unset`,
      `${path}: whitespace: cr-at-eol,-blank-at-eof`,
    ]))
  })

  it("preserves the raw bytes of every PR-4 and PR-5 supplement source across checkouts", () => {
    const paths = [...new Set([...projectRightsConstants.pr4Paths, ...projectRightsConstants.pr5SourcePaths])]
    const output = execFileSync("git", [
      "check-attr",
      "text",
      "--",
      ...paths,
    ], { cwd: process.cwd(), encoding: "utf8" }).trimEnd()

    expect(output.split(/\r?\n/)).toEqual(paths.map(path => `${path}: text: unset`))
  })

  it("classifies every current PR-5 source change while excluding generated audit outputs", () => {
    const tracked = execFileSync("git", [
      "diff", "--no-renames", "--name-only", "-z", projectRightsConstants.baseCommit, "--",
    ], { cwd: process.cwd() }).toString().split("\0").filter(Boolean)
    const untracked = execFileSync("git", [
      "ls-files", "--others", "--exclude-standard", "-z",
    ], { cwd: process.cwd() }).toString().split("\0").filter(Boolean)
    const sourceChanges = [...tracked, ...untracked].filter(path =>
      !path.startsWith("docs/licensing/evidence/R002-PR5/"))
    const classified = new Set([
      ...projectRightsConstants.pr4Paths,
      ...projectRightsConstants.pr5SourcePaths,
    ])

    expect(sourceChanges.filter(path => !classified.has(path))).toEqual([])
  })

  it("keeps all UNKNOWN npm identities covered by their original license bytes", () => {
    const { scope, ledger, noticeFiles, counts } = deriveProjectRightsQualification()
    const scopeData = scope as any
    const ledgerData = ledger as any
    const unknownNpmIds = scopeData.components
      .filter((row: any) => row.membership === "UNKNOWN" && row.id.startsWith("npm:"))
      .map((row: any) => row.id)

    expect(counts).toEqual({
      total: 84,
      included: 71,
      unknown: 13,
      excluded: 0,
      unknownNpm: 12,
    })
    expect(unknownNpmIds).toHaveLength(12)

    for (const componentId of unknownNpmIds) {
      const component = ledgerData.components.find((row: any) => row.componentId === componentId)
      expect(component).toBeDefined()
      expect(component!.license.licenseMaterialIds.length).toBeGreaterThan(0)

      for (const materialId of component!.license.licenseMaterialIds) {
        const material = ledgerData.licenseMaterials.find((row: any) => row.materialId === materialId)
        expect(material).toBeDefined()
        const outputPath = `THIRD_PARTY/LICENSES/${materialId.slice("sha256:".length)}/LICENSE`
        expect(noticeFiles.get(outputPath)).toEqual(readFileSync(join(process.cwd(), material!.path)))
      }
    }
    expect(noticeFiles).toHaveProperty("size", 31)
  })

  it("rejects altered fixed license and contributor terms before any candidate record can be regenerated", () => {
    for (const path of ["LICENSE", "CONTRIBUTING.md"]) {
      const fullPath = join(process.cwd(), path)
      const original = readFileSync(fullPath)
      try {
        writeFileSync(fullPath, Buffer.concat([original, Buffer.from("\nUNAUTHORIZED TERMS\n")]))
        expect(() => deriveProjectRightsQualification()).toThrow()
      } finally {
        writeFileSync(fullPath, original)
      }
    }
  })

  it("binds the owner decision and candidate status to current evidence without authorizing publication", () => {
    const { outputs, qualification, counts } = deriveProjectRightsQualification()
    const parse = (path: string) => JSON.parse(outputs.get(path)!.toString("utf8"))
    const decision = parse(projectRightsConstants.decision)
    const contributors = parse(projectRightsConstants.contributorRecord)
    const noticeManifest = JSON.parse(
      outputs.get(`${projectRightsConstants.noticeRoot}/THIRD_PARTY/manifest.json`)!
        .toString("utf8"),
    )
    const license = readFileSync(join(process.cwd(), "LICENSE"))
    const contributorTerms = readFileSync(join(process.cwd(), "CONTRIBUTING.md"))

    expect(decision.status).toBe("QUALIFIED_FOR_LOCAL_CANDIDATE")
    expect(decision.projectLicense.sha256)
      .toBe(createHash("sha256").update(license).digest("hex"))
    expect(decision.contributionAuthority.termsSha256)
      .toBe(createHash("sha256").update(contributorTerms).digest("hex"))
    expect(decision.sourceRights.historicalInventory.pathCount).toBe(172)
    expect(decision.productionBuild.productFileCount).toBe(14)
    expect(decision.thirdPartyDistribution.componentMembershipCounts).toEqual(counts)
    expect(decision.qualification).toMatchObject({
      releaseEligible: true,
      releaseApproved: false,
      publicationAuthorized: false,
      finalReleaseReview: "PENDING",
      nextStage: "PR-6 final release review",
    })
    expect(qualification.decisionSha256)
      .toBe(createHash("sha256").update(outputs.get(projectRightsConstants.decision)!).digest("hex"))
    expect(contributors.rightsHolderDeclaration.digitalSignature).toBe("NOT_REPRESENTED")
    expect(contributors.unresolvedExternalRightsHolders).toBe(0)
    expect(contributors.coAuthorTrailerCount).toBe(0)
    expect(contributors.additionalCommitterLabelsOnNonMergeCommits).toBe(0)
    expect(noticeManifest.thirdPartyStatus).toBe("MATERIALS_VERIFIED_FOR_REVIEWED_SCOPE")
    expect(noticeManifest.blockers).toEqual([])
    expect(noticeManifest.releaseBlockers).toEqual([])
    expect(noticeManifest.releaseEligible).toBe(true)
    expect(noticeManifest.releaseApproved).toBe(false)
    expect(noticeManifest.publicationAuthorized).toBe(false)
    expect(JSON.stringify(contributors)).not.toMatch(/[A-Za-z]:[\\/]|(?:gh[pousr]_)[A-Za-z0-9]{30,}/)
  })

  it("records the user-confirmed ChatGPT development identity without treating the tool as a rights holder", () => {
    const { outputs } = deriveProjectRightsQualification()
    const contributors = JSON.parse(
      outputs.get(projectRightsConstants.contributorRecord)!.toString("utf8"),
    )

    expect(contributors.developmentParticipantDeclaration).toEqual({
      source: "Direct user confirmation in the PR-5 R1 review response",
      statement: {
        original: "本项目有且仅有我本人以及chatgpt进行开发",
        normalizedEnglish: "The project was developed only by the user and ChatGPT.",
      },
      participants: [
        { label: "Aaron-AVC", role: "HUMAN_PROJECT_RIGHTS_HOLDER" },
        { label: "ChatGPT", role: "AI_ASSISTANT_TOOL", separateRightsHolder: false },
      ],
    })
    expect(contributors.integrationAuthorLabel).toMatchObject({
      label: "RH-02 Integration",
      confirmedIdentity: "ChatGPT AI assistant tool",
    })
    expect(contributors.integrationAuthorLabel.identityFinding)
      .toContain("user confirmed")
    expect(contributors.candidateContributionReview.authorizedToolIdentities)
      .toHaveLength(1)
    expect(contributors.candidateContributionReview.authorizedToolIdentities[0])
      .toMatchObject({ name: "RH-02 Integration" })
    expect(contributors.candidateContributionReview.authorizedToolIdentities[0].emailSha256)
      .toMatch(/^[a-f0-9]{64}$/)
    expect(contributors.rightsHolderDeclaration).toMatchObject({
      additionalJointOrContractContributors: "NONE_DECLARED",
      projectRightsHolderPublicAttribution: "Aaron-AVC",
    })
  })

  it("preserves and verifies the superseded v7 through v10 snapshots before deriving v11", () => {
    expect(projectRightsConstants.decision).toBe(
      "docs/licensing/evidence/R002-PR5/project-rights-decision-v11.json",
    )
    expect(() => deriveProjectRightsQualification()).not.toThrow()

    for (const version of [7, 8, 9, 10]) {
      const path = join(process.cwd(), `docs/licensing/evidence/R002-PR5/project-rights-decision-v${version}.json`)
      const original = readFileSync(path)
      try {
        writeFileSync(path, Buffer.concat([original, Buffer.from("\nTAMPERED\n")]))
        expect(() => deriveProjectRightsQualification())
          .toThrow(`Frozen PR-5 v${version} decision differs from its superseded snapshot`)
      } finally {
        writeFileSync(path, original)
      }
    }
  })

  it("verifies the recorded decision and rejects missing or altered rights inputs", () => {
    const verified = loadVerifiedProjectRightsState()
    expect(verifyProjectRightsQualification()).toEqual(verified.qualification)

    const decisionPath = projectRightsConstants.decision
    const decisionBytes = readFileSync(join(process.cwd(), decisionPath))
    unlinkSync(join(process.cwd(), decisionPath))
    try {
      expect(() => loadVerifiedProjectRightsState()).toThrow()
    } finally {
      writeFileSync(join(process.cwd(), decisionPath), decisionBytes, { flag: "wx" })
    }

    for (const path of [
      "LICENSE",
      "CONTRIBUTING.md",
      "licenses/LICENSE-SCOPE.md",
      projectRightsConstants.currentScope,
      projectRightsConstants.currentLedger,
    ]) {
      const fullPath = join(process.cwd(), path)
      const original = readFileSync(fullPath)
      try {
        writeFileSync(fullPath, Buffer.concat([original, Buffer.from("\nPR5-TEST-TAMPER\n")]))
        expect(() => loadVerifiedProjectRightsState()).toThrow()
      } finally {
        writeFileSync(fullPath, original)
      }
    }
  }, 75_000)
})
