import { createHash } from "node:crypto"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { isAbsolute, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

type UnknownRecord = Record<string, unknown>

const MATERIAL_PREFIX = "licenses/third-party/materials/"
const EXPECTED_SCHEMA = "vsa-third-party-license-ledger/v1"
const FIXED_MAIN_BASELINE = "4a328851f2b0ca745c9f757125fa112ac7bada62"
const EXPECTED_PACKAGE_JSON_SHA256 = "7050aee1c63bad4be656c439c4fcc6341d26625971c51941843b994d7ecc860c"
const EXPECTED_BUN_LOCK_SHA256 = "ea283b89e2b0b233e4b65df1e1d9f28c27b7f74e270a6fe42f3770f8ff901bf4"
// The audit hashes above are for CRLF checkout bytes. These also pin the LF
// Git blobs shared by the P01/P02 baseline and the PR1 target.
const GIT_PACKAGE_JSON_SHA256 = "40b4b34e6479bd920e6783138f3b60a242961e695540f41c9c76aab540166c58"
const GIT_BUN_LOCK_SHA256 = "8ceb0e96b0ccc5f0b4081ee01dbeeda4b56ab1edfede1bc64f94b6006e913cf9"
const EXPECTED_P02_ZIP_SHA256 = "5ee61c825a2189018ab24050774813ff742a34a987de18d961e25a276c213343"
const EXPECTED_COUNTS = {
  npmPackageDirectoryIdentities: 74,
  requiredPackageDirectoryIdentities: 70,
  requiredNameVersions: 65,
  requiredEdges: 243,
  optionalOnlyPackageDirectoryIdentities: 4,
  expandedNameVersions: 69,
  expandedEdges: 316,
  nonNpmComponents: 4,
  totalComponents: 78,
}
const PINNED_EVIDENCE = [
  {
    path: "docs/licensing/evidence/R002-F01-R2-versioned-runtime-closure.json",
    sha256: "b2a8e84bc9378a86bdc1c6a56acae0b94f87ee02f27ece33d4a9f77204bc8ae0",
    manifestField: "historicalManifestSha256",
  },
  {
    path: "docs/licensing/evidence/R002-P02-distribution-component-matrix.json",
    sha256: "3ece663b920012a11d8ce009401d3d064a86176cceaf7e015d182bb981d917c9",
    archiveSha256: EXPECTED_P02_ZIP_SHA256,
  },
] as const
const VERIFIED_LICENSE_STATES = new Set([
  "VERIFIED_TARBALL_TEXT",
  "VERIFIED_UPSTREAM_ROOT_TEXT",
])
const LICENSE_STATES = [
  "VERIFIED_TARBALL_TEXT",
  "VERIFIED_UPSTREAM_ROOT_TEXT",
  "PARTIAL_SOURCE_TEXT",
  "DECLARATION_ONLY",
  "UNRESOLVED",
  "REFERENCE_ONLY",
  "NOT_APPLICABLE",
]

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value)
}

function isGitObjectId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value)
}

function isSafeRelativePath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && !value.includes("\\")
    && !isAbsolute(value)
    && !value.split("/").some((part) => !part || part === "." || part === "..")
}

function isSha512Integrity(value: unknown): value is string {
  if (typeof value !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(value)) return false
  const encoded = value.slice("sha512-".length)
  if (!/^[A-Za-z0-9+/]{86}==$/.test(encoded)) return false
  const decoded = Buffer.from(encoded, "base64")
  return decoded.byteLength === 64 && decoded.toString("base64") === encoded
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function gitBlobSha1(bytes: Uint8Array): string {
  const header = Buffer.from(`blob ${bytes.byteLength}\0`)
  return createHash("sha1").update(header).update(bytes).digest("hex")
}

function validateMaterialPath(root: string, relativePath: unknown): string | null {
  if (typeof relativePath !== "string" || !relativePath.startsWith(MATERIAL_PREFIX)) return null
  if (!isSafeRelativePath(relativePath)) return null

  const rootPath = resolve(root)
  const materialRoot = resolve(rootPath, MATERIAL_PREFIX)
  const candidate = resolve(rootPath, ...relativePath.split("/"))
  if (candidate !== materialRoot && !candidate.startsWith(`${materialRoot}${sep}`)) return null
  return candidate
}

function findEvidence(component: UnknownRecord, kind: string): UnknownRecord[] {
  if (!Array.isArray(component.sourceEvidence)) return []
  return component.sourceEvidence.filter((item): item is UnknownRecord =>
    isRecord(item) && item.kind === kind)
}

function hasExactTarballMaterial(
  component: UnknownRecord,
  release: UnknownRecord,
  material: UnknownRecord,
  materialId: string,
  role: "license" | "notice",
): boolean {
  const legalFiles = Array.isArray(release.legalFiles)
    ? release.legalFiles.filter(isRecord)
    : []
  const sourceArtifacts = Array.isArray(material.sourceArtifacts)
    ? material.sourceArtifacts.filter(isRecord)
    : []
  const expectedMaterialKind = role === "license" ? "license-text" : "notice-text"
  const expectedArtifactKind = role === "license" ? "npm-tarball-license" : "npm-tarball-notice"

  if (material.kind !== expectedMaterialKind) return false
  if (!Array.isArray(material.applicableScopes)
    || !material.applicableScopes.includes(`${String(component.name)}@${String(component.version)}`)) {
    return false
  }

  return legalFiles.some((file) => {
    if (file.materialId !== materialId
      || file.sha256 !== material.sha256
      || file.byteLength !== material.byteLength
      || typeof file.tarballPath !== "string") {
      return false
    }
    if (role === "notice" && !/(?:^|\/)NOTICE(?:\.[^/]*)?$/i.test(file.tarballPath)) return false

    return sourceArtifacts.some((artifact) =>
      artifact.kind === expectedArtifactKind
      && artifact.registryTarballUrl === release.registryTarballUrl
      && artifact.tarballSha256 === release.tarballSha256
      && artifact.tarballPath === file.tarballPath
      && artifact.packageName === component.name
      && artifact.packageVersion === component.version)
  })
}

function repositorySlug(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null
  const normalized = value.trim().replace(/^git\+/, "")
  const github = normalized.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/|$)/i)
  if (github) return github[1].toLowerCase()
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) return normalized.toLowerCase()
  return null
}

interface FixedLicenseSource {
  repository: string
  commit: string
  path: string
  gitBlob: string
  sha256: string
  materialId: string
}

function fixedLicenseSource(
  root: string,
  source: UnknownRecord,
  component: UnknownRecord,
  license: UnknownRecord,
  materials: Map<string, UnknownRecord>,
): FixedLicenseSource | null {
  const rootLicense = isRecord(source.rootLicense) ? source.rootLicense : source
  const repository = repositorySlug(source.repository)
  const commit = typeof source.versionReleaseCommit === "string" ? source.versionReleaseCommit : source.commit
  const path = typeof rootLicense.path === "string"
    ? rootLicense.path
    : source.licensePath
  const gitBlob = typeof rootLicense.gitBlob === "string"
    ? rootLicense.gitBlob
    : source.licenseGitBlob
  const digest = typeof rootLicense.sha256 === "string"
    ? rootLicense.sha256
    : source.licenseSha256
  const materialId = typeof rootLicense.materialId === "string"
    ? rootLicense.materialId
    : source.licenseMaterialId
  const url = typeof rootLicense.url === "string"
    ? rootLicense.url
    : source.licenseUrl

  if (!repository
    || !isGitObjectId(commit)
    || !isSafeRelativePath(path)
    || !isGitObjectId(gitBlob)
    || !isSha256(digest)
    || materialId !== `sha256:${digest}`
    || typeof url !== "string"
    || !url.includes(commit)
    || !url.replace(/\\/g, "/").includes(path)) {
    return null
  }
  if (component.kind === "source-component"
    && (!isGitObjectId(source.tree) || component.version !== source.commit)) {
    return null
  }

  const licenseIds = Array.isArray(license.licenseMaterialIds) ? license.licenseMaterialIds : []
  const material = materials.get(materialId)
  if (!licenseIds.includes(materialId)
    || !material
    || material.kind !== "license-text"
    || material.sha256 !== digest
    || !Array.isArray(material.sourceArtifacts)) {
    return null
  }
  const materialPath = validateMaterialPath(root, material.path)
  if (!materialPath || !existsSync(materialPath)) return null
  let materialBytes: Buffer
  try {
    const materialRoot = realpathSync(resolve(root, "licenses", "third-party", "materials"))
    const resolvedMaterial = realpathSync(materialPath)
    if (resolvedMaterial !== materialRoot && !resolvedMaterial.startsWith(`${materialRoot}${sep}`)) return null
    materialBytes = readFileSync(resolvedMaterial)
  } catch {
    return null
  }
  if (sha256(materialBytes) !== digest || gitBlobSha1(materialBytes) !== gitBlob) return null

  const sourceArtifactMatches = material.sourceArtifacts.some((artifact: unknown) =>
    isRecord(artifact)
    && artifact.kind === "license-text"
    && repositorySlug(artifact.repository) === repository
    && artifact.commit === commit
    && artifact.gitBlob === gitBlob
    && (artifact.path === undefined || artifact.path === path)
    && (artifact.sha256 === undefined || artifact.sha256 === digest)
    && (artifact.materialId === undefined || artifact.materialId === materialId)
    && artifact.url === url)
  if (!sourceArtifactMatches) return null

  return { repository, commit, path, gitBlob, sha256: digest, materialId }
}

function validateVerifiedUpstreamLicense(
  root: string,
  component: UnknownRecord,
  license: UnknownRecord,
  registryRelease: UnknownRecord | undefined,
  materials: Map<string, UnknownRecord>,
  errors: string[],
  componentIndex: number,
): void {
  const fixedSources = findEvidence(component, "fixed-upstream-source")
  const validMappings = fixedSources
    .map((source) => ({ source, fixed: fixedLicenseSource(root, source, component, license, materials) }))
    .filter((entry): entry is { source: UnknownRecord; fixed: FixedLicenseSource } => entry.fixed !== null)
  if (validMappings.length === 0) {
    errors.push(`components[${componentIndex}] verified upstream license requires a complete fixed-source license mapping`)
    return
  }

  const applicableMappings = component.kind !== "npm-package" ? validMappings : validMappings.filter(({ source, fixed }) => {
    if (!registryRelease || !isRecord(registryRelease.repository)
      || fixed.repository !== repositorySlug(registryRelease.repository.url)) return false
    const packageManifest = source.packageManifest
    const registryManifest = registryRelease.packageManifest
    const registryGitHead = source.registryGitHead
    const sourceMap = source.tarballSourceMapBlobMatches
    if (!isRecord(packageManifest)
      || !isRecord(registryManifest)
      || !isGitObjectId(registryGitHead)
      || registryGitHead !== registryRelease.npmGitHead
      || typeof source.registryGitHeadUrl !== "string"
      || !source.registryGitHeadUrl.includes(registryGitHead)
      || typeof source.versionReleaseCommitUrl !== "string"
      || !source.versionReleaseCommitUrl.includes(fixed.commit)
      || !isSafeRelativePath(packageManifest.path)
      || !isGitObjectId(packageManifest.gitBlob)
      || !isSha256(packageManifest.sha256)
      || packageManifest.name !== component.name
      || packageManifest.version !== component.version
      || packageManifest.declaredLicense !== license.declared
      || registryManifest.version !== component.version
      || registryManifest.declaredLicense !== license.declared
      || typeof packageManifest.url !== "string"
      || !packageManifest.url.includes(fixed.commit)
      || !packageManifest.url.replace(/\\/g, "/").includes(packageManifest.path)
      || !isRecord(sourceMap)
      || Object.keys(sourceMap).length === 0
      || source.tarballSourceMapTarballSha256 !== registryRelease.tarballSha256
      || source.tarballSourceMapRegistryTarballUrl !== registryRelease.registryTarballUrl) {
      return false
    }

    const packageSourcePrefix = packageManifest.path.replace(/\/package\.json$/, "")
    return Object.entries(sourceMap).every(([path, blob]) =>
      isSafeRelativePath(path)
      && path.startsWith(`${packageSourcePrefix}/`)
      && isGitObjectId(blob))
  })

  if (applicableMappings.length === 0) {
    errors.push(`components[${componentIndex}] verified upstream npm license is not mapped to this exact published package`)
    return
  }
  const licenseRefs = Array.isArray(license.licenseMaterialIds) ? license.licenseMaterialIds : []
  if (licenseRefs.some((id) => !applicableMappings.some(({ fixed }) => fixed.materialId === id))) {
    errors.push(`components[${componentIndex}] upstream license material has no matching fixed-source mapping`)
  }
}

function addReferenceTypeErrors(
  refs: unknown[],
  materials: Map<string, UnknownRecord>,
  kind: "license-text" | "notice-text",
  role: "license" | "notice",
  index: number,
  errors: string[],
): void {
  for (const materialId of refs) {
    if (typeof materialId !== "string") continue
    const material = materials.get(materialId)
    if (material && material.kind !== kind) {
      errors.push(`components[${index}] ${role} reference has the wrong material type`)
    }
  }
}

export function validateLicenseLedgerDocument(root: string, ledger: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(ledger)) return ["ledger must be an object"]
  if (ledger.schema !== EXPECTED_SCHEMA) errors.push("unsupported ledger schema")

  const materials = Array.isArray(ledger.licenseMaterials) ? ledger.licenseMaterials : []
  const components = Array.isArray(ledger.components) ? ledger.components : []
  if (!Array.isArray(ledger.licenseMaterials)) errors.push("licenseMaterials must be an array")
  if (!Array.isArray(ledger.components)) errors.push("components must be an array")

  const materialById = new Map<string, UnknownRecord>()
  const supportedMaterialKinds = new Set(["license-text", "notice-text", "source-provenance-record"])
  for (const [index, value] of materials.entries()) {
    if (!isRecord(value)) {
      errors.push(`licenseMaterials[${index}] must be an object`)
      continue
    }
    const id = value.materialId
    const digest = value.sha256
    const path = value.path
    if (typeof id === "string" && materialById.has(id)) errors.push(`duplicate materialId: ${id}`)
    if (typeof id === "string") materialById.set(id, value)
    if (!isSha256(digest)) errors.push(`licenseMaterials[${index}] has invalid SHA-256`)
    if (typeof id === "string" && isSha256(digest) && id !== `sha256:${digest}`) {
      errors.push(`licenseMaterials[${index}] materialId does not match SHA-256`)
    }
    if (!supportedMaterialKinds.has(String(value.kind))) {
      errors.push(`licenseMaterials[${index}] has an unsupported material type`)
    }

    const candidate = validateMaterialPath(root, path)
    if (!candidate) {
      errors.push(`licenseMaterials[${index}] material path must stay under licenses/third-party/materials`)
      continue
    }
    if (!existsSync(candidate)) {
      errors.push(`licenseMaterials[${index}] referenced file does not exist`)
      continue
    }

    try {
      const realRoot = realpathSync(resolve(root, "licenses", "third-party", "materials"))
      const realFile = realpathSync(candidate)
      if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${sep}`)) {
        errors.push(`licenseMaterials[${index}] resolves outside licenses/third-party/materials`)
        continue
      }
      const bytes = readFileSync(realFile)
      const actual = sha256(bytes)
      if (actual !== digest) errors.push(`licenseMaterials[${index}] material SHA-256 mismatch`)
      if (typeof value.byteLength === "number" && value.byteLength !== bytes.byteLength) {
        errors.push(`licenseMaterials[${index}] byteLength mismatch`)
      }
    } catch {
      errors.push(`licenseMaterials[${index}] could not be read safely`)
    }
  }

  const componentIds = new Set<string>()
  const packageIdentities = new Set<string>()
  let npmCount = 0
  for (const [index, value] of components.entries()) {
    if (!isRecord(value)) {
      errors.push(`components[${index}] must be an object`)
      continue
    }
    const id = value.componentId
    if (typeof id !== "string" || !id) errors.push(`components[${index}] requires componentId`)
    else if (componentIds.has(id)) errors.push(`duplicate componentId: ${id}`)
    else componentIds.add(id)

    const isNpm = value.kind === "npm-package"
    if (isNpm) {
      npmCount += 1
      for (const field of ["name", "version", "packageDirectoryIdentity", "packageDirectory"] as const) {
        if (typeof value[field] !== "string" || !value[field]) errors.push(`components[${index}] requires ${field}`)
      }
      const identity = value.packageDirectoryIdentity
      if (typeof identity === "string") {
        if (packageIdentities.has(identity)) errors.push(`duplicate packageDirectoryIdentity: ${identity}`)
        else packageIdentities.add(identity)
        if (typeof value.packageDirectory === "string" && identity !== `${value.packageDirectory}/package.json`) {
          errors.push(`components[${index}] packageDirectoryIdentity does not match packageDirectory`)
        }
      }
      const relationship = value.dependencyRelationship
      if (!isRecord(relationship)
        || typeof relationship.requiredClosureMember !== "boolean"
        || typeof relationship.optionalOnlyClosureMember !== "boolean"
        || !["direct", "transitive"].includes(String(relationship.directness))
        || !Array.isArray(relationship.reachability)
        || relationship.reachability.length === 0) {
        errors.push(`components[${index}] has invalid dependencyRelationship`)
      }
      if (isRecord(relationship)
        && relationship.requiredClosureMember === true
        && relationship.optionalOnlyClosureMember === true) {
        errors.push(`components[${index}] cannot be required and optional-only`)
      }
      if (isRecord(relationship)) {
        const closureStatus = value.installedClosureMembership
        if (relationship.requiredClosureMember === true && closureStatus !== "REQUIRED") {
          errors.push(`components[${index}] required closure membership is inconsistent`)
        }
        if (relationship.optionalOnlyClosureMember === true && closureStatus !== "OPTIONAL_ONLY") {
          errors.push(`components[${index}] optional-only closure membership is inconsistent`)
        }
        if (relationship.requiredClosureMember !== true && relationship.optionalOnlyClosureMember !== true
          && !["UNKNOWN", "NOT_IN_CLOSURE"].includes(String(closureStatus))) {
          errors.push(`components[${index}] non-member closure status is inconsistent`)
        }
      }
    } else if (value.kind !== "source-component" && value.kind !== "source-asset") {
      errors.push(`components[${index}] has unsupported kind`)
    }

    const membership = value.actualBundleMembership
    if (!["UNKNOWN", "CONFIRMED_INCLUDED", "CONFIRMED_EXCLUDED"].includes(String(membership))) {
      errors.push(`components[${index}] has invalid actualBundleMembership`)
    } else if (membership !== "UNKNOWN") {
      if (typeof value.bundleMembershipEvidence !== "string" || !value.bundleMembershipEvidence.trim()) {
        errors.push(`components[${index}] confirmed bundle membership requires direct evidence`)
      }
    }

    let registryRelease: UnknownRecord | undefined
    if (isNpm) {
      if (!isSha256(value.installedManifestSha256)) {
        errors.push(`components[${index}] requires installedManifestSha256`)
      }

      const releases = findEvidence(value, "npm-registry-release")
      if (releases.length !== 1) {
        errors.push(`components[${index}] requires exactly one npm registry release evidence record`)
      } else {
        registryRelease = releases[0]
        if (typeof registryRelease.registryVersionUrl !== "string"
          || typeof registryRelease.registryTarballUrl !== "string") {
          errors.push(`components[${index}] requires exact registry version and tarball URLs`)
        } else if (registryRelease.registryVersionUrl !== expectedNpmVersionUrl(String(value.name), String(value.version))
          || registryRelease.registryTarballUrl !== expectedNpmTarballUrl(String(value.name), String(value.version))) {
          errors.push(`components[${index}] registry URLs do not identify the exact npm package version`)
        }
        if (!isSha512Integrity(registryRelease.tarballIntegrity)) {
          errors.push(`components[${index}] npm SHA-512 integrity must decode to exactly 64 bytes`)
        }
        const lockIntegrities = Array.isArray(registryRelease.bunLockIntegrityValues)
          ? registryRelease.bunLockIntegrityValues
          : []
        if (registryRelease.lockIntegrityMatches !== true
          || !lockIntegrities.includes(registryRelease.tarballIntegrity)) {
          errors.push(`components[${index}] npm tarball integrity is not matched to bun.lock`)
        }
        if (lockIntegrities.some((integrity) => !isSha512Integrity(integrity))) {
          errors.push(`components[${index}] bun.lock SHA-512 integrity must decode to exactly 64 bytes`)
        }
        if (!isSha256(registryRelease.tarballSha256)) {
          errors.push(`components[${index}] requires npm tarball SHA-256`)
        }
        const packageManifest = registryRelease.packageManifest
        if (!isRecord(packageManifest)
          || packageManifest.version !== value.version
          || packageManifest.declaredLicense !== (isRecord(value.license) ? value.license.declared : undefined)
          || !isSha256(packageManifest.sha256)) {
          errors.push(`components[${index}] exact tarball package manifest evidence is incomplete or inconsistent`)
        } else if (packageManifest.sha256 !== value.installedManifestSha256
          || registryRelease.npmRegistryLicense !== (isRecord(value.license) ? value.license.npmRegistryDeclared : undefined)) {
          errors.push(`components[${index}] tarball manifest identity or registry license declaration is inconsistent`)
        }
      }
    }

    const license = value.license
    if (!isRecord(license)) {
      errors.push(`components[${index}] requires license object`)
      continue
    }
    const evidenceStatus = license.evidenceStatus
    if (!LICENSE_STATES.includes(String(evidenceStatus))) {
      errors.push(`components[${index}] has invalid license evidenceStatus`)
    }
    const licenseRefs = Array.isArray(license.licenseMaterialIds) ? license.licenseMaterialIds : []
    const noticeRefs = Array.isArray(license.noticeMaterialIds) ? license.noticeMaterialIds : []
    const relatedRefs = Array.isArray(license.relatedMaterialIds) ? license.relatedMaterialIds : []
    for (const materialId of [...licenseRefs, ...noticeRefs, ...relatedRefs]) {
      if (typeof materialId !== "string" || !materialById.has(materialId)) {
        errors.push(`components[${index}] references missing license material: ${String(materialId)}`)
      }
    }
    addReferenceTypeErrors(licenseRefs, materialById, "license-text", "license", index, errors)
    addReferenceTypeErrors(noticeRefs, materialById, "notice-text", "notice", index, errors)

    if (isNpm && registryRelease) {
      for (const materialId of noticeRefs) {
        const material = typeof materialId === "string" ? materialById.get(materialId) : undefined
        if (typeof materialId !== "string"
          || !material
          || !hasExactTarballMaterial(value, registryRelease, material, materialId, "notice")) {
          errors.push(`components[${index}] notice material is not sourced from this exact npm package version`)
          break
        }
      }
    }
    if (VERIFIED_LICENSE_STATES.has(String(evidenceStatus))) {
      if (licenseRefs.length === 0) errors.push(`components[${index}] verified license evidence requires license material`)
      if (evidenceStatus === "VERIFIED_TARBALL_TEXT") {
        if (!isNpm || !registryRelease) {
          errors.push(`components[${index}] verified license evidence requires npm registry release evidence`)
        } else {
          for (const materialId of licenseRefs) {
            const material = typeof materialId === "string" ? materialById.get(materialId) : undefined
            if (typeof materialId !== "string"
              || !material
              || !hasExactTarballMaterial(value, registryRelease, material, materialId, "license")) {
              errors.push(`components[${index}] verified tarball license must reference legalFiles from its exact npm release`)
              break
            }
          }
        }
      }
      if (evidenceStatus === "VERIFIED_UPSTREAM_ROOT_TEXT") {
        validateVerifiedUpstreamLicense(
          root,
          value,
          license,
          registryRelease,
          materialById,
          errors,
          index,
        )
      }
    }
  }

  if (isRecord(ledger.expectedCounts)) {
    if (ledger.expectedCounts.npmPackageDirectoryIdentities !== npmCount) {
      errors.push("npm package-directory identity count does not match expectedCounts")
    }
    const nonNpmCount = components.filter(
      (component) => isRecord(component) && component.kind !== "npm-package",
    ).length
    if (typeof ledger.expectedCounts.nonNpmComponents === "number"
      && ledger.expectedCounts.nonNpmComponents !== nonNpmCount) {
      errors.push("non-npm component count does not match expectedCounts")
    }
    if (typeof ledger.expectedCounts.totalComponents === "number"
      && ledger.expectedCounts.totalComponents !== components.length) {
      errors.push("component count does not match expectedCounts")
    }
    if (isRecord(ledger.dependencyClosure)
      && ledger.dependencyClosure.componentsByDirectoryIdentity === 74
      && npmCount !== 74) {
      errors.push("expected exactly 74 npm package-directory identities")
    }
  } else {
    errors.push("expectedCounts must be an object")
  }

  return errors
}

interface LockPackageIntegrity {
  packageVersionIdentity: string
  integrity: string
}

function expectedNpmVersionUrl(name: string, version: string): string {
  return `https://registry.npmjs.org/${name.replace("/", "%2F")}/${version}`
}

function expectedNpmTarballUrl(name: string, version: string): string {
  const packageLeaf = name.slice(name.lastIndexOf("/") + 1)
  return `https://registry.npmjs.org/${name}/-/${packageLeaf}-${version}.tgz`
}

function parseBunLockPackageEntries(lockText: string): LockPackageIntegrity[] {
  const marker = lockText.indexOf('"packages": {')
  if (marker < 0) return []
  const entries: LockPackageIntegrity[] = []
  const packageLines = lockText.slice(marker).split(/\r?\n/)
  for (const line of packageLines.slice(1)) {
    if (/^\s{2}\}\s*,?\s*$/.test(line)) break
    const identityMatch = line.match(/^\s{4}"((?:\\.|[^"\\])*)"\s*:\s*\[\s*"((?:\\.|[^"\\])*)"/)
    if (!identityMatch) continue
    const integrityMatch = line.match(/,\s*"(sha512-[A-Za-z0-9+/]+={0,2})"\s*\],?\s*$/)
    if (!integrityMatch) continue
    try {
      entries.push({
        packageVersionIdentity: JSON.parse(`"${identityMatch[2]}"`) as string,
        integrity: integrityMatch[1],
      })
    } catch {
      continue
    }
  }
  return entries
}

function matchingLockIntegrities(
  entries: LockPackageIntegrity[],
  name: string,
  version: string,
): string[] {
  const identity = `${name}@${version}`
  return [...new Set(entries
    .filter((entry) => entry.packageVersionIdentity === identity
      || entry.packageVersionIdentity.startsWith(`${identity}(`)
      || entry.packageVersionIdentity.startsWith(`${identity}_`))
    .map((entry) => entry.integrity))]
    .sort()
}

function readPinnedJson(root: string, relativePath: string, expectedHash: string, errors: string[]): UnknownRecord | null {
  const path = resolve(root, ...relativePath.split("/"))
  try {
    const bytes = readFileSync(path)
    if (sha256(bytes) !== expectedHash) {
      errors.push(`accepted evidence file does not match its pinned SHA-256: ${relativePath}`)
      return null
    }
    const parsed: unknown = JSON.parse(bytes.toString("utf8"))
    if (!isRecord(parsed)) {
      errors.push(`accepted evidence file must contain an object: ${relativePath}`)
      return null
    }
    return parsed
  } catch {
    errors.push(`accepted evidence file is missing or invalid: ${relativePath}`)
    return null
  }
}

function validateFixedClosure(root: string, ledger: UnknownRecord, errors: string[]): void {
  const closure = readPinnedJson(root, PINNED_EVIDENCE[0].path, PINNED_EVIDENCE[0].sha256, errors)
  const matrix = readPinnedJson(root, PINNED_EVIDENCE[1].path, PINNED_EVIDENCE[1].sha256, errors)
  const dependencyClosure = ledger.dependencyClosure
  const expectedCounts = ledger.expectedCounts
  if (!isRecord(dependencyClosure) || !isRecord(expectedCounts)) {
    errors.push("ledger does not contain the accepted runtime closure summary")
    return
  }
  if (dependencyClosure.packageJsonSha256 !== EXPECTED_PACKAGE_JSON_SHA256
    || dependencyClosure.bunLockSha256 !== EXPECTED_BUN_LOCK_SHA256
    || !isRecord(dependencyClosure.unchangedFromP01Baseline)
    || dependencyClosure.unchangedFromP01Baseline.commit !== FIXED_MAIN_BASELINE
    || dependencyClosure.unchangedFromP01Baseline.packageJsonBlobSame !== true
    || dependencyClosure.unchangedFromP01Baseline.bunLockBlobSame !== true) {
    errors.push("ledger package.json and bun.lock identities differ from the accepted runtime closure")
  }

  const evidenceFiles = Array.isArray(dependencyClosure.evidenceFiles)
    ? dependencyClosure.evidenceFiles.filter(isRecord)
    : []
  for (const pinned of PINNED_EVIDENCE) {
    const reference = evidenceFiles.find((file) => file.path === pinned.path)
    if (!reference || reference.sha256 !== pinned.sha256) {
      errors.push(`ledger does not pin accepted closure evidence: ${pinned.path}`)
      continue
    }
    if ("manifestField" in pinned && reference[pinned.manifestField] !== pinned.sha256) {
      errors.push("ledger accepted closure manifest hash does not match the fixed evidence")
    }
    if ("archiveSha256" in pinned && reference.containingZipSha256 !== pinned.archiveSha256) {
      errors.push("ledger P02 matrix does not cite the accepted R002.zip SHA-256")
    }
  }

  if (expectedCounts.npmPackageDirectoryIdentities !== EXPECTED_COUNTS.npmPackageDirectoryIdentities
    || expectedCounts.nonNpmComponents !== EXPECTED_COUNTS.nonNpmComponents
    || expectedCounts.totalComponents !== EXPECTED_COUNTS.totalComponents) {
    errors.push("ledger expectedCounts differ from the fixed accepted component counts")
  }
  if (dependencyClosure.actualBrowserBundleMembership !== "UNKNOWN") {
    errors.push("ledger actual bundle membership must remain UNKNOWN")
  }

  const required = dependencyClosure.required
  const expanded = dependencyClosure.expandedOptional
  if (!isRecord(required)
    || required.packageDirectoryIdentities !== EXPECTED_COUNTS.requiredPackageDirectoryIdentities
    || required.nameVersions !== EXPECTED_COUNTS.requiredNameVersions
    || required.edges !== EXPECTED_COUNTS.requiredEdges
    || !isRecord(expanded)
    || expanded.packageDirectoryIdentities !== EXPECTED_COUNTS.npmPackageDirectoryIdentities
    || expanded.nameVersions !== EXPECTED_COUNTS.expandedNameVersions
    || expanded.edges !== EXPECTED_COUNTS.expandedEdges
    || expanded.optionalOnlyPackageDirectoryIdentities !== EXPECTED_COUNTS.optionalOnlyPackageDirectoryIdentities) {
    errors.push("ledger closure summary does not match the accepted runtime closure")
  }

  if (!closure || !matrix) return
  if (closure.baseline !== FIXED_MAIN_BASELINE
    || !isRecord(closure.requiredClosure)
    || closure.requiredClosure.versionedNodeCount !== EXPECTED_COUNTS.requiredPackageDirectoryIdentities
    || closure.requiredClosure.uniqueNameVersionCount !== EXPECTED_COUNTS.requiredNameVersions
    || !isRecord(closure.completeRuntimePlusOptionalPeerGraph)
    || closure.completeRuntimePlusOptionalPeerGraph.versionedNodeCount !== EXPECTED_COUNTS.npmPackageDirectoryIdentities
    || closure.completeRuntimePlusOptionalPeerGraph.uniqueNameVersionCount !== EXPECTED_COUNTS.expandedNameVersions
    || !isRecord(closure.optionalExpansion)
    || closure.optionalExpansion.optionalOnlyNodeCount !== EXPECTED_COUNTS.optionalOnlyPackageDirectoryIdentities) {
    errors.push("pinned F01 closure evidence does not contain the accepted runtime closure")
    return
  }
  if (matrix.baseline !== FIXED_MAIN_BASELINE || !Array.isArray(matrix.components)) {
    errors.push("pinned P02 matrix does not contain the fixed main baseline")
    return
  }

  const requiredNodes = Array.isArray(closure.requiredClosure.nodes)
    ? closure.requiredClosure.nodes.filter(isRecord)
    : []
  const allNodes = Array.isArray(closure.completeRuntimePlusOptionalPeerGraph.nodes)
    ? closure.completeRuntimePlusOptionalPeerGraph.nodes.filter(isRecord)
    : []
  const optionalOnlyNodes = Array.isArray(closure.optionalExpansion.optionalOnlyNodes)
    ? closure.optionalExpansion.optionalOnlyNodes.filter(isRecord)
    : []
  const matrixNpm = matrix.components.filter(
    (component: unknown) => isRecord(component) && component.distributionClass === "npm-package-directory",
  ) as UnknownRecord[]
  const matrixNonNpm = matrix.components.filter(
    (component: unknown) => isRecord(component) && component.distributionClass !== "npm-package-directory",
  )
  const components = Array.isArray(ledger.components) ? ledger.components.filter(isRecord) : []
  const npmComponents = components.filter((component) => component.kind === "npm-package")
  const nonNpmComponents = components.filter((component) => component.kind !== "npm-package")
  const packageBytes = readRepositoryFile(root, "package.json", errors)
  const lockBytes = readRepositoryFile(root, "bun.lock", errors)
  let runtimeRootDependencies: UnknownRecord = {}
  if (packageBytes) {
    if (![EXPECTED_PACKAGE_JSON_SHA256, GIT_PACKAGE_JSON_SHA256].includes(sha256(packageBytes))) {
      errors.push("actual package.json SHA-256 differs from the accepted runtime closure")
    }
    try {
      const parsed: unknown = JSON.parse(packageBytes.toString("utf8"))
      runtimeRootDependencies = isRecord(parsed) && isRecord(parsed.dependencies) ? parsed.dependencies : {}
    } catch {
      errors.push("actual package.json is not valid JSON")
    }
  }
  if (lockBytes && ![EXPECTED_BUN_LOCK_SHA256, GIT_BUN_LOCK_SHA256].includes(sha256(lockBytes))) {
    errors.push("actual bun.lock SHA-256 differs from the accepted runtime closure")
  }
  const uniqueNameVersions = new Set(npmComponents.map((component) => `${String(component.name)}@${String(component.version)}`))
  const componentByIdentity = new Map<string, UnknownRecord>()
  const matrixByIdentity = new Map<string, UnknownRecord>()
  const requiredIds = new Set<string>()
  const allIds = new Set<string>()
  const optionalOnlyIds = new Set<string>()

  for (const node of requiredNodes) {
    if (typeof node.identity === "string") requiredIds.add(node.identity)
  }
  for (const node of allNodes) {
    if (typeof node.identity !== "string") continue
    if (allIds.has(node.identity)) errors.push(`accepted runtime closure has duplicate identity: ${node.identity}`)
    allIds.add(node.identity)
    if (!Array.isArray(node.reachability)
      || !node.reachability.some((value) => value === "required" || value === "optional-expansion")) {
      errors.push(`accepted runtime closure has invalid reachability: ${node.identity}`)
    }
  }
  for (const node of optionalOnlyNodes) {
    if (typeof node.identity === "string") optionalOnlyIds.add(node.identity)
  }
  for (const component of npmComponents) {
    if (typeof component.packageDirectoryIdentity === "string") {
      componentByIdentity.set(component.packageDirectoryIdentity, component)
    }
  }
  for (const component of matrixNpm) {
    if (typeof component.installedIdentity === "string") {
      matrixByIdentity.set(component.installedIdentity, component)
    }
  }
  for (const component of components) {
    if (component.actualBundleMembership !== "UNKNOWN") {
      errors.push(`component ${String(component.componentId)} actual bundle membership must remain UNKNOWN`)
    }
  }

  if (requiredNodes.length !== EXPECTED_COUNTS.requiredPackageDirectoryIdentities
    || allNodes.length !== EXPECTED_COUNTS.npmPackageDirectoryIdentities
    || optionalOnlyIds.size !== EXPECTED_COUNTS.optionalOnlyPackageDirectoryIdentities
    || uniqueNameVersions.size !== EXPECTED_COUNTS.expandedNameVersions
    || matrixNpm.length !== EXPECTED_COUNTS.npmPackageDirectoryIdentities
    || matrixNonNpm.length !== EXPECTED_COUNTS.nonNpmComponents
    || npmComponents.length !== EXPECTED_COUNTS.npmPackageDirectoryIdentities
    || nonNpmComponents.length !== EXPECTED_COUNTS.nonNpmComponents
    || components.length !== EXPECTED_COUNTS.totalComponents) {
    errors.push("component identities or counts do not match the accepted runtime closure")
  }
  if (componentByIdentity.size !== allIds.size
    || matrixByIdentity.size !== allIds.size
    || [...allIds].some((identity) => !componentByIdentity.has(identity) || !matrixByIdentity.has(identity))
    || [...componentByIdentity.keys()].some((identity) => !allIds.has(identity))
    || [...matrixByIdentity.keys()].some((identity) => !allIds.has(identity))) {
    errors.push("npm component identities do not match the accepted runtime closure")
  }
  if ([...requiredIds].some((identity) => !allIds.has(identity))
    || [...optionalOnlyIds].some((identity) => !allIds.has(identity))
    || [...requiredIds].some((identity) => optionalOnlyIds.has(identity))
    || allIds.size - requiredIds.size !== optionalOnlyIds.size) {
    errors.push("required and optional-only identities do not match the accepted runtime closure")
  }

  const closureNodeByIdentity = new Map<string, UnknownRecord>()
  for (const node of allNodes) {
    if (typeof node.identity === "string") closureNodeByIdentity.set(node.identity, node)
  }
  for (const identity of allIds) {
    const component = componentByIdentity.get(identity)
    const matrixComponent = matrixByIdentity.get(identity)
    const closureNode = closureNodeByIdentity.get(identity)
    if (!component || !matrixComponent || !closureNode) continue
    const isRequired = requiredIds.has(identity)
    const expectedStatus = isRequired ? "REQUIRED" : "OPTIONAL_ONLY"
    const expectedOptionalOnly = !isRequired
    const relationship = component.dependencyRelationship
    const name = closureNode.name
    const version = closureNode.version
    const manifestHash = closureNode.manifestSha256
    const expectedReachability = closureNode.reachability
    const fieldsMatch = component.name === name
      && component.version === version
      && component.packageDirectory === closureNode.packageDirectory
      && component.packageDirectoryIdentity === closureNode.identity
      && component.installedManifestSha256 === manifestHash
      && component.installedClosureMembership === expectedStatus
      && matrixComponent.name === name
      && matrixComponent.version === version
      && matrixComponent.packageDirectory === closureNode.packageDirectory
      && matrixComponent.installedIdentity === closureNode.identity
      && matrixComponent.manifestSha256 === manifestHash
      && matrixComponent.requiredClosureMembership === isRequired
      && Array.isArray(matrixComponent.installedReachability)
      && JSON.stringify(matrixComponent.installedReachability) === JSON.stringify(expectedReachability)
      && isRecord(relationship)
      && relationship.requiredClosureMember === isRequired
      && relationship.optionalOnlyClosureMember === expectedOptionalOnly
      && relationship.directness === (Object.hasOwn(runtimeRootDependencies, String(name)) ? "direct" : "transitive")
      && relationship.rootDependencyRange === (
        Object.hasOwn(runtimeRootDependencies, String(name))
          ? runtimeRootDependencies[String(name)]
          : null
      )
      && Array.isArray(relationship.reachability)
      && JSON.stringify(relationship.reachability) === JSON.stringify(expectedReachability)
    if (!fieldsMatch) {
      errors.push(`npm component ${identity} does not match the accepted runtime closure`)
    }
  }

  if (lockBytes) {
    const lockEntries = parseBunLockPackageEntries(lockBytes.toString("utf8"))
    for (const component of npmComponents) {
      const releases = findEvidence(component, "npm-registry-release")
      const release = releases[0]
      if (!release || typeof component.name !== "string" || typeof component.version !== "string") continue
      const actual = matchingLockIntegrities(lockEntries, component.name, component.version)
      const recorded = Array.isArray(release.bunLockIntegrityValues)
        ? [...new Set(release.bunLockIntegrityValues.filter((value): value is string => typeof value === "string"))].sort()
        : []
      if (actual.length === 0
        || JSON.stringify(actual) !== JSON.stringify(recorded)
        || !actual.includes(String(release.tarballIntegrity))) {
        errors.push(`component ${component.name}@${component.version} npm tarball integrity does not match the actual bun.lock package entry`)
      }
    }
  }
}

function readRepositoryFile(root: string, relativePath: string, errors: string[]): Buffer | null {
  try {
    return readFileSync(resolve(root, relativePath))
  } catch {
    errors.push(`required repository identity file is missing: ${relativePath}`)
    return null
  }
}

export function validateLicenseLedger(root: string, ledger: unknown): string[] {
  const errors = validateLicenseLedgerDocument(root, ledger)
  if (!isRecord(ledger)) return errors
  validateFixedClosure(root, ledger, errors)
  return errors
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ""
if (import.meta.main && invokedPath === resolve(fileURLToPath(import.meta.url))) {
  const root = resolve(import.meta.dir, "..")
  const ledgerPath = resolve(root, "docs/licensing/third-party-license-ledger.json")
  try {
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8")) as unknown
    const errors = validateLicenseLedger(root, ledger)
    if (errors.length > 0) {
      console.error(`FAIL ${errors.length} license-ledger validation issue(s):`)
      for (const error of errors) console.error(`- ${error}`)
      process.exitCode = 1
    } else {
      const value = isRecord(ledger) && Array.isArray(ledger.components) ? ledger.components.length : 0
      console.log(`PASS third-party license ledger: ${value} components; accepted closure, source mappings, lock integrities, material hashes, and UNKNOWN bundle membership verified`)
    }
  } catch (error) {
    console.error(`FAIL could not validate license ledger: ${String(error)}`)
    process.exitCode = 1
  }
}
