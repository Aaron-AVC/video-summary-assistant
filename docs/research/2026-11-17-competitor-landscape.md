# R-003 — 竞品研究：视频总结扩展定位与功能差距

- **研究日期**：2026-11-17。
- **本项目代码基线**：`Aaron-AVC/video-summary-assistant@fd2b09caf9b7a680f31430f80aba777bd93a5348`。
- **研究方式**：本项目现行文档与搜索仓库源码 + 竞品官方站点、Chrome Web Store 文案、BiliScript GitHub `main` README。
- **证据阶段**：**DESK RESEARCH COMPLETE / REAL-APP BENCHMARK NOT RUN**。本文件所述外部产品功能是官方公开宣称，不是同样视频和账号环境下的独立实测。
- **目标**：为个人使用场景决定 V1.2 的优先级；此阶段不申请对外发布、不安装第三方扩展、不提交任何产品代码。

## 1. 本项目 V1.1 已实现的基线（代码/契约核对）

- 支持桌面 YouTube watch 与 Bilibili BV / 指定 P；`contentKey` 中包含 Bilibili 分 P。
- 基于可用字幕做概要、要点和章节，以及与当前分析和字幕绑定的 Ask；保存本地会话。
- 本地 Analysis Preset（Standard / Concise / Detailed）、Provider Profile、OpenAI-compatible 自定义 HTTPS API 与本机 loopback 调试。
- IndexedDB 历史、内容感知缓存、书签/时间点笔记、按视频身份删除、Markdown 导出。
- 本地 Search 从当前运行时内容、已保存分析、知识条目和 Ask 会话中读取候选；仓库 `src/features/search/lib/search-repository.ts` 的候选表明确**没有**历史 `transcriptCache`，因此其他视频的完整字幕暂不可搜索。
- 截至本基线，没有 UI 字幕区间笔记、跨视频 Ask、自动 ASR、字幕手动输入、自定义总结输出语言选项。
- 发布状态：仓库私人、尚无 GitHub Release；此前的测试通过情况属于各自明确的合并候选，并非以下第三方插件的实测。

## 2. 最接近的公开竞品与正式来源

| 产品 | 官方披露的主要能力（仅宣称） | 典型对比意义 | 官方来源 |
| --- | --- | --- | --- |
| **BiliScript** | Bilibili 字幕精读/双语、转写、AI 章节、划词问答、关键帧、多模态、实时音画伴看；可用 OpenAI/Anthropic/Gemini 协议和自配 API | Bilibili 功能广度、无字幕处理、交互深度；仅单站支持描述 | [GitHub README](https://github.com/Edmund724/BiliScript#readme) |
| **Glasp** | YouTube 及网页/PDF 阅读高亮、可选输出语言、AI 问答、带时间戳字幕标注、Notion/Obsidian/Markdown/CSV 等导出 | 知识复用、资料出口和上手体验；有独立账户和不同 AI 配额 | [YouTube Summary](https://glasp.co/youtube-summary)、[Pricing](https://glasp.co/pricing) |
| **Eightify** | YouTube 快速总结、时间戳、40+ 语言、定制重点、字幕增强；商店文案提供 7 天免费试用和后续订阅 | 易用性、第一条总结耗时、语言支持；并非免费 BYOK 产品 | [Chrome Web Store](https://chromewebstore.google.com/detail/eightify-ai-youtube-summa/cdcpabkolgalpgeingbdcebojebfelgb) |
| **Video Flow** | YouTube/Bilibili、原文/中文/双语字幕、AI 概览/章节、划词解释和时间戳笔记、Chrome 本地存储 | 双平台 + 笔记已存在直接对手；商店披露更新于 2026-11-09 | [Chrome Web Store](https://chromewebstore.google.com/detail/video-flow/aoedmdjacbdcfoljcehedcdoplndihdn) |
| **YouTube Bilibili AI Summarizer** | YouTube/Bilibili/通用 HTML5、BYOK/本地模型、SRT/VTT/粘贴字幕、自定义语言和 Prompt、Markdown、本地历史选项 | 双平台 + BYOK + 本地优先也不是独有组合；无字幕回退设计值得参考 | [Chrome Web Store](https://chromewebstore.google.com/detail/youtube-bilibili-ai-summa/beldipifadjpkcohpbmlncgefmnjfcmo) |

**证据注意**：以上均来自官方产品描述，不能推出“在任何视频上都稳定可用”，也不能将平台没有明确介绍的能力视作“不支持”。竞品价格或套餐配额只按对应官方页面被检查时的口径记录，不跨不同模型和套餐比较单次费用。

## 3. 功能对照：已核实的“现有产品能力”与“竞品宣称”

表中的 `已实现` 来自本仓现行源码/文档；`宣称` 为外部官方资料；`未核验` 表示还没有可靠证据，不等同于缺失。

| 功能维度 | 本项目 V1.1 | 已见竞品宣称 | 初步判断 |
| --- | --- | --- | --- |
| YouTube + Bilibili | 已实现 | Video Flow、YouTube Bilibili AI Summarizer 宣称 | **双平台并非独特卖点** |
| BYOK、自选兼容 API | 已实现 | BiliScript、YouTube Bilibili AI Summarizer 宣称 | 需要用权限、配置便利性和成本体现差异 |
| 结构化总结、时间戳跳转 | 已实现 | 五个竞品均宣称相关能力 | 属成熟品类的基本要求 |
| 问答、来源引用 | 当前视频已实现 | BiliScript、Glasp 等宣称视频问答 | 应比较引用准确率，不只看“有无” |
| 本地历史和知识条目 | 已实现 | Video Flow、Glasp、YouTube Bilibili AI Summarizer 有不同形式 | 关注完整度与导出删除语义，不把隐私宣称直接当作验证 |
| 字幕区间高亮和文字注释 | 目前 UI 未实现 | Glasp、Video Flow、BiliScript 均有相近能力 | F-002 有现实用户价值，但不属于独创功能 |
| 输出语言独立于视频语言 | 当前无独立选项 | Glasp、Eightify 等宣称 | F-003 是明显的使用体验补缺 |
| 无字幕回退/手动导入 | 当前无 ASR 或手动导入 | BiliScript 宣称 ASR；另一双平台 BYOK 产品支持粘贴字幕 | 优先评估低权限的 F-005，而非直接上 ASR |
| 历史视频完整字幕检索 | 本项目未实现 | Glasp 宣称搜索已保存内容；其精确字幕跨视频覆盖待验证 | F-001 仍值得个人知识库场景试验 |
| 性能、错误率、引用精准度 | 缺少横向实测 | 竞品宣传数字与本项目测试不可直接比 | **本轮不发布胜负排序** |

## 4. 对产品方向的阶段性推论（待实测验证）

1. **不以双平台和 BYOK 单独定义差异化**：市场已经出现两项组合均相近的公开产品。我们的目标场景应缩小为“可追溯的本地个人视频研究”。
2. **先评估高频日常缺口**：F-003 输出语言控制和 F-005 手动字幕导入，可能比复杂跨视频 AI 知识库更快改善现有体验；真实优先顺序要看样本中的实际痛点。
3. **长期壁垒偏向可追溯知识复用**：F-001 让保存的字幕重新被找到，F-002 让引用片段成为带时间戳的个人笔记；避免为了模仿竞品而扩张到直播伴看或多模态 Agent。
4. **可靠性是候选优势，不是已证明优势**：已为缓存、Schema、生命周期、Bilibili P1/P2 设计回归，但与竞品在实站使用中的胜负需要按同一视频样本核验。
5. **成本不能用“BYOK 免费”描述**：BYOK 免本项目订阅费用，但第三方 Provider 可能计费；竞争方的订阅制与 BYOK 需要分开统计。

## 5. 待执行的真实使用评测

按 [测试协议](video-benchmark-protocol.md) 选取 18 类视频/环境，分别进行字幕、摘要、Ask、跳转、历史、笔记和费用的操作测试。测试使用隔离浏览器配置，不上传现有私人历史记录或实际 API Key；订阅/登录能力如未授权，标为 `NOT TESTED — ACCOUNT/PLAN`。

[结果模板](video-benchmark-results-template.md) 保留每项证据、失败截图索引及逐次操作日志。不在真实执行前填入成功率、平均响应时长、引文正确率或综合排名。

## 6. 核心依据

### 本项目

- [V1.1 产品说明](../../README.zh-CN.md)
- [Side Panel UX](../sidepanel-ux.md)
- [持久化/缓存契约](../persistence-cache.md)
- [搜索候选实现](../../src/features/search/lib/search-repository.ts)
- [候选功能路线图](../roadmap.md)

### 外部来源（按 2026-11-17 查阅时网页内容）

- [BiliScript GitHub README](https://github.com/Edmund724/BiliScript)
- [Glasp YouTube Summary](https://glasp.co/youtube-summary)
- [Glasp Pricing](https://glasp.co/pricing)
- [Eightify Chrome Web Store](https://chromewebstore.google.com/detail/eightify-ai-youtube-summa/cdcpabkolgalpgeingbdcebojebfelgb)
- [Video Flow Chrome Web Store](https://chromewebstore.google.com/detail/video-flow/aoedmdjacbdcfoljcehedcdoplndihdn)
- [YouTube Bilibili AI Summarizer Chrome Web Store](https://chromewebstore.google.com/detail/youtube-bilibili-ai-summa/beldipifadjpkcohpbmlncgefmnjfcmo)

**结论标记：** `DESK RESEARCH COMPLETE`；实战评测 `NOT RUN`；V1.2 任何功能均未因此自动变更为 `approved`。
