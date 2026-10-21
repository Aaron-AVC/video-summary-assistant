import type { VideoAnalysis } from "@/features/analysis/lib/analysis-schema"
import type { TranscriptSegment } from "@/features/platform/types"
import type { KnowledgeItemEntity } from "@/lib/schemas/persistence"

/**
 * Markdown export for the authoritative RuntimeBridge content only. Every
 * source carries its own `contentKey`; a source is included only when it
 * matches the requested runtime identity exactly. Bilibili parts therefore
 * stay isolated because the canonical key already carries the part suffix.
 *
 * The formatter is byte-deterministic: it never reads the wall clock, so the
 * same runtime source and the same section selection always produce identical
 * text for both Copy and Download.
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

export type MarkdownExportAvailability = Record<MarkdownExportSectionId, boolean>

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
}

export type MarkdownExportResult = {
  markdown: string
  filename: string
  includedSections: MarkdownExportSectionId[]
}

export type MarkdownExportAvailabilityInput = {
  identity: MarkdownExportIdentity
  analysis: MarkdownExportAnalysisSource | null
  transcript: MarkdownExportTranscriptSource | null
  knowledge: MarkdownExportKnowledgeSource | null
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

function hasUsableCues(cues: TranscriptSegment[]): boolean {
  return cues.some((cue) => oneLine(cue.text).length > 0)
}

function exactKnowledgeItems(
  source: MarkdownExportKnowledgeSource | null,
  identity: MarkdownExportIdentity
): KnowledgeItemEntity[] {
  if (source === null || !matchesIdentity(source.contentKey, identity.contentKey)) return []
  return source.items.filter((item) => item.contentKey === identity.contentKey)
}

function isAnalysisAvailable(
  source: MarkdownExportAnalysisSource | null,
  identity: MarkdownExportIdentity
): boolean {
  return (
    source !== null &&
    source.analysis !== null &&
    matchesIdentity(source.contentKey, identity.contentKey)
  )
}

function isTranscriptAvailable(
  source: MarkdownExportTranscriptSource | null,
  identity: MarkdownExportIdentity
): boolean {
  return (
    source !== null &&
    matchesIdentity(source.contentKey, identity.contentKey) &&
    hasUsableCues(source.cues)
  )
}

/**
 * Availability is derived from the authoritative runtime `contentKey`, so a
 * stale source can never make its section look exportable after a video switch.
 */
export function resolveMarkdownExportAvailability(
  input: MarkdownExportAvailabilityInput
): MarkdownExportAvailability {
  const { identity, analysis, transcript, knowledge } = input
  return {
    analysis: isAnalysisAvailable(analysis, identity),
    transcript: isTranscriptAvailable(transcript, identity),
    knowledge: exactKnowledgeItems(knowledge, identity).length > 0,
  }
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

/**
 * A single point when start and end coincide (or no end exists), the full range
 * otherwise, and no anchor at all for an unanchored item.
 */
function knowledgeAnchor(item: KnowledgeItemEntity): string | null {
  if (item.startSec === null) return null
  if (item.endSec === null || item.endSec === item.startSec) {
    return formatPoint(item.startSec)
  }
  return formatRange(item.startSec, item.endSec)
}

function knowledgeLine(item: KnowledgeItemEntity): string {
  const label = item.kind === "bookmark" ? "Bookmark" : "Note"
  const text = item.kind === "note" && item.text !== null ? oneLine(item.text) : ""
  const anchor = knowledgeAnchor(item)

  if (anchor === null) {
    return text ? `- **${label}** — ${text}` : `- **${label}**`
  }
  return text ? `- **${label}** at ${anchor} — ${text}` : `- **${label}** at ${anchor}`
}

function appendKnowledge(lines: string[], items: KnowledgeItemEntity[]): void {
  if (items.length === 0) return
  lines.push("## Bookmarks and notes")
  lines.push("")
  for (const item of orderKnowledge(items)) {
    lines.push(knowledgeLine(item))
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
  lines.push("")

  const analysis = request.analysis
  if (sections.analysis && analysis !== null && isAnalysisAvailable(analysis, identity)) {
    lines.push("## Summary")
    lines.push("")
    lines.push(oneLine(analysis.analysis.summary))
    lines.push("")
    appendKeyPoints(lines, analysis.analysis)
    appendChapters(lines, analysis.analysis)
    includedSections.push("analysis")
  }

  const transcript = request.transcript
  if (sections.transcript && transcript !== null && isTranscriptAvailable(transcript, identity)) {
    appendTranscript(lines, transcript.cues)
    includedSections.push("transcript")
  }

  const knowledgeItems = exactKnowledgeItems(request.knowledge, identity)
  if (sections.knowledge && knowledgeItems.length > 0) {
    appendKnowledge(lines, knowledgeItems)
    includedSections.push("knowledge")
  }

  const markdown = `${lines.join("\n").trimEnd()}\n`

  return {
    markdown,
    filename: sanitizeMarkdownFilename(request.title, identity),
    includedSections,
  }
}
