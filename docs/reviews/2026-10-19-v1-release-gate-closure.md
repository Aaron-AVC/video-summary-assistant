# V1 Release Gate Closure — Documentation Record

日期：2026-10-19
项目：Video Summary Assistant
范围：documentation only；本次不修改产品代码、测试、依赖、Manifest、数据库 migration 或历史审计结论。

## 1. Final decision

**V1 RELEASE GATE — PASS**

本次 closure 的基线 HEAD 为 `874bae094541b0d7fdc8399f21f29a881993b8f4`。现有证据未留下 V1 发布阻断项：SEC-01 的敏感 timedtext URL 持久化/export blocker 已由后续修复和浏览器迁移验证关闭；DEP-03R1 未确认 P0/P1 依赖安全阻断；真实 Chromium smoke 覆盖的核心 V1 流程全部通过。

这是一份当前发布门结论记录，不改写历史审计。原始架构审计当时的 **RELEASE HOLD / SEC-01 P1** 在其审计基线下是正确结论；新的 SEC-01、SEC-01R1、依赖安全和真实浏览器证据关闭了当时的 blocker。

## 2. Baseline / commit chain

相关提交链：

`f60795c6918297a4278f5673288a08b91c1d24aa`
→ `d8f9c5d3a233ada62f374c5637349363be54df7f` — `fix: prevent signed transcript URL persistence and export`
→ `05ca78e409f2ea422759430303e40402c1b8b28b` — `fix: prevent SEC-01 cleanup from resurrecting data`
→ `739fa7e99065b3dbfc1986883bcf622590ba2cff` — `docs: add V1 architecture and dependency audit`
→ `6fe73bbb74f1107ddc6aa21c0e2fed7b0d36e776` — `docs: fix V1 audit trailing whitespace`
→ `874bae094541b0d7fdc8399f21f29a881993b8f4` — `docs: add V1 dependency security review`

历史架构证据：`docs/reviews/2026-10-18-v1-architecture-audit.md`。该文件保持原样。
依赖安全证据：`docs/reviews/2026-10-18-v1-dependency-security-review.md`。该文件保持原样。

## 3. SEC-01 remediation closure

SEC-01 修复提交 `d8f9c5d3a233ada62f374c5637349363be54df7f` 阻止 signed YouTube timedtext URL 进入新的 transcript cache/snapshot 持久化记录和 JSON export，并保留 transient fetch 所需的完整 URL。

SEC-01R1 并发修复提交 `05ca78e409f2ea422759430303e40402c1b8b28b` 保持 export read-only，避免 cleanup-induced data resurrection；同时避免 diagnostic read 在普通读取时重写整个日志数组，保留清理语义和历史数据完整性。

### Browser security validation

- `transcriptCache` 新记录 `sourceUrl = null`：PASS。
- `transcriptSnapshots` 新记录 `sourceUrl = null`：PASS。
- JSON export 成功解析：PASS。
- 检查 transcript rows：4 条。
- non-null `sourceUrl`：0。
- timedtext URL detected：`False`。
- export boundary：PASS。

### v4 → v5 migration evidence

在隔离 Chromium profile 中，从旧基线 `f60795c` 构造 v4 数据，写入含 synthetic `sourceUrl` 的 `transcriptCache` 和 `transcriptSnapshots` 记录；随后通过同一扩展加载路径升级到当前 v5。

结果：两条历史记录最终均为 `sourceUrl = null`。
结论：**SEC-01 v4 → v5 Browser Migration PASS**。

## 4. Browser smoke results

用户在真实 Chromium 环境完成以下 smoke，结果全部 PASS：

- extension load、Side Panel、Options。
- YouTube transcript/search/timestamp jump。
- Analysis、Chapters、Ask、citation jump。
- Bilibili BV 与 multi-P identity isolation。
- history restore、categorized clear、clear all。
- i18n auto、zh-CN、en 与 cross-page sync。
- refresh、video switch、cancel、close side panel stability。

这些结果是 **user-run real browser smoke**，不是本轮 Codex 重新执行的模拟结果。

## 5. Dependency security result

`docs/reviews/2026-10-18-v1-dependency-security-review.md` 的 DEP-03R1 结论为 **REVIEW PASS**：

- 45/45 OSV advisories covered。
- `EXPLOITABLE`：1（Parcel dev-server，仅开发环境，P2）。
- `NOT APPLICABLE`：43。
- `UNVERIFIED`：1（tsup，P2）。
- P0 = 0；P1 = 0；P2 = 8；Accepted Debt = 37。
- 未确认已发布 MV3 扩展存在 dependency release blocker。

## 6. Accepted P2 debt

以下项目保留为非阻断 follow-up，不改变当前 V1 gate：

1. Parcel dev-server origin validation：仅在 `plasmo dev` 开发环境、服务器运行且开发者访问恶意页面时成立。
2. `sharp` / libvips、libheif、librsvg 三项构建链 advisory：当前仅处理受信任的 checked-in PNG 图标。
3. PostCSS source-map 文件读取/路径穿越三项 advisory：当前 CSS 与 source-map 输入由仓库控制。
4. `tsup` advisory：OSV 未提供明确 fixed version，实际当前执行路径仍需后续定向确认。

这些债务不等同于最终扩展运行时暴露，也不授权将不受信任的图片、SVG、CSS、YAML、CSP 输入接入当前 V1 构建流程。

## 7. Validation provenance

### Codex / automated validation

以下结果来自已完成的 SEC-01R1 最终验证报告，本次 closure 没有冒充重新执行：

- `bun test`：426 pass / 0 fail。
- project-local `tsc --noEmit`：PASS。
- project-local Plasmo production build：PASS。
- `git diff --check`：PASS。

DEP-03R1 为只读依赖安全审计，覆盖全部 45 项公告并完成 lockfile 路径与最终产物暴露分析。

### User-run real browser smoke

本 closure 采用用户提供的真实 Chromium smoke 和 SEC-01 migration/export 安全验证结果；未将历史的 `Browser smoke: NOT RUN` 记录冒充当前状态。

### Independent review

原始架构审计文件保持不变，作为当时 RELEASE HOLD / SEC-01 P1 的历史证据。后续 SEC-01R1 并发修复、DEP-03R1 REVIEW PASS、真实浏览器 smoke、export boundary 与 v4→v5 migration evidence 构成当前 gate 的关闭依据。

## 8. Remaining non-blocking follow-ups

- 在敏感工作区使用 `plasmo dev` 前，完成 Parcel dev-server origin validation 的定向修复或等效配置验证。
- 进行兼容性测试后，定向处理 `sharp`/图像构建链和 PostCSS source-map advisory。
- 核实 `tsup` advisory 的真实受影响范围与 fixed release。
- 若未来引入用户控制的图像、SVG、CSS、YAML、CSP、SSR 或其他构建输入，重新进行依赖可利用性审计。

## 9. Scope and Git discipline

本次 closure 仅允许修改：

- `TASK_STATE.md` 顶部当前任务状态。
- 本文件。

未修改产品代码、测试、`package.json`、`bun.lock`、Manifest、migration、历史架构审计或依赖安全报告；未创建 commit；未 Push。
