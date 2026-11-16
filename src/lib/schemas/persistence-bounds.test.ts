import { describe, expect, it } from "bun:test"

import { parseLegacyAnalysis } from "@/features/analysis/lib/analysis-schema"
import {
  MAX_ANALYSIS_CHAPTERS,
  MAX_ANALYSIS_KEY_POINTS,
  MAX_ASK_CITATIONS,
  MAX_ASK_FOLLOW_UPS,
  MAX_ASK_SUGGESTED_JUMPS,
  MAX_EXPORTED_ROWS_PER_TABLE,
  MAX_LEGACY_ANALYSIS_KEY_POINTS,
  MAX_LEGACY_ANALYSIS_SEGMENTS,
  MAX_LEGACY_ANALYSIS_TOPICS,
  MAX_TRANSCRIPT_CUES
} from "@/lib/schemas/container-limits"
import {
  analysisRunSchema,
  persistenceExportSchema,
  qaMessageSchema,
  transcriptCacheSchema,
  transcriptSnapshotSchema
} from "@/lib/schemas/persistence"

const TIMESTAMP = "2026-03-10T12:00:00.000Z"

function repeat<T>(count: number, make: (index: number) => T): T[] {
  return Array.from({ length: count }, (_unused, index) => make(index))
}

function expectTooBig(result: { success: boolean; error?: { issues: { code: string }[] } }) {
  expect(result.success).toBe(false)
  const issues = result.error?.issues ?? []
  expect(issues).toHaveLength(1)
  expect(issues[0]?.code).toBe("too_big")
}

const cue = (index: number) => ({ startSec: index, endSec: index + 1, text: `Cue ${index}` })

const analysisRunRow = {
  id: "run-1",
  videoId: "video-1",
  transcriptSnapshotId: "snapshot-1",
  providerConfigId: null,
  status: "completed" as const,
  summary: "Summary",
  keyPoints: [{ text: "One" }],
  topics: [] as { label: string }[],
  errorMessage: null,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
  completedAt: TIMESTAMP
}

const transcriptSnapshotRow = {
  id: "snapshot-1",
  videoId: "video-1",
  language: "en",
  sourceUrl: null,
  rawVtt: null,
  cues: [{ startSec: 0, endSec: 1, text: "Cue" }],
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP
}

const transcriptCacheRow = {
  id: "cache-1",
  contentKey: "youtube:video-1",
  platform: "youtube" as const,
  videoId: "video-1",
  partId: null,
  fingerprint: null,
  language: "en",
  sourceUrl: null,
  rawVtt: null,
  cues: [{ startSec: 0, endSec: 1, text: "Cue" }],
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP
}

const qaMessageRow = {
  id: "message-1",
  threadId: "thread-1",
  sequence: 0,
  role: "assistant" as const,
  content: "Answer",
  createdAt: TIMESTAMP
}

const legacyAnalysisRow = {
  summary: "Summary",
  keyPoints: [{ text: "One" }],
  topics: [] as { label: string }[],
  segments: [{ title: "Segment", summary: "Summary", startSec: 0, endSec: 1 }]
}

const exportRowByTable: Record<string, Record<string, unknown>> = {
  providerConfigs: {
    id: "provider-1",
    name: "Hosted",
    baseUrl: "https://api.example.com",
    model: "model-1",
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    hasApiKey: true
  },
  transcriptSnapshots: transcriptSnapshotRow,
  analysisRuns: analysisRunRow,
  segmentSummaries: {
    id: "segment-1",
    analysisRunId: "run-1",
    videoId: "video-1",
    title: "Segment",
    summary: "Summary",
    startSec: 0,
    endSec: 1,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP
  },
  recentVideos: {
    videoId: "video-1",
    title: "Video",
    channelTitle: null,
    thumbnailUrl: null,
    status: null,
    updatedAt: TIMESTAMP,
    openedAt: TIMESTAMP,
    analyzedAt: null
  },
  videoRecords: {
    contentKey: "youtube:video-1",
    platform: "youtube",
    videoId: "video-1",
    partId: null,
    title: "Video",
    channelTitle: null,
    thumbnailUrl: null,
    canonicalUrl: null,
    durationSec: null,
    openedAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    analyzedAt: null
  },
  transcriptCache: transcriptCacheRow,
  analysisCache: {
    cacheKey: "cache-1",
    contentKey: "youtube:video-1",
    platform: "youtube",
    videoId: "video-1",
    partId: null,
    transcriptFingerprint: null,
    analysisSchemaVersion: null,
    analysisPromptVersion: null,
    providerProfileId: null,
    providerBaseUrl: null,
    providerModel: null,
    analysisRunId: null,
    analysis: null,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP
  },
  qaAnswers: {
    cacheKey: "answer-1",
    contentKey: "youtube:video-1",
    transcriptFingerprint: "fp-1",
    analysisRunId: "run-1",
    providerProfileId: "provider",
    providerBaseUrl: "https://api.example.com/v1",
    providerModel: "model-1",
    question: "Why?",
    schemaVersion: 1,
    promptVersion: "video-qa-v2",
    answer: {
      answer: "Because.",
      citations: [{ startSec: 0, endSec: 1 }],
      suggestedJumps: [],
      followUps: []
    },
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP
  },
  qaThreads: {
    id: "thread-1",
    contentKey: "youtube:video-1",
    platform: "youtube",
    videoId: "video-1",
    partId: null,
    title: "Question",
    analysisRunId: "run-1",
    transcriptFingerprint: "fp-1",
    providerProfileId: "provider",
    providerBaseUrl: "https://api.example.com/v1",
    providerModel: "model-1",
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP
  },
  qaMessages: qaMessageRow,
  knowledgeItems: {
    id: "knowledge-1",
    kind: "bookmark",
    contentKey: "youtube:video-1",
    platform: "youtube",
    videoId: "video-1",
    partId: null,
    videoTitle: "Video",
    analysisRunId: null,
    startSec: 1,
    endSec: 1,
    text: null,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP
  }
}

const requiredExportTables = [
  "providerConfigs",
  "transcriptSnapshots",
  "analysisRuns",
  "segmentSummaries",
  "recentVideos"
] as const

const exportTableNames = Object.keys(exportRowByTable) as (keyof typeof exportRowByTable)[]

function buildExport(overrides: Record<string, unknown[]>) {
  const base: Record<string, unknown[]> = {}
  for (const table of requiredExportTables) base[table] = []
  return { ...base, ...overrides }
}

describe("persisted analysis row collection bounds", () => {
  it("accepts exactly the maximum number of persisted key points", () => {
    const result = analysisRunSchema.safeParse({
      ...analysisRunRow,
      keyPoints: repeat(MAX_ANALYSIS_KEY_POINTS, (index) => ({ text: `point ${index}` }))
    })
    expect(result.success).toBe(true)
  })

  it("rejects one persisted key point over the maximum", () => {
    expectTooBig(
      analysisRunSchema.safeParse({
        ...analysisRunRow,
        keyPoints: repeat(MAX_ANALYSIS_KEY_POINTS + 1, (index) => ({ text: `point ${index}` }))
      })
    )
  })

  it("accepts exactly the maximum number of persisted topics", () => {
    const result = analysisRunSchema.safeParse({
      ...analysisRunRow,
      topics: repeat(MAX_ANALYSIS_CHAPTERS, (index) => ({ label: `topic ${index}` }))
    })
    expect(result.success).toBe(true)
  })

  it("rejects one persisted topic over the maximum", () => {
    expectTooBig(
      analysisRunSchema.safeParse({
        ...analysisRunRow,
        topics: repeat(MAX_ANALYSIS_CHAPTERS + 1, (index) => ({ label: `topic ${index}` }))
      })
    )
  })
})

describe("persisted transcript cue collection bounds", () => {
  it("accepts exactly the maximum number of snapshot cues", () => {
    const result = transcriptSnapshotSchema.safeParse({
      ...transcriptSnapshotRow,
      cues: repeat(MAX_TRANSCRIPT_CUES, cue)
    })
    expect(result.success).toBe(true)
  })

  it("rejects one snapshot cue over the maximum", () => {
    expectTooBig(
      transcriptSnapshotSchema.safeParse({
        ...transcriptSnapshotRow,
        cues: repeat(MAX_TRANSCRIPT_CUES + 1, cue)
      })
    )
  })

  it("accepts exactly the maximum number of cache cues", () => {
    const result = transcriptCacheSchema.safeParse({
      ...transcriptCacheRow,
      cues: repeat(MAX_TRANSCRIPT_CUES, cue)
    })
    expect(result.success).toBe(true)
  })

  it("rejects one cache cue over the maximum", () => {
    expectTooBig(
      transcriptCacheSchema.safeParse({
        ...transcriptCacheRow,
        cues: repeat(MAX_TRANSCRIPT_CUES + 1, cue)
      })
    )
  })
})

describe("persisted Ask message nested collection bounds", () => {
  it("accepts exactly the maximum number of citations", () => {
    const result = qaMessageSchema.safeParse({
      ...qaMessageRow,
      citations: repeat(MAX_ASK_CITATIONS, () => ({ startSec: 0, endSec: 10 }))
    })
    expect(result.success).toBe(true)
  })

  it("rejects one citation over the maximum", () => {
    expectTooBig(
      qaMessageSchema.safeParse({
        ...qaMessageRow,
        citations: repeat(MAX_ASK_CITATIONS + 1, () => ({ startSec: 0, endSec: 10 }))
      })
    )
  })

  it("accepts exactly the maximum number of suggested jumps", () => {
    const result = qaMessageSchema.safeParse({
      ...qaMessageRow,
      suggestedJumps: repeat(MAX_ASK_SUGGESTED_JUMPS, (index) => ({
        title: `Jump ${index}`,
        startSec: 0,
        endSec: 10
      }))
    })
    expect(result.success).toBe(true)
  })

  it("rejects one suggested jump over the maximum", () => {
    expectTooBig(
      qaMessageSchema.safeParse({
        ...qaMessageRow,
        suggestedJumps: repeat(MAX_ASK_SUGGESTED_JUMPS + 1, (index) => ({
          title: `Jump ${index}`,
          startSec: 0,
          endSec: 10
        }))
      })
    )
  })

  it("accepts exactly the maximum number of follow-ups", () => {
    const result = qaMessageSchema.safeParse({
      ...qaMessageRow,
      followUps: repeat(MAX_ASK_FOLLOW_UPS, (index) => `Question ${index}?`)
    })
    expect(result.success).toBe(true)
  })

  it("rejects one follow-up over the maximum", () => {
    expectTooBig(
      qaMessageSchema.safeParse({
        ...qaMessageRow,
        followUps: repeat(MAX_ASK_FOLLOW_UPS + 1, (index) => `Question ${index}?`)
      })
    )
  })
})

describe("legacy analysis collection bounds", () => {
  it("accepts exactly the maximum legacy key points", () => {
    expect(
      parseLegacyAnalysis({
        ...legacyAnalysisRow,
        keyPoints: repeat(MAX_LEGACY_ANALYSIS_KEY_POINTS, (index) => ({ text: `point ${index}` }))
      }).keyPoints
    ).toHaveLength(MAX_LEGACY_ANALYSIS_KEY_POINTS)
  })

  it("rejects one legacy key point over the maximum", () => {
    expect(() =>
      parseLegacyAnalysis({
        ...legacyAnalysisRow,
        keyPoints: repeat(MAX_LEGACY_ANALYSIS_KEY_POINTS + 1, (index) => ({ text: `point ${index}` }))
      })
    ).toThrow()
  })

  it("accepts exactly the maximum legacy topics", () => {
    expect(
      parseLegacyAnalysis({
        ...legacyAnalysisRow,
        topics: repeat(MAX_LEGACY_ANALYSIS_TOPICS, (index) => ({ label: `topic ${index}` }))
      }).topics
    ).toHaveLength(MAX_LEGACY_ANALYSIS_TOPICS)
  })

  it("rejects one legacy topic over the maximum", () => {
    expect(() =>
      parseLegacyAnalysis({
        ...legacyAnalysisRow,
        topics: repeat(MAX_LEGACY_ANALYSIS_TOPICS + 1, (index) => ({ label: `topic ${index}` }))
      })
    ).toThrow()
  })

  it("accepts exactly the maximum legacy segments and moments", () => {
    const segment = (index: number) => ({
      title: `Segment ${index}`,
      summary: "Summary",
      startSec: 0,
      endSec: 1
    })
    expect(
      parseLegacyAnalysis({
        ...legacyAnalysisRow,
        segments: repeat(MAX_LEGACY_ANALYSIS_SEGMENTS, segment)
      }).segments
    ).toHaveLength(MAX_LEGACY_ANALYSIS_SEGMENTS)
    expect(
      parseLegacyAnalysis({
        ...legacyAnalysisRow,
        segments: undefined,
        moments: repeat(MAX_LEGACY_ANALYSIS_SEGMENTS, segment)
      }).moments
    ).toHaveLength(MAX_LEGACY_ANALYSIS_SEGMENTS)
  })

  it("rejects one legacy segment or moment over the maximum", () => {
    const segment = (index: number) => ({
      title: `Segment ${index}`,
      summary: "Summary",
      startSec: 0,
      endSec: 1
    })
    expect(() =>
      parseLegacyAnalysis({
        ...legacyAnalysisRow,
        segments: repeat(MAX_LEGACY_ANALYSIS_SEGMENTS + 1, segment)
      })
    ).toThrow()
    expect(() =>
      parseLegacyAnalysis({
        ...legacyAnalysisRow,
        segments: undefined,
        moments: repeat(MAX_LEGACY_ANALYSIS_SEGMENTS + 1, segment)
      })
    ).toThrow()
  })
})

describe("export snapshot table row bounds", () => {
  for (const table of exportTableNames) {
    it(`rejects one ${table} row over the export ceiling`, () => {
      const row = exportRowByTable[table]!
      expectTooBig(
        persistenceExportSchema.safeParse(
          buildExport({ [table]: new Array(MAX_EXPORTED_ROWS_PER_TABLE + 1).fill(row) })
        )
      )
    })
  }

  it("accepts exactly the export ceiling for a representative table", () => {
    const rows = new Array(MAX_EXPORTED_ROWS_PER_TABLE).fill(exportRowByTable.providerConfigs)
    expect(persistenceExportSchema.safeParse(buildExport({ providerConfigs: rows })).success).toBe(true)
  })

  it("accepts exactly the export ceiling for a table with nested collections", () => {
    const rows = new Array(MAX_EXPORTED_ROWS_PER_TABLE).fill(exportRowByTable.qaMessages)
    expect(persistenceExportSchema.safeParse(buildExport({ qaMessages: rows })).success).toBe(true)
  })

  it("keeps every exported table at the same ceiling", () => {
    expect(exportTableNames).toHaveLength(12)
  })
})
