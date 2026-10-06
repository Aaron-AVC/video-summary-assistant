# Video Summary Assistant

Video Summary Assistant is a Chromium browser extension for turning captioned
videos into structured, timestamp-aware summaries with a user-configured
OpenAI-compatible API.

## Current status

**Task 1 — Clean baseline** is complete in the current development branch.
This baseline supports YouTube only. It preserves the browser-side caption
retrieval, analysis schema, Ask AI foundation, Side Panel, Options page, and
Dexie/IndexedDB foundation needed for the next tasks.

The final product is planned to support YouTube and Bilibili, but Bilibili is
not implemented in this baseline. Native hosts, Python, yt-dlp, ASR, Codex
CLI, and Trae CLI are not runtime requirements. The extension runtime does
not depend on Codex or on a local agent process.

## Technology baseline

- Plasmo
- React
- TypeScript
- Bun `1.2.5`
- Chrome Manifest V3
- Chrome Side Panel
- Zod-validated analysis and runtime message schemas
- Dexie/IndexedDB for local persistence

## Development

Install dependencies with the pinned package manager:

```sh
bun install
```

Run the baseline checks:

```sh
bun test
bun run typecheck
bun run build
```

The production build is emitted under `build/chrome-mv3-prod` by Plasmo.

## Load the unpacked extension

1. Run `bun run build`.
2. Open `chrome://extensions` in Chrome or Chromium.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose `build/chrome-mv3-prod`.
6. Open a YouTube watch page with captions and use the extension action or
   Side Panel.

The Task 1 manifest contains only the baseline extension permissions and
YouTube host permissions. Runtime permissions for arbitrary AI provider
origins are intentionally not implemented yet; that is a Task 4 concern.

## Planned task sequence

1. Clean baseline — current task
2. Platform abstraction
3. Bilibili adapter
4. Provider profiles and runtime provider permissions
5. Structured video analysis
6. Long-video pipeline
7. Side Panel product experience
8. Cache/history hardening
9. Final V1 review

## Third-party notices

The current code baseline incorporates selected code from the fixed
`YouTube-Summarizer` snapshot documented in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). BiliScript and Video Digest
were architectural references only in Task 0; their code is not a runtime or
source dependency of this baseline.
