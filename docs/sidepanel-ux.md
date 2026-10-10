# Side Panel V1 UX

Task 7 organizes the Side Panel around one persistent current-video header and four accessible Radix tabs: Overview, Transcript, Ask, and Settings. Overview is the default. The active tab is parent-owned UI state, so switching tabs does not start analysis, reload captions, or discard Ask input and results.

## State ownership

The Side Panel workspace owns the current provider projection, canonical `VideoAnalysis`, transcript segments/raw VTT, Ask state, and generation/abort guards. Tab components receive those values and actions as props; they do not duplicate analysis, provider, transcript, or runtime orchestration.

An analysis is stored in UI state as one canonical `VideoAnalysis` object plus identity/display metadata. Summary, Key Points, and Chapters are projections of that object. Untimed key points remain untimed and do not receive a local Jump action.

## Transcript loading

Analyze and the Transcript tab share `loadCurrentTranscript()`. The helper sends the existing `FETCH_VIDEO_TRANSCRIPT` request, accepts only a validated transcript response for the captured `contentKey`, and rejects stale YouTube SPA or Bilibili part responses before callers can display them.

The Transcript tab can load captions without running analysis. Search is local, case-insensitive plain-text matching. Highlighting uses React text nodes and semantic `mark` elements; model/transcript HTML is never rendered. Rows live in a bounded scroll area and seek through the runtime bridge. Download is enabled only when an original raw VTT exists.

## Identity reset

Changing `contentKey` increments the transcript, analysis, workspace, and Ask generations; aborts any active analysis; and clears video-specific analysis, transcript, question, answer, and error state. Same-identity runtime refreshes do not reset the selected tab or reload the workspace. Timestamp jumps continue through the identity-aware runtime bridge.

## Settings reuse

Settings embeds the existing `ProviderForm` and `ConnectionTest`. Provider mutations return the new metadata-only provider list to the Side Panel so the default provider/model display and subsequent Analyze/Ask calls update immediately. Saved API keys are never mapped into React draft state; an existing provider continues to show an empty key input with `Saved key available`.

## Persistence and cache behavior

Analyze captures the current `contentKey` and normalized transcript fingerprint
before requesting a model. An exact analysis cache hit restores the canonical
result without a provider call. Regenerate deliberately bypasses the hit and
stores a new run while preserving older history. YouTube and each Bilibili part
use independent `videoRecords`; P1 and P2 never share rows. Transcript loading
writes only the separate transcript cache. Ask answers use `qaAnswers` and are
reused only after persisted schema validation; corrupt rows are ignored and
re-requested.

## Task 8 boundary

Task 7 does not add ASR, Vision, or a second runtime orchestration layer.
