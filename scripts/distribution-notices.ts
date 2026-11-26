import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { validateLicenseLedger } from "./validate-license-ledger"

const ROOT = resolve(import.meta.dir, "..")
const EVIDENCE = "docs/licensing/evidence/R002-PR23"
const LEDGER = "docs/licensing/third-party-license-ledger.json"
const SOURCE_INVENTORY = "docs/licensing/evidence/source-inventory-8ee1c311.tsv"
const CAPTURE = "scripts/licensing/capture-parcel-build-graph.cjs"
const SCOPE = `${EVIDENCE}/distribution-scope.json`
const DIST_PREFIX = "build/chrome-mv3-prod/"
// Trust anchor for the reviewed capture. A new build requires a new review and pin.
const BUILD_SHA = "2de4d1caf171ea51c4b728316ac03d563f0e37d7ff546e6c250f48bba9b640fa"
const SOURCE_COMMIT = "d596c2c366c5aa0d4538a6c7c274cc018eb7dc29"
const SOURCE_TREE = "ba48847ee715df91932af7d102583580561e903a"
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const json = <T>(bytes: Buffer): T => JSON.parse(bytes.toString("utf8"))
const render = (value: unknown) => JSON.stringify(value, null, 2) + "\n"
const sorted = (values: Iterable<string>) => [...new Set(values)].sort()
function requireCheck(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message) }
const digest = (value: string) => /^[a-f0-9]{64}$/.test(value)
const safePath = (value: string) => value.split("/").every(part => /^[a-zA-Z0-9_.@-]+$/.test(part) && part !== "." && part !== ".." && !part.endsWith("."))
function inside(parent: string, child: string) {
  const path = relative(parent, child)
  return path === "" || (!isAbsolute(path) && path.split(/[\\/]/)[0] !== "..")
}
function readUnder(parent: string, path: string) {
  requireCheck(safePath(path), `Unsafe path: ${path}`)
  const full = join(parent, path)
  requireCheck(inside(realpathSync(parent), realpathSync(full)) && lstatSync(full).isFile(), `Not a regular file under input root: ${path}`)
  return readFileSync(full)
}

type Identity = { sha256: string, byteLength: number }
type Asset = { source: string, packageIdentity: string | null }
type GraphPackage = { identity: string, name: string, version: string, sha256: string }
type Graph = {
  schema: string, packageJson: Identity, lock: Identity,
  bundles: { output: string, diskFile: Identity | null, assets: Asset[] }[], packages: GraphPackage[]
}
type Build = {
  schema: string, sourceCommit: string, sourceTree: string, exitCode: number,
  packageJson: Identity, lock: Identity, ledgerSha256: string, captureSha256: string,
  gitInputs: Record<string, Identity & { gitBlobSha256: string }>,
  evidenceFiles: Record<string, Identity>, artifact: Record<string, Identity>,
  outputChecks: { icon: { generated: Record<string, { output: string, source: string }> } }
}
type Supplemental = {
  name: string, version: string, identity: string, installedManifestSha256: string,
  evidenceType: string, outputs: string[], declared: string, copyrightStatements: string[],
  registryTarballUrl: string, tarballSha256: string, integrity: string,
  tarballLegalFiles: string[], licenses: (Identity & { tarballPath: string })[]
}
type LedgerComponent = {
  componentId: string, name: string, version: string, kind: string,
  installedManifestSha256?: string, installedClosureMembership: string, packageDirectoryIdentity: string | null,
  license: { declared: string, evidenceStatus: string, copyrightStatements: string[], licenseMaterialIds: string[], noticeMaterialIds: string[], relatedMaterialIds: string[], unresolvedIssue: string | null },
  sourceEvidence: unknown[]
  provenanceStatus?: string
  provenanceNote?: string
  sourceClassification?: string
  sourceScope?: string
}
type Ledger = { components: LedgerComponent[], licenseMaterials: { materialId: string, path: string, kind: string, sha256: string, byteLength: number, sourceArtifacts: unknown[] }[] }
// A complete graph does not account for all generated or transformed bytes.
type Membership = "CONFIRMED_INCLUDED" | "CONFIRMED_EXCLUDED" | "UNKNOWN"
type Evidence = { type: string, output: string, sources: string[] }
type Row = { id: string, name: string, version: string, membership: Membership, coverage: string, evidence: Evidence[] }
type SourceOrigin = { path: string, classification: string, upstreamPath: string | null, upstreamBlob: string | null }
const YOUTUBE_ADAPTER = "src/features/platform/youtube/youtube-adapter.ts"
const fixedBlob = (path: string) => execFileSync("git", ["show", `${SOURCE_COMMIT}:${path}`], { cwd: ROOT })
type Material = { path: string, role: "LICENSE" | "NOTICE" | "RELATED_LICENSE", sha256: string, sources: unknown[] }

function sameFile(record: Identity | null | undefined, bytes: Buffer) {
  return record?.byteLength === bytes.length && record.sha256 === sha(bytes)
}
function sameIdentity(left: Identity | null, right: Identity) {
  return left?.sha256 === right.sha256 && left.byteLength === right.byteLength
}
function sourceIdentity(build: Build, historical = false) {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT })
  requireCheck(git("show", "-s", "--format=%T", SOURCE_COMMIT).toString().trim() === SOURCE_TREE, "Fixed source tree mismatch")
  for (const [file, identity] of Object.entries(build.gitInputs)) {
    const blob = git("show", `${SOURCE_COMMIT}:${file}`)
    requireCheck(sha(blob) === identity.gitBlobSha256, `Fixed source input Git blob differs: ${file}`)
    if (!historical) {
      const bytes = readUnder(ROOT, file)
      requireCheck(sameFile(identity, bytes) || bytes.equals(blob), `Source input identity differs: ${file}`)
    }
  }
  if (historical) return
  const paths = git("diff", "--name-only", "-z", SOURCE_COMMIT, "--").toString().split("\0").filter(Boolean)
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z").toString().split("\0").filter(Boolean)
  const allowed = /^(?:\.gitattributes$|THIRD_PARTY_NOTICES\.md$|docs\/licensing\/evidence\/R002-PR23\/|docs\/superpowers\/(?:plans|specs)\/2026-11-25-vsa-r002-pr23\.md$|licenses\/third-party\/pr23-materials\/|scripts\/(?:licensing\/capture-parcel-build-graph\.cjs|distribution-notices(?:-validation\.test)?\.ts)$)/
  requireCheck([...paths, ...untracked].every(path => allowed.test(path)), "Product source differs from the fixed build baseline")
}

function load(historical = false) {
  const base = join(ROOT, EVIDENCE)
  const buildBytes = readUnder(base, "build-identity.json")
  requireCheck(sha(buildBytes) === BUILD_SHA, "Build identity differs from the reviewed capture")
  const build = json<Build>(buildBytes)
  requireCheck(build.schema === "vsa-fixed-production-evidence/v1" && build.sourceCommit === SOURCE_COMMIT && build.sourceTree === SOURCE_TREE && build.exitCode === 0, "Invalid fixed production identity")
  sourceIdentity(build, historical)
  requireCheck(sha(readUnder(ROOT, CAPTURE)) === build.captureSha256, "Capture script identity differs")
  const evidence = (path: string) => {
    const bytes = readUnder(base, path)
    requireCheck(sameFile(build.evidenceFiles[path], bytes), `Pinned build evidence differs: ${path}`)
    return bytes
  }
  for (const path of Object.keys(build.evidenceFiles)) evidence(path)
  requireCheck(sameFile(build.artifact["manifest.json"], evidence("manifest.json")), "Manifest differs from production output")
  const graph = json<Graph>(evidence("parcel-graph.json"))
  requireCheck(graph.schema === "vsa-parcel-run-graph/v1" && sameIdentity(graph.packageJson, build.packageJson) && sameIdentity(graph.lock, build.lock), "Graph belongs to a different build")
  const ledgerValue = json<unknown>(readUnder(ROOT, LEDGER))
  const errors = validateLicenseLedger(ROOT, ledgerValue, historical)
  requireCheck(errors.length === 0, `Source ledger failed:\n${errors.join("\n")}`)
  const ledger = ledgerValue as Ledger
  const extras = json<Supplemental[]>(evidence("supplemental-components.json"))
  const inventory = fixedBlob(SOURCE_INVENTORY)
  const lines = inventory.toString("utf8").trimEnd().split(/\r?\n/)
  requireCheck(lines.shift()?.startsWith("path\ttarget_blob\tp01_blob\ttarget_class\tp01_class\tupstream_path\tupstream_blob\t"), "Invalid fixed source inventory header")
  const origins: SourceOrigin[] = lines.flatMap<SourceOrigin>(line => {
    const [path, , , classification, , upstreamPath, upstreamBlob] = line.split("\t")
    if (classification === "same_path_equal" || classification === "same_path_changed") return [{path, classification, upstreamPath, upstreamBlob}]
    if (path === YOUTUBE_ADAPTER) return [{path, classification: "relocated_expression", upstreamPath: null, upstreamBlob: null}]
    return []
  })
  return { build, graph, ledger, extras, origins, sourceInventorySha256: sha(inventory),
    lockBytes: historical ? fixedBlob("bun.lock") : undefined }
}

type Inputs = ReturnType<typeof load> & {
  buildSha256?: string, lockBytes?: Buffer, projectAssetId?: string
}

function deriveScope({build, graph, ledger, extras, origins, sourceInventorySha256, buildSha256 = BUILD_SHA, lockBytes, projectAssetId}: Inputs) {
  const artifacts = new Set(Object.keys(build.artifact))
  const packages = new Map(graph.packages.map(p => [p.identity, p]))
  requireCheck(packages.size === graph.packages.length, "Duplicate graph package identity")
  const packageEvidence = new Map<string, Evidence[]>()
  const allAssets = new Map<string, string[]>()
  const push = (identity: string, ev: Evidence) => packageEvidence.set(identity, [...(packageEvidence.get(identity) ?? []), ev])
  for (const bundle of graph.bundles) {
    const output = bundle.output.slice(DIST_PREFIX.length)
    requireCheck(bundle.output.startsWith(DIST_PREFIX) && artifacts.delete(output) && sameIdentity(bundle.diskFile, build.artifact[output]) && bundle.assets.length, `Incomplete graph/output binding: ${bundle.output}`)
    const sourceGroups = new Map<string, string[]>()
    for (const asset of bundle.assets) {
      const parts = asset.source.split("/")
      const index = parts.lastIndexOf("node_modules")
      const identity = index < 0 ? null : `${parts.slice(0, index + (parts[index + 1]?.startsWith("@") ? 3 : 2)).join("/")}/package.json`
      requireCheck(safePath(asset.source) && identity === asset.packageIdentity && (identity === null || packages.has(identity)), `Unmapped npm asset: ${asset.source}`)
      if (identity) sourceGroups.set(identity, [...(sourceGroups.get(identity) ?? []), asset.source])
    }
    allAssets.set(output, sorted(bundle.assets.map(a => a.source)))
    for (const [id, source] of sourceGroups) push(id, { type: "SAME_BUILD_GRAPH", output, sources: sorted(source) })
  }
  requireCheck(artifacts.size === 0 && packageEvidence.size === packages.size, "Incomplete graph output or package inventory")
  const allLedgerIds = new Set(ledger.components.map(c => c.componentId))
  const supplementalIds = new Set<string>()
  const rows: Row[] = []
  const outputCoverage = sorted(allAssets.keys())
  const add = (id: string, name: string, version: string, coverage: string, evidence: Evidence[]) => {
    rows.push({ id, name, version, membership: evidence.length ? "CONFIRMED_INCLUDED" : "UNKNOWN",
      coverage, evidence: evidence.sort((a,b) => a.output < b.output ? -1 : a.output > b.output ? 1 : 0) })
  }
  const localSources = (match: (path: string) => boolean) => [...allAssets].flatMap(([output, sources]) => {
    const hits = sources.filter(match)
    return hits.length ? [{type: "SAME_BUILD_GRAPH", output, sources: hits}] : []
  })
  const inherited = new Set(origins.map(origin => origin.path))
  for (const c of ledger.components) {
    const p = c.packageDirectoryIdentity ? packages.get(c.packageDirectoryIdentity) : undefined
    if (p) requireCheck(p.name === c.name && p.version === c.version && p.sha256 === c.installedManifestSha256, `Ledger/graph installed package mismatch: ${c.componentId}`)
    let evidence = c.packageDirectoryIdentity ? packageEvidence.get(c.packageDirectoryIdentity) ?? [] : []
    if (c.componentId === "source:youtube-summarizer") {
      evidence = localSources(path => inherited.has(path) && path !== "assets/icon.png")
    }
    if (c.componentId === "source:shadcn-templates") {
      evidence = localSources(path => /^src\/components\/ui\/(empty|field|input-group)\.tsx$/.test(path))
    }
    if (c.componentId === "asset:icon.png" || c.componentId === projectAssetId) {
      evidence = Object.values(build.outputChecks.icon.generated).map(({output, source}) => ({type: "SAME_BUILD_DERIVED_ICON", output, sources: ["assets/icon.png", source]}))
    }
    const coverage = c.kind === "npm-package"
      ? c.installedClosureMembership === "REQUIRED" ? "REQUIRED_CLOSURE" : "OPTIONAL_ONLY"
      : c.componentId === "source:new-project-files" ? "RIGHTS_REVIEW"
      : c.componentId === projectAssetId ? "PROJECT_ASSET" : "INCORPORATED_SOURCE_OR_ASSET"
    add(c.componentId, c.name, c.version, coverage, evidence)
  }
  const lockLines = (lockBytes ?? readUnder(ROOT, "bun.lock")).toString("utf8").split(/\r?\n/)
  for (const x of extras) {
    const id = `npm:${x.identity}`
    requireCheck(!allLedgerIds.has(id) && !supplementalIds.has(x.identity), `Duplicate supplemental identity: ${id}`)
    supplementalIds.add(x.identity)
    const lockLine = lockLines.find(line => line.trimStart().startsWith(`${JSON.stringify(x.name)}: [${JSON.stringify(`${x.name}@${x.version}`)},`))
    requireCheck(x.identity === `node_modules/${x.name}/package.json` && lockLine?.includes(`"${x.integrity}"`) && digest(x.tarballSha256), `Supplemental package lock identity differs: ${id}`)
    const p = packages.get(x.identity)
    if (x.evidenceType === "GRAPH") requireCheck(p && p.name === x.name && p.version === x.version && p.sha256 === x.installedManifestSha256, `Missing supplemental graph evidence: ${id}`)
    else requireCheck(!p && x.outputs.length && x.outputs.every(path => allAssets.has(path)), `Missing generated-content evidence: ${id}`)
    add(id, x.name, x.version, "SUPPLEMENTAL", packageEvidence.get(x.identity) ?? x.outputs.map(output => ({type: x.evidenceType, output, sources: []})))
  }
  for (const key of packages.keys()) {
    requireCheck(allLedgerIds.has(`npm:${key}`) || supplementalIds.has(key), `Unreviewed package outside closure: ${key}`)
  }
  const observedSources = new Set(rows.find(row => row.id === "source:youtube-summarizer")?.evidence.flatMap(ev => ev.sources))
  return { schema: "vsa-distribution-scope/v1", sourceCommit: build.sourceCommit, sourceTree: build.sourceTree,
    buildSha256, ledgerSha256: build.ledgerSha256, packageSha256: build.packageJson.sha256,
    lockSha256: build.lock.sha256, graphSha256: build.evidenceFiles["parcel-graph.json"].sha256,
    graphOutputCoverage: outputCoverage,
    sourceInventory: { path: SOURCE_INVENTORY, gitBlobSha256: sourceInventorySha256,
      observedYouTubeSummarizerOrigins: origins.filter(origin => observedSources.has(origin.path)) },
    noticeCoverage: "REQUIRED_AND_OPTIONAL_CLOSURE_PLUS_OBSERVED_EXTRAS_AND_INCORPORATED_CONTENT",
    unknownMembership: "No positive same-build attribution for this row; graph absence is not an exclusion.",
    components: rows }
}

function inventory(root: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>()
  const full = resolve(root)
  requireCheck(lstatSync(full).isDirectory() && !lstatSync(full).isSymbolicLink(), "Expected a regular directory")
  const visit = (dir: string, prefix: string) => {
    for (const item of readdirSync(dir, {withFileTypes: true})) {
      const path = prefix + item.name
      requireCheck(safePath(path) && !item.isSymbolicLink(), `Unsafe artifact entry: ${path}`)
      if (item.isDirectory()) visit(join(dir, item.name), `${path}/`)
      else files.set(path, readUnder(full, path))
    }
  }
  visit(full, "")
  return files
}

function verifyArtifact(dir: string, build: Build) {
  const files = inventory(dir)
  requireCheck(files.size === Object.keys(build.artifact).length && [...files].every(([path, bytes]) => sameFile(build.artifact[path], bytes)), "Production artifact inventory differs from same-build evidence")
}

function noticeFiles(inputs: Inputs, scope: Omit<ReturnType<typeof deriveScope>, "sourceInventory"> & { sourceInventory: object }, candidate: boolean) {
  const files = new Map<string, Buffer>()
  const byComponent = new Map(inputs.ledger.components.map(c => [c.componentId, c]))
  const byExtra = new Map(inputs.extras.map(c => [`npm:${c.identity}`, c]))
  const ledgerMaterials = new Map(inputs.ledger.licenseMaterials.map(m => [m.materialId, m]))
  const blockers: string[] = []
  const releaseBlockers: string[] = []
  function add(bytes: Buffer, record: Identity, role: Material["role"], sources: unknown[]): Material {
    requireCheck(sameFile(record, bytes), `Legal material bytes differ: ${record.sha256}`)
    const group = role === "NOTICE" ? "NOTICES" : "LICENSES"
    const path = `THIRD_PARTY/${group}/${record.sha256}/${role === "NOTICE" ? "NOTICE" : "LICENSE"}`
    files.set(path, bytes)
    return { path, role, sha256: record.sha256, sources }
  }
  function ledgerRef(id: string, role: Material["role"]) {
    const record = ledgerMaterials.get(id)
    requireCheck(record && record.kind === (role === "NOTICE" ? "notice-text" : "license-text"), `Invalid ${role} mapping: ${id}`)
    return add(readUnder(ROOT, record.path), record, role, record.sourceArtifacts)
  }
  const components = scope.components.map(row => {
    const include = row.coverage !== "RIGHTS_REVIEW" && row.coverage !== "PROJECT_ASSET"
    const c = byComponent.get(row.id)
    const x = byExtra.get(row.id)
    const materials: Material[] = []
    // PR-1's icon issue predates the same-build membership evidence.
    const issue = row.id === "asset:icon.png" && row.membership === "CONFIRMED_INCLUDED" && c?.license.unresolvedIssue
      ? "The bundled icon derives from the fixed upstream image; the original artwork creator and chain of rights remain unverified."
      : c?.license.unresolvedIssue ?? null
    const provenanceNote = inputs.buildSha256 && row.id === "source:shadcn-templates"
      && c?.provenanceStatus === "PARTIAL"
      && c.license.licenseMaterialIds.includes("sha256:1564074e13439397221ffd522e2e504d56561994a23d371aa5e3ad43e4f5423f")
      && c.license.licenseMaterialIds.includes("sha256:a6051897936080c684f88c52dfb2283d106e96d7aa4eccb93dc975a27d9383c4")
      ? c.provenanceNote ?? issue : null
    const noticeIssue = provenanceNote ? null : issue
    if (noticeIssue) {
      const message = `${row.name}@${row.version}: ${noticeIssue}`
      if (include || (!inputs.buildSha256 && row.coverage === "RIGHTS_REVIEW")) blockers.push(message)
      else if (row.coverage === "RIGHTS_REVIEW") releaseBlockers.push(message)
    }
    if (include && c) {
      // PR-1 preserves these two Lucide files as evidence; they are the icon
      // named "copyright" and its map, not legal text for distribution.
      const lucideIconEvidence = new Set(["sha256:c622f178bb850c718f8a1d5c5220d00dd612a8b4f7a816775c6c0bf4c8177e63", "sha256:baf59c76fb66485ae227f380cdbc1ea079923c2e082bd382f04962baeb52db79"])
      for (const id of c.license.licenseMaterialIds) {
        if (c.name === "lucide-react" && lucideIconEvidence.has(id)) continue
        const record = ledgerMaterials.get(id)
        // PR-1 retained Dexie's exact package/NOTICE under licenseMaterialIds.
        // Classify from the component's exact release path, not the v1 bucket.
        const isTarballNotice = c.sourceEvidence.some(entry => {
          const e = entry as {kind: string, legalFiles?: {materialId: string, tarballPath: string}[]}
          return e.kind === "npm-registry-release" && e.legalFiles?.some(f => f.materialId === id && /(?:^|\/)NOTICE(?:\.[^/]+)?$/i.test(f.tarballPath))
        })
        if (isTarballNotice) {
          requireCheck(record, `Missing tarball NOTICE mapping: ${id}`)
          materials.push(add(readUnder(ROOT, record.path), record, "NOTICE", record.sourceArtifacts))
        } else materials.push(ledgerRef(id, "LICENSE"))
      }
      for (const id of c.license.noticeMaterialIds) materials.push(ledgerRef(id, "NOTICE"))
      for (const id of c.license.relatedMaterialIds) if (ledgerMaterials.get(id)?.kind === "license-text") materials.push(ledgerRef(id, "RELATED_LICENSE"))
    }
    if (include && x) {
      requireCheck(x.licenses.length && x.tarballLegalFiles.includes("package/LICENSE") && !x.tarballLegalFiles.some(path => /(?:^|\/)NOTICE(?:\.|$)/i.test(path)), `Supplemental legal inventory requires review: ${row.id}`)
      for (const record of x.licenses) {
        requireCheck(digest(record.sha256) && x.tarballLegalFiles.includes(record.tarballPath), `Supplemental LICENSE mapping differs: ${row.id}`)
        materials.push(add(readUnder(ROOT, `licenses/third-party/pr23-materials/${record.sha256}.txt`), record, "LICENSE", [{url: x.registryTarballUrl, tarballSha256: x.tarballSha256, path: record.tarballPath}]))
      }
    }
    requireCheck(!include || materials.some(m => m.role === "LICENSE") || noticeIssue, `Included component has no LICENSE or unresolved disposition: ${row.id}`)
    return {...row, includeInNotice: include, declared: c?.license.declared ?? x?.declared,
      licenseStatus: c?.license.evidenceStatus ?? "VERIFIED_TARBALL_TEXT",
      ...(c?.provenanceStatus ? {provenanceStatus: c.provenanceStatus, provenanceNote} : {}),
      copyright: c?.license.copyrightStatements ?? x?.copyrightStatements ?? [], materials, unresolved: noticeIssue}
  })
  // The history-only checkout can generate a preview. Candidate mode is
  // reserved for a live artifact and still refuses all unresolved items.
  if (candidate && blockers.length) throw new Error(`Third-party notice candidate blocked:\n${blockers.join("\n")}`)
  const status = blockers.length ? "BLOCKED_AUDIT_PREVIEW"
    : inputs.buildSha256 ? "THIRD_PARTY_NOTICES_COMPLETE_RELEASE_HOLD"
    : candidate ? "THIRD_PARTY_NOTICE_CANDIDATE" : "AUDIT_PREVIEW"
  const put = (path: string, text: string) => files.set(path, Buffer.from(text, "utf8"))
  const {components: _, ...identity} = scope
  const disposition = inputs.buildSha256 ? {
    status, releaseApproved: false, releaseStatus: "HOLD", releaseBlockers,
    thirdPartyStatus: blockers.length
      ? "BLOCKED_THIRD_PARTY_ITEMS" : "MATERIALS_VERIFIED_FOR_REVIEWED_SCOPE",
  } : {status, releaseApproved: false}
  put("THIRD_PARTY/manifest.json", render({...identity, schema: "vsa-third-party-notice-manifest/v1", ...disposition, blockers, components}))
  put("THIRD_PARTY_NOTICES.md", ["# Third-party notices", "", `**${status} — ${candidate ? "third-party notice candidate only" : "not eligible for distribution"}.**`, "",
    `Production evidence: \`${scope.buildSha256}\``, "", "Scope: conservative required and optional closure coverage, observed supplemental content, and incorporated source/assets. See the machine manifest for observed membership.", "",
    ...(releaseBlockers.length ? ["## Release qualifications on hold", "", ...releaseBlockers.map(issue => `- ${issue}`), ""] : []),
    inputs.buildSha256 ? "## Open third-party notice items in the reviewed scope" : "## Open items", "",
    ...blockers.map(issue => `- ${issue}`), "",
    ...(components.some(component => component.provenanceStatus === "PARTIAL")
      ? ["## Partial provenance retained without narrowing the notice scope", "",
        ...components.filter(component => component.provenanceStatus === "PARTIAL").map(component => `- ${component.name}: ${component.provenanceNote}`), ""] : []),
    "## Included third-party notice entries", "",
    ...components.filter(row => row.includeInNotice).flatMap(row => [`### ${row.name} @ ${row.version}`, "", `- Identity: \`${row.id}\``, `- Coverage: ${row.coverage}; observed membership: ${row.membership}`, `- License evidence: ${row.declared} (${row.licenseStatus})`,
      ...row.copyright.map(line => `- ${line}`), ...row.materials.map(m => `- [${m.role}](${m.path}) — SHA-256 \`${m.sha256}\``), ""]), ""].join("\n"))
  put("THIRD_PARTY/SHA256SUMS.txt", sorted(files.keys()).map(path => `${sha(files.get(path)!)}  ${path}\n`).join(""))
  return { files, status, blockers, releaseBlockers }
}

function verifyOutput(dir: string, expected: Map<string, Buffer>) {
  const actual = inventory(dir)
  for (const [path, bytes] of expected) {
    requireCheck(actual.has(path), `Missing generated file: ${path}`)
    requireCheck(bytes.equals(actual.get(path)!), `Generated bytes differ: ${path}`)
  }
  requireCheck(actual.size === expected.size, "Unexpected files in generated output")
}

function main(args: string[]) {
  const [command, ...options] = args
  requireCheck(["scope", "generate", "verify"].includes(command), "Usage: bun scripts/distribution-notices.ts scope|generate|verify [output] [--artifact dir] [--scope file] [--candidate]")
  const output = command !== "scope" ? options.shift() : undefined
  requireCheck(command === "scope" || (output && !output.startsWith("--")), "Provide an output directory")
  let scopeFile: string | undefined, artifact: string | undefined, candidate = false, historical = false
  for (let i = 0; i < options.length; i++) {
    const option = options[i]
    if (option === "--historical" && !historical) { historical = true; continue }
    if (option === "--candidate" && !candidate && command !== "scope") { candidate = true; continue }
    const val = options[++i]
    requireCheck(val && !val.startsWith("--"), `Missing value for ${option}`)
    if (option === "--scope" && !scopeFile) scopeFile = val
    else if (option === "--artifact" && !artifact) artifact = val
    else throw new Error(`Unknown or repeated argument: ${option}`)
  }
  requireCheck(!historical || !candidate, "Historical snapshot mode does not generate release candidates")
  const inputs = load(historical)
  const scope = deriveScope(inputs)
  const supplied = scopeFile ? readFileSync(scopeFile) : readUnder(ROOT, SCOPE)
  requireCheck(render(json<unknown>(supplied)) === render(scope), "Scope differs from derived evidence")
  if (artifact) verifyArtifact(artifact, inputs.build)
  const plan = noticeFiles(inputs, scope, candidate)
  requireCheck(!candidate || artifact, "Candidate mode requires the verified live artifact directory")
  if (command === "generate") {
    const dir = resolve(output!)
    const parent = realpathSync(dirname(dir))
    requireCheck(!inside(realpathSync(ROOT), parent), "Choose a fresh external output directory")
    mkdirSync(dir)
    for (const [path, bytes] of plan.files) {
      const full = join(dir, path)
      mkdirSync(dirname(full), {recursive: true})
      writeFileSync(full, bytes, {flag: "wx"})
    }
  } else if (command === "verify") verifyOutput(output!, plan.files)
  console.log(`${plan.status}: ${scope.components.length} scope rows; ${plan.files.size} planned notice files; ${plan.blockers.length} open items${artifact ? "; production artifact identity verified" : ""}`)
}

if (import.meta.main) {
  try { main(process.argv.slice(2)) } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

export { load, deriveScope, noticeFiles, verifyOutput, verifyArtifact, inventory }
export type { Build, Graph, Identity, Inputs, Ledger, Supplemental }
