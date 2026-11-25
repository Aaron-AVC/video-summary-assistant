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
- The extension icon supplied in Task 1 (historical; replaced in R002-B).
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

## Reproduce the current third-party notice review

The [R002-B review](docs/licensing/evidence/R002-B/REVIEW.md) binds the
31-file notice corpus at
[`notice-preview-v3/`](docs/licensing/evidence/R002-B/notice-preview-v3/)
to the observed Chrome MV3 build. It includes the complete upstream MIT text
for `react-remove-scroll-bar@2.3.7` and the full shadcn and YouTube-Summarizer
MIT notices. Twelve runtime-closure packages with no direct Parcel asset
remain `UNKNOWN` and are conservatively included. Third-party materials are
verified for the reviewed scope; the overall release remains **HOLD**.

```sh
bun scripts/licensing/r002-b-candidate.ts scope --artifact build/chrome-mv3-prod
bun scripts/licensing/r002-b-candidate.ts ledger --artifact build/chrome-mv3-prod
bun scripts/licensing/r002-b-candidate.ts generate <new-external-directory> --artifact build/chrome-mv3-prod --candidate
bun scripts/licensing/r002-b-candidate.ts verify <generated-directory> --artifact build/chrome-mv3-prod --candidate
```

These commands verify the versioned `distribution-scope-v3.json` and
`candidate-ledger.json` against the captured build and installed artifact.
The checked-in `notice-preview-v3/` was generated and byte-verified in
candidate mode. The pre-final staged version of the unversioned scope and
preview is retained under
[`old/index/`](docs/licensing/evidence/R002-B/old/index/).
A later draft that marked 12 graph-absent identities excluded without
positive evidence is retained under
[`old/excluded/`](docs/licensing/evidence/R002-B/old/excluded/)
for audit history; it is not a current notice input. Use
`bun scripts/distribution-notices.ts scope --historical` and
`bun scripts/validate-license-ledger.ts --historical` to verify the
historical PR-2/3 and PR-1 snapshots with the fixed Git inputs. The historical
preview remains `BLOCKED_AUDIT_PREVIEW`. The final ZIP gate and project
licensing policy are separate stages.
