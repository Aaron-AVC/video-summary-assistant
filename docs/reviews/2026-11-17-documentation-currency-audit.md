# Documentation currency audit — 2026-11-17

**Baseline:** `Aaron-AVC/video-summary-assistant@859683b482a0b3e1d09a12369ceeb7e2af4e7236` (`main` before documentation changes). **Scope:** documentation-only; no runtime code, tests, permissions, dependencies, DB schema/migrations, or release changes.

## Findings

| File | Finding | Action |
| --- | --- | --- |
| `TASK_STATE.md` | 2026-10-30 RH-01 / PR #12 still described as "current" | Add current dated block, label old block historical, retain original logs |
| `README.md` | Missing RH-01/RH-02/PR #18 outcome and planning navigation | Update release-stage wording and Chinese README link |
| `docs/persistence-cache.md` | Missing production export row-limit and `recentVideos` validation | Add explicit boundary contract |
| `docs/design/2026-10-19-v1.1-sidepanel-decomposition-design.md` | Earlier controller-stage proposals and line numbers can be mistaken for current status | Mark as historical design snapshot |
| `docs/reviews/2026-10-22-v1.1-release-readiness.md` | Historical release gate numbers could be misread as current approval | Add a scope banner without changing historical measured data |
| Feature tracking | No durable roadmap/approved-plan/progress convention | Add `docs/roadmap.md`, plan template, status rules, and candidate F-001 |

## Evidence inspected

- GitHub PR #12, #13 and #18 were merged before the audit; Issue #14/#15 closed.
- Live `src/sidepanel/index.tsx` imports dedicated workspace, transcript, history, analysis, Ask, search and knowledge controllers, unlike the older design's proposed stages.
- `src/features/history/lib/history-repository.ts` contains `persistenceExportSchema.parse(exportPayload)` and `recentVideoSchema.parse(recentVideo)` in the relevant branches.
- Current README, Side Panel, persistence and platform/provider/analysis documentation reviewed for consistency; no speculative rewrite of stable product contracts.
- GitHub Release listing was empty. The user-supplied integrated PR #18 gate reported 1,387 passing tests, typecheck and production build. No new packaged-artifact, dependency/security or browser Smoke run has been performed for this documentation candidate.

## Documentation acceptance

Review the changed-path whitelist, links, English/Chinese product scope, F-ID and status vocabulary, candidate-vs-approved distinction, and `git diff --check`. Unit tests, typecheck and build remain `NOT RUN` for this documentation-only branch unless executed separately. Historical test counts and audits must remain intact.
