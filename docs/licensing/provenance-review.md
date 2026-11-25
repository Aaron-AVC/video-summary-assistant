# Source and component provenance review

- **Target:** `main` at `8ee1c31184b1df26e95f7004c1a6aeffa3ffdabe`
- **Tree:** `cfe18f00c59d8f8b1a8086c334d11b556427064d`
- **P01/P02 source baseline:** `4a328851f2b0ca745c9f757125fa112ac7bada62`
- **Fixed YouTube-Summarizer source:** `48eee570e82cf74d37fcdb546058429cba74357a`
- **Evidence date:** 2026-11-25

## Upstream source and project delta

The upstream `LICENSE` at the fixed YouTube-Summarizer commit has Git blob
`79b69cad4ed1ef2f602e4f92032313edfbaada17` and SHA-256
`a6051897936080c684f88c52dfb2283d106e96d7aa4eccb93dc975a27d9383c4`. The
repository copy `licenses/YouTube-Summarizer-MIT.txt` has the same Git blob.
The full upstream text is preserved as a content-addressed material. The
existing `THIRD_PARTY_NOTICES.md` describes imported source families and
modifications.

At the P01 baseline, mechanical same-path comparison found 49 equal blobs, 66
changed blobs, and 216 project paths without a same-path upstream file. At the
target main it found 48 equal, 67 changed, and 233 without a same-path file
across 348 paths. The source diff from the P01 baseline contains 17 added and
20 modified paths. `package.json` and `bun.lock` blobs are unchanged, so the
accepted dependency closure carries forward.

These path and blob counts do not establish originality. The later source
inventory records each target path, both comparison classes, and pinned
upstream object information where available. The YouTube adapter includes
migrated upstream behavior despite its new local path. Recent changes are in
history/database readiness, side-panel state, and gate/smoke infrastructure;
they do not establish new external source merely because their paths lack
upstream counterparts.

## UI templates, icon and references

The fixed YouTube-Summarizer tree records a May 2026 shadcn CLI generation and
contains the same-path `empty.tsx`, `field.tsx`, and `input-group.tsx` files.
A pinned shadcn UI tree has substantial line similarity and its MIT
`LICENSE.md` states `Copyright (c) 2023 shadcn`. That exact text is preserved
in the materials directory. The precise CLI input revision and line-by-line
copied ranges remain unresolved, so these template files are tracked as mixed
third-party-derived source, not wholly project-original work.

`assets/icon.png` is byte-identical to the fixed upstream asset blob
`3548624832b239b16571fc986f7a781cfed67b36`; P01 reports that the upstream
shell commit introduced it. The independent artwork author chain remains
unknown.

For BiliScript snapshot `25ddfeb81b61599f63fabcdabb3f197cdad11a92` and Video
Digest snapshot `08d693b9bd02ffa7cb99d4cdbcca6ceda2b72d84`, existing
`THIRD_PARTY_NOTICES.md` says they are architecture references. The bounded
fixed-tree scan found no exact file match in 30 platform/content files and no
selected shared six-line sequence in added diffs. This supports retaining the
recorded reference-only classification for the inspected scope; it is not a
complete rewritten-expression audit. Video Digest's fixed `NOTICE.md`
identifies `zarazhangrui/youtube-digest` as an upstream ancestor.
BiliScript's README identifies `haixiong1997/Bilibili-Obsidian-Clipper` as an
ancestor to consider if expression reuse is later found.

## npm registry releases and exact text

The accepted matrix contributes 74 installed npm package directory
identities, representing 69 unique name-version pairs. Each release tarball
was fetched from the official npm registry; its registry SHA-512 SRI matches
the corresponding `bun.lock` integrity, and its raw tarball SHA-256 is recorded
in the ledger. Package manifests, declared license, version, author and
contributor fields were read from those exact tarballs. Root LICENSE/NOTICE
files and their copyright lines were preserved and content-hash deduplicated.
No package code or install/build script was executed.

The 74 package rows preserve nested directory identity. Five separate
`@radix-ui/react-slot@1.2.3` directories and two
`@radix-ui/react-primitive@2.1.4` directories remain distinct rows, even
though their exact package tarballs and license texts are shared. Optional
peer expansion is recorded separately from required reachability. The four
optional-only identities are `@types/react`, `@types/react-dom`,
`@types/prop-types`, and `csstype`.

The exact npm tarballs include 13 components with no independent license file.
The 12 Radix packages below have a fixed-release text mapping:

| Package release | Release source | Result |
| --- | --- | --- |
| `@radix-ui/number@1.1.1` | `packages/core/number`, `1.1.1` | MIT root text; 2 source-map blobs match |
| `@radix-ui/react-compose-refs@1.1.2` | `packages/react/compose-refs`, `1.1.2` | MIT root text; 2 source-map blobs match |
| `@radix-ui/react-context@1.1.2` | `packages/react/context`, `1.1.2` | MIT root text; 2 source-map blobs match |
| `@radix-ui/react-direction@1.1.1` | `packages/react/direction`, `1.1.1` | MIT root text; 2 source-map blobs match |
| `@radix-ui/react-id@1.1.1` | `packages/react/id`, `1.1.1` | MIT root text; 2 source-map blobs match |
| `@radix-ui/react-use-callback-ref@1.1.1` | `packages/react/use-callback-ref`, `1.1.1` | MIT root text; 2 source-map blobs match |
| `@radix-ui/react-use-escape-keydown@1.1.1` | `packages/react/use-escape-keydown`, `1.1.1` | MIT root text; 2 source-map blobs match |
| `@radix-ui/react-use-layout-effect@1.1.1` | `packages/react/use-layout-effect`, `1.1.1` | MIT root text; 2 source-map blobs match |
| `@radix-ui/react-use-previous@1.1.1` | `packages/react/use-previous`, `1.1.1` | MIT root text; 2 source-map blobs match |
| `@radix-ui/react-use-rect@1.1.1` | `packages/react/use-rect`, `1.1.1` | MIT root text; 2 source-map blobs match |
| `@radix-ui/react-use-size@1.1.1` | `packages/react/use-size`, `1.1.1` | MIT root text; 2 source-map blobs match |
| `@radix-ui/rect@1.1.1` | `packages/core/rect`, `1.1.1` | MIT root text; 2 source-map blobs match |

For all 12, the registry's candidate `gitHead` is a prerelease tree, so the
ledger records the stronger mapping used: the exact-version package manifest
and package directory at the stable `radix-ui/primitives` release commit
`46235ece78931b198e6908a2cec0b66798d55c79`, source-map embedded source blobs
matching those exact-version source files, absence of a package/ancestor
license file in that release tree, and that commit's root MIT file with
Copyright (c) 2022 WorkOS. The exact root text is stored once and referenced
from every component row.

`react-remove-scroll-bar@2.3.8` remains **unresolved**. Its exact registry
tarball has no independent LICENSE/NOTICE, though the registry and package
manifest declare MIT. npm records its publication at
`2024-12-15T02:08:28.658Z`. The registry `gitHead`
`b3b1287aad81def2e2ae707274b74531b61ddbaf` did not resolve in the named
official repository. The later license addition merged on `2025-05-26` in
commit `8ca9ba5ea52de03308fe8ced94f7b159a44d28ff`, records a 2025 copyright,
and is not treated as proof of the exact 2024 package's source or license
scope. The package README's plain `MIT` heading is not full license text.

Lucide's exact tarball MIT-like field is actually ISC: its complete ISC text
and dual Feather/Lucide copyright statement are preserved. The exact Feather
4.29.0 MIT text is also retained as related attribution material for the
Lucide portions. Dexie ships an Apache-2.0 `NOTICE`; it is preserved as a
separate notice material. `tslib@2.8.1` ships the Microsoft copyright notice
and permissive text without-fee permission; the ledger preserves those exact
bytes and labels the evidence as tarball text instead of replacing it with a
generic license template.

## R1 evidence-link validation

The first validator did not bind a verified license claim to the exact
component source. Deterministic RED cases reproduced acceptance of an empty
tarball legal-file list, material borrowed from another package/version,
unrelated NOTICE text, incomplete fixed-upstream records, deleted closure
members with edited self-reported counts, arbitrary confirmed bundle claims,
and malformed SHA-512 evidence. The original RED output is retained in the
R1 review package at `evidence/r1-validation/R002-PR1-R1-RED-targeted-tests.txt`.

The revised formal validator now binds tarball license and NOTICE materials to
the release URL, tarball SHA-256, exact package name/version, legal-file path,
material ID/hash/length, and recorded scope. Fixed-source license evidence is
checked against a full repository and commit identity, license path, Git blob
computed from the preserved bytes, SHA-256, material reference, and source
artifact. Versioned npm upstream mappings additionally require the exact
published version, repository `gitHead`, package manifest identity, and
source-map path/blob records linked to that package's tarball.

Closure validation uses pinned hashes for the accepted F01 closure and P02
component matrix, fixed expected counts, the actual `package.json` and
`bun.lock` hashes, and each package SRI parsed from the lockfile. It checks all
74 directory identities and their name/version, installed manifest hash,
required versus optional-only reachability, root dependency classification,
and matrix row. Each SHA-512 SRI must canonically decode to 64 bytes. Bundle
membership remains `UNKNOWN` for every component.

Radix rows now carry `Copyright (c) 2022 WorkOS` in their copyright mapping so
later notice generation can associate that statement with the shared exact
MIT material. Generic license-condition and liability text was removed from
`copyrightStatements`; no license-material file bytes were changed. The
version-specific `react-remove-scroll-bar@2.3.8` mapping, shadcn template
range, icon artwork origin, per-file source rights, and actual Bundle members
remain unresolved.

## Counts and remaining scope

- 78 component rows: 74 npm package-directory identities and 4 source/asset
  rows.
- 69 unique npm package releases, all mapped to their exact registry tarball
  and lockfile integrity.
- 61 npm rows with exact tarball license text, 12 with fixed-version Radix
  root text, and 1 unresolved version-specific license mapping.
- The upstream application source is recorded with full MIT text. The icon
  and shadcn templates have partial provenance records.
- All 74 npm installed-closure rows keep browser bundle membership `UNKNOWN`.
- The project's own root license is not selected. The 233-path mechanical
  remainder requires per-path rights/source review before an original-work
  license can be chosen.

The accepted P02 matrix and F01 closure JSON are copied into `evidence/` for
stable review inputs. The source inventory and target delta record are also
stored there. The P02 policy choice and release gate remain decisions for
their own stages; this task makes no new policy decision and does not declare
the product release-ready.

## Suggested follow-up: notices and archive gate

For the next notice-only change, generate a human index plus a machine-readable
component manifest from this ledger. Preserve each exact license and NOTICE
byte sequence and copyright mapping. The accepted P02 layout proposes
`THIRD_PARTY_NOTICES.md`, `THIRD_PARTY/manifest.json`,
`THIRD_PARTY/LICENSES/<name>@<version>/LICENSE`,
`THIRD_PARTY/NOTICES/<name>@<version>/NOTICE`, and a scoped
`THIRD_PARTY/SHA256SUMS.txt`; keep the existing upstream MIT file's bytes.
Do not add the project's root `LICENSE` as part of notice aggregation.

For archive scope, use same-build supported Plasmo/Parcel membership evidence
when it can be retained and reviewed. If that cannot be supplied, choose and
record an authorized conservative scope over the required 70 directory
identities, keeping the optional-only four identities visibly separate.
Neither scope should be described as the observed browser bundle. Do not let
`UNKNOWN` membership pass as exact membership.

Only after the notice corpus and scope decision are stable should a later
gate bind the source revision, lockfile, clean build, component mapping,
archive paths, and byte hashes. Verify the final ZIP against that plan and
fail on missing, altered, stale, duplicate, or unapproved materials. Keep
toolchain/native-binary distribution obligations as a separate scope. Root
project-license policy, distribution forms, rights-holder and contributor
decisions, and any source-offer terms stay with their separate owner decision
stage.
