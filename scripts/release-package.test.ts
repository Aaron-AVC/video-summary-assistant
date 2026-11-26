import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { zipSync } from "fflate"
import {
  createPackageArchive,
  createPackageIdentity,
  publishPackageAtomically,
  assertNoSensitiveContent,
  sha256,
  verifyPackageArchive,
} from "./lib/release-package"
import {
  assertCandidateBuildInputsUnchanged,
  assertPackagingManifestEquivalent as assertCandidatePackagingManifestEquivalent,
} from "./licensing/r002-b-candidate"

const temporaryRoots: string[] = []

function temporaryRoot(): string {
  const path = mkdtempSync(join(tmpdir(), "vsa-pr4-package-test-"))
  temporaryRoots.push(path)
  return path
}

afterEach(() => {
  for (const path of temporaryRoots.splice(0)) rmSync(path, { recursive: true, force: true })
})

const packageJson = {
  name: "video-summary-assistant",
  version: "2026.8.22",
  scripts: {
    dev: "plasmo dev",
    build: "plasmo build",
    package: "plasmo package",
    typecheck: "tsc --noEmit",
    test: "bun test",
    "verify:artifact": "bun scripts/verify-build-artifact.ts",
  },
  dependencies: { react: "^18.3.1" },
  manifest: { permissions: ["storage"] },
}

const packaged = {
  ...packageJson,
  scripts: {
    ...packageJson.scripts,
    package: "bun scripts/release-package.ts release",
    "package:internal": "bun scripts/release-package.ts internal",
    "verify:package": "bun scripts/release-package.ts verify",
  },
}

const files = new Map<string, Buffer>([
  ["manifest.json", Buffer.from('{"manifest_version":3,"version":"2026.8.22"}')],
  ["background.js", Buffer.from("chrome.runtime.onInstalled.addListener(() => {})\n")],
  ["THIRD_PARTY_NOTICES.md", Buffer.from("THIRD_PARTY_NOTICES_COMPLETE_RELEASE_HOLD\n")],
  ["THIRD_PARTY/manifest.json", Buffer.from('{"releaseApproved":false}')],
  ["THIRD_PARTY/LICENSES/abc/LICENSE", Buffer.from("MIT license bytes\n")],
  ["THIRD_PARTY/NOTICES/def/NOTICE", Buffer.from("Required upstream notice bytes\n")],
  ["INTERNAL_HOLD.txt", Buffer.from("INTERNAL — HOLD\n")],
])

function flatZip(entries: Record<string, Uint8Array | [Uint8Array, { os?: number, attrs?: number }]>) {
  return Buffer.from(zipSync(entries, { level: 0, mtime: new Date("1980-01-01T00:00:00.000Z") }))
}

function replaceName(bytes: Buffer, before: string, after: string): Buffer {
  const copy = Buffer.from(bytes)
  const needle = Buffer.from(before)
  const first = copy.indexOf(needle)
  const second = copy.indexOf(needle, first + needle.length)
  if (first < 0 || second < 0 || before.length !== after.length) throw new Error("fixture name not found")
  const replacement = Buffer.from(after)
  replacement.copy(copy, first)
  replacement.copy(copy, second)
  return copy
}

function withDuplicateCentralEntry(bytes: Buffer): Buffer {
  const eocd = bytes.length - 22
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const centralOffset = view.getUint32(eocd + 16, true)
  const centralSize = view.getUint32(eocd + 12, true)
  const count = view.getUint16(eocd + 10, true)
  const central = bytes.subarray(centralOffset, centralOffset + centralSize)
  const firstRecordLength = 46 + central.readUInt16LE(28) + central.readUInt16LE(30) + central.readUInt16LE(32)
  const duplicate = Buffer.from(central.subarray(0, firstRecordLength))
  const result = Buffer.concat([bytes.subarray(0, centralOffset), central, duplicate, bytes.subarray(eocd)])
  const resultView = new DataView(result.buffer, result.byteOffset, result.byteLength)
  const newEocd = result.length - 22
  resultView.setUint16(newEocd + 8, count + 1, true)
  resultView.setUint16(newEocd + 10, count + 1, true)
  resultView.setUint32(newEocd + 12, centralSize + duplicate.length, true)
  return result
}

describe("PR4 package manifest compatibility", () => {
  it("accepts only the three exact packaging script values", () => {
    expect(() => assertCandidatePackagingManifestEquivalent(packageJson, packaged)).not.toThrow()
  })

  it("rejects dependency, build, permission, and unrelated script changes", () => {
    expect(() => assertCandidatePackagingManifestEquivalent(packageJson, {
      ...packaged,
      dependencies: { react: "^19.0.0" },
    })).toThrow()
    expect(() => assertCandidatePackagingManifestEquivalent(packageJson, {
      ...packaged,
      scripts: { ...packaged.scripts, "package:internal": "plasmo package" },
    })).toThrow()
    expect(() => assertCandidatePackagingManifestEquivalent(packageJson, {
      ...packaged,
      manifest: { permissions: ["storage", "tabs"] },
    })).toThrow()
    expect(() => assertCandidatePackagingManifestEquivalent(packageJson, {
      ...packaged,
      scripts: { ...packaged.scripts, postinstall: "node scripts/anything.js" },
    })).toThrow()
    expect(() => assertCandidatePackagingManifestEquivalent(packageJson, {
      ...packaged,
      scripts: { ...packaged.scripts, build: "plasmo build --target=firefox-mv3" },
    })).toThrow()
  })

  it("rejects changed or ignored build configuration and production inputs", () => {
    expect(() => assertCandidateBuildInputsUnchanged({
      changed: ["package.json"],
      untracked: ["scripts/release-package.ts"],
      ignored: [],
    })).not.toThrow()
    for (const path of [".parcelrc", ".env.local", "plasmo.config.ts", "src/untracked.tsx", "assets/new.png", "bun.lock"]) {
      expect(() => assertCandidateBuildInputsUnchanged({
        changed: [path],
        untracked: [],
        ignored: [],
      })).toThrow()
      expect(() => assertCandidateBuildInputsUnchanged({
        changed: [],
        untracked: [],
        ignored: [path],
      })).toThrow()
    }
  })

})

describe("PR4 ZIP archive gate", () => {
  it("round-trips the exact planned members and byte identities", () => {
    const archive = flatZip(Object.fromEntries(files))
    const extracted = verifyPackageArchive(archive, files)
    expect([...extracted.keys()].sort()).toEqual([...files.keys()].sort())
    for (const [path, bytes] of files) expect(extracted.get(path)).toEqual(bytes)
  })

  it("rejects missing or altered legal and product files and unauthorized files", () => {
    const archive = flatZip(Object.fromEntries(files))
    const missing = new Map(files)
    missing.delete("THIRD_PARTY/LICENSES/abc/LICENSE")
    expect(() => verifyPackageArchive(archive, missing)).toThrow()
    const missingNotice = new Map(files)
    missingNotice.delete("THIRD_PARTY/NOTICES/def/NOTICE")
    expect(() => verifyPackageArchive(archive, missingNotice)).toThrow()
    const altered = new Map(files)
    altered.set("THIRD_PARTY/LICENSES/abc/LICENSE", Buffer.from("altered\n"))
    expect(() => verifyPackageArchive(archive, altered)).toThrow()
    const alteredNotice = new Map(files)
    alteredNotice.set("THIRD_PARTY/NOTICES/def/NOTICE", Buffer.from("altered notice\n"))
    expect(() => verifyPackageArchive(archive, alteredNotice)).toThrow()
    const alteredProduct = new Map(files)
    alteredProduct.set("background.js", Buffer.from("changed product bytes\n"))
    expect(() => verifyPackageArchive(archive, alteredProduct)).toThrow()
    const withExtra = new Map(files).set("debug.log", Buffer.from("not distributable"))
    expect(() => verifyPackageArchive(archive, withExtra)).toThrow()
  })

  it("rejects traversal names, case aliases, duplicate members, and symlink metadata", () => {
    const traversal = replaceName(flatZip({ "a.txt": Buffer.from("x") }), "a.txt", "../x!")
    expect(() => verifyPackageArchive(traversal, new Map([["a.txt", Buffer.from("x")]]))).toThrow()

    const caseAlias = replaceName(flatZip({
      "A.txt": Buffer.from("x"),
      "b.txt": Buffer.from("y"),
    }), "b.txt", "A.txt")
    expect(() => verifyPackageArchive(caseAlias, new Map([["A.txt", Buffer.from("x")]])))
      .toThrow("Duplicate or case-colliding ZIP member")

    const oneFile = flatZip({ "a.txt": Buffer.from("x") })
    expect(() => verifyPackageArchive(withDuplicateCentralEntry(oneFile), new Map())).toThrow()

    const symlink = flatZip({
      "link": [Buffer.from("target"), { os: 3, attrs: 0o120777 << 16 }],
    })
    expect(() => verifyPackageArchive(symlink, new Map())).toThrow()
  })

  it("rejects damaged archives and a tampered external package identity", () => {
    const archive = flatZip(Object.fromEntries(files))
    expect(() => verifyPackageArchive(Buffer.from("not a zip"), files)).toThrow()
    const identity = createPackageIdentity({
      sourceCommit: "a".repeat(40),
      sourceTree: "b".repeat(40),
      productFiles: new Map([["manifest.json", files.get("manifest.json")!]]),
      noticeFiles: new Map([...files].filter(([path]) => path.startsWith("THIRD_PARTY"))),
      zipBytes: archive,
      archiveFiles: files,
      version: "2026.8.22",
    })
    identity.archive.sha256 = sha256(Buffer.from("different"))
    expect(() => verifyPackageArchive(archive, files, identity)).toThrow()
  })

  it("cleans failed staging and refuses to overwrite an existing package", () => {
    const root = temporaryRoot()
    const archive = createPackageArchive(files)
    const identity = createPackageIdentity({
      sourceCommit: "a".repeat(40),
      sourceTree: "b".repeat(40),
      productFiles: new Map([["manifest.json", files.get("manifest.json")!]]),
      noticeFiles: new Map([...files].filter(([path]) => path.startsWith("THIRD_PARTY"))),
      zipBytes: archive,
      archiveFiles: files,
      version: "2026.8.22",
    })
    const identityBytes = Buffer.from(`${JSON.stringify(identity)}\n`)
    const tampered = structuredClone(identity)
    tampered.archive.sha256 = sha256(Buffer.from("wrong"))
    expect(() => publishPackageAtomically(root, "failed-package", archive,
      Buffer.from(`${JSON.stringify(tampered)}\n`), files, identity)).toThrow()
    expect(readdirSync(root)).toEqual([])

    const output = publishPackageAtomically(root, "good-package", archive, identityBytes, files, identity)
    expect(readdirSync(output).sort()).toEqual(["extension-INTERNAL-HOLD.zip", "package-identity.json"])
    expect(() => publishPackageAtomically(root, "good-package", archive, identityBytes, files, identity))
      .toThrow("Refusing to overwrite")
    expect(readdirSync(root).sort()).toEqual(["good-package"])
  })

  it("rejects local workstation paths and secret-like credential content", () => {
    expect(() => assertNoSensitiveContent(new Map([
      ["bundle.js", Buffer.from("source path C:\\Users\\test-user\\worktrees\\checkout")],
    ]))).toThrow("Local absolute path")
    expect(() => assertNoSensitiveContent(new Map([
      ["bundle.js", Buffer.from(`sk-${"x".repeat(40)}`)],
    ]))).toThrow("Secret-like credential")
    expect(() => assertNoSensitiveContent(files)).not.toThrow()
  })

  it("rejects Windows reserved device names as archive paths", () => {
    for (const path of ["CON", "NUL.txt", "subdir/COM1.log"]) {
      expect(() => createPackageArchive(new Map([[path, Buffer.from("x")]]))).toThrow()
    }
  })

  it("rejects slash-normalized workstation paths and OAuth-style secret assignments", () => {
    expect(() => assertNoSensitiveContent(new Map([
      ["bundle.js", Buffer.from("source path C:/Temp/test-user/worktrees/checkout")],
    ]))).toThrow("Local absolute path")
    expect(() => assertNoSensitiveContent(new Map([
      ["bundle.js", Buffer.from(`api_key=${"x".repeat(40)}`)],
    ]))).toThrow("Secret-like credential")
  })

  it("allows ordinary HTTPS strings while still detecting a drive-rooted path", () => {
    expect(() => assertNoSensitiveContent(new Map([
      ["bundle.js", Buffer.from('const endpoint = "https://www.youtube.com/watch";')],
    ]))).not.toThrow()
    expect(() => assertNoSensitiveContent(new Map([
      ["bundle.js", Buffer.from(String.raw`const expression = /\\s*:\\s*(\\d+)/;`)],
    ]))).not.toThrow()
    expect(() => assertNoSensitiveContent(new Map([
      ["bundle.js", Buffer.from(String.raw`const email = /\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*/;`)],
    ]))).not.toThrow()
    expect(() => assertNoSensitiveContent(new Map([
      ["bundle.js", Buffer.from("source path C:/Temp/build/output.js")],
    ]))).toThrow("Local absolute path")
  })
})
