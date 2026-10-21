import type { VideoAnalysis } from "@/features/analysis/lib/analysis-schema"
import type { TranscriptSegment, VideoIdentity } from "@/features/platform/types"
import type {
  AnalysisRunEntity,
  KnowledgeItemEntity,
  QaMessageEntity,
  QaThreadEntity,
  SegmentSummaryEntity,
  VideoRecordEntity,
} from "@/lib/schemas/persistence"
import {
  MAX_SEARCH_RESULTS,
  buildSearchSnippet,
  matchesSearchTokens,
  rankSearchResults,
  scoreSearchFields,
  tokenizeSearchQuery,
  type WeightedSearchField,
} from "@/features/search/lib/search-query"
import type {
  SearchRepositoryCandidates,
  SearchRepository,
} from "@/features/search/lib/search-repository"

export const SEARCH_RESULT_KINDS = [
  "current-runtime-content",
  "historical-analysis",
  "knowledge",
  "qa-thread",
] as const

export type SearchResultKind = (typeof SEARCH_RESULT_KINDS)[number]

/**
 * A uniform result row. Every field the opener needs is resolved here so the
 * presentation layer never re-reads persistence to decide where to navigate.
 */
export type SearchResult = {
  id: string
  kind: SearchResultKind
  title: string
  subtitle: string | null
  snippet: string
  updatedAt: string
  identity: VideoIdentity
  contentKey: string
  platform: "youtube" | "bilibili"
  videoId: string
  partId: string | null
  analysisRunId: string | null
  transcriptFingerprint: string | null
  knowledgeItemId: string | null
  threadId: string | null
  timestampSeconds: number | null
  /**
   * Where a current-runtime hit must be opened. Historical, knowledge and QA
   * rows carry `null` because they always resolve their own surface.
   */
  targetSurface: "overview" | "transcript" | null
}

/** The authoritative runtime projection; only a matching contentKey is searchable. */
export type SearchRuntimeProjection = {
  identity: VideoIdentity
  title: string
  author: string | null
  analysis: {
    analysisRunId: string | null
    transcriptFingerprint: string | null
    analysis: VideoAnalysis
  } | null
  transcript: {
    contentKey: string | null
    cues: TranscriptSegment[]
  }
}

export type SearchSnapshot = {
  query: string
  results: SearchResult[]
  isSearching: boolean
  error: string | null
}

export type SearchControllerDependencies = {
  repository: SearchRepository
}

export type SearchRequest = {
  query: string
  runtime: SearchRuntimeProjection | null
}

export type SearchController = {
  getSnapshot: () => SearchSnapshot
  subscribe: (listener: () => void) => () => void
  setQuery: (query: string) => void
  search: (request: SearchRequest) => Promise<void>
  refresh: (runtime: SearchRuntimeProjection | null) => Promise<void>
  reset: () => void
}

const EMPTY_SNAPSHOT: SearchSnapshot = {
  query: "",
  results: [],
  isSearching: false,
  error: null,
}

const TITLE_WEIGHT = 5
const BODY_WEIGHT = 3
const DETAIL_WEIGHT = 1

function identityOf(
  platform: "youtube" | "bilibili",
  videoId: string,
  contentKey: string,
  partId: string | null,
): VideoIdentity {
  return {
    platform,
    videoId,
    contentKey,
    ...(partId ? { partId } : {}),
  }
}

function rank(
  candidates: Array<{ result: SearchResult; score: number }>,
): SearchResult[] {
  return rankSearchResults(
    candidates.map((candidate) => ({
      item: candidate.result,
      score: candidate.score,
      updatedAt: candidate.result.updatedAt,
      tieBreak: `${candidate.result.kind}:${candidate.result.id}`,
    })),
    MAX_SEARCH_RESULTS,
  ).map((entry) => entry.item)
}

function analysisFields(
  run: AnalysisRunEntity,
  segments: SegmentSummaryEntity[],
): WeightedSearchField[] {
  const fields: WeightedSearchField[] = [
    { text: run.summary, weight: BODY_WEIGHT },
  ]

  for (const point of run.keyPoints) {
    fields.push({ text: point.text, weight: BODY_WEIGHT })
  }

  for (const topic of run.topics) {
    fields.push({ text: topic.label, weight: BODY_WEIGHT })
  }

  for (const segment of segments) {
    fields.push({ text: segment.title, weight: BODY_WEIGHT })
    fields.push({ text: segment.summary, weight: BODY_WEIGHT })
    if (segment.detail) fields.push({ text: segment.detail, weight: DETAIL_WEIGHT })
  }

  return fields
}

function bestSnippet(fields: WeightedSearchField[], tokens: string[]): string {
  for (const field of fields) {
    if (scoreSearchFields([field], tokens) >= 0) {
      return buildSearchSnippet(field.text, tokens)
    }
  }

  return ""
}

function resolveVideoRecord(
  records: VideoRecordEntity[],
  run: AnalysisRunEntity,
): VideoRecordEntity | null {
  return records.find((record) => record.contentKey === run.contentKey) ?? null
}

function buildHistoricalResults(
  candidates: SearchRepositoryCandidates,
  tokens: string[],
): Array<{ result: SearchResult; score: number }> {
  const results: Array<{ result: SearchResult; score: number }> = []

  for (const run of candidates.analysisRuns) {
    const segments = candidates.segmentsByRunId.get(run.id) ?? []
    const record = resolveVideoRecord(candidates.videoRecords, run)
    const contentKey = record?.contentKey ?? run.contentKey ?? null

    if (!contentKey) continue

    const title = record?.title ?? run.videoId
    const fields: WeightedSearchField[] = [
      { text: title, weight: TITLE_WEIGHT },
      ...analysisFields(run, segments),
    ]

    if (record?.channelTitle) {
      fields.push({ text: record.channelTitle, weight: BODY_WEIGHT })
    }
    const score = scoreSearchFields(fields, tokens)

    if (score < 0) continue

    const platform = record?.platform ?? run.platform ?? "youtube"
    const videoId = record?.videoId ?? run.videoId
    const partId = record?.partId ?? run.partId ?? null

    results.push({
      score,
      result: {
        id: `historical-analysis:${run.id}`,
        kind: "historical-analysis",
        title,
        subtitle: `${platform} · ${videoId}`,
        snippet: bestSnippet(fields, tokens),
        updatedAt: run.completedAt ?? run.updatedAt,
        identity: identityOf(platform, videoId, contentKey, partId),
        contentKey,
        platform,
        videoId,
        partId,
        analysisRunId: run.id,
        transcriptFingerprint: run.transcriptFingerprint ?? null,
        knowledgeItemId: null,
        threadId: null,
        timestampSeconds: null,
        targetSurface: null,
      },
    })
  }

  return results
}

function buildKnowledgeResults(
  items: KnowledgeItemEntity[],
  tokens: string[],
): Array<{ result: SearchResult; score: number }> {
  const results: Array<{ result: SearchResult; score: number }> = []

  for (const item of items) {
    const fields: WeightedSearchField[] = [
      { text: item.videoTitle, weight: TITLE_WEIGHT },
    ]

    if (item.text) fields.push({ text: item.text, weight: BODY_WEIGHT })

    const score = scoreSearchFields(fields, tokens)

    if (score < 0) continue

    results.push({
      score,
      result: {
        id: `knowledge:${item.id}`,
        kind: "knowledge",
        title: item.videoTitle,
        subtitle: `${item.platform} · ${item.videoId}`,
        snippet: bestSnippet(fields, tokens),
        updatedAt: item.updatedAt,
        identity: identityOf(item.platform, item.videoId, item.contentKey, item.partId),
        contentKey: item.contentKey,
        platform: item.platform,
        videoId: item.videoId,
        partId: item.partId,
        analysisRunId: item.analysisRunId,
        transcriptFingerprint: null,
        knowledgeItemId: item.id,
        threadId: null,
        timestampSeconds: item.startSec,
        targetSurface: null,
      },
    })
  }

  return results
}

function buildQaResults(
  candidates: SearchRepositoryCandidates,
  tokens: string[],
): Array<{ result: SearchResult; score: number }> {
  const results: Array<{ result: SearchResult; score: number }> = []
  const restorableRunContentKeys = new Map(
    candidates.analysisRuns.map((run) => [run.id, run.contentKey ?? null]),
  )

  for (const thread of candidates.qaThreads) {
    // A thread is only openable when its completed run still exists AND that
    // run belongs to the same canonical content as the thread itself. A run
    // from another video must never unlock this conversation.
    if (!restorableRunContentKeys.has(thread.analysisRunId)) continue
    if (restorableRunContentKeys.get(thread.analysisRunId) !== thread.contentKey) continue

    const messages = candidates.qaMessagesByThreadId.get(thread.id) ?? []
    const fields: WeightedSearchField[] = [
      { text: thread.title, weight: TITLE_WEIGHT },
    ]

    for (const message of messages) {
      fields.push({ text: message.content, weight: BODY_WEIGHT })
    }

    const score = scoreSearchFields(fields, tokens)

    if (score < 0) continue

    results.push({
      score,
      result: {
        id: `qa-thread:${thread.id}`,
        kind: "qa-thread",
        title: thread.title,
        subtitle: `${thread.platform} · ${thread.videoId}`,
        snippet: bestSnippet(fields, tokens),
        updatedAt: thread.updatedAt,
        identity: identityOf(thread.platform, thread.videoId, thread.contentKey, thread.partId),
        contentKey: thread.contentKey,
        platform: thread.platform,
        videoId: thread.videoId,
        partId: thread.partId,
        analysisRunId: thread.analysisRunId,
        transcriptFingerprint: thread.transcriptFingerprint,
        knowledgeItemId: null,
        threadId: thread.id,
        timestampSeconds: null,
        targetSurface: null,
      },
    })
  }

  return results
}

function buildCurrentRuntimeResults(
  runtime: SearchRuntimeProjection,
  tokens: string[],
): Array<{ result: SearchResult; score: number }> {
  const analysisFields: WeightedSearchField[] = [
    { text: runtime.title, weight: TITLE_WEIGHT },
  ]

  if (runtime.author) {
    analysisFields.push({ text: runtime.author, weight: TITLE_WEIGHT })
  }

  if (runtime.analysis) {
    analysisFields.push({ text: runtime.analysis.analysis.summary, weight: BODY_WEIGHT })

    for (const point of runtime.analysis.analysis.keyPoints) {
      analysisFields.push({ text: point.text, weight: BODY_WEIGHT })
    }

    for (const chapter of runtime.analysis.analysis.chapters) {
      analysisFields.push({ text: chapter.title, weight: BODY_WEIGHT })
      analysisFields.push({ text: chapter.summary, weight: BODY_WEIGHT })
      analysisFields.push({ text: chapter.detail, weight: DETAIL_WEIGHT })
    }
  }

  const transcriptFields: WeightedSearchField[] = runtime.transcript.cues.map((cue) => ({
    text: cue.text,
    weight: BODY_WEIGHT,
  }))

  const analysisScore = scoreSearchFields(analysisFields, tokens)
  const transcriptScore = scoreSearchFields(transcriptFields, tokens)

  if (analysisScore < 0 && transcriptScore < 0) return []

  // Analysis, title and author hits belong to the Overview surface; a hit that
  // only exists inside the transcript belongs to Transcript at the exact cue.
  const surface: "overview" | "transcript" = analysisScore >= 0 ? "overview" : "transcript"
  const matchingCue = surface === "transcript"
    ? runtime.transcript.cues.find((cue) => matchesSearchTokens(cue.text, tokens)) ?? null
    : null
  const fields = surface === "overview" ? analysisFields : transcriptFields
  const { identity } = runtime

  return [{
    score: Math.max(analysisScore, transcriptScore),
    result: {
      id: `current-runtime-content:${identity.contentKey}`,
      kind: "current-runtime-content",
      title: runtime.title,
      subtitle: `${identity.platform} · ${identity.videoId}`,
      snippet: bestSnippet(fields, tokens),
      updatedAt: "",
      identity,
      contentKey: identity.contentKey,
      platform: identity.platform,
      videoId: identity.videoId,
      partId: identity.partId ?? null,
      analysisRunId: runtime.analysis?.analysisRunId ?? null,
      transcriptFingerprint: runtime.analysis?.transcriptFingerprint ?? null,
      knowledgeItemId: null,
      threadId: null,
      timestampSeconds: matchingCue?.startSec ?? null,
      targetSurface: surface,
    },
  }]
}

/**
 * Drops the persisted historical row that represents the analysis currently
 * displayed for the authoritative runtime content, so the same run is never
 * listed twice under two different variants.
 */
function dedupeCurrentAnalysis(
  results: Array<{ result: SearchResult; score: number }>,
  runtime: SearchRuntimeProjection | null,
): Array<{ result: SearchResult; score: number }> {
  const currentRunId = runtime?.analysis?.analysisRunId ?? null

  if (!currentRunId) return results

  return results.filter(
    (entry) => !(
      entry.result.kind === "historical-analysis"
      && entry.result.analysisRunId === currentRunId
    ),
  )
}

export function createSearchController(
  dependencies: SearchControllerDependencies,
): SearchController {
  let snapshot: SearchSnapshot = { ...EMPTY_SNAPSHOT }
  let generation = 0
  const listeners = new Set<() => void>()

  function publish(next: SearchSnapshot) {
    snapshot = next
    for (const listener of listeners) listener()
  }

  function isCurrent(candidate: number): boolean {
    return candidate === generation
  }

  async function runSearch(request: SearchRequest): Promise<void> {
    const tokens = tokenizeSearchQuery(request.query)
    const requestGeneration = ++generation

    if (tokens.length === 0) {
      publish({ query: snapshot.query, results: [], isSearching: false, error: null })
      return
    }

    // Every later publication keeps the *current* query text. A scan that was
    // started for an older query must never resurrect the stale text the user
    // has since replaced. `setQuery` bumps the generation, so such a scan is
    // already dropped by the `isCurrent` checks below.
    publish({ query: snapshot.query, results: snapshot.results, isSearching: true, error: null })

    let candidates: SearchRepositoryCandidates

    try {
      candidates = await dependencies.repository.loadCandidates()
    } catch (error) {
      if (!isCurrent(requestGeneration)) return
      publish({
        query: snapshot.query,
        results: [],
        isSearching: false,
        error: error instanceof Error ? error.message : "Search failed.",
      })
      return
    }

    if (!isCurrent(requestGeneration)) return

    const combined = dedupeCurrentAnalysis(
      [
        ...buildHistoricalResults(candidates, tokens),
        ...buildKnowledgeResults(candidates.knowledgeItems, tokens),
        ...buildQaResults(candidates, tokens),
        ...(request.runtime ? buildCurrentRuntimeResults(request.runtime, tokens) : []),
      ],
      request.runtime,
    )

    const results = rank(combined)

    publish({
      query: snapshot.query,
      results,
      isSearching: false,
      error: null,
    })
  }

  return {
    getSnapshot: () => snapshot,

    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    setQuery: (query) => {
      if (query === snapshot.query) return

      // Editing the query invalidates any in-flight scan: its results describe
      // the previous text and must not be published under the new one.
      generation += 1
      publish({ query, results: [], isSearching: false, error: null })
    },

    search: runSearch,

    refresh: (runtime) => runSearch({ query: snapshot.query, runtime }),

    reset: () => {
      generation += 1
      publish({ ...EMPTY_SNAPSHOT })
    },
  }
}
