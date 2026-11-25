# Third-party notices

This file records third-party source code and architectural references used by
Video Summary Assistant. It is intentionally separate from any future license
decision for the project's original code.

## Incorporated code

### YouTube-Summarizer

- Repository: <https://github.com/KristjanPikhof/YouTube-Summarizer>
- Fixed source snapshot: `48eee570e82cf74d37fcdb546058429cba74357a`
- License: MIT
- Copyright: Copyright (c) 2026 Kristjan Pikhof
- Full notice text: [`licenses/YouTube-Summarizer-MIT.txt`](licenses/YouTube-Summarizer-MIT.txt)

The Task 1 baseline imported selected files from this fixed snapshot rather
than copying the upstream repository or its `.git` directory. The incorporated
scope is:

- Plasmo/TypeScript project configuration and entrypoints (`package.json`,
  `bun.lock`, `background.ts`, `options.tsx`, `popup.tsx`, `sidepanel.tsx`,
  `.postcssrc.json`, `components.json`, `tailwind.config.ts`, `tsconfig.json`,
  and `vitest.config.ts`).
- The supplied extension icon under `assets/`.
- The reusable UI components under `src/components/ui/`.
- YouTube content/runtime code under `src/contents/`, `src/features/youtube/`,
  and the relevant modules under `src/lib/runtime/`.
- Browser-side transcript retrieval and parsing under
  `src/features/transcript/`, excluding the upstream native/helper fallback.
- Analysis, Ask AI, provider connection, history, settings, theme, schema,
  and Dexie persistence modules under `src/features/` and `src/lib/`.
- The corresponding upstream tests that remain relevant after the helper
  removal.

Significant Task 1 modifications to the incorporated code include:

- Renaming the product metadata to **Video Summary Assistant** and pointing
  repository metadata at the target GitHub repository.
- Removing the macOS/Python/yt-dlp helper, native messaging, helper settings,
  helper runtime messages, helper tests, and helper fallback path.
- Keeping the in-page timedtext, transcript-panel, and rendered-DOM caption
  paths as the only baseline transcript sources.
- Removing helper-only manifest permissions and updating affected schemas and
  tests.

No upstream `.git` directory, helper directory, macOS LaunchAgent script, or
native host file was imported into this repository.

## Architectural references only

### BiliScript

- Repository: <https://github.com/Edmund724/BiliScript>
- Reviewed snapshot: `25ddfeb81b61599f63fabcdabb3f197cdad11a92`
- License observed during Task 0: MIT
- Copyright observed during Task 0: Copyright (c) 2026 haixiong1997
- Status in this project: architectural reference only; no BiliScript code was
  copied or substantially rewritten in Task 1 or Task 3. The Task 3 Bilibili
  adapter was independently implemented from public Bilibili API behavior and
  general platform-architecture ideas; no BiliScript MIT notice is required for
  the project's original adapter code.

### Video Digest

- Repository: <https://github.com/Alex-cloud0413/video-digest>
- Reviewed snapshot: `08d693b9bd02ffa7cb99d4cdbcca6ceda2b72d84`
- License observed during Task 0: MIT
- Copyright observed during Task 0: Copyright (c) 2026 Zara Zhang
- Status in this project: architectural reference only; no Video Digest code
  or Codex/TraeWork bridge was copied in Task 1.
- The upstream `NOTICE.md` also identifies `zarazhangrui/youtube-digest` as an
  upstream ancestor. Because no Video Digest code was copied, that ancestor is
  not a current source dependency.

## Dependency note

Task 1 keeps the dependency set and lockfile from the selected
YouTube-Summarizer baseline; it does not add a new third-party package.
The accepted [source ledger](docs/licensing/third-party-license-ledger.json)
tracks the installed closure and original legal bytes. The independent
[build and notice review](docs/licensing/evidence/R002-PR23/REVIEW.md) tracks
the observed production assets, additional generated content and the broader
notice coverage. It also explains the shadcn MIT and icon attribution.

## Reproduce the third-party audit preview

The current corpus is **`BLOCKED_AUDIT_PREVIEW`**. It preserves third-party
license and NOTICE bytes in `THIRD_PARTY/`, including separately mapped
package-directory identities and a checksum list. `react-remove-scroll-bar`
2.3.8 is present in the production build and its exact-version copyright and
license text remain open; see the build and notice review for the other items.

```sh
bun scripts/distribution-notices.ts scope
bun scripts/distribution-notices.ts scope --artifact build/chrome-mv3-prod
bun scripts/distribution-notices.ts generate <new-external-directory>
bun scripts/distribution-notices.ts verify <generated-directory>
```

`--artifact` verifies the audited build bytes when available; the preview can
also be built from the retained evidence. Candidate generation refuses open
items and requires a verified artifact. The final ZIP gate and project
licensing policy are separate stages.
