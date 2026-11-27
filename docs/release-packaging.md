# Release packaging and compliance gate

All package commands use the same fixed-build validation, verified PR-5 rights
decision, current third-party scope and notice plan, explicit archive file map,
ZIP writer, and post-write archive verifier.

```sh
bun run package:internal
bun run verify:package
bun run package
bun run verify:package candidate
```

`package:internal` creates a local engineering-validation archive under `dist/`.
Its `INTERNAL_VALIDATION_ONLY.txt` marker identifies its purpose. The marker
does not state that project rights remain on hold. The identity records the
verified project-rights decision, complete third-party notice materials,
`releaseApproved: false`, and `publicationAuthorized: false`.

`package` creates a local PR-6 review candidate only when the checked-in PR-5
decision and all current inputs verify. The candidate ZIP contains the 14
fixed Chrome MV3 production files, `LICENSE`, an archive-ready `LICENSE-SCOPE.md`,
the generated `THIRD_PARTY_NOTICES.md` and `THIRD_PARTY/` materials, and no
internal marker or audit directory. Its directory and ZIP identify it as a
`PR6-CANDIDATE`. It remains pending final PR-6 review; package generation does
not approve distribution or authorize upload or publication.

The PR-5 qualification is derived from repository-controlled records and exact
current bytes: the rights-holder declaration, VSA-CL 1.0, the mixed-license
scope, the fixed 172-path source-rights inventory and PR-4/PR-5 supplement,
contributor-authority record, fixed production-build identity, current scope,
current candidate ledger, and all generated notice files. Hashes bind those
inputs to the decision and package; they do not create legal authority or
replace the rights-holder declaration and review process. The production CLI
accepts no approval boolean, external decision file, or test-fixture path.
Git attributes pin the fixed legal terms and versioned PR-5 evidence so
checkout line-ending conversion cannot change the bytes bound by those hashes.

The current distribution scope contains 84 records: 71
`CONFIRMED_INCLUDED`, 13 `UNKNOWN`, and zero `CONFIRMED_EXCLUDED`. All 12
`UNKNOWN` npm identities remain conservatively covered by applicable original
license materials. The current notice output contains 31 files and has zero
third-party notice blockers. Actual Bundle membership remains a separate
question from notice coverage.

The identity distinguishes these states:

- Third-party notice materials are complete for the reviewed scope.
- The repository decision qualifies the source for a local release candidate.
- The package remains pending final PR-6 release review.
- `releaseApproved` and `publicationAuthorized` remain `false`.

`verify:package` re-derives and verifies the internal package by default. Pass
`candidate` to verify the PR-6 review candidate. Both modes parse the actual ZIP
central directory, compare every extracted byte and CRC with the current plan,
recompute the archive digest and compare the complete external identity.
Existing output directories are never overwritten; package directories become
visible only after staged ZIP and identity verification.

Packaging requires a clean, committed Git worktree. The external identity binds
the current commit and Tree, the fixed production build source and evidence,
each product-file hash, current scope and ledger hashes, current notice-file
hashes, project-rights decision inputs, package mode, ZIP digest, and complete
archive inventory. The ZIP does not contain its own final digest.

The production build remains pinned to R002-B evidence. `loadCandidate()`
checks the 14 production outputs, the 64-package Parcel graph and locked
dependency inputs. The only accepted `package.json` change is the exact
`license: "SEE LICENSE IN LICENSE"` metadata plus the three packaging-script
values. The root package remains `private: true`. Dependency fields,
`bun.lock`, lifecycle and build scripts, manifest, version, Plasmo/Parcel
configuration, source, assets, and ignored build-input configuration remain
bound to the fixed candidate. A changed production input requires new build
and distribution evidence.

The current PR-5 v11 records live under
[`licensing/evidence/R002-PR5`](licensing/evidence/R002-PR5/). They are
versioned separately from and do not overwrite the fixed R002-B history or the
superseded PR-5 v1-v3 snapshots.

Chrome's official [Prepare your extension](https://developer.chrome.com/docs/webstore/prepare)
guidance requires `manifest.json` at the ZIP root. The official
[Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api)
documentation lists a 2 GB package limit; the gate uses the lower decimal
ceiling of 2,000,000,000 bytes. This tooling writes only local files and makes
no upload or publishing API call.

The ZIP validator rejects unexpected, missing, changed, duplicate,
case-colliding, unsafe, encrypted, split, ZIP64, linked, directory,
non-regular, or malformed members. It checks central and local headers,
decompressed lengths, CRCs, every payload byte, the complete archive plan and
the external identity. The package plan and archive content are also scanned
for workstation paths and secret-like credential strings.
