# R-003 竞品测试结果记录模板

> **TEMPLATE — 未执行**。复制后按真实执行日期建立测试批次；只填实测数据和有来源的观察。汇总分析参见 [评测协议](video-benchmark-protocol.md)，阶段性公开功能信息见 [研究报告](2026-11-17-competitor-landscape.md)。

## A. 测试批次

- 执行日期（含时区）：
- 评测者：
- 环境（Windows / Chrome 或 Edge 版本 / 地区 / 测试 Profile）：
- 本项目 Git HEAD 与构建产物版本：
- 竞品版本、安装来源与账号/套餐：
- Provider / Model 标识（不要记录 Key）：
- 结果文件存放目录（原始数据在本地，不随仓库公开）：
- 本次已执行/未执行/跳过的测试用例：

## B. 样本登记

| Case ID | 实际视频 URL | 时长 / 语言 | 当前原生字幕来源与可用性 | 验证日期 | 补充备注 |
| --- | --- | --- | --- | --- | --- |
| Y-01～Y-10 | 待选择 | — | `NOT CHECKED` | — | — |
| B-01～B-06 | 待选择 | — | `NOT CHECKED` | — | — |
| S-01～S-02 | 复用已选视频 | — | `NOT CHECKED` | — | — |

## C. 单项操作记录（每次运行追加一行）

| 时间 | 产品/版本 | Case ID | Feature | Eligible / Unsupported / Blocked | Attempted? | 结果 | 秒数（冷/热） | 请求成本来源 | 证据 ID |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | `NOT CHECKED` | `NO` | `NOT RUN` | — | — | — |

**结果建议枚举**：`PASS`、`FAIL`、`PARTIAL`、`INCONCLUSIVE`、`NOT RUN`、`UNSUPPORTED`、`BLOCKED`。不要把 `NOT RUN` 当成 `FAIL`。

## D. 引用真实性人工抽查

| 产品 | Case ID | 摘要中的主张/跳转秒数 | 真实视频/字幕证据（脱敏） | correct / partially correct / incorrect / unverifiable | 备注 |
| --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | 未开始 |

## E. 汇总（完成测试后填写）

| 产品 | 支持的已覆盖场景 | 实际尝试 N | 字幕成功 / 尝试 | 总结成功 / 尝试 | 引用抽查（对/全） | 冷启动中位秒数 | 热缓存中位秒数 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Video Summary Assistant | — | — | — | — | — | — | — |
| Video Flow | — | — | — | — | — | — | — |
| BiliScript | — | — | — | — | — | — | — |
| Glasp | — | — | — | — | — | — | — |
| Eightify | — | — | — | — | — | — | — |
| YouTube Bilibili AI Summarizer | — | — | — | — | — | — | — |

## F. 结论与实际决策

- 用户高频任务中最受影响的 3 个缺口：
- 可复现的竞争差异（附证据）：
- 可接受的成本 / 隐私取舍：
- 对 F-001 / F-002 / F-003 / F-005 排序是否需要调整：
- 新增问题 / Issue：
- 经批准的下一项工作与批准依据：

> 初始状态：全部 `NOT RUN`；不得填写推测得分、伪造测试日期或将商店宣称当实测。
