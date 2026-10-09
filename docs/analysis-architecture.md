# Structured video analysis architecture

Task 5 defines `VideoAnalysis` as the only fresh-analysis domain contract:

```ts
interface VideoAnalysis {
  summary: string
  keyPoints: Array<{ text: string; startSec?: number; endSec?: number }>
  chapters: Array<{
    title: string
    startSec: number
    endSec: number
    summary: string
    detail: string
  }>
}
```

The model-facing versions are `VIDEO_ANALYSIS_SCHEMA_VERSION = 1` and
`VIDEO_ANALYSIS_PROMPT_VERSION = "video-analysis-v1"`. The model never supplies
IDs; UI and persistence create local identities.

## Processing pipeline

1. The provider returns JSON with `response_format: { type: "json_object" }`.
2. `parse-video-analysis.ts` trims input, removes at most one Markdown fence,
   parses one JSON object, and rejects arrays, fragments, JSON5, and guessed
   repairs.
3. Zod validates the strict `summary`/`keyPoints`/`chapters` schema.
4. `normalize-video-analysis.ts` clamps to transcript and finite duration
   bounds, snaps ranges to deterministic cue boundaries, sorts chapters,
   deduplicates exact normalized ranges, and preserves untimed key points.
5. If any step fails, exactly one repair request is made with the same provider
   client and explicit model. The repair response follows the same pipeline.
   A second failure is surfaced as a structured-analysis error; no fallback
   chapter or fake key point is generated.

Transcript text, chunk summaries, and the previous invalid model response are
always marked as untrusted evidence. The repair prompt never treats them as
instructions.

## Ask AI

Ask AI uses its own strict answer/citation schema. Parse, transcript-ground,
and drop invalid citations first; then make at most one repair request. The
repair response is parsed and grounded again before it reaches the UI. Both
attempts use the same provider client and model.

## Persistence compatibility

Existing rows may still contain `topics`, `segments`, and `moments`. Those fields
are accepted only by the persistence compatibility adapter and projected into
`VideoAnalysis.chapters`; missing historical `detail` becomes the old segment
`summary`. Fresh model output never accepts these legacy fields. New chapter
rows persist `title`, `summary`, `detail`, `startSec`, and `endSec`; `topics: []`
is retained only as a bounded storage compatibility field.

## Scope boundary

The existing chunk-summary/final-merge orchestration remains the baseline. Token
estimation, long-video thresholds, map/reduce budgets, parallel scheduling,
cache migration, and the full Side Panel redesign remain deferred to Tasks 6–8.
