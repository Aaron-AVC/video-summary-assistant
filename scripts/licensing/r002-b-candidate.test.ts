import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { noticeFiles } from "../distribution-notices"
import { validateDependencyDelta } from "./r002-b-candidate"
import { loadCandidate } from "./r002-b-candidate"

const target = "react-remove-scroll-bar"
const beforeManifest = { dependencies: { react: "^18.3.1" }, manifest: { permissions: ["storage"] } }
const afterManifest = { ...beforeManifest, overrides: { [target]: "2.3.7" } }
const integrity = `sha512-${Buffer.alloc(64, 1).toString("base64")}`
const oldTuple = [`${target}@2.3.8`, "", { dependencies: { "react-style-singleton": "^2.2.2", tslib: "^2.0.0" }, peerDependencies: { react: "^18.0.0" } }, "old"] as const
const newTuple = [`${target}@2.3.7`, `https://registry.npmjs.org/${target}/-/${target}-2.3.7.tgz`, { ...oldTuple[2], dependencies: { "react-style-singleton": "^2.2.1", tslib: "^2.0.0" } }, integrity] as const
const parent = ["react-remove-scroll@2.7.2", "", { dependencies: { [target]: "^2.3.7" } }, "parent"] as const
const peer = ["react@18.3.1", "", {}, "react"] as const
const singleton = ["react-style-singleton@2.2.3", "", {}, "singleton"] as const
const tslib = ["tslib@2.8.1", "", {}, "tslib"] as const
const beforeLock = { packages: { [target]: oldTuple, "react-remove-scroll": parent, react: peer, "react-style-singleton": singleton, tslib } }
const afterLock = { ...beforeLock, overrides: afterManifest.overrides, packages: { ...beforeLock.packages, [target]: newTuple } }

describe("R002-B dependency delta", () => {
  it("allows only the reviewed compatible substitution", () => {
    expect(validateDependencyDelta(beforeManifest, afterManifest, beforeLock, afterLock, integrity)).toEqual([target])
  })
  it("fails closed on an unrelated dependency or permission change", () => {
    expect(() => validateDependencyDelta(beforeManifest, afterManifest, beforeLock, {
      ...afterLock, packages: { ...afterLock.packages, react: ["react@19.0.0", "", {}, "react"] },
    }, integrity)).toThrow("Unreviewed lock")
    expect(() => validateDependencyDelta(beforeManifest, { ...afterManifest, manifest: {} }, beforeLock, afterLock, integrity)).toThrow("Unreviewed package.json")
  })
  it("rejects a wrong publication binding", () => {
    expect(() => validateDependencyDelta(beforeManifest, afterManifest, beforeLock, afterLock, "other")).toThrow("Publication")
  })
  it("preserves the shadcn MIT text while separating partial provenance from notice completeness", () => {
    const { inputs, scope } = loadCandidate()
    const plan = noticeFiles(inputs, scope, true)
    const manifest = JSON.parse(plan.files.get("THIRD_PARTY/manifest.json")!.toString())
    const shadcn = manifest.components.find((component: { id: string }) => component.id === "source:shadcn-templates")
    expect(shadcn.provenanceStatus).toBe("PARTIAL")
    expect(shadcn.provenanceNote).toContain("exact CLI")
    expect(shadcn.unresolved).toBeNull()
    expect(shadcn.materials.some((material: { sha256: string }) =>
      material.sha256 === "1564074e13439397221ffd522e2e504d56561994a23d371aa5e3ad43e4f5423f",
    )).toBe(true)
    expect(plan.blockers).toEqual([])
    expect(plan.releaseBlockers.length).toBeGreaterThan(0)
    expect(manifest.thirdPartyStatus).toBe("MATERIALS_VERIFIED_FOR_REVIEWED_SCOPE")
    expect(manifest.releaseStatus).toBe("HOLD")
  })

  it("keeps package identities absent from the Parcel graph unknown and conservatively notices them", () => {
    const { inputs, scope } = loadCandidate()
    expect(scope.schema).toBe("vsa-r002-b-distribution-scope/v3")
    const excluded = scope.components.filter((row: { membership: string }) => row.membership === "CONFIRMED_EXCLUDED")
    const unknown = scope.components.filter((row: { membership: string }) => row.membership === "UNKNOWN")
    expect(excluded).toEqual([])
    expect(unknown.filter((row: { id: string }) => row.id.startsWith("npm:"))).toHaveLength(12)
    const graphIdentities = new Set(inputs.graph.packages.map((row: { identity: string }) => row.identity))
    const currentClosureWithoutDirectAttribution = inputs.ledger.components
      .filter((row: { kind: string, packageDirectoryIdentity?: string }) =>
        row.kind === "npm-package" && row.packageDirectoryIdentity && !graphIdentities.has(row.packageDirectoryIdentity),
      )
      .map((row: { componentId: string }) => row.componentId)
      .sort()
    expect(unknown.filter((row: { id: string }) => row.id.startsWith("npm:")).map((row: { id: string }) => row.id).sort())
      .toEqual(currentClosureWithoutDirectAttribution)
    const plan = noticeFiles(inputs, scope, true)
    const manifest = JSON.parse(plan.files.get("THIRD_PARTY/manifest.json")!.toString())
    const unknownPackages = manifest.components.filter((row: { membership: string, id: string }) =>
      row.membership === "UNKNOWN" && row.id.startsWith("npm:"),
    )
    expect(unknownPackages).toHaveLength(12)
    expect(unknownPackages.every((row: { includeInNotice: boolean, materials: { role: string }[] }) =>
      row.includeInNotice && row.materials.some(material => material.role === "LICENSE"),
    )).toBe(true)
    expect(plan.blockers).toEqual([])
  })

  it("exposes the derived candidate ledger needed to verify the recorded snapshot", () => {
    const candidate = loadCandidate() as ReturnType<typeof loadCandidate> & { ledger?: unknown }
    const recorded = JSON.parse(readFileSync(join(import.meta.dir,
      "../../docs/licensing/evidence/R002-B/candidate-ledger.json"), "utf8"))
    expect(candidate.ledger).toMatchObject({
      schema: recorded.schema,
      buildSha256: recorded.buildSha256,
      base: recorded.base,
      changedNpmIdentities: recorded.changedNpmIdentities,
      blockerDisposition: recorded.blockerDisposition,
    })
  })
})
