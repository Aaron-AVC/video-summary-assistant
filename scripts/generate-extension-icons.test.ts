import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
import { afterEach, describe, expect, it } from "bun:test"
import { generateIcons } from "./generate-extension-icons"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("project extension icon artwork", () => {
  it("generates the production icon and four reproducible size previews from the editable SVG", async () => {
    const output = mkdtempSync(join(tmpdir(), "vsa-r002-b-icons-"))
    temporaryDirectories.push(output)

    const result = await generateIcons(join(import.meta.dir, "../assets/icon-source.svg"), output)

    expect(result.tool).toBe("sharp@0.33.5")
    expect(result.files.map((file) => file.size)).toEqual([16, 32, 48, 128])
    expect(result.files.map((file) => file.path)).toEqual([
      "icon-16.png",
      "icon-32.png",
      "icon-48.png",
      "icon-128.png",
    ])
    for (const file of result.files) {
      const bytes = readFileSync(join(output, file.path))
      const metadata = await sharp(bytes).metadata()
      expect(metadata.width).toBe(file.size)
      expect(metadata.height).toBe(file.size)
      expect(bytes.length).toBeGreaterThan(100)
    }

    const svg = readFileSync(join(import.meta.dir, "../assets/icon-source.svg"), "utf8")
    expect(svg).toContain('viewBox="0 0 128 128"')
    expect(svg).not.toMatch(/<image\b|(?:href|src)=["']https?:/i)
  })
})
