# DEP-03R1 — V1 Dependency Vulnerability Exploitability Review

## 1. Executive Summary

Review type: **read-only dependency security review**.

Decision: **DEP-03R1 REVIEW PASS**.

The OSV report contains 45 unique advisories covering 26 installed package versions across 23 package names. No P0 or P1 release blocker was confirmed for the published MV3 extension. One advisory is **EXPLOITABLE in a development-only mode** (`@parcel/reporter-dev-server`, when `plasmo dev` is running and a developer visits a malicious page). The three `sharp` advisories are a **P2 build-machine follow-up** because the Plasmo build invokes `sharp` for local icon processing, but the current V1 input is a checked-in 149-byte PNG and no untrusted image input path was found. Three PostCSS source-map advisories are also P2 conditional build-environment follow-ups; the current CSS input contains no source-map directive and is repository-controlled.

No vulnerable package is a direct runtime dependency. The only directly listed vulnerable package is the development dependency `postcss`; the remaining affected packages are transitive development/build dependencies of `plasmo`, `tailwindcss`, or `postcss`. The final MV3 artifact contains only extension outputs and has no literal package-name markers for the affected packages, but bundle provenance is not cryptographically tied to HEAD, so exact bundle inclusion is recorded as **UNVERIFIED**, not as proof of absence.

Classification totals across the 45 unique advisories:

| Classification | Count |
|---|---:|
| EXPLOITABLE | 1 |
| NOT APPLICABLE | 43 |
| UNVERIFIED | 1 |

Release-severity totals:

| Severity | Count |
|---|---:|
| P0 — Critical | 0 |
| P1 — Release Blocker | 0 |
| P2 — Follow-up | 8 |
| Accepted Debt | 37 |

The P2 set is: Parcel dev-server origin validation, three `sharp`/libvips-family advisories, and three PostCSS source-map file-disclosure advisories, plus the `tsup` advisory whose fixed version is not supplied and whose published description does not match the installed 7.2.0 execution path. These do not block the V1 extension release, but should be tracked before exposing the development/build workflow to untrusted inputs.

## 2. Baseline & Scan Provenance

- Repository: `D:\files\Video Summary Assistant`
- HEAD: `6fe73bbb74f1107ddc6aa21c0e2fed7b0d36e776`
- Branch/status at review start: `main...origin/main`, clean working tree
- OSV report: `D:\files\V1-dependency-audit.json`
- Claimed scanner: OSV-Scanner 2.7.0
- Claimed scan date: 2026-10-18
- Scan object: `bun.lock`
- Existing architecture report read-only reference: `docs/reviews/2026-10-18-v1-architecture-audit.md`
- `package.json` SHA-256: `CE43EB0D69A1D197B8198B1561D9BC7B2988F232024F0BB007A72B6D366B11CB`
- `bun.lock` SHA-256: `4FB7274A22D3D4762DBFAB6812A10F1D5E509C15B216F2CA9F9F265EDDF5EC96`
- OSV JSON SHA-256: `9661829C340912667544CED50928A0C6F4B9D9CA22F1D9D765FC8E860B017D91`

The report source path is the current repository lockfile path. Root dependency specifications match exactly: 21 `dependencies` entries and 11 `devDependencies` entries in both `package.json` and the lockfile workspace block. All 26 vulnerable package/version identities in the report are present in the lockfile graph. The lockfile has 715 package entries after parsing Bun's trailing-comma JSON format; the OSV JSON contains 689 package records. The 26-record difference is retained as a scan-output representation discrepancy; it was not used to suppress any advisory.

The current build artifact exists at `build/chrome-mv3-prod`, with a manifest timestamp of 2026-10-18 18:25:08 and version `2026.8.22`, matching `package.json`. The artifact is ignored by Git and contains no source commit marker; exact source-to-artifact correspondence with HEAD is therefore **UNVERIFIED**.

## 3. Scan Coverage and Data Quality

The parsed report contains:

- 1 lockfile result
- 689 package records in the JSON result
- 50 package-version-advisory occurrences
- 45 unique advisory IDs
- 26 affected installed package versions
- 23 affected package names
- 24 HIGH, 18 MODERATE, and 3 LOW OSV database severity labels
- user-supplied maximum reported CVSS: 8.9

The report itself does not encode the scanner version; OSV-Scanner 2.7.0 and the scan date are provenance supplied with the task. No dependency install, upgrade, second scan, or exploit PoC was run. Fixed versions and affected ranges below are copied from the OSV JSON; `UNKNOWN` is preserved where OSV did not provide a fixed version or CVE alias.

### Dependency path legend

All paths below start at a root declared in `package.json`. `dev:` means a development root; no affected identity had a `runtime:` root.

| Path | Lockfile-derived path and role |
|---|---|
| P01 | `dev:plasmo -> @plasmohq/parcel-config -> @parcel/transformer-svg-react -> @svgr/core -> @babel/core` (build transform) |
| P02 | `dev:plasmo -> @plasmohq/parcel-config -> @parcel/config-default -> @parcel/reporter-dev-server` (dev server) |
| P03 | `dev:plasmo -> @plasmohq/parcel-config -> @plasmohq/parcel-transformer-vue -> vue -> @vue/server-renderer` (optional transformer) |
| P04 | `dev:autoprefixer -> browserslist -> baseline-browser-mapping`; also `dev:plasmo -> @parcel/core -> browserslist -> baseline-browser-mapping` |
| P05 | `dev:tailwindcss -> chokidar -> braces`; also Parcel watcher/micromatch paths |
| P06 | `dev:plasmo -> @plasmohq/parcel-config -> @plasmohq/parcel-transformer-inline-css -> browserslist` (4.22.1); 4.28.1 also follows P04 |
| P07 | `dev:plasmo -> @plasmohq/parcel-config -> @plasmohq/parcel-transformer-manifest -> content-security-policy-parser` |
| P08 | `dev:plasmo -> @plasmohq/parcel-config -> @plasmohq/parcel-resolver-post -> tsup -> esbuild` |
| P09 | `dev:plasmo -> fflate` (CLI packaging/init helper) |
| P10 | `dev:plasmo -> got -> cacheable-request -> http-cache-semantics`; also Parcel resolver `got` path |
| P11 | `dev:plasmo -> @plasmohq/parcel-config -> @parcel/transformer-sass -> sass -> immutable` |
| P12 | `dev:plasmo -> @plasmohq/parcel-config -> @parcel/config-default -> @parcel/optimizer-htmlnano -> htmlnano -> cosmiconfig -> js-yaml` |
| P13 | `dev:plasmo -> @parcel/core -> @parcel/cache -> lmdb -> msgpackr` |
| P14 | `dev:postcss -> nanoid`; also Tailwind and optional Vue compiler PostCSS paths |
| P15 | `dev:tailwindcss -> micromatch -> picomatch` 2.3.1; Plasmo `tinyglobby -> picomatch` 4.0.3 |
| P16 | direct `dev:postcss`; also Tailwind and optional Vue compiler paths |
| P17 | `dev:tailwindcss -> postcss-selector-parser`; also `postcss-nested -> postcss-selector-parser` |
| P18 | `dev:plasmo -> sharp` (icon/image build helper) |
| P19 | `dev:postcss -> source-map-js`; also Sass and optional Vue compiler paths |
| P20 | `dev:plasmo -> @plasmohq/parcel-config -> @plasmohq/parcel-transformer-svelte -> svelte` |
| P21 | `dev:plasmo -> @plasmohq/parcel-config -> @parcel/config-default -> @parcel/optimizer-htmlnano -> svgo` |
| P22 | `dev:plasmo -> @plasmohq/parcel-config -> @plasmohq/parcel-resolver-post -> tsup` |
| P23 | `dev:plasmo -> @plasmohq/parcel-config -> @parcel/transformer-svg-react -> @svgr/core -> cosmiconfig -> yaml@1.10.2`; also P22's `postcss-load-config -> yaml@2.8.2` |

## 4. Vulnerability Inventory — All 45 Advisories

Applicability values are independent of release severity. `EXPLOITABLE` means a current project execution path satisfies the advisory's key preconditions; `NOT APPLICABLE` means the current V1 input/entry path does not; `UNVERIFIED` means the advisory data or execution reachability is insufficient to close the question.

| # | Package / installed version(s) | OSV / alias | Severity / CVSS | Advisory summary | Affected range → fixed | Class and required precondition | Path | Applicability / release treatment | Reference |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `js-yaml@4.1.1` | GHSA-2883-xcg3-v3hh / CVE-2026-84375 | HIGH / 3.1 | Empty merge sources bypass `maxTotalMergeKeys`, causing CPU DoS | 4.0.0→4.3.2; 3.0.0→3.15.2 | YAML merge input controlled by attacker | P12 | NOT APPLICABLE; Accepted Debt | [GHSA](https://github.com/advisories/GHSA-2883-xcg3-v3hh) |
| 2 | `nanoid@3.3.11` | GHSA-28wg-ghj8-5hjv / CVE-2026-67214 | HIGH / 3.1, 4.0 | Negative size can loop non-secure generator | `<3.3.16` or `<5.1.16` branches | Attacker-controlled negative generator size | P14 | NOT APPLICABLE; Accepted Debt | [GHSA](https://github.com/advisories/GHSA-28wg-ghj8-5hjv) |
| 3 | `svgo@2.8.2` | GHSA-2p49-hgcm-8545 / CVE-2026-73650 | HIGH / 3.1 | `removeScripts` leaves executable scripts | 1.x→2.8.3; 3.x→3.3.4; 4.x→4.0.2 | Untrusted SVG passed through sanitizer | P21 | NOT APPLICABLE; Accepted Debt | [GHSA](https://github.com/advisories/GHSA-2p49-hgcm-8545) |
| 4 | `nanoid@3.3.11` | GHSA-2v37-7h3g-55p8 / CVE-2026-67213 | HIGH / 3.1, 4.0 | Zero custom-generator size can loop indefinitely | `<3.3.18` or `<5.1.6` branches | Attacker controls zero size passed to custom generator | P14 | NOT APPLICABLE; Accepted Debt | [GHSA](https://github.com/advisories/GHSA-2v37-7h3g-55p8) |
| 5 | `tsup@7.2.0` | GHSA-3mv9-4h5g-vhg3 / CVE-2024-53384 | LOW / 4.0 | DOM clobbering in `cjs_shims.js` can reach code execution | introduced 0, last affected 8.3.4; fixed UNKNOWN | Crafted script plus browser execution of generated shim | P22 | UNVERIFIED; P2 follow-up because fixed version is UNKNOWN and installed execution path is not established | [GHSA](https://github.com/advisories/GHSA-3mv9-4h5g-vhg3) |
| 6 | `picomatch@2.3.1`, `4.0.3` | GHSA-3v7f-55p6-f55p / CVE-2026-33672 | MODERATE / 3.1 | POSIX character-class method injection changes glob matching | 2.x→2.3.2; 3.x→3.0.2; 4.x→4.0.4 | Attacker-controlled glob pattern | P15 | NOT APPLICABLE; Accepted Debt | [GHSA](https://github.com/advisories/GHSA-3v7f-55p6-f55p) |
| 7 | `yaml@1.10.2`, `2.8.2` | GHSA-48c2-rrv3-qjmp / CVE-2026-33532 | MODERATE / 3.1 | Deeply nested YAML collections overflow the stack | 1.x→1.10.3; 2.x→2.8.3 | Attacker-controlled YAML document | P23 | NOT APPLICABLE; Accepted Debt | [GHSA](https://github.com/advisories/GHSA-48c2-rrv3-qjmp) |
| 8 | `svgo@2.8.2` | GHSA-4vpr-x523-8j87 / CVE-2026-84369 | MODERATE / 3.1 | `foreignObject` executable HTML bypasses `removeScripts` | 2.x→2.8.4; 3.x→3.3.5; 4.x→4.1.0 | Untrusted SVG containing `foreignObject` | P21 | NOT APPLICABLE; Accepted Debt | [GHSA](https://github.com/advisories/GHSA-4vpr-x523-8j87) |
| 9 | `@babel/core@7.29.0` | GHSA-4x5r-pxfx-6jf8 / CVE-2026-49356 | LOW / 3.1 | Crafted `sourceMappingURL` can read an arbitrary source map | 7.x→7.29.6; 8.x→8.0.0-rc.6 | Attacker controls compiled source and knows target map path | P01 | NOT APPLICABLE; no source-map directives or untrusted source input found; Accepted Debt | [GHSA](https://github.com/advisories/GHSA-4x5r-pxfx-6jf8) |
| 10 | `js-yaml@4.1.1` | GHSA-52cp-r559-cp3m / CVE-2026-59869 | HIGH / 3.1 | Merge-key chains force quadratic CPU | 4.x→4.3.0; 3.x→3.15.0 | Attacker-controlled YAML merge chain | P12 | NOT APPLICABLE; Accepted Debt | [GHSA](https://github.com/advisories/GHSA-52cp-r559-cp3m) |
| 11 | `js-yaml@4.1.1` | GHSA-5p4m-2wfm-xmqj / CVE UNKNOWN | HIGH / 3.1 | Quadratic CPU in `!!omap` resolution | 4.x→4.3.1; 3.x→3.15.1 | Attacker-controlled YAML `!!omap` input | P12 | NOT APPLICABLE; Accepted Debt | [GHSA](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj) |
| 12 | `esbuild@0.18.20` | GHSA-67mh-4wv8-2f99 / CVE UNKNOWN | MODERATE / 3.1 | Any website can read an esbuild development server response | 0.x→0.25.0 | esbuild serve mode running and browser visits malicious origin | P08 | NOT APPLICABLE; Plasmo production build does not invoke esbuild serve; Accepted Debt | [GHSA](https://github.com/advisories/GHSA-67mh-4wv8-2f99) |
| 13 | `source-map-js@1.2.1` | GHSA-68fv-2mgg-jv7q / CVE-2026-93749 | HIGH / 3.1, 4.0 | Indexed source-map offsets can exhaust the event loop | 1.x→1.2.2 | Attacker-controlled malformed indexed source map | P19 | NOT APPLICABLE; no source-map input path found; Accepted Debt | [GHSA](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) |
| 14 | `postcss@8.5.8` | GHSA-6g55-p6wh-862q / CVE-2026-45623 | HIGH / 3.1 | Attacker `sourceMappingURL` reads arbitrary files | 8.x→8.5.12 | Attacker controls CSS comment and output map is readable | P16 | NOT APPLICABLE to current checked-in CSS; conditional build-machine P2 follow-up | [GHSA](https://github.com/advisories/GHSA-6g55-p6wh-862q) |
| 15 | `browserslist@4.22.1`, `4.28.1` | GHSA-73wf-gq98-2v4g / CVE-2026-73088 | HIGH / 3.1 | Untrusted custom stats can crash or write prototype state | 4.x→4.28.7 | Attacker supplies custom `browserslist-stats.json` | P04/P06 | NOT APPLICABLE; no custom stats input in repo; Accepted Debt | [GHSA](https://github.com/advisories/GHSA-73wf-gq98-2v4g) |
| 16 | `msgpackr@1.8.5` | GHSA-7hpj-7hhx-2fgx / CVE-2023-52079 | HIGH / 3.1 | Property-name conversion can recurse indefinitely | 1.x→1.10.1 | Malformed attacker-controlled serialized/cache object | P13 | NOT APPLICABLE; only Parcel internal cache path; Accepted Debt | [GHSA](https://github.com/advisories/GHSA-7hpj-7hhx-2fgx) |
| 17 | `svelte@4.2.2` | GHSA-8266-84wp-wv5c / CVE-2024-45047 | MODERATE / 3.1, 4.0 | SSR escaping issue can produce mXSS | 4.x→4.2.19 | Untrusted SSR HTML rendered by Svelte | P20 | NOT APPLICABLE; no `.svelte` source or SSR entry | [GHSA](https://github.com/advisories/GHSA-8266-84wp-wv5c) |
| 18 | `picomatch@2.3.1`, `4.0.3` | GHSA-c2c7-rcm5-vvqj / CVE-2026-33671 | HIGH / 3.1 | Extglob quantifiers enable ReDoS | 2.x→2.3.2; 3.x→3.0.2; 4.x→4.0.4 | Attacker-controlled extglob pattern | P15 | NOT APPLICABLE; repository glob patterns are fixed | [GHSA](https://github.com/advisories/GHSA-c2c7-rcm5-vvqj) |
| 19 | `browserslist@4.22.1`, `4.28.1` | GHSA-c83g-rgw3-j3cx / CVE-2026-73089 | HIGH / 3.1 | Distinct queries grow memory without eviction | 4.x→4.28.7 | Attacker can force unbounded distinct query inputs | P04/P06 | NOT APPLICABLE; fixed build configuration and finite source set | [GHSA](https://github.com/advisories/GHSA-c83g-rgw3-j3cx) |
| 20 | `http-cache-semantics@4.2.0` | GHSA-ch52-4w7c-c8xp / CVE-2026-93748 | HIGH / 3.1, 4.0 | Large `max-stale` can disclose another user's cached response | through 4.2.0; fixed UNKNOWN | Shared multi-user cache with security-zeroed entries | P10 | NOT APPLICABLE; local build CLI cache, no shared user cache | [GHSA](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) |
| 21 | `svelte@4.2.2` | GHSA-crpf-4hrx-3jrp / CVE-2026-27125 | MODERATE / 4.0 | SSR spread attributes include inherited properties | →5.51.5 | Attacker-controlled SSR object plus Svelte SSR | P20 | NOT APPLICABLE; no Svelte SSR | [GHSA](https://github.com/advisories/GHSA-crpf-4hrx-3jrp) |
| 22 | `svelte@4.2.2` | GHSA-f7gr-6p89-r883 / CVE-2026-27121 | MODERATE / 4.0 | SSR spread attributes permit XSS | →5.51.5 | Attacker-controlled SSR attributes | P20 | NOT APPLICABLE; no Svelte SSR | [GHSA](https://github.com/advisories/GHSA-f7gr-6p89-r883) |
| 23 | `sharp@0.33.5` | GHSA-f88m-g3jw-g9cj / CVE UNKNOWN | HIGH / 4.0 | Inherited libvips CVEs 2026-33327/33328/35590/35591 | 0.x→0.35.0 | Malformed/untrusted image reaches sharp/libvips | P18 | NOT APPLICABLE for current trusted icon; P2 build-machine follow-up | [GHSA](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) |
| 24 | `postcss@8.5.8` | GHSA-fxqj-rqcc-2cmp / CVE-2026-69153 | MODERATE / 4.0 | Incomplete source-map fix reads arbitrary `.map` when `from` is unset | 8.x→8.5.23 | Attacker CSS plus unset `from` and readable map path | P16 | NOT APPLICABLE to current CSS; conditional build-machine P2 follow-up | [GHSA](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) |
| 25 | `@vue/server-renderer@3.3.4` | GHSA-g2v6-rqmx-r4w6 / CVE UNKNOWN | HIGH / 3.1 | Missing CR in attribute blacklist permits SSR XSS | 3.3.x→3.5.42; 3.6.x→3.6.0-rc.6 | Untrusted SSR input through Vue server renderer | P03 | NOT APPLICABLE; React-only source and no SSR | [GHSA](https://github.com/advisories/GHSA-g2v6-rqmx-r4w6) |
| 26 | `js-yaml@4.1.1` | GHSA-h67p-54hq-rp68 / CVE-2026-53550 | MODERATE / 3.1 | Repeated aliases cause quadratic merge-key CPU | 4.x→4.2.0; 3.x→3.15.0 | Attacker-controlled YAML aliases | P12 | NOT APPLICABLE; Accepted Debt | [GHSA](https://github.com/advisories/GHSA-h67p-54hq-rp68) |
| 27 | `svelte@4.2.2` | GHSA-m56q-vw4c-c2cp / CVE-2026-27122 | MODERATE / 4.0 | SSR dynamic element names are not validated | →5.51.5 | Attacker-controlled SSR tag name | P20 | NOT APPLICABLE; no Svelte SSR | [GHSA](https://github.com/advisories/GHSA-m56q-vw4c-c2cp) |
| 28 | `svelte@4.2.2` | GHSA-phwv-c562-gvmh / CVE-2026-27901 | MODERATE / 4.0 | SSR XSS via contenteditable bindings | →5.53.5 | Attacker-controlled SSR contenteditable binding | P20 | NOT APPLICABLE; no Svelte SSR | [GHSA](https://github.com/advisories/GHSA-phwv-c562-gvmh) |
| 29 | `svelte@4.2.2` | GHSA-pr6f-5x2q-rwfp / CVE-2026-42599 | MODERATE / 4.0 | SSR spread attributes permit XSS | →5.55.7 | Attacker-controlled SSR spread attributes | P20 | NOT APPLICABLE; no Svelte SSR | [GHSA](https://github.com/advisories/GHSA-pr6f-5x2q-rwfp) |
| 30 | `fflate@0.8.2` | GHSA-px8p-9vwx-vf98 / CVE-2026-45820 | MODERATE / 3.1, 4.0 | `unzipSync` can loop on malformed ZIP64 | 0.8.x→0.8.3; earlier branches as listed by OSV | Attacker-controlled ZIP passed to `unzipSync` | P09 | NOT APPLICABLE; current production build does not unzip user ZIPs | [GHSA](https://github.com/advisories/GHSA-px8p-9vwx-vf98) |
| 31 | `@parcel/reporter-dev-server@2.9.3` | GHSA-qm9p-f9j5-w83w / CVE-2025-56648 | MODERATE / 3.1 | Malicious website can read Parcel dev-server responses | 1.6.1→2.16.4 | `plasmo dev` server running and developer visits malicious origin | P02 | **EXPLOITABLE in development mode; P2, not MV3 release blocker** | [GHSA](https://github.com/advisories/GHSA-qm9p-f9j5-w83w) |
| 32 | `postcss@8.5.8` | GHSA-qx2v-qp2m-jg93 / CVE-2026-41305 | MODERATE / 3.1 | Stringifier can emit XSS through unescaped `</style>` | 8.x→8.5.10 | Attacker controls CSS text and output is interpreted as HTML | P16 | NOT APPLICABLE; extension CSS is local and no HTML sink found; Accepted Debt | [GHSA](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) |
| 33 | `postcss@8.5.8` | GHSA-r28c-9q8g-f849 / CVE-2026-73646 | HIGH / 3.1 | Previous source-map auto-load path traversal discloses `.map` files | 8.x→8.5.18 | Attacker CSS/sourceMappingURL and readable filesystem map | P16 | NOT APPLICABLE to current CSS; conditional build-machine P2 follow-up | [GHSA](https://github.com/advisories/GHSA-r28c-9q8g-f849) |
| 34 | `svelte@4.2.2` | GHSA-rcqx-6q8c-2c42 / CVE-2026-42573 | MODERATE / 4.0 | SSR XSS through DOM clobbering internal state | →5.55.7 | Attacker-controlled SSR markup and DOM clobbering | P20 | NOT APPLICABLE; no Svelte SSR | [GHSA](https://github.com/advisories/GHSA-rcqx-6q8c-2c42) |
| 35 | `sharp@0.33.5` | GHSA-rgj7-g3m4-5g8c / CVE UNKNOWN | HIGH / 4.0 | Inherited libheif vulnerabilities | 0.x→0.35.4 | Malformed/untrusted HEIF reaches sharp/libheif | P18 | NOT APPLICABLE for current trusted icon; P2 build-machine follow-up | [GHSA](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) |
| 36 | `postcss-selector-parser@6.1.2` | GHSA-rj75-hqrm-r3gf / CVE-2026-104844 | MODERATE / 3.1 | Flat selector parsing has quadratic complexity | 6.x→7.1.6 | Attacker-controlled selector text | P17 | NOT APPLICABLE; project selectors are repository-controlled | [GHSA](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) |
| 37 | `immutable@5.1.5` | GHSA-v56q-mh7h-f735 / CVE-2026-59879 | HIGH / 3.1, 4.0 | 32-bit trie overflow causes unrecoverable DoS | 5.x→5.1.8; 4.x→4.3.9; 3.x→3.8.4 | Attacker-controlled huge Immutable List | P11 | NOT APPLICABLE; only Sass build internals, no untrusted list input | [GHSA](https://github.com/advisories/GHSA-v56q-mh7h-f735) |
| 38 | `braces@3.0.3` | GHSA-vfj7-8cjw-p6xm / CVE-2026-93687 | HIGH / 3.1, 4.0 | Deeply nested brace patterns exhaust the stack | through 3.0.3; fixed UNKNOWN | Attacker-controlled deeply nested glob | P05 | NOT APPLICABLE; fixed repository glob patterns | [GHSA](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) |
| 39 | `svgo@2.8.2` | GHSA-w27v-7q3p-w38r / CVE-2026-84370 | HIGH / 3.1 | Namespace/control-character bypass leaves executable links | 2.x→2.8.4; 3.x→3.3.5; 4.x→4.1.0 | Untrusted SVG passed through `removeScripts` | P21 | NOT APPLICABLE; no SVG source asset | [GHSA](https://github.com/advisories/GHSA-w27v-7q3p-w38r) |
| 40 | `content-security-policy-parser@0.4.1` | GHSA-w2cq-g8g3-gm83 / CVE-2025-55164 | HIGH / 4.0 | `__proto__` policy name enables prototype pollution | 0.x→0.6.0 | Attacker controls CSP string passed to parser | P07 | NOT APPLICABLE; production transformer does not parse untrusted HTTP CSP and current manifest has no CSP input | [GHSA](https://github.com/advisories/GHSA-w2cq-g8g3-gm83) |
| 41 | `baseline-browser-mapping@2.10.0` | GHSA-w5vr-8v7q-w6rv / CVE-2026-45819 | MODERATE / 4.0 | Invalid input can terminate the process | 2.x→2.11.0 | Attacker-controlled browser-compatibility input | P04 | NOT APPLICABLE; fixed build metadata | [GHSA](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv) |
| 42 | `postcss-selector-parser@6.1.2` | GHSA-w9m9-85wc-3x92 / CVE-2026-9358 | LOW / 3.1, 4.0 | Uncontrolled AST recursion causes DoS | 6.x→6.1.3; 7.x→7.1.3 | Attacker-controlled selector AST | P17 | NOT APPLICABLE; project selectors are repository-controlled | [GHSA](https://github.com/advisories/GHSA-w9m9-85wc-3x92) |
| 43 | `sharp@0.33.5` | GHSA-wq5f-xc86-pv6w / CVE UNKNOWN | HIGH / 4.0 | Inherited librsvg vulnerability | 0.x→0.35.5 | Malformed/untrusted SVG reaches sharp/librsvg | P18 | NOT APPLICABLE for current trusted PNG; P2 build-machine follow-up | [GHSA](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) |
| 44 | `immutable@5.1.5` | GHSA-xvcm-6775-5m9r / CVE-2026-59880 | HIGH / 4.0 | Hash collisions cause algorithmic-complexity DoS | 5.x→5.1.8; 4.x→4.3.9; 3.x→3.8.4 | Attacker-controlled colliding Map/Set keys | P11 | NOT APPLICABLE; Sass internal data only | [GHSA](https://github.com/advisories/GHSA-xvcm-6775-5m9r) |
| 45 | `nanoid@3.3.11` | GHSA-xwg4-73v4-xw9w / CVE-2026-73086 | HIGH / 3.1, 4.0 | Integer overflow/wraparound in generator sizing | 3.x→3.3.12; 5.x→5.1.11 | Attacker controls generator size/overflow input | P14 | NOT APPLICABLE; PostCSS calls `nanoid(6)` with a fixed safe size | [GHSA](https://github.com/advisories/GHSA-xwg4-73v4-xw9w) |

### Duplicate and overlapping advisories

- `postcss`: GHSA-6g55, GHSA-fxqj, and GHSA-r28c are the same source-map/file-disclosure family; GHSA-fxqj explicitly describes an incomplete fix.
- `sharp`: the three advisories aggregate libvips, libheif, and librsvg issues behind the same `sharp@0.33.5` build dependency.
- `js-yaml`: four advisories overlap merge-key, alias, and `!!omap` CPU exhaustion.
- `nanoid`: three advisories overlap malformed size handling in non-secure/custom generators.
- `picomatch`: method injection and extglob ReDoS affect both installed 2.x and 4.x copies.
- `svgo`: all three advisories concern incomplete script/link sanitization.
- `svelte`: six advisories concern SSR escaping, spread attributes, dynamic elements, contenteditable bindings, or DOM clobbering; none has a Svelte source or SSR entry in this project.
- `browserslist`, `immutable`, and `postcss-selector-parser` each have two advisories against the same installed package family.

## 5. Runtime vs Build Dependency Classification

### Direct runtime dependencies

The 21 direct runtime dependencies in `package.json` contain no package name present in the vulnerable-name set. The extension runtime is React/React-DOM, Radix UI, Dexie, Zod, Sonner, and utility packages; OSV did not report a vulnerable version among these direct runtime roots.

### Direct development dependencies

`postcss@8.5.8` is the only directly listed vulnerable package. It is consumed by the `.postcssrc.json` Tailwind/autoprefixer pipeline and is not imported by application source. `plasmo@0.90.5` is a direct development dependency and brings most affected packages through Parcel and optional transformers.

### Transitive development/build dependencies

All other affected identities are reachable only from development roots. The lockfile graph shows no `runtime:` root path. This is a meaningful boundary, but not an automatic dismissal: `plasmo build`, `plasmo dev`, `plasmo package`, and the configured Parcel transformers execute on the Windows developer/build machine.

### Windows execution evidence

`bun pm ls --all` shows `sharp@0.33.5` with Windows optional packages, and the installed Plasmo CLI contains a direct `sharp` import. The production build log completed successfully, so the Windows build path is real. The build does not imply the package is shipped to extension users.

## 6. Detailed High-Risk Findings

### 6.1 `sharp` / libvips-family advisories

`node_modules/plasmo/dist/index.js` imports `sharp` and uses it in icon generation: it finds the base icon, calls `sharp(input).toBuffer()`, and resizes it for the 128/64/48/32/16 icon outputs. The current repository has only `assets/icon.png`, a checked-in 149-byte PNG. No transcript, provider, browser, or user-uploaded image is passed to this code, and the extension does not expose an image-processing API.

The necessary exploit precondition is therefore not present in the current V1 flow: an attacker would need to control the local build input or the checkout/dependency supply chain. This is not a user-runtime exposure. It remains P2 because a future untrusted asset/CI checkout could turn the build machine into the attack surface. The narrow remediation is to move to a Plasmo release carrying `sharp >= 0.35.5` (or a compatibility-tested override) and rerun icon generation/build tests; do not independently upgrade the whole toolchain without compatibility evidence.

### 6.2 `content-security-policy-parser`

The vulnerable parser is a dependency of Plasmo's manifest transformer. Its local code parses a CSP string only while handling development/hot manifest transformations; the current `package.json` has no `content_security_policy` field, and the generated production manifest has no custom CSP field. There is no HTTP query or user-controlled CSP input. The prototype-pollution precondition is absent. This is Accepted Debt, with a narrow mitigation of upgrading the transformer/Plasmo release or ensuring CSP strings remain repository-controlled.

### 6.3 PostCSS

The project has a direct `postcss@8.5.8` dev dependency and `.postcssrc.json` enables Tailwind and autoprefixer. The only CSS source is `src/styles/globals.css`; repository search found no `sourceMappingURL`, `sourceURL`, SCSS/Sass, SVG, Vue, or Svelte source. The three arbitrary-file-read advisories require attacker-controlled CSS comments and source-map resolution conditions that are not present. The XSS stringifier advisory also has no current HTML sink: the generated CSS is extension CSS, not a string later injected into an HTML parser by this project.

The source-map family is still a P2 conditional build-environment follow-up because PostCSS is direct and a future untrusted CSS input could change the result. A targeted `postcss >= 8.5.23` update would cover the three source-map advisories; validate CSS output and lockfile changes before accepting it.

### 6.4 Parcel and esbuild development servers

Parcel's reporter advisory is applicable to `plasmo dev`: its code starts a local development server, and the advisory's malicious-page origin can read development responses. The default Plasmo dev host is `localhost`; this is a developer-machine source-code exposure, not a published extension exposure. It is P2 and should be addressed before routine development on sensitive workspaces by upgrading to a Parcel line containing `@parcel/reporter-dev-server >= 2.16.4` or by applying an equivalent safe origin/CORS configuration.

The separate `esbuild@0.18.20` advisory is not applicable to the current project path. The package is nested under `tsup`/Parcel resolver; no `esbuild.serve` invocation was found, and production `plasmo build` uses Parcel's production run rather than esbuild's serve mode.

### 6.5 Vue, Svelte, and SVGO

Plasmo's default Parcel configuration registers Vue, Svelte, SVG, and SVGO transformers, but the repository has no `.vue`, `.svelte`, or `.svg` source. The only image asset is PNG. React is the only application UI framework in `package.json` and source. The Vue SSR, Svelte SSR, and SVG sanitizer advisories therefore have no current input path and are Accepted Debt, not release blockers.

## 7. Final MV3 Bundle Exposure

### Evidence collected

The existing production output contains 14 files: manifest, two HTML pages, four JavaScript entry chunks, one CSS file, and five PNG icons. The generated manifest contains only MV3 extension permissions, content scripts, background service worker, side panel, options page, and host permissions; it contains no vulnerable package metadata or dev-server endpoint.

A literal-name search over JS/CSS/HTML/manifest output found no markers for `sharp`, `postcss`, `vue`, `svelte`, `svgo`, `esbuild`, `fflate`, `http-cache-semantics`, `js-yaml`, `msgpackr`, `picomatch`, `source-map-js`, `tsup`, `browserslist`, or `@parcel/reporter-dev-server`. Source search likewise found no application import of the affected package names.

This is strong evidence that the affected packages are build-only, but minification can erase package names and the ignored build directory has no commit provenance marker. Therefore the exact package-to-bundle mapping is **UNVERIFIED**, not asserted as mathematically impossible. No runtime exploit path was found from the source, manifest, or artifact layout.

## 8. Development & Build Environment Exposure

| Surface | Exposure | Evidence | Treatment |
|---|---|---|---|
| `plasmo dev` / Parcel reporter | Malicious web page can read local dev responses when server is running | P02; dev-server code path and advisory | EXPLOITABLE, P2 |
| `plasmo build` icon generation | `sharp` decodes/resizes checked-in icon | P18; local `assets/icon.png` only | Conditional build-machine P2 |
| PostCSS/Tailwind | CSS and selectors are parsed during build | P14/P16/P17/P19; one CSS file, no source maps | Conditional P2 for source-map family; otherwise Accepted Debt |
| Parcel optional Vue/Svelte/SVGO transformers | Transformers are registered but no matching source files exist | P03/P20/P21; source enumeration | Accepted Debt |
| `plasmo package` / special CLI ZIP path | `fflate` is used for packaging and ZIP conversion helpers | P09; no user ZIP input in build | Accepted Debt |
| `got`/cacheable-request | Build metadata/network helper, not a shared application cache | P10 | Accepted Debt |

No build server was started by this audit, no malformed input was supplied, and no vulnerability PoC was executed. The review therefore separates source-supported execution reachability from hypothetical attacker-controlled repository or dependency inputs.

## 9. Applicability Assessment

The 45-advisory classification is complete in Section 4. The central findings are:

1. **No vulnerable direct runtime dependency** was identified.
2. **One development-mode advisory is exploitable** when `plasmo dev` is running: Parcel origin validation.
3. **One advisory remains unverified**: `tsup` GHSA-3mv9-4h5g-vhg3. OSV gives no fixed version, while its description specifically mentions tsup 8.3.4 and the lockfile has 7.2.0; the current project does not invoke tsup as an application compiler.
4. **The remaining 43 advisories lack their required current input path**: no user images, no runtime ZIP/YAML/CSP/SSR/SVG inputs, no custom Browserslist stats, no shared HTTP cache, and no vulnerable package imports from application source.

The applicability decision is not based solely on CVSS or `devDependency` status. It uses the actual lockfile path, repository inputs, Plasmo/Parcel configuration, source tree, build artifact, and advisory preconditions.

## 10. Recommended Remediation

Recommendations only; no dependency or source change was made in this review.

| Priority | Target | Minimum/known safe version | Expected coverage | Compatibility and validation |
|---|---|---|---|---|
| 1 | Parcel reporter / Plasmo dev server | `@parcel/reporter-dev-server >= 2.16.4` or a Plasmo release carrying it | GHSA-qm9p-f9j5-w83w | Prefer a Plasmo-compatible targeted override; verify `plasmo dev` binds safely and cross-origin reads fail. No MV3 manifest change expected. |
| 2 | PostCSS source-map family | `postcss >= 8.5.23` covers GHSA-6g55, GHSA-fxqj, GHSA-r28c | Arbitrary `.map` read/path traversal | Direct dev dependency/lockfile change; rerun CSS build and inspect generated CSS. |
| 3 | Plasmo icon/image toolchain | `sharp >= 0.35.5`, preferably through a compatible Plasmo release | Three `sharp`/libvips-family advisories | A direct override may affect native Windows binaries; rerun icon generation and production build. |
| 4 | `tsup` advisory | Fixed version `UNKNOWN` in OSV report | GHSA-3mv9-4h5g-vhg3 | First verify upstream affected range and whether the generated shim is reachable; do not blindly upgrade. |
| 5 | Prevent future untrusted build inputs | Configuration/process control | Bounds all conditional build-only advisories | Keep image/CSS/SVG/YAML/CSP inputs repository-controlled; do not expose `plasmo dev` while browsing untrusted pages. |

No recommendation is made to upgrade Vue, Svelte, SVGO, YAML, Browserslist, or every transitive package solely for version freshness. Their current V1 paths do not satisfy the advisory preconditions; any later update should be grouped with a compatibility-tested toolchain change.

## 11. Accepted Debt

Thirty-seven advisories are Accepted Debt for this V1 release because their vulnerable code is build-only, optional, or unreachable from current inputs, and the extension runtime does not ship the affected package path. This acceptance is conditional:

- It does not authorize `plasmo dev` exposure to untrusted browsing sessions.
- It does not authorize adding user-controlled images, SVG, YAML, CSP, CSS, or SSR inputs without reopening this review.
- It does not claim the ignored build directory is reproducibly tied to HEAD.
- It does not waive ordinary dependency review when the Plasmo/Parcel toolchain changes.

## 12. Remaining Unverified Risks

1. The OSV JSON does not include scanner-version metadata; scanner version 2.7.0 is task-supplied provenance.
2. The 715 lockfile entries versus 689 report package records discrepancy was not reproduced with a second scanner. All 26 vulnerable identities are nevertheless present in the lockfile.
3. The ignored production artifact has matching version/manifest shape but no source commit marker; exact bundle provenance is UNVERIFIED.
4. `tsup` GHSA-3mv9-4h5g-vhg3 has no fixed version in the report and a description centered on 8.3.4 while the installed package is 7.2.0. Upstream range/patch applicability needs a focused follow-up.
5. No browser smoke, `plasmo dev` origin test, malformed-image test, malformed-CSS/source-map test, or ZIP/YAML/SVG PoC was run. This was deliberate: the task is read-only and forbids automatic PoCs or exposed development servers.
6. No fresh OSV rescan was run because dependency installation/upgrade and external scanner execution were outside the required read-only evidence set.

## 13. V1 Release Gate Recommendation

**DEP-03R1 REVIEW PASS**

Dependency security does **not** create a P0 or P1 V1 release blocker for the published MV3 extension based on the evidence available at HEAD `6fe73bbb74f1107ddc6aa21c0e2fed7b0d36e776`.

The minimum follow-up set is:

1. Address Parcel dev-server origin validation before using `plasmo dev` on sensitive workspaces.
2. Plan a compatibility-tested Plasmo/sharp remediation for the build machine.
3. Plan a targeted PostCSS source-map remediation to at least 8.5.23.
4. Verify the tsup advisory's actual affected range and fixed release.

These are dependency-security follow-ups, not a declaration that the whole V1 is release-pass. No change to `TASK_STATE.md` was made.

## 14. Evidence and References

### Local evidence and commands

- `git rev-parse HEAD` → `6fe73bbb74f1107ddc6aa21c0e2fed7b0d36e776`.
- `git status --short --branch` → `main...origin/main`, clean at start and before report creation.
- JSON parse of `D:\files\V1-dependency-audit.json` → 1 result, 45 unique IDs, 26 affected versions, 23 package names.
- Bun-lock JSONC parse (trailing commas removed in memory only) → 715 package entries; root specs exactly match `package.json`.
- Lock graph traversal from runtime/development roots → all affected identities reachable only from development roots; all 26 report identities present.
- `bun pm ls --all` → installed Plasmo/Parcel/Sass/sharp/optional transformer graph.
- Source search → no application imports of affected package names; only `src/styles/globals.css`, `assets/icon.png`, no `.vue`, `.svelte`, `.svg`, SCSS, Sass, or source-map directives.
- Existing production artifact inspection → MV3 manifest and 14 output files; literal package-name search produced no matches. This is evidence, not proof against minified inclusion.

### Upstream advisory references

Every row in Section 4 links to its GitHub Security Advisory. CVE aliases, affected ranges, fixed versions, CVSS vectors, summaries, and duplicate relationships are copied from the supplied OSV JSON. High-risk primary references include:

- [Parcel origin validation advisory](https://github.com/advisories/GHSA-qm9p-f9j5-w83w)
- [sharp/libvips advisory](https://github.com/advisories/GHSA-f88m-g3jw-g9cj)
- [sharp/libheif advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c)
- [sharp/librsvg advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)
- [content-security-policy-parser advisory](https://github.com/advisories/GHSA-w2cq-g8g3-gm83)
- [PostCSS source-map advisory](https://github.com/advisories/GHSA-6g55-p6wh-862q)
- [PostCSS incomplete-fix advisory](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp)
- [PostCSS path-traversal advisory](https://github.com/advisories/GHSA-r28c-9q8g-f849)
- [esbuild development-server advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99)
- [Svelte SSR advisory](https://github.com/advisories/GHSA-8266-84wp-wv5c)
- [SVGO script-sanitization advisory](https://github.com/advisories/GHSA-2p49-hgcm-8545)

No product code, dependency manifest, lockfile, existing audit report, Git history, or task state was modified by this review.
