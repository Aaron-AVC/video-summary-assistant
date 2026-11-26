# VSA-R002-B B03 — targeted shadcn licensing verification

**Review date:** 2026-11-26 (Asia/Shanghai)  
**Fixed repository input:** `f6d7b3068b893ce11637ea84598b26a5975e6838`, tree `26a80342e99818c15974fb1c105ec3d076cfafe1`  
**Scope:** the three shadcn-derived UI templates, their upstream history, the actual fixed-tree MIT text, and the practical attribution obligation. This is not a repository-wide rights review.

## Disposition

**B03 confirms the applicable shadcn MIT text and copyright line, verifies the three template blobs’ lineage through the fixed YouTube-Summarizer snapshot, and confirms the full license text is retained in this repository. Source provenance remains partial:** the historical CLI invocation used `shadcn@latest`, so its exact CLI/registry revision and the precise copied expression ranges are not recoverable from the inspected record. Keep `UNRESOLVED-02` open. Integrate this as targeted B03 evidence, not as complete per-file provenance or a whole-project license decision.

## Required historical records

Read first for this review:

- [R002-PR23 review](../R002-PR23/REVIEW.md), dated 2026-11-25. It labels the result `BLOCKED_AUDIT_PREVIEW`; identifies the shadcn source row as included in the production build; records the three template comparisons and preserved MIT text; and says the CLI input revision and copied ranges remain unresolved. It also states the notice corpus was not wired into a final ZIP.
- [PR-1 provenance review](../../provenance-review.md), especially “UI templates, icon and references” and “R1 evidence-link validation.” It classifies these templates as mixed third-party-derived source and preserves the distinction between fixed-source evidence and unresolved input-version/range evidence.

The existing ledger records the template version as `UNKNOWN_INTRODUCED_VERSION`, the license evidence as `PARTIAL_SOURCE_TEXT`, and the exact CLI/template version and copied ranges as `UNRESOLVED-02`. Those statuses remain accurate after this check.

## Source and history checks

The current checkout was at the requested commit and tree before this file was added. The three committed Git blobs in that fixed tree equal the corresponding blobs at `KristjanPikhof/YouTube-Summarizer@48eee570e82cf74d37fcdb546058429cba74357a`:

| Local path | Fixed YouTube-Summarizer Git blob | Result |
| --- | --- | --- |
| `src/components/ui/empty.tsx` | `71667632e77bf4265ab740e906f785fee806eec2` | exact blob match |
| `src/components/ui/field.tsx` | `c7bb0520a5e4b5f5835b194431452ad0e7f2e934` | exact blob match |
| `src/components/ui/input-group.tsx` | `0777399292fd5bafc8317a7136e05c9cdaa58f24` | exact blob match |

The local repository added these files in baseline commit `db4da4668da5a22bc2ce22801391255dd96656e8` (2026-10-06). In the fixed YouTube-Summarizer history, the three files were introduced in the 2026-05-04 `Add shadcn foundation components` commit `14486c46a03978eac4b6f78d8c34fdd5049d06ad`; `field.tsx` was then changed in `Fix Field Tailwind v3 variants` (`544e793ba1d3d06c18f61c0a042bb94858484bc9`). The fixed upstream commit itself is dated 2026-08-22.

The fixed upstream [shadcn CLI audit](https://github.com/KristjanPikhof/YouTube-Summarizer/blob/48eee570e82cf74d37fcdb546058429cba74357a/docs/shadcn-ui-audit.md), added 2026-05-04, describes these official components and records a dry run invoking `bunx --bun shadcn@latest add ... --dry-run`. It documents deliberate Tailwind v3 and extension-runtime changes. The command does not pin the CLI package or a registry/template commit. The audit therefore supports the source family and generation history, but cannot identify an exact source release or copied range.

For comparison, the official fixed tree is [`shadcn-ui/ui@7865621397708917369251d67029ad920e390a38`](https://github.com/shadcn-ui/ui/tree/7865621397708917369251d67029ad920e390a38), dated 2026-04-30. Official path history shows the three v4 files were introduced by `04432835f91dbe0a3273f50ac829e0a377110e5f` on 2025-10-03. Relevant later changes before the fixed tree include `d19890851050b7d7b9fee74b1d38b11e0d0f85d3` and `188b746074642a0e67bdee09ec47c0853fdd8d40` for `field.tsx`, `3e20c228da6ae3576cbffcb51716265ae8835e4d` for `input-group.tsx`, and formatting commit `f31ed81983653919dd4fe77aee4b4859f610f1dc` on 2026-03-02.

Against those three fixed official files, a fresh Python `difflib.SequenceMatcher` comparison (`autojunk=False`) reproduced the existing review’s line metrics:

| Template | Matching local lines / total | Longest consecutive matching run | Official Git blob | Official file SHA-256 |
| --- | ---: | ---: | --- | --- |
| `empty.tsx` | 100 / 104 | 38 | `ce4b0095f6d19d2eae2e465060e9060b0c210856` | `ae95bdcf367a076ae02e7925f14522a148798f72d9651749c6d55497dba584c0` |
| `field.tsx` | 225 / 242 | 49 | `0a4e421602b12713c93dbf5493382527852d05b6` | `37f60b671549593f09c6c44d7a0c4147c4e8eaffefd49786fe7cda01456e0c65` |
| `input-group.tsx` | 158 / 170 | 71 | `756f7381b898db4a1c3c20182ce8e65797150faf` | `4cb1cfaeb99f9d64e6fc576f7558d712f2669d4f86777c1f99aadaafb49a5c4f` |

The matching blocks support attribution to the shadcn template family. They do not by themselves establish which exact lines were copied, when each line entered the project, or whether a matching line is independently protectable expression. The upstream CLI audit and fixed-file histories strengthen the lineage finding; they still do not pin the CLI’s registry input.

## Official MIT text and practical obligation

The official [`LICENSE.md` at the fixed shadcn commit](https://github.com/shadcn-ui/ui/blob/7865621397708917369251d67029ad920e390a38/LICENSE.md) has Git blob `fad4d887a681dd49233e5ed01ee2c7a1513089a0` and states **`Copyright (c) 2023 shadcn`**. Its path history records the license being added in commit `6ea6856f5a1082d4d9c231559b6bc3ee73827493` on 2023-01-27. The exact official bytes match the retained local material byte for byte: SHA-256 `1564074e13439397221ffd522e2e504d56561994a23d371aa5e3ad43e4f5423f` (1,063 bytes).

The MIT grant permits use, modification, distribution, sublicensing, and sale. Its condition is to include the copyright and permission notice in copies or substantial portions; its warranty and liability disclaimer is part of that same text. The practical action is to carry the complete retained MIT text with any distributed source or extension archive containing these templates. A project-specific no-resale term cannot withdraw the permission already granted for the MIT-covered portions.

The existing source material and notice records preserve the exact text. The PR-23 review did not verify its inclusion in a final ZIP, so archive-level delivery remains a separate distribution check. This review makes no claim about the project’s overall license or ownership of every local modification.

## Resolved, partial, and integration boundary

- **Resolved by B03:** the pinned official shadcn license text and its 2023 copyright line; exact identity of the retained license bytes; identity of all three local template blobs with the fixed YouTube-Summarizer snapshot; and reproducible similarity measurements against the fixed official component tree.
- **Still partial:** exact CLI release and registry/template revision used during generation; exact per-file copied-expression ranges and their change chronology; and project-side rights-holder attribution beyond the existing ledger record.
- **Integration disposition:** add this report as B03 evidence. Keep the ledger’s `UNRESOLVED-02` and `PARTIAL_SOURCE_TEXT` statuses unchanged; do not describe shadcn provenance as fully closed. Preserve the complete MIT text in any later source/archive distribution that contains these templates, and verify actual archive inclusion in that distribution’s own gate.

## Sources and method

Primary sources were the two fixed GitHub commits and their official file histories linked above. The local checks read committed Git blobs at the requested repository commit, fetched official content/history through GitHub’s read-only API on 2026-11-26, compared blob identifiers and exact license bytes, and reproduced line matches with Python’s standard-library `difflib`. Existing PR-1 and PR-23 evidence was read as historical evidence, not rewritten. No product source, existing ledger, notice artifact, test, commit, or push was changed or run for this B03 review.