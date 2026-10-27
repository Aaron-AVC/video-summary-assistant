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
and runtime version is `VIDEO_ANALYSIS_PROMPT_VERSION = "video-analysis-v3"`.
Version `v2` covered Task 6's direct, map, reduction, and final prompts; `v3`
marks the untrusted-data boundary hardening described under "Long-video map and
reduction", so `v2` cache rows are deliberately not reused. The model never
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

Transcript and partial-analysis evidence is wrapped in nonce-bound untrusted
fences rather than fixed markers. Each fence is rendered as
`<<<UNTRUSTED_<LABEL>_BEGIN:n<K>>>` … `<<<UNTRUSTED_<LABEL>_END:n<K>>>`, where
`K` is chosen at build time as one above the highest nonce that already appears
in the payload. The payload therefore cannot contain the closing marker it will
receive, and the builder verifies the chosen marker is absent before handing the
block back. The same guarantee is enforced message-wide: every fence in one
message is resolved against all payloads in that message plus the surrounding
static prompt text, so one block cannot forge another block's terminator.
Labels are `TRANSCRIPT`, `PARTIAL_ANALYSES`, `VIDEO_METADATA`,
`EXISTING_ANALYSIS`, `ORIGINAL_TASK`, `VALIDATION_ISSUES`, and
`PREVIOUS_INVALID_OUTPUT`. Payload bytes are preserved verbatim, so transcript
timestamps and analysis fields stay usable. Instructions appearing inside any
evidence block are never promoted to system instructions, and the system layer
remains authoritative for the repair contract.

Schema validation diagnostics are model-controlled text, so the repair prompt
carries them as a `VALIDATION_ISSUES` block rather than as a bare line above the
fences. Unknown JSON keys are reported by Zod with the key name reproduced in the
message, which means a model response can inject newlines and marker-shaped text
through a diagnostic; fencing it keeps that text inside the same structural
boundary as every other untrusted payload. Each diagnostic is clamped to a fixed
character budget and the whole list to a smaller total, so a hostile key name
cannot inflate the repair request without bound. Validation errors are collected
for both `StructuredOutputError` and `ZodError`, so an unexpected error shape
degrades to a bounded diagnostic instead of an unbounded raw message.

Ask applies the same strategy. The video title and the existing-analysis JSON are
each their own `VIDEO_METADATA` / `EXISTING_ANALYSIS` block, so a text field in a
prior analysis cannot close the transcript block. The video id is platform
metadata rather than evidence, and a hostile page can influence it, so it is
placed inside the metadata block instead of above the untrusted declaration and
is additionally restricted to the bare identifier shape both platforms produce;
an unrecognized value is replaced with a placeholder rather than forwarded. The
user's question and the chat history stay outside every block: the question is
task input, and history keeps its real message roles. Both are still scanned for
marker collisions so they cannot forge a terminator rendered elsewhere in the
same message.

This boundary is structural: it guarantees that untrusted text cannot end its own
fence early. It does not eliminate prompt injection. Ordinary persuasive prose,
semantic misdirection, and instructions the model chooses to follow despite the
system rules remain possible; the fence removes the delimiter-forgery class of
attack, not the instruction-following class.

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
generated. The repair prompt is also estimated against the central budget, and
the Ask repair path applies the same estimate to the full message list (system
prompt, retained history, and repair user prompt) before any provider call, so an
oversized repair fails closed with `AnalysisInputBudgetExceededError`.

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
