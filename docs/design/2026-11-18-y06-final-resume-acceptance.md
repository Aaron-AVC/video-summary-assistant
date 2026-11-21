# Issue #22 — Final Resume 验收矩阵和可复现测试用例

> **M1 / M2 / M3 MERGED · M4 RECONSTRUCTED CANDIDATE / READY FOR FINAL REVIEW** · 当前状态更新 2026-11-21
>
> M1 已由 PR #25 合并，M2 已由 PR #26 合并，M3 已由 PR #27 合并。M4-R02 为 **RECONSTRUCTED CANDIDATE**，不声称找回异常前的字节级原件；M4-R03 **PASS**，R02-F01 **CLOSED**。M4 固定基线为 `1bea4bc8f66525ca2edb248b185a8abf18ff3658`，本地封板分支为 `feat/y06-m4-reconstructed-finalization-20261121`。
>
> M4 等待独立最终审查，尚未推送、合并，M5 尚未启动。原异常 Worktree 与恢复证据保留；下方旧里程碑日志不覆盖本轮状态。
>
> [设计与决策记录](2026-11-18-y06-final-resume-design.md) · [Issue #22](https://github.com/Aaron-AVC/video-summary-assistant/issues/22) · 改写前候选门禁 HEAD `00a2a2df1287aabde9449d5fdb6f177426dd6170`。当前状态不覆盖下方历史日志中对应旧 SHA 的真实结果。

## 1. 模拟器要求

- Mock 客户端记录精确调用：`map`、`reduction`、`final`、`repair`，保留请求顺序、AbortSignal、Provider 配置标识和调用次数；不回显字幕/请求体。
- 注入可控时钟（TTL）、任务 ID、Provider 配置修订、Workspace Epoch、来源 tabID、字幕 cue 集、Bilibili 分 P、网络超时/502/503/504/401/429/非法响应、持久化故障。
- 真实生产逻辑仍保留现有 prompt fencing、JSON Schema 校验、normalized chapter anchors、历史保存和 Task admission；允许在纯测试中通过依赖注入驱动。
- 结果应提供 `expected call counts`、检查点生命周期、是否成功落盘、是否仅向正确工作区发布；失败必须有真实 RED 证据。
- `PASS（M1/M2）` 只表示该里程碑范围内的自动化证据，不能单独顶替 M3 验收；M3 的显式恢复按钮、Final-only 请求及真实刷新/关闭重开须分别提供实际日志。下方历史 `NOT RUN` 记录是当时的真实状态，不代表现行状态。

## 2. 核心功能验收

| ID | 构造场景 / 动作 | 可检验预期 | 状态 |
| --- | --- | --- | --- |
| AC-01 | 五个 Map 成功，首次 Final 返回 502，用户不点继续 | 完成 5×Map + 1×Final；无自动新增请求；出现 Final/HTTP 502 的脱敏错误及恢复入口；无完整分析写入 | `PASS`（M3 黄金流程：5 Map + 1 Final 后调用数固定为 6） |
| AC-02 | 继 AC-01，用户点击一次继续，Final 返回合法 JSON | **恢复时 Map=0 / Reduction=0 / Final=1**；沿用原 Map 结果，得到正常 Schema 的完整分析并保存，检查点销毁 | `PASS`（M3 黄金流程：resume 段 0/0/1，落盘 1 次，检查点转 empty） |
| AC-03 | 必须先归并的长视频：Map 完成→Reduction 完成→Final 502→继续 | 恢复时只调用 Final；保存的原 Map/Reduction 层数、范围和既有结果形状一致 | `PASS`（M3 一级与两级 Reduction 恢复：恢复期 Map/Reduction 均为 0） |
| AC-04 | 同一精确输入已有完整缓存结果才点击继续 | 命中已有完整分析，**0 次 AI 调用**；原检查点销毁 | `PASS`（M3 协调器：cached，无模型请求，检查点 invalidate。**2026-11-19 定向修复**：缓存快路径原在 `acquireForResume` 之前，只检查 `state === "available"`，未验证身份/完整性/TTL；现改为租约先行 —— 检查点属于 A 而实时请求是 B 时返回 `identity-mismatch` 且不发布，过期检查点返回 `expired` 而非 `cached`；命中路径改用 `lease.destroy()` 而非 `release()`，保持 0 次 AI 请求与 nullable `analysisRunId`） |
| AC-05 | 首次完整运行成功，或 single-pass 成功/失败 | 无恢复检查点；现有 Generate、Regenerate、Analysis Cache 和历史结果字节/身份行为不变 | `PASS`（M1/M2 与全仓回归） |
| AC-06 | Final 第一次恢复再次 503，稍后用户再次明确点击 | 失败后仍在未过期且同身份时展示恢复；每次点击恰好一次 Final，**没有自动重试** | `PASS`（M3：再次 503 → final-retryable，检查点保持 available，且仅 1 次 Final） |
| AC-07 | 恢复 Final 返回 Schema 非法，再修复成功 | 最多 1×Final + 1×Repair；原有 Schema/时间范围/Prompt fence 校验仍有效 | `PASS`（M3 Final-only 执行：非法结构 → 1 Repair；结构失败会销毁检查点。M4-R03 补齐 Final 已收到后 Repair HTTP 503 不得误判为可恢复瞬时失败） |
| AC-08 | Map 第 3/N 个请求失败或 Reduction 任一请求失败 | 不提供“只继续 Final”；无错误中间结果落盘 | `PASS`（M2 不 prepare/publish） |
| AC-09 | Final 401/403/429/400、空 `assistant.content`、结构校验失败 | 明确失败，MVP 不启用恢复，不能凭错误文案字符串误判可恢复 | `PASS`（M2 类型化资格门禁） |
| AC-10 | Final 502 HTML / 503 JSON / 504 HTML / 网络超时 | 错误状态通过类型字段传递；不泄露响应文本/Secret；符合初版规则时提供恢复 | `PASS`（M1/M2 类型化错误与检查点；M3 成功恢复及生命周期浏览器 Smoke 已验证 502 入口、无自动恢复与无中间摘要持久化） |
| AC-11 | 用户点击「重新生成」而非「继续」 | 旧检查点销毁，沿原有强制新生成路径，不意外复用局部摘要 | `PASS`（M3 独立入口：重新生成走 `handleAnalyze({force:true})` 并先失效检查点） |
| AC-12 | 手动继续过程中双击按钮 / 第二个任务同时开始 | 同一检查点只被一个任务租用；第二次不发 AI 请求 | `PASS`（M3 并发用例：第二次 lease-unavailable，模型请求数 1；UI 处理中禁用按钮） |

## 3. 精确身份和故障封闭测试

| ID | 注入变化 / 失效场景 | 必须结果 | 状态 |
| --- | --- | --- | --- |
| AC-13 | YouTube A→B→A；同 BV P1→P2→P1；切换来源标签页 | 原检查点在首次身份变化时失效；继续入口不重新出现；伪造继续请求 0 次 AI 调用 | `PASS`（M2 生命周期/身份失效。**2026-11-19 定向修复 F-02**：Side Panel `readLiveSource` 原先把 readiness 取自当前 `videoContextRef`（可能是 B）、身份却取自任务快照（A），构成混用；现由 `assertLiveSourceMatchesTask` 保证全部身份字段来自同一次运行时读取并与冻结快照逐字段严格比对 tab/platform/video/part/contentKey，不一致立即 fail closed；新增 YouTube A→B→A、Bilibili P1→P2→P1、await 期间切换来源三组用例） |
| AC-14 | 同一个视频，字幕 cue 文本或时间范围变化 | 指纹变化，拒绝继续且 0 AI 请求 | `PASS`（M2 上下文身份校验） |
| AC-15 | 同一 cue 指纹但 Title、Duration、Budget Policy、分块规划或 Final Prompt 变化 | 严格恢复身份不匹配，拒绝继续且 0 AI 请求 | `PASS`（M2 严格身份校验） |
| AC-16 | Provider Profile、endpoint、model、凭据修订或用户预设/Prompt 版本发生变化 | 检查点失效且 0 AI 请求；不能跨 Standard/Concise 复用 | `PASS`（M2 直接执行字段比较 + 生命周期。**2026-11-19 定向修复 F-04**：Provider 原在异步缓存查询与租约获取之前解析，Final 实际使用的 `apiKey` 早于这些 await；现改为三次真实重采集（准入、Final 前、落盘前），每轮重读 tab/视频/字幕/Provider 并以新 context 调 `lease.validate`，另以 `executionTargetMatches` 逐项比较 baseUrl/model/timeout/`credentialRevision`/`apiKey`，不一致即销毁租约、`identity-mismatch`、零额外模型请求） |
| AC-17 | 取消 Final / 任务被用户取消；异步请求回调在取消后返回 | 没有恢复入口、没有落盘、没有旧任务 UI 回写 | `PASS`（M2 取消/陈旧 generation 回归；M4 补齐缓存 await 后模型前取消、取消后迟到成功与任务替代，真实 Chrome cancel PASS） |
| AC-18 | Side Panel 销毁/刷新后重新打开 | 单会话检查点不复活，持久化库中不存在中间摘要表 | `PASS`（CfT 156 + 真实 MV3 产物 + 纯 Mock：刷新和独立 `Target.closeTarget` 重开均无恢复入口、无旧 502、无自动 Provider 请求；全部 IndexedDB store 与 Chrome local/sync Storage 无中间 Map 摘要或检查点标记。重开前后正常历史 ID 保留，新视频完整分析成功；每次运行独立临时 Profile） |
| AC-19 | 可控时钟推进到 TTL 临界值；摘要超过总 256 KiB 上限 | 恰好边界按明确规则处理，过期/超限失效；不截断摘要；0 恢复请求 | `PASS`（M2 TTL/UTF-8 容量边界；M4 补齐缓存与 Final in-flight 到期后不得发布或保留可点击恢复入口） |
| AC-20 | 检查点含重复 chunkId、错序范围、NaN/Infinity、缺块或被篡改摘要 | 解码/验证 fail closed，**0 AI 请求**，不会向其他视频发布 | `PASS`（M2 integrity/范围校验） |
| AC-21 | 精确视频被删除，或另一个 Side Panel 执行清空全部/分析历史/字幕缓存 | mutation 广播淘汰相应 checkpoint；竞争情况下拒绝过期恢复，不复活已删除数据 | `PASS`（M2 mutation policy + 跨 surface 生命周期） |
| AC-22 | 删除不相关视频；清空 Ask 对话或诊断日志 | 仅保留与当前身份严格相关的合法检查点；不误复活用户已删除数据 | `PASS`（M2 精确 mutation policy） |
| AC-23 | Provider Resolve 延迟后 Secret 被更换；字幕读取等待期间用户换分 P | 第二次 guard 阻止模型请求/发布，修订变化会淘汰 checkpoint | `PASS`（M2 二次身份校验；含同时间戳与跨面板回归。**2026-11-19 定向修复 F-01/F-04**：`lease.validate(currentContext)` 原先比较获取时捕获的 `compareContext` 而忽略传入上下文，Final 后传入旧 context 等于没有做实时复核；现改为比较传入的最新上下文，并以 `resumeScoped` 获取期标记把 `taskId`/`workspaceEpoch` 归一化收敛为 resume 专属，普通 `acquire()` 全程零归一化。coordinator 在 Final 前与落盘前各做一次真实重采集后调用该 validate） |
| AC-24 | Model 成功但最终持久化抛错 / quota error | 呈现持久化故障，不标记为 Provider 可恢复；既有未完成写入与历史语义保持一致 | `PASS`（M2 persistence 前 discard 与既有错误回归） |

## 4. UI、隐私与工程门禁

| ID | 检查点 | 预期 | 状态 |
| --- | --- | --- | --- |
| AC-25 | Map、Reduction、Final API、Saving 逐阶段 UI | `3/5` 等数字正确、Progress 不倒退；Final API 仍可取消；只有 Saving 是旧 `finalizing` | `PASS`（M1/M2 阶段回归 + M3 恢复阶段：resuming 可取消，finalizing 才显示保存） |
| AC-26 | 用户在恢复前查看错误和费用提示 | 明确告知仅重试最后请求、可能计费、仅本 Side Panel/有限期有效；中英本地化键完整 | `PASS`（M3 组件与 i18n parity：中英文均含仅重试最后阶段、可能再次计费、仅当前侧边栏有效与剩余分钟） |
| AC-27 | HAR-like 含密钥/HTML/Prompt/字幕/模型摘要的模拟错误 | Toast、console、diagnostic export、storage 不含 Key、Headers、Request Body、任何 Map 文本；只允许阶段/状态/次数/时间 | `PASS`（M2 content-free metadata 与脱敏导出回归；未使用真实 HAR） |
| AC-28 | 全仓文档及打包审查 | 不增加 host permissions、网络上传端点、数据库表或迁移；无自动 HTTP 重试或 API Key 再存储 | `PASS`（main…候选 HEAD 范围/构建产物审查） |
| AC-29 | 先完成带 502 的纯 mock 端到端模拟 | 第一次 5×Map + 1×Final(502)；继续 0×Map + 1×Final(200)；真实运行记录可复核 | `PASS`（M3 黄金流程：真实 `runAnalysis` + 真实检查点 + 纯 Mock Provider） |
| AC-30 | 最终实现 PR 审查门禁 | Target RED→GREEN、全量 Bun、TypeScript、Chrome MV3 Build、`git diff --check`、需实施的浏览器 Smoke + 独立 SHA/范围审查 | `PASS`（M4-R04 当前源码复核：1700 pass / 0 fail / 6123 assertions（116 文件），TypeScript、Build、diff check、CfT Artifact Gate 与八组 Chrome Smoke 全 PASS；五文件 SHA256 与 R03 一致。M4 整体仍等待独立最终审查，尚未推送、合并） |

## 5. 具体实施测试文件建议

- `src/features/analysis/lib/run-analysis.test.ts`：Map/Reduce 完成后 Final 502 checkpoint、Schema repair、无自动重试、取消/非终态错误；M3 Final-only 恢复由 `run-final-only-analysis.ts`、`final-resume-coordinator.ts` 及对应测试覆盖。
- `src/features/analysis/lib/run-analysis-final-checkpoint.integration.test.ts`：真实一级/两级 Reduction 接缝、原始 Map 与归并身份、502 发布及 prepare/promote 异常完全失效；没有恢复模型请求。
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
| 2026-11-18 | M2 Reduction / `PASS` | 新增真实接缝套件 4 pass / 0 fail / 62 assertions；相关 4 套件 137 pass / 0 fail / 560 assertions；TypeScript exit 0 | 本地日志 `vsa-m2-resume-reduction-integration-final-20261118.log`、`vsa-m2-resume-checkpoint-suites-20261118.log`；提交 `bb778859a7a52f703d42782a0e10294c225e74fe` | 保持 M3 恢复执行 NOT RUN |
| 2026-11-18 | M2 Provider / `PASS` | 同时间戳执行元数据、跨面板 stale secrets 均有 RED→GREEN；Provider/lifecycle 66 pass、Settings revision 8 pass、Settings storage 11 pass、Ask 116 pass，均 0 fail | 本地日志 `vsa-m2-resume-provider-metadata-same-timestamp-{red,green}-20261118.log`、`vsa-m2-resume-cross-panel-stale-secrets-{red,green}-20261118.log`；提交 `44429c6c2061bd900f0558a757e3ccab9868d32c` | Draft PR 独立审查 |
| 2026-11-19 | M3 实施 / `PASS`（自动化） | 双身份准入 17 项、Final-only 执行 7 项、协调器五分支 17 项、黄金流程 4 项、可用性 10 项、组件 7 项、i18n 7 项全部 GREEN；普通分析 48 项与侧边栏/历史 137 项回归无回退 | 原始日志 `D:/files/vsa-m3-evidence-20261119/`（`m3-full-test.log`、`m3-typecheck.log`、`m3-build.log`、`m3-verify-artifact.log`、`m3-diffcheck.log`） | Draft PR 与独立审查 |
| 2026-11-19 | M3 门禁 / `PASS` | 全量 1605 pass / 0 fail / 5797 assertions（115 文件）；typecheck、build、`git diff --check` 退出 0；Chrome for Testing 156.0.8078.73 MV3 产物门禁 PASS | `m3-full-test.log`、`m3-typecheck.log`、`m3-build.log`、`m3-verify-artifact.log` | 交互 Smoke 仍需执行 |
| 2026-11-19 | M3 浏览器交互 Smoke / `NOT RUN` | 已用 CfT 156 + 真实产物启动扩展、加载 Side Panel 并渲染 UI，但从本地 stub 视频页进入真实分析链路时，YouTube 适配器走了 `readVideoInfo` 的 fallback 分支（`isReady:false`），分析按钮不可用。未取得端到端按钮证据 | `m3-sidepanel-smoke-attempt.log`（明确 `result: FAIL`，非通过） | 不得以 `verify:artifact` 顶替；需修正 stub 或用真实可访问视频页重跑 |
| 2026-11-18 | M2 候选全量门禁 / `PASS` | 改写前候选 `00a2a2df1287aabde9449d5fdb6f177426dd6170`：1517 pass / 0 fail / 5371 assertions（107 文件）；typecheck、build、工作树与 base diff check exit 0；Chrome for Testing 156.0.8078.73 产物门禁 PASS | 原始日志已复制到仓库外 `D:/files/vsa-m2-evidence-20261118/`；`vsa-m2-candidate-*-20261118.log` | 最终分支 SHA 必须重跑；独立审查仍为 NOT RUN |
| 2026-11-19 | M3 定向独立复核 / `PASS` | 独立复核确认 F-01～F-04 source-level CLOSED；HEAD `87ea663` 的 1684 pass / 0 fail / 6047 assertions（116 文件）与成功恢复 Smoke 证据获审阅。原 1605 / NOT RUN 记录为旧历史，不覆盖 | [PR #27 独立复核](https://github.com/Aaron-AVC/video-summary-assistant/pull/27#issuecomment-7006955545) | 收尾 AC-18 与当前状态文档 |
| 2026-11-19 | AC-18 真实生命周期 Smoke / `PASS` | CfT 156 + 真实 `build/chrome-mv3-prod` + 纯 Mock：刷新场景仅 5 Map + 1 Final(502)，刷新后 0 新增请求、无恢复 UI、无中间摘要或检查点持久化；重开场景先保存正常历史，再产生独立 502，真实销毁并新建 Side Panel target，历史 ID 保留、0 自动请求，随后新视频 5 Map + 1 Final(200) 成功保存 | 仓库外 `D:/files/vsa-m3-final-20261119/ac18-refresh-initial.log`、`ac18-reopen-second.log`；`ac18-reopen-initial.log` 是测试种子 502 配置错误的真实失败日志 | 候选 HEAD 再执行三 Smoke 与全量门禁 |
| 2026-11-19 | M3 收尾工程门禁 / `PASS`（待最终 SHA 绑定） | 工作树相对 `87ea663` 仅扩展 Smoke 与同步当前文档：1684 pass / 0 fail / 6047 assertions（116 文件）；typecheck、build、工作树及 Base diff check exit 0；CfT 156 MV3 Artifact Gate、黄金恢复、AC-18 刷新和关闭重开均 PASS；tracked 文件无 CRLF 工作树行尾 | 原始日志 `D:/files/vsa-m3-final-20261119/final-{bun-test,typecheck,build,artifact-gate,smoke-golden,smoke-refresh,smoke-reopen,diff-lf}.log`；提交后须以完整 SHA 复核，不将工作树证据冒充 SHA 证据 | 最终 HEAD 独立核验与合并授权 |
| 2026-11-21 | M4-R02 隔离重建 / `RECONSTRUCTED CANDIDATE` | 固定基线 `1bea4bc8f66525ca2edb248b185a8abf18ff3658`，五文件重建候选；不声称找回异常前字节级原件。R02 五文件历史 SHA256 与 Diff 独立保留 | `D:/files/vsa-m4-rebuild-evidence-20261120/M4-R02-reconstruction-report.md`、`final-sha256.txt`、`reconstructed-candidate.diff`；恢复证据 `D:/files/vsa-m4-recovery-evidence-20261120/` | M4-R03 定向审查 |
| 2026-11-21 | M4-R03 R02-F01 修复 / `PASS` | Final 已收到后 Repair HTTP 503 的回归由 RED `final-retryable` 转为 GREEN `structured-output-failed`；检查点 `empty`、零持久化、再次恢复 `unavailable`。独立复审 R02-F01 CLOSED、READY FOR FINALIZATION | R03 当时全量报告 1700 pass / 0 fail / 6123 assertions；本轮 R04 重新执行同源码门禁，原始证据见下一行，不将旧报告冒充本轮运行 | 最终成果整理与本地封板 |
| 2026-11-21 | M4-R04 当前源码门禁 / `PASS` | Coordinator 41 pass / 160 assertions；相关四套件 167 pass / 588 assertions；全量 Bun 1700 pass / 0 fail / 6123 assertions（116 文件）；TypeScript、Build、diff check、CfT Artifact Gate 与 `golden`、`refresh`、`reopen`、`cancel`、`source-switch`、`tab-switch`、`destructive`、`retry` 八组 Chrome Smoke 全 PASS。15 条验证命令均 exit 0；五文件均 LF 且哈希与 R03 相同 | 仓库外 `D:/files/vsa-m4-rebuild-evidence-20261120/R04/`：`{coordinator,related-four,bun-test,typecheck,build,diff-check,artifact-gate}.{log,stderr.log,command.txt,exit.txt}`，`smoke-<scenario>.*`，`source-sha256.txt`、`source-eol.txt`；Bun 主体输出在对应 `.stderr.log`；执行脚本 `run-core-gates.sh`、`run-browser-gates.sh` | M4 READY FOR FINAL REVIEW；未推送、合并，M5 尚未启动 |

**验收判定约束：** 有实际失败日志的用例才标 RED，有对应运行日志的才标 PASS。未执行的性能、成本或跨 Provider 回归一律保留 `NOT RUN`。

[返回文档索引](../README.md)
