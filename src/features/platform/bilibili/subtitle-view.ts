import { normalizeBilibiliSubtitleUrl } from "@/features/platform/bilibili/bilibili-transport"

export type SubtitleViewTrack = {
  id: string
  language: string
  label: string
  url: string
  source: "manual" | "auto" | "unknown"
  order: number
}

const MAX_PROTOBUF_BYTES = 8 * 1024 * 1024
const MAX_PROTOBUF_FIELDS = 4096

/**
 * Decodes the small subset of the subtitle/web/view response needed by V1.
 * The endpoint has shipped as protobuf, while a few deployments return JSON;
 * accepting both keeps the transport boundary deterministic without adding a
 * general protobuf dependency.
 */
export function decodeSubtitleViewTracks(input: ArrayBuffer | Uint8Array | string): SubtitleViewTrack[] {
  if (typeof input === "string") {
    try {
      return mapTrackCandidates(JSON.parse(input))
    } catch {
      return []
    }
  }

  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PROTOBUF_BYTES) return []
  if (looksLikeUtf8Json(bytes)) {
    try {
      return mapTrackCandidates(JSON.parse(new TextDecoder().decode(bytes)))
    } catch {
      return []
    }
  }

  try {
    const envelope = parseFields(bytes)
    const tracks: SubtitleViewTrack[] = []
    for (const dataField of envelope) {
      if (dataField.fieldNumber !== 1 || dataField.wireType !== 2 || !(dataField.value instanceof Uint8Array)) continue
      const dataFields = parseFields(dataField.value)
      for (const trackField of dataFields) {
        if (trackField.fieldNumber !== 3 || trackField.wireType !== 2 || !(trackField.value instanceof Uint8Array)) continue
        const candidate = mapProtobufTrack(parseFields(trackField.value), tracks.length)
        if (candidate) tracks.push(candidate)
      }
    }
    return dedupeTracks(tracks)
  } catch {
    return []
  }
}

function mapProtobufTrack(fields: ProtoField[], order: number): SubtitleViewTrack | null {
  const id = numericField(fields, 1)
  const language = stringField(fields, 3)
  const label = stringField(fields, 4) || stringField(fields, 8) || language
  const url = normalizeBilibiliSubtitleUrl(stringField(fields, 5))
  if (!url) return null
  const subtitleType = numericField(fields, 7)
  return {
    id: id === null ? stringField(fields, 2) || String(order + 1) : String(id),
    language,
    label,
    url,
    source: subtitleType === 1 || isAutoSubtitle(language, label) ? "auto" : "manual",
    order,
  }
}

type ProtoField = {
  fieldNumber: number
  wireType: number
  value: string | Uint8Array | number
}

function parseFields(bytes: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = []
  let offset = 0
  while (offset < bytes.length && fields.length < MAX_PROTOBUF_FIELDS) {
    const key = readVarint(bytes, offset)
    offset = key.offset
    const fieldNumber = Math.floor(key.value / 8)
    const wireType = key.value % 8
    if (fieldNumber <= 0) throw new Error("invalid protobuf field")

    if (wireType === 0) {
      const value = readVarint(bytes, offset)
      offset = value.offset
      fields.push({ fieldNumber, wireType, value: value.value })
      continue
    }
    if (wireType === 1) {
      if (offset + 8 > bytes.length) throw new Error("truncated protobuf fixed64")
      offset += 8
      fields.push({ fieldNumber, wireType, value: 0 })
      continue
    }
    if (wireType === 2) {
      const length = readVarint(bytes, offset)
      offset = length.offset
      const end = offset + length.value
      if (end > bytes.length) throw new Error("truncated protobuf bytes")
      const value = bytes.slice(offset, end)
      offset = end
      fields.push({
        fieldNumber,
        wireType,
        value: isPrintableUtf8(value) ? new TextDecoder().decode(value) : value,
      })
      continue
    }
    if (wireType === 5) {
      if (offset + 4 > bytes.length) throw new Error("truncated protobuf fixed32")
      offset += 4
      fields.push({ fieldNumber, wireType, value: 0 })
      continue
    }
    throw new Error("unsupported protobuf wire type")
  }
  return fields
}

function readVarint(bytes: Uint8Array, start: number): { value: number; offset: number } {
  let value = 0
  let shift = 0
  let offset = start
  while (offset < bytes.length && shift <= 53) {
    const byte = bytes[offset++]!
    value += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) return { value, offset }
    shift += 7
  }
  throw new Error("invalid protobuf varint")
}

function stringField(fields: ProtoField[], fieldNumber: number): string {
  const field = fields.find((candidate) => candidate.fieldNumber === fieldNumber && candidate.wireType === 2)
  if (typeof field?.value === "string") return field.value.trim()
  return ""
}

function numericField(fields: ProtoField[], fieldNumber: number): number | null {
  const value = fields.find((candidate) => candidate.fieldNumber === fieldNumber && candidate.wireType === 0)?.value
  return typeof value === "number" ? value : null
}

function mapTrackCandidates(value: unknown): SubtitleViewTrack[] {
  const candidates: SubtitleViewTrack[] = []
  walkObjects(value, (record) => {
    const url = normalizeBilibiliSubtitleUrl(record.subtitle_url ?? record.subtitleUrl ?? record.url)
    if (!url) return
    const language = textValue(record.lan ?? record.language ?? record.lang)
    const label = textValue(record.lan_doc ?? record.lanDoc ?? record.label ?? record.name)
    candidates.push({
      id: textValue(record.id) || String(candidates.length + 1),
      language,
      label,
      url,
      source: isAutoSubtitle(language, label) ? "auto" : "manual",
      order: candidates.length,
    })
  })
  return dedupeTracks(candidates)
}

function walkObjects(value: unknown, visitor: (record: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const entry of value) walkObjects(entry, visitor)
    return
  }
  if (!isRecord(value)) return
  visitor(value)
  for (const child of Object.values(value)) walkObjects(child, visitor)
}

function dedupeTracks(tracks: SubtitleViewTrack[]): SubtitleViewTrack[] {
  const seen = new Set<string>()
  return tracks.filter((track) => {
    const key = `${track.url}|${track.language}|${track.label}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isAutoSubtitle(language: string, label: string): boolean {
  return /^ai[-_]/i.test(language)
    || /auto|ai|自动|机器|生成/i.test(`${language} ${label}`)
}

function looksLikeLanguage(value: string): boolean {
  return /^[a-z]{2,3}(?:[-_][a-z]{2,4})?$/i.test(value.trim())
    || /中文|英文|英语|日文|字幕|auto|自动|ai/i.test(value)
}

function isPrintableUtf8(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return text.length > 0 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)
  } catch {
    return false
  }
}

function looksLikeUtf8Json(bytes: Uint8Array): boolean {
  const text = new TextDecoder().decode(bytes.slice(0, 32)).trimStart()
  return text.startsWith("{") || text.startsWith("[")
}

function textValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
