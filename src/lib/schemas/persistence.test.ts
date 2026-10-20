import { describe, expect, it } from "bun:test"

import {
  MAX_KNOWLEDGE_NOTE_LENGTH,
  analysisRunSchema,
  knowledgeItemSchema,
  persistenceExportSchema,
  providerConfigSchema,
  recentVideoSchema,
  segmentSummarySchema,
  transcriptSnapshotSchema
} from "@/lib/schemas/persistence"

const timestamp = "2026-03-10T12:00:00.000Z"

describe("persistence schemas", () => {
  it("accepts valid persisted entities", () => {
    expect(
      providerConfigSchema.parse({
        id: "provider-1",
        name: "Hosted",
        baseUrl: "https://api.example.com",
        apiKey: "sk-test-placeholder",
        model: "gpt-4.1",
        createdAt: timestamp,
        updatedAt: timestamp
      })
    ).toBeDefined()

    expect(
      transcriptSnapshotSchema.parse({
        id: "snapshot-1",
        videoId: "abc123",
        language: "en",
        sourceUrl: "https://www.youtube.com/watch?v=abc123",
        rawVtt: "WEBVTT",
        cues: [{ startSec: 0, endSec: 10, text: "Intro" }],
        createdAt: timestamp,
        updatedAt: timestamp
      })
    ).toBeDefined()

    expect(
      segmentSummarySchema.parse({
        id: "segment-1",
        analysisRunId: "run-1",
        videoId: "abc123",
        title: "Intro",
        summary: "Overview",
        startSec: 0,
        endSec: 10,
        createdAt: timestamp,
        updatedAt: timestamp
      })
    ).toBeDefined()

    expect(
      analysisRunSchema.parse({
        id: "run-1",
        videoId: "abc123",
        transcriptSnapshotId: "snapshot-1",
        providerConfigId: "provider-1",
        status: "completed",
        summary: "Summary",
        keyPoints: [
          {
            text: "One",
            startSec: 0,
            endSec: 10
          }
        ],
        topics: [
          {
            label: "Topic",
            startSec: 0,
            endSec: 10
          }
        ],
        errorMessage: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: timestamp
      })
    ).toBeDefined()

    expect(
      recentVideoSchema.parse({
        videoId: "abc123",
        title: "Video",
        channelTitle: "Channel",
        thumbnailUrl: "https://img.youtube.com/vi/abc123/default.jpg",
        status: "completed",
        updatedAt: timestamp,
        openedAt: timestamp,
        analyzedAt: timestamp
      })
    ).toBeDefined()
  })

  it("rejects invalid persistence exports", () => {
    expect(() =>
      persistenceExportSchema.parse({
        providerConfigs: [
          {
            id: "provider-1",
            name: "Hosted",
            baseUrl: "not-a-url",
            apiKey: "sk-test-placeholder",
            model: "gpt-4.1",
            createdAt: timestamp,
            updatedAt: timestamp
          }
        ],
        transcriptSnapshots: [],
        analysisRuns: [],
        segmentSummaries: [],
        recentVideos: []
      })
    ).toThrow()
  })

  it("normalizes legacy string key points and topics", () => {
    expect(
      analysisRunSchema.parse({
        id: "run-1",
        videoId: "abc123",
        transcriptSnapshotId: "snapshot-1",
        providerConfigId: "provider-1",
        status: "completed",
        summary: "Summary",
        keyPoints: ["One"],
        topics: ["Topic"],
        errorMessage: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: timestamp
      })
    ).toEqual(
      expect.objectContaining({
        keyPoints: [{ text: "One" }],
        topics: [{ label: "Topic" }]
      })
    )
  })

  it("rejects invalid persisted timestamp ranges", () => {
    expect(() =>
      analysisRunSchema.parse({
        id: "run-1",
        videoId: "abc123",
        transcriptSnapshotId: "snapshot-1",
        providerConfigId: "provider-1",
        status: "completed",
        summary: "Summary",
        keyPoints: [
          {
            text: "One",
            startSec: 10,
            endSec: 2
          }
        ],
        topics: [],
        errorMessage: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: timestamp
      })
    ).toThrow("End time must be greater than or equal to start time")
  })
})

const knowledgeRow = (overrides: Record<string, unknown> = {}) => ({
  id: "knowledge-1",
  kind: "bookmark",
  contentKey: "youtube:video-a",
  platform: "youtube",
  videoId: "video-a",
  partId: null,
  videoTitle: "Video A",
  analysisRunId: null,
  startSec: 12,
  endSec: 12,
  text: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  ...overrides
})

describe("knowledge item schema", () => {
  it("accepts a point bookmark and an anchored note", () => {
    expect(knowledgeItemSchema.parse(knowledgeRow())).toBeDefined()
    expect(
      knowledgeItemSchema.parse(
        knowledgeRow({ kind: "note", text: "Remember this", startSec: 4, endSec: 9 })
      )
    ).toBeDefined()
  })

  it("accepts an unanchored note", () => {
    expect(
      knowledgeItemSchema.parse(
        knowledgeRow({ kind: "note", text: "Free form", startSec: null, endSec: null })
      )
    ).toBeDefined()
  })

  it("rejects a bookmark without a timestamp", () => {
    expect(() =>
      knowledgeItemSchema.parse(knowledgeRow({ startSec: null, endSec: null }))
    ).toThrow("Bookmarks must record a timestamp")
  })

  it("rejects a bookmark whose range is not a point", () => {
    expect(() => knowledgeItemSchema.parse(knowledgeRow({ endSec: 20 }))).toThrow(
      "UI-created bookmarks are point anchors"
    )
  })

  it("rejects a bookmark that carries text", () => {
    expect(() => knowledgeItemSchema.parse(knowledgeRow({ text: "nope" }))).toThrow(
      "Bookmarks cannot carry note text"
    )
  })

  it("rejects a one-sided anchor", () => {
    expect(() =>
      knowledgeItemSchema.parse(
        knowledgeRow({ kind: "note", text: "half", startSec: 3, endSec: null })
      )
    ).toThrow("Knowledge anchors must declare both start and end seconds")
  })

  it("rejects an inverted note range and empty note text", () => {
    expect(() =>
      knowledgeItemSchema.parse(
        knowledgeRow({ kind: "note", text: "flip", startSec: 9, endSec: 3 })
      )
    ).toThrow("End time must be greater than or equal to start time")
    expect(() =>
      knowledgeItemSchema.parse(knowledgeRow({ kind: "note", text: "   " }))
    ).toThrow("Notes require non-empty text")
  })

  it("rejects note text beyond the maximum length", () => {
    expect(() =>
      knowledgeItemSchema.parse(
        knowledgeRow({ kind: "note", text: "x".repeat(MAX_KNOWLEDGE_NOTE_LENGTH + 1) })
      )
    ).toThrow(`Notes cannot exceed ${MAX_KNOWLEDGE_NOTE_LENGTH} characters`)
  })
})

describe("knowledge export compatibility", () => {
  const baseExport = {
    providerConfigs: [],
    transcriptSnapshots: [],
    analysisRuns: [],
    segmentSummaries: [],
    recentVideos: []
  }

  it("parses a legacy payload that has no knowledgeItems field", () => {
    const parsed = persistenceExportSchema.parse({ ...baseExport })
    expect(parsed.knowledgeItems).toBeUndefined()
  })

  it("parses a payload that carries valid knowledge items", () => {
    const parsed = persistenceExportSchema.parse({
      ...baseExport,
      knowledgeItems: [knowledgeRow(), knowledgeRow({ id: "knowledge-2", kind: "note", text: "hi" })]
    })
    expect(parsed.knowledgeItems).toHaveLength(2)
  })

  it("rejects malformed knowledge items in an export", () => {
    expect(() =>
      persistenceExportSchema.parse({
        ...baseExport,
        knowledgeItems: [knowledgeRow({ kind: "note", text: "" })]
      })
    ).toThrow("Notes require non-empty text")
  })
})
