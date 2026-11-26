import { createHash, randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import { unzipSync, zipSync } from "fflate"
import {
  inventory,
  noticeFiles,
  verifyArtifact,
} from "../distribution-notices"
import { loadCandidate } from "../licensing/r002-b-candidate"

const ROOT = resolve(import.meta.dir, "../..")
const EVIDENCE = "docs/licensing/evidence/R002-B"
const BUILD_IDENTITY_SHA256 = "3d8a9d547cc506a5544e0f7a5a519803de549276191021ecfce88039b21c56c2"
const BUILD_SOURCE_COMMIT = "7eda9fdbe0cd414c16a755f0b5da390c0fd37a57"
const BUILD_SOURCE_TREE = "cfec44a94ee5a2053a361b7a3087373562378ec5"
const MAX_PACKAGE_BYTES = 2_000_000_000
const HOLD_MARKER = "INTERNAL_HOLD.txt"
const ZIP_FILE = "extension-INTERNAL-HOLD.zip"
const IDENTITY_FILE = "package-identity.json"
const STATUS = "THIRD_PARTY_NOTICES_COMPLETE_RELEASE_HOLD"
const THIRD_PARTY_STATUS = "MATERIALS_VERIFIED_FOR_REVIEWED_SCOPE"
const RESERVED_WINDOWS_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

export type FileMap = ReadonlyMap<string, Buffer>
export type FileIdentity = { sha256: string, byteLength: number }

type PackageIdentityInput = {
  sourceCommit: string
  sourceTree: string
  productFiles: FileMap
  noticeFiles: FileMap
  zipBytes: Uint8Array
  archiveFiles: FileMap
  version: string
  scopeSha256?: string
  ledgerSha256?: string
  releaseBlockers?: string[]
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function fileIdentity(bytes: Uint8Array): FileIdentity {
  return { sha256: sha256(bytes), byteLength: bytes.byteLength }
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

function sortedIdentities(files: FileMap): Record<string, FileIdentity> {
  return Object.fromEntries([...files].sort(([left], [right]) => left.localeCompare(right))
    .map(([path, bytes]) => [path, fileIdentity(bytes)]))
}

function isSafeArchivePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes(":")
    || path.includes("\0") || /[\u0000-\u001f\u007f]/.test(path) || path.endsWith("/")) return false
  const segments = path.split("/")
  return segments.every(segment => segment !== "" && segment !== "." && segment !== ".."
    && /^[A-Za-z0-9_.@-]+$/.test(segment) && !segment.endsWith(".")
    && !RESERVED_WINDOWS_NAME.test(segment))
}

function validateFilePlan(files: FileMap): void {
  const folded = new Set<string>()
  for (const path of files.keys()) {
    check(isSafeArchivePath(path), `Unsafe planned archive path: ${path}`)
    const key = path.toLocaleLowerCase("en-US")
    check(!folded.has(key), `Case-colliding planned archive path: ${path}`)
    folded.add(key)
  }
}

export function createPackageIdentity(input: PackageIdentityInput) {
  const archive = {
    file: ZIP_FILE,
    sha256: sha256(input.zipBytes),
    byteLength: input.zipBytes.byteLength,
    files: sortedIdentities(input.archiveFiles),
  }
  return {
    schema: "vsa-release-package-identity/v1",
    source: {
      commit: input.sourceCommit,
      tree: input.sourceTree,
      productionBuildCommit: BUILD_SOURCE_COMMIT,
      productionBuildTree: BUILD_SOURCE_TREE,
      buildEvidenceSha256: BUILD_IDENTITY_SHA256,
      fixedBuildInputsEquivalent: true,
    },
    build: {
      version: input.version,
      target: "chrome-mv3",
      productFiles: sortedIdentities(input.productFiles),
      productFileCount: input.productFiles.size,
    },
    distribution: {
      scopeFile: `${EVIDENCE}/distribution-scope-v3.json`,
      scopeSha256: input.scopeSha256 ?? null,
      ledgerFile: `${EVIDENCE}/candidate-ledger.json`,
      ledgerSha256: input.ledgerSha256 ?? null,
      noticeFiles: sortedIdentities(input.noticeFiles),
      noticeFileCount: input.noticeFiles.size,
      thirdPartyStatus: THIRD_PARTY_STATUS,
      thirdPartyBlockers: 0,
      releaseStatus: "HOLD",
      releaseApproved: false,
      releaseBlockers: input.releaseBlockers ?? ["Project source rights and licensing policy remain on hold."],
    },
    package: {
      type: "INTERNAL",
      status: STATUS,
      releaseApproved: false,
      marker: HOLD_MARKER,
    },
    archive,
  }
}

type ZipEntry = {
  name: string
  crc: number
  compressedSize: number
  uncompressedSize: number
  method: number
  localOffset: number
  localEnd: number
}

function readU16(view: DataView, offset: number, limit: number): number {
  check(offset >= 0 && offset + 2 <= limit, "Truncated ZIP field")
  return view.getUint16(offset, true)
}

function readU32(view: DataView, offset: number, limit: number): number {
  check(offset >= 0 && offset + 4 <= limit, "Truncated ZIP field")
  return view.getUint32(offset, true)
}

function decodeName(bytes: Uint8Array): string {
  for (const byte of bytes) check(byte >= 0x20 && byte <= 0x7e, "ZIP member names must be printable ASCII")
  return Buffer.from(bytes).toString("ascii")
}

function parseZipEntries(bytes: Uint8Array, expectedFiles: FileMap): ZipEntry[] {
  check(bytes.byteLength >= 22 && bytes.byteLength <= MAX_PACKAGE_BYTES, "ZIP size is outside the supported range")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = bytes.byteLength - 22
  check(readU32(view, eocd, bytes.byteLength) === 0x06054b50, "ZIP end record is missing or has a comment")
  check(readU16(view, eocd + 4, bytes.byteLength) === 0
    && readU16(view, eocd + 6, bytes.byteLength) === 0, "Multi-disk ZIP archives are not supported")
  const diskEntries = readU16(view, eocd + 8, bytes.byteLength)
  const entryCount = readU16(view, eocd + 10, bytes.byteLength)
  const centralSize = readU32(view, eocd + 12, bytes.byteLength)
  const centralOffset = readU32(view, eocd + 16, bytes.byteLength)
  const commentLength = readU16(view, eocd + 20, bytes.byteLength)
  check(commentLength === 0 && eocd + 22 === bytes.byteLength, "ZIP comments or trailing bytes are not allowed")
  check(entryCount !== 0xffff && diskEntries === entryCount
    && centralSize !== 0xffffffff && centralOffset !== 0xffffffff, "ZIP64 or split archive is not supported")
  check(centralOffset + centralSize === eocd, "ZIP central directory bounds are invalid")

  const entries: ZipEntry[] = []
  const foldedNames = new Set<string>()
  let cursor = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    check(readU32(view, cursor, eocd) === 0x02014b50, "Invalid ZIP central directory record")
    const madeBy = readU16(view, cursor + 4, eocd)
    const needed = readU16(view, cursor + 6, eocd)
    const flags = readU16(view, cursor + 8, eocd)
    const method = readU16(view, cursor + 10, eocd)
    const crc = readU32(view, cursor + 16, eocd)
    const compressedSize = readU32(view, cursor + 20, eocd)
    const uncompressedSize = readU32(view, cursor + 24, eocd)
    const nameLength = readU16(view, cursor + 28, eocd)
    const extraLength = readU16(view, cursor + 30, eocd)
    const fileCommentLength = readU16(view, cursor + 32, eocd)
    const diskStart = readU16(view, cursor + 34, eocd)
    const externalAttributes = readU32(view, cursor + 38, eocd)
    const localOffset = readU32(view, cursor + 42, eocd)
    const recordEnd = cursor + 46 + nameLength + extraLength + fileCommentLength
    check(nameLength > 0 && recordEnd <= eocd, "Truncated ZIP central directory name")
    check((madeBy >>> 8) === 0 && needed <= 20, "Unsupported ZIP platform or version")
    check(flags === 0 && (method === 0 || method === 8), "Encrypted or unsupported ZIP entry")
    check(extraLength === 0 && fileCommentLength === 0 && diskStart === 0,
      "ZIP extras, comments, and split entries are not allowed")
    check(externalAttributes === 0, "Non-regular ZIP member attributes are not allowed")
    check(compressedSize !== 0xffffffff && uncompressedSize !== 0xffffffff && localOffset !== 0xffffffff,
      "ZIP64 entry is not supported")

    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength)
    const name = decodeName(nameBytes)
    check(isSafeArchivePath(name), `Unsafe ZIP member path: ${name}`)
    const folded = name.toLocaleLowerCase("en-US")
    check(!foldedNames.has(folded), `Duplicate or case-colliding ZIP member: ${name}`)
    foldedNames.add(folded)
    const expected = expectedFiles.get(name)
    check(expected, `Unauthorized ZIP member: ${name}`)
    check(uncompressedSize === expected.byteLength, `Unexpected expanded ZIP size: ${name}`)

    check(readU32(view, localOffset, centralOffset) === 0x04034b50, `Invalid local ZIP header: ${name}`)
    const localNeeded = readU16(view, localOffset + 4, centralOffset)
    const localFlags = readU16(view, localOffset + 6, centralOffset)
    const localMethod = readU16(view, localOffset + 8, centralOffset)
    const localCrc = readU32(view, localOffset + 14, centralOffset)
    const localCompressed = readU32(view, localOffset + 18, centralOffset)
    const localUncompressed = readU32(view, localOffset + 22, centralOffset)
    const localNameLength = readU16(view, localOffset + 26, centralOffset)
    const localExtraLength = readU16(view, localOffset + 28, centralOffset)
    const localNameEnd = localOffset + 30 + localNameLength
    check(localNameLength === nameLength && localExtraLength === 0 && localNameEnd <= centralOffset,
      `Invalid local ZIP name or extra data: ${name}`)
    check(Buffer.from(bytes.subarray(localOffset + 30, localNameEnd)).equals(Buffer.from(nameBytes)),
      `Central/local ZIP name mismatch: ${name}`)
    check(localNeeded === needed && localFlags === flags && localMethod === method
      && localCrc === crc && localCompressed === compressedSize && localUncompressed === uncompressedSize,
    `Central/local ZIP identity mismatch: ${name}`)
    const localEnd = localNameEnd + compressedSize
    check(localEnd <= centralOffset, `Truncated ZIP payload: ${name}`)
    entries.push({ name, crc, compressedSize, uncompressedSize, method, localOffset, localEnd })
    cursor = recordEnd
  }
  check(cursor === centralOffset + centralSize, "ZIP central directory length mismatch")
  check(entries.length === expectedFiles.size, "ZIP member count differs from the expected file plan")

  const localOrder = [...entries].sort((left, right) => left.localOffset - right.localOffset)
  let expectedOffset = 0
  for (const entry of localOrder) {
    check(entry.localOffset === expectedOffset, "ZIP local records overlap or contain unrecognized data")
    expectedOffset = entry.localEnd
  }
  check(expectedOffset === centralOffset, "ZIP contains unrecognized bytes before its central directory")
  return entries
}

export function verifyPackageArchive(
  zipBytes: Uint8Array,
  expectedFiles: FileMap,
  identity?: ReturnType<typeof createPackageIdentity>,
): Map<string, Buffer> {
  validateFilePlan(expectedFiles)
  const entries = parseZipEntries(zipBytes, expectedFiles)
  const unpacked = unzipSync(zipBytes)
  const actualNames = Object.keys(unpacked)
  check(actualNames.length === entries.length, "ZIP decompressor member count differs from central directory")
  const actual = new Map<string, Buffer>()
  const byName = new Map(entries.map(entry => [entry.name, entry]))
  for (const name of actualNames) {
    const bytes = Buffer.from(unpacked[name]!)
    const entry = byName.get(name)
    check(entry && bytes.byteLength === entry.uncompressedSize && crc32(bytes) === entry.crc,
      `ZIP payload integrity check failed: ${name}`)
    actual.set(name, bytes)
  }
  for (const [path, expected] of expectedFiles) {
    const bytes = actual.get(path)
    check(bytes && bytes.equals(expected), `ZIP payload differs from the verified plan: ${path}`)
  }
  if (identity) {
    check(identity.schema === "vsa-release-package-identity/v1"
      && identity.package.type === "INTERNAL"
      && identity.package.status === STATUS
      && identity.package.releaseApproved === false
      && identity.distribution.releaseApproved === false
      && identity.distribution.releaseStatus === "HOLD"
      && identity.archive.byteLength === zipBytes.byteLength
      && identity.archive.sha256 === sha256(zipBytes),
    "External package identity does not match the INTERNAL/HOLD archive")
    check(stable(identity.archive.files) === stable(sortedIdentities(expectedFiles)),
      "External archive file identities differ from the expected plan")
  }
  return actual
}

export function createPackageArchive(files: FileMap): Buffer {
  validateFilePlan(files)
  const zippable = Object.fromEntries([...files].sort(([left], [right]) => left.localeCompare(right))
    .map(([path, bytes]) => [path, bytes]))
  const bytes = Buffer.from(zipSync(zippable, {
    level: 6,
    mtime: new Date("1980-01-01T00:00:00.000Z"),
  }))
  check(bytes.byteLength <= MAX_PACKAGE_BYTES, "Package exceeds the Chrome Web Store size ceiling")
  return bytes
}

export function verifyIdentityRecord(actual: unknown, expected: unknown): void {
  check(stable(actual) === stable(expected), "External package identity differs from the current source and distribution plan")
}

export function assertNoSensitiveContent(files: FileMap): void {
  const localPath = /(?<![A-Za-z0-9+.-])[A-Za-z]:[\\/](?!\/)[^\s"'<>]+|\\\\\?\\[A-Za-z]:[\\/][^\s"'<>]+|\\\\[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\\[A-Za-z0-9$._-]+(?:\\[^\s"'<>]+)?|\/(?:Users|home|tmp|var\/tmp|private\/tmp)\/[^\s"'<>]+/i
  const secret = /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|sk-[A-Za-z0-9_-]{32,}|Bearer\s+[A-Za-z0-9._~+\/=-]{24,}|ya29\.[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA|EC|OPENSSH|DSA) PRIVATE KEY-----|["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|cookie)["']?\s*[:=]\s*["']?[A-Za-z0-9._~+\/=-]{24,})/i
  for (const [path, bytes] of files) {
    const text = bytes.toString("latin1")
    check(!localPath.test(text), `Local absolute path found in package member: ${path}`)
    check(!secret.test(text), `Secret-like credential found in package member: ${path}`)
  }
}

function inventoryArtifact(artifactDir: string, build: Parameters<typeof verifyArtifact>[1]): Map<string, Buffer> {
  verifyArtifact(artifactDir, build)
  return inventory(artifactDir)
}

function readGitIdentity(): { commit: string, tree: string } {
  const output = execFileSync("git", ["rev-parse", "HEAD", "HEAD^{tree}"], { cwd: ROOT, encoding: "utf8" })
    .trim().split(/\r?\n/)
  check(output.length === 2 && /^[a-f0-9]{40}$/.test(output[0]!) && /^[a-f0-9]{40}$/.test(output[1]!),
    "Unable to read current Git source identity")
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: ROOT, encoding: "utf8" })
  check(dirty.length === 0, "Packaging requires a committed, clean source tree")
  return { commit: output[0]!, tree: output[1]! }
}

function requireProductManifest(productFiles: FileMap, version: string): void {
  const bytes = productFiles.get("manifest.json")
  check(bytes, "Verified production manifest is missing from the ZIP plan")
  const manifest = JSON.parse(bytes.toString("utf8")) as { manifest_version?: number, version?: string }
  check(manifest.manifest_version === 3 && manifest.version === version,
    "Production manifest target or version differs from package identity")
}

function getCurrentPlan(artifactDir: string) {
  const candidate = loadCandidate()
  const recordedScope = JSON.parse(readFileSync(join(ROOT, EVIDENCE, "distribution-scope-v3.json"), "utf8"))
  const recordedLedger = JSON.parse(readFileSync(join(ROOT, EVIDENCE, "candidate-ledger.json"), "utf8"))
  check(stable(recordedScope) === stable(candidate.scope),
    "Recorded distribution scope differs from the freshly derived candidate")
  check(stable(recordedLedger) === stable(candidate.ledger),
    "Recorded candidate ledger differs from the freshly derived candidate")
  const productFiles = inventoryArtifact(artifactDir, candidate.inputs.build)
  const noticePlan = noticeFiles(candidate.inputs, candidate.scope, true)
  check(noticePlan.blockers.length === 0 && noticePlan.status === STATUS,
    `Third-party notice plan is blocked: ${noticePlan.blockers.join("; ")}`)
  check(noticePlan.releaseBlockers.length > 0, "Expected the current project-rights release HOLD")
  const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version as string
  check(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version), "Invalid extension version")
  requireProductManifest(productFiles, version)
  const archiveFiles = new Map(productFiles)
  for (const [path, bytes] of noticePlan.files) {
    check(!archiveFiles.has(path), `Product/notice path collision: ${path}`)
    archiveFiles.set(path, bytes)
  }
  archiveFiles.set(HOLD_MARKER, Buffer.from([
    "INTERNAL VALIDATION PACKAGE — NOT FOR RELEASE.",
    `Status: ${STATUS}`,
    "Project rights and project licensing policy remain on HOLD.",
    "This package does not grant release approval or upload authorization.",
    "",
  ].join("\n"), "utf8"))
  assertNoSensitiveContent(archiveFiles)
  return { candidate, productFiles, noticeFiles: noticePlan.files, archiveFiles, noticePlan, version }
}

function hashFile(path: string): string {
  return sha256(readFileSync(path))
}

function ensureDirectory(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
  const stat = lstatSync(path)
  check(stat.isDirectory() && !stat.isSymbolicLink(), `Expected a non-symlink directory: ${path}`)
}

function assertChildPath(parent: string, child: string): void {
  const rel = relative(resolve(parent), resolve(child))
  check(rel !== "" && !isAbsolute(rel) && rel.split(/[\\/]/)[0] !== "..", "Output path must be a fresh child directory")
}

export function publishPackageAtomically(
  parent: string,
  destinationName: string,
  zipBytes: Buffer,
  identityBytes: Buffer,
  expectedFiles: FileMap,
  expectedIdentity: ReturnType<typeof createPackageIdentity>,
): string {
  check(/^[A-Za-z0-9_.-]+$/.test(destinationName), "Invalid package destination name")
  ensureDirectory(parent)
  const outputDir = join(resolve(parent), destinationName)
  assertChildPath(parent, outputDir)
  check(!existsSync(outputDir), `Refusing to overwrite existing package output: ${outputDir}`)
  let stage = ""
  try {
    stage = mkdtempSync(join(resolve(parent), `.vsa-package-${randomUUID()}-`))
    const zipPath = join(stage, ZIP_FILE)
    const identityPath = join(stage, IDENTITY_FILE)
    writeFileSync(zipPath, zipBytes, { flag: "wx" })
    writeFileSync(identityPath, identityBytes, { flag: "wx" })
    const identity = JSON.parse(readFileSync(identityPath, "utf8")) as ReturnType<typeof createPackageIdentity>
    verifyIdentityRecord(identity, expectedIdentity)
    verifyPackageArchive(readFileSync(zipPath), expectedFiles, identity)
    const inventory = readdirSync(stage).sort()
    check(stable(inventory) === stable([IDENTITY_FILE, ZIP_FILE].sort()), "Staging contains unexpected package files")
    renameSync(stage, outputDir)
    stage = ""
    return outputDir
  } finally {
    if (stage && existsSync(stage)) {
      assertChildPath(parent, stage)
      rmSync(stage, { recursive: true, force: true })
    }
  }
}

function internalOutputDirectory(version: string, commit: string): string {
  return join(ROOT, "dist", `video-summary-assistant-${version}-INTERNAL-HOLD-${commit.slice(0, 12)}`)
}

function readIdentity(bytes: Buffer): ReturnType<typeof createPackageIdentity> {
  const value = JSON.parse(bytes.toString("utf8")) as ReturnType<typeof createPackageIdentity>
  check(value && value.schema === "vsa-release-package-identity/v1", "Invalid package identity schema")
  return value
}

function makeIdentity(
  git: { commit: string, tree: string },
  plan: ReturnType<typeof getCurrentPlan>,
  zipBytes: Uint8Array,
) {
  return createPackageIdentity({
    sourceCommit: git.commit,
    sourceTree: git.tree,
    productFiles: plan.productFiles,
    noticeFiles: plan.noticeFiles,
    zipBytes,
    archiveFiles: plan.archiveFiles,
    version: plan.version,
    scopeSha256: hashFile(join(ROOT, EVIDENCE, "distribution-scope-v3.json")),
    ledgerSha256: hashFile(join(ROOT, EVIDENCE, "candidate-ledger.json")),
    releaseBlockers: plan.noticePlan.releaseBlockers,
  })
}

export function createInternalPackage(artifactDir = join(ROOT, "build/chrome-mv3-prod")): {
  directory: string
  zipPath: string
  identityPath: string
  identity: ReturnType<typeof createPackageIdentity>
} {
  const git = readGitIdentity()
  const plan = getCurrentPlan(artifactDir)
  const zipBytes = createPackageArchive(plan.archiveFiles)
  const identity = makeIdentity(git, plan, zipBytes)
  const outputName = `video-summary-assistant-${plan.version}-INTERNAL-HOLD-${git.commit.slice(0, 12)}`
  const directory = publishPackageAtomically(
    join(ROOT, "dist"),
    outputName,
    zipBytes,
    Buffer.from(`${JSON.stringify(identity, null, 2)}\n`, "utf8"),
    plan.archiveFiles,
    identity,
  )
  return {
    directory,
    zipPath: join(directory, ZIP_FILE),
    identityPath: join(directory, IDENTITY_FILE),
    identity,
  }
}

export function verifyInternalPackage(
  artifactDir = join(ROOT, "build/chrome-mv3-prod"),
  packageDir?: string,
): ReturnType<typeof createPackageIdentity> {
  const git = readGitIdentity()
  const plan = getCurrentPlan(artifactDir)
  const directory = packageDir ?? internalOutputDirectory(plan.version, git.commit)
  const stat = lstatSync(directory)
  check(stat.isDirectory() && !stat.isSymbolicLink(), "Package output must be a regular directory")
  const entries = readdirSync(directory).sort()
  check(stable(entries) === stable([IDENTITY_FILE, ZIP_FILE].sort()), "Package output contains missing or extra files")
  const zipBytes = readFileSync(join(directory, ZIP_FILE))
  const actual = readIdentity(readFileSync(join(directory, IDENTITY_FILE)))
  const expected = makeIdentity(git, plan, zipBytes)
  verifyIdentityRecord(actual, expected)
  verifyPackageArchive(zipBytes, plan.archiveFiles, expected)
  return expected
}

export function refuseFormalPackage(artifactDir = join(ROOT, "build/chrome-mv3-prod")): never {
  const git = readGitIdentity()
  const plan = getCurrentPlan(artifactDir)
  const identity = makeIdentity(git, plan, Buffer.alloc(0))
  check(identity.package.type === "INTERNAL" && identity.distribution.releaseApproved === false,
    "Formal release qualification is unavailable")
  throw new Error(`Formal package refused: ${plan.noticePlan.status}; releaseStatus=HOLD; project-rights blockers=${plan.noticePlan.releaseBlockers.length}. PR-5 qualification is required.`)
}

export const releasePackageConstants = {
  root: ROOT,
  evidence: EVIDENCE,
  buildIdentitySha256: BUILD_IDENTITY_SHA256,
  buildSourceCommit: BUILD_SOURCE_COMMIT,
  buildSourceTree: BUILD_SOURCE_TREE,
  maxPackageBytes: MAX_PACKAGE_BYTES,
  holdMarker: HOLD_MARKER,
  zipFile: ZIP_FILE,
  identityFile: IDENTITY_FILE,
  status: STATUS,
}
