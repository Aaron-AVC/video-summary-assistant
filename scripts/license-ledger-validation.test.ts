import { afterEach, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { validateLicenseLedger, validateLicenseLedgerDocument } from "./validate-license-ledger"

const roots: string[] = []
const materialText = "Synthetic MIT license evidence\n"
const materialHash = createHash("sha256").update(materialText).digest("hex")
const validMaterial = {
  materialId: `sha256:${materialHash}`,
  path: `licenses/third-party/materials/${materialHash}.txt`,
  sha256: materialHash,
  byteLength: Buffer.byteLength(materialText),
  kind: "license-text",
  source: "npm-tarball",
  sourceArtifacts: [{
    kind: "npm-tarball-license",
    registryTarballUrl: "https://registry.npmjs.org/example/-/example-1.2.3.tgz",
    tarballPath: "package/LICENSE",
    tarballSha256: "a".repeat(64),
    packageName: "example",
    packageVersion: "1.2.3",
  }],
  applicableScopes: ["example@1.2.3"],
}
const validComponent = {
  componentId: "npm:node_modules/example/package.json",
  kind: "npm-package",
  name: "example",
  version: "1.2.3",
  packageDirectoryIdentity: "node_modules/example/package.json",
  packageDirectory: "node_modules/example",
  dependencyRelationship: {
    directness: "direct",
    requiredClosureMember: true,
    optionalOnlyClosureMember: false,
    reachability: ["required"],
  },
  installedClosureMembership: "REQUIRED",
  installedManifestSha256: "c".repeat(64),
  actualBundleMembership: "UNKNOWN",
  license: {
    declared: "MIT",
    npmRegistryDeclared: "MIT",
    evidenceStatus: "VERIFIED_TARBALL_TEXT",
    copyrightStatements: [],
    licenseMaterialIds: [validMaterial.materialId],
    noticeMaterialIds: [],
  },
  sourceEvidence: [{
    kind: "npm-registry-release",
    registryUrl: "https://registry.npmjs.org/example/1.2.3",
    registryVersionUrl: "https://registry.npmjs.org/example/1.2.3",
    registryTarballUrl: "https://registry.npmjs.org/example/-/example-1.2.3.tgz",
    npmRegistryLicense: "MIT",
    tarballIntegrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
    bunLockIntegrityValues: [`sha512-${Buffer.alloc(64).toString("base64")}`],
    lockIntegrityMatches: true,
    tarballSha256: "a".repeat(64),
    legalFiles: [{
      tarballPath: "package/LICENSE",
      sha256: materialHash,
      byteLength: Buffer.byteLength(materialText),
      materialId: validMaterial.materialId,
      fullLicenseHeuristic: true,
    }],
    packageManifest: {
      sha256: "c".repeat(64),
      version: "1.2.3",
      declaredLicense: "MIT",
    },
  }],
}

function createLedger(components = [structuredClone(validComponent)], materials = [structuredClone(validMaterial)]) {
  const root = mkdtempSync(join(tmpdir(), "vsa-license-ledger-"))
  roots.push(root)
  mkdirSync(join(root, "licenses", "third-party", "materials"), { recursive: true })
  writeFileSync(join(root, validMaterial.path), materialText)
  const ledger = {
    schema: "vsa-third-party-license-ledger/v1",
    dependencyClosure: {},
    expectedCounts: {
      npmPackageDirectoryIdentities: components.filter((item) => item.kind === "npm-package").length,
      nonNpmComponents: components.filter((item) => item.kind !== "npm-package").length,
      totalComponents: components.length,
    },
    licenseMaterials: materials,
    components,
  }
  writeFileSync(join(root, "ledger.json"), JSON.stringify(ledger))
  return { root, ledger }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const repositoryRoot = resolve(import.meta.dir, "..")
const acceptedLedgerPath = join(repositoryRoot, "docs", "licensing", "third-party-license-ledger.json")

function cloneAcceptedLedger() {
  return structuredClone(JSON.parse(readFileSync(acceptedLedgerPath, "utf8")))
}

function acceptedNpmComponent(ledger: ReturnType<typeof cloneAcceptedLedger>, name: string) {
  const component = ledger.components.find((item) => item.kind === "npm-package" && item.name === name)
  if (!component) throw new Error(`missing accepted fixture component: ${name}`)
  return component
}

describe("third-party license ledger validator", () => {
  it("accepts an evidenced npm package while preserving UNKNOWN bundle membership", () => {
    const { root, ledger } = createLedger()
    expect(validateLicenseLedgerDocument(root, ledger)).toEqual([])
    expect(ledger.components[0].actualBundleMembership).toBe("UNKNOWN")
  })

  it("rejects duplicate package-directory identities even when versions match", () => {
    const duplicate = structuredClone(validComponent)
    duplicate.componentId = "npm:duplicate-row"
    const { root, ledger } = createLedger([validComponent, duplicate])
    expect(validateLicenseLedgerDocument(root, ledger).join("\n")).toContain("duplicate packageDirectoryIdentity")
  })

  it("rejects a verified license claim without fixed release provenance", () => {
    const component = structuredClone(validComponent)
    component.sourceEvidence = []
    const { root, ledger } = createLedger([component])
    expect(validateLicenseLedgerDocument(root, ledger).join("\n")).toContain("verified license evidence requires npm registry release evidence")
  })

  it("keeps an expanded-optional package outside the required closure", () => {
    const component = structuredClone(validComponent)
    component.dependencyRelationship = {
      directness: "transitive",
      requiredClosureMember: false,
      optionalOnlyClosureMember: true,
      reachability: ["expanded-optional"],
    }
    component.installedClosureMembership = "OPTIONAL_ONLY"
    const { root, ledger } = createLedger([component])
    expect(validateLicenseLedgerDocument(root, ledger)).toEqual([])
    expect(ledger.components[0].dependencyRelationship.requiredClosureMember).toBe(false)
    expect(ledger.components[0].dependencyRelationship.optionalOnlyClosureMember).toBe(true)
  })

  it("rejects a material whose recorded hash differs from its bytes", () => {
    const material = structuredClone(validMaterial)
    material.sha256 = "0".repeat(64)
    material.materialId = `sha256:${material.sha256}`
    const { root, ledger } = createLedger([validComponent], [material])
    expect(validateLicenseLedgerDocument(root, ledger).join("\n")).toContain("material SHA-256 mismatch")
  })

  it("rejects a material path that escapes the legal-material directory", () => {
    const material = structuredClone(validMaterial)
    material.path = "../package.json"
    const { root, ledger } = createLedger([validComponent], [material])
    expect(validateLicenseLedgerDocument(root, ledger).join("\n")).toContain("material path must stay under licenses/third-party/materials")
  })

  it("rejects a material path that leaves the directory through a junction", () => {
    const { root, ledger } = createLedger()
    const outside = mkdtempSync(join(tmpdir(), "vsa-license-outside-"))
    roots.push(outside)
    writeFileSync(join(outside, "external.txt"), materialText)
    symlinkSync(outside, join(root, "licenses", "third-party", "materials", "external"), "junction")
    ledger.licenseMaterials[0].path = "licenses/third-party/materials/external/external.txt"

    expect(validateLicenseLedgerDocument(root, ledger).join("\n")).toContain("resolves outside licenses/third-party/materials")
  })

  it("rejects a package marked as both required and optional-only", () => {
    const component = structuredClone(validComponent)
    component.dependencyRelationship.optionalOnlyClosureMember = true
    const { root, ledger } = createLedger([component])
    expect(validateLicenseLedgerDocument(root, ledger).join("\n")).toContain("cannot be required and optional-only")
  })

  it("rejects an incomplete component list for the fixed 74-directory closure", () => {
    const { root, ledger } = createLedger()
    ledger.dependencyClosure = { componentsByDirectoryIdentity: 74 }

    expect(validateLicenseLedgerDocument(root, ledger).join("\n")).toContain("expected exactly 74 npm package-directory identities")
  })

  it("rejects npm evidence whose tarball integrity is not present in bun.lock", () => {
    const component = structuredClone(validComponent)
    component.sourceEvidence[0].bunLockIntegrityValues = ["sha512-different"]
    const { root, ledger } = createLedger([component])
    expect(validateLicenseLedgerDocument(root, ledger).join("\n")).toContain("npm tarball integrity is not matched to bun.lock")
  })

  it("rejects a mismatch between installed closure flags and the recorded closure status", () => {
    const component = structuredClone(validComponent)
    component.dependencyRelationship.requiredClosureMember = false
    component.installedClosureMembership = "REQUIRED"
    const { root, ledger } = createLedger([component])
    expect(validateLicenseLedgerDocument(root, ledger).join("\n")).toContain("non-member closure status is inconsistent")
  })

  it("rejects unknown license evidence labels instead of letting them bypass verification", () => {
    const component = structuredClone(validComponent)
    component.license.evidenceStatus = "VERIFIED_BY_NAME_ONLY"
    const { root, ledger } = createLedger([component])
    expect(validateLicenseLedgerDocument(root, ledger).join("\n")).toContain("has invalid license evidenceStatus")
  })

  it("rejects a confirmed bundle state without direct membership evidence", () => {
    const component = structuredClone(validComponent)
    component.actualBundleMembership = "CONFIRMED_INCLUDED"
    const { root, ledger } = createLedger([component])
    expect(validateLicenseLedgerDocument(root, ledger).join("\n")).toContain("confirmed bundle membership requires direct evidence")
  })
})

describe("formal ledger acceptance regressions", () => {
  it("requires verified tarball text to name a legal file in that exact tarball", () => {
    const ledger = cloneAcceptedLedger()
    const component = acceptedNpmComponent(ledger, "@floating-ui/core")
    const release = component.sourceEvidence.find((item) => item.kind === "npm-registry-release")
    release.legalFiles = []

    expect(validateLicenseLedger(repositoryRoot, ledger).join("\n")).toContain("verified tarball license must reference legalFiles from its exact npm release")
  })

  it("rejects a license material borrowed from a different package and version", () => {
    const ledger = cloneAcceptedLedger()
    const recipient = acceptedNpmComponent(ledger, "@floating-ui/core")
    const donor = acceptedNpmComponent(ledger, "class-variance-authority")
    recipient.license.licenseMaterialIds = [...donor.license.licenseMaterialIds]

    expect(validateLicenseLedger(repositoryRoot, ledger).join("\n")).toContain("verified tarball license must reference legalFiles from its exact npm release")
  })

  it("rejects a NOTICE material that does not belong to the exact npm release", () => {
    const ledger = cloneAcceptedLedger()
    const component = acceptedNpmComponent(ledger, "@floating-ui/core")
    const unrelatedNotice = ledger.licenseMaterials.find((material) => material.kind === "notice-text")
    component.license.noticeMaterialIds = [unrelatedNotice.materialId]

    expect(validateLicenseLedger(repositoryRoot, ledger).join("\n")).toContain("notice material is not sourced from this exact npm package version")
  })

  it("does not verify upstream license text from evidence kind alone", () => {
    const ledger = cloneAcceptedLedger()
    const component = acceptedNpmComponent(ledger, "@radix-ui/react-compose-refs")
    const release = component.sourceEvidence.find((item) => item.kind === "npm-registry-release")
    component.sourceEvidence = [release, { kind: "fixed-upstream-source" }]

    expect(validateLicenseLedger(repositoryRoot, ledger).join("\n")).toContain("verified upstream license requires a complete fixed-source license mapping")
  })

  it("rejects an unrelated license appended to a valid upstream mapping", () => {
    const ledger = cloneAcceptedLedger()
    const component = acceptedNpmComponent(ledger, "@radix-ui/react-compose-refs")
    const donor = acceptedNpmComponent(ledger, "class-variance-authority")
    component.license.licenseMaterialIds.push(...donor.license.licenseMaterialIds)

    expect(validateLicenseLedger(repositoryRoot, ledger).join("\n")).toContain("upstream license material has no matching fixed-source mapping")
  })

  it("requires every source-component license reference to match its fixed license source", () => {
    const ledger = cloneAcceptedLedger()
    const component = ledger.components.find((item) => item.componentId === "source:youtube-summarizer")
    const unrelated = acceptedNpmComponent(ledger, "@floating-ui/core")
    component.license.licenseMaterialIds.push(...unrelated.license.licenseMaterialIds)

    expect(validateLicenseLedger(repositoryRoot, ledger).join("\n")).toContain("upstream license material has no matching fixed-source mapping")
  })

  it("rejects a borrowed NOTICE even for an unresolved npm release", () => {
    const ledger = cloneAcceptedLedger()
    const component = acceptedNpmComponent(ledger, "react-remove-scroll-bar")
    const unrelatedNotice = ledger.licenseMaterials.find((material) => material.kind === "notice-text")
    component.license.noticeMaterialIds = [unrelatedNotice.materialId]

    expect(validateLicenseLedger(repositoryRoot, ledger).join("\n")).toContain("notice material is not sourced from this exact npm package version")
  })

  it("requires an upstream license path, blob, digest, and material mapping", () => {
    const ledger = cloneAcceptedLedger()
    const component = acceptedNpmComponent(ledger, "@radix-ui/react-compose-refs")
    const source = component.sourceEvidence.find((item) => item.kind === "fixed-upstream-source")
    source.rootLicense = { ...source.rootLicense, gitBlob: null, sha256: null, materialId: null }

    expect(validateLicenseLedger(repositoryRoot, ledger).join("\n")).toContain("verified upstream license requires a complete fixed-source license mapping")
  })

  it("rejects a versioned upstream mapping without the exact manifest and source-map evidence", () => {
    const ledger = cloneAcceptedLedger()
    const component = acceptedNpmComponent(ledger, "@radix-ui/react-compose-refs")
    const source = component.sourceEvidence.find((item) => item.kind === "fixed-upstream-source")
    source.packageManifest.version = "9.9.9"
    source.tarballSourceMapBlobMatches = {}

    expect(validateLicenseLedger(repositoryRoot, ledger).join("\n")).toContain("verified upstream npm license is not mapped to this exact published package")
  })

  it("requires fixed path, commit, blob, digest, and material identity for source components", () => {
    const ledger = cloneAcceptedLedger()
    const component = ledger.components.find((item) => item.componentId === "source:youtube-summarizer")
    const source = component.sourceEvidence.find((item) => item.kind === "fixed-upstream-source")
    source.licensePath = null
    source.licenseSha256 = null
    source.licenseMaterialId = null

    expect(validateLicenseLedger(repositoryRoot, ledger).join("\n")).toContain("verified upstream license requires a complete fixed-source license mapping")
  })

  it("rejects an upstream Git blob that does not match the preserved license bytes", () => {
    const ledger = cloneAcceptedLedger()
    const component = ledger.components.find((item) => item.componentId === "source:youtube-summarizer")
    const source = component.sourceEvidence.find((item) => item.kind === "fixed-upstream-source")
    source.licenseGitBlob = "1".repeat(40)

    expect(validateLicenseLedger(repositoryRoot, ledger).join("\n")).toContain("verified upstream license requires a complete fixed-source license mapping")
  })

  it("rejects a registry Git head that differs from the exact npm publication metadata", () => {
    const ledger = cloneAcceptedLedger()
    const component = acceptedNpmComponent(ledger, "@radix-ui/react-compose-refs")
    const source = component.sourceEvidence.find((item) => item.kind === "fixed-upstream-source")
    source.registryGitHead = "1".repeat(40)
    source.registryGitHeadUrl = `https://github.com/radix-ui/primitives/tree/${source.registryGitHead}`

    expect(validateLicenseLedger(repositoryRoot, ledger).join("\n")).toContain("verified upstream npm license is not mapped to this exact published package")
  })

  it("rejects a deleted component even when ledger counts are changed to match", () => {
    const ledger = cloneAcceptedLedger()
    const removed = acceptedNpmComponent(ledger, "@floating-ui/core")
    ledger.components = ledger.components.filter((component) => component !== removed)
    ledger.expectedCounts = {
      npmPackageDirectoryIdentities: 73,
      nonNpmComponents: 4,
      totalComponents: 77,
    }
    ledger.dependencyClosure.componentsByDirectoryIdentity = 73
    ledger.dependencyClosure.uniqueNameVersions = 68
    ledger.dependencyClosure.required.packageDirectoryIdentities = 69
    ledger.dependencyClosure.required.nameVersions = 64
    ledger.dependencyClosure.expandedOptional.packageDirectoryIdentities = 73
    ledger.dependencyClosure.expandedOptional.nameVersions = 68

    expect(validateLicenseLedger(repositoryRoot, ledger).join("\n")).toContain("does not match the accepted runtime closure")
  })

  it("rejects changing a required package to optional-only while preserving total counts", () => {
    const ledger = cloneAcceptedLedger()
    const component = acceptedNpmComponent(ledger, "@floating-ui/core")
    component.dependencyRelationship.requiredClosureMember = false
    component.dependencyRelationship.optionalOnlyClosureMember = true
    component.dependencyRelationship.reachability = ["optional-expansion"]
    component.installedClosureMembership = "OPTIONAL_ONLY"

    expect(validateLicenseLedger(repositoryRoot, ledger).join("\n")).toContain("does not match the accepted runtime closure")
  })

  it("keeps actual bundle membership UNKNOWN despite a non-empty claim string", () => {
    const ledger = cloneAcceptedLedger()
    const component = acceptedNpmComponent(ledger, "@floating-ui/core")
    component.actualBundleMembership = "CONFIRMED_INCLUDED"
    component.bundleMembershipEvidence = "observed in an arbitrary report"

    expect(validateLicenseLedger(repositoryRoot, ledger).join("\n")).toContain("actual bundle membership must remain UNKNOWN")
  })

  it("rejects a SHA-512 SRI that decodes to fewer than 64 bytes", () => {
    const ledger = cloneAcceptedLedger()
    const component = acceptedNpmComponent(ledger, "@floating-ui/core")
    const release = component.sourceEvidence.find((item) => item.kind === "npm-registry-release")
    const invalidIntegrity = `sha512-${Buffer.alloc(63, 7).toString("base64")}`
    release.tarballIntegrity = invalidIntegrity
    release.bunLockIntegrityValues = [invalidIntegrity]
    release.lockIntegrityMatches = true

    expect(validateLicenseLedger(repositoryRoot, ledger).join("\n")).toContain("npm SHA-512 integrity must decode to exactly 64 bytes")
  })

  it("matches every recorded npm integrity against the actual bun.lock record", () => {
    const ledger = cloneAcceptedLedger()
    const component = acceptedNpmComponent(ledger, "@floating-ui/core")
    const release = component.sourceEvidence.find((item) => item.kind === "npm-registry-release")
    const integrity = `sha512-${Buffer.alloc(64, 7).toString("base64")}`
    release.tarballIntegrity = integrity
    release.bunLockIntegrityValues = [integrity]
    release.lockIntegrityMatches = true

    expect(validateLicenseLedger(repositoryRoot, ledger).join("\n")).toContain("npm tarball integrity does not match the actual bun.lock package entry")
  })

  it("rejects a registry URL that names a different package version", () => {
    const ledger = cloneAcceptedLedger()
    const component = acceptedNpmComponent(ledger, "@floating-ui/core")
    const release = component.sourceEvidence.find((item) => item.kind === "npm-registry-release")
    release.registryVersionUrl = "https://registry.npmjs.org/@floating-ui%2Fcore/9.9.9"

    expect(validateLicenseLedger(repositoryRoot, ledger).join("\n")).toContain("registry URLs do not identify the exact npm package version")
  })

  it("retains the deduplicated fixed MIT text for every Radix component", () => {
    const ledger = cloneAcceptedLedger()
    const radixComponents = ledger.components.filter(
      (component) => component.kind === "npm-package"
        && component.name.startsWith("@radix-ui/")
        && component.license.evidenceStatus === "VERIFIED_UPSTREAM_ROOT_TEXT",
    )
    expect(radixComponents.length).toBeGreaterThan(0)
    expect(radixComponents.every((component) => component.license.licenseMaterialIds.length === 1)).toBe(true)
    expect(radixComponents.every((component) => component.license.copyrightStatements.includes("Copyright (c) 2022 WorkOS"))).toBe(true)
    expect(validateLicenseLedger(repositoryRoot, ledger, true)).toEqual([])
  })
})
