# Video analysis architecture

Task 6 keeps `VideoAnalysis` as the only fresh-analysis domain contract:

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

The model-facing schema remains `VIDEO_ANALYSIS_SCHEMA_VERSION = 1`. The prompt
and runtime version is `VIDEO_ANALYSIS_PROMPT_VERSION = "video-analysis-v2"`
because Task 6 changes direct, map, reduction, and final prompts. The model never
supplies local IDs or reduction metadata.

## Central budget and estimator

`token-estimate.ts` provides a deterministic, provider-agnostic heuristic. ASCII
text uses a conservative characters-per-token estimate; non-ASCII code points
are charged approximately one token each before a safety multiplier. Chat and
message overhead are included. This estimate is not an exact tokenizer count and
does not claim a provider/model context size.

`analysis-budget.ts` is the single runtime policy. The default planning target is
a conservative 16,000-token context estimate with 2,000 tokens reserved for the
completion and 2,000 more reserved for a possible repair. Tests inject smaller
policies to force each strategy. Invalid or non-positive policies fail before a
provider request.

## Strategy selection

The runtime first constructs the actual direct prompt, including title,
instructions, cue timestamps, and transcript text, and estimates its complete
system/user message pair.

- If it fits, `single-pass` sends one structured request. Invalid structured
  output may make exactly one repair request.
- If it does not fit, `map-reduce` plans deterministic chunks, creates prose map
  summaries, hierarchically consolidates them only when necessary, and sends one
  final structured request. That final output may also make exactly one repair
  request.

`RunAnalysisResult` reports the strategy, initial chunk count, reduction-level
count, and initial map summaries. Intermediate reduction nodes remain in memory
and are not persisted as chunk summaries. `rawResponse` is the final accepted
structured response.

## Long-video map and reduction

Chunk planning greedily adds transcript cues while the actual map prompt fits the
central input budget. Boundaries occur only between `TranscriptSegment` entries;
cues are never split, duplicated, omitted, or silently truncated. A cue whose
single-cue map prompt is oversized fails before any provider call.

Each map prompt includes every cue's start/end time and treats transcript text as
untrusted evidence. Map calls are sequential and return concise prose, not JSON.
Each result is bound to the chunk's locally computed source range.

Before the final request, the runtime estimates the actual final prompt. If it is
oversized, adjacent summaries are greedily grouped into sequential prose
reduction calls. A reduction node's range is the local minimum start and maximum
end of its children; the model never chooses the range. Each level must reduce
the node count. If no adjacent pair can fit, processing fails with a clear
no-progress error instead of looping or rewriting single nodes indefinitely.
Actual generated summaries are re-estimated at every level, so unexpectedly
large output fails safely rather than being sliced.

Transcript blocks use dedicated untrusted transcript markers. Map outputs use
separate untrusted partial-analysis markers in reduction, final, and repair
prompts. Instructions appearing inside either evidence block are never promoted
to system instructions.

## Structured validation and repair

Direct and long-video final requests share the same canonical JSON instructions
and the same parse/validation/normalization helper:

1. parse exactly one JSON object;
2. validate strict `summary` / `keyPoints` / `chapters` fields with Zod;
3. require every timestamped chapter/key point to overlap the complete original
   transcript evidence inside the effective video duration (CR-05);
4. clamp/snap, sort, and deterministically deduplicate;
5. on failure, make at most one same-provider/same-model structured repair and
   run the repaired response through the same pipeline.

No fallback chapter, key point, silent JSON repair, or map/reduce retry is
generated. The repair prompt is also estimated against the central budget.

## Provider, cancellation, and execution order

One resolved client and explicit model are reused for every map, reduction,
final, and repair call. All calls receive the same abort signal. The runtime
checks cancellation before every stage and converts in-flight provider aborts to
`AnalysisAbortedError`, preventing later calls. Map and reduction calls are
strictly sequential; Task 6 adds no parallel scheduling.

Provider permissions remain the existing optional host capability. Analyze does
not request permissions. Provider errors continue through the central redaction
boundary.

## Compatibility and deferred scope

Legacy persisted `topics`, `segments`, and `moments` remain behind the existing
compatibility adapter. Fresh output accepts only canonical `VideoAnalysis`, and
new chapter `detail` persistence is unchanged. Task 8 persists transcripts and
analyses by content key, fingerprints canonical cues, and keeps Ask answers in
an independently validated QA cache. Cache misses are required when the
transcript, provider profile, normalized endpoint, model, or prompt/schema
version changes.
