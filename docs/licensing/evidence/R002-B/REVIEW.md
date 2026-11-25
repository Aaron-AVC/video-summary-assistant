# VSA-R002-B — independent review handoff

**Disposition:** `THIRD_PARTY_NOTICES_COMPLETE_RELEASE_HOLD`. The candidate
contains the required third-party material for the reviewed scope. Project
contributor authority and project licensing policy go to PR-5. The final
archive gate belongs to PR-4.

## Candidate identity

| Input | Identity |
| --- | --- |
| Fixed main | `f6d7b3068b893ce11637ea84598b26a5975e6838` |
| Fixed main tree | `26a80342e99818c15974fb1c105ec3d076cfafe1` |
| Production build source | `7eda9fdbe0cd414c16a755f0b5da390c0fd37a57` |
| Production build source tree | `cfec44a94ee5a2053a361b7a3087373562378ec5` |
| Production evidence SHA-256 | `3d8a9d547cc506a5544e0f7a5a519803de549276191021ecfce88039b21c56c2` |
| Path rights inventory SHA-256 | `aed77e5c89bc36cb226648016f26b1693cfb97bf3f90408e8acf24757f15ad53` |
| Current scope and notice preview | `distribution-scope-v3.json`; `notice-preview-v3/` |

`build/build-identity-v3.json` binds the build source, package and lock
inputs, exact tool manifests, Parcel graph, browser manifest and every
production file. The image and dependency commit is the build input; later
audit-tool and evidence commits do not alter it. The build used Bun 1.2.5,
Node v24.19.0, Plasmo 0.90.5 and Parcel 2.9.3; the Browserslist data warning
is retained in the build log. `record-r002-b-build.py` inventories the
captured build and refuses to overwrite a differing fixed record.

## Blocker dispositions

| Item | Disposition | Evidence and follow-up |
| --- | --- | --- |
| B-01 scroll lock | `RESOLVED_FOR_CANDIDATE` | Pin only `react-remove-scroll-bar@2.3.7`; exact release and upstream MIT material preserved. |
| B-02 icon | `RESOLVED_REPLACED` | New self-contained geometric icon replaces all five delivered icon files. Project licensing for the new artwork follows PR-5. |
| B-03 shadcn | `PARTIAL_PROVENANCE_NOTICE_SATISFIED` | Retain the full shadcn and YouTube-Summarizer MIT notices for three mixed-lineage files. The historical template revision and copied line ranges remain open. |
| B-04 source rights | `PARTIAL_PROJECT_RIGHTS_HOLD` | Path-level classification and Git evidence recorded. PR-5 must confirm contribution authority and decide the project policy. |

### B-01: compatibility and legal source

The official npm [2.3.7](https://registry.npmjs.org/react-remove-scroll-bar/2.3.7)
and [2.3.8](https://registry.npmjs.org/react-remove-scroll-bar/2.3.8)
metadata and both tarballs are retained under `raw/`.
`scroll-bar-publications.json` records the SRI and SHA-256 for each tarball
and all 27 packaged files. Both tarballs omit standalone LICENSE/NOTICE.
The sole packaged difference is `package/package.json`; code and
declarations are byte-identical. The 2.3.7 npm manifest declares MIT.
Its registry `gitHead` is the base of the recorded official comparison
to `8ca9ba5ea52de03308fe8ced94f7b159a44d28ff`; the comparison adds only
[LICENSE](https://github.com/theKashey/react-remove-scroll-bar/blob/8ca9ba5ea52de03308fe8ced94f7b159a44d28ff/LICENSE).
The observed source subtree is unchanged. The copyright line is recorded
in the publication evidence, and the original LICENSE bytes match Git blob
`7c08c3990396ecefd90f99ff5d9a34f26f5b5616`. The upper-level notice includes
that text and preserves the older 2.3.8 open issue in the historical snapshot.

The Radix consumers retain their existing versions and use
`react-remove-scroll@2.7.2`, whose target range is `^2.3.7`. The 2.3.7
peer range admits the current React 18. The lower minimum for
`react-style-singleton` does not change the locked resolution, and `tslib`
is unchanged. The 2.3.7 installed manifest matches its tarball; its same-build
graph identity appears in Options and Side Panel. The exact override and
lock introduce no other package directory identity changes. The first Bun
install crashed; the unchanged retry and subsequent frozen install succeeded.
The upstream repository's [GitHub Security Advisories page](https://github.com/theKashey/react-remove-scroll-bar/security/advisories)
showed no published advisories when checked on 2026-11-26. This records the
public advisory listing alongside the package and dependency evidence; it is
not a private security assessment.

### B-02: editable icon and derived outputs

`assets/icon-source.svg` uses a play symbol, caption/document lines and a
small highlight to convey video and extracted information. Its geometry and
SVG markup were AI-assisted in the OpenAI Codex desktop session; no external
image or third-party brand asset was used. The editable SVG has SHA-256
`8869e8ee957a152eca324baf58d475c332ce476534f8488e6a31a18dffa084bf`.
The 2563-byte build input PNG has SHA-256
`34df1cb851c1cae8c07c2e29b55e540e7e7e06a24a275fdd74227819edcff02f`.
The renderer is `scripts/generate-extension-icons.ts`, using the existing
`sharp@0.33.5` dependency. `icon-previews/icon-preview-sheet.png` shows the
actual 16, 32, 48 and 128 px outputs; `build-identity-v3.json` records the
source and all five Plasmo-derived production icon hashes, including 64 px.
This documents the production lineage and leaves ownership and project
licensing policy for the rights holder to decide.

Plasmo derived manifest icons at 16, 32, 48, 64 and 128 px from the new
PNG. The captured inputs and outputs are linked by their graph paths and
file hashes; decoded RGBA bytes match the new PNG resized by the Plasmo
pipeline. Chrome decoded all five references at their declared dimensions.
The old image's origin evidence is retained under R002-PR23 and does not
describe any icon in this candidate.

### B-03 and B-04: attribution and policy

`shadcn-review.md` links the fixed upstream comparisons and documents
`empty.tsx`, `field.tsx` and `input-group.tsx`. All three have fixed
YouTube-Summarizer blob matches, with evidence of shadcn template lineage
and subsequent Tailwind/extension adaptations. The shadcn MIT text predates
the templates and is retained with the upstream MIT notice. The notice
manifest reports `PARTIAL` provenance explicitly.

`source-rights-v3.json` covers 172 paths selected from the production graph
and directly relevant repository entrypoints, documentation, the icon and
its editable source, and the upstream MIT notice. It distinguishes 31
upstream-exact paths, 61 upstream-mixed paths, 3 mixed third-party
template paths, 1 standalone third-party text, 6 architecture-reference
paths with project development history, and 70 project additions with
documented history. The classification uses fixed upstream Git blobs,
path-following introduction commits, and conservatively identified
refactors. It inherits the bounded BiliScript and Video Digest review.
Documented development history is used as a classification basis, with
contributor rights left for confirmation.

PR-5 should confirm authority for the project contributions, mixed-file
additions and the new artwork; retain the upstream MIT grants, attribution
and notices for their portions; and specify how any later project terms
apply to project contributions in mixed files. Treat architecture references
as references unless a file-level expression finding changes that record.
The path classification is versioned by build source and should be updated
for moved, added or materially changed distributable files.

## Build scope and validation

The graph covers 14 files and includes 64 npm directory identities.
Relative to PR23, the five icon files changed; all nine non-icon outputs,
including JS, CSS and `manifest.json`, are byte-identical. The six
outside-closure component mappings were revalidated against the graph or
unchanged generated outputs. The candidate ledger has 78 base component
rows plus six supplemental records. The current v3 scope has 84 rows:
71 `CONFIRMED_INCLUDED`, zero `CONFIRMED_EXCLUDED`, and 13 `UNKNOWN`.
Twelve unknown rows are npm identities in the current required or optional
runtime closure; their lack of direct Parcel asset attribution does not
establish exclusion. All 12 remain in the notice output with their verified
LICENSE materials. The thirteenth unknown row aggregates project-source
rights that need PR-5 disposition.

Finalization compared the existing `build/chrome-mv3-prod/` directory with
all 14 artifact hashes in `build-identity-v3.json`; all 14 matched. No
production rebuild was run. The checked-in notice preview contains 31 files;
its checksum list verified all 30 listed payload files, with the checksum
file itself excluded from its own list.

The older `old/v2/`, `old/v3a/` and `old/v3b/` snapshots remain separate
superseded evidence. The pre-final index version of the unversioned scope and
preview is preserved under `old/index/`. A later unversioned
worktree draft marked 12 graph-absent npm identities
`CONFIRMED_EXCLUDED` solely from the absence of matching package assets; its
26-file preview and scope are preserved under
`old/excluded/` and were not adopted. The active
versioned files are `distribution-scope-v3.json` and
`notice-preview-v3/`; the 31 generated files were regenerated from that
scope and independently verified byte for byte. The manifest records zero
third-party material blockers,
`MATERIALS_VERIFIED_FOR_REVIEWED_SCOPE`, and one release hold for the
project source-rights decision.

`build/` contains the original build, Artifact Gate, eight smoke runs
(golden, retry, refresh, reopen, cancel, destructive, source switch and tab
switch), and targeted browser logs on Chrome for Testing 156.0.8078.73.
Those logs include early targeted probe failures as well as the successful
run covering Options and Side Panel Select, two open/close cycles in each,
keyboard navigation, scroll locking and restoration, focus return, and
Side Panel database failure and Retry recovery. Dialog's wrapper and
package are not observed in the production graph; separate nested Dialog
and Popover interactions were not exercised.

`validation/` contains historical checks and the current candidate's
reproducible validation records. The R002-B product source, package manifest,
lockfile and five generated icon assets match the captured production
identity at `7eda9fdbe0cd414c16a755f0b5da390c0fd37a57`; the new scope and
notice records change no production input. The captured Artifact Gate and
eight core browser smoke logs therefore apply to this same product identity.
Their successful run covered Options and Side Panel Select interactions,
scroll lock and restoration, focus return, repeated open/close cycles, and
Side Panel database failure and Retry recovery. Earlier failed probes remain
in `build/`; nested Dialog and Popover behavior was not independently
exercised.

The historical PR-1 ledger and PR-2/3 scope continue to be checked against
their fixed Git inputs; PR23 remains a separate `BLOCKED_AUDIT_PREVIEW`
snapshot.

## Final validation (user-run, 2026-11-26)

The user ran these checks in a normal Windows PowerShell session, outside
the Codex sandbox, after the candidate's source and test changes were
complete. The original log bytes were copied from
`%TEMP%/VSA-R002-B-final-20261126-062804/` into `validation/`; the hashes
below match the source files.

| Check | Result | Preserved log | SHA-256 |
| --- | --- | --- | --- |
| Targeted tests | 57 passed, 0 failed; 132 assertions across 5 files; exit 0 | `validation/user-final-targeted-tests.txt` | `a8b67b0185a09cd203237dfee535ba90ff434cd41bf05161a288b6a40426064a` |
| Full `bun test` | 1,794 passed, 0 failed; 6,377 assertions across 130 files; exit 0 | `validation/user-final-full-bun-test.txt` | `54420ba56dac259ced87cb0b01d9aa2b492778d08d8f7ea904bcb6e017f70f75` |
| TypeScript | exit 0 | `validation/user-final-typecheck.txt` | `3637c16b04a71f7dbc8fcfe02a5be8ca76bbd3a504a80401a2bb902d55e901a6` |
| `git diff --check` | exit 0; no whitespace errors | `validation/user-final-diff-check.txt` | `ec9efb79e59130c256f26bf1064ae41035c5576b7727ecb1b5805c8409a4e74f` |

The test logs report Bun 1.2.5 and Node.js 24.19.0. The targeted run
includes the regression that keeps package identities absent from the
Parcel graph `UNKNOWN` and conservatively includes their notices. The
TypeScript log preserves PowerShell's native-command diagnostic even though
the recorded exit code is zero. The diff-check log preserves Git's
line-ending conversion warnings for the two new candidate TypeScript files;
the recorded exit code is zero. All 130 test files have modification times
before the full-test log, and no package, lockfile, icon, product-source or
test-source paths changed after the recorded run.

These are the final user-run results and replace earlier candidate counts of
56 targeted tests and 1,793 full tests. Codex did not rerun the checks.
