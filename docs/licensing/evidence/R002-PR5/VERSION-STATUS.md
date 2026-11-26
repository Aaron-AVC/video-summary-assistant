# PR-5 evidence version status

`project-rights-decision-v6.json` is the active local candidate decision. Its
matching v6 rights supplement, contributor record, current scope, current
ledger, and `notice-preview-v6/` files are the only PR-5 evidence consumed by
the packaging code. V6 records the source-byte identities after the archive
scope-link regression fix and pins every path in the PR-5 source-rights
supplement against Windows line-ending conversion. The archive preserves the
original code-formatted Markdown link labels while rewriting their targets to
files available at the archive root.

The v1 through v5 snapshots are retained as superseded intermediate records.
V1 predates normalization of the final newline in the fixed LICENSE and
contribution terms; its contents remain unchanged and its former unversioned
decision filename has been labeled `project-rights-decision-v1.json`. V2 binds
the corrected terms but predates the documentation update that distinguishes
historical PR-1 ledger validation from current PR-5 validation. V3 binds those
updated records but predates the byte-preserving Git attributes. V4 preserves
those attributes and records before the archive scope-link regression fix. V5
records the scope-link correction but predates pinning all PR-5 source paths
against Windows line-ending conversion. No superseded snapshot is used for
package qualification or included in the release ZIP.

The fixed R002-B build identity, historical scope, source-rights inventory,
ledger, notice preview, and their original HOLD state remain unchanged.

Verify the active PR-5 record from the repository root with:

```sh
bun scripts/licensing/r002-pr5-record.ts verify
```
