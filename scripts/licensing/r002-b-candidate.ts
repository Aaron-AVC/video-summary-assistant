import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import ts from "typescript"
import { deriveScope, load, noticeFiles, verifyArtifact, verifyOutput } from "../distribution-notices"
import type { Build, Graph, Identity, Inputs, Ledger } from "../distribution-notices"

const COMPONENT = "react-remove-scroll-bar"
const VERSION = "2.3.7"
const TARBALL = `https://registry.npmjs.org/${COMPONENT}/-/${COMPONENT}-${VERSION}.tgz`
const ROOT = resolve(import.meta.dir, "../..")
const EVIDENCE = "docs/licensing/evidence/R002-B"
const BASE = "f6d7b3068b893ce11637ea84598b26a5975e6838"
const BUILD_SOURCE = "7eda9fdbe0cd414c16a755f0b5da390c0fd37a57"
const BUILD_SHA = "3d8a9d547cc506a5544e0f7a5a519803de549276191021ecfce88039b21c56c2"
const MATERIAL = "licenses/third-party/r002-b-materials/react-remove-scroll-bar-MIT.txt"
const PROJECT_ASSET = "asset:project-icon-r002-b"

// Plasmo 0.90.5 finds entries under src or falls back to the project root.
// The fixed Tailwind config also scans root contents/**/*.tsx.
const PLASMO_PAGES = ["popup", "options", "devtools", "newtab", "sidepanel"]
const BUILD_DIRECTORIES = ["src", "assets", "public", "background", "contents", "tabs", "sandboxes", ...PLASMO_PAGES]
const PLASMO_ENTRIES = ["background", "content", "sandbox", ...PLASMO_PAGES]
const BUILD_FILES = [
  "package.json", "bun.lock", "plasmo.d.ts", "jsconfig.json", "browserslist", ".browserslistrc", "babel.config.json",
]
const DOT_CONFIGS = [".env", ".parcelrc", ".postcssrc", ".babelrc"]
const NAMED_CONFIGS = ["plasmo", "tailwind", "postcss", "babel", "vite", "webpack", "rollup"]
const IGNORED_INPUT_PATHS = [
  ...BUILD_DIRECTORIES.flatMap(name => [name, `${name}/**`]),
  ...BUILD_FILES,
  ...DOT_CONFIGS.flatMap(name => [name, `${name}.*`]),
  ...NAMED_CONFIGS.map(name => `${name}.config.*`),
  ...PLASMO_ENTRIES.map(name => `${name}.*`),
  "tsconfig.json", "tsconfig.*.json",
].map(path => `:(top,icase,glob)${path}`)

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(
      ([key, child]) => `${JSON.stringify(key)}:${stable(child)}`,
    ).join(",")}}`
  }
  return JSON.stringify(value)
}

type Tuple = readonly [string, string, { dependencies?: Record<string, string>, peerDependencies?: Record<string, string> }, string]
type Lock = { overrides?: Record<string, string>, packages: Record<string, Tuple> }
type Manifest = { overrides?: Record<string, string>, [key: string]: unknown }

export function assertPackagingManifestEquivalent(before: Manifest, after: Manifest): void {
  const scripts = before.scripts as Record<string, string> | undefined
  assert(scripts?.package === "plasmo package", "Fixed package script identity differs")
  const expected = structuredClone(before) as Manifest
  expected.scripts = {
    ...scripts,
    package: "bun scripts/release-package.ts release",
    "package:internal": "bun scripts/release-package.ts internal",
    "verify:package": "bun scripts/release-package.ts verify",
  }
  assert(stable(expected) === stable(after), "Unreviewed package.json change")
}

function isCandidateBuildInput(path: string): boolean {
  const [root, child] = path.toLowerCase().split("/", 2)
  if (BUILD_DIRECTORIES.includes(root)) return true
  if (child !== undefined) return false
  if (BUILD_FILES.includes(root) || /^tsconfig(?:\..+)?\.json$/.test(root)) return true
  if (DOT_CONFIGS.some(name => root === name || root.startsWith(`${name}.`))) return true

  const entry = /^([a-z]+)(?:\.(?:chrome|production))?\.(?:[jt]sx?|html)$/.exec(root)
  const config = /^([a-z]+)\.config\.[cm]?[jt]sx?$/.exec(root)
  return (entry !== null && PLASMO_ENTRIES.includes(entry[1]))
    || (config !== null && NAMED_CONFIGS.includes(config[1]))
}

export function assertCandidateBuildInputsUnchanged(paths: {
  changed: readonly string[]
  untracked: readonly string[]
  ignored: readonly string[]
}): void {
  // The tracked package.json is checked separately against the approved scripts.
  const changedProduct = [
    ...paths.changed.filter(path => path !== "package.json"),
    ...paths.untracked,
    ...paths.ignored,
  ].filter(isCandidateBuildInput)
  assert(changedProduct.length === 0,
    `Candidate product files differ from captured source: ${changedProduct.join(", ")}`)
}

export function validateDependencyDelta(
  beforeManifest: Manifest,
  afterManifest: Manifest,
  beforeLock: Lock,
  afterLock: Lock,
  expectedIntegrity: string,
): string[] {
  const cleanManifest = ({ overrides: _, ...manifest }: Manifest) => manifest
  if (stable(cleanManifest(beforeManifest)) !== stable(cleanManifest(afterManifest))
    || beforeManifest.overrides !== undefined || beforeLock.overrides !== undefined
    || stable(afterLock.overrides) !== stable(afterManifest.overrides)
    || stable(afterManifest.overrides) !== stable({ [COMPONENT]: VERSION })) {
    throw new Error("Unreviewed package.json change")
  }

  const oldTuple = beforeLock.packages[COMPONENT]
  const newTuple = afterLock.packages[COMPONENT]
  if (!oldTuple || !newTuple || oldTuple[0] !== `${COMPONENT}@2.3.8` || newTuple[0] !== `${COMPONENT}@${VERSION}`) {
    throw new Error("Publication version differs from reviewed old and candidate package identities")
  }
  if (newTuple[1] !== TARBALL || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(expectedIntegrity) || newTuple[3] !== expectedIntegrity) {
    throw new Error("Publication URL or integrity differs from official registry evidence")
  }
  if (stable(Object.keys(oldTuple[2].dependencies ?? {}).sort())
    !== stable(Object.keys(newTuple[2].dependencies ?? {}).sort())
    || stable(oldTuple[2].peerDependencies) !== stable(newTuple[2].peerDependencies)) {
    throw new Error("Target peer or transitive dependency identities changed")
  }

  const normalizedOld = structuredClone(beforeLock) as Lock
  const normalizedNew = structuredClone(afterLock) as Lock
  delete normalizedOld.overrides
  delete normalizedNew.overrides
  delete normalizedNew.packages[COMPONENT]
  normalizedNew.packages[COMPONENT] = oldTuple
  if (stable(normalizedOld) !== stable(normalizedNew)) {
    throw new Error("Unreviewed lock change")
  }

  const parent = afterLock.packages["react-remove-scroll"]
  const range = parent?.[2].dependencies?.[COMPONENT]
  if (!range || !Bun.semver.satisfies(VERSION, range)) {
    throw new Error(`Candidate release does not satisfy react-remove-scroll's published range: ${range ?? "missing"}`)
  }
  const installedPeers = afterLock.packages.react?.[0]?.split("@").at(-1)
  const reactRange = newTuple[2].peerDependencies?.react
  if (!installedPeers || !reactRange || !Bun.semver.satisfies(installedPeers, reactRange)) {
    throw new Error(`Candidate React peer range is incompatible with the installed version: ${installedPeers ?? "missing"}`)
  }
  for (const [key, constraint] of Object.entries(newTuple[2].dependencies ?? {})) {
    const installed = afterLock.packages[`${COMPONENT}/${key}`] ?? afterLock.packages[key]
    const version = installed?.[0].split("@").at(-1)
    if (!version || !Bun.semver.satisfies(version, constraint)) throw new Error(`Unresolved target dependency: ${key}`)
  }
  return [COMPONENT]
}

function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label)
}
const read = (path: string) => readFileSync(join(ROOT, path))
const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT })
const inputGit = (path: string, commit = BUILD_SOURCE) => git("show", `${commit}:${path}`)
const parse = <T>(bytes: Buffer): T => JSON.parse(bytes.toString("utf8"))
const parseLock = (bytes: Buffer): Lock => {
  const result = ts.parseConfigFileTextToJson("bun.lock", bytes.toString("utf8"))
  assert(!result.error, "Invalid Bun text lock")
  return result.config
}
const matches = (bytes: Buffer, identity: Identity) => bytes.length === identity.byteLength && sha256(bytes) === identity.sha256
const normalizedText = (bytes: Buffer) => bytes.toString().replaceAll("\r\n", "\n")
const render = (value: unknown) => JSON.stringify(value, null, 2) + "\n"
type Rights = {
  sourceCommit: string, paths: { path: string, disposition: string, outputs: string[], upstreamPath: string | null, upstreamBlob: string | null }[]
}
type Publication = {
  integrity: string, url: string, gitHead: string, legalFiles: string[], tarball: Identity, entries: Record<string, Identity>
}
type Publications = { publications: Record<string, Publication>, licenseCommit: string, licenseMaterial: Identity, copyright: string }

export function loadCandidate() {
  const previous = load(true)
  const identity = read(`${EVIDENCE}/build/build-identity-v3.json`)
  assert(sha256(identity) === BUILD_SHA, "Candidate build identity differs from captured evidence")
  const build = parse<Build & { base: string, inputEvidence: Record<string, Identity> }>(identity)
  assert(build.sourceCommit === BUILD_SOURCE && build.base === BASE && build.exitCode === 0
    && build.schema === "vsa-r002-b-production-evidence/v3"
    && git("show", "-s", "--format=%T%n%P", BUILD_SOURCE).toString().trim() === `${build.sourceTree}\n${BASE}`,
    "Candidate build source identity differs")
  assert(sha256(read("scripts/licensing/capture-parcel-build-graph.cjs")) === build.captureSha256, "Candidate capture differs")
  for (const [path, record] of Object.entries(build.gitInputs)) {
    const committed = inputGit(path)
    const live = read(path)
    assert(sha256(committed) === record.gitBlobSha256, `Fixed build input Git blob differs: ${path}`)
    if (path === "package.json") {
      assertPackagingManifestEquivalent(parse<Manifest>(committed), parse<Manifest>(live))
      continue
    }
    const unchanged = matches(live, record) || live.equals(committed)
      || ((path.endsWith(".json") || path.endsWith(".lock") || path.endsWith(".svg"))
        && normalizedText(live) === normalizedText(committed))
    assert(unchanged, `Candidate source input differs: ${path}`)
  }
  // A move out of a product directory must still report the removed source path.
  const changed = git("diff", "--no-renames", "--name-only", "-z", BUILD_SOURCE, "--").toString().split("\0")
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z").toString().split("\0")
  const ignoredBuildInputs = git("ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--",
    ...IGNORED_INPUT_PATHS,
  ).toString().split("\0")
  assertCandidateBuildInputsUnchanged({ changed, untracked, ignored: ignoredBuildInputs })
  for (const [path, record] of Object.entries(build.evidenceFiles)) {
    assert(matches(read(`${EVIDENCE}/build/${path}`), record), `Same-build evidence differs: ${path}`)
  }
  for (const [path, record] of Object.entries(build.inputEvidence)) {
    assert(matches(read(`${EVIDENCE}/${path}`), record), `Candidate audit evidence differs: ${path}`)
  }
  assert(matches(read(`${EVIDENCE}/build/manifest.json`), build.artifact["manifest.json"]), "Candidate manifest differs")
  const graph = parse<Graph>(read(`${EVIDENCE}/build/parcel-graph.json`))
  assert(graph.schema === previous.graph.schema && stable(graph.packageJson) === stable(build.packageJson)
    && stable(graph.lock) === stable(build.lock), "Candidate graph belongs to a different build")
  assert(build.ledgerSha256 === previous.build.ledgerSha256
    && sha256(read("docs/licensing/third-party-license-ledger.json")) === build.ledgerSha256, "Inherited ledger differs")
  const publication = parse<Publications>(read(`${EVIDENCE}/scroll-bar-publications.json`))
  const selected = publication.publications[VERSION]
  const lockBytes = inputGit("bun.lock")
  const delta = validateDependencyDelta(parse(inputGit("package.json", BASE)), parse(inputGit("package.json")),
    parseLock(inputGit("bun.lock", BASE)), parseLock(lockBytes), selected.integrity)
  const componentIdentity = `node_modules/${COMPONENT}/package.json`
  const materialBytes = read(MATERIAL)
  assert(matches(materialBytes, publication.licenseMaterial) && selected.legalFiles.length === 0
    && matches(read(`${EVIDENCE}/raw/scroll-${VERSION}.tgz`), selected.tarball)
    && `sha512-${createHash("sha512").update(read(`${EVIDENCE}/raw/scroll-${VERSION}.tgz`)).digest("base64")}` === selected.integrity,
    "Exact publication or upstream LICENSE payload differs")
  const oldPackages = new Map(previous.graph.packages.map(item => [item.identity, item]))
  for (const packageRecord of graph.packages) {
    if (packageRecord.identity === componentIdentity) {
      assert(packageRecord.version === VERSION && packageRecord.name === COMPONENT
        && packageRecord.sha256 === selected.entries["package/package.json"].sha256, "Wrong bundled target publication")
    } else {
      assert(stable(packageRecord) === stable(oldPackages.get(packageRecord.identity)), `New or changed module: ${packageRecord.identity}`)
    }
    oldPackages.delete(packageRecord.identity)
  }
  assert(oldPackages.size === 0, "Previously observed package missing; review changed graph closure")
  for (const extra of previous.extras) {
    if (extra.evidenceType !== "GRAPH") {
      for (const output of extra.outputs) {
        assert(stable(build.artifact[output]) === stable(previous.build.artifact[output]),
          `Generated content requires new verification: ${output}`)
      }
    }
  }

  const rights = parse<Rights>(read(`${EVIDENCE}/source-rights-v3.json`))
  assert(rights.sourceCommit === build.sourceCommit, "Source-rights inventory source identity differs")
  const byPath = new Map(rights.paths.map(row => [row.path, row]))
  assert(byPath.size === rights.paths.length && graph.bundles.every(bundle => bundle.assets.every(asset => asset.packageIdentity
    || !asset.source.startsWith("src/") || byPath.get(asset.source)?.outputs.includes(bundle.output.replace("build/chrome-mv3-prod/", "")))),
  "Unclassified product source in candidate graph")
  const origins: Inputs["origins"] = rights.paths.filter(row => row.disposition.startsWith("UPSTREAM_MIT_") || row.disposition === "THIRD_PARTY_MIXED")
    .map(row => ({ path: row.path, classification: row.disposition, upstreamPath: row.upstreamPath, upstreamBlob: row.upstreamBlob }))
  const rightsCount = rights.paths.filter(row => row.disposition === "PROJECT_ADDITION_HISTORY").length
  assert(rightsCount > 0, "Project-added source history must retain the owner/policy review hold")
  const sourceUrl = `https://github.com/theKashey/react-remove-scroll-bar/blob/${publication.licenseCommit}/LICENSE`
  const newMaterial = {
    materialId: `sha256:${publication.licenseMaterial.sha256}`, path: MATERIAL,
    kind: "license-text", ...publication.licenseMaterial, sourceArtifacts: [{url: sourceUrl, path: "LICENSE", gitHead: selected.gitHead}],
  }
  const ledger: Ledger = {
    licenseMaterials: [...previous.ledger.licenseMaterials, newMaterial],
    components: previous.ledger.components.map(c => {
      if (c.packageDirectoryIdentity === componentIdentity) return {
        ...c, version: VERSION, installedManifestSha256: selected.entries["package/package.json"].sha256,
        license: { declared: "MIT", evidenceStatus: "UPSTREAM_TEXT_WITH_EXACT_RELEASE_LINEAGE",
          copyrightStatements: [publication.copyright], licenseMaterialIds: [newMaterial.materialId],
          noticeMaterialIds: [], relatedMaterialIds: [], unresolvedIssue: null },
        sourceEvidence: [{kind: "npm-release-and-upstream-license", ...selected, upstreamLicense: sourceUrl}],
      }
      if (c.componentId === "asset:icon.png") return {
        ...c, componentId: PROJECT_ASSET, name: "R002-B extension icon", version: "R002-B",
        sourceClassification: "project-geometric-artwork-ai-assisted",
        sourceScope: "Editable geometric SVG and rendered PNGs; no external art; project terms pending.",
        license: { declared: "Project asset; project policy pending", evidenceStatus: "DOCUMENTED_GEOMETRIC_DESIGN",
          copyrightStatements: [], licenseMaterialIds: [], noticeMaterialIds: [], relatedMaterialIds: [], unresolvedIssue: null },
        sourceEvidence: ["assets/icon-source.svg", "assets/icon.png"],
      }
      if (c.componentId === "source:shadcn-templates") return {
        ...c, license: { ...c.license, evidenceStatus: "MIT_ATTRIBUTION_VERIFIED_FOR_REVIEWED_TEMPLATES",
          unresolvedIssue: "Exact historical shadcn CLI/template revision and copied expression ranges remain unknown." },
        provenanceStatus: "PARTIAL",
        provenanceNote: "The verified shadcn and fixed YouTube-Summarizer MIT texts are retained; the exact CLI input and copied ranges do not change the conservative notice coverage.",
        sourceEvidence: [...c.sourceEvidence, { path: `${EVIDENCE}/shadcn-review.md`, exactHistoricalCli: "UNKNOWN" }],
      }
      if (c.componentId === "source:new-project-files") return {
        ...c, name: "Project source rights and licensing policy", version: "R002-B",
        sourceClassification: "path-level-classification-rightsholder-confirmation-pending",
        sourceScope: "See the versioned path-level classification and PR-5 follow-ups.",
        license: { ...c.license, unresolvedIssue: `${rightsCount} project-added production paths have documented development history; contributor authority and the project licensing policy require PR-5 disposition.` },
        sourceEvidence: [{path: `${EVIDENCE}/source-rights-v3.json`}],
      }
      return c
    }),
  }
  const inputs: Inputs = { build, graph, ledger, extras: previous.extras, origins,
    projectAssetId: PROJECT_ASSET, lockBytes,
    buildSha256: BUILD_SHA, sourceInventorySha256: build.inputEvidence["source-rights-v3.json"].sha256 }
  const derived = deriveScope(inputs)
  const scope = {
    ...derived,
    schema: "vsa-r002-b-distribution-scope/v3",
    sourceInventory: { path: `${EVIDENCE}/source-rights-v3.json`, sha256: inputs.sourceInventorySha256,
      observedYouTubeSummarizerOrigins: derived.sourceInventory.observedYouTubeSummarizerOrigins },
  }
  const candidateLedger = {schema: "vsa-r002-b-ledger/v1", buildSha256: BUILD_SHA, base: BASE,
    changedNpmIdentities: delta.map(name => `node_modules/${name}/package.json`), inheritedLedgerSha256: inputs.build.ledgerSha256,
    blockerDisposition: {
      "B-01": "RESOLVED_FOR_CANDIDATE",
      "B-02": "RESOLVED_REPLACED",
      "B-03": "PARTIAL_PROVENANCE_NOTICE_SATISFIED",
      "B-04": "PARTIAL_PROJECT_RIGHTS_HOLD",
    }, ...inputs.ledger, supplementalComponents: inputs.extras}
  return { inputs, scope, delta, ledger: candidateLedger }
}

function cli() {
  const [command, ...args] = process.argv.slice(2)
  assert(["scope", "ledger", "generate", "verify", "record"].includes(command),
    "Usage: bun scripts/licensing/r002-b-candidate.ts scope|ledger|generate|verify|record [output] [--artifact dir] [--candidate]")
  const output = ["generate", "verify"].includes(command) ? args.shift() : undefined
  let artifact: string | undefined, candidate = false
  while (args.length) {
    const flag = args.shift()
    if (flag === "--artifact" && !artifact) {
      artifact = args.shift()
      assert(artifact && !artifact.startsWith("--"), "Provide an artifact directory")
    } else if (flag === "--candidate" && !candidate && ["generate", "verify"].includes(command)) candidate = true
    else throw new Error(`Unexpected argument: ${flag}`)
  }
  const { inputs, scope, ledger } = loadCandidate()
  if (artifact) verifyArtifact(artifact, inputs.build)
  assert(!candidate || artifact, "Candidate notice generation and verification require a verified artifact")
  const plan = noticeFiles(inputs, scope, candidate)
  const snapshots = {"candidate-ledger.json": ledger, "distribution-scope-v3.json": scope}
  for (const [file, value] of Object.entries(snapshots)) {
    const path = `${EVIDENCE}/${file}`
    if (command === "record") {
      assert(artifact, "Recording requires a verified live artifact")
      if (existsSync(join(ROOT, path))) {
        assert(render(parse(read(path))) === render(value), `Refusing to replace differing recorded ${file}`)
      } else writeFileSync(join(ROOT, path), render(value), {flag: "wx"})
    } else {
      assert(render(parse(read(path))) === render(value), `Recorded ${file} differs from derived candidate`)
    }
  }
  if (command === "generate" && output) {
    const full = resolve(output)
    const local = relative(realpathSync(ROOT), realpathSync(dirname(full)))
    assert(local !== "" && (isAbsolute(local) || local.split(/[\\/]/)[0] === ".."), "Choose a fresh external output directory")
    mkdirSync(full)
    for (const [path, bytes] of plan.files) {
      const destination = join(full, path)
      mkdirSync(dirname(destination), {recursive: true})
      writeFileSync(destination, bytes, {flag: "wx"})
    }
  } else if (command === "verify" && output) verifyOutput(output, plan.files)
  else assert(!["generate", "verify"].includes(command), "Provide a notice output directory")
  console.log(`${plan.status}: ${scope.components.length} scope rows; ${plan.files.size} files; ${plan.blockers.length} third-party notice blockers in scope; ${plan.releaseBlockers.length} release hold items`)
}

if (import.meta.main) {
  try { cli() } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
