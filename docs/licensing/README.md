# Third-party licensing records

`third-party-license-ledger.json` is the maintained provenance ledger for the
fixed source revision named inside the file. It is a provenance record, not a
release approval or a final distribution SBOM. The root `LICENSE` governs only
project-owned or authorized material within the scope in
[`../../licenses/LICENSE-SCOPE.md`](../../licenses/LICENSE-SCOPE.md); it does
not replace third-party licenses.

The ledger preserves the accepted required dependency closure of 70 package
directory identities (65 unique name-version pairs) and expanded optional
closure of 74 identities (69 unique pairs). In the component list, duplicate
nested package directories remain separate rows. `installedClosureMembership`
records dependency reachability; `actualBundleMembership` is a separate field
and remains `UNKNOWN` for every row. The formal validator pins the accepted
F01 closure and P02 matrix by SHA-256 and compares every npm directory
identity, version, manifest hash, and required/optional classification against
those records. Fixed counts are constants in the validator and schema, not
values that can be lowered by editing the ledger.

For each of the 69 exact npm releases, the ledger records registry version and
tarball URLs, registry SRI, matching `bun.lock` SRI, tarball SHA-256, package
manifest declaration and copyright evidence, and the legal files observed in
the tarball. Exact license and notice bytes are content-addressed under
`licenses/third-party/materials/`. Twelve Radix releases without a tarball
license map to the versioned Radix source commit and its root MIT text.
`react-remove-scroll-bar@2.3.8` remains unresolved: its tarball has no
standalone license or notice, its registry `gitHead` cannot be mapped to an
official source commit, and the later license addition is not used as
version-specific evidence.

The source inventory records fixed-upstream path/blob classifications and the
change from the P01 audit baseline. These are mechanical comparisons; a new
path or changed file is not by itself proof of original authorship. The
shadcn-derived template family and the upstream icon retain explicit
provenance limits. BiliScript and Video Digest remain architectural references
based on existing notices and bounded checks, not complete rewritten-expression
reviews.

Verified tarball references must map to a legal file in that exact release,
with matching material hash, byte length, source tarball, package name, and
version. Verified fixed-upstream references must map the preserved bytes to
the recorded repository, commit, license path, Git blob, and SHA-256. For
versioned npm packages, the fixed-release manifest and source-map records must
also match the published version and tarball identity. Reusing one identical
license file across packages is allowed only when each package has its own
matching source-artifact and scope record.

Validate the committed ledger from the repository root with:

```sh
bun scripts/validate-license-ledger.ts
bun test scripts/license-ledger-validation.test.ts
```

The validator checks directory identity uniqueness, the fixed accepted closure,
actual `bun.lock` SRI values and SHA-512 digest lengths, exact release and
upstream source mappings, evidence labels, legal-material paths and hashes,
required versus optional reachability, and strict `UNKNOWN` bundle membership.
The root manifest and lockfile may match either the recorded Windows checkout
bytes or the fixed Git blob bytes. License and pinned evidence files always
use their exact original bytes.

`evidence/` contains the accepted input matrix and closure records plus a
fixed-commit source path inventory used to build this ledger. npm tarball
archives and external code are not included. R1 regression and engineering
logs are delivered separately in the review package.

The immutable R002-B records remain historical snapshots. PR-5 keeps its
project-rights supplement, contributor authority record, current scope and
current notice output under `evidence/R002-PR5/`; those versioned records do
not rewrite the R002-B evidence.
