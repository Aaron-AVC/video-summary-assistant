# Video Summary Assistant V1 Architecture and Dependency Audit

## 1. Executive Summary

Audit mode: **AUDIT ONLY**. No product code, schema, migration, prompt/schema version, manifest permission, commit, push, rebase, amend, or force-push was performed.

The pre-audit repository state was clean at `f60795c6918297a4278f5673288a08b91c1d24aa`. The only final worktree change is this newly added audit report; no product file was modified.

Overall result: **RELEASE HOLD**.

One release-blocking finding was identified:

- **SEC-01 / P1**: a signed YouTube timedtext URL can flow through the legacy/fallback transcript path into `transcriptCache` / `transcriptSnapshots` and then into the user export. The live Resource Timing path deliberately suppresses the URL, but the equivalent suppression is not enforced at the general persistence/export boundary.

Additional findings are P2 follow-up work. No P0 was identified.

## 2. Scope & Baseline

Audit baseline: `f60795c6918297a4278f5673288a08b91c1d24aa`.

Initial check:

```text
HEAD: f60795c6918297a4278f5673288a08b91c1d24aa
branch: main...origin/main
working tree: clean
```

Final scope check: `?? docs/reviews/` only, containing this report.

The requested scope covered architecture, persistence, concurrency, security boundaries, provider/AI grounding, platform/transcript integration, MV3 runtime, dependencies, build readiness, and release validation.

## 3. Architecture Map

```text
Side Panel React workspace
  -> runtime bridge -> background/service worker -> content script / MAIN-world bridge
  -> platform adapter (YouTube or Bilibili)
  -> transcript pipeline -> fingerprint/contentKey
  -> AnalysisTaskController / AskTaskController
  -> provider transport (OpenAI-compatible endpoint)
  -> Dexie repository (runs, segments, caches, QA, video records)
  -> workspace publication guarded by taskId + generation + contentKey

Options surface
  -> provider settings and secret storage
  -> history/data-management repository operations
  -> BroadcastChannel + Web Locks destructive-operation coordination
```

`src/sidepanel/index.tsx` is a large orchestration boundary, but the audit found no correctness defect attributable solely to its size. Analysis and Ask use separate single-active controllers; workspace resets increment generations and clear visible state; task completions persist their captured source identity and only publish UI state when the current `contentKey` still matches.

Relevant evidence: `src/sidepanel/index.tsx:628-690`, `905-1233`, `1354-1612`; `src/features/analysis/lib/analysis-task-controller.ts:42-107`; `src/features/analysis/lib/ask-task-controller.ts:44-109`; `src/features/analysis/lib/analysis-task-lifecycle.ts:23-27`.

## 4. Security / Data Flow Map

```text
API key
  -> chrome.storage.local providerSecrets
  -> resolved only at request time
  -> Authorization: Bearer header to the selected provider
  -> redacted error surface

YouTube/Bilibili cookies
  -> browser-managed credentials on page/background fetches
  -> not read or persisted by the extension

Transcript/task data
  -> content script/runtime messages
  -> validated runtime schemas
  -> local transcript/cache/history stores
  -> user export JSON (sensitive URL issue described below)
```

The API key boundary is sound in the reviewed paths: profile metadata excludes the key, `providerSecrets` is separate, exports contain only `hasApiKey`, and the v2 migration removes legacy IndexedDB `apiKey` fields. Runtime and Bilibili messages are schema-validated and Bilibili transport is HTTPS/GET/allowlist constrained.

## 5. Findings — P0

**None identified.**

## 6. Findings — P1

### SEC-01 — Signed YouTube timedtext URL can be persisted and exported

- **Severity:** P1 — Release Blocker
- **Status:** Confirmed data-flow defect; runtime occurrence depends on a signed URL being supplied through the legacy/fallback track input.
- **Files / lines:**
  - `src/features/transcript/lib/fetch-vtt.ts:86-116`
  - `src/features/platform/youtube/youtube-adapter.ts:302-315`
  - `src/sidepanel/index.tsx:998-1011`
  - `src/sidepanel/index.tsx:1097-1105`
  - `src/features/history/lib/history-repository.ts:796-839`
  - `src/features/platform/youtube/youtube-adapter.test.ts:392-440`
- **Code evidence:** `fetchVtt` returns the exact request `sourceUrl`. `normalizeTranscript` copies that value into `transcript.raw.sourceUrl`. Side Panel writes it to both transcript cache and transcript snapshot. `exportLocalData` includes both stores in the JSON export.
- **Trigger / execution path:** YouTube page metadata exposes a caption track whose `baseUrl` contains signed query parameters; the live Resource Timing fast path is absent or fails; `fetchVtt` succeeds; the resulting `sourceUrl` is persisted and later exported.
- **Expected behavior:** Signed timedtext URLs, query signatures, `pot`/`potc`, expiry, and equivalent bearer material must not cross the persistence/export boundary.
- **Actual risk:** A short-lived URL that may authorize transcript retrieval is retained in IndexedDB and copied into a user-created export. It can also cross the validated transcript runtime response before persistence.
- **Impact:** Sensitive transcript access token leakage through local exports, backups, diagnostics or any later consumer of the persisted snapshot. API keys are not affected by this finding.
- **Minimum fix direction:** Redact or omit sensitive transcript URLs at the transcript normalization/persistence boundary, not only in the live timedtext branch. Prefer a stable source classification (`youtube-live`, `youtube-track`, `panel`, `dom`) or an allowlisted URL without credential-bearing query fields. Add a signed legacy-track regression test through `fetchVtt`, adapter persistence, and export.
- **Existing test coverage:** The live timedtext path is covered and correctly asserts `sourceUrl === null` and URL-free diagnostics. No equivalent test covers a signed URL in `metadata.tracks[].baseUrl` or export output.
- **Validation / uncertainty:** The persistence data-flow is confirmed from source. Whether a particular current YouTube response supplies a signed legacy `baseUrl` is runtime-input dependent and was not browser-smoke verified in this environment. That uncertainty does not remove the boundary defect: arbitrary URL-bearing transcript results are currently accepted and exported.

## 7. Findings — P2

### PERF-01 — Unbounded full-table scans in local history and QA paths

- **Severity:** P2 — Follow-up
- **Status:** Evidence-supported performance risk, not a correctness blocker.
- **Files / lines:** `src/features/history/lib/history-repository.ts:144-150`, `430-458`, `707-839`; `src/features/analysis/lib/qa-conversation-repository.ts:45-58`, `95-115`.
- **Code evidence:** Compatibility helpers use `toArray()` followed by JavaScript filtering. Recent-history listing materializes analysis runs, video records, caches, and then loads segment rows per run. QA message sequencing reads all messages before selecting one thread's last sequence. Export intentionally materializes every persisted store.
- **Trigger / execution path:** A long-lived local profile accumulates many transcript/cache/QA rows, then opens history, starts Ask, or exports data.
- **Expected behavior:** Bounded UI queries and predictable memory use; export may remain full-table by design but should be explicit about its cost.
- **Actual risk:** Latency and memory pressure grow with total local history; repeated calls can make the side panel feel stalled.
- **Impact:** Large local datasets only; no observed cross-video corruption.
- **Minimum fix direction:** Add indexed contentKey/run/thread queries and bounded `limit()` paths for interactive views. Keep full export as an explicit snapshot operation.
- **Existing test coverage:** Unit tests cover filtering and compatibility behavior, not realistic large-store timing or memory.
- **Validation / uncertainty:** No production-scale dataset was available; classify as performance debt only.

### PERSIST-02 — Clearing transcript cache is asymmetric for active Bilibili restoration

- **Severity:** P2 — Follow-up
- **Status:** Confirmed provider asymmetry; data remains recoverable through run-bound snapshots.
- **Files / lines:** `src/features/history/lib/history-repository.ts:266-300`, `532-550`; `src/sidepanel/index.tsx:519-522`.
- **Code evidence:** `getLatestTranscriptByContentKey` checks `transcriptCache`, then falls back to legacy `transcriptSnapshots` only for `youtube:` keys. Historical run loading separately resolves `analysisRun.transcriptSnapshotId`, including Bilibili.
- **Trigger / execution path:** Analyze a Bilibili part, clear only transcript cache, then reload the active workspace for that same `contentKey`.
- **Expected behavior:** The categorized operation clears reusable cache while preserving saved analysis snapshots consistently across providers.
- **Actual risk:** The active Bilibili workspace may show analysis without its preserved transcript and require a fresh remote transcript load; Ask is unavailable until transcript identity is restored. Historical run opening still has a direct snapshot path.
- **Impact:** Bilibili active-workspace UX and re-fetch cost; no evidence of snapshot deletion or cross-part mixing.
- **Minimum fix direction:** Add a contentKey-based transcript-snapshot lookup for all supported platforms, preferably with an index/query that preserves exact Bilibili part identity.
- **Existing test coverage:** Content-key cache and historical restoration tests exist, but no active-workspace test covers Bilibili after transcript-cache clear.
- **Validation / uncertainty:** Source-level behavior is clear; browser interaction was not run.

### DEP-03 — Duplicate transitive build toolchains and stale Browserslist data

- **Severity:** P2 — Follow-up
- **Status:** Dependency maintenance debt.
- **Files / evidence:** `package.json`; `bun.lock`; direct build output from local Plasmo.
- **Code evidence:** The installed graph contains multiple Parcel generations and nested TypeScript versions through Plasmo/Parcel. A production build also reported that `caniuse-lite` data was eight months old.
- **Trigger / execution path:** Dependency installation or production builds resolve the current lockfile graph.
- **Expected behavior:** A deliberately reviewed, reproducible toolchain with current browser-target metadata.
- **Actual risk:** Larger install/build surface and less predictable transitive compatibility; no application runtime defect was demonstrated.
- **Impact:** Build maintenance and supply-chain review effort.
- **Minimum fix direction:** Review the lockfile and toolchain as a separate dependency task; do not upgrade solely for version freshness.
- **Existing test coverage:** No dependency-graph or lockfile policy test.
- **Validation / uncertainty:** No vulnerability verdict was obtained because the configured npm mirror returned `404 [NOT_IMPLEMENTED]` for the audit endpoint; no claim of a clean vulnerability database scan is made.

## 8. Accepted Debt

- `src/sidepanel/index.tsx` is a high-coordination module, but taskId/contentKey/generation checks and controller boundaries prevent the principal stale-write paths found in this audit. Splitting it is not required for V1 correctness.
- Analysis and Ask tasks are intentionally scoped to the Side Panel lifetime. They do not survive Side Panel destruction, extension reload, or browser restart; this is documented V1 behavior in `TASK_STATE.md:213-214`.
- Finalizing is intentionally non-cancellable. The controller tests cover the fail-closed cancellation boundary.
- Web Locks serialize admission/destructive reservations; BroadcastChannel discovers and propagates work across Options/Side Panel surfaces. These roles are distinct and tested.
- UI locale is not passed as a model-language authority. Prompts use transcript evidence and explicit task contracts, so locale does not silently change answer language.
- Bilibili `bvid`/`aid`/`cid`/part checks and canonical `bilibili:<bvid>:p:<part>` identity prevent the reviewed multi-P stale-data paths.
- Required host permissions remain limited to the supported platform hosts. Provider origins and broad `https://*/*` are optional permissions in both source and generated MV3 manifest; they are not equivalent to required `<all_urls>`.
- No ASR, Vision, or audio-extraction path was added or required for V1.

## 9. Dependency Assessment

Runtime dependencies are appropriately separated from development/build dependencies in `package.json`: React/Dexie/Zod/UI packages are runtime; Plasmo, TypeScript, PostCSS, Tailwind and fake IndexedDB are development/test tooling.

No clearly unused direct dependency or unnecessary application-sized runtime dependency was proven from this static audit. The notable issues are transitive bundler duplication and stale Browserslist metadata, recorded as `DEP-03`.

Security database status:

- `npm audit --json --package-lock=false` was attempted on **2026-10-18 Asia/Shanghai**.
- The configured registry was `https://registry.npmmirror.com`; its audit endpoint returned HTTP 404 `[NOT_IMPLEMENTED]`.
- `bun pm audit` is not supported by the installed Bun 1.2.5 CLI.
- Therefore dependency vulnerability status is **UNKNOWN**, not clean.

## 10. Validation Results

| Command | Result | Evidence |
|---|---|---|
| `bun test` | PASS | 416 tests, 0 failures, 1,314 expectations, 65 files |
| `bun run typecheck` | NOT PASS | Bun wrapper failed before TypeScript: `CouldntReadCurrentDirectory` |
| `node_modules\\.bin\\tsc.exe --noEmit` | PASS | Direct project-local compiler completed successfully |
| `bun run build` | NOT PASS | Bun wrapper failed before Plasmo: `CouldntReadCurrentDirectory` |
| `node_modules\\.bin\\plasmo.exe build` | PASS | Plasmo v0.90.5 completed in about 7.95s and emitted the MV3 build |
| `git diff --check` | PASS | No whitespace errors |

The direct TypeScript and Plasmo commands were run in addition to the requested Bun scripts to distinguish project health from the wrapper/current-directory environment failure. The generated manifest was inspected after the direct build and matched the reviewed permission/content-script topology.

## 11. Browser Smoke Gaps

**NOT RUN.** No real browser/extension smoke session was executed in this audit environment. In particular, the signed legacy YouTube timedtext input path and the active Bilibili workspace after categorized transcript-cache clear remain unverified in a live browser.

## 12. V1 Release Readiness Decision

**RELEASE HOLD**

Minimum blocking set:

1. **SEC-01 (P1)** — stop signed YouTube timedtext URLs from entering transcript persistence/export, then add regression coverage for the legacy/fallback track path and export boundary.

After SEC-01 is fixed, rerun the full requested validation set and perform browser smoke focused on YouTube fallback, export inspection, Bilibili multi-part identity, and categorized clearing.

## 13. Recommended Narrow Follow-up Tasks

1. **SEC-01 remediation:** introduce one URL-redaction/normalization boundary shared by live, legacy, and panel transcript results; add persistence/export tests.
2. **PERSIST-02 test and query repair:** restore active Bilibili transcripts from preserved run-bound snapshots after cache clear without broadening deletion semantics.
3. **PERF-01 measurement:** add a synthetic large-store benchmark and replace interactive full-table scans with indexed/bounded queries where the measured data warrants it.
4. **DEP-03 supply-chain review:** choose a supported vulnerability database/registry, record the database timestamp, and review duplicate transitive toolchains without opportunistic upgrades.

