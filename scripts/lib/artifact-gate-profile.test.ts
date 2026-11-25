import { afterEach, describe, expect, it } from "bun:test"
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import {
  ARTIFACT_GATE_PROFILE_ROOT_ENV,
  createArtifactGateProfile,
  getDefaultArtifactGateProfileRoot,
} from "./artifact-gate-profile"

const tempParent = join(import.meta.dir, "..", "..", ".buntmp", "profile-tests")
const roots: string[] = []

function makeRoot(): string {
  mkdirSync(tempParent, { recursive: true })
  const root = mkdtempSync(join(tempParent, "test-"))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("Artifact Gate profile ownership", () => {
  it("returns a usable system temporary directory, including malformed-runtime fallback", () => {
    const root = getDefaultArtifactGateProfileRoot()
    expect(root).not.toMatch(/^undefined[\\/]/i)
    expect(readdirSync(root)).toBeDefined()
  })

  it("uses an explicit Unicode root with spaces and reports UTF-16 path length", () => {
    const parent = makeRoot()
    const root = join(parent, "测试 profile 根目录")
    mkdirSync(root)
    const profile = createArtifactGateProfile({ requestedRoot: root })
    expect(profile.rootRealPath).toBe(root)
    expect(profile.profileRealPath.startsWith(root)).toBe(true)
    expect(profile.pathLengthUtf16).toBe(profile.profileRealPath.length)
    profile.cleanup()
    expect(readdirSync(root)).toEqual([])
  })

  it("uses the configured environment root when no CLI root is supplied", () => {
    const root = makeRoot()
    const profile = createArtifactGateProfile({ envRoot: root })
    expect(profile.rootRealPath).toBe(root)
    profile.cleanup()
  })

  it("creates unique directories for concurrent runs", () => {
    const root = makeRoot()
    const profiles = Array.from({ length: 8 }, () => createArtifactGateProfile({ requestedRoot: root }))
    expect(new Set(profiles.map(({ profileDir }) => profileDir)).size).toBe(profiles.length)
    profiles.forEach(({ cleanup }) => cleanup())
  })

  it("does not remove a pre-existing directory", () => {
    const root = makeRoot()
    const existing = join(root, "existing-profile")
    mkdirSync(existing)
    writeFileSync(join(existing, "keep.txt"), "keep")
    const profile = createArtifactGateProfile({ requestedRoot: root })
    profile.cleanup()
    expect(readdirSync(existing)).toEqual(["keep.txt"])
  })

  it("rejects missing, non-directory, and malformed roots", () => {
    const parent = makeRoot()
    const file = join(parent, "file")
    writeFileSync(file, "file")
    expect(() => createArtifactGateProfile({ requestedRoot: join(parent, "missing") })).toThrow()
    expect(() => createArtifactGateProfile({ requestedRoot: file })).toThrow()
    expect(() => createArtifactGateProfile({ requestedRoot: "\0" })).toThrow()
  })

  it("refuses cleanup after the owned directory is replaced", () => {
    const parent = makeRoot()
    const root = join(parent, "root")
    const outside = join(parent, "outside")
    mkdirSync(root)
    mkdirSync(outside)
    writeFileSync(join(outside, "keep.txt"), "keep")
    const profile = createArtifactGateProfile({ requestedRoot: root })
    rmSync(profile.profileDir, { recursive: true, force: true })
    try {
      symlinkSync(outside, profile.profileDir, "junction")
    } catch (error) {
      if (
        typeof error !== "object"
        || error === null
        || !("code" in error)
        || (error as { code?: unknown }).code !== "EPERM"
      ) throw error
      mkdirSync(profile.profileDir)
      writeFileSync(join(profile.profileDir, "keep.txt"), "replacement")
    }
    expect(() => profile.cleanup()).toThrow()
    expect(readdirSync(outside)).toEqual(["keep.txt"])
    if (readdirSync(profile.profileDir).includes("keep.txt")) {
      expect(readdirSync(profile.profileDir)).toEqual(["keep.txt"])
    }
  })

  it("exposes the documented environment setting", () => {
    expect(ARTIFACT_GATE_PROFILE_ROOT_ENV).toBe("ARTIFACT_GATE_PROFILE_ROOT")
  })
})
