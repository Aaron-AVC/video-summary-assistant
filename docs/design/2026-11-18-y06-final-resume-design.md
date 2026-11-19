# Y-06 / Issue #22 — 最终结构化总结失败后的会话内恢复设计

> **M1 / M2 MERGED · M3 IMPLEMENTED / DIRECTED REVIEW PASSED · FINAL MERGE APPROVAL PENDING** · 当前状态更新 2026-11-19
>
> M1 已由 PR #25 合并（`7c5adbad7e75fa730c6b996c844ce085763ae15e`），M2 已由 PR #26 合并（`e01572decbc5454560f48c8bfcbe9716219f0ab2`）。M3 Draft PR #27 的 F-01～F-04 已通过独立定向复核；最终 HEAD 的独立核验与合并授权仍待完成。
>
> 创建日期：2026-11-18 · 建议优先级：P1 · 原设计基线：`main@b42b7fffe05661fa1155a30af60874ab5793e2ca`
>
> M2 实施基线：`main@7c5adbad7e75fa730c6b996c844ce085763ae15e`；恢复来源检查点：`618a8fb85f13e66d90522562ebaf645d3c6f6b2b`；M2 基础提交：`806d0c1e011eb775bbd2e872b3c67fcf0538b1f1`；Reduction 集成测试：`bb778859a7a52f703d42782a0e10294c225e74fe`；Provider 竞态修复：`44429c6c2061bd900f0558a757e3ccab9868d32c`。
>
> 缺陷：[Issue #22](https://github.com/Aaron-AVC/video-summary-assistant/issues/22) · [脱敏事故记录](../reviews/2026-11-18-y06-provider-502-diagnostic.md) · [验收矩阵](2026-11-18-y06-final-resume-acceptance.md)
>
> M1 的类型化阶段/错误、M2 的内存检查点与身份门禁、M3 的显式恢复 UI、恢复准入和 Final-only 请求均已实施。当前工作不修改 `LICENSE`、不发布、不触发 Provider 真实请求，也未增加数据库表、扩展权限或自动付费重试。

## 1. 用户目标与事故证据

Y-06 的 1h47m39s 视频在 Standard 预设下，五次顺序 Map 分块调用成功，第六次 Final 结构化总结得到 HTTP 502 + HTML，五次成功响应自报合计 62,970 Token，最终产物未保存。PR #23 已修正 HTTP/HTML 错误信息；**已成功分块的跨次复用**仍未实现。

**首版目标**：当**最终模型请求**因可识别的临时网络/上游错误失败，且输入身份未发生变化时，让用户在**同一 Side Panel 运行会话**明确点击「继续最终总结」；恢复时 **0 次 Map、0 次 Reduction、仅一次新的 Final 请求**（若模型返回不合格结构，仍遵守现有至多一次结构化修复调用）。继续后照常落盘最终成功的分析。额外请求次数、失败阶段与隐私行为必须透明。

**非目标**：刷新/关闭 Side Panel 后继续；跨进程/跨浏览器恢复；通用 Map 中途断点续跑；改造成功分析的现有 IndexedDB 缓存；Provider 自动重试；持久化中间摘要；直接更改 AI 模型输出预算；跨视频或跨 Bilibili 分 P 复用。

## 2. 已核验源码约束

| 真实源码 / 契约 | 现有行为 | 对设计的要求 |
| --- | --- | --- |
| [`run-analysis.ts`](../../src/features/analysis/lib/run-analysis.ts) | 先检测 single-pass / map-reduce；按顺序做 Map、需要时 Reduction，最后调用结构化 Final；成功返回原始 `chunkSummaries`、`reductionLevels` 等 | Final 恢复必须保存**原始 Map 摘要及归并后的 Final 输入摘要**，否则无法保持既有返回与持久化形状 |
| [`analysis-plan.ts`](../../src/features/analysis/lib/analysis-plan.ts) | 预算约束和确定性分块/Reduction 规划 | 恢复前验证原始字幕、预算策略、分块方案和最终 Prompt 的语义身份 |
| [`analysis-controller.ts`](../../src/sidepanel/analysis/analysis-controller.ts) | Provider Resolve、字幕缓存、完整分析缓存检查，`runAnalysis` 成功后才写分析记录 | 恢复必须经过同一权限、精确缓存、任务新鲜度和最终落盘链路；失败前不伪造完整分析 |
| [`analysis-task-controller.ts`](../../src/features/analysis/lib/analysis-task-controller.ts) | 每次任务结束释放 activeTask；`finalizing` 表示**持久化结果阶段**且禁止取消 | 「向模型请求 Final」仍属于可取消的 `analyzing`，另设进度详情，不能借用 `finalizing` |
| [`cache-identity.ts`](../../src/lib/persistence/cache-identity.ts) | 标准分析缓存键含 `contentKey`、字幕指纹、Provider Profile/endpoint/model、Schema 与 Prompt 版本 | **恢复检查点身份比完成分析缓存更严格**：额外校验标题、时长、预算策略、实际 Final 输入、来源标签页与 Provider 凭据版本 |
| [`index.tsx`](../../src/sidepanel/index.tsx) | 任务在 UI 中经协调准入；工作区以 epoch / `contentKey` 防止陈旧发布；分 P 切换重置 | 检查点必须在切换视频、分 P、标签页和工作区世代变化时失效；恢复按钮受任务协调保护 |
| [`destructive-operation-coordinator.ts`](../../src/features/history/lib/destructive-operation-coordinator.ts) | 成功的数据删除/清理通过 mutation 广播到 Side Panel | 检查点需订阅相同成功 mutation，并在前台或其他面板触发时淘汰有关候选 |

## 3. 决议候选：单会话单检查点 + 显式恢复

### 3.1 状态机

| 状态 | 转换条件 | UI 与数据动作 |
| --- | --- | --- |
| `EMPTY` | 初始、超时、切换身份、删除、取消、完成 | 无「继续」入口 |
| `ANALYZING_MAP` | 新 Map-Reduce 任务开始 | 仅报告 `Map completed/total`，不提供恢复 |
| `ANALYZING_REDUCE` | Map 结束、需要归并 | 报告 `Reduction level/group`，不提供恢复 |
| `FINAL_IN_FLIGHT` | 进入最终模型生成，数据校验后形成受控的内存检查点 | 仍为可取消的 `analyzing`；保存阶段另标 `finalizing` |
| `RESUME_AVAILABLE` | Final 因允许的临时错误结束；原任务真正释放；检查点仍有效 | 展示最后错误状态、剩余有效期、可能收费与「继续最终总结」 |
| `RESUMING` | 用户明确点击、协调准入成功、重新比对身份 | 检查点暂时租用并阻止并发重复点击；只发 Final |
| `COMPLETED` | Final 成功并通过既有保存/发布 | 原子清理检查点；完成结果仍使用既有缓存/历史路径 |

- 不符合继续条件的失败（Map、Reduction、单次分析、认证错误、取消、输入失配、解析验证失败等）直接进入 `EMPTY`，沿用现有错误 UI。
- `RESUMING` 期间如果再次遇到符合条件的 502/503/504/网络超时，在原有效期内可回到 `RESUME_AVAILABLE`；**不会自动再次发请求**。其他失败直接清理检查点。
- `finalizing` 的既有含义保持为「最终结果保存」，不能在 Final API 请求一开始就切换到该阶段。
- 明确区分 **「重新生成」**（按原有全新调用路径并清空旧检查点）与 **「继续最终总结」**（严格复用合法检查点）。身份不匹配时后者失败封闭，不应偷偷降级成完整收费重算。

### 3.2 仅内存的检查点契约（提议）

提议建立与 `AnalysisTaskController` 分离、由 Side Panel 实例持有的 `FinalResumeCheckpointController`，其生命周期与面板实例一致。其序列化出口默认关闭：**不写 IndexedDB、Chrome Storage、日志、错误上报、历史导出和 URL**。

候选数据形状如下（不是已实现的 TypeScript 类型）：

| 分组 | 字段 / 约束 |
| --- | --- |
| 生存期 | `checkpointVersion`、`createdAt`、`expiresAt`、单一消费租约 ID、来源 taskId / workspaceEpoch |
| 目标身份 | `sourceTabId`、严格 `platform`、`videoId`、`partId`、规范 `contentKey` |
| 输入身份 | `transcriptFingerprint`；标题、时长、完整字幕序列参与不可逆摘要；`budgetPolicy`、规划版本、Map 分块计划摘要和 Final Prompt 摘要 |
| Provider 身份 | Profile ID、规范化 Base URL、模型 ID、请求超时、Provider 配置修订标记；**不包含 API Key、Authorization、任何请求头** |
| 版本身份 | 分析 Schema 版本、分析有效 Prompt 版本、预设 ID、分块/归并策略版本 |
| 受保护的中间结果 | 已完成的原始 Map 摘要数组、Final 实际使用的归并后摘要、原始块数、Reduction 层数、合法时间范围；保留最终成功所需的元数据 |
| 失败原因 | 稳定错误分类（HTTP 状态 / 网络超时 / 可恢复网络故障）及失败位置标识，不存储上游 HTML/Prompt 或原始错误正文 |

**候选边界值**：每个 Side Panel **最多 1 个**检查点；创建后 **30 分钟 TTL**；合计摘要 UTF-8 **最多 256 KiB**；任何单条摘要超标、非有限时间戳、非法顺序、重复/缺块、过大内容或无法重算身份时直接不提供恢复。边界值是设计提案，后续代码/性能测试可调整；永不截断中间摘要然后声称等价恢复。

提供进度到 UI 的只有类型化元数据（阶段、序号、总数、错误类别和计时）；内存里的摘要被视为**私人数据**，不纳入 diagnostics 或持久化导出。

### 3.3 何时形成、保留、淘汰检查点

1. 每个 Map/Reduction 调用前检查 AbortSignal；成功后更新数值进度；不在中途提交可恢复检查点。本期只支持**所有 Map/Reduction 结束后的 Final 恢复**。
2. 形成最终 Prompt 前，将原始 Map 摘要与归并后摘要冻结为仅内存候选；同时绑定快照的 Provider、字幕、标题、时长、预算、预设与实际 Final Prompt 哈希，并验证大小上限。
3. 仅当**真实 Final 请求**因可分类临时错误失败时，将候选发布为 `RESUME_AVAILABLE`。初版适用：HTTP **502/503/504**、明确的网络超时/暂时连接故障；其他如 400/401/403/429、取消、无 assistant content、Schema/引用归一化失败不自动取得继续资格。
4. HTTP 错误处理使用明确的类型化错误代码或结构化分类，**不解析用户可控的 error.message 字符串**作为恢复判断依据；PR #23 的 UI 文案保持兼容。
5. 到期、超出容量、任务取消、手动重新生成、选择新 Provider/模型、API Key 替换、预设变化、字幕指纹变化、同 BV 换 P、跨视频 A→B→A、源标签页变化、Side Panel 卸载、清空全部、清空分析历史、清空字幕缓存、删除该视频，均淘汰候选。
6. 删除某个无关视频的数据可以保留当前检查点，但须以**精确 contentKey** 判断。删除相关分析记录建议保守清理候选。清空 Ask 对话/纯诊断日志不影响分析中间结果。跨面板删除/清空依赖既有 mutation 广播，使所有相关面板内存检查点一并失效。
7. Provider 配置修订必须被重验；不能仅凭「Profile ID 相同」假定密钥未更换。优先使用可靠配置版本/变更订阅标记，任何无法证明一致的改动都失效，不存储密钥哈希作为持久数据。
8. 检查点只在原 Side Panel 内存中存在；刷新或关闭后按钮消失并按全新分析处理，这一点必须在 UI 上说明。

### 3.4 恢复时的精确执行顺序

1. 用户点击「继续最终总结」后，先通过现有 `admitDestructiveTask` / `AnalysisTaskController.start` 取得互斥执行权；重复点击和多面板竞争不可触发第二条同一恢复链。
2. 重新获取实时标签页与视频 `contentKey`、捕获新的 taskId/epoch；重新按原来源加载当前字幕并计算指纹；以同一 Provider 权限路径重新 `resolveProvider`，同时验证配置修订和预设。
3. 重建完整检查点身份：不仅比较已有 `analysisCacheKey`，还验证**标题、时长、实际最终 Prompt、预算/算法版本、Map 计划哈希、来源 tab、精确 P 编号**。任意不一致直接拒绝并清理，返回明确状态，**在拒绝路径上发出的 AI 请求数必须为 0**。
4. 继续使用当前完成分析缓存的精确命中逻辑：如在同一时段有合法的完整结果，优先恢复已完成产物并清理检查点，AI 调用数 0；否则只从检查点生成 **Final** Prompt，不再执行 Map、Reduction。
5. Final 模型输出仍经现有 JSON 解析、Schema、字幕证据边界归一化和至多一次结构化 Repair。继续成功后的结果，进入`analysis-controller.ts`既有的 `finalizing` 存储和 Workspace Epoch 发布逻辑；恢复保留 `initialChunkCount`、`reductionLevels`、原始 `chunkSummaries` 的一致性。
6. 恢复后的最终结果保存成功则销毁检查点。模型成功但落盘失败时按**持久化错误**处理，不将其冒充 Provider 最终请求失败；下一阶段再评估“只重试保存”的契约。
7. 每次用户点击恢复至多启动一条 Final 请求（现有结构化修复至多一次），无隐式自动 HTTP 重试。提示「Provider 可能计费；仅继续最后的总结请求」。

### 3.5 UI/可诊断性（本期建议随恢复 MVP）

- 进度：`分析字幕片段 3/5`、`归并摘要 第 1 层 2/3`、`正在生成最终总结`、`正在保存`；与现有 TaskBanner 同步，英文与中文翻译齐全。
- 失败：`最终总结失败：Provider HTTP 502。已完成的 5 个分块在当前侧边栏中暂时保留。`，显示「继续最终总结」和剩余 TTL；不在日志中输出任何中间摘要。
- 等待中：按钮禁用，允许沿用现有「取消」（Final AI 调用仍处于 analyzing）；保存阶段不可取消。重复点击必须无效。
- 不可恢复：显示原因（已过期 / 视频或 Provider 改变 / 任务被取消 / 内容更新），提供独立的「重新生成」入口；不得静默重新调用五个 Map。
- 若没有适用检查点，用户直接 Generate 的原有行为和缓存命中必须保持不变。

## 4. 必须审查的技术边界

### 身份 / 版本

既有 `computeAnalysisCacheKey` 的维度不涵盖全部 Final Prompt 决策数据，因此**不得直接把它当作恢复 token**。尤其 `videoTitle`、`durationSec`、`budgetPolicy`、Map/Reduction 策略、阶段最终摘要文本及源 tab 变化，都要求强验证。标题变化即使视频未换，也须重新比较实际 Prompt 身份，严格模式下候选过期。

### 多面板 / 删除竞态

即使检查点仅保存在内存，多个 Side Panel 可以访问同一持久化数据。清空/删除操作与恢复的准入仍走既有序列化协调；对通过广播到达的 mutation 立即淘汰，防止被删后再复活。必要时引入新的无内容 checkpoint-generation token，在异步 Provider Resolve / 字幕读取之后再次检查，确保中间变化不可越过门禁。

### 取消和可靠性

一个正在进行的 Final API 请求已经发送至 Provider 时，用户取消可能不能撤销上游计费；UI 仅保证本地停止、禁止落盘和清理可恢复候选。网络断线、进程终止及 Chrome Side Panel 被销毁会失去会话内检查点，属于此版本边界。

### 内容与安全

Map 摘要为模型生成的**不可信证据**。恢复应继续使用现有 `buildFinalAnalysisPrompt` 的 nonce fence 与证据格式化，而不是拼接裸文本；缓存变量不可公开到日志/存储。恢复时再次校验 chunkId 唯一、范围合法、序号完整和摘要大小，拒绝损坏对象。

## 5. 分步实施记录与后续候选

| 里程碑 | 状态 | 实际输出 / 后续边界 | 依赖 |
| --- | --- | --- | --- |
| D0 | `done` | 设计、验收矩阵、风险和测试门禁 | 不改代码 |
| M1 | `merged` | 精确 `map/reduction/final/repair` 事件和可分类 HTTP 错误；不改变请求行为 | PR #25 已合并为 `7c5adbad7e75fa730c6b996c844ce085763ae15e` |
| M2 | `merged` | 30 分钟 / 256 KiB 的单一内存检查点、完整性/身份/generation/lease 校验、真实 Reduction 接缝、Provider 二次身份校验及跨面板失效 | PR #26 已合并为 `e01572decbc5454560f48c8bfcbe9716219f0ab2` |
| M3 | `implemented / directed_review_passed` | 手动「继续最终总结」、双身份恢复准入、Final-only 请求与共用持久化已落地；F-01～F-04 定向修复通过独立复核，黄金恢复及 AC-18 刷新/关闭重开浏览器 Smoke PASS | Draft PR #27；等待最终 HEAD 独立核验及用户合并授权，未开始 M4/M5 |
| M4 | `pending` | M2 已覆盖部分身份、隐私和损坏输入回归；完整恢复流、取消竞争和浏览器 Smoke 依赖 M3 | M3 |
| M5 | `pending` | 本里程碑未启动；M3 收尾门禁属于本次候选 HEAD 的工程验证，不视为启动 M5 | 未授权 |

**不批准的后续议题**：跨刷新持久化检查点；Map 阶段续跑；自助设置重试次数 / `Retry-After` 自动退避；费用估算 UI。需另立 PR，评估数据库 Schema、导出/删除、秘钥修订和用户可见的计费提示。

## 6. 出口标准

只有 [验收矩阵](2026-11-18-y06-final-resume-acceptance.md) 的必测项均有实际测试证据，才可在未来的**实施 PR** 宣称通过。应首先利用纯 Mock Provider 复现「5×Map 200 → Final 502 → 用户手动继续 → 1×Final 200」；随后覆盖并发/身份/取消/清空等边界。用户提供的原始 HAR 继续留在私人测试环境，不添加到 Git 对象或 Issue 附件。

## 7. 设计决策记录（只追加）

| 日期 | 类型 | 结论 | 待确认 |
| --- | --- | --- | --- |
| 2026-11-18 | `candidate` | 先设计而不动源码；MVP 提议单 Side Panel 内存 Final 恢复、手动触发、保守失效、无自动重试；原有 Final API 可取消/`finalizing` 仅保存 | 用户/维护者批准检查点保留时间与大小、修复拆分、浏览器 Smoke 门禁，再实施 M1 |
| 2026-11-18 | `in_progress`（仅 M1） | 用户明确授权 M1：Provider 错误分类、类型化阶段进度、测试先行；尚未执行本地验证 | 先完成 M1 目标/全量测试及独立审查，M2/M3 需另行批准 |
| 2026-11-18 | `in_review`（M2 检查点） | 恢复固定 WIP 后核验：`runAnalysis` 在真实 Final 前准备候选，只有首次 Final 的 502/503/504/timeout 可发布；首个响应、不可恢复失败、prepare/promote 异常均完整 discard。控制器不持有恢复请求能力 | Draft PR 与独立代码审查；不得把内存 `available` 当成 M3 已可点击恢复 |
| 2026-11-18 | `in_review`（Reduction 接缝） | 新增真实 `runAnalysis + FinalResumeCheckpointController` 集成测试，覆盖一级和两级 Reduction、502 发布、原始 Map 摘要保留、归并 ID/范围/摘要与 Final Prompt 身份、异常完全失效；未调用恢复请求 | 提交 `bb778859a7a52f703d42782a0e10294c225e74fe`；4 pass / 0 fail / 62 assertions |
| 2026-11-18 | `in_review`（Provider 竞态） | 第二次身份校验除 `apiKey + credentialRevision + profileUpdatedAt` 外，直接比较 baseUrl/model/generationTimeoutSec，封堵同毫秒时间戳不变的执行配置替换；metadata-only 保存不再回写旧 secrets 整表，避免跨面板覆盖新 key/revision | 提交 `44429c6c2061bd900f0558a757e3ccab9868d32c`；两项均有独立 RED→GREEN 日志 |
| 2026-11-19 | `authorized`（M3） | 维护者明确授权 M3：仅做手动 Final-only 恢复闭环及必要安全测试；不做自动重试、Map 断点续跑、跨刷新恢复、新权限或数据库迁移 | Draft PR 与独立审查 |
| 2026-11-19 | `in_review`（M3 双身份准入） | 新增 `acquireForResume`：只把执行作用域的 `taskId`/`workspaceEpoch` 替换为检查点不可变来源值，其余身份字段仍严格比较；普通 `acquire()` 行为不变，因此未放宽 M2 匹配。恢复另有独立任务准入、AbortSignal 与行内 currentness guard | 17 项双身份 RED→GREEN |
| 2026-11-19 | `in_review`（M3 Final-only 执行） | 抽取共用 `structured-analysis`（Prompt 组帧、JSON 解析、Schema 校验、字幕归一化、至多一次 Repair、取消），`runFinalOnlyAnalysis` 只发冻结的 Final 请求并保留 `strategy`/`initialChunkCount`/`reductionLevels`/`chunkSummaries` 形状 | 7 项执行测试；普通分析 48 项回归保持 PASS |
| 2026-11-19 | `in_review`（M3 恢复编排） | 固定安全顺序：任务准入 → 实时来源 → 重新读取字幕 → Provider 配置 → 检查点身份 → 精确缓存 → 唯一 lease → 请求前/落盘前二次 guard。身份不一致、取消、过期、租约冲突一律 fail closed 且 0 次模型请求 | 17 项协调器测试，覆盖 A/B/C/D/E 五分支 |
| 2026-11-19 | `in_review`（M3 共用持久化） | 把 Video Record、Transcript Snapshot、Analysis Run、Segments、Recent Analysis、Analysis Cache 抽为 `persistCompletedAnalysis`，普通完成与恢复完成共用；缓存命中时保持 nullable `analysisRunId` | 侧边栏与历史 137 项回归 PASS |
| 2026-11-19 | `in_review`（M3 黄金流程） | 真实 `runAnalysis`+真实检查点+纯 Mock Provider：5 Map → Final 502 → 不点继续无新请求 → 手动继续 0 Map/0 Reduction/1 Final 200 → 保存 → 检查点销毁；另覆盖一/两级 Reduction 与再次 503 需再次点击 | 4 项黄金流程测试（AC-01/02/03/06/29） |
| 2026-11-19 | `in_review`（M3 UI） | Overview 失败区新增独立「继续最终总结」入口与「完整重新生成」分流；处理中禁用并显示「正在继续最终总结」，落盘阶段显示「正在保存」；TTL 到期、视频/分P/字幕/Provider/预设变化自动失效；暴露的只有脱敏 HTTP 状态 | 10 项可用性 + 7 项组件 + 7 项 i18n 测试 |
| 2026-11-19 | `in_review`（M3 门禁） | 全量 1605 pass / 0 fail / 5797 assertions（115 文件）；`typecheck` 与 `git diff --check` 退出 0；Chrome for Testing 156.0.8078.73 MV3 产物门禁 PASS | Side Panel 交互 Smoke 仍 NOT RUN（见验收矩阵说明） |
| 2026-11-19 | `in_review`（M3 定向修复 F-01） | `lease.validate(currentContext)` 改为比较**传入的最新上下文**，不再使用获取时捕获的 `compareContext`；`acquireWith` 新增 `resumeScoped` 获取期标记，只有 `acquireForResume` 取得的租约才在 validate 内对 `taskId`/`workspaceEpoch` 做来源归一化，普通 `acquire()` 全程严格比较、零归一化。另收紧为 fail closed：过期/执行失效/记录校验异常一律 invalidate 并返回 false | 28 项新增断言；RED 18 fail → GREEN 111 pass（含 M2 回归）；普通 acquire 严格契约不变有专项证明测试 |
| 2026-11-19 | `in_review`（M3 定向修复 F-02） | Side Panel `readLiveSource` 原先把 readiness 取自当前 `videoContextRef`（可能是新视频 B），身份却取自任务快照（旧视频 A），构成混用。新增纯函数 `assertLiveSourceMatchesTask`：全部身份字段来自**同一次运行时读取**（含新增 `activeTabIdRef`），再与冻结快照逐字段严格比对 tab/platform/video/part/contentKey，任何不一致立即抛 `FinalResumeSourceMismatchError`（只带字段名，不带内容值）。`finalCheckpointDurationRef` 同时改为按 `contentKey` 作用域，避免旧时长混入新任务身份 | 覆盖 YouTube A→B→A、Bilibili P1→P2→P1、await 期间切换来源；RED 2 fail → GREEN 13 pass |
| 2026-11-19 | `in_review`（M3 定向修复 F-03） | 缓存快路径原先在 `acquireForResume` **之前**执行，只检查了 `state === "available"`，未验证身份/完整性/TTL，可能为 B 发布属于 A 的可用检查点结果，或把过期检查点当缓存命中。改为「租约先行」：`acquireForResume` 通过后才查精确缓存，命中走 `lease.destroy()` 后发布（非 `release()`），保持 0 次 AI 请求与 nullable `analysisRunId`；过期检查点返回 `expired` 而非 `cached` | RED 3 fail（`Received: "cached"`）→ GREEN；缓存命中零模型请求有显式断言 |
| 2026-11-19 | `in_review`（M3 定向修复 F-04） | Provider 配置在异步缓存查询与租约获取之前解析，Final 实际使用的是早先读到的 `apiKey`，Final 之后仅用捕获的旧 context 调 `validate`，跨面板轮换可绕过校验。改为三次**真实重采集**（准入、Final 前、落盘前），每轮重读 tab/视频/字幕/Provider，并以新 context 调 `lease.validate`；新增 `executionTargetMatches` 逐项比较 baseUrl/model/timeout/`credentialRevision`/`apiKey`，不一致即销毁租约、`identity-mismatch`、零额外模型请求 | RED 2 fail（`Received: "completed"`）→ GREEN；`analysisRunId` 与 `credentialRevision` 全链路可追溯 |
| 2026-11-19 | `in_review`（M3 定向修复 NOTE） | ① `transcriptCapturedAt` 原在恢复路径复用 `completedAt`，与普通路径「字幕真实捕获时刻」语义漂移；改为 `FinalResumeTranscript.capturedAt` 由真实采集点提供，落盘使用最后一次真实采集的捕获时刻。② UI 由固定 30s 轮询改为对齐真实 `expiresAt` 的调度器（`createFinalResumeTtlScheduler`），新检查点改变 `expiresAt` 自动重排。③ 任务释放瞬间即刷新（`shouldRefreshFinalResumeOnTaskRelease`），修复首次 Final 失败后按钮不能及时回到 `available` | RED 5 fail（`Expected: 1740000, Received: 30000`）→ GREEN 17 pass；`getSnapshot` 保持纯读语义 |
| 2026-11-18 | `in_review`（候选门禁） | 改写前候选 `00a2a2df1287aabde9449d5fdb6f177426dd6170`：全量 1517 pass / 0 fail / 5371 assertions；typecheck、build、`git diff --check` 退出 0；Chrome for Testing 156.0.8078.73 的 MV3 产物门禁 PASS | 最终分支 SHA 必须重跑全量门禁；独立审查和 M3 恢复执行仍为 NOT RUN |
| 2026-11-19 | `directed_review_passed`（M3） | F-01～F-04 获独立定向复核 CLOSED；`87ea663` 的 1684 项自动化基线与成功恢复 Smoke 已审阅。当前收尾补齐真实刷新和关闭重开：恢复 UI 不复活、无自动请求、无中间摘要或检查点持久化；关闭重开保留正常历史且新分析成功 | 独立最终 HEAD 核验与用户合并授权待完成；M4/M5 未启动 |

[返回文档索引](../README.md)
