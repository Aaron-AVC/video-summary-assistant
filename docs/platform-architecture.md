# Platform architecture

Task 2 introduces one executable platform boundary while keeping the existing YouTube behavior intact.

## Domain and adapter boundary

`src/features/platform/types.ts` defines the platform-neutral runtime objects:

- `VideoIdentity` — platform, video ID, optional part ID, and stable `contentKey`.
- `VideoInfo` — identity plus title, author, duration, canonical URL, and optional thumbnail metadata.
- `TranscriptSegment[]` and `VideoTranscript` — normalized timed text consumed by analysis. Raw VTT is optional and is retained only for download/debugging.
- `ActiveVideoContext` — the runtime context with `pageType`, current timestamp, and readiness.

`src/features/platform/adapter.ts` defines `VideoPlatformAdapter`. It receives an explicit `PlatformPageEnvironment` (`document`, `location`, and `fetch`) so platform code is testable and does not read hidden globals.

`src/features/platform/youtube/youtube-adapter.ts` and `src/features/platform/bilibili/bilibili-adapter.ts` are registered implementations. Each adapter owns URL matching, identity, page metadata, transcript retrieval/normalization, current time, seek, timestamp URLs, and its native-chapter boundary.

The Bilibili adapter supports only secure `www.bilibili.com/video/BV...` pages. Its synchronous identity is part-specific: `bilibili:<BV>:p:<N>`. Metadata resolution selects `pages[].cid` for the requested `p` value, so P1 and P2 cannot silently share the collection CID. Subtitle discovery reads the WBI player endpoint first and falls back to the legacy player endpoint only after a failed primary request; subtitle tracks and bodies are reduced to the platform-neutral `VideoTranscript`/`TranscriptSegment[]` shape. Official `view_points` are exposed as `NativeChapter[]`. All asynchronous results are checked against the captured content key and resolved part before returning, which rejects stale SPA/part-switch responses.

## Registry

`src/features/platform/registry.ts` is the single URL/identity resolver. Background, content script, and runtime code ask the registry for an adapter instead of adding platform-specific conditionals. A future platform is added by implementing the adapter contract, extending the domain platform union, and registering the adapter with its tests.

Task 2 supports YouTube watch pages on `www.youtube.com` and `youtube.com`. Task 3 adds only `www.bilibili.com/video/*`; Shorts, mobile Bilibili, bangumi, b23.tv, and other Bilibili locations are rejected consistently by the adapter and content-script match patterns.

## Runtime responsibilities

- **Content script**: resolves the adapter for the current page, passes explicit page environment to it, and forwards normalized `VideoInfo`/`VideoTranscript`/seek results. It does not own a second transcript orchestration path.
- **Background**: resolves adapters for tab/identity checks, injects the content script when needed, and delegates timestamp URL construction to the resolved adapter. It does not hand-build platform watch URLs.
- **Side Panel**: consumes normalized `TranscriptSegment[]`. It does not parse VTT or call `parseVtt()`/`normalizeCues()`. Raw VTT is used only for the existing transcript-download and retention path.
- **Analysis**: continues to consume timed segments and is not coupled to a platform parser.

Bilibili API and subtitle CDN requests use a narrow background transport seam. The service worker accepts only HTTPS GET requests to the required Bilibili API paths and `*.hdslb.com/bfs/subtitle/*.json` resources, from a supported Bilibili video sender. Redirects are blocked and response bodies are size-limited. Cookies may accompany the browser session request but are never read, copied, stored, or logged.

The runtime namespace is `video-summary-assistant/runtime`; active contexts use `pageType: "video" | "unsupported"` and carry `platform`, `videoId`, `contentKey`, canonical URL, title/author, timestamp, and readiness.

## Persistence compatibility

YouTube runtime identity is `youtube:<videoId>`. Existing Dexie/history tables remain `videoId`-based in this task so Task 1 local data and migrations remain compatible. `src/features/platform/persistence-compat.ts` provides the narrow projection needed by existing history/jump paths.

Persistence has **not** been fully migrated to multi-platform `contentKey`; that hardening is deferred to Task 8. YouTube keeps the existing `videoId`-keyed history path. Bilibili analysis is intentionally session-only in Task 3, so P1/P2 cannot overwrite one another in the legacy history tables; the Side Panel makes this limitation explicit. Task 3 does not rename the database, rebuild Dexie migrations, or migrate provider keys.

## Provider boundary

Task 4 keeps provider metadata and secrets on separate paths. Profile metadata contains only `id`, `name`, `baseUrl`, `model`, timestamps, `isDefault`, and `hasApiKey`; API keys live in a dedicated local-only secret map. Options and Side Panel state receive metadata projections, while `resolveProvider()` is the short-lived privileged boundary used immediately before an AI request.

Provider hosts are never required permissions. The manifest declares only the optional host capability; an explicit Save, Fetch models, or Test connection action requests the concrete provider origin. Analyze and Ask AI never request permissions silently and return a clear permission error when the user has not authorized the selected host. HTTPS providers are supported at arbitrary path prefixes; HTTP is limited to loopback. `/models` is best-effort and manual model IDs remain valid when discovery fails. All chat, model discovery, and connection requests share endpoint joining, explicit model selection, permission checks, timeouts/error handling, and secret redaction.
