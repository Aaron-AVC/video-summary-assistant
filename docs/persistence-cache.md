# Persistence and Cache

This document describes the current V1.1 persistence contract. It is a behavior
guide, not a copy of the implementation.

## Database and compatibility identifiers

The Dexie database name remains `youtube-summarizer`. The name predates the
current product name and is intentionally retained so an installed extension
can continue to open existing user data. Legacy storage keys such as
`yt-summarizer.*` and the old provider-settings record are also compatibility
identifiers. They must not be renamed as a branding cleanup because doing so
could strand existing data.

The shipped schema has append-only migration blocks through v6. v1, v2, and v3
are left unchanged. v3 adds content-aware stores and v4 adds `qaThreads` and
`qaMessages` without deleting the original compatibility rows or `qaAnswers`. v5
drops stored transcript fetch URLs. v6 reproduces the full v5 declaration and
adds the empty `knowledgeItems` store.

## Canonical identity

Fresh runtime code uses a stable `contentKey`:

- YouTube: `youtube:<videoId>`
- Bilibili: `bilibili:<bvid>:p:<N>`

The Bilibili part component is required for P1/P2 isolation. A Bilibili
analysis, transcript, history entry, Ask answer, or timestamp action must not
fall back to bvid-only identity.

Legacy rows may contain only `videoId`. They are readable through an explicit
compatibility fallback and are projected to a YouTube content key when opened;
they are not treated as a fresh exact cache entry merely because they are
available.

## Stores

`videoRecords` stores current video metadata keyed by `contentKey`.

`transcriptCache` stores normalized cues, language/source metadata, the
optional raw VTT payload, and a transcript fingerprint. The fingerprint is a
versioned hash of canonical normalized cues; raw VTT and fetch URLs are not
identity inputs. `rawVtt` is retained only for the download/debug path and is
shed after the configured 30-day retention window. Cues, fingerprint,
contentKey, and language metadata remain so history can still be grounded.

`analysisCache` stores accepted canonical `VideoAnalysis` results and their
identity metadata. `qaAnswers` stores independently validated Ask answers.
`analysisRuns` and `segmentSummaries` preserve historical analysis runs and
chapter details. `recentVideos` and `transcriptSnapshots` remain for legacy
history compatibility. `qaThreads` and `qaMessages` are the local-only Ask
Video conversation store; `qaAnswers` remains an independent exact-request
optimization cache.

`knowledgeItems` stores user-authored bookmarks and notes keyed by `id` and
indexed by `contentKey`. `contentKey` is the authoritative identity, so a
Bilibili P1 bookmark and a P2 bookmark never collapse into one collection.

A bookmark is a point anchor (`startSec === endSec`, no text). The current UI
creates a note either with no anchor at all or with a point anchor at the
current playback position; it has no editor for choosing arbitrary start and
end times. The persisted schema and the Markdown export also accept a complete
range (`startSec` and `endSec` both set, `endSec >= startSec`), but that is a
storage and export capability, not something a user can author through the
current interface. Do not read the range support in the schema as a promise
that range notes are creatable.

`analysisRunId` exists for future analysis-bound annotations and is always
`null` in the current UI. Knowledge does not require a Provider, an analysis, or
a transcript.

## Analysis cache identity

An analysis cache identity includes:

- `contentKey`;
- transcript fingerprint;
- analysis schema version and prompt version;
- provider profile ID;
- normalized provider base URL; and
- selected model ID.

It deliberately excludes API keys, Authorization/Bearer values, display
names, and `generatedAt` timestamps. A cache row is used only after persisted
schema validation. Corrupt or incomplete rows are cache misses.

The effective prompt version carries the Analysis preset. Standard keeps the
pre-preset prompt identity, while Concise and Detailed each append their own
suffix, so two presets never share an analysis cache identity and a cache hit
written under one preset is never served for another.

## Generate, Regenerate, and history

Generate first loads the latest transcript for the active `contentKey`, then
looks for an exact analysis identity. An exact hit results in zero Provider
calls. A miss creates a new analysis run.

Regenerate deliberately bypasses an exact hit and creates a new run. Older
runs remain available in history, and each historical run retains its own
transcript fingerprint and provider/model metadata.

The active workspace uses the latest transcript for the current content key.
An historical run uses the transcript snapshot/cache row bound to that run's
fingerprint. These are separate meanings: changing the active transcript must
not rewrite the evidence used to display an older analysis.

## Ask cache

An Ask cache key includes `contentKey`, transcript fingerprint, `analysisRunId`,
provider identity, model, trimmed question, bounded conversation-context
fingerprint when history exists, and the Ask schema/prompt version. Legacy
single-turn rows are only eligible when no conversation history is present.
The answer is parsed and validated again when loaded. A corrupt QA row is
ignored and Ask is sent again; it is never rendered directly from unchecked
stored JSON.

## Migration and legacy rows

The v2-to-v3 upgrade is append-only. For legacy YouTube rows it creates
content-aware video, transcript, and analysis-cache projections while keeping
the v1/v2 tables readable. Legacy analysis rows may have null fingerprint or
provider metadata; those rows remain historical compatibility data and do not
masquerade as current exact cache hits.

The v3-to-v4 migration only creates empty conversation stores. Existing
`qaAnswers`, analysis, transcript, and video rows remain untouched. v5 removes
stored transcript fetch URLs. The v5-to-v6 migration only creates an empty
`knowledgeItems` store and keeps every existing table and row. A future schema
change must append a new version and preserve the existing migration blocks.

## Knowledge destructive semantics

Knowledge is user-authored content, so it is preserved by every destructive path
except the two whole-video scopes. `deleteAnalysisRun`, `clearAnalysisHistory`,
`clearQaData`, and `clearTranscriptCache` leave `knowledgeItems` untouched.
`deleteVideoData(contentKey)` removes only the rows for that exact canonical
`contentKey`, so deleting Bilibili P1 keeps P2. `clearAll` removes every
knowledge row.

## Production persistence boundaries (as of 2026-11-17)

The production `historyRepository.exportLocalData()` path validates its
completed, sanitized `PersistenceExport` using `persistenceExportSchema.parse`
before it is returned to the snapshot/download serializer. Each exported table
has a ceiling of `MAX_EXPORTED_ROWS_PER_TABLE = 100_000`: exactly 100,000
rows are accepted, while 100,001 are rejected without silent truncation.
The already assembled sanitized object is returned for successful exports,
preserving existing JSON shape.

For non-canonical (legacy) `saveAnalysisRun()` calls,
`recentVideoSchema.parse` validates the row before the write transaction
begins, and the validated row is passed to `recentVideos.put`. Invalid
rows therefore fail before the transaction performs analysis writes.
Canonical runs do not write `recentVideos` and retain their existing
behavior. Both follow-ups were merged in
[PR #18](https://github.com/Aaron-AVC/video-summary-assistant/pull/18).

## Secrets and exports

Provider metadata and the API-key secret map are separate. Secrets are resolved
only at the privileged Provider request boundary. They are not stored in
IndexedDB cache rows, cache-key serialization, transcript/history entities,
exports, URLs, runtime page messages, or diagnostic output.

The local-data export includes the new content-aware stores as well as legacy
tables, but only sanitized provider metadata. `knowledgeItems` is exported as an
optional field so older export payloads without Knowledge still parse. Clear-all
removes provider metadata, the provider secret map and legacy provider settings,
content-aware stores, legacy transcript/history tables, analysis runs, chapter
summaries, QA answers, and knowledge items.
