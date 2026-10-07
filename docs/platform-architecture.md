# Platform architecture

Task 2 introduces one executable platform boundary while keeping the existing YouTube behavior intact.

## Domain and adapter boundary

`src/features/platform/types.ts` defines the platform-neutral runtime objects:

- `VideoIdentity` — platform, video ID, optional part ID, and stable `contentKey`.
- `VideoInfo` — identity plus title, author, duration, canonical URL, and optional thumbnail metadata.
- `TranscriptSegment[]` and `VideoTranscript` — normalized timed text consumed by analysis. Raw VTT is optional and is retained only for download/debugging.
- `ActiveVideoContext` — the runtime context with `pageType`, current timestamp, and readiness.

`src/features/platform/adapter.ts` defines `VideoPlatformAdapter`. It receives an explicit `PlatformPageEnvironment` (`document`, `location`, and `fetch`) so platform code is testable and does not read hidden globals.

`src/features/platform/youtube/youtube-adapter.ts` is the only registered implementation in Task 2. It owns YouTube URL matching, identity, page metadata, transcript fallback, current time, seek, timestamp URLs, and the native-chapter boundary. Native chapters intentionally return `[]`; no chapter scraper is introduced here.

## Registry

`src/features/platform/registry.ts` is the single URL/identity resolver. Background, content script, and runtime code ask the registry for an adapter instead of adding platform-specific conditionals. A future platform is added by implementing the adapter contract, extending the domain platform union, and registering the adapter with its tests.

Task 2 supports YouTube watch pages on `www.youtube.com` and `youtube.com`. Shorts and mobile watch URLs are rejected consistently by the adapter and content-script match patterns.

## Runtime responsibilities

- **Content script**: resolves the adapter for the current page, passes explicit page environment to it, and forwards normalized `VideoInfo`/`VideoTranscript`/seek results. It does not own a second transcript orchestration path.
- **Background**: resolves adapters for tab/identity checks, injects the content script when needed, and delegates timestamp URL construction to the resolved adapter. It does not hand-build platform watch URLs.
- **Side Panel**: consumes normalized `TranscriptSegment[]`. It does not parse VTT or call `parseVtt()`/`normalizeCues()`. Raw VTT is used only for the existing transcript-download and retention path.
- **Analysis**: continues to consume timed segments and is not coupled to a platform parser.

The runtime namespace is `video-summary-assistant/runtime`; active contexts use `pageType: "video" | "unsupported"` and carry `platform`, `videoId`, `contentKey`, canonical URL, title/author, timestamp, and readiness.

## Persistence compatibility

YouTube runtime identity is `youtube:<videoId>`. Existing Dexie/history tables remain `videoId`-based in this task so Task 1 local data and migrations remain compatible. `src/features/platform/persistence-compat.ts` provides the narrow projection needed by existing history/jump paths.

Persistence has **not** been fully migrated to multi-platform `contentKey`; that hardening is deferred to Task 8. Task 2 does not rename the database, rebuild Dexie migrations, or migrate provider keys.
