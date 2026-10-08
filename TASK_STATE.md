# TASK_STATE

- 最后完成：Task 2 — Platform abstraction / CR-02 follow-up
- 当前任务：Task 3 — Bilibili adapter（已完成，待提交发布）
- Task 2 状态：CLOSED / PASS（含独立复审）
- Task 3 状态：PASS（实现与最终门禁已通过；commit/push 待执行）
- Task 1 最终复审基线 HEAD：`b7d165bfa3104c6b0ec4a77c35d0e6ad61662476`
- Task 2 最终验证 commit：`daf41d7a2252df528f30202d3aa11beb3c74fc61` (`refactor: introduce platform adapter`)
- CR-02 follow-up commit：`9222f1cc555ed4ccc0611247884d985ea13ac07a` (`fix: prevent stale YouTube transcript binding`)
- Task 2 CR-02 独立复审：CLOSED / PASS；URL=B、stale bootstrap=A 时不会把 A 字幕绑定到 B。
- Chrome smoke：NOT RUN — environment limitation。Computer Use 在本轮再次初始化失败：`windows sandbox failed: helper_unknown_error: setup refresh had errors`；未加载扩展、未修改 Chrome、未伪造 smoke 结果。
- Task 3 已接入 Bilibili adapter、registry、runtime/content bridge、background allowlisted transport 与 Side Panel session-only 分析路径；最终 gates 已完成。

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

## Task 3 — Bilibili adapter

- URL scope：仅 `https://www.bilibili.com/video/BV...`；支持单P、多P、`?p=N`，不支持移动端、bangumi、b23.tv、watchlater、AV-only 或 ASR。
- Identity：同步生成 `bilibili:<BV>:p:<N>`；metadata 依据当前 `pages[].cid` 解析 `aid/cid`、标题、作者、当前分P时长与 thumbnail。
- Transcript：WBI player API 优先，失败后才使用 player-v2；字幕轨按中文人工、中文 AI、英文人工、英文 AI、其他排序；body 标准化为 `TranscriptSegment[]`，无字幕明确返回不可用错误。
- Chapters/seek/timestamp：读取官方 `view_points`，使用标准 HTML video seek，timestamp URL 保留当前分P。
- Transport：background 仅允许受限 HTTPS GET API/CDN allowlist，禁止任意 URL proxy；不读取、复制、存储或记录 Cookie/SESSDATA。
- Stale protection：异步 metadata/player/subtitle 结果校验 `contentKey`、当前分P和已解析 CID；P1→P2 旧响应丢弃。
- Persistence compatibility：采用方案 A；Bilibili 分析只保留当前 Side Panel session，不写入旧 `videoId`-only history；YouTube history 保持兼容。
- Final verification：`bun test` PASS（164 pass / 0 fail / 498 expect calls / 36 files）；`bun run typecheck` PASS；`bun run build` PASS（Plasmo chrome-mv3，普通权限曾因 `spawn EPERM` 失败，提升权限重跑通过）；`git diff --check` 与 `git diff --cached --check` PASS。
- Final Manifest：Manifest V3；Side Panel 存在；仅 Bilibili video 与 YouTube watch content scripts；包含 Bilibili API/CDN host permissions；无 `<all_urls>`、`nativeMessaging`、localhost/helper host permissions。
- Chrome smoke：NOT RUN — environment limitation。Computer Use 初始化失败：`windows sandbox failed: helper_unknown_error: setup refresh had errors`；未加载扩展、未修改 Chrome、未伪造 smoke 结果。
- Task 4 — Provider profiles：尚未开始。

## Completion gate

- Task 2 已在 `9222f1cc555ed4ccc0611247884d985ea13ac07a` 完成 commit + push，并通过独立复审；不存在待发布的 CR-02 follow-up。
- Task 3 — Bilibili adapter 的实现与验证已 PASS；当前仅待创建唯一 commit `feat: add bilibili adapter` 并 push `origin/main`。Task 4 — Provider profiles 尚未开始；发布完成后停止。
