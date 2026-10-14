# Video Summary Assistant

Video Summary Assistant is a local-first Chromium Manifest V3 extension for
captioned YouTube and Bilibili videos. It turns an available transcript into a
structured summary with timestamp navigation, then lets you ask questions
against the selected analysis.

## V1 capabilities

- YouTube desktop watch pages: `www.youtube.com/watch...` and
  `youtube.com/watch...`.
- Bilibili desktop video pages: `www.bilibili.com/video/BV...`, including
  supported multi-part pages selected with `?p=N`.
- Summary, Key Points, Chapters, transcript viewing/search, timestamp jumps,
  and Ask.
- OpenAI-compatible Provider Profiles with a configurable HTTPS endpoint,
  model ID, and optional loopback HTTP endpoint for local development.
- Local IndexedDB persistence for video history, transcript snapshots, exact
  analysis cache entries, analysis runs, validated Ask answers, and local Ask
  Video conversation threads/messages.
- A Chrome Side Panel with Overview, Transcript, Ask, and Settings tabs.

V1 is transcript-based. It does not include ASR/Whisper, vision, frame
extraction, OCR, web search, a native helper, `yt-dlp`, cloud sync, accounts,
mobile support, Firefox support, YouTube Shorts, Bilibili bangumi, or semantic
vector retrieval for Ask.

## Transcript requirement

The current page must expose usable captions or subtitles. When no supported
transcript is available, the extension reports that state; it does not record
audio or start an ASR fallback. Bilibili subtitle availability can vary by
video, region, and browser session.

## Provider configuration

Open Settings in the Side Panel and save a Provider Profile with:

1. a display name;
2. an OpenAI-compatible base URL, optionally including a path prefix;
3. an explicit model ID; and
4. an API key.

Model discovery through `GET /models` is best effort. Manual model IDs remain
valid when a provider does not implement that endpoint. Test connection,
Analyze, and Ask use `POST /chat/completions` and send the selected model
explicitly on every request. Provider host access is optional and is requested
only from an explicit Save Provider, Fetch models, or Test connection action.

## Side Panel workflow

Open a supported video, open the extension Side Panel, and confirm the current
video header. Use Overview to load or generate an analysis, Transcript to load
and search captions or jump to a cue, Ask to query the current analysis, and
Settings to manage Provider Profiles. Generate may reuse an exact current
cache entry. Regenerate deliberately bypasses that entry and creates a new
analysis run while keeping older history available.

## Local data and privacy

Transcript, analysis, history, cache data, and Ask Video conversation history
are stored locally in IndexedDB. Conversation history is local-only; there is
no cloud sync.
The existing IndexedDB name `youtube-summarizer` is retained as a migration
compatibility identifier. Provider metadata and the API-key secret map are
stored locally in `chrome.storage.local`; API keys are not included in Settings
exports, IndexedDB exports, combined exports, cache keys, history, or logs.

Requests are sent only to the Provider URL configured and authorized by the
user. Bilibili requests use the normal browser session for the supported page;
the extension does not read, copy, store, or log cookies. There is no separate
account service or cloud backend, and the project does not claim hardware
security or end-to-end encryption.

## Development

This repository uses Bun `1.2.5`, pinned in `package.json`.

```sh
bun install --frozen-lockfile
bun test
bun run typecheck
bun run build
bun run package
```

The production build is emitted under `build/chrome-mv3-prod`. The package
command creates a local archive for inspection; it does not publish anything.

## Load the unpacked extension

1. Run `bun run build`.
2. Open `chrome://extensions` in Chrome, Chromium, or Edge.
3. Enable Developer mode.
4. Choose **Load unpacked**.
5. Select `build/chrome-mv3-prod`.
6. Open a supported desktop video page and open the Side Panel.

Use a temporary browser profile for smoke testing. Do not load the extension
into a daily profile when testing release artifacts.

## Known limitations

- Captions are required; there is no ASR fallback.
- Only the desktop YouTube watch and supported Bilibili BV video URL scopes are
  handled. Shorts, bangumi, mobile pages, and unrelated routes are outside V1.
- OpenAI-compatible APIs can differ in authentication, model discovery, model
  limits, and structured JSON behavior. The provider must accept the
  documented endpoints and structured JSON requests.
- Long videos can make multiple sequential API calls. Usage and cost are
  determined by the configured Provider.
- Bilibili subtitle and metadata availability can depend on the video, region,
  and normal browser session state.
- Browser smoke coverage depends on whether an isolated Chromium/Chrome/Edge
  environment is available; automated unit, migration, build, and package
  checks do not prove real-site behavior.

## Project status

This repository is at V1 release-readiness review. The extension is not
published to the Chrome Web Store, Edge Add-ons, npm, or another release
channel by the build or package commands.

## Third-party notices

License and attribution information for incorporated code and architectural
references is recorded in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
