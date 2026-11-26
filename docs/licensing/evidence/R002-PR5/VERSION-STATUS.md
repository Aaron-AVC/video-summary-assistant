# PR-5 evidence version status

`project-rights-decision-v4.json` is the active local candidate decision. Its
matching v4 rights supplement, contributor record, current scope, current
ledger, and `notice-preview-v4/` files are the only PR-5 evidence consumed by
the packaging code. V4 adds the byte-preserving Git attributes for the fixed
legal terms and versioned audit snapshots, and binds that configuration in the
source-rights supplement.

The v1, v2, and v3 snapshots are retained as superseded intermediate records.
V1 predates normalization of the final newline in the fixed LICENSE and
contribution terms; its contents remain unchanged and its former unversioned
decision filename has been labeled `project-rights-decision-v1.json`. V2 binds
the corrected terms but predates the documentation update that distinguishes
historical PR-1 ledger validation from current PR-5 validation. V3 binds those
updated records but predates the byte-preserving Git attributes. No superseded
snapshot is used for package qualification or included in the release ZIP.

The fixed R002-B build identity, historical scope, source-rights inventory,
ledger, notice preview, and their original HOLD state remain unchanged.

Verify the active PR-5 record from the repository root with:

```sh
bun scripts/licensing/r002-pr5-record.ts verify
```
