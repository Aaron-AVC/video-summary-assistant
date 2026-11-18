# Issue #22 — Final Resume 验收矩阵和可复现测试用例

> **TEST SPECIFICATION / NOT RUN** · 2026-11-18 · 基线 `main@b42b7fffe05661fa1155a30af60874ab5793e2ca`
>
> [设计候选](2026-11-18-y06-final-resume-design.md) · [Issue #22](https://github.com/Aaron-AVC/video-summary-assistant/issues/22) · 当前没有 Final Resume 产品代码或测试运行结果。

## 1. 模拟器要求

- Mock 客户端记录精确调用：`map`、`reduction`、`final`、`repair`，保留请求顺序、AbortSignal、Provider 配置标识和调用次数；不回显字幕/请求体。
- 注入可控时钟（TTL）、任务 ID、Provider 配置修订、Workspace Epoch、来源 tabID、字幕 cue 集、Bilibili 分 P、网络超时/502/503/504/401/429/非法响应、持久化故障。
- 真实生产逻辑仍保留现有 prompt fencing、JSON Schema 校验、normalized chapter anchors、历史保存和 Task admission；允许在纯测试中通过依赖注入驱动。
- 结果应提供 `expected call counts`、检查点生命周期、是否成功落盘、是否仅向正确工作区发布；失败必须有真实 RED 证据。
- 在没有代码实施前，下表均标为 `NOT RUN`，不得将预期写成已通过。

## 2. 核心功能验收

| ID | 构造场景 / 动作 | 可检验预期 | 状态 |
| --- | --- | --- | --- |
| AC-01 | 五个 Map 成功，首次 Final 返回 502，用户不点继续 | 完成 5×Map + 1×Final；无自动新增请求；出现 Final/HTTP 502 的脱敏错误及恢复入口；无完整分析写入 | `NOT RUN` |
| AC-02 | 继 AC-01，用户点击一次继续，Final 返回合法 JSON | **恢复时 Map=0 / Reduction=0 / Final=1**；沿用原 Map 结果，得到正常 Schema 的完整分析并保存，检查点销毁 | `NOT RUN` |
| AC-03 | 必须先归并的长视频：Map 完成→Reduction 完成→Final 502→继续 | 恢复时只调用 Final；保存的原 Map/Reduction 层数、范围和既有结果形状一致 | `NOT RUN` |
| AC-04 | 同一精确输入已有完整缓存结果才点击继续 | 命中已有完整分析，**0 次 AI 调用**；原检查点销毁 | `NOT RUN` |
| AC-05 | 首次完整运行成功，或 single-pass 成功/失败 | 无恢复检查点；现有 Generate、Regenerate、Analysis Cache 和历史结果字节/身份行为不变 | `NOT RUN` |
| AC-06 | Final 第一次恢复再次 503，稍后用户再次明确点击 | 失败后仍在未过期且同身份时展示恢复；每次点击恰好一次 Final，**没有自动重试** | `NOT RUN` |
| AC-07 | 恢复 Final 返回 Schema 非法，再修复成功 | 最多 1×Final + 1×Repair；原有 Schema/时间范围/Prompt fence 校验仍有效 | `NOT RUN` |
| AC-08 | Map 第 3/N 个请求失败或 Reduction 任一请求失败 | 不提供“只继续 Final”；无错误中间结果落盘 | `NOT RUN` |
| AC-09 | Final 401/403/429/400、空 `assistant.content`、结构校验失败 | 明确失败，MVP 不启用恢复，不能凭错误文案字符串误判可恢复 | `NOT RUN` |
| AC-10 | Final 502 HTML / 503 JSON / 504 HTML / 网络超时 | 错误状态通过类型字段传递；不泄露响应文本/Secret；符合初版规则时提供恢复 | `NOT RUN` |
| AC-11 | 用户点击「重新生成」而非「继续」 | 旧检查点销毁，沿原有强制新生成路径，不意外复用局部摘要 | `NOT RUN` |
| AC-12 | 手动继续过程中双击按钮 / 第二个任务同时开始 | 同一检查点只被一个任务租用；第二次不发 AI 请求 | `NOT RUN` |

## 3. 精确身份和故障封闭测试

| ID | 注入变化 / 失效场景 | 必须结果 | 状态 |
| --- | --- | --- | --- |
| AC-13 | YouTube A→B→A；同 BV P1→P2→P1；切换来源标签页 | 原检查点在首次身份变化时失效；继续入口不重新出现；伪造继续请求 0 次 AI 调用 | `NOT RUN` |
| AC-14 | 同一个视频，字幕 cue 文本或时间范围变化 | 指纹变化，拒绝继续且 0 AI 请求 | `NOT RUN` |
| AC-15 | 同一 cue 指纹但 Title、Duration、Budget Policy、分块规划或 Final Prompt 变化 | 严格恢复身份不匹配，拒绝继续且 0 AI 请求 | `NOT RUN` |
| AC-16 | Provider Profile、endpoint、model、凭据修订或用户预设/Prompt 版本发生变化 | 检查点失效且 0 AI 请求；不能跨 Standard/Concise 复用 | `NOT RUN` |
| AC-17 | 取消 Final / 任务被用户取消；异步请求回调在取消后返回 | 没有恢复入口、没有落盘、没有旧任务 UI 回写 | `NOT RUN` |
| AC-18 | Side Panel 销毁/刷新后重新打开 | 单会话检查点不复活，持久化库中不存在中间摘要表 | `NOT RUN` |
| AC-19 | 可控时钟推进到 TTL 临界值；摘要超过总 256 KiB 上限 | 恰好边界按明确规则处理，过期/超限失效；不截断摘要；0 恢复请求 | `NOT RUN` |
| AC-20 | 检查点含重复 chunkId、错序范围、NaN/Infinity、缺块或被篡改摘要 | 解码/验证 fail closed，**0 AI 请求**，不会向其他视频发布 | `NOT RUN` |
| AC-21 | 精确视频被删除，或另一个 Side Panel 执行清空全部/分析历史/字幕缓存 | mutation 广播淘汰相应 checkpoint；竞争情况下拒绝过期恢复，不复活已删除数据 | `NOT RUN` |
| AC-22 | 删除不相关视频；清空 Ask 对话或诊断日志 | 仅保留与当前身份严格相关的合法检查点；不误复活用户已删除数据 | `NOT RUN` |
| AC-23 | Provider Resolve 延迟后 Secret 被更换；字幕读取等待期间用户换分 P | 第二次 guard 阻止模型请求/发布，修订变化会淘汰 checkpoint | `NOT RUN` |
| AC-24 | Model 成功但最终持久化抛错 / quota error | 呈现持久化故障，不标记为 Provider 可恢复；既有未完成写入与历史语义保持一致 | `NOT RUN` |

## 4. UI、隐私与工程门禁

| ID | 检查点 | 预期 | 状态 |
| --- | --- | --- | --- |
| AC-25 | Map、Reduction、Final API、Saving 逐阶段 UI | `3/5` 等数字正确、Progress 不倒退；Final API 仍可取消；只有 Saving 是旧 `finalizing` | `NOT RUN` |
| AC-26 | 用户在恢复前查看错误和费用提示 | 明确告知仅重试最后请求、可能计费、仅本 Side Panel/有限期有效；中英本地化键完整 | `NOT RUN` |
| AC-27 | HAR-like 含密钥/HTML/Prompt/字幕/模型摘要的模拟错误 | Toast、console、diagnostic export、storage 不含 Key、Headers、Request Body、任何 Map 文本；只允许阶段/状态/次数/时间 | `NOT RUN` |
| AC-28 | 全仓文档及打包审查 | 不增加 host permissions、网络上传端点、数据库表或迁移；无自动 HTTP 重试或 API Key 再存储 | `NOT RUN` |
| AC-29 | 先完成带 502 的纯 mock 端到端模拟 | 第一次 5×Map + 1×Final(502)；继续 0×Map + 1×Final(200)；真实运行记录可复核 | `NOT RUN` |
| AC-30 | 最终实现 PR 审查门禁 | Target RED→GREEN、全量 Bun、TypeScript、Chrome MV3 Build、`git diff --check`、需实施的浏览器 Smoke + 独立 SHA/范围审查 | `NOT RUN` |

## 5. 具体实施测试文件建议

- `src/features/analysis/lib/run-analysis.test.ts`：Map/Reduce 完成后 Final 502 checkpoint、合法 Final-only 恢复、Schema repair、无自动重试、取消/非终态错误。
- 新增纯组件如 `src/features/analysis/lib/final-resume-checkpoint.ts` + 同名 `.test.ts`：检查点身份、容量、TTL、不可变快照、数值范围、超时、租约、失效和内存独占。
- `src/sidepanel/analysis/analysis-controller.test.ts`：Provider/Transcript 精确复核、完成缓存优先、恢复后原持久化形状、账单安全边界。
- `src/features/analysis/lib/analysis-task-controller.test.ts`、`src/sidepanel/lib/task-presentation.test.ts`：进度/取消权限和阶段标签。
- `src/sidepanel/lib/apply-data-mutation.test.ts`、`src/features/history/lib/destructive-operation-coordinator.test.ts`：删除/清空与跨面板失效广播。
- Side Panel 视图回归及中英文 i18n parity test；必要时以隔离的临时 Chrome Profile 验证 Side Panel 生命周期与 UX。
- 用测试专用固定串如 `sk-fixture-never-real` 验证脱敏；原始私用 HAR 不进入仓库测试夹具。

## 6. 验收日志（只追加）

| 日期 | 阶段 | 执行结果 | 证据 | 下一步 |
| --- | --- | --- | --- | --- |
| 2026-11-18 | Design / `candidate` | 编写 30 条用例的候选矩阵；`NOT RUN` | [设计](2026-11-18-y06-final-resume-design.md) / Issue #22 | 获得范围批准后实施 RED→GREEN |

**验收判定约束：** 有实际失败日志的用例才标 RED，有对应运行日志的才标 PASS。未执行的性能、成本或跨 Provider 回归一律保留 `NOT RUN`。

[返回文档索引](../README.md)
