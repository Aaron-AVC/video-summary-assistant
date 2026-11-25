import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createHash } from "node:crypto"
import { deriveScope, load, noticeFiles, verifyOutput } from "./distribution-notices"

const evidence = "docs/licensing/evidence/R002-PR23"
const scopePath = `${evidence}/distribution-scope.json`
const cli = (args: string[], cwd = process.cwd()) => {
  const run = Bun.spawnSync([process.execPath, resolve("scripts/distribution-notices.ts"), ...args, "--historical"], { cwd })
  return { code: run.exitCode, text: `${run.stdout}${run.stderr}` }
}
function scratch(run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "vsa-pr23-test-"))
  try { run(dir) } finally { rmSync(dir, { recursive: true }) }
}
const scope = () => JSON.parse(readFileSync(scopePath, "utf8"))

test("fixed scope validates as blocked and preserves all closure and supplemental rows", () => {
  const result = cli(["scope"])
  expect(result.code).toBe(0)
  expect(result.text).toContain("BLOCKED_AUDIT_PREVIEW")
  const data = scope()
  expect(data.components.filter((row: { coverage: string }) => row.coverage === "REQUIRED_CLOSURE")).toHaveLength(70)
  expect(data.components.filter((row: { coverage: string }) => row.coverage === "OPTIONAL_ONLY")).toHaveLength(4)
})

test("separates graph observation, conservative coverage, and source attribution", () => {
  const inputs = load(true)
  const derived = deriveScope(inputs)
  const notices = noticeFiles(inputs, derived, false)
  const manifest = JSON.parse(notices.files.get("THIRD_PARTY/manifest.json")!.toString())
  const optional = manifest.components.filter((r: any) => r.coverage === "OPTIONAL_ONLY")
  expect(optional).toHaveLength(4)
  expect(optional.every((r: any) => r.includeInNotice && r.membership === "UNKNOWN" && r.materials.some((m: any) => m.role === "LICENSE"))).toBe(true)
  const upstream = manifest.components.find((r: any) => r.id === "source:youtube-summarizer")
  const shadcn = manifest.components.find((r: any) => r.id === "source:shadcn-templates")
  expect(upstream.evidence.flatMap((r: any) => r.sources)).toContain("src/features/platform/youtube/youtube-adapter.ts")
  expect(shadcn.evidence.flatMap((r: any) => r.sources)).not.toContain("src/features/platform/youtube/youtube-adapter.ts")
  const icon = manifest.components.find((r: any) => r.id === "asset:icon.png")
  expect(icon.unresolved).not.toContain("membership")
})

test.each([
  ["forged evidence", (s: any) => { s.components.find((r: any) => r.evidence.length).evidence = ["trust me"] }],
  ["another build", (s: any) => { s.graphSha256 = "0".repeat(64) }],
  ["wrong source", (s: any) => { s.sourceCommit = "0".repeat(40) }],
  ["UNKNOWN relabeled excluded", (s: any) => { s.components.find((r: any) => r.membership === "UNKNOWN").membership = "CONFIRMED_EXCLUDED" }],
  ["required component omitted", (s: any) => { s.components = s.components.filter((r: any) => r.coverage !== "REQUIRED_CLOSURE") }],
  ["outside-closure finding omitted", (s: any) => { s.components = s.components.filter((r: any) => r.id !== "npm:node_modules/@parcel/transformer-js/package.json") }],
] as const)("rejects %s", (_name, change) => scratch(dir => {
  const data = scope()
  change(data)
  const path = join(dir, "scope.json")
  writeFileSync(path, JSON.stringify(data))
  const result = cli(["scope", "--scope", path])
  expect(result.code).toBe(1)
  expect(result.text).toContain("Scope differs from derived evidence")
}))

test("unresolved component prevents candidate output before any file is written", () => scratch(dir => {
  const out = join(dir, "out")
  const result = cli(["generate", out, "--candidate"])
  expect(result.code).toBe(1)
  expect(result.text).toContain("Historical snapshot mode does not generate release candidates")
  expect(() => noticeFiles(load(true), deriveScope(load(true)), true)).toThrow("react-remove-scroll-bar@2.3.8")
  expect(() => readFileSync(join(out, "THIRD_PARTY_NOTICES.md"))).toThrow()
}))

test("preview preserves notice bytes and directory identities and rejects missing or modified output", () => scratch(dir => {
  const out = join(dir, "out")
  expect(cli(["generate", out]).code).toBe(0)
  const manifest = JSON.parse(readFileSync(join(out, "THIRD_PARTY/manifest.json"), "utf8"))
  expect(manifest.status).toBe("BLOCKED_AUDIT_PREVIEW")
  const dexie = manifest.components.find((r: any) => r.name === "dexie")
  const notice = dexie.materials.find((m: any) => m.role === "NOTICE")
  const src = readFileSync(`licenses/third-party/materials/${notice.sha256}.txt`)
  const target = join(out, notice.path)
  expect(readFileSync(target)).toEqual(src)
  expect(createHash("sha256").update(src).digest("hex")).toBe(notice.sha256)
  expect(manifest.components.filter((r: any) => r.name === "@radix-ui/react-slot" && r.version === "1.2.3")).toHaveLength(5)
  expect(manifest.components.some((r: any) => r.name === "@parcel/transformer-js" && r.materials.length)).toBe(true)
  const inputs = load(true)
  const plan = noticeFiles(inputs, deriveScope(inputs), false)
  verifyOutput(out, plan.files)
  unlinkSync(target)
  expect(() => verifyOutput(out, plan.files)).toThrow("Missing generated file")
  writeFileSync(target, src)
  const license = join(out, dexie.materials.find((m: any) => m.role === "LICENSE").path)
  const licenseBytes = readFileSync(license)
  unlinkSync(license)
  expect(() => verifyOutput(out, plan.files)).toThrow("Missing generated file")
  writeFileSync(license, Buffer.concat([licenseBytes, Buffer.from("changed")]))
  expect(() => verifyOutput(out, plan.files)).toThrow("Generated bytes differ")
  expect(cli(["generate", out]).code).toBe(1)
}))

test("rejects a capture or artifact without the pinned production output bytes", () => scratch(dir => {
  writeFileSync(join(dir, "manifest.json"), '{}')
  const result = cli(["scope", "--artifact", dir])
  expect(result.code).toBe(1)
  expect(result.text).toContain("Production artifact inventory differs")
}))
