import type { VideoAnalysis } from "@/features/analysis/lib/analysis-schema"
import type { TranscriptSegment } from "@/features/platform/types"
import type { KnowledgeItemEntity } from "@/lib/schemas/persistence"

/**
 * Markdown export for the authoritative RuntimeBridge content only. Every
 * source carries its own `contentKey`; a source is included only when it
 * matches the requested runtime identity exactly. Bilibili parts therefore
 * stay isolated because the canonical key already carries the part suffix.
 */

export type MarkdownExportIdentity = {
  contentKey: string
  platform: "youtube" | "bilibili"
  videoId: string
  partId: string | null
}

export type MarkdownExportAnalysisSource = {
  contentKey: string | null
  analysis: VideoAnalysis
  analysisRunId: string | null
  lastAnalyzedAt: string | null
}

export type MarkdownExportTranscriptSource = {
  contentKey: string | null
  cues: TranscriptSegment[]
}

export type MarkdownExportKnowledgeSource = {
  contentKey: string | null
  items: KnowledgeItemEntity[]
}

export type MarkdownExportSections = {
  analysis: boolean
  transcript: boolean
  knowledge: boolean
}

export type MarkdownExportSectionId = "analysis" | "transcript" | "knowledge"

export const DEFAULT_MARKDOWN_EXPORT_SECTIONS: MarkdownExportSections = Object.freeze({
  analysis: true,
  transcript: true,
  knowledge: true,
})

export type MarkdownExportRequest = {
  identity: MarkdownExportIdentity
  title: string
  canonicalUrl: string | null
  analysis: MarkdownExportAnalysisSource | null
  transcript: MarkdownExportTranscriptSource | null
  knowledge: MarkdownExportKnowledgeSource | null
  sections: MarkdownExportSections
  /**
   * Supplied by the caller so the formatter stays deterministic: identical
   * input always produces byte-identical Markdown.
   */
  generatedAt: string
}

export type MarkdownExportResult = {
  markdown: string
  filename: string
  includedSections: MarkdownExportSectionId[]
}

const FILENAME_MAX_LENGTH = 80

/**
 * Whole-second timestamps without locale formatting, so the exported file is
 * stable regardless of the UI locale.
 */
export function formatExportTimestamp(timestampSeconds: number): string {
  const totalSeconds = Math.max(0, Math.round(timestampSeconds))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

function formatPoint(timestampSeconds: number): string {
  return formatExportTimestamp(timestampSeconds)
}

function formatRange(startSec: number, endSec: number): string {
  return `${formatExportTimestamp(startSec)} – ${formatExportTimestamp(endSec)}`
}

function matchesIdentity(sourceContentKey: string | null, contentKey: string): boolean {
  return sourceContentKey !== null && sourceContentKey === contentKey
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function appendKeyPoints(lines: string[], analysis: VideoAnalysis): void {
  if (analysis.keyPoints.length === 0) return
  lines.push("## Key points")
  lines.push("")
  for (const keyPoint of analysis.keyPoints) {
    const text = oneLine(keyPoint.text)
    if (!text) continue
    if (keyPoint.startSec !== undefined && keyPoint.endSec !== undefined) {
      lines.push(`- **${formatRange(keyPoint.startSec, keyPoint.endSec)}** — ${text}`)
    } else {
      lines.push(`- ${text}`)
    }
  }
  lines.push("")
}

function appendChapters(lines: string[], analysis: VideoAnalysis): void {
  if (analysis.chapters.length === 0) return
  lines.push("## Chapters")
  lines.push("")
  for (const chapter of analysis.chapters) {
    lines.push(`### ${formatRange(chapter.startSec, chapter.endSec)} ${oneLine(chapter.title)}`)
    lines.push("")
    lines.push(oneLine(chapter.summary))
    lines.push("")
    lines.push(oneLine(chapter.detail))
    lines.push("")
  }
}

function appendTranscript(lines: string[], cues: TranscriptSegment[]): void {
  lines.push("## Transcript")
  lines.push("")
  for (const cue of cues) {
    const text = oneLine(cue.text)
    if (!text) continue
    lines.push(`- **[${formatRange(cue.startSec, cue.endSec)}]** ${text}`)
  }
  lines.push("")
}

type KnowledgeParagraph = {
  startSec: number | null
  createdAt: string
  id: string
  line: string
}

/**
 * Deterministic ordering: anchored items by timestamp, then unanchored items,
 * with creation time and id as stable tie-breakers.
 */
function orderKnowledge(items: KnowledgeItemEntity[]): KnowledgeItemEntity[] {
  return [...items].sort((left, right) => {
    const leftAnchor = left.startSec === null ? Number.POSITIVE_INFINITY : left.startSec
    const rightAnchor = right.startSec === null ? Number.POSITIVE_INFINITY : right.startSec
    if (leftAnchor !== rightAnchor) return leftAnchor - rightAnchor
    if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })
}

function knowledgeParagraph(item: KnowledgeItemEntity): KnowledgeParagraph {
  const text = item.text === null ? "" : oneLine(item.text)
  if (item.kind === "bookmark") {
    return {
      startSec: item.startSec,
      createdAt: item.createdAt,
      id: item.id,
      line:
        item.startSec === null
          ? "- **Bookmark**"
          : `- **Bookmark** at ${formatPoint(item.startSec)}`,
    }
  }
  if (item.startSec === null) {
    return {
      startSec: null,
      createdAt: item.createdAt,
      id: item.id,
      line: text ? `- **Note** — ${text}` : "- **Note**",
    }
  }
  return {
    startSec: item.startSec,
    createdAt: item.createdAt,
    id: item.id,
    line: text
      ? `- **Note** at ${formatPoint(item.startSec)} — ${text}`
      : `- **Note** at ${formatPoint(item.startSec)}`,
  }
}

function appendKnowledge(lines: string[], items: KnowledgeItemEntity[]): void {
  if (items.length === 0) return
  lines.push("## Bookmarks and notes")
  lines.push("")
  for (const item of orderKnowledge(items)) {
    lines.push(knowledgeParagraph(item).line)
  }
  lines.push("")
}

function platformLabel(platform: MarkdownExportIdentity["platform"]): string {
  return platform === "bilibili" ? "Bilibili" : "YouTube"
}

function sanitizeSegment(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\-\s]+/, "")
    .replace(/[.\-\s]+$/, "")
}

/**
 * Stable, filesystem-safe name that keeps CJK characters and always preserves
 * the video identity suffix, so Bilibili `p1` and `p2` can never collide even
 * when their titles do.
 */
export function sanitizeMarkdownFilename(
  title: string,
  identity: MarkdownExportIdentity
): string {
  const suffixSource = identity.partId
    ? `${identity.videoId}-p${identity.partId}`
    : identity.videoId
  const suffix = sanitizeSegment(suffixSource)
  const reserved = suffix ? suffix.length + 3 : 0
  const maxBase = Math.max(1, FILENAME_MAX_LENGTH - reserved)
  const baseSource = sanitizeSegment(title) || sanitizeSegment(identity.videoId) || "video"
  const base = baseSource.slice(0, maxBase).trim()
  const combined = suffix ? `${base} [${suffix}]` : base
  return `${combined}.md`
}

export function buildMarkdownExport(request: MarkdownExportRequest): MarkdownExportResult {
  const { identity, sections } = request
  const includedSections: MarkdownExportSectionId[] = []
  const lines: string[] = []

  lines.push(`# ${oneLine(request.title) || identity.contentKey}`)
  lines.push("")
  lines.push(`- Platform: ${platformLabel(identity.platform)}`)
  lines.push(`- Video ID: ${identity.videoId}`)
  if (identity.partId !== null) lines.push(`- Part: ${identity.partId}`)
  lines.push(`- Content key: \`${identity.contentKey}\``)
  if (request.canonicalUrl) lines.push(`- URL: ${oneLine(request.canonicalUrl)}`)
  lines.push(`- Exported: ${request.generatedAt}`)
  lines.push("")

  const analysis = request.analysis
  if (
    sections.analysis &&
    analysis !== null &&
    analysis.analysis !== null &&
    matchesIdentity(analysis.contentKey, identity.contentKey)
  ) {
    lines.push("## Summary")
    lines.push("")
    lines.push(oneLine(analysis.analysis.summary))
    lines.push("")
    appendKeyPoints(lines, analysis.analysis)
    appendChapters(lines, analysis.analysis)
    includedSections.push("analysis")
  }

  const transcript = request.transcript
  if (
    sections.transcript &&
    transcript !== null &&
    matchesIdentity(transcript.contentKey, identity.contentKey)
  ) {
    const before = lines.length
    appendTranscript(lines, transcript.cues)
    if (lines.length > before) includedSections.push("transcript")
  }

  const knowledge = request.knowledge
  if (
    sections.knowledge &&
    knowledge !== null &&
    matchesIdentity(knowledge.contentKey, identity.contentKey)
  ) {
    const items = knowledge.items.filter(
      (item) => item.contentKey === identity.contentKey
    )
    const before = lines.length
    appendKnowledge(lines, items)
    if (lines.length > before) includedSections.push("knowledge")
  }

  const markdown = `${lines.join("\n").trimEnd()}\n`

  return {
    markdown,
    filename: sanitizeMarkdownFilename(request.title, identity),
    includedSections,
  }
}
