# Persistence and Cache

This document describes the current V1 persistence contract. It is a behavior
guide, not a copy of the implementation.

## Database and compatibility identifiers

The Dexie database name remains `youtube-summarizer`. The name predates the
current product name and is intentionally retained so an installed extension
can continue to open existing user data. Legacy storage keys such as
`yt-summarizer.*` and the old provider-settings record are also compatibility
identifiers. They must not be renamed as a branding cleanup because doing so
could strand existing data.

The shipped schema has append-only migration blocks through v3. v1 and v2 are
left unchanged. v3 adds content-aware stores and copies legacy YouTube rows
without deleting the original compatibility rows.

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
history compatibility.

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
provider identity, model, trimmed question, and the Ask schema/prompt version.
The answer is parsed and validated again when loaded. A corrupt QA row is
ignored and Ask is sent again; it is never rendered directly from unchecked
stored JSON.

## Migration and legacy rows

The v2-to-v3 upgrade is append-only. For legacy YouTube rows it creates
content-aware video, transcript, and analysis-cache projections while keeping
the v1/v2 tables readable. Legacy analysis rows may have null fingerprint or
provider metadata; those rows remain historical compatibility data and do not
masquerade as current exact cache hits.

No v4 migration is part of V1. A future schema change must append a new
version and preserve the existing migration blocks.

## Secrets and exports

Provider metadata and the API-key secret map are separate. Secrets are resolved
only at the privileged Provider request boundary. They are not stored in
IndexedDB cache rows, cache-key serialization, transcript/history entities,
exports, URLs, runtime page messages, or diagnostic output.

The local-data export includes the new content-aware stores as well as legacy
tables, but only sanitized provider metadata. Clear-all removes provider
metadata, the provider secret map and legacy provider settings, content-aware
stores, legacy transcript/history tables, analysis runs, chapter summaries,
and QA answers.
