# 月度数据严格发现器与 GitHub 审计

## 固定分工

`monthlyDataWatchdog` 不再是“每5分钟检查 GitHub 是否漏跑”的主守护器。它现在是腾讯云中的严格只读发现器，和 GitHub Actions 共同组成一条流程：

| 部分 | 固定职责 | 不能做什么 |
| --- | --- | --- |
| 腾讯云 `monthlyDataWatchdog` | 每分钟被唤醒，按北京时间领取09:15至17:55的27个发现时段；读取固定生产 `current.json`、核验官方双源日程和正式列表，写时段记录及不可变观察报告/交接对象 | 不能上传业务数据、修改正式指针、切换版本、改小程序页面或使用生产数据写凭据 |
| CloudBase 数据库 `monthlyDataWatchdog` 集合 | 保存时段租约、尝试次数、迟到/失败原因和观察报告 | 不保存完整70城数据，不作为正式数据源 |
| GitHub `monthly-data-check.yml` | 日程同步、独立审计、可复现报告、人工重放和候选工作流入口 | 不能作为严格时段的唯一时钟；晚到结果不能覆盖腾讯云时段记录 |
| GitHub 受保护发布工作流 | 仅在未来所有独立门槛通过且两个生产开关均为精确 `true` 时，构建候选并执行唯一正式数据写入 | 腾讯云发现器不拥有这条写入路径 |

腾讯云与 GitHub 使用同一个 `discovery-contract.js`。时段、官方URL白名单、双源日程、月份比较、交接身份和哈希规则不得各自复制或放宽。

## 运行规则

- CloudBase 定时触发器使用七段 Cron：`0 * * * * * *`，即每分钟第0秒唤醒函数。
- 函数内部使用北京时间计算时段。09:15至17:55共27个时段，每个时段最晚在计划时间后2分钟开始访问发现逻辑；晚于2分钟必须记为 `late`。
- 时段由数据库事务和可过期租约领取。重复触发、并发调用和重试都使用同一个 `slot_id`，不会重复处理或制造第二份交接。
- 单个时段最多尝试3次，租约为720秒。20分钟时段结束或18:00截止后不再开始新的发现；记录 `failed` 或 `expired` 后等待下一合法时段或人工处理。
- 发现结果只有 `waiting`、`current`、`update_available` 或 `anomaly`。`update_available` 仅生成固定身份的观察报告和交接，不会修改正式数据。
- 每个成功观察同时写入固定对象 `housing-data/discovery/observations/<sha256(slot_id)>.json`；对象只含时段、指针身份、官方来源摘要、结果和哈希，不含完整70城业务数据、令牌或密钥。重复写入必须逐字节一致，否则失败关闭。
- GitHub 只读发现工作流按同一 `slot_id` 读取该对象；只有对象状态为 `update_available`、时序为 `on_time`，且与 GitHub `handoff.json` 的月份、官方URL、幂等键和交接身份全部一致时，候选门禁才可通过。
- GitHub 审计补发默认关闭。`WATCHDOG_GITHUB_AUDIT_ENABLED=false` 时函数完全不读取 GitHub，也不需要 GitHub 令牌。

## 云函数配置

云环境固定为 `cloud1-d3gpdx70w5d05c68c`，配置基线在 [`cloudbaserc.json`](../cloudbaserc.json)。部署时只保留下列非敏感变量：

| 变量 | 值 | 用途 |
| --- | --- | --- |
| `MONTHLY_DISCOVERY_LEASE_SECONDS` | `720` | 防止重复执行的可过期租约 |
| `MONTHLY_DISCOVERY_MAX_ATTEMPTS` | `3` | 单个时段的最多尝试次数 |
| `WATCHDOG_GITHUB_AUDIT_ENABLED` | `false` | 保持 GitHub 补发审计关闭 |
| `WATCHDOG_DRY_RUN` | `true` | 仅适用于旧 GitHub 审计路径；不阻止严格只读发现 |

函数不配置 `WATCHDOG_GITHUB_TOKEN`、旧的宽限/冷却/补查变量、腾讯云生产写凭据或任何可改写正式数据的密钥。GitHub 的只读监测身份只允许读取 `housing-data/discovery/observations/*` 和现有正式只读对象。旧令牌轮换记录仅作为历史证据，见 [`audit/2026-08-26/watchdog-token-rotation.md`](audit/2026-08-26/watchdog-token-rotation.md)。

## 2026-08-26 当前部署回读

- CloudBase 环境 `cloud1-d3gpdx70w5d05c68c` 中的 `monthlyDataWatchdog` 已部署为 `Nodejs20.19`、`index.main`、256 MB、600 秒，函数状态为 `Active`。
- 旧触发器已删除，当前唯一启用触发器为 `monthlyDataWatchdogCron`，七段 Cron 精确为 `0 * * * * * *`，绑定状态为 `on`。
- 配置现场回读确认只有本规范列出的4个非敏感变量；`WATCHDOG_GITHUB_AUDIT_ENABLED=false`，`WATCHDOG_DRY_RUN=true`。函数不读取 GitHub，也不会自动补发工作流。
- 修复 SDK 不存在文档和 `_id` 写入问题后，手动调用返回 `strict_status=idle`，数据库成功保存28个合法时段记录；调用发生在当日18:00截止之后，因此这些记录按规则为 `expired`，不能作为准时发现证据。
- 正式 `housing-data/current.json` 只读回读为 `2026-06`、原始 SHA-256 `d15b9ea0727f2e88b6aa936a3959396e8673ac32c60c873931ffac8934d0989c`；调用前后未改变正式指针或正式数据。
- 该回读只证明函数已部署、触发器已启用和失败关闭可写入；完整27个发现时段的线上观察仍待下一官方发布时间窗口。
- 本轮新增的 GitHub 观察门禁已在本地通过；CloudBase 函数重新部署后，必须现场回读一个观察对象，确认 GitHub 只读身份能够按 `slot_id` 读取且无法读取白名单外对象，才能关闭该连接的外部验证差距。

## 部署与核验顺序

1. 部署函数源码和上表非敏感配置。
2. 删除旧的5分钟触发器，创建每分钟触发器；确认函数和触发器均指向 `monthlyDataWatchdog`。
3. 在不含生产写凭据的条件下手动调用一次函数，只检查返回的时段状态、函数日志和数据库记录，不读取或打印任何环境变量。
4. 现场复读 GitHub 两个生产开关、生产 `current.json` 身份和最新函数运行，确认没有正式数据写入。
5. 严格发现的有限观察门槛按`MONTHLY_DATA_AUTOMATION_PLAN.md`执行：连续10个计划发现时段均须单次、准时、成功且与唯一观察对象身份一致。第10个时段完成后立即只读复核并登记结论，不等待当天27个时段结束。当天17:55后如另行进行27时段完整审计，它仅作为持续运行健康检查；必须如实记录后续异常，但不是有限观察门槛，也不能拖延或改写已完成的10次结论。

部署成功或一次手动调用只证明“已部署”或“本次调用可用”，不能证明连续10个时段均准时，也不能证明自动发布已启用。

## 回退与故障处理

- 需要停止严格发现时，只停用 CloudBase 定时触发器；不要删除时段或观察报告，更不要修改生产数据。
- 官方页面、日程、生产指针或数据库不可用时，函数保留原因和时间，保持上一份正式数据不变。
- 发现 `late`、`failed`、`expired` 或 `anomaly` 时，先保留报告和日志，再核对官方来源、时段记录和云函数配置；不得通过重跑或改写记录把失败伪装成成功。
- 任何正式发布、回滚、状态部署和待发布恢复仍只按 [`AUTOMATION_ACTIVATION_CHECKLIST.md`](AUTOMATION_ACTIVATION_CHECKLIST.md) 执行。当前 `AUTOMATIC_RELEASE_ENABLED` 和 `PRODUCTION_RELEASE_AUTHORIZED` 必须保持关闭。

当前实现与外部部署、实际窗口验证的分别状态只在 [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) 登记。
