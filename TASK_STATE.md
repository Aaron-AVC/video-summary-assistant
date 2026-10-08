# TASK_STATE

- 最后完成：Task 4 — Provider profiles
- 当前任务：Task 4 — Provider profiles（CLOSED / PASS）
- Task 2 状态：CLOSED / PASS（含独立复审）
- Task 3 状态：CLOSED / PASS（最终 HEAD `419898ed093be2beb32c8e49c727d9e9b9d52841`，已实际 commit + push）
- Task 1 最终复审基线 HEAD：`b7d165bfa3104c6b0ec4a77c35d0e6ad61662476`
- Task 2 最终验证 commit：`daf41d7a2252df528f30202d3aa11beb3c74fc61` (`refactor: introduce platform adapter`)
- CR-02 follow-up commit：`9222f1cc555ed4ccc0611247884d985ea13ac07a` (`fix: prevent stale YouTube transcript binding`)
- Task 2 CR-02 独立复审：CLOSED / PASS；URL=B、stale bootstrap=A 时不会把 A 字幕绑定到 B。
- Chrome smoke：NOT RUN — environment limitation。Computer Use 在本轮再次初始化失败：`windows sandbox failed: helper_unknown_error: setup refresh had errors`；未加载扩展、未修改 Chrome、未伪造 smoke 结果。
- Task 3 已接入 Bilibili adapter、registry、runtime/content bridge、background allowlisted transport 与 Side Panel session-only 分析路径；CR-03 修复已通过独立复审，最终 HEAD 为 `419898ed093be2beb32c8e49c727d9e9b9d52841`。
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

- 状态：CLOSED / PASS（本地 commit `feat: add provider profiles`，当前 HEAD；Task 5 未开始）。`git push origin main` 于 2026-10-09 被远端凭据环境阻止：`SEC_E_NO_CREDENTIALS (0x8009030e)`；本地提交保留，未修改 Git credential/SSL/proxy 配置。
- Profile metadata 仅含 `id/name/baseUrl/model/createdAt/updatedAt`；UI 只额外投影 `isDefault/hasApiKey`。API key 仅在 `chrome.storage.local` 独立 secret map 中保存，编辑已有 Profile 时输入框保持空白，留空保留原 key。
- 旧 `yt-summarizer.provider.configs` 迁移为 metadata + secret map，迁移幂等、写入新副本后才移除旧 secret-bearing record；清除 Profile/clear-all 同步删除对应 secret、legacy settings、IndexedDB rows 与 transcript logs。
- Dexie 追加 v2 migration，providerConfigs metadata-only，并 scrub 历史 `apiKey` 字段；导出 sanitizer 与 combined data-management export 均不含真实 key、Authorization 或 Bearer token。
- Base URL 保留合法 path prefix；允许任意 HTTPS 与 loopback HTTP（localhost、127.0.0.1、IPv6 loopback），拒绝凭据、query、fragment、非 HTTP(S) 与非 loopback HTTP。Provider host 只通过 optional permissions 运行时按当前 origin 申请；Analyze/Ask 不静默申请权限。
- 共享 Provider transport 使用 `<baseUrl>/models`、`<baseUrl>/chat/completions`，每次 AI 请求显式发送 `model`，统一权限检查、超时、响应解析与错误脱敏；`/models` 失败、空列表或非标准 payload 仅提示手动输入，不阻止保存或聊天测试。
- 回归覆盖：metadata/secret separation、legacy migration/idempotence/failure safety、Dexie scrub、clear-all、URL safety、concrete host permission/denial、models 404/invalid/empty/network、explicit model、connection 401/404/malformed/network/timeout、sentinel redaction，以及 YouTube/Bilibili/CR-02/CR-03/transport/export regressions。
- Final verification：`bun test` PASS（186 pass / 0 fail / 563 expect calls / 37 files）；`bun run typecheck` PASS；`bun run build` PASS（Plasmo chrome-mv3 production build，Windows 普通沙箱 `spawn EPERM` 后按授权提升权限完成）；`git diff --check` PASS。
- Final Manifest：Manifest V3；required host permissions 保持 YouTube/Bilibili API/CDN；Provider 仅在 `optional_host_permissions`（HTTPS、localhost、127.0.0.1、IPv6 loopback）；无 `<all_urls>`、`nativeMessaging` 或 helper host permission。
- Chrome smoke：NOT RUN — environment limitation。Computer Use 初始化失败：`windows sandbox failed: helper_unknown_error: setup refresh had errors`；未加载扩展、未修改 Chrome、未伪造 smoke 结果。

## Scope boundaries

- Task 2 仅实现 YouTubeAdapter；BilibiliAdapter 未实现。
- Task 5 及之后能力、ASR/Vision/Whisper 均未开始；Task 4 Provider profiles 已完成。
- Task 8 persistence contentKey migration 未开始。

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

- Task 2 已在 `9222f1cc555ed4ccc0611247884d985ea13ac07a` 完成 commit + push，并通过独立复审；不存在待发布的 CR-02 follow-up。
- Task 3 `419898ed093be2beb32c8e49c727d9e9b9d52841` 已 commit + push，并通过独立复审；Task 4 已完成并发布。Task 5 尚未开始。
