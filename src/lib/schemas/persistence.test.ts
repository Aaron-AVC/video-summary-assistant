import { describe, expect, it } from "bun:test"

import {
  analysisRunSchema,
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
