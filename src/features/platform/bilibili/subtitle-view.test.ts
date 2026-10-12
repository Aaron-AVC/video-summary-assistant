import { describe, expect, it } from "bun:test"

import { decodeSubtitleViewTracks } from "./subtitle-view"

describe("modern Bilibili subtitle view decoder", () => {
  it("decodes bounded protobuf track fields", () => {
    const tracks = decodeSubtitleViewTracks(encodeView([{
      id: 7,
      language: "zh-CN",
      label: "中文",
      url: "//aisubtitle.hdslb.com/bfs/subtitle/modern.json",
    }]))
    expect(tracks).toEqual([{
      id: "7",
      language: "zh-CN",
      label: "中文",
      url: "https://aisubtitle.hdslb.com/bfs/subtitle/modern.json",
      source: "manual",
      order: 0,
    }])
  })

  it("decodes multiple tracks and preserves AI/manual metadata", () => {
    const tracks = decodeSubtitleViewTracks(encodeView([
      { id: 1, language: "zh-CN", label: "中文 AI", url: "https://aisubtitle.hdslb.com/bfs/subtitle/ai.json", type: 1 },
      { id: 2, language: "zh-CN", label: "中文", url: "https://aisubtitle.hdslb.com/bfs/subtitle/manual.json" },
    ]))
    expect(tracks.map(({ language, source }) => ({ language, source }))).toEqual([
      { language: "zh-CN", source: "auto" },
      { language: "zh-CN", source: "manual" },
    ])
  })

  it("accepts a JSON deployment response and fails closed on malformed bytes", () => {
    expect(decodeSubtitleViewTracks(JSON.stringify({ data: { subtitles: [
      { id: 1, lan: "ai-zh", lan_doc: "中文 AI", subtitle_url: "//aisubtitle.hdslb.com/bfs/subtitle/ai.json" },
    ] } }))).toMatchObject([{ language: "ai-zh", source: "auto" }])
    expect(decodeSubtitleViewTracks(new Uint8Array([0xff, 0xff, 0xff]))).toEqual([])
  })

  it("rejects oversized protobuf response bytes", () => {
    expect(decodeSubtitleViewTracks(new Uint8Array(8 * 1024 * 1024 + 1))).toEqual([])
  })
})

function fieldVarint(fieldNumber: number, value: number): Uint8Array {
  return concat(encodeVarint(fieldNumber * 8), encodeVarint(value))
}

function fieldString(fieldNumber: number, value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value)
  return concat(encodeVarint(fieldNumber * 8 + 2), encodeVarint(bytes.length), bytes)
}

function fieldBytes(fieldNumber: number, value: Uint8Array): Uint8Array {
  return concat(encodeVarint(fieldNumber * 8 + 2), encodeVarint(value.length), value)
}

function encodeView(tracks: Array<{
  id: number
  language: string
  label: string
  url: string
  type?: number
}>): Uint8Array {
  const list = concat(...tracks.map((track) => fieldBytes(3, concat(
    fieldVarint(1, track.id),
    fieldString(3, track.language),
    fieldString(4, track.label),
    fieldString(5, track.url),
    ...(track.type === undefined ? [] : [fieldVarint(7, track.type)]),
  ))))
  return fieldBytes(1, list)
}

function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = []
  let current = value
  while (current > 127) {
    bytes.push((current & 127) | 128)
    current = Math.floor(current / 128)
  }
  bytes.push(current)
  return new Uint8Array(bytes)
}

function concat(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}
