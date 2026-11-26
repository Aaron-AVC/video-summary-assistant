# Video Summary Assistant

**[简体中文](README.zh-CN.md) | English**

Video Summary Assistant is a local-first Chromium Manifest V3 extension for
captioned YouTube and Bilibili videos. It turns an available transcript into a
structured summary with timestamp navigation, then lets you ask questions
against the selected analysis. It also keeps local bookmarks and notes, offers
a local-only search across your stored work, and exports the current video as
Markdown.

## V1.1 capabilities

- YouTube desktop watch pages: `www.youtube.com/watch...` and
  `youtube.com/watch...`.
- Bilibili desktop video pages: `www.bilibili.com/video/BV...`, including
  supported multi-part pages selected with `?p=N`.
- Summary, Key Points, Chapters, in-video transcript search, timestamp jumps,
  and Ask.
- A global Analysis preset — Standard, Concise, or Detailed — stored locally and
  applied to newly started analyses.
- Bookmarks, free-form notes, and notes anchored to the current playback point,
  stored locally per canonical video identity.
- A local-only Search over the current video's loaded content, stored analysis
  runs, bookmarks and notes, and stored Ask Video conversations.
- Markdown export of the current video, delivered to the clipboard or as a
  downloaded `.md` file.
- OpenAI-compatible Provider Profiles with a configurable HTTPS endpoint,
  model ID, and optional loopback HTTP endpoint for local development.
- Local IndexedDB persistence for video history, transcript snapshots, exact
  analysis cache entries, analysis runs, validated Ask answers, local Ask Video
  conversation threads/messages, and bookmarks/notes.
- A Chrome Side Panel with Overview, Transcript, Ask, Search, and Settings
  tabs. On a supported video, Overview also hosts the bookmarks/notes panel and
  the Markdown export panel.
- An Options page with five tabs — Provider, Appearance, History, Data, and
  Advanced — covering Provider Profiles, theme and language, history browsing
  and granular deletion, local data export/clear, and the diagnostic log. The
  language preference is auto / English / Simplified Chinese.

V1.1 is transcript-based and local-first. It does not include ASR/Whisper,
vision, frame extraction, OCR, semantic or vector search, full-history
transcript search, web or cloud search, cross-video Ask, a native helper,
`yt-dlp`, cloud sync, accounts, mobile support, Firefox support, YouTube Shorts,
or Bilibili bangumi.

## Transcript requirement

The current page must expose usable captions or subtitles. When no supported
transcript is available, the extension reports that state; it does not record
audio or start an ASR fallback. Bilibili subtitle availability can vary by
video, region, and browser session.

## Provider configuration

Open Settings in the Side Panel or the Options page and save a Provider Profile
with:

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
video header. Use Overview to load or generate an analysis, keep bookmarks and
notes for the video, and export the current video as Markdown; use Transcript to
load and search captions or jump to a cue; use Ask to query the current
analysis; use Search to find stored analyses, bookmarks, notes, and Ask Video
conversations on this device; use Settings to manage Provider Profiles.
Generate may reuse an exact current cache entry. Regenerate deliberately
bypasses that entry and creates a new analysis run while keeping older history
available.

The Analysis preset is a global default rather than a per-video override.
Changing it applies to analyses started afterwards; it does not re-analyze the
current video and does not change a task that is already running. Each preset
has its own cache identity, so switching presets never reuses another preset's
stored result.

## Local data and privacy

Transcript, analysis, history, cache data, Ask Video conversation history, and
user-authored bookmarks/notes are stored locally in IndexedDB. Conversation
history is local-only; there is no cloud sync.
The existing IndexedDB name `youtube-summarizer` is retained as a migration
compatibility identifier. Provider metadata and the API-key secret map are
stored locally in `chrome.storage.local`; API keys are not included in Settings
exports, IndexedDB exports, combined exports, cache keys, history, or logs.

Requests to the configured AI Provider are sent only to the Provider URL
configured and authorized by the user. Separate platform requests access
supported video pages and retrieve available captions; Bilibili requests use
the normal browser session for the supported page. The extension does not read,
copy, store, or log cookies. There is no separate account service or cloud
backend, and the project does not claim hardware security or end-to-end
encryption.

## Development

This repository uses Bun `1.2.5`, pinned in `package.json`.

```sh
bun install --frozen-lockfile
bun test
bun run typecheck
bun run build
bun run package:internal
bun run verify:package
```

The production build is emitted under `build/chrome-mv3-prod`. The internal
package command creates a local internal-validation archive. `bun run package`
creates a local release candidate only after the project-rights and third-party
checks pass; the candidate still requires final PR-6 review and explicit
publication authorization. Neither command uploads or publishes.
See [release packaging and the compliance gate](docs/release-packaging.md).

## License and contributions

Project-owned or authorized portions are source-available under the
[Video Summary Assistant Community License, Version 1.0](LICENSE), which
permits personal and commercial use subject to its distribution and access
conditions. Third-party material keeps its own license. This custom license is
not an OSI-approved open-source license; see the
[mixed-license scope](licenses/LICENSE-SCOPE.md) and
[contributor terms](CONTRIBUTING.md).

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
  handled. Shorts, bangumi, mobile pages, and unrelated routes are outside the
  supported scope.
- Search is literal local text matching over the current video's loaded analysis
  and transcript, stored analysis runs, bookmarks/notes, and stored Ask
  conversations. It uses NFKC normalization, lowercase folding, and
  whitespace-token AND with plain substring matching: there is no fuzzy
  matching, stemming, synonym expansion, or embedding/vector retrieval. It does
  not search the stored transcripts of other videos, and results are capped at
  50 items.
- Markdown export requires an open supported video. A section is offered only
  when that exact canonical identity has data, and Copy Markdown and Download
  `.md` always deliver the same deterministic payload. Markdown is the only
  export format.
- Bookmarks and notes are local-only annotations; they never modify,
  regenerate, or require an analysis.
- The Knowledge UI creates point bookmarks, unanchored notes, and notes anchored
  to the current playback point. It does not offer a start/end range-note
  editor, even though the persisted schema and Markdown export can represent a
  range.
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

## Project status and planning

V1.1 capabilities are implemented in `main`. As of 2026-11-17, RH-01
documentation recovery (PR #12), RH-02 hardening (PR #13), and the persistence
export/write follow-ups (PR #18, issues #14/#15) have merged. The audited
pre-documentation `main` commit is
`859683b482a0b3e1d09a12369ceeb7e2af4e7236`.
The PR #18 integrated candidate passed the recorded 1,387-test suite,
typecheck, and production build. Those checks are not a new release approval.

No GitHub Release was listed at this snapshot. `build` and `package` only
generate local artifacts; they do not publish to Chrome Web Store or Edge
Add-ons. Before distribution, validate the proposed release artifact,
packaging, security/dependency checks, and real-browser compatibility
against that release commit.

See the [feature roadmap](docs/roadmap.md) for proposals and status,
[feature plan workflow](docs/feature-plans/README.md) for approval and
progress tracking, [documentation index](docs/README.md) for current versus
historical references, and [TASK_STATE.md](TASK_STATE.md) for milestones.

## Third-party notices

License and attribution information for incorporated code and architectural
references is recorded in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
