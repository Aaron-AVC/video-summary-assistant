import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import sharp from "sharp"

export type GeneratedIcon = { path: string, size: number, sha256: string, byteLength: number }

const SIZES = [16, 32, 48, 128] as const
const digest = (bytes: Buffer) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex")

export async function generateIcons(sourceSvgPath: string, outputDirectory: string) {
  const source = readFileSync(sourceSvgPath)
  const sourceText = source.toString("utf8")
  if (!sourceText.includes('viewBox="0 0 128 128"') || /<image\b|(?:href|src)=["']https?:/i.test(sourceText)) {
    throw new Error("Expected a self-contained 128px SVG composed without external image assets.")
  }
  mkdirSync(outputDirectory, { recursive: true })

  const files: GeneratedIcon[] = []
  const rendered = new Map<number, Buffer>()
  for (const size of SIZES) {
    const path = `icon-${size}.png`
    const bytes = await sharp(source, { density: 96 })
      .resize(size, size, { fit: "contain", kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 9, adaptiveFiltering: false })
      .toBuffer()
    rendered.set(size, bytes)
    const fullPath = join(outputDirectory, path)
    writeFileSync(fullPath, bytes, { flag: "wx" })
    files.push({ path, size, sha256: digest(bytes), byteLength: bytes.length })
  }

  const cells = [
    { size: 16, left: 30, top: 76, labelY: 123 },
    { size: 32, left: 131, top: 68, labelY: 123 },
    { size: 48, left: 230, top: 60, labelY: 123 },
    { size: 128, left: 323, top: 20, labelY: 171 },
  ]
  const labels = cells.map(({ size, left, labelY }) =>
    `<text x="${left + 45}" y="${labelY}" text-anchor="middle">${size} × ${size}px</text>`,
  ).join("")
  const sheetSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="470" height="190"><rect width="100%" height="100%" rx="18" fill="#eef1f5"/><g font-family="Arial,sans-serif" font-size="14" fill="#28354a">${labels}</g></svg>`,
  )
  const sheet = await sharp(sheetSvg)
    .composite(cells.map(({ size, left, top }) => ({ input: rendered.get(size)!, left, top })))
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer()
  writeFileSync(join(outputDirectory, "icon-preview-sheet.png"), sheet)

  return {
    tool: `sharp@${sharp.versions.sharp}`,
    files,
    previewSheet: {
      path: "icon-preview-sheet.png",
      sha256: digest(sheet),
      byteLength: sheet.length,
    },
  }
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..")
  const previewDirectory = join(root, "docs/licensing/evidence/R002-B/icon-previews")
  const result = await generateIcons(join(root, "assets/icon-source.svg"), previewDirectory)
  const productionIcon = join(root, "assets/icon.png")
  mkdirSync(dirname(productionIcon), { recursive: true })
  copyFileSync(join(previewDirectory, "icon-128.png"), productionIcon)
  console.log(JSON.stringify({ productionIcon: "assets/icon.png", ...result }, null, 2))
}
