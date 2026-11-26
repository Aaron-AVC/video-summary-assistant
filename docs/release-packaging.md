# Release packaging and compliance gate

This repository has three package commands. They all use the same fixed-candidate validation, current R002-B scope, fresh notice plan, explicit file inventory, ZIP writer, and post-write archive verifier.

```sh
bun run package:internal
bun run verify:package
bun run package
```

`package:internal` writes a local package under `dist/` whose directory, ZIP filename, external identity, terminal result, and `INTERNAL_HOLD.txt` identify it as `INTERNAL` and `HOLD`. It contains the accepted Chrome MV3 production files, the notice files freshly derived from the current ledger and scope, and that one hold marker. It does not copy the audit evidence directory. The package directory is exposed only after ZIP and identity checks pass. Existing destinations are never overwritten.

`verify:package` re-derives the current plan and compares the real ZIP central directory, extracted file bytes, ZIP digest, and external identity with that plan. The external `package-identity.json` binds the current committed source, production build source and evidence, product-file hashes, scope and ledger hashes, notice-file hashes, package type, HOLD state, archive digest, and complete archive inventory. The ZIP does not contain its own final digest.

`package` is the ordinary formal-release entry point. It exits non-zero while the reviewed candidate has the authentic project-rights HOLD. There is no force flag, environment override, caller-supplied boolean, or command-line approval input. PR-5 is the future integration point for an independently authorized qualification contract. Until that reviewed code and evidence exist, formal package creation remains disabled. A test fixture can exercise shared verification logic but is never read by the production CLI.

The current disposition is `THIRD_PARTY_NOTICES_COMPLETE_RELEASE_HOLD`: third-party materials are complete for the reviewed scope, while project contributor authority and licensing policy remain on HOLD. An internal package is suitable for engineering and review validation; it does not approve distribution or grant upload authorization.

The package is pinned to the R002-B production source commit and fixed build evidence. `loadCandidate()` verifies the 14 product outputs, 64-package Parcel graph, and locked dependency inputs; the package gate also re-derives and byte-structure-compares the checked-in candidate ledger and distribution scope before hashing them into the external identity. The only accepted `package.json` delta is the exact `package`, `package:internal`, and `verify:package` script set. Dependency fields, lockfile, build scripts, package lifecycle scripts, manifest, version, Plasmo/Parcel configuration, source, assets, and ignored build-input configuration remain bound to the fixed candidate. If a production input changes, this gate rejects the historical evidence; the input must be rebuilt, captured, and reviewed before it can be packaged.

Chrome's official [Prepare your extension](https://developer.chrome.com/docs/webstore/prepare) guidance requires `manifest.json` at the root of the ZIP. The official [Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api) documentation lists a 2 GB package limit; the gate uses the lower decimal ceiling of 2,000,000,000 bytes. This tooling only creates and verifies local files. It does not call an upload or publishing API.

The ZIP validator rejects unexpected, missing, changed, duplicate, case-colliding, unsafe, encrypted, split, ZIP64, linked, directory, or non-regular members; checks central and local headers and record boundaries; verifies decompressed lengths and CRCs; compares every byte with the independently derived expected file map; and checks the external identity. The package plan and contents are also scanned for workstation paths and secret-like credential strings.

Product input changes require new build and distribution evidence rather than a reused package identity. Changes to notices require re-derivation from the candidate ledger; stale preview directories are not package inputs. Project-owned licensing files may be connected after PR-5 supplies a reviewed and authorized qualification input. The root `LICENSE` and project licensing policy are not changed by this gate.

The historical inputs and verification record remain under [`licensing/evidence/R002-B`](licensing/evidence/R002-B/REVIEW.md). PR-4's final command logs, package ZIP, external identity record, and full review materials are retained in the external review archive, separate from the fixed historical evidence.
