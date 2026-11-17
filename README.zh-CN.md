# Video Summary Assistant

**简体中文 | [English](README.md)**

Video Summary Assistant 是一款**本地优先的 Chromium Manifest V3 视频总结扩展**，适用于具有可用字幕的 YouTube 与哔哩哔哩视频。它把字幕转换为结构化总结与可跳转的时间戳，还能基于当前分析进行 AI 问答、保存书签和笔记、检索本地资料，以及导出 Markdown。

## V1.1 已实现的功能

- **支持的视频**：桌面 YouTube `youtube.com/watch`（含 `www`）与 `www.bilibili.com/video/BV...`，支持部分多 P 视频按 `?p=N` 区分。
- **总结与导航**：摘要、要点、章节、字幕搜索和时间戳跳转；全局分析预设 Standard / Concise / Detailed。
- **Ask Video**：围绕当前选中的分析与对应字幕提问，保存本地对话历史；不支持跨视频问答。
- **书签与笔记**：当前时间点书签、无锚点笔记和附带当前播放时间的笔记，按精确视频 `contentKey` 保存。
- **本地搜索**：当前已加载的视频内容、历史分析、书签/笔记和 Ask 对话；暂不检索其他视频保存的完整字幕。
- **Markdown 导出**：将当前视频的指定内容复制到剪贴板或下载 `.md` 文件。
- **Provider**：自行配置兼容 OpenAI 的 Chat Completions API、模型 ID 和 API Key；远程 HTTPS 与本机调试用 loopback HTTP。
- **持久化与设置**：本地 IndexedDB 缓存/历史；侧边栏 Overview、Transcript、Ask、Search、Settings 五个标签；Options 页包含 Provider、Appearance、History、Data 和 Advanced；界面可选自动、英文或简体中文。

## 基本使用

1. 打开受支持的桌面视频，确认平台提供可用字幕，然后打开扩展 Side Panel。
2. 在侧边栏 Settings 或 Options 中添加 Provider Profile：名称、API Base URL、明确的 Model ID 和 API Key。
3. 使用 Generate 生成或复用完全匹配的总结缓存；Regenerate 会重新生成并保留以前的分析。
4. 在 Overview 查看总结、添加书签/笔记并导出 Markdown；Transcript 支持字幕查找和跳转；Ask 针对当前分析提问；Search 查找设备中的历史内容。

模型列表 `GET /models` 仅为尽力而为，失败时仍可手动指定模型；Test Connection、Analyze 和 Ask 使用 `POST /chat/completions`。Provider 主机权限仅在用户显式保存 Provider、获取模型或测试连接时申请。

## 数据与隐私

字幕、分析、缓存、历史、Ask 会话、书签及笔记保存在本地 IndexedDB；Provider 元数据与 API Key 的独立秘密映射位于 `chrome.storage.local`。API Key 不进入设置/数据库导出、缓存身份、历史或诊断日志。

扩展只向用户配置并授权的 Provider 发起所需 AI 请求；字幕获取需访问视频平台。没有账户系统或云同步。兼容性数据库名 `youtube-summarizer` 为保留旧数据而沿用，不应因名称不同而删除或重建。

## 安装与本地开发

项目的 `packageManager` 固定 Bun `1.2.5`。

```sh
bun install --frozen-lockfile
bun test
bun run typecheck
bun run build
bun run package
```

安装解压版：执行 `bun run build`，在 Chrome/Chromium 的 `chrome://extensions` 或 Edge 的 `edge://extensions` 开启开发者模式，选择「加载已解压的扩展程序」，指向 `build/chrome-mv3-prod`，再打开支持的视频与 Side Panel。正式的浏览器 Smoke 应使用**隔离的临时浏览器配置**。

## 已知限制

- 没有可用字幕时不会自动 ASR / Whisper 转写；Bilibili 字幕获取会受视频、地区及浏览器会话影响。
- 当前只覆盖前述桌面视频地址；尚不支持 YouTube Shorts、哔哩哔哩番剧、移动网页或 Firefox。
- Search 使用本地 NFKC、大小写归一化、空白分词 AND、纯子串匹配，结果最多 50 项；暂无历史字幕全文检索、模糊匹配与语义搜索。
- Markdown 导出仅针对身份匹配且已打开的视频；目前没有 PDF/Notion 等其它格式。
- 笔记 UI 只创建当前时间点锚点或无锚点笔记；底层 Schema 虽支持区间字段，当前 UI 未提供区间选择编辑器。
- 长视频可能顺序调用多次模型 API，费用由配置的 Provider 决定；暂无播放列表批处理、跨视频 Ask、云同步或可选 ASR。

## 当前进度与未来计划

截至 2026-11-17，V1.1 核心功能已实现，RH-01 PR #12、RH-02 PR #13、Issue #14/#15 的联合修复 PR #18 均已合并。文档审计所用正式基线为 `859683b482a0b3e1d09a12369ceeb7e2af4e7236`。PR #18 的集成测试记录为 1,387 pass、TypeScript 和生产构建通过；这不是新的商店发布验收。

审计时 GitHub 暂无 Release；`build` / `package` 不会自动发布到 Chrome Web Store 或 Edge Add-ons。对外发布需针对拟发布提交另行核对打包、安全/依赖检查及真实浏览器 Smoke。

- [未来功能路线图、候选优先级和状态](docs/roadmap.md)
- [单功能开发计划与进度记录规范](docs/feature-plans/README.md)
- [文档索引（现行说明 / 历史快照）](docs/README.md)
- [现有里程碑历史](TASK_STATE.md)
- [第三方代码与署名](THIRD_PARTY_NOTICES.md)

中英文 README 应随任何用户可见功能和发布状态的变更同步修订。
