# Y-06 长视频分析失败复核（脱敏记录）

- **核验日期**：2026-11-18
- **复核基线**：`main@408b31f8132e40b8e6e05b282bbf68c438f9080f`
- **追踪**：[Issue #22](https://github.com/Aaron-AVC/video-summary-assistant/issues/22)
- **视频场景**：YouTube 1h47m39s，有实际可访问的字幕；Standard 预设，OpenAI-compatible `glm-5.3-flash`。
- **诊断数据范围**：私下提供的 6 项 Chat Completions HAR 请求，仅离线提取状态、请求类型、时长和合计 Token。原始 HAR **未上传仓库**；不保存任何 Key、HTTP 请求头、Cookie、字幕、Prompt 原文、模型响应原文或 Cloudflare 请求标识。

## 事实观察

| 顺序 | 从请求结构确认的分析阶段 | HTTP | 墙钟耗时 |
| --- | --- | --- | --- |
| 1 | Map / 分块摘要 | 200，JSON | 41.218s |
| 2 | Map / 分块摘要 | 200，JSON | 24.574s |
| 3 | Map / 分块摘要 | 200，JSON | 44.845s |
| 4 | Map / 分块摘要 | 200，JSON | 26.954s |
| 5 | Map / 分块摘要 | 200，JSON | 41.700s |
| 6 | Final / 结构化总结 | **502，HTML** | **68.851s** |

前五次 JSON 响应的助手内容非空、`finish_reason=stop`。所报告使用量合计：输入 **47,997** Token，输出 **14,973** Token，总 **62,970** Token。最后一次返回 HTML，带 `Retry-After: 60`，没有结构化 Token 用量。6 次请求耗时合计约 **248.14 秒**。用量不直接等同于计费。

在该次失败中，UI 显示低层 `Unexpected token '<'` JSON 解析错误，缺少 HTTP 502。其他两次 Standard 失败属于用户口述/截图记录，包括一次“无 assistant content”；另一次 Concise 成功（约 4 分 55 秒）。这些数据尚不构成预设效果的统计比较。

## 源码对应

- `src/features/analysis/lib/run-analysis.ts`：分块摘要按顺序执行，最后发出结构化总结请求；五次 Map 成功后失败于 Final，与 HAR 请求类型吻合。
- `src/features/analysis/lib/openai-compatible-client.ts`（基线版本）：在检查 `response.ok` 之前读取并解析 JSON，导致 HTML 502 页首先变成 JSON `SyntaxError`。
- 当前错误恢复策略尚不保留可供跨次任务复用的已完成分块摘要。研究这一点需要独立审查用户数据、身份、缓存和退出/清理边界。

## 修复拆分与验证

- **A / 当前 Draft PR**：HTTP 失败优先报告状态；标准 JSON 错误保留必要的脱敏文字；HTML/损坏 JSON 不显示响应正文；无自动重试；保持响应体大小限制、超时和取消行为。
- **B / 后续设计**：分块及最终汇总进度和安全错误标识，避免泄漏文本与凭据。
- **C / 后续设计**：最终阶段失败后的有条件继续，不在本 PR 实现持久化和重复计费策略。
- **D / 待决策**：重试、退避和 `Retry-After` 的用户授权与预算保护。

**验证状态：** HAR 取证和远端源码审阅已完成；候选补丁需要实际 Bun 测试、TypeScript、构建与浏览器回归。没有在本次复核中重放真实 Provider 请求。
