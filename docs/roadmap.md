# 功能路线图 · Video Summary Assistant

**建立日期：** 2026-11-17 · **核对基线：** `main@859683b482a0b3e1d09a12369ceeb7e2af4e7236`

本文件是候选需求的**唯一总表**，不代表开发授权或发布日期。现有产品能力以 [README](../README.zh-CN.md) 为准，历史阶段结果以 [TASK_STATE](../TASK_STATE.md) 为准。

## 状态和管理规则

状态统一使用：`candidate` 候选 → `approved` 已批准 → `in_progress` 实施中 → `in_review` 审查中 → `done` 已交付；`parked` 表示暂缓，需记录原因和恢复条件。

优先级 P1/P2/P3 是**建议评审顺序**，不是批准。每个功能使用不可复用的稳定 `F-xxx` ID。只有明确确认范围、验收要求、Owner、目标版本和批准依据，并关联真实 GitHub Issue 后，才能由 `candidate` 升为 `approved`。开发进度、阻塞、证据、提交与 PR 写入对应的 [单功能计划](feature-plans/README.md)，路线图与计划随同一个 PR 更新。

## 候选功能清单

所有功能目前均为 `candidate`，无已承诺交付时间；“—”表示尚未建立计划或 Issue。

| ID | 候选功能 | 优先级建议 | 状态 | 计划/进度 | 主要价值或约束 |
| --- | --- | --- | --- | --- | --- |
| F-001 | 历史字幕全文检索 | P1 | `candidate` | [候选计划](feature-plans/F-001-history-transcript-search.md) | 本地检索已保存字幕，关联视频/分 P 和时间戳 |
| F-002 | 字幕划词、区间高亮与片段笔记 | P1 | `candidate` | — | 复用 `knowledgeItems` 范围字段，防止跨视频串片 |
| F-003 | 自定义总结输出语言/双语总结 | P1 | `candidate` | — | 语言参数纳入 Prompt 和缓存身份 |
| F-004 | 自定义总结模板/Prompt 预设 | P2 | `candidate` | — | 保留结构化 Schema 和版本约束 |
| F-005 | 手动导入 SRT/VTT 字幕 | P1 | `candidate` | — | 无字幕时由用户主动提供文字，明确视频身份 |
| F-006 | Token / 费用统计与预算提示 | P2 | `candidate` | — | Provider 用量可能缺失，费用为估算 |
| F-007 | Obsidian 友好 Markdown 导出 | P2 | `candidate` | — | 扩展既有导出，保持来源时间戳与链接 |
| F-008 | 播放列表/课程批量总结队列 | P2 | `candidate` | — | 任务队列、并发限制、取消和费用保护 |
| F-009 | 跨视频 Ask 与来源引用 | P2 | `candidate` | — | 依赖可靠的本地检索和跨视频引用 |
| F-010 | 可选 ASR 转写 | P2 | `candidate` | — | 音频来源、权限、成本和资源评估 |
| F-011 | 画面采样 / OCR / 视觉辅助理解 | P3 | `candidate` | — | 用户明确触发和隐私限制 |
| F-012 | 可选语义/向量搜索 | P3 | `candidate` | — | 本地索引、性能、模型体积和关键词回退 |
| F-013 | 可选备份/同步方案 | P3 | `candidate` | — | 数据加密、冲突处理、账户边界 |

## 发布质量里程碑（非功能）

| ID | 候选事项 | 优先级建议 | 状态 | 交付条件 |
| --- | --- | --- | --- | --- |
| R-001 | V1.1 对外发布准备 | P1 | `candidate` | 对选定 release SHA 完成实际包验证、依赖/安全检查、隔离浏览器 Smoke 和发布审核 |
| R-002 | 授权目标与第三方版权边界审查 | P1 | `candidate` | [候选审查](licensing/2026-11-17-license-policy-review.md)；使用偏好已确认，具体 LICENSE 待定，需完成源码归属和依赖许可核验 |
| R-003 | 竞品对比与真实使用基准测试 | P1 | `candidate` | [首轮桌面研究](research/2026-11-17-competitor-landscape.md)已完成；[实测方案](research/video-benchmark-protocol.md)待执行，性能、准确性和稳定性尚无实测评分 |

## 当前开发承诺

**本轮未批准新的功能实施。** F-001、F-002、F-003 建议最先评审，但没有锁定目标版本或排期。经过明确立项，创建对应 [计划模板](feature-plans/TEMPLATE.md) 和 GitHub Issue，状态变更为 `approved`，之后再记录实际实施。

**原则：** 维护本地优先、精确 `contentKey`（含 Bilibili P1/P2 隔离）、Prompt/缓存身份、API Key 与可选权限隔离，以及历史数据迁移/删除/导出契约。
