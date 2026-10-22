# Side Panel V1.1 UX

The Side Panel keeps one persistent current-video header and five accessible
Radix tabs: Overview, Transcript, Ask, Search, and Settings. Overview is the
default. The active tab is parent-owned UI state, and every tab panel is
mounted (`forceMount`), so switching tabs does not start analysis, reload
captions, or discard Ask input and results.

## State ownership

The Side Panel workspace owns the current provider projection, canonical
`VideoAnalysis`, transcript segments/raw VTT, Ask state, and generation/abort
guards. Tab components receive those values and actions as props; they do not
duplicate analysis, provider, transcript, or runtime orchestration.

V1.1 adds three feature areas on top of that same workspace: the local
`knowledgeItems` store rendered by the Knowledge panel, the Search
controller/repository pair, and the Markdown export builder. They receive the
displayed identity from the workspace and do not own runtime orchestration or
add a second analysis pipeline.

An analysis is stored in UI state as one canonical `VideoAnalysis` object plus
identity/display metadata. Summary, Key Points, and Chapters are projections of
that object. Untimed key points remain untimed and do not receive a local Jump
action.

## Overview

Overview is the default tab and hosts four stacked regions: the analysis
toolbar, the Summary/Key Points grid, the Chapters timeline, and the recent
analysis list. On a supported video it additionally renders the Knowledge
panel and the Markdown export panel between the timeline and the recent list.

### Analysis presets

The toolbar exposes a global Analysis preset toggle with three values:
Standard, Concise, and Detailed. The choice is stored locally and is described
in the UI as a global default: changing it applies to analyses started
afterwards, does not re-analyze the current video, and does not change a task
that is already running. A preset only shapes how analysis content is
organized and how dense it is; it never selects a provider, model, timeout, API
key, or Ask policy. Each preset carries its own effective prompt version, so
two presets never share an analysis cache identity.

### Knowledge (bookmarks and notes)

Overview hosts the local Knowledge panel for the currently displayed video.
Bookmarks anchor the current playback position; a note is trimmed free-form
text created either without an anchor or with a point anchor at the current
playback position through an explicit `attach current time` choice. The UI does
not create start/end range notes: there is no range editor and no way to pick
arbitrary start and end times. Entries are keyed by canonical `contentKey`, so a
Bilibili P1 and P2 collection never collapse into one.

Knowledge requires no Provider, analysis, or transcript, and nothing is sent to
the Provider. The authoring draft is bound to the displayed `contentKey`; when
the identity changes the draft is discarded, so a note can never be saved onto
the next video. Bookmarking the same whole second twice toggles the existing
bookmark off instead of stacking a duplicate.

### Markdown export

Overview hosts the Markdown export panel for the current video. Export is
available only while the authoritative runtime `contentKey` matches the
displayed data. Summary/Key points/Chapters, Transcript, and Bookmarks and
notes sections are selectable and only offered when that exact identity has
data. The payload is built deterministically with a header carrying Platform,
Video ID, optional Part, Content key, Author, and URL. Copy Markdown and
Download `.md` deliver the same payload, and the file name carries the video ID
and, for Bilibili, `-pN`. Knowledge anchors render as a point or a range; an
unanchored note renders without one. Markdown is the only export format.

## Transcript loading

Analyze and the Transcript tab share `loadCurrentTranscript()`. The helper sends
the existing `FETCH_VIDEO_TRANSCRIPT` request, accepts only a validated
transcript response for the captured `contentKey`, and rejects stale YouTube SPA
or Bilibili part responses before callers can display them.

The Transcript tab can load captions without running analysis. Its own search
is local, case-insensitive plain-text matching over the currently loaded cues.
Highlighting uses React text nodes and semantic `mark` elements; model/transcript
HTML is never rendered. Rows live in a bounded scroll area and seek through the
runtime bridge. Download is enabled only when an original raw VTT exists.

## Ask

Ask queries the currently displayed analysis. It requires a Provider, a
canonical analysis, and a transcript whose fingerprint still matches the
analysis; when the transcript changed after the analysis, Ask is blocked with an
explicit state instead of answering from stale evidence. A single question is
always scoped to one analysis run — V1.1 has no cross-video question.

Stored conversations are listed in a history popup and can be reopened or
deleted. Reopening a thread verifies the canonical `contentKey`, the
`analysisRunId`, and the transcript fingerprint before publishing it, so a
conversation from another video or another run is never rendered under the
current analysis. An active Ask task survives tab switches and continues in the
background.

## Search

The Search tab searches local data only: the current runtime content (loaded
analysis and transcript), stored historical analysis runs, bookmarks and notes,
and stored Ask Video conversations. Matching is NFKC-normalized, lowercase,
whitespace-token AND with plain substring matching; there is no fuzzy, stemming,
synonym, or semantic/vector retrieval. Results are ranked by field weight, then
recency, then a stable tie-break, and are capped at 50 items.

Results open in Overview, Transcript, or Ask. A current-video transcript hit
moves the player to the cue and focuses it in the Transcript tab. A historical
hit restores that analysis into Overview. A knowledge hit jumps to the stored
anchor when the runtime is already on that video, and otherwise opens the video
first. An Ask result restores its stored conversation only after the identity
and fingerprint checks above.

Stored transcripts of other videos are not searched. Search never contacts a
Provider. Provider configs, API credentials, and cache tables are deliberately
excluded from the searchable sources.

## Settings reuse

Settings embeds the existing `ProviderForm` and `ConnectionTest`. Provider
mutations return the new metadata-only provider list to the Side Panel so the
default provider/model display and subsequent Analyze/Ask calls update
immediately. Saved API keys are never mapped into React draft state; an existing
provider continues to show an empty key input with `Saved key available`.

## Identity reset

Changing `contentKey` increments the transcript, analysis, workspace, and Ask
generations; aborts any active analysis; and clears video-specific analysis,
transcript, question, answer, and error state. The Knowledge collection and its
authoring draft follow the same rule and reset to the new identity. Same-identity
runtime refreshes do not reset the selected tab or reload the workspace.
Timestamp jumps continue through the identity-aware runtime bridge.

## Persistence and cache behavior

Analyze captures the current `contentKey` and normalized transcript fingerprint
before requesting a model. An exact analysis cache hit restores the canonical
result without a provider call. Regenerate deliberately bypasses the hit and
stores a new run while preserving older history. YouTube and each Bilibili part
use independent `videoRecords`; P1 and P2 never share rows. Transcript loading
writes only the separate transcript cache. Ask answers use the separate
`qaAnswers` exact cache and local `qaThreads` / `qaMessages` conversation
history and are reused only after persisted schema validation; corrupt rows are
ignored and re-requested.

## V1.1 boundary

The Side Panel uses the content-aware persistence layer through schema v6
described in `docs/persistence-cache.md`, including `knowledgeItems`. Knowledge,
Search, and Markdown export are presentation features over the same layer and
add no second orchestration layer. The Side Panel does not add ASR, Vision, or a
second runtime orchestration layer. Legacy `topics`, `segments`, and `moments`
remain only in the compatibility projection for historical rows; fresh UI state
uses the canonical Summary, Key Points, and Chapters contract.
