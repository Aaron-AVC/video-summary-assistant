# 文档索引 / Documentation index

这里将**现行行为契约**与**历史审查快照**分开：旧报告只对应自身记录的 commit 和日期，不能借用旧测试数字认定新版本已经验收。

## 当前产品与实现

| 文档 | 用途 |
| --- | --- |
| [README (English)](../README.md) / [中文 README](../README.zh-CN.md) | 用户使用、安装、隐私与限制 |
| [TASK_STATE](../TASK_STATE.md) | 当前核对快照 + 历史里程碑 |
| [Side Panel UX](sidepanel-ux.md) | 侧边栏、搜索、Ask、书签与 Markdown 行为 |
| [Persistence / Cache](persistence-cache.md) | Dexie、缓存身份、导出/删除与写入验证 |
| [Platform architecture](platform-architecture.md) | 双平台身份与适配器 |
| [Provider architecture](provider-architecture.md) | Provider、可选权限与秘密隔离 |
| [Analysis architecture](analysis-architecture.md) | 结构化总结与长视频分析 |

## 后续计划与进度

- [功能路线图](roadmap.md)：单一候选清单、稳定功能 ID、状态和建议优先级。
- [开发计划维护规则](feature-plans/README.md) 与 [计划模板](feature-plans/TEMPLATE.md)。
- [F-001 历史字幕搜索候选方案](feature-plans/F-001-history-transcript-search.md)。
- [许可证偏好、候选条款比较与待核验版权边界](licensing/2026-11-17-license-policy-review.md)：R-002 候选审查，尚非正式授权文本。
- [竞品定位研究](research/2026-11-17-competitor-landscape.md)、[可复现测试方案](research/video-benchmark-protocol.md)、[结果记录模板](research/video-benchmark-results-template.md)：R-003，当前仅完成桌面研究。
- [Y-06 长视频失败的脱敏复核](reviews/2026-11-18-y06-provider-502-diagnostic.md)：Issue #22；原始 HAR 未纳入仓库。
- [Y-06 最终总结失败后继续分析：设计与决策记录](design/2026-11-18-y06-final-resume-design.md) 与 [验收矩阵](design/2026-11-18-y06-final-resume-acceptance.md)：R-004 / Issue #22；M1/M2/M3/M4 全部 MERGED，M4 已由 PR #28 合并；R02 保留 RECONSTRUCTED CANDIDATE 历史属性，R03 PASS、R02-F01 CLOSED，R04 独立最终审查 PASS，R05 远端审查通过后现已合并；M5 PENDING，尚未启动。

## 历史资料（原始记录保留）

- [2026-10-19 Side Panel decomposition design](design/2026-10-19-v1.1-sidepanel-decomposition-design.md)：历史设计权威与当时源码行号。
- [2026-10-22 V1.1 Release Readiness 审计](reviews/2026-10-22-v1.1-release-readiness.md)：历史基线的测试、构建和未执行事项。
- [其他历史审计](reviews/) 与 [初始源码审计](source-audit.md)。

**更新规则：** 新功能改变真实用户可见行为时，同步更新中英文 README 和相关现行契约；单功能推进时同步计划文件与 `roadmap.md`；历史审计仅添加明确的新旧状态说明，不覆盖当时证据。
