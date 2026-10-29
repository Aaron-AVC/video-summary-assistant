# TASK_STATE

## 当前状态 — RH-01 文档恢复候选审查（2026-10-30）

- 正式 `main` 当前 HEAD：`be93d1ac6a290cfc78bada7e6cef77d5775001e0`（本次修订前只读核验；本次操作未修改 `main`）。
- 恢复分支：`recovery/rh01-docs-20261029`。
- 已推送的恢复候选原有提交为 `145ea4e`（V1.1 文档整合）、`782bd76`（发布审计措辞修订）和 `f28c16e`（恢复候选审查修订）；本次状态与网络描述修订作为独立原子提交追加。
- 现有 PR #12 处于 Open 状态，尚未合并或打 tag；正式 `main` 未被本次操作修改。
- 五个目标文档仍仅为 `README.md`、`TASK_STATE.md`、`docs/persistence-cache.md`、`docs/reviews/2026-10-22-v1.1-release-readiness.md`、`docs/sidepanel-ux.md`；本次额外文字修订仅涉及前两份。
- 五文档独立审查：静态文档范围与内部表述总体通过；结论仅为“静态文档自洽，但实现未独立复核”，不构成源码审计或发布批准。
- RH-02 实站 Browser smoke 仍为 **NOT RUN**；V1.1 尚未获得正式发布批准。
- 下一步：等待 PR 独立审查与后续授权；不得将 PR 创建或文档审查通过视为合并/发布批准。

## RH-01 原始工作记录（2026-10-23；历史记录，保留原始证据）

- 状态：**文档整合与重新验证完成；本地原子提交已创建；等待独立审查。** RH-01 完成不代表 RH-02 完成，也不代表 V1.1 已可发布。
- 本地原子提交：`docs: integrate V1.1 documentation after REL-01 and revalidate gates`，父提交 `7f9923c22425e101b336dc7951b0ea01f3ce5399`，仅含下列五份文档。该提交只存在于本地工作分支，未推送、未创建 PR、未打 tag。提交 SHA 用 `git log -1 --format=%H` 在分支 `docs/rh-01-post-rel01-20261023` 上取得（本文件自身也在该提交内，故不内嵌会随提交变化的 SHA）。
- 新基线：`7f9923c22425e101b336dc7951b0ea01f3ce5399`（`Merge pull request #1 from Aaron-AVC/review/v1.1-release-blockers`）。`git rev-parse HEAD` 与 `git rev-parse origin/main` 在开工时均为该 SHA。
- 工作分支：`docs/rh-01-post-rel01-20261023`。
- REL-01 已合并，包含两个实现提交：
  - `c5127130e1a979e63e6840322afb49eb65a5ec97` — `fix: type the injected timeout scheduler boundary`（TS2769 定时器类型问题）。
  - `ca5a3152236f365d9db7056f813ab77f85de8aeb` — `fix: keep history restore and QA restore on their own display ownership`（History restore 与 QA restore 的陈旧发布竞态）。
- 本轮在合并后基线上真实执行的验证（全部在可写克隆 `D:\files\Video Summary Assistant\.rel01-work\repo` 内，`TEMP`/`TMP`/`TMPDIR` 均指向克隆内 `.buntmp`）。文档修改前、修改后、提交树三个阶段各完整执行一次，三次结果一致：
  - `bun install --frozen-lockfile` → exit 0，`Checked 630 installs across 690 packages (no changes)`。
  - `bun test` → exit 0，**1035 pass / 0 fail / 3161 expect() calls / 92 files**。
  - `bun run typecheck` → exit 0，无输出。
  - `bun run build` → exit 0，Plasmo v0.90.5，`DONE`。
  - `bun run package` → exit 0，`Zip Package size: 0.97 MB`。
  - `git diff --check` → exit 0，无输出。
  - 详细命令、退出码、产物哈希与证据来源见 `docs/reviews/2026-10-22-v1.1-release-readiness.md`。
- 文档变更范围：`README.md`、`docs/sidepanel-ux.md`、`docs/persistence-cache.md`、`docs/reviews/2026-10-22-v1.1-release-readiness.md`、`TASK_STATE.md`。未修改产品源码、`package.json`、`bun.lock`、Manifest 权限、DB schema 或 migration，未改版本号 `2026.8.22`，未生成 tag、未推送、未创建 PR。
- 遗留事项：Browser smoke 仍为 **NOT RUN — RH-02 required**；本轮未运行依赖/安全扫描；RH-01 初始审计记录的 P2 事项继续保留；已知残余并发面与未验证行为见审计文档第 7、8 节。下一步为 RH-02。

> 说明：以下 2026-10-19 及更早的条目是历史记录，保留原文以维持可追溯性。其中的测试数量（例如 V1 gate 的 `426 pass`）与发布结论**仅为 V1 历史数据**，不代表当前 V1.1 验证结果，也不得作为本轮证据复用。

## 历史记录（V1 及更早，仅供追溯；不作为当前验证结果）

- 当前任务：V1 Release Readiness；CLOSED / PASS；本次 closure 的基线 HEAD：`874bae094541b0d7fdc8399f21f29a881993b8f4`。发布验收证据已汇总于 `docs/reviews/2026-10-19-v1-release-gate-closure.md`。Codex/automated validation：SEC-01R1 最终报告为 `bun test` 426 pass / 0 fail，项目内 `tsc --noEmit` PASS，项目内 Plasmo production build PASS，`git diff --check` PASS；DEP-03R1 覆盖 45/45 OSV advisories，P0=0、P1=0。User-run real Chromium smoke：extension load、Side Panel、Options、YouTube transcript/search/timestamp、Analysis/Chapters/Ask/citation jump、Bilibili BV 与 multi-P identity isolation、history restore/categorized clear/clear all、i18n auto/zh-CN/en 与 cross-page sync、refresh/video switch/cancel/close side panel stability 全部 PASS；SEC-01 export boundary 与 v4→v5 browser migration smoke PASS。Independent review：原始架构审计及其 RELEASE HOLD / SEC-01 P1 作为历史证据保留且未改写；后续 SEC-01 与 SEC-01R1 修复、依赖安全复审及真实浏览器证据关闭该 blocker。旧任务条目中的 `Browser smoke: NOT RUN` 仅表示当时历史状态，不代表当前 V1 gate。
- CR-15 / CR-15R1 — i18n initialization and concurrent write ordering：CLOSED / PASS；最终代码提交：`f3388cac3f13bc1190d8eaf760b44988fb62c220`；已通过独立静态代码复审；revision synchronizer 先订阅再读取初始值，且同一 surface 的语言写入串行化；storage events 与用户变更不会被旧的异步操作覆盖，清理时移除监听并吞掉初始化读取失败；自动化测试与 typecheck/build/diff-check 为 Codex 报告结果；Browser smoke：NOT RUN — environment limitation。
- CR-14 — preserve live task phase when deduplicating Web Locks fallback：CLOSED / PASS；最终 commit：`e561c2aa488c36eb730b88785ca4a91ea9785ee5`。Analysis/Ask destructive task snapshots 与 Web Lock descriptors 共享稳定 `taskId`；合并时优先保留 live Broadcast phase/threadId，仅在没有对应 live snapshot 时保留 `phase = unknown` fail-closed fallback；未修改 DB、manifest permissions、provider、transcript acquisition 或既有 Web Locks admission/reservation 设计；Browser smoke：NOT RUN。

- Granular History Deletion / Data Management：CLOSED / PASS；已通过独立复审；未修改 DB migration、i18n、Provider transport、Analysis/Ask lifecycle、platform transcript acquisition 或 manifest permissions；Browser smoke：NOT RUN。
- 已加入 repository 级 `deleteAnalysisRun`、`deleteVideoData`、`clearQaData`、`clearTranscriptCache`、`clearAnalysisHistory`，均通过 Dexie rw transaction；单 run 删除保留 provider、transcript source/cache、videoRecord 与其他 run，contentKey 删除按 canonical identity 清理分析、Ask、transcript cache/snapshots、videoRecord 和兼容 history。
- Data 管理已改为独立的 Clear conversations、Clear transcript cache、Clear analysis history、Clear diagnostics、Clear all extension data 操作，每项使用独立双确认；inventory/export 覆盖 videoRecords、transcriptCache、analysisCache、qaAnswers、QA threads/messages 与 diagnostics。
- Recent/Full History 增加 per-run overflow actions；当前 Side Panel 删除当前 run/video 后会清理对应 analysis/Ask workspace，active matching task 时 fail-safe 阻止删除。
- 本轮不修改 DB migration、i18n、Provider transport、Analysis/Ask lifecycle、platform transcript acquisition 或 manifest permissions；Browser smoke：NOT RUN。
- 自动化验证：`bun test` PASS（369 tests / 0 fail / 1210 expect calls）；项目内 `tsc.exe --noEmit` PASS；项目内 `plasmo.exe build` PASS；`git diff --check` PASS；build manifest permissions 与 `package.json` 配置一致且未变化。

- 当前任务：CR-12D — clean answer citations + focused evidence ranges；实现完成，待追加 commit 并等待独立复审。
- 修复：Ask prompt 明确禁止 answer 内的脚注号、source ID、timestamp 引用和方括号引用；新增质量校验，检测 numeric inline citation residue 与超过 60 秒的过宽 citation，并通过现有唯一一次 structured repair 要求移除 inline markers、改用最小 transcript spans。30 秒为偏好上限，30–60 秒可接受；citation.text 继续只由 transcript 本地派生。
- Prompt policy 同时约束因果措辞，避免无证据的“根本原因”“唯一原因”“证明了”；`VIDEO_QA_PROMPT_VERSION` 从 `video-qa-v3` 升级为 `video-qa-v4`，旧 cache namespace 保留，schema version 不变。
- 未修改 DB migration、i18n、history deletion、Provider transport/timeout、Analysis/Ask lifecycle、platform/transcript acquisition、response_format、reasoning 字段、manifest permissions 或 broad refactor。
- 自动化验证：`bun test` PASS（363 tests / 0 fail / 1182 expect calls）；项目内 `tsc.exe --noEmit` PASS；项目内 `plasmo.exe build` PASS；`git diff --check` PASS；build manifest permissions 与 `package.json` 配置一致且未变化。
- Browser smoke：NOT RUN — environment limitation；本轮未运行真实浏览器 smoke，未伪造结果。

- 当前任务：Provider transport follow-up — avoid provider native JSON mode；实现完成，待追加 commit 并等待独立复审。
- 修复：移除 V1 OpenAI-compatible transport 对 `response_format`/native JSON mode 的依赖；Analysis、Ask、structured repair 继续通过 JSON prompt + 本地 parse/validation + 单次 repair 完成结构化输出。transport 只读取 `message.content`，不会把 `reasoning_content`、`reasoning` 或 `thinking` 当作 assistant 输出；`content` 缺失时明确报错。
- 未修改 Provider schema、timeout policy、cache/version、DB、manifest permissions、YouTube/Bilibili、字幕链路、Analysis/Ask lifecycle、map-reduce 算法或 prompt 内容边界。
- 自动化验证：`bun test` PASS（360 tests / 0 fail / 1160 expect calls）；项目内 `tsc.exe --noEmit` PASS；项目内 `plasmo.exe build` PASS；`git diff --check` PASS；build manifest permissions 与 `package.json` 配置一致且未变化。`bun run typecheck` 与 `bun run build` 在本机触发 Bun `CouldntReadCurrentDirectory`，已使用项目内等价命令完成验证。
- Browser smoke：NOT RUN — environment limitation；未伪造真实浏览器结果。

- 当前任务：Ask lifecycle/UI follow-up — implementation complete，待独立复审。
- 修复：新增单一 active Ask task controller，提交用户消息成功后立即清空输入；Ask 请求冻结 transcript/analysis/thread/provider identity，可跨 browser tab/context 继续执行；支持 answering/repairing/finalizing/cancelling 阶段、用户取消与 repair signal 传递、全局 active Ask banner；完成后始终写回原 thread/cache，仅在 workspace identity 仍匹配时更新当前 UI；Conversation History popup 与列表增加窄宽边界，避免横向溢出。
- 未修改 CR-12D citation quality、prompt/citation policy、DB migration/history deletion/i18n、AnalysisTaskController、Provider timeout、YouTube/Bilibili/transcript acquisition、manifest permissions 或 broad architecture。
- 自动化验证：`bun test` PASS（358 tests / 0 fail / 1152 expect calls）；项目内 `tsc.exe --noEmit` PASS；项目内 `plasmo.exe build` PASS；`git diff --check` PASS；manifest permissions unchanged。
- `bun run typecheck` 与 `bun run build` 包装命令在本机触发 Bun `CouldntReadCurrentDirectory`，已使用项目内等价命令完成验证。
- Browser smoke：NOT RUN — environment limitation；未伪造真实浏览器结果。

- 当前任务：CR-12A/B/C — Ask answer quality, citation provenance, and reference robustness；实现完成，待追加 commit 并等待独立复审。
- 修复：Ask prompt 以当前问题为中心，明确 discourse reference、因果证据边界与 transcript 优先级；provider 使用真实 chat roles 发送 bounded conversation history；structured repair 保留同一 history 与 grounding 约束。
- Citation provenance：忽略模型生成的 citation.text，按最终 clamp 后时间范围从 transcript cues 派生，进行 whitespace normalization、相邻重复 cue 去重、空 cue 丢弃与确定性长度限制；派生文本随 qaAnswers/qaMessages 现有持久化路径保存。
- Cache identity：Ask prompt version 从 `video-qa-v2` 升级为 `video-qa-v3`；旧 v2 identity 仍可读取且与 v3 分 namespace。Side Panel 使用 provider 实际发送的同一份 bounded history 计算 conversation fingerprint，避免重复裁剪漂移。
- 未修改 Provider/timeout、analysis lifecycle、YouTube/Bilibili/transcript acquisition、DB schema/version、V2、i18n 或 manifest permissions。
- 自动化验证：`bun test` PASS（353 tests / 0 fail / 1136 expect calls）；项目内 `tsc --noEmit` PASS；生产 Plasmo build PASS；`git diff --check` PASS；manifest permissions unchanged。
- `bun run typecheck` 与 `bun run build` 包装命令在本机触发 Bun `CouldntReadCurrentDirectory`，分别使用项目内 `tsc.exe --noEmit` 与 `plasmo.exe build` 完成等价验证。
- Browser smoke：NOT RUN — environment limitation；上一轮用户已确认 Ask 多轮 smoke，本轮未新增真实浏览器 smoke，未伪造结果。

- 当前任务：Task 11D — Ask transcript fingerprint authority；实现完成，待追加 commit 并等待独立复审。
- 修复：Ask 以实际当前 transcript cues 的 fingerprint 为唯一 transcript authority；modern analysis 与当前 transcript fingerprint 不一致时禁止 Ask；thread/history/cache identity 均绑定实际 fingerprint；active transcript reload 与 analysis-run 变化会使旧 Ask 结果失效且不污染当前 UI；historical run 继续按 run-bound transcript snapshot 恢复。
- 新增 `src/sidepanel/lib/ask-transcript-identity.ts` helper 及回归测试；Ask mismatch UI 显示 “Transcript changed since this analysis” 和 “Go to Overview”。未修改 Provider identity、analysis lifecycle、平台字幕、DB schema/version、i18n、history deletion、analysis algorithm 或 prompt 内容。
- 自动化验证：`bun test` 347 pass / 0 fail，`bun run typecheck` PASS，授权环境 `bun run build` PASS，`git diff --check` PASS，manifest permissions unchanged。
- Browser smoke：NOT RUN — environment limitation；未伪造真实浏览器结果。

- 当前任务：Task 11 CR-11 follow-up — Ask Conversation correctness；已完成实现，待追加 commit 并等待独立复审。
- 修复 suggested jump optional `reason` 持久化、冻结既有 thread 的 provider identity、transcript fingerprint thread 隔离，以及 Ask 进行中的 New chat/History 切换 race；未修改平台字幕、analysis task lifecycle 或 Provider timeout。
- 新增回归覆盖 optional suggested jump persistence、thread identity matching/provider A→B projection、in-flight conversation switching disabled；既有 conversation/cache/migration/export/clearAll 回归保持。
- 当前自动化验证：`bun test` 341 pass / 0 fail，`bun run typecheck` PASS，授权环境 `bun run build` PASS，`git diff --check` PASS，manifest permissions unchanged。
- Browser smoke：NOT RUN — environment limitation；未伪造真实浏览器结果。

- 最后完成：Task 8 — CLOSED / PASS（最终 HEAD `ac3fb3038df3e9af6a2a01fcbf430b4fd52bf1f3`）
- 当前任务：Task 9 — implementation complete / awaiting independent review
- Task 8 最终 HEAD：`ac3fb3038df3e9af6a2a01fcbf430b4fd52bf1f3` (`fix: restore latest active transcript cache`)
- Task 9 release-readiness changes: current V1 README, content-aware persistence/cache documentation, and current Side Panel architecture boundary documentation.
- Task 9 validation: 249 tests / 824 expect() calls, typecheck PASS, frozen-lockfile install PASS, clean build PASS in authorized environment after sandbox `spawn EPERM`, package PASS, production artifact secret/path scan PASS, `git diff --check` PASS.
- Browser smoke: NOT RUN — environment limitation. Browser binaries were detected, but no usable Computer Use/GUI automation tool was available in this session; no user profile was opened or modified.
- Task 2 状态：CLOSED / PASS（含独立复审）
- Task 3 状态：CLOSED / PASS（最终 HEAD `419898ed093be2beb32c8e49c727d9e9b9d52841`，已实际 commit + push）
- Task 1 最终复审基线 HEAD：`b7d165bfa3104c6b0ec4a77c35d0e6ad61662476`
- Task 2 最终验证 commit：`daf41d7a2252df528f30202d3aa11beb3c74fc61` (`refactor: introduce platform adapter`)
- CR-02 follow-up commit：`9222f1cc555ed4ccc0611247884d985ea13ac07a` (`fix: prevent stale YouTube transcript binding`)
- Task 2 CR-02 独立复审：CLOSED / PASS；URL=B、stale bootstrap=A 时不会把 A 字幕绑定到 B。
- Chrome smoke：NOT RUN — environment limitation。Computer Use 在本轮再次初始化失败：`windows sandbox failed: helper_unknown_error: setup refresh had errors`；未加载扩展、未修改 Chrome、未伪造 smoke 结果。
- Task 3 已接入 Bilibili adapter、registry、runtime/content bridge、background allowlisted transport 与 Side Panel 分析路径；CR-03 修复已通过独立复审，最终 HEAD 为 `419898ed093be2beb32c8e49c727d9e9b9d52841`。
- Task 4 已完成 Provider Profile、独立 API key secret map、legacy settings migration、Dexie secret scrub、optional provider host permissions、shared `/models`/chat/test transport、manual model fallback 与中央错误脱敏。

## Task 1 — Clean baseline

- 状态：PASS（独立复审 CR-01 修复后重新验证）
- CR-01：用户可下载的数据导出曾从 settings storage 与 IndexedDB providerConfigs 两条路径泄露明文 API key。
- 修复：新增白名单 Provider export DTO/sanitizer；settings 与 IndexedDB 导出只含非敏感 metadata，不导出 `apiKey`、Authorization 或 Bearer token。
- 兼容边界：内部持久化仍兼容现有 API key 读取；未提前实施 Task 4 的 key migration、Provider Profile、`/models` 或 optional host permissions。
- 回归测试：`src/features/settings/components/data-management.test.ts` 中 `excludes API keys from settings and IndexedDB provider exports` 专项测试通过（3 pass，8 expect calls）；sentinel 未出现在 settings 与 IndexedDB 导出 JSON，非敏感 name/baseUrl/model 保留。
- Task 1 修复 commit：`fix: exclude API keys from data exports`；Task 1 最终复审基线为上方 HEAD。

## Task 2 — Platform abstraction

### Implementation

- 新增平台领域层与运行时边界：
  - `src/features/platform/types.ts`
  - `src/features/platform/adapter.ts`
  - `src/features/platform/registry.ts`
  - `src/features/platform/persistence-compat.ts`
  - `src/features/platform/youtube/youtube-adapter.ts`
  - `src/features/platform/youtube/youtube-url.ts`
- YouTube 主链已接入 adapter：identity、VideoInfo、transcript normalization、seek、timestamp URL；background/content script/runtime 均通过 registry/resolver 使用 adapter。
- runtime contract 使用 namespace `video-summary-assistant/runtime`，active context 携带 `platform` 与 `contentKey`；YouTube contentKey 为 `youtube:<videoId>`。
- Side Panel 消费 normalized transcript segments，不解析 VTT；generic background 不手写 YouTube timestamp URL。
- YouTube desktop watch 支持范围由 adapter、Manifest content-script matches 和注入 matcher 共同约束为 `www.youtube.com/watch` 与 `youtube.com/watch`；Shorts 和 `m.youtube.com` 不进入半支持路径。
- SPA video A → B identity 刷新、registry resolution、manifest wildcard matcher、seek/timestamp、transcript normalization 均有回归覆盖。
- persistence 继续保留 videoId 兼容；未实施 Task 8 contentKey migration。
- `docs/platform-architecture.md` 已记录边界、运行职责与延后 migration。

### CR-02 — stale YouTube transcript identity

- 原因：YouTube SPA 切换后，URL identity 可能已是视频 B，但页面 bootstrap/player response 仍是视频 A；旧 `captionTracks`、`getTranscriptEndpoint` 和 panel bootstrap 会被错误地与 B identity 组合。
- 修复：`readPageMetadata()` 以 URL video ID 为当前 identity；只有 player response video ID 与当前 identity 一致时，才接受 caption tracks 和 transcript panel bootstrap。identity mismatch 或无法确认时清空这些 transcript-scoped metadata，继续安全 fallback。
- 回归测试：新增 metadata mismatch 测试；新增真实 `youtubeAdapter.getTranscript()` 的 stale A → current B 测试，确认不请求 A timedtext、不返回 A transcript，并可进入当前页面 DOM fallback；新增 A → B SPA transcript identity 测试并确认 `contentKey = youtube:<videoId>`。

### Final verification

- `bun test`：PASS — 129 tests，0 fail，347 expect calls，30 files。
- `bun run typecheck`：PASS。
- `bun run build`：PASS — Plasmo chrome-mv3 production build completed。
- `git diff --check`：PASS（修复 7 个 Task 2 文件的多余 EOF 空行后重新检查）。
- 最终 `build/chrome-mv3-prod/manifest.json`：Manifest V3；Side Panel 存在；YouTube watch content script matches 存在；无 Bilibili permission、`nativeMessaging`、helper localhost permission 或 `<all_urls>`。
- Task 1 CR-01 专项回归：PASS — `data-management.test.ts` 3 pass，8 expect calls。
- CR-02 专项回归：PASS — 20 targeted tests across metadata and YouTube adapter; stale A transcript was not returned for B.
- Task 2 当时的范围扫描：未发现 BilibiliAdapter、bilibili.com/api.bilibili.com/hdslb.com 可执行支持、`/models`、optional host permissions、key migration、ASR/Vision/Whisper 实现；测试中的 YouTube `kind=asr` 仅为既有字幕 track 元数据标记。
- Chrome smoke：NOT RUN — environment limitation；未将环境限制判为产品失败。

## Task 4 — Provider profiles

- 状态：CLOSED / PASS。原始 Task 4 commit `07c61fd139104b830f3fb41db9f9c4bd5370a864` 与 CR-04 follow-up 均已实际 commit + push；最终复审通过，最终 HEAD 为 `a4fb2a9a5daf82550294a477ce459dd4a637ccf3`。
- Profile metadata 仅含 `id/name/baseUrl/model/createdAt/updatedAt`；UI 只额外投影 `isDefault/hasApiKey`。API key 仅在 `chrome.storage.local` 独立 secret map 中保存，编辑已有 Profile 时输入框保持空白，留空保留原 key。
- 旧 `yt-summarizer.provider.configs` 迁移为 metadata + secret map，迁移幂等、写入新副本后才移除旧 secret-bearing record；清除 Profile/clear-all 同步删除对应 secret、legacy settings、IndexedDB rows 与 transcript logs。
- Dexie 追加 v2 migration，providerConfigs metadata-only，并 scrub 历史 `apiKey` 字段；导出 sanitizer 与 combined data-management export 均不含真实 key、Authorization 或 Bearer token。
- Base URL 保留合法 path prefix；允许任意 HTTPS 与 loopback HTTP（localhost、127.0.0.1、IPv6 loopback），拒绝凭据、query、fragment、非 HTTP(S) 与非 loopback HTTP。Provider host 只通过 optional permissions 运行时按当前 origin 申请；Analyze/Ask 不静默申请权限。
- 共享 Provider transport 使用 `<baseUrl>/models`、`<baseUrl>/chat/completions`，每次 AI 请求显式发送 `model`，统一权限检查、超时、响应解析与错误脱敏；`/models` 失败、空列表或非标准 payload 仅提示手动输入，不阻止保存或聊天测试。
- 回归覆盖：metadata/secret separation、legacy migration/idempotence/failure safety、Dexie scrub、clear-all、URL safety、concrete host permission/denial、models 404/invalid/empty/network、explicit model、connection 401/404/malformed/network/timeout、sentinel redaction，以及 YouTube/Bilibili/CR-02/CR-03/transport/export regressions。
- Final verification：`bun test` PASS（186 pass / 0 fail / 563 expect calls / 37 files）；`bun run typecheck` PASS；`bun run build` PASS（Plasmo chrome-mv3 production build，Windows 普通沙箱 `spawn EPERM` 后按授权提升权限完成）；`git diff --check` PASS。
- Final Manifest：Manifest V3；required host permissions 保持 YouTube/Bilibili API/CDN；Provider 仅在 `optional_host_permissions`（HTTPS、localhost、127.0.0.1、IPv6 loopback）；无 `<all_urls>`、`nativeMessaging` 或 helper host permission。
- Chrome smoke：NOT RUN — environment limitation。Computer Use 初始化失败：`windows sandbox failed: helper_unknown_error: setup refresh had errors`；未加载扩展、未修改 Chrome、未伪造 smoke 结果。

### CR-04 follow-up

- CR-04A 原因：Chrome extension match pattern 不允许按端口收窄；旧 permission pattern 包含 Base URL 端口。
- CR-04A 修复：permission pattern 现在只由 scheme + host 构成，Base URL 和实际 fetch 仍保留配置端口；回归覆盖 localhost、IPv4、HTTPS host、IPv6 loopback，以及 `permissions.contains()` / `permissions.request()` 不含端口。
- CR-04B 原因：Fetch models 路径复用了要求非空 `model` 的完整连接输入，导致新 Provider 必须先手填 model 才能发现列表。
- CR-04B 修复：新增只要求 `baseUrl` + `apiKey` 的模型发现输入；Fetch models 允许 model 为空。Profile 保存、Test connection、Analyze、Ask 的 model 必填边界不变。
- 本次修复验证与 Manifest 检查：已通过（`bun test` 188 pass、`bun run typecheck`、提升权限后的 `bun run build`、`git diff --check`）。CR-04 修复按追加原子提交 `fix: correct provider discovery permissions` 发布，并已通过独立复审。

## Scope boundaries

## Task 5 — Structured video analysis

- 状态：CLOSED / PASS。最终 HEAD `194e3c42adc8f104e842e5cbd324e7e86e8a145c`；CR-05 已通过独立复审。
- 基线 commit `0ae37a0df7909d25322ca7fae17a80ddc7a2a70a` 与 CR-05 follow-up 均已实际 push。
- Canonical fresh-analysis domain is strict `VideoAnalysis` with `summary`, grounded optional-timestamp `keyPoints`, and `chapters` containing `title`, `startSec`, `endSec`, `summary`, and `detail`.
- Task 5 added schema/prompt versions (schema v1 and then-current prompt v1), strict JSON object parsing, transcript/duration normalization, cue-boundary snap, sorting, deterministic dedupe, and no silent fake repair. Task 6 later upgrades only the prompt/runtime version to `video-analysis-v2`.
- Analysis and Ask AI each perform at most one same-provider/same-model structured repair retry; retry responses re-enter the same parse/validation/grounding pipeline. Abort and second-failure behavior are covered by tests.
- Legacy persisted `topics`/`segments`/`moments` remain behind an explicit compatibility projection; new chapter `detail` is persisted as a bounded optional field, with old rows reading `detail = summary`.
- Side Panel minimally renders Chapters with summary/detail and no fresh Topics dependency.
- `docs/analysis-architecture.md` records the contract and Task 6 boundary.
- Task 6 is recorded below; Task 7/8 capabilities were not started.
- CR-05 修复：timestamped chapter/key point ranges must overlap effective transcript evidence before clamp/snap; ungrounded ranges now raise a concise structured grounding error and enter the existing one-repair retry path.

## Task 6 — Long-video analysis pipeline

- 状态：CLOSED / PASS。最终 HEAD `964a176d356896b3c482a65449b8bb3e7afd551c`；Task 7 已完成实现并等待独立复审。
- 新增中央、确定性、provider-agnostic token heuristic：ASCII 使用保守 chars/token，non-ASCII 近似按 code point 计数，并包含 safety multiplier 与 chat/message overhead；不维护 model/tokenizer/context catalog。
- 新增中央 `AnalysisBudgetPolicy`：默认 16,000 context estimate、2,000 completion reserve、2,000 repair reserve；short/long 判定、chunk planner、reducer、final 与 repair 统一使用该 policy，测试可注入小预算。
- `VIDEO_ANALYSIS_SCHEMA_VERSION` 保持 `1`；`VIDEO_ANALYSIS_PROMPT_VERSION` 升级为 `video-analysis-v2`。
- 短 transcript 使用实际 direct prompt estimate；fit 时只发一次 canonical structured request，失败时最多一次 same-provider/same-model repair，不产生 map/reduce calls。
- 长 transcript 使用实际 timed map prompt 的 greedy cue-boundary packing；cue 顺序与内容恰好一次，不 split、不 truncate。单 cue 超预算时在任何 Provider call 前明确失败。
- Map 与 reduction 均为 sequential prose calls；所有 cue/summary evidence 均有独立 untrusted fence。Initial map summary 保留本地 chunk range；hierarchical reducer 只合并 adjacent nodes，range 由本地 child min/max union 生成。
- Final prompt 在发送前实际估算；超预算时按层 deterministic reduce，每层 node count 必须严格下降。无法合并任意 adjacent pair 时抛出 no-progress error，不无限循环或 silent truncation。
- Direct/final 共用 strict parse、Zod、完整原 transcript CR-05 grounding、duration clamp/snap/normalize 与 exactly-one repair helper；`rawResponse` 仍仅为最终 accepted structured response。
- `RunAnalysisResult` 增加 `strategy`、`initialChunkCount`、`reductionLevels`；`chunkSummaries` 仅保留 initial map results，中间 reduction nodes 不持久化。
- 同一个 resolved client、Base URL、API key 与 explicit model 用于 map/reduce/final/repair；同一 abort signal 传入每次调用，并在每阶段前检查，取消后不继续后续 calls。
- 回归覆盖：estimator/budget validation、short one-call、short repair、cue exactly-once/no-split/determinism、oversized cue、long N-map+final、one/multi-level reduction、no-progress bounded failure、map/reduction cancellation、timestamp/range preservation、injection fences、direct/map-reduce CR-05、duration 与既有 Task 1-5 regressions。
- Validation：`bun test` PASS（211 tests / 0 fail / 683 expect calls / 42 files）；`bun run typecheck` PASS；production build 与最终 diff/manifest gate 见本次最终报告。
- Chrome smoke：NOT RUN — environment limitation；本轮没有安全 fake Provider/browser harness，未使用真实付费 API，未伪造 smoke 结果。

- Task 7 已完成实现并等待独立复审；Task 8 及 ASR/Vision/Whisper 均未开始。Task 4 Provider profiles、Task 5 Structured video analysis 与 Task 6 Long-video analysis pipeline 已完成。
- Task 8 persistence contentKey migration 未开始。

## Task 7 — Side Panel V1 UX

- 状态：implementation complete / awaiting independent review。
- Side Panel 采用持久 current-video header 与可访问 Radix tabs：Overview（默认）、Transcript、Ask、Settings。tab state 与 runtime refresh 解耦；同一 `contentKey` 刷新保留 tab，identity 变化清除旧 analysis/transcript/Ask question/answer/error，并递增 generation、abort 当前 analysis。
- Overview 使用单一 canonical `VideoAnalysis` 投影 Summary、optional-timestamp Key Points 与 Chapters；正式 action 为 Generate analysis / Regenerate / Cancel，Provider 缺失时切换到 Settings。chapter `detail` 可见，untimed key point 不生成 Jump。
- Analyze 与 Transcript tab 共用 `loadCurrentTranscript()`；该 helper 复用 `FETCH_VIDEO_TRANSCRIPT`、捕获 requested `contentKey`、验证 runtime response，并在 YouTube A→B 或 Bilibili P1→P2 stale response 到达时拒绝展示。
- Transcript 可独立加载，不触发 analysis；提供本地 case-insensitive plain-text search、安全 React `mark` 高亮、受限 scroll area、identity-aware seek。原始 raw VTT 不存在时 Download VTT 保持 disabled，不从 normalized segments 伪造文件。
- Ask 移入独立 tab，保留 structured answer、citations、suggested jumps、follow-ups 与 runtime bridge seek；Provider / analysis / transcript 缺失时分别提供 Settings / Overview / Load transcript CTA。Ask 使用独立 generation guard，identity 变化后旧结果不会写回。
- Settings 直接复用 `ProviderForm`、`ConnectionTest` 与 `settingsStorage`；save/delete/default/model 变化通过 metadata-only callback 立即刷新 Side Panel 默认 Provider。已有 API key 从不映射进 React draft，继续只显示空输入与 `Saved key available`。
- 窄宽度默认单列，tabs 在约 320px 使用两列换行、约 420px 起四列；主要 cards/forms/buttons/model IDs/model text 使用 `min-w-0`、wrap 与 `overflow-wrap:anywhere`。全局最小宽度与 Side Panel surface 调整为 320px。
- 文档：新增 `docs/sidepanel-ux.md`，记录 tabs、state ownership、共享 transcript loader、identity reset、Settings 复用与 Task 8 边界。
- Tests：新增 Side Panel state/action/prerequisite、共享 transcript stale guard、Transcript search/highlight/injection、Overview/Ask/Transcript/Settings server-render integration、narrow tab layout，以及 Provider API-key draft boundary回归。
- Validation：`bun test` PASS（227 tests / 0 fail / 744 expect calls / 47 files）；`bun run typecheck` PASS；`bun run build` PASS（Plasmo chrome-mv3 production build，普通沙箱 `spawn EPERM` 后在授权环境完成）；`git diff --check` PASS。
- Production Manifest：Manifest V3；required permissions/hosts 与 Task 6 相同；Provider capability 仍只在既有 `optional_host_permissions`；无 `<all_urls>`、`nativeMessaging`、新 API/analytics hosts。
- Chrome smoke：NOT RUN — environment limitation。Computer Use skill 已检查，但本会话未暴露所需 `node_repl` / `@oai/sky` runtime；未加载扩展、未修改 Chrome、未伪造 smoke 结果。

## Task 3 — Bilibili adapter / CR-03 follow-up

- URL scope：仅 `https://www.bilibili.com/video/BV...`；支持单P、多P、`?p=N`，不支持移动端、bangumi、b23.tv、watchlater、AV-only 或 ASR。
- Identity：同步生成 `bilibili:<BV>:p:<N>`；metadata 依据当前 `pages[].cid` 解析 `aid/cid`、标题、作者、当前分P时长与 thumbnail。
- Transcript：WBI player API 优先，失败后才使用 player-v2；字幕轨按中文人工、中文 AI、英文人工、英文 AI、其他排序；body 标准化为 `TranscriptSegment[]`，无字幕明确返回不可用错误。
- Chapters/seek/timestamp：读取官方 `view_points`，使用标准 HTML video seek，timestamp URL 保留当前分P。
- Transport：background 仅允许受限 HTTPS GET API/CDN allowlist，禁止任意 URL proxy；不读取、复制、存储或记录 Cookie/SESSDATA。
- Stale protection：异步 metadata/player/subtitle 结果校验 `contentKey`、当前分P和已解析 CID；P1→P2 旧响应丢弃。
- Persistence compatibility：采用方案 A；Bilibili 分析只保留当前 Side Panel session，不写入旧 `videoId`-only history；YouTube history 保持兼容。
- CR-03 原因：active-context MutationObserver 每次刷新都会创建新的 page environment；旧缓存按 environment 键无法跨刷新复用，导致同一 BV 的 `/x/web-interface/view` 重复请求。
- CR-03 修复：metadata 改为按 `Document → bvid` 缓存；并发读取共享同一个 in-flight Promise，成功 metadata 可复用，rejected Promise 会驱逐；每次按当前 `pageIndex` 重新派生 page context/CID，保留 contentKey 与 CID stale protection。
- CR-03 回归：新增同文档重复读取、并发 dedupe、failure eviction、P1/P2 CID 派生、BV A/B 隔离测试；既有 P1 响应在切换 P2 后拒绝测试继续通过。
- Final verification：`bun test` PASS（169 pass / 0 fail / 509 expect calls / 36 files）；`bun run typecheck` PASS；`bun run build` PASS（Plasmo chrome-mv3，提升权限完成）；`git diff --check` PASS。
- Final Manifest：Manifest V3；Side Panel 存在；仅 Bilibili video 与 YouTube watch content scripts；包含 Bilibili API/CDN host permissions；无 `<all_urls>`、`nativeMessaging`、localhost/helper host permissions。
- Chrome smoke：NOT RUN — environment limitation。Computer Use 初始化失败：`windows sandbox failed: helper_unknown_error: setup refresh had errors`；未加载扩展、未修改 Chrome、未伪造 smoke 结果。
- Task 4 — Provider profiles：已完成，见下方 Task 4 记录。

## Completion gate

## Task 9 — Analysis task lifecycle

- 状态：implementation complete / awaiting independent review。
- Analysis now has an independent one-active-task controller. Its immutable task snapshot captures source tab, content identity, source metadata, provider profile identity, and start time without storing API keys. The task owns its AbortController and survives active-tab/workspace changes while the Side Panel remains open.
- RuntimeBridge exposes `activeTabId`; task transcript acquisition sends the captured `tabId` explicitly and accepts only a response matching both the captured source tab and task `contentKey`. A source-tab navigation or close during transcript capture fails closed instead of analyzing a different video.
- Workspace resets still clear current transcript/analysis/Ask display state, but no longer abort a running analysis task. Completed tasks always persist their own source metadata and refresh Recent analyses; they update the visible workspace only when it still shows the task source video.
- A compact global active-task banner is visible from any active tab and can cancel the task. A second Generate/Regenerate is rejected while another task is running. This scope intentionally does not survive Side Panel destruction, browser restart, or extension reload.
- Chrome smoke：NOT RUN — environment limitation；本轮仅完成代码与自动化验证，未伪造真实浏览器结果。

## Task 8 — Persistence / cache identity

- 状态：CR-06 follow-up / awaiting independent review；修复提交为 `fix: complete content-aware persistence identity`。
- v3 append-only Dexie migration 保留 v1/v2，新增 `videoRecords`、`transcriptCache`、`analysisCache` 与独立 `qaAnswers`；数据库名保持 `youtube-summarizer`。
- YouTube 与 Bilibili 以 `contentKey` 为权威身份，Bilibili P1/P2 独立持久化；legacy `videoId` rows 继续可读并保留兼容字段。
- Transcript fingerprint 使用版本化 canonical normalized cues 的 SHA-256；analysis/QA cache keys 使用稳定 canonical object + SHA-256，不含 API key、Authorization、display name 或 generatedAt。
- Generate exact cache hit 不调用 provider；Regenerate 绕过 cache 并追加 run；QA cache 读取后重新走 persisted schema validation，损坏 row 视为 miss。
- 新增迁移、fingerprint/cache identity、contentKey isolation、Bilibili part isolation、corrupt QA regression tests。

- Task 2 已在 `9222f1cc555ed4ccc0611247884d985ea13ac07a` 完成 commit + push，并通过独立复审；不存在待发布的 CR-02 follow-up。
- Task 3 `419898ed093be2beb32c8e49c727d9e9b9d52841` 已 commit + push，并通过独立复审；Task 4 已完成并发布；Task 5 已完成并发布。

## Task 10 — Analysis task lifecycle race follow-up

- 状态：implementation complete / awaiting independent review；追加修复提交为 `fix: close analysis task lifecycle races`。
- Regenerate 只绕过 analysis cache，不再把 analysis force 误传为 transcript reload；已有 session/IndexedDB transcript 继续优先复用，显式 Reload transcript 仍走 force remote path。
- Completion timestamps now distinguish task start, transcript capture, and actual post-provider completion. Completed analysis metadata uses the completion timestamp for `completedAt`/`analyzedAt`/`updatedAt`; task start remains the consistent creation/open time.
- Added `finalizing` phase after the last abort check. Local completed-result persistence is non-cancellable once finalizing begins; the banner and Overview toolbar show Saving analysis and disable Cancel.
- Added lifecycle policy, completion-clock, workspace-publication, finalizing-cancel, and regenerate transcript-reuse regressions. No platform, provider-timeout, subtitle, Ask history, or analysis-algorithm changes.
- Chrome smoke：NOT RUN — environment limitation；未加载扩展、未修改 Chrome、未伪造 smoke 结果。
