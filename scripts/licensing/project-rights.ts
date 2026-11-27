import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import {
  deriveScope,
  noticeFiles,
} from "../distribution-notices"
import type { Inputs } from "../distribution-notices"
import { loadCandidate } from "./r002-b-candidate"

const ROOT = resolve(import.meta.dir, "../..")
const BASE_COMMIT = "de4bdcf811f93dab72bd748e314d59a414e1f251"
const BASE_TREE = "18f3adfe593c40f84a2303c32542d1a68f83b6a5"
const REVIEWED_CANDIDATE = "48ec9c5348d1fdc28796c91334e2d98c41617ac4"
const PROJECT_LICENSE_SHA256 = "2033de464f1eaee84272cf1283dfafe6f505ebae08a65ac929941352ab0409d5"
const LICENSE_SCOPE_SHA256 = "13427184d1ff51e46674e6e2fe382afb10cfc6852833ea1b28e682995788d06e"
const CONTRIBUTOR_TERMS_SHA256 = "63aaf70e6e2be3eda8b5cb8706de376f22840320c7e3251ee8b3a6a8849525e6"
const BUILD_EVIDENCE = "docs/licensing/evidence/R002-B/build/build-identity-v3.json"
const BUILD_EVIDENCE_SHA256 = "3d8a9d547cc506a5544e0f7a5a519803de549276191021ecfce88039b21c56c2"
const HISTORICAL_RIGHTS = "docs/licensing/evidence/R002-B/source-rights-v3.json"
const HISTORICAL_RIGHTS_SHA256 = "aed77e5c89bc36cb226648016f26b1693cfb97bf3f90408e8acf24757f15ad53"
const HISTORICAL_SCOPE = "docs/licensing/evidence/R002-B/distribution-scope-v3.json"
const HISTORICAL_LEDGER = "docs/licensing/evidence/R002-B/candidate-ledger.json"
const OUTPUT_ROOT = "docs/licensing/evidence/R002-PR5"
const RIGHTS_SUPPLEMENT = `${OUTPUT_ROOT}/project-rights-supplement-v11.json`
const CONTRIBUTOR_RECORD = `${OUTPUT_ROOT}/contributor-authority-v11.json`
const CURRENT_SCOPE = `${OUTPUT_ROOT}/current-scope-v11.json`
const CURRENT_LEDGER = `${OUTPUT_ROOT}/current-ledger-v11.json`
const NOTICE_ROOT = `${OUTPUT_ROOT}/notice-preview-v11`
const DECISION = `${OUTPUT_ROOT}/project-rights-decision-v11.json`
const SUPERSEDED_SNAPSHOTS = [
  {
    version: 7,
    decisionPath: `${OUTPUT_ROOT}/project-rights-decision-v7.json`,
    decisionSha256: "8f6b7bbe91e03fa74767e562f698bae3df5632412407612411399623ba63d55f",
  },
  {
    version: 8,
    decisionPath: `${OUTPUT_ROOT}/project-rights-decision-v8.json`,
    decisionSha256: "22302407917fe6c72aea485d236478ae3c49c69902281c07cfa381fb8be94128",
  },
  {
    version: 9,
    decisionPath: `${OUTPUT_ROOT}/project-rights-decision-v9.json`,
    decisionSha256: "698aca3ed9a278ca6a6c9e182936ff63081b755995666c2706457298e9df9156",
  },
  {
    version: 10,
    decisionPath: `${OUTPUT_ROOT}/project-rights-decision-v10.json`,
    decisionSha256: "f300d9767b5752c83e7d4bdfe62c24fe93d711785f45f9a4bf5c542fe83b40ea",
  },
]
const STATUS = "THIRD_PARTY_NOTICES_COMPLETE"
const CANDIDATE_STATUS = "PR6_REVIEW_REQUIRED"
const NOTICE_STATUS = "MATERIALS_VERIFIED_FOR_REVIEWED_SCOPE"
const EXPECTED_COMPONENT_COUNTS = { total: 84, included: 71, unknown: 13, excluded: 0, unknownNpm: 12 }
const INTEGRATION_COMMIT = "afc8fc01fbf12d1a154941a4fce2aa411f2f3e28"
const INTEGRATION_PATHS = [
  "src/features/analysis/lib/provider-response-body.test.ts",
  "src/features/analysis/lib/provider-response-body.ts",
  "src/features/history/lib/history-repository.test.ts",
  "src/features/history/lib/history-repository.ts",
  "src/lib/schemas/persistence-bounds.test.ts",
  "src/sidepanel/ask/ask-controller.test.ts",
  "src/sidepanel/ask/ask-controller.ts",
].sort()

const PR4_BASE_COMMIT = "b847cc99cf559a2af3a7552c4a8ab906f9c3ef26"
const PR4_PATHS = [
  "README.md",
  "docs/README.md",
  "docs/release-packaging.md",
  "docs/superpowers/plans/2026-11-26-vsa-r002-pr4-plan.md",
  "docs/superpowers/specs/2026-11-26-vsa-r002-pr4-design.md",
  "package.json",
  "scripts/lib/release-package.ts",
  "scripts/licensing/r002-b-build-inputs.test.ts",
  "scripts/licensing/r002-b-candidate.test.ts",
  "scripts/licensing/r002-b-candidate.ts",
  "scripts/release-package.test.ts",
  "scripts/release-package.ts",
].sort()

const PR5_SOURCE_PATHS = [
  ".gitattributes",
  ".github/pull_request_template.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "README.md",
  "README.zh-CN.md",
  "docs/README.md",
  "docs/licensing/README.md",
  "docs/licensing/license-guide.zh-CN.md",
  "docs/licensing/evidence/R002-PR5/VERSION-STATUS.md",
  "docs/release-packaging.md",
  "licenses/LICENSE-SCOPE.md",
  "package.json",
  "scripts/lib/release-package.ts",
  "scripts/licensing/r002-b-build-inputs.test.ts",
  "scripts/licensing/project-rights.test.ts",
  "scripts/licensing/project-rights-coverage.test.ts",
  "scripts/licensing/project-rights.ts",
  "scripts/licensing/r002-b-candidate.ts",
  "scripts/licensing/r002-pr5-record.ts",
  "scripts/release-package.test.ts",
  "scripts/release-package.ts",
].sort()

type Identity = { sha256: string, byteLength: number }
export type ProjectRightsQualification = {
  schema: "vsa-project-rights-qualification/v1"
  status: "QUALIFIED_FOR_LOCAL_CANDIDATE"
  decisionSha256: string
  licenseSha256: string
  licenseScopeSha256: string
  sourceRightsSha256: string
  contributorRecordSha256: string
  buildEvidenceSha256: string
  currentScopeSha256: string
  currentLedgerSha256: string
  noticeManifestSha256: string
  noticePayloadSetSha256: string
}

function requireCheck(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function identity(bytes: Uint8Array): Identity {
  return { sha256: sha256(bytes), byteLength: bytes.byteLength }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function render(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function read(path: string): Buffer {
  return readFileSync(join(ROOT, path))
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd()
}

function gitPathList(...args: string[]): string[] {
  const output = execFileSync("git", args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] })
  return output.toString("utf8").split("\0").filter(Boolean)
}

function isVersionedPr5OutputPath(path: string): boolean {
  return /^docs\/licensing\/evidence\/R002-PR5\/(?:project-rights-(?:supplement|decision)-v[1-9]\.json|contributor-authority-v[1-9]\.json|current-(?:scope|ledger)-v[1-9]\.json|notice-preview-v[1-9]\/(?:THIRD_PARTY_NOTICES\.md|THIRD_PARTY\/(?:manifest\.json|SHA256SUMS\.txt|LICENSES\/[a-f0-9]{64}\/LICENSE|NOTICES\/[a-f0-9]{64}\/NOTICE)))$/.test(path)
}

const REVIEWED_GENERATED_OUTPUT_PATHS = new Set(
  gitPathList("diff", "--no-renames", "--name-only", "-z", BASE_COMMIT, REVIEWED_CANDIDATE, "--")
    .filter(isVersionedPr5OutputPath),
)

function supersededOutputIdentities(
  version: number,
  decisionPath: string,
  expectedDecisionSha256: string,
): Map<string, Identity> {
  const decisionBytes = read(decisionPath)
  requireCheck(sha256(decisionBytes) === expectedDecisionSha256,
    `Frozen PR-5 v${version} decision differs from its superseded snapshot`)
  const decision = JSON.parse(decisionBytes.toString("utf8"))
  const identities = new Map<string, Identity>([
    [decisionPath, identity(decisionBytes)],
    [decision.sourceRights.pr4Pr5Supplement.path, {
      sha256: decision.sourceRights.pr4Pr5Supplement.sha256,
      byteLength: read(decision.sourceRights.pr4Pr5Supplement.path).byteLength,
    }],
    [decision.contributionAuthority.recordPath, {
      sha256: decision.contributionAuthority.recordSha256,
      byteLength: read(decision.contributionAuthority.recordPath).byteLength,
    }],
    [decision.thirdPartyDistribution.currentScope.path, {
      sha256: decision.thirdPartyDistribution.currentScope.sha256,
      byteLength: read(decision.thirdPartyDistribution.currentScope.path).byteLength,
    }],
    [decision.thirdPartyDistribution.currentLedger.path, {
      sha256: decision.thirdPartyDistribution.currentLedger.sha256,
      byteLength: read(decision.thirdPartyDistribution.currentLedger.path).byteLength,
    }],
  ])
  const noticeRoot = `${OUTPUT_ROOT}/notice-preview-v${version}`
  for (const item of decision.thirdPartyDistribution.noticePreview.payloadIdentities as Array<{
    path: string
    sha256: string
    byteLength: number
  }>) {
    identities.set(`${noticeRoot}/${item.path}`, { sha256: item.sha256, byteLength: item.byteLength })
  }
  requireCheck(identities.size === 36, `Expected 36 frozen v${version} outputs, found ${identities.size}`)

  const actualNotices = new Set<string>()
  const visit = (directory: string, prefix: string) => {
    for (const entry of readdirSync(join(ROOT, directory), { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`
      requireCheck(!entry.isSymbolicLink(), `Frozen v${version} snapshot contains a symbolic link: ${path}`)
      if (entry.isDirectory()) visit(`${directory}/${entry.name}`, `${path}/`)
      else actualNotices.add(`${noticeRoot}/${path}`)
    }
  }
  visit(noticeRoot, "")
  const expectedNotices = [...identities.keys()].filter(path => path.startsWith(`${noticeRoot}/`))
  requireCheck(stable([...actualNotices].sort()) === stable(expectedNotices.sort()),
    `Frozen PR-5 v${version} snapshot has missing or unexpected files`)
  for (const [path, expected] of identities) {
    const bytes = read(path)
    requireCheck(bytes.byteLength === expected.byteLength && sha256(bytes) === expected.sha256,
      `Frozen PR-5 v${version} snapshot changed: ${path}`)
  }
  return identities
}

function gitPathListAt(repository: string, ...args: string[]): string[] {
  const output = execFileSync("git", args, { cwd: repository, stdio: ["ignore", "pipe", "pipe"] })
  return output.toString("utf8").split("\0").filter(Boolean)
}

export function currentContributionChangePaths(repository = ROOT, baseline = BASE_COMMIT): string[] {
  const tracked = gitPathListAt(repository, "diff", "--no-renames", "--name-only", "-z", baseline, "--")
  const indexed = gitPathListAt(repository, "diff", "--cached", "--no-renames", "--name-only", "-z", baseline, "--")
  const untracked = gitPathListAt(repository, "ls-files", "--others", "--exclude-standard", "-z")
  const commits = execFileSync("git", ["log", "--format=%H", `${baseline}..HEAD`], {
    cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).split(/\r?\n/).filter(Boolean)
  const committed = commits.flatMap(commit =>
    gitPathListAt(repository, "diff-tree", "--root", "--no-commit-id", "--name-only", "-z", "-r", "-m", "--no-renames", commit, "--"),
  )
  return [...new Set([...tracked, ...indexed, ...untracked, ...committed])].sort()
}

function sourceChangePaths(): string[] {
  return currentContributionChangePaths()
}

function pathsChangedSinceReviewedCandidate(): Set<string> {
  const worktree = gitPathList("diff", "--no-renames", "--name-only", "-z", REVIEWED_CANDIDATE, "--")
  const index = gitPathList("diff", "--cached", "--no-renames", "--name-only", "-z", REVIEWED_CANDIDATE, "--")
  return new Set([...worktree, ...index])
}

function assertCurrentContributionCoverage(
  generatedPaths: Set<string>,
  supersededOutputs: Map<string, Identity>,
): void {
  const classifiedPaths = new Set([...PR4_PATHS, ...PR5_SOURCE_PATHS])
  const changedSinceReviewed = pathsChangedSinceReviewedCandidate()
  const unclassified = sourceChangePaths().filter(path => {
    if (classifiedPaths.has(path) || generatedPaths.has(path)) return false
    if (supersededOutputs.has(path)) return false
    if (!REVIEWED_GENERATED_OUTPUT_PATHS.has(path)) return true
    requireCheck(!changedSinceReviewed.has(path), `Frozen PR-5 historical evidence changed: ${path}`)
    return false
  })
  requireCheck(unclassified.length === 0,
    `Unclassified contribution path: ${unclassified[0] ?? "unknown path"}`)
}

function currentContributionIdentityReview() {
  const reviewedHumanAuthors = new Set(git("log", `${BASE_COMMIT}..${REVIEWED_CANDIDATE}`, "--format=%an%x09%ae")
    .split(/\r?\n/).filter(Boolean))
  requireCheck(reviewedHumanAuthors.size > 0, "Reviewed PR-5 candidate has no attributable authors")
  const [toolLabel, toolEmail] = git("show", "-s", "--format=%an%x09%ae", INTEGRATION_COMMIT).split("\t")
  requireCheck(toolLabel === "RH-02 Integration" && Boolean(toolEmail),
    "Confirmed ChatGPT tool author identity changed")
  const authorizedToolAuthors = new Set([`${toolLabel}\t${toolEmail}`])
  const authorizedAuthors = new Set([...reviewedHumanAuthors, ...authorizedToolAuthors])

  const mergeCommitters = new Set(git("log", BASE_COMMIT, "--format=%an%x09%ae%x09%cn%x09%ce%x09%P")
    .split(/\r?\n/).filter(Boolean).flatMap(line => {
      const [authorName, authorEmail, committerName, committerEmail, parents = ""] = line.split("\t")
      const parentCount = parents.trim().split(/\s+/).filter(Boolean).length
      return parentCount > 1 && `${authorName}\t${authorEmail}` !== `${committerName}\t${committerEmail}`
        ? [`${committerName}\t${committerEmail}`]
        : []
    }))
  const commits = git("log", `${BASE_COMMIT}..HEAD`, "--format=%H%x09%an%x09%ae%x09%cn%x09%ce%x09%P")
    .split(/\r?\n/).filter(Boolean)
  const authorRows = new Set<string>()
  const coAuthorRows = new Set<string>()
  const unconfirmed: string[] = []

  for (const commit of commits) {
    const [hash, authorName, authorEmail, committerName, committerEmail, parents = ""] = commit.split("\t")
    const author = `${authorName}\t${authorEmail}`
    const committer = `${committerName}\t${committerEmail}`
    if (!authorizedAuthors.has(author)) unconfirmed.push(authorName ?? "unknown author")
    authorRows.add(author)
    if (committer !== author) {
      const isMerge = parents.trim().split(/\s+/).filter(Boolean).length > 1
      if (!isMerge || !mergeCommitters.has(committer)) unconfirmed.push(committerName ?? "unknown committer")
    }

    if (hash) {
      const message = git("show", "-s", "--format=%B", hash)
      for (const match of message.matchAll(/^Co-authored-by:\s*(.*?)\s*<([^>]+)>\s*$/gim)) {
        const identity = `${match[1]}\t${match[2]}`
        if (!authorizedAuthors.has(identity)) unconfirmed.push(match[1]!)
        coAuthorRows.add(identity)
      }
    }
  }

  const privateIdentity = (row: string) => {
    const [name, email] = row.split("\t")
    return { name, emailSha256: sha256(Buffer.from(email ?? "", "utf8")) }
  }
  return {
    reviewedBaseline: REVIEWED_CANDIDATE,
    authorizedAuthorIdentities: [...reviewedHumanAuthors].sort().map(privateIdentity),
    authorizedToolIdentities: [...authorizedToolAuthors].sort().map(privateIdentity),
    observedAuthorIdentities: [...authorRows].sort().map(privateIdentity),
    coAuthorIdentities: [...coAuthorRows].sort().map(privateIdentity),
    unconfirmedIdentityLabels: [...new Set(unconfirmed)].sort(),
  }
}

function historyRecord() {
  const historyRows = git("log", BASE_COMMIT, "--format=%an%x09%cn%x09%P")
    .split(/\r?\n/).filter(Boolean).map(line => {
      const [author, committer, parentList] = line.split("\t")
      const parents = parentList?.trim().split(/\s+/).filter(Boolean) ?? []
      return { author: author!, committer: committer!, parentCount: parents.length }
    })
  const authorNames = historyRows.map(row => row.author)
  const authorCounts = [...authorNames.reduce((counts, name) => counts.set(name, (counts.get(name) ?? 0) + 1), new Map<string, number>()).values()]
    .sort((left, right) => right - left)
  requireCheck(stable(authorCounts) === stable([116, 70, 8, 1]) && new Set(authorNames).size === 4,
    "Git author history differs from the rights-holder-confirmed author groups")

  const committerNames = new Set(historyRows.map(row => row.committer))
  const authorSet = new Set(authorNames)
  const additionalCommitterLabels = [...committerNames].filter(name => !authorSet.has(name))
  const additionalCommitterLabelsOnNonMergeCommits = additionalCommitterLabels.filter(name =>
    historyRows.some(row => row.committer === name && row.parentCount < 2))
  const messages = git("log", BASE_COMMIT, "--format=%B")
  const coAuthorCount = (messages.match(/^Co-authored-by:/gim) ?? []).length
  const integrationAuthor = git("show", "-s", "--format=%an", INTEGRATION_COMMIT)
  const integrationPaths = git("diff-tree", "--no-commit-id", "--name-only", "-r", INTEGRATION_COMMIT)
    .split(/\r?\n/).filter(Boolean).sort()
  requireCheck(integrationAuthor === "RH-02 Integration", "Recorded integration commit author label changed")
  requireCheck(stable(integrationPaths) === stable(INTEGRATION_PATHS), "Recorded integration commit path set changed")
  requireCheck(coAuthorCount === 0, "Unexpected Co-authored-by trailer in the fixed project history")
  requireCheck(committerNames.size === 5 && additionalCommitterLabels.length === 1
    && additionalCommitterLabelsOnNonMergeCommits.length === 0,
  "Git contains a committer identity outside the author set on a non-merge commit")
  const candidateContributionReview = currentContributionIdentityReview()

  return {
    source: "git history reachable from the fixed PR-5 main commit",
    baseCommit: BASE_COMMIT,
    baseTree: BASE_TREE,
    distinctGitAuthorLabelCount: authorCounts.length,
    rightsHolderOrToolAuthorCommitCounts: authorCounts.slice(0, 3),
    integrationAuthorLabel: {
      label: "RH-02 Integration",
      commit: INTEGRATION_COMMIT,
      commitCount: authorCounts[3],
      confirmedIdentity: "ChatGPT AI assistant tool",
      identityFinding: "The user confirmed this Git author label represents the ChatGPT AI assistant tool, not a separate human rights holder.",
      changedPaths: integrationPaths,
    },
    distinctGitCommitterLabelCount: committerNames.size,
    additionalNonAuthorCommitterLabelCount: additionalCommitterLabels.length,
    additionalCommitterLabelsOnNonMergeCommits: additionalCommitterLabelsOnNonMergeCommits.length,
    committerAssessment: "The additional committer label occurs only on merge commits and is not treated as a project rights holder.",
    coAuthorTrailerCount: coAuthorCount,
    candidateContributionReview,
    developmentParticipantDeclaration: {
      source: "Direct user confirmation in the PR-5 R1 review response",
      statement: {
        original: "本项目有且仅有我本人以及chatgpt进行开发",
        normalizedEnglish: "The project was developed only by the user and ChatGPT.",
      },
      participants: [
        { label: "Aaron-AVC", role: "HUMAN_PROJECT_RIGHTS_HOLDER" },
        { label: "ChatGPT", role: "AI_ASSISTANT_TOOL", separateRightsHolder: false },
      ],
    },
    rightsHolderDeclaration: {
      source: "User-confirmed VSA-R002-PR5 task authorization",
      additionalJointOrContractContributors: "NONE_DECLARED",
      projectRightsHolderPublicAttribution: "Aaron-AVC",
      scope: "Only project-owned or otherwise authorized portions; third-party rights remain separate.",
      digitalSignature: "NOT_REPRESENTED",
    },
    assessment: "The owner declaration covers project contributions; Git author and committer labels are evidence, not independent proof of legal ownership.",
    futureContributions: {
      termsPath: "CONTRIBUTING.md",
      termsVersion: "1.0",
      affirmativePullRequestConfirmationRequired: true,
      ordinaryIssuesAndDiscussionAutomaticallyLicensed: false,
    },
    unresolvedExternalRightsHolders: 0,
    reviewNote: "If later evidence identifies an external author or contractual claim, pause qualification for the affected material and reassess.",
  }
}

function sourceCategory(path: string): string {
  if (path === "LICENSE" || path === "CONTRIBUTING.md") return "RIGHTSHOLDER_SUPPLIED_FIXED_TERMS"
  if (path.startsWith("docs/licensing/evidence/") || path.startsWith("docs/superpowers/")) return "PROJECT_AUDIT_OR_ENGINEERING_RECORD"
  if (path.endsWith(".test.ts")) return "PROJECT_TEST_CODE_AI_ASSISTED"
  if (path.startsWith("scripts/")) return "PROJECT_PACKAGING_OR_QUALIFICATION_CODE_AI_ASSISTED"
  if (path === "package.json" || path === ".gitattributes") return "PROJECT_CONFIGURATION"
  if (path.startsWith("README") || path.startsWith("docs/") || path.startsWith("licenses/")) return "PROJECT_DOCUMENTATION_AI_ASSISTED"
  if (path.startsWith(".github/")) return "PROJECT_CONTRIBUTION_PROCESS"
  return "PROJECT_ADDITION_WITH_OWNER_DECLARATION"
}

function createRightsSupplement() {
  const reviewWindows = new Map<string, Set<string>>()
  const addPaths = (paths: string[], reviewWindow: string) => {
    for (const path of paths) {
      const windows = reviewWindows.get(path) ?? new Set<string>()
      windows.add(reviewWindow)
      reviewWindows.set(path, windows)
    }
  }
  addPaths(PR4_PATHS, "PR-4 merged changes")
  addPaths(PR5_SOURCE_PATHS, "PR-5 candidate changes")
  const files = [...reviewWindows].map(([path, windows]) => ({
    path,
    reviewWindow: [...windows].join("; "),
    classification: sourceCategory(path),
  })).sort((left, right) => left.path.localeCompare(right.path))
  const paths = new Set<string>()
  const entries = files.map(file => {
    requireCheck(!paths.has(file.path), `Duplicate rights-supplement path: ${file.path}`)
    paths.add(file.path)
    const bytes = read(file.path)
    return {
      ...file,
      ...identity(bytes),
      rightsBasis: file.classification === "RIGHTSHOLDER_SUPPLIED_FIXED_TERMS"
        ? "Fixed text supplied in the rights-holder-authorized PR-5 task."
        : "Rights-holder declaration and the path-specific historical or current record; not an independent authorship finding.",
      aiAssistance: file.classification === "RIGHTSHOLDER_SUPPLIED_FIXED_TERMS"
        ? "The fixed terms were supplied by the rights holder."
        : "AI-assisted project work under the rights holder's direction.",
      exclusivityClaim: "No exclusive copyright claim is inferred from AI assistance or a path being new.",
    }
  })

  return {
    schema: "vsa-project-rights-supplement/v1",
    fixedMain: { commit: BASE_COMMIT, tree: BASE_TREE },
    inheritedInventory: {
      path: HISTORICAL_RIGHTS,
      sha256: HISTORICAL_RIGHTS_SHA256,
      pathCount: 172,
      status: "HISTORICAL_INPUT_PRESERVED",
    },
    scopeLimit: "This supplement covers the listed PR-4 and PR-5 evidence delta; it is not a complete inventory of every repository file.",
    classificationMethod: "File-level source, function, license and development-history categories are kept distinct; a new path or AI-assisted process alone does not prove exclusive authorship.",
    aiAssistance: {
      tool: "OpenAI Codex desktop session",
      externalAssetsUsedForThisChange: false,
      generatedExpressionOwnership: "No exclusive copyright claim is made solely because a tool generated or assisted with text or code.",
    },
    entries,
  }
}

function updateCurrentInputs(candidate: ReturnType<typeof loadCandidate>, supplementSha256: string, contributorSha256: string) {
  let matched = 0
  const components = candidate.inputs.ledger.components.map(component => {
    if (component.componentId !== "source:new-project-files") return component
    matched += 1
    return {
      ...component,
      sourceClassification: "RIGHTSHOLDER_DECLARATION_FOR_PROJECT_OWNED_PORTIONS",
      sourceScope: "VSA-CL 1.0 applies only to the project-owned or authorized portions identified by the fixed 172-path inventory and PR-5 supplement.",
      license: {
        ...component.license,
        declared: "VSA-CL 1.0 — project-owned or authorized portions only",
        evidenceStatus: "RIGHTSHOLDER_DECLARATION_AND_SCOPE_RECORDED",
        scope: "Project rights and third-party rights are separate; see the current PR-5 decision and scope records.",
        unresolvedIssue: null,
      },
      sourceEvidence: [
        ...component.sourceEvidence,
        { path: RIGHTS_SUPPLEMENT, sha256: supplementSha256 },
        { path: CONTRIBUTOR_RECORD, sha256: contributorSha256 },
      ],
    }
  })
  requireCheck(matched === 1, "Expected exactly one project-rights aggregate component")
  const inputs: Inputs = { ...candidate.inputs, ledger: { ...candidate.inputs.ledger, components } }
  return inputs
}

function buildCurrentThirdPartyState(supplementSha256: string, contributorSha256: string) {
  const candidate = loadCandidate()
  const inputs = updateCurrentInputs(candidate, supplementSha256, contributorSha256)
  const derivedScope = deriveScope(inputs)
  const scope = {
    ...derivedScope,
    schema: "vsa-r002-pr5-distribution-scope/v1",
    inheritedScope: {
      path: HISTORICAL_SCOPE,
      sha256: sha256(read(HISTORICAL_SCOPE)),
      schema: "vsa-r002-b-distribution-scope/v3",
    },
    projectRights: {
      status: "OWNER_DECLARATION_RECORDED",
      actualBundleMembership: "UNKNOWN",
      sourceRightsSupplement: { path: RIGHTS_SUPPLEMENT, sha256: supplementSha256 },
      contributorAuthority: { path: CONTRIBUTOR_RECORD, sha256: contributorSha256 },
    },
  }
  const ledger = {
    ...candidate.ledger,
    schema: "vsa-r002-pr5-candidate-ledger/v1",
    base: BASE_COMMIT,
    inheritedLedger: {
      path: HISTORICAL_LEDGER,
      sha256: sha256(read(HISTORICAL_LEDGER)),
    },
    blockerDisposition: {
      ...candidate.ledger.blockerDisposition,
      "B-01": "RESOLVED_FOR_CANDIDATE",
      "B-02": "RESOLVED_REPLACED",
      "B-03": "NOTICE_OBLIGATION_SATISFIED_FOR_REVIEWED_TEMPLATES; HISTORICAL_CLI_REVISION_UNKNOWN",
      "B-04": "RESOLVED_FOR_LOCAL_CANDIDATE_BY_RIGHTSHOLDER_DECLARATION",
    },
    projectRights: {
      status: "OWNER_DECLARATION_RECORDED",
      historicalInventory: { path: HISTORICAL_RIGHTS, sha256: HISTORICAL_RIGHTS_SHA256, pathCount: 172 },
      supplement: { path: RIGHTS_SUPPLEMENT, sha256: supplementSha256 },
      contributorAuthority: { path: CONTRIBUTOR_RECORD, sha256: contributorSha256 },
      grantScope: "Only material the rights holder owns or is authorized to license.",
    },
  }

  const initialNoticePlan = noticeFiles(inputs, scope, true)
  requireCheck(initialNoticePlan.blockers.length === 0, "Third-party notice materials have unresolved blockers")
  requireCheck(initialNoticePlan.releaseBlockers.length === 0, "Project-rights review remains blocked")
  requireCheck(initialNoticePlan.status === "THIRD_PARTY_NOTICES_COMPLETE_RELEASE_HOLD",
    "Unexpected historical third-party notice status")
  const noticeOutput = createCurrentNoticeOutput(initialNoticePlan.files)
  const counts = countScopeRows(scope.components)
  requireCheck(counts.total === EXPECTED_COMPONENT_COUNTS.total
    && counts.included === EXPECTED_COMPONENT_COUNTS.included
    && counts.unknown === EXPECTED_COMPONENT_COUNTS.unknown
    && counts.excluded === EXPECTED_COMPONENT_COUNTS.excluded
    && counts.unknownNpm === EXPECTED_COMPONENT_COUNTS.unknownNpm,
  "Current scope counts differ from the reviewed R002-B package closure")
  return { candidate, inputs, scope, ledger, noticeOutput, counts }
}

function countScopeRows(components: Array<{ membership: string, id: string }>) {
  return {
    total: components.length,
    included: components.filter(row => row.membership === "CONFIRMED_INCLUDED").length,
    unknown: components.filter(row => row.membership === "UNKNOWN").length,
    excluded: components.filter(row => row.membership === "CONFIRMED_EXCLUDED").length,
    unknownNpm: components.filter(row => row.membership === "UNKNOWN" && row.id.startsWith("npm:")).length,
  }
}

function createCurrentNoticeOutput(sourceFiles: Map<string, Buffer>): Map<string, Buffer> {
  const files = new Map(sourceFiles)
  const manifestBytes = files.get("THIRD_PARTY/manifest.json")
  const markdownBytes = files.get("THIRD_PARTY_NOTICES.md")
  requireCheck(manifestBytes && markdownBytes, "Generated third-party notice manifest or document is missing")
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as Record<string, unknown>
  requireCheck(Array.isArray(manifest.blockers) && manifest.blockers.length === 0
    && Array.isArray(manifest.releaseBlockers) && manifest.releaseBlockers.length === 0,
  "Notice output still carries third-party or project-rights blockers")
  requireCheck(manifest.thirdPartyStatus === NOTICE_STATUS, "Third-party notice materials are not verified")
  files.set("THIRD_PARTY/manifest.json", render({
    ...manifest,
    status: STATUS,
    releaseStatus: CANDIDATE_STATUS,
    releaseEligible: true,
    releaseApproved: false,
    finalReleaseReview: "PENDING",
    publicationAuthorized: false,
  }))
  const markdown = markdownBytes.toString("utf8")
  requireCheck(markdown.includes("THIRD_PARTY_NOTICES_COMPLETE_RELEASE_HOLD"),
    "Historical notice status marker was not found in the newly derived output")
  files.set("THIRD_PARTY_NOTICES.md", Buffer.from(markdown
    .replace("THIRD_PARTY_NOTICES_COMPLETE_RELEASE_HOLD", STATUS)
    .replace(
      `**${STATUS} — third-party notice candidate only.**`,
      `**${STATUS} — third-party notice materials are complete for this reviewed scope.**`,
    )
    .replace(
      "\n## Open third-party notice items in the reviewed scope\n",
      "\nProject-rights qualification is recorded for this local candidate. Final PR-6 review is pending; publication is not authorized.\n\n## Open third-party notice items in the reviewed scope\n",
    ), "utf8"))
  const sums = [...files.keys()].filter(path => path !== "THIRD_PARTY/SHA256SUMS.txt").sort()
    .map(path => `${sha256(files.get(path)!)}  ${path}\n`).join("")
  files.set("THIRD_PARTY/SHA256SUMS.txt", Buffer.from(sums, "utf8"))
  requireCheck(files.size === 31, `Expected 31 current notice files, found ${files.size}`)
  return files
}

function createDecision(
  supplementBytes: Buffer,
  contributorBytes: Buffer,
  scopeBytes: Buffer,
  ledgerBytes: Buffer,
  noticeFiles: Map<string, Buffer>,
  counts: ReturnType<typeof countScopeRows>,
) {
  const manifest = noticeFiles.get("THIRD_PARTY/manifest.json")!
  const noticeIdentities = [...noticeFiles].sort(([left], [right]) => left.localeCompare(right))
    .map(([path, bytes]) => ({ path, ...identity(bytes) }))
  return {
    schema: "vsa-project-rights-decision/v1",
    decisionId: "VSA-R002-PR5-2026-11-27-v11",
    status: "QUALIFIED_FOR_LOCAL_CANDIDATE",
    decisionSource: {
      kind: "RIGHTSHOLDER_DECLARATION_AND_REVIEWED_PROJECT_RECORD",
      source: "User-confirmed VSA-R002-PR5 task authorization",
      date: "2026-11-27",
      digitalSignature: "NOT_REPRESENTED",
      independentLegalReview: "NOT_CLAIMED",
    },
    rightsHolder: {
      publicAttribution: "Aaron-AVC",
      authorityStatement: "The user confirmed they and ChatGPT were the only development participants; ChatGPT is recorded as an AI assistant tool, not a separate human rights holder. The rights holder confirmed authority over project-owned contributions and no additional joint, employer, client, or separately disposed project rights requiring another grant.",
      scopeLimit: "Only portions the rights holder owns or is authorized to license; separate third-party rights remain unaffected.",
      commercialAuthorizationContact: "Project GitHub Issues; a request is not itself authorization.",
    },
    projectLicense: {
      version: "1.0",
      path: "LICENSE",
      sha256: sha256(read("LICENSE")),
      packageMetadata: "SEE LICENSE IN LICENSE",
      packagePrivate: true,
    },
    licenseScope: {
      path: "licenses/LICENSE-SCOPE.md",
      sha256: sha256(read("licenses/LICENSE-SCOPE.md")),
    },
    sourceRights: {
      historicalInventory: {
        path: HISTORICAL_RIGHTS,
        sha256: HISTORICAL_RIGHTS_SHA256,
        pathCount: 172,
        status: "HISTORICAL_SNAPSHOT_PRESERVED",
      },
      pr4Pr5Supplement: {
        path: RIGHTS_SUPPLEMENT,
        sha256: sha256(supplementBytes),
      },
    },
    contributionAuthority: {
      termsPath: "CONTRIBUTING.md",
      termsVersion: "1.0",
      termsSha256: sha256(read("CONTRIBUTING.md")),
      recordPath: CONTRIBUTOR_RECORD,
      recordSha256: sha256(contributorBytes),
      unresolvedExternalRightsHolders: 0,
    },
    productionBuild: {
      path: BUILD_EVIDENCE,
      sha256: BUILD_EVIDENCE_SHA256,
      sourceCommit: "7eda9fdbe0cd414c16a755f0b5da390c0fd37a57",
      sourceTree: "cfec44a94ee5a2053a361b7a3087373562378ec5",
      productFileCount: 14,
      changedProductInputs: false,
      qualification: "Exact historical 14-file identity is checked against the build output before packaging.",
    },
    thirdPartyDistribution: {
      status: NOTICE_STATUS,
      blockers: 0,
      historicalScope: { path: HISTORICAL_SCOPE, sha256: sha256(read(HISTORICAL_SCOPE)) },
      historicalLedger: { path: HISTORICAL_LEDGER, sha256: sha256(read(HISTORICAL_LEDGER)) },
      currentScope: { path: CURRENT_SCOPE, sha256: sha256(scopeBytes) },
      currentLedger: { path: CURRENT_LEDGER, sha256: sha256(ledgerBytes) },
      componentMembershipCounts: counts,
      unknownNpmComponentsRemainInNotice: true,
      noticePreview: {
        directory: NOTICE_ROOT,
        fileCount: noticeIdentities.length,
        manifestSha256: sha256(manifest),
        payloadIdentities: noticeIdentities,
      },
    },
    projectRightDisposition: {
      status: "RESOLVED_FOR_LOCAL_CANDIDATE",
      historicalPathMembership: "NOT_CHANGED_BY_THIS_DECISION",
      aiAssistedExpression: "No exclusive copyright claim is inferred solely from AI assistance.",
      unresolvedBlockingItems: [],
    },
    qualification: {
      packageType: "RELEASE_CANDIDATE",
      releaseEligible: true,
      releaseStatus: CANDIDATE_STATUS,
      releaseApproved: false,
      finalReleaseReview: "PENDING",
      publicationAuthorized: false,
      nextStage: "PR-6 final release review",
    },
  }
}

function deriveOutputs() {
  const supersededOutputs = new Map<string, Identity>()
  for (const snapshot of SUPERSEDED_SNAPSHOTS) {
    for (const [path, fileIdentity] of supersededOutputIdentities(
      snapshot.version,
      snapshot.decisionPath,
      snapshot.decisionSha256,
    )) supersededOutputs.set(path, fileIdentity)
  }
  requireCheck(sha256(read(BUILD_EVIDENCE)) === BUILD_EVIDENCE_SHA256,
    "Fixed production build evidence hash differs")
  requireCheck(sha256(read(HISTORICAL_RIGHTS)) === HISTORICAL_RIGHTS_SHA256,
    "Fixed historical source-rights record hash differs")
  requireCheck(sha256(read("LICENSE")) === PROJECT_LICENSE_SHA256,
    "Fixed VSA-CL 1.0 text differs from the rights-holder-authorized terms")
  requireCheck(sha256(read("licenses/LICENSE-SCOPE.md")) === LICENSE_SCOPE_SHA256,
    "Fixed mixed-license scope differs from the reviewed PR-5 scope")
  requireCheck(sha256(read("CONTRIBUTING.md")) === CONTRIBUTOR_TERMS_SHA256,
    "Fixed contribution terms differ from the rights-holder-authorized text")
  const packageJson = JSON.parse(read("package.json").toString("utf8")) as { license?: string, private?: boolean }
  requireCheck(packageJson.license === "SEE LICENSE IN LICENSE" && packageJson.private === true,
    "Project license metadata or private package setting differs")

  const supplementBytes = render(createRightsSupplement())
  const contributorBytes = render(historyRecord())
  const current = buildCurrentThirdPartyState(sha256(supplementBytes), sha256(contributorBytes))
  const scopeBytes = render(current.scope)
  const ledgerBytes = render(current.ledger)
  const decisionBytes = render(createDecision(
    supplementBytes,
    contributorBytes,
    scopeBytes,
    ledgerBytes,
    current.noticeOutput,
    current.counts,
  ))

  const outputs = new Map<string, Buffer>([
    [RIGHTS_SUPPLEMENT, supplementBytes],
    [CONTRIBUTOR_RECORD, contributorBytes],
    [CURRENT_SCOPE, scopeBytes],
    [CURRENT_LEDGER, ledgerBytes],
    [DECISION, decisionBytes],
  ])
  for (const [path, bytes] of current.noticeOutput) outputs.set(`${NOTICE_ROOT}/${path}`, bytes)
  assertCurrentContributionCoverage(new Set(outputs.keys()), supersededOutputs)
  const candidateReview = JSON.parse(contributorBytes.toString("utf8"))
    .candidateContributionReview as { unconfirmedIdentityLabels: string[] }
  requireCheck(candidateReview.unconfirmedIdentityLabels.length === 0,
    `Unconfirmed contribution identity: ${candidateReview.unconfirmedIdentityLabels[0]}`)
  return { outputs, current, decision: JSON.parse(decisionBytes.toString("utf8")) as Record<string, any> }
}

function assertRecordedOutputs(outputs: Map<string, Buffer>): void {
  for (const [path, expected] of outputs) {
    const actual = read(path)
    requireCheck(actual.equals(expected), `PR-5 current evidence differs from its fixed inputs: ${path}`)
  }
  const expectedNoticeFiles = new Set([...outputs.keys()].filter(path => path.startsWith(`${NOTICE_ROOT}/`)))
  const actualNoticeFiles = new Set<string>()
  const visit = (dir: string, prefix: string) => {
    for (const item of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const path = `${prefix}${item.name}`
      requireCheck(!item.isSymbolicLink(), `Notice preview contains a symbolic link: ${path}`)
      if (item.isDirectory()) visit(`${dir}/${item.name}`, `${path}/`)
      else actualNoticeFiles.add(`${NOTICE_ROOT}/${path}`)
    }
  }
  visit(NOTICE_ROOT, "")
  requireCheck(stable([...actualNoticeFiles].sort()) === stable([...expectedNoticeFiles].sort()),
    "Current notice preview contains missing or unexpected files")
}

export function deriveProjectRightsQualification(): {
  outputs: Map<string, Buffer>
  qualification: ProjectRightsQualification
  counts: ReturnType<typeof countScopeRows>
  noticeFiles: Map<string, Buffer>
  scope: Record<string, unknown>
  ledger: Record<string, unknown>
} {
  const { outputs, current, decision } = deriveOutputs()
  const decisionBytes = outputs.get(DECISION)!
  const qualification: ProjectRightsQualification = {
    schema: "vsa-project-rights-qualification/v1",
    status: "QUALIFIED_FOR_LOCAL_CANDIDATE",
    decisionSha256: sha256(decisionBytes),
    licenseSha256: decision.projectLicense.sha256,
    licenseScopeSha256: decision.licenseScope.sha256,
    sourceRightsSha256: decision.sourceRights.pr4Pr5Supplement.sha256,
    contributorRecordSha256: decision.contributionAuthority.recordSha256,
    buildEvidenceSha256: BUILD_EVIDENCE_SHA256,
    currentScopeSha256: decision.thirdPartyDistribution.currentScope.sha256,
    currentLedgerSha256: decision.thirdPartyDistribution.currentLedger.sha256,
    noticeManifestSha256: decision.thirdPartyDistribution.noticePreview.manifestSha256,
    noticePayloadSetSha256: sha256(Buffer.from(stable(decision.thirdPartyDistribution.noticePreview.payloadIdentities), "utf8")),
  }
  return {
    outputs,
    qualification,
    counts: current.counts,
    noticeFiles: current.noticeOutput,
    scope: current.scope,
    ledger: current.ledger,
  }
}

export function loadVerifiedProjectRightsState() {
  const { outputs, qualification, counts, noticeFiles, scope, ledger } = deriveProjectRightsQualification()
  assertRecordedOutputs(outputs)
  requireCheck(stable(JSON.parse(read(DECISION).toString("utf8"))) === stable(JSON.parse(outputs.get(DECISION)!.toString("utf8"))),
    "Project-rights decision does not match the fixed rights declaration and current evidence")
  return { qualification, counts, noticeFiles, scope, ledger }
}

export function verifyProjectRightsQualification(expected?: ProjectRightsQualification): ProjectRightsQualification {
  const { qualification } = loadVerifiedProjectRightsState()
  if (expected) {
    requireCheck(stable(expected) === stable(qualification),
      "Caller-supplied qualification does not match the verified repository decision")
  }
  return qualification
}

export function recordProjectRightsEvidence(): ReturnType<typeof deriveProjectRightsQualification> {
  const { outputs, qualification, counts } = deriveProjectRightsQualification()
  for (const [path, bytes] of outputs) {
    const fullPath = join(ROOT, path)
    mkdirSync(dirname(fullPath), { recursive: true })
    if (existsSync(fullPath)) {
      const actual = readFileSync(fullPath)
      requireCheck(actual.equals(bytes), `Refusing to overwrite existing PR-5 evidence: ${path}`)
    } else {
      writeFileSync(fullPath, bytes, { flag: "wx" })
    }
  }
  verifyProjectRightsQualification(qualification)
  return deriveProjectRightsQualification()
}

export const projectRightsConstants = {
  baseCommit: BASE_COMMIT,
  baseTree: BASE_TREE,
  reviewedCandidate: REVIEWED_CANDIDATE,
  pr4BaseCommit: PR4_BASE_COMMIT,
  pr4Paths: PR4_PATHS,
  pr5SourcePaths: PR5_SOURCE_PATHS,
  buildEvidence: BUILD_EVIDENCE,
  buildEvidenceSha256: BUILD_EVIDENCE_SHA256,
  projectLicenseSha256: PROJECT_LICENSE_SHA256,
  licenseScopeSha256: LICENSE_SCOPE_SHA256,
  contributorTermsSha256: CONTRIBUTOR_TERMS_SHA256,
  historicalRights: HISTORICAL_RIGHTS,
  historicalRightsSha256: HISTORICAL_RIGHTS_SHA256,
  decision: DECISION,
  rightsSupplement: RIGHTS_SUPPLEMENT,
  contributorRecord: CONTRIBUTOR_RECORD,
  currentScope: CURRENT_SCOPE,
  currentLedger: CURRENT_LEDGER,
  noticeRoot: NOTICE_ROOT,
}
