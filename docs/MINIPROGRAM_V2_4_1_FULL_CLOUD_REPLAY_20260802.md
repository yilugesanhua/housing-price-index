# v2.4.1 12 次完整云端回放记录 - 2026-08-02

状态：`passed_limited`（普通月度隔离云端回放已通过；不代表生产、真机或微信平台验收已经完成）。

本记录只证明本次完整云端月度自动更新演练的范围，不证明微信开发者工具编译、Android 或 iPhone 真机验收、微信审核、正式发布，也不证明生产自动发布已经开启。

## 范围与安全边界

- 候选代码：`main@53ac616`（`fix: validate pre-source replay padding`）。
- 回放工作流：`.github/workflows/full-auto-update-replay.yml`。
- 云端存储边界：只允许写入 `housing-data/rehearsals/<github-run-id>/full-auto-update-year/`。
- 生产 `housing-data/current.json` 和生产发布目录：不得触及。
- `AUTOMATIC_RELEASE_ENABLED`：保持 `false`。
- 任一月份失败时，回放必须在首个失败月份停止；修复后必须从第 1 轮重新执行完整 12 轮。

## 第 1 次尝试：第 1 轮前失败

- GitHub Actions 运行：`30751211902`，`main@7f9135c3574f20aca0eb1a23519f155ad9afdaee`。
- 结果：构造第一个模拟目标月份 `2025-07` 时失败，`completed_replay_count=0`。
- 错误：`snapshot source coverage cannot start after the client window`。
- 上传报告证明：`production_pointer_untouched=true`、`production_release_prefix_untouched=true`。

### 原因与修复

第一个历史 120 个月客户端窗口从 `2015-08` 开始，首个官方来源月份却是 `2016-01`。回放正确使用了仅含 `null` 的覆盖前填充，但远程包和客户端校验器错误地要求 `sourceCoverageStart <= coverageStart`。

修复后的失败关闭规则如下：

1. `coverageStart` 必须等于 120 个月客户端窗口的首月。
2. `sourceCoverageStart` 可以早于窗口或落在窗口内，但不能晚于窗口的最后一个月。
3. 当 `sourceCoverageStart` 晚于 `coverageStart` 时，之前每月的四个序列值必须都是 `[null, null, null, null]`，对应的 `releaseDates` 必须为空。
4. 填充区出现任何数值、非空发布日期、缺月，或来源起点晚于窗口，均必须在激活前失败。

这条规则已同时写入远程包构建器、完整快照校验器和小程序远程启动校验器，并补充了正反向回归测试。

## 云端重跑前的本地验证

- 远程数据和数据运行时定向测试：85 通过，0 失败。
- `npm.cmd run check`：通过；290 项小程序测试、44 项数据测试、17 项 Web 测试、3 项发布就绪测试、70,560 条记录校验和生产构建均通过。
- `npm.cmd run test:e2e`：40 通过。
- `apps/miniprogram/utils/data-integrity.js` 与 `apps/miniprogram/utils/data-runtime.js` 已同步到 `70城小程序技术验证/`，对应 SHA-256 完全一致。
- 本地隔离重跑：从 `2025-06 -> 2025-07` 至 `2026-05 -> 2026-06` 的连续 12 轮全部通过；内部管线总耗时 `89,772 ms`。
- 本地报告确认：`production_pointer_untouched=true`、`production_release_prefix_untouched=true`、`automatic_release_enabled=false`。

本地结果只是预检证据。下列当前提交上的 GitHub 云端回放是独立的云端证据。

## 第 2 次尝试：当前提交云端回放通过

- GitHub Actions 运行：[`30752209300`](https://github.com/yilugesanhua/housing-price-index/actions/runs/30752209300)，`main@53ac616`。
- 工作流结果：`success`；回放报告结果：`passed`；完成时间：`2026-08-02T15:14:35Z`。
- 范围：以 `2025-06` 为基线、以 `2026-06` 为最终目标的连续 12 轮普通月度回放，全部通过。工作流只写入 `housing-data/rehearsals/30752209300/full-auto-update-year/`。
- 生产安全：`production_pointer_untouched=true`、`production_release_prefix_untouched=true`、`automatic_release_enabled=false`。
- 数据正确性：每轮均发现官方页面、解析 560 条目标月份记录；`official-html-v7-product-housing-only` 和 `full-record-audit-v5` 与完整 126 批 / 70,560 条记录审计一致，历史记录无变化。
- 候选阻断：每轮生成 70 个城市分片；“删除一条官方记录”和“结构正确但篡改一项官方值”两类错误候选，均在上传或指针激活前被拒绝。
- 远程与客户端：每轮均在受保护指针切换前，对隔离 COS 中 72 个数据对象和 1 个控制对象完成哈希回读；小程序模拟客户端启用了完整 70 城数据包，数据来源变为远程，保存 70 城本地历史，切换城市时新增下载次数为 0。

### 每轮耗时

下表是隔离云端演练内部测得的耗时，不是对未来真实统计局发布日的承诺。发布日调度模型仍为：每 5 分钟检查一次；官方页面出现后正常预期 10 至 25 分钟；内部目标 30 分钟；45 分钟预警；任一校验失败则保留旧月份。

| 轮次 | 目标月份 | 来源发现和解析 | 失败关闭门禁 | 数据包生成 | 错误候选阻断 | 隔离上传、回读和切换 | 小程序激活 | 总耗时 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 2025-07 | 525 ms | 620 ms | 1,155 ms | 1,957 ms | 340,585 ms | 1,138 ms | 345,990 ms |
| 2 | 2025-08 | 343 ms | 565 ms | 1,089 ms | 2,450 ms | 232,364 ms | 802 ms | 237,622 ms |
| 3 | 2025-09 | 344 ms | 580 ms | 1,092 ms | 1,821 ms | 174,662 ms | 773 ms | 179,281 ms |
| 4 | 2025-10 | 342 ms | 573 ms | 1,091 ms | 1,793 ms | 225,909 ms | 784 ms | 230,500 ms |
| 5 | 2025-11 | 350 ms | 581 ms | 1,105 ms | 2,849 ms | 198,612 ms | 847 ms | 204,353 ms |
| 6 | 2025-12 | 354 ms | 598 ms | 1,098 ms | 1,886 ms | 201,219 ms | 833 ms | 205,997 ms |
| 7 | 2026-01 | 288 ms | 591 ms | 1,098 ms | 2,154 ms | 251,851 ms | 857 ms | 256,849 ms |
| 8 | 2026-02 | 364 ms | 626 ms | 1,123 ms | 2,894 ms | 208,825 ms | 845 ms | 214,684 ms |
| 9 | 2026-03 | 353 ms | 637 ms | 1,131 ms | 1,947 ms | 182,651 ms | 866 ms | 187,596 ms |
| 10 | 2026-04 | 364 ms | 638 ms | 1,174 ms | 2,870 ms | 196,763 ms | 865 ms | 202,683 ms |
| 11 | 2026-05 | 373 ms | 631 ms | 1,147 ms | 1,944 ms | 209,215 ms | 841 ms | 214,160 ms |
| 12 | 2026-06 | 353 ms | 625 ms | 1,108 ms | 1,920 ms | 202,898 ms | 856 ms | 207,768 ms |

隔离云端总耗时为 `2,687,483 ms`（44 分 47.483 秒），每轮平均 223.957 秒，最慢一轮为 345.990 秒。隔离上传、回读和切换阶段总共 `2,625,554 ms`，是全流程主要耗时来源。

### 问题与限制

- 本次没有发现新的失败或阻断问题。
- `REPLAY-PADDING-2025-07` 至 `REPLAY-PADDING-2025-11` 是 5 条信息记录，不是失败：前五个滑动 120 个月客户端窗口早于官方 `2016-01` 来源覆盖，分别需要 5 至 1 个月的历史空白填充。所有填充均为仅 `null` 且发布日期为空；覆盖范围内的全部数据和每轮目标月 560 条记录都与已核验来源档案完全一致。
- 工件问题清单中的 `REPLAY-001` 至 `REPLAY-009` 是此前尝试中已修复的问题，为便于追溯而保留，未在本次重新出现。
- 这是一次真实的隔离云端演练，不是生产写入、云函数部署、微信开发者工具编译、Android/iPhone 真机验收、微信审核或正式发布。因此它只增强 R02 的“普通月度云端回放”证据；历史修订故障回放和外部平台证据仍未完成。

## 版本绑定说明

本报告的证据绑定 `main@53ac616` 当时的 `v2.4.1` 候选。随后小程序客户端版本递增为 `v2.4.2`，因此本报告不得作为 `v2.4.2` 的云端回放证据；`v2.4.2` 新回放入口见 [`MINIPROGRAM_V2_4_2_FULL_CLOUD_REPLAY_20260802.md`](MINIPROGRAM_V2_4_2_FULL_CLOUD_REPLAY_20260802.md)。
