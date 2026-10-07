# TASK_STATE

- 最后完成：Task 2 — Platform abstraction
- 当前任务：Task 2 — Platform abstraction / CR-02 re-review
- 状态：PASS（CR-02 已修复并重新验证；follow-up 修复已准备发布）
- Task 1 最终复审基线 HEAD：`b7d165bfa3104c6b0ec4a77c35d0e6ad61662476`
- Task 2 最终验证 commit：`daf41d7a2252df528f30202d3aa11beb3c74fc61` (`refactor: introduce platform adapter`)
- CR-02 follow-up 修复 commit message：`fix: prevent stale YouTube transcript binding`
- Task 2 CR-02 re-review：已基于最新工作树完成；下一步只发布上述 follow-up 原子修复。
- Chrome smoke：NOT RUN — environment limitation。Computer Use 在本轮再次初始化失败：`windows sandbox failed: helper_unknown_error: setup refresh had errors`；未加载扩展、未修改 Chrome、未伪造 smoke 结果。
- Task 3 尚未开始；本轮停止于 Task 2。

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
- 范围扫描：未发现 BilibiliAdapter、bilibili.com/api.bilibili.com/hdslb.com 可执行支持、`/models`、optional host permissions、key migration、ASR/Vision/Whisper 实现；测试中的 YouTube `kind=asr` 仅为既有字幕 track 元数据标记。
- Chrome smoke：NOT RUN — environment limitation；未将环境限制判为产品失败。

## Scope boundaries

- Task 2 仅实现 YouTubeAdapter；BilibiliAdapter 未实现。
- Task 4+ Provider key storage migration、Provider Profile、`/models`、optional host permissions，以及 ASR/Vision/Whisper 均未开始。
- Task 8 persistence contentKey migration 未开始。

## Completion gate

- 本文件已记录 Task 2 基线 commit、CR-02 原因/修复/回归结果和最终验证；下一步仅为发布并 push CR-02 follow-up 原子修复，然后停止等待指令。
