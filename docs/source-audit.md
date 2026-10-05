# Task 0 — Source audit / baseline decision

- 审查日期：2026-10-05
- 审查范围：只读审查指定的三个 GitHub 源仓库；本项目没有修改产品代码。
- 目标：验证是否应以 `YouTube-Summarizer` 为基础，并确定 Bilibili 与双平台生命周期的安全借鉴边界。
- 复现原则：下表的 commit SHA 是本次审查使用的浅克隆快照；后续实现不应依赖浮动的 `main`。

## 1. 结论

### 基线决策：采用

```text
YouTube-Summarizer base
+
Bilibili adapter inspired by BiliScript
+
双平台生命周期 ideas from Video Digest
```

`YouTube-Summarizer` 是 V1 最合理的技术基底，但不是无条件整仓复制：它已经提供 Plasmo + React + TypeScript、Side Panel、字幕管线、OpenAI-compatible chat client、结构化分析/修复、Ask AI 时间引用和 Dexie 持久化这些与目标产品最接近的骨架。它同时包含 macOS/native helper、`nativeMessaging` 和 YouTube 专属命名/权限，这些不应进入 V1 的强制运行链路。

`BiliScript` 的价值集中在 Bilibili 适配器的纯 API/字幕/章节/当前分P处理，以及 Provider 权限与 key 分离的实现经验；它的 ASR、联网搜索、平台怪癖词表和完整阅读器产品范围明显超出 V1，因此只借鉴最小边界，不把它作为第二个产品基底。

`Video Digest` 的价值集中在平台识别、内容身份键、YouTube SPA/Bilibili SPA 生命周期、content script 与 Side Panel/Background 之间的消息链，以及时间跳转的测试思路；其 Codex/TraeWork bridge、Learning Pack 和本地工作区能力违反本项目的“运行时不得依赖 Codex”原则，不能复用到产品运行链路。

## 2. 审查快照、许可证与来源

| 仓库 | 本次快照 | 许可证 | 主要用途 | 来源 |
| --- | --- | --- | --- | --- |
| YouTube-Summarizer | `48eee570e82cf74d37fcdb546058429cba74357a`（`main`） | MIT，`LICENSE`，Copyright 2026 Kristjan Pikhof | 主基底、Side Panel、字幕、分析、Provider、Dexie | https://github.com/KristjanPikhof/YouTube-Summarizer |
| BiliScript | `25ddfeb81b61599f63fabcdabb3f197cdad11a92`（`main`） | MIT，`LICENSE`，Copyright 2026 haixiong1997 | Bilibili API、字幕轨、章节、分P、权限/Provider 经验 | https://github.com/Edmund724/BiliScript |
| Video Digest | `08d693b9bd02ffa7cb99d4cdbcca6ceda2b72d84`（`main`） | MIT，`LICENSE`，Copyright 2026 Zara Zhang；另有 `NOTICE.md` | 双平台检测、生命周期、消息与 seek 流程 | https://github.com/Alex-cloud0413/video-digest |

### 许可证与归属边界

- 三个直接审查的仓库都声明 MIT；如果未来复制实际源码，而不是只采用设计思想，必须保留对应版权声明与 MIT 条款，并在本项目 `THIRD_PARTY_NOTICES.md` 中列明来源 commit、文件范围和修改说明。
- `Video Digest/NOTICE.md` 说明它衍生自 `zarazhangrui/youtube-digest`。本项目目前只采用其平台生命周期思想，不复制其代码；若未来直接采用 `Video Digest` 的代码，必须同时核对并保留它及其上游的归属/许可证信息。
- 本 Task 没有将任何上游文件、图片、代码或依赖复制进本项目。

## 3. 各仓库结构审查

### 3.1 YouTube-Summarizer

#### 当前结构

- 根入口：`sidepanel.tsx`、`options.tsx`、`popup.tsx`、`background.ts`。
- 构建与框架：`package.json` 声明 Plasmo、React、TypeScript、Bun；脚本包含 `dev`、`build`、`typecheck`/`lint`、`test`。
- 功能分层：
  - `src/features/analysis/`：分析 UI、Prompt、结构 schema、OpenAI-compatible client、chunk、repair、Ask AI。
  - `src/features/transcript/`：DOM/panel/helper/VTT 获取、JSON3/XML/VTT 处理、cue 归一化和字幕日志。
  - `src/features/settings/`：Provider 表单、连接测试、设置存储和数据管理。
  - `src/features/history/`：历史分析与最近视频。
  - `src/features/youtube/`：视频 ID、页面元信息。
  - `src/lib/db/`：Dexie 数据库、schema、migration、quota guard。
  - `src/lib/runtime/`、`src/lib/schemas/`：运行时消息和持久化实体。
  - `src/contents/youtube-watch.ts`：YouTube watch 页 content script。
- 测试与源文件相邻，覆盖字幕解析/归一化、分析 schema、Provider、运行时消息、数据库迁移、历史和 YouTube metadata。
- `helper/` 是 Python/native host/yt-dlp 相关目录；`package.json` 还包含 macOS helper 安装、启动、停止和 doctor 脚本。

#### 已验证的可复用能力

1. **主产品壳**：Plasmo + React + TypeScript + Side Panel + Options 页面布局最接近本项目首期目标。
2. **字幕统一前的处理链**：`fetch-transcript-dom.ts`、`fetch-transcript-panel.ts`、`fetch-vtt.ts`、`parse-vtt.ts`、`normalize-cues.ts` 将不同来源收口为可用 cue，适合作为 `YouTubeAdapter` 的内部实现来源。
3. **结构化分析模型**：`analysis-schema.ts` 使用 Zod 验证 `summary`、`keyPoints`、`topics`、带 `startSec/endSec` 的 `segments/moments`，并定义 Ask AI 的 `citations` 与 `suggestedJumps`。这直接覆盖 V1 的“章节 + 概要 + 详细说明 + 可点击引用”目标。
4. **分析编排**：`run-analysis.ts`、`chunk-transcript.ts`、`repair-analysis.ts` 展示了单段/分块分析、最终归并、取消信号和一次修复思路；可作为 Task 5/6 的测试基线。
5. **OpenAI-compatible 请求形状**：`openai-compatible-client.ts` 对 `POST {baseUrl}/chat/completions`、Bearer key、JSON response、错误 envelope 和 `choices[0].message.content` 做了最小而清晰的抽象。
6. **Ask AI 引用安全化**：`ask-video.ts` 会把模型返回的 citation/jump 范围夹到 transcript cue 的连续区间；这是防止模型时间戳略微漂移的好起点。
7. **持久化组织**：`lib/db` 使用 Dexie migrations，将 Provider、transcript snapshot、analysis run、segment summary、recent video 分开存储；这个分层适合改造成跨平台/分P/指纹版本化的数据模型。

#### 需要改造或拒绝直接复用的部分

- `manifest` 包含 `nativeMessaging`，并对 `http://127.0.0.1/*` 和 YouTube 设置常驻 host permission；V1 不应把 native helper 作为必要运行条件，也不应把任意第三方 AI 域名写成 required host permission。
- `helper/` 的 macOS 安装脚本、Python native host、yt-dlp 不是 V1 的必需能力。V1 只处理用户已有字幕；不能因为字幕失败自动引入 ASR/helper 依赖。
- 当前 client 的核心 endpoint 是 `POST {baseUrl}/chat/completions`，没有把 `GET {baseUrl}/models` 作为可选能力；Task 4 必须新增“获取模型失败仍可手输 model ID”的分支，并处理 `/v1` 不重复拼接。
- `src/lib/schemas/persistence.ts` 的 Provider 持久化实体包含 `apiKey` 字段，不能原样带入本项目的数据模型。目标实现必须将 API key 与 Provider 元数据逻辑分离，key 优先只放 `chrome.storage.local`，日志/错误/遥测绝不能输出 key。
- 数据库名称和实体目前带有 YouTube 产品命名；Task 1/8 应在不破坏 migration 的前提下重新定义产品名、平台、part/cid 和 transcript fingerprint。

### 3.2 BiliScript

#### 当前结构

- `package.json` 使用自定义 Node/esbuild 构建脚本，包含 `typecheck`、Vitest、内容脚本构建和 release 构建。
- `extension/entry/`：background、content、offscreen、消息处理和生命周期入口。
- `extension/bilibili/`：`bili-api-shared.ts`、`gateway.ts`、`gateway-core.ts`、`video-id-shared.ts`、`video-probe.ts`。
- `extension/subtitle/`：`cache.ts`、`selection.ts`、`fetcher.ts`、`chapters.ts`、`commit.ts`、`core.ts`、UI。
- `extension/ai/`：OpenAI/Anthropic adapters、分析编排、schema 校验、JSON repair、map-reduce、模型目录、预算/缓存/streaming 等。
- `extension/core/`：Provider store、HTTP、host permission、运行时状态、消息、缓存和设置。
- `extension/reader/`、`extension/ui/`：较完整的阅读器/聊天产品，不是本项目首期的必要范围。
- `extension/asr/`、`extension/search/`：语音转写与联网搜索，明确超出 V1 的“无字幕时只告诉用户没有字幕、不调用 ASR”边界。

#### 值得借鉴的最小模块/思想

1. **Bilibili 标识与请求构造**：`bili-api-shared.ts` 的 `buildSubtitleInfoRequests` 以 `aid + cid` 优先访问 `https://api.bilibili.com/x/player/wbi/v2`，失败回退 `x/player/v2`，并可附带 `bvid`；这正对应当前分P字幕发现的核心路径。
2. **字幕轨选择**：`subtitle/selection.ts` 将 `lan`/`lanDoc` 归一，中文（含 AI 中文）优先，其次英文，再复用上次轨道 id/规范化 URL/语言；同时对字幕最大时间与视频时长做合理性校验。
3. **字幕下载与缓存边界**：`subtitle/fetcher.ts` 将元数据、字幕 bundle、subtitle body、缓存和“无字幕出口”分开；可借鉴其“接受字幕/无字幕都通过单一事务出口提交状态”的做法。
4. **官方章节**：`selection.ts` 的 `mapChaptersFromPlayerData` 从 player 数据的 `view_points` 归一章节。V1 需将其映射成统一 `NativeChapter`，并明确 AI 章节与官方章节的优先/并存策略。
5. **Bilibili 传输叶**：`gateway-core.ts` 将 `api.bilibili.com`、`*.hdslb.com` 等请求集中到纯传输层，并设置 Bilibili 请求 headers/referrer；这种叶子模块有利于避免把页面状态/缓存链拖入 MV3 service worker。
6. **Provider key 分离**：`core/provider-store.ts` 将 Provider 列表写入 `chrome.storage.sync`，将 API key 映射单独写入 `chrome.storage.local`，对 UI 只暴露 `hasSavedKey`。本项目应保留“逻辑分离”和“key 不进入同步/导出/日志”的不变式；存储位置最终以本项目的隐私审查为准。
7. **运行时域名权限**：`core/host-permissions.ts` 从 Provider `baseUrl` 提取 origin，去重后在一次用户手势中批量 `chrome.permissions.request`；这是实现 `optional_host_permissions` 的直接设计参考，但需要收紧 HTTP 规则为只允许 `localhost`/`127.0.0.1`。
8. **时间跳转**：`ui/timestamp-nav.ts` 体现了把模型答案中的时间文本转成可点击 seek action 的边界；本项目要把它接到统一 adapter，而不是复制 BiliScript reader 内部的具体 DOM 结构。

#### 不应直接带入的部分

- ASR/offscreen audio pipeline、`extension/asr/`、`extension/search/`、复杂 provider preset/compat-vocab、图片/工具调用、完整 reader/chat UI 都不是 V1 必需项。
- `manifest.json` 仍有大量 Bilibili/search required host permissions；本项目应单独评估 YouTube/Bilibili 平台 hosts 与 AI Provider optional origins，不能照抄权限表。
- BiliScript 的整体状态机和大量历史兼容注释很有价值，但直接合并会把其产品复杂度、命名和未来维护负担带入本项目；Task 3 只提取可测试的 adapter 边界。

### 3.3 Video Digest

#### 当前结构

- 纯 MV3 JavaScript 结构：`background.js`、`content.js`（YouTube）、`bilibili-content.js`（Bilibili）、`sidepanel.html/js/css`、`options.html/js/css`、`settings.js`。
- `platforms.js` 是平台核心：`detectVideoSource`、YouTube/Bilibili video identity 清理、Bilibili page number、`canonicalVideoUrl`、`timestampedVideoUrl`、`storageKey`。
- content script 负责页面内读取 metadata、字幕和 `seekTo`；background/side panel 通过 `chrome.runtime` 消息协作。
- `tests/` 覆盖平台检测、播放跟随、直接字幕、Bilibili subtitle JSON、当前分P绑定、timestamp seek 和相关设置。
- manifest 为双平台配置独立 content script，并通过 Side Panel + Background 连接；这种拓扑与目标产品的双平台生命周期很接近。

#### 值得借鉴

1. 用 `platform:videoId:part` 形式的稳定 `contentKey` 区分 Bilibili 多P，避免 transcript/analysis/cache 串片。
2. 对 YouTube SPA 的 DOM 变化、Bilibili 页面切换和 player 替换使用幂等初始化/observer/reconciliation，而不是只在页面第一次加载时读取一次。
3. 将 `getVideoInfo`、`getCurrentTime`、`seekTo` 等消息收口为页面侧能力；最终应改造成 `VideoPlatformAdapter` 的 `getInfo/getTranscript/seek/getNativeChapters`。
4. 将“当前页面/当前视频/当前分P”绑定加入自动化测试，特别是 stale page globals 不得污染当前字幕。

#### 不应复用

- `bridge/`、Codex/TraeWork、本地工作区 handoff 和任何要求用户安装/登录 Codex 的功能违反本项目运行时独立性。
- Learning Packs、creator workspace、搜索/知识管理功能与 V1 主链无关。
- Video Digest 是另一个产品的架构和视觉实现；只作为生命周期/测试思想来源，不作为代码基底。

## 4. 目标产品应吸收的共性与统一边界

### 4.1 统一领域模型

Task 2 应建立以下平台无关接口；平台特有字段放在 metadata/opaque fields，不能让 UI 直接依赖平台 DOM：

```ts
interface VideoPlatformAdapter {
  canHandle(url: string): boolean
  getVideoInfo(): Promise<VideoInfo>
  getTranscript(): Promise<TranscriptSegment[]>
  getNativeChapters(): Promise<NativeChapter[]>
  seek(seconds: number): Promise<number>
  subscribe?(listener: (event: PlatformVideoEvent) => void): () => void
}

interface VideoInfo {
  platform: "youtube" | "bilibili"
  videoId: string
  partId?: string
  title: string
  channelName?: string
  durationSec?: number
  canonicalUrl: string
  contentKey: string
}

interface TranscriptSegment {
  startSec: number
  endSec: number
  text: string
  language?: string
  source: "manual" | "auto" | "unknown"
}

interface NativeChapter {
  id: string
  title: string
  startSec: number
  endSec?: number
  source: "youtube" | "bilibili"
}
```

`contentKey` 至少要包含 platform、videoId 和 Bilibili 当前 part/cid；缓存和历史还要带 transcript fingerprint、schema version、provider/model 元数据。

### 4.2 Provider 统一边界

Provider Profile 以用户需求中的契约为准：

```ts
interface ProviderProfile {
  id: string
  name: string
  baseUrl: string
  model: string
  createdAt: number
  updatedAt: number
}
```

API key 不放在 Profile 的同步/导出对象里，单独写入 `chrome.storage.local`。保存 Provider 时：

1. 规范化 `baseUrl`，允许 `https://example.com` 与 `https://example.com/v1`，不能重复拼 `/v1`。
2. 从该 URL 提取 origin，只在用户保存/授权的用户手势中申请 `optional_host_permissions`。
3. HTTPS 第三方 endpoint 是正常路径；HTTP 只允许 `localhost`、`127.0.0.1`（必要时含端口）。
4. `GET {baseUrl}/models` 作为 best-effort 能力；失败只显示模型列表不可用，不能阻止手动输入 Model ID。
5. `POST {baseUrl}/chat/completions` 的 Test/Generate/Ask 共享同一 transport，错误信息必须经过脱敏，不能包含 Authorization、完整 API key 或原始 headers。

### 4.3 字幕与分析边界

- V1 只处理 YouTube/Bilibili 已有字幕；无字幕时明确返回“没有可用字幕”，不自动启用 ASR。
- 所有平台字幕都收口到 `TranscriptSegment[]`，分析 prompt 不读取平台 DOM 或 API 原始 payload。
- AI 输出必须经 schema parse、时间范围验证、与 transcript/视频时长校验；超出范围的 citation 可有限夹取，否则丢弃并给出可理解的错误。
- 长视频采用 `single-pass + chunk/map-reduce`，但所有 chunk/merge 结果都必须保留原始时间范围。

## 5. 风险与后续验证

| 风险 | 影响 | 后续验证/缓解 |
| --- | --- | --- |
| YouTube/YouTube SPA 页面结构变化 | 字幕 DOM/panel 读取失效、seek 失效 | Task 2 保留多路字幕读取与 adapter contract tests；Task 9 做 smoke matrix |
| YouTube timedtext/caption endpoint 的 token/URL 变化 | 获取字幕失败 | 仅依赖当前页面可观察数据；失败给出无字幕/读取失败，不把 yt-dlp 作为强依赖 |
| Bilibili WBI/player API 变化或权限/headers 要求变化 | 字幕轨、aid/cid、章节读取失败 | Task 3 固定纯函数请求构造测试、真实响应 fixture、当前分P stale-state 测试 |
| Bilibili 多P/SPA 切换 | cache/analysis 串片、seek 到错误分P | contentKey 包含 part/cid；每次 URL/player 变化重新绑定 adapter |
| 字幕 CDN/CORS/host permission | 能发现轨但下载失败 | 页面/Background 分层，最小 required hosts，Provider origins 单独 optional；错误分层保留原始 HTTP 状态但脱敏 |
| 任意中转站 `/models` 不实现 | 设置页把可用 Provider 判为失败 | `/models` 完全 best-effort；手动 Model ID 永远可用；Test Connection 只验证 chat/completions |
| API key 泄漏 | 严重隐私/费用风险 | key 只读写 `chrome.storage.local`；Profile metadata 与 key 分离；禁止日志、错误、导出、sync、遥测出现 key；Task 9 扫描 |
| 模型时间戳幻觉 | 点击跳转错误 | schema + cue range clamp + duration validation；Ask citation 无法对齐时丢弃并提示 |
| 上游许可证/通知遗漏 | 发布/合规风险 | Task 1 建立 `THIRD_PARTY_NOTICES.md`；任何代码复制先记录 source/commit/files/license/changes |
| 过早引入 ASR、搜索或 Codex bridge | V1 范围膨胀、违反运行时独立性 | Task 0 明确不复用；Task 9 dead-code/permission review |

## 6. 最终技术路线与任务映射

### Task 1 — Clean baseline

以 `YouTube-Summarizer` 的结构为参考建立本项目干净基线：重命名、移除 YouTube-only 文案、移除 V1 必需性之外的 macOS/native helper 依赖，保留可复用的 Provider/Side Panel/Dexie/analysis 基础，并新增 `THIRD_PARTY_NOTICES.md` 与 `TASK_STATE.md`。不实现 Bilibili。

### Task 2 — Platform abstraction

先定义 `VideoPlatformAdapter`、`YouTubeAdapter`、`VideoInfo`、`TranscriptSegment`、`NativeChapter`，把现有 YouTube 获取/metadata/seek 逻辑迁入 adapter；通过测试证明 YouTube 功能不退化。

### Task 3 — Bilibili adapter

以 BiliScript 的纯函数边界为灵感实现 `BilibiliAdapter`：BV/aid/cid、当前分P、字幕 track/body、官方 `view_points`、seek、SPA/分P切换。V1 不引入 ASR。

### Task 4 — Provider profiles

在 YouTube-Summarizer client 之上实现用户要求的正式 Profile、多个 Profile、默认 Profile、模型搜索/手填、`GET /models` best-effort、Test Connection 和 runtime optional host permission；按 4.2 的安全边界重写 key storage。

### Task 5 — Structured video analysis

将现有 Zod/analysis/Ask AI 思路改造成跨平台 `VideoAnalysis`：overall summary、key points、chapters、chapter summary/detail、timestamp、citation；加入 parse/normalize/一次 repair retry。

### Task 6 — Long-video pipeline

保留单次分析并加入 chunk/map-reduce；以 transcript segment 的原始时间范围作为不可破坏的坐标系，测试长视频 chunk 边界和合并结果。

### Task 7 — Side Panel product experience

实现 Overview/Transcript/Ask/Settings、loading/cancel/error/regenerate、timestamp click、active transcript highlight、transcript search、Provider/Model display。seek 只能经 adapter，不在 UI 中写平台分支。

### Task 8 — Cache/history hardening

加入 transcript/analysis cache、fingerprint、schema version、provider/model metadata、regenerate 语义及视频/分P导航清理；重点验证 `contentKey` 不串片。

### Task 9 — Final V1 review

只做验证不加功能：full test、typecheck、production build、Chrome unpacked smoke、YouTube/Bilibili matrix、权限/隐私/API key leak/license/dead code review，输出 `docs/v1-review.md`。

## 7. THIRD_PARTY_NOTICES 计划

Task 1 必须创建 `THIRD_PARTY_NOTICES.md`，至少包含：

- `YouTube-Summarizer`：MIT、作者、审查快照 `48eee570...`、实际复制的文件范围、修改说明。
- `BiliScript`：MIT、作者、审查快照 `25ddfeb...`、若复制纯函数/测试 fixture 则逐文件登记。
- `Video Digest`：MIT、作者、审查快照 `08d693b...`；若只采用架构思想，明确“无直接代码复制”；若复制代码，再追溯其 `NOTICE.md` 指向的 `zarazhangrui/youtube-digest`。
- 任何新增 npm 包、图标、字体、fixture 或代码片段的许可证和归属。
- MIT license 的保留文本或可追溯文件路径；不要只写仓库名称而不写版本/commit。

## 8. 停止条件

Task 0 的审查结论已完成，基线决策为“`YouTube-Summarizer` 为基底，BiliScript 为 Bilibili adapter 参考，Video Digest 为双平台生命周期参考”。本报告不授权自动开始 Task 1；下一步必须等待用户明确指令。