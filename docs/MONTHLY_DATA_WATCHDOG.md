# 月度自动更新独立守护器

## 当前状态

代码和本地测试已完成。2026-08-24 已部署到 CloudBase 环境 `cloud1-d3gpdx70w5d05c68c`，函数 `monthlyDataWatchdog` 当前为 `Active`，并已配置 `monthlyDataWatchdogCron` 定时触发器。首次线上 dry-run 返回 `schedule_observed`，确认能读取 GitHub Actions 且未触发工作流。守护器只查询 GitHub Actions 的运行记录：在一个应出现的定时检查超过宽限时间仍未出现时补触发 `monthly-data-check.yml`，并把长时间停留在排队/运行中的候选发布记录为一次性告警信号。

它不读取腾讯云生产数据，不持有 `TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY`、`TENCENTCLOUD_MONITOR_SECRET_ID` 或 `TENCENTCLOUD_MONITOR_SECRET_KEY`，也不能修改 GitHub 仓库变量、Environment 变量或 Secrets。

实现位置：

- `apps/miniprogram/cloudfunctions/monthlyDataWatchdog/`：可部署的腾讯云函数。
- `scripts/miniprogram/watchdog-decision.mjs`：本地复用的决策入口。
- `scripts/miniprogram/watchdog-decision.test.mjs`、`scripts/miniprogram/watchdog-cloud.test.mjs`：本地测试。

## 需要维护人操作的部分

### 1. 创建最小权限 GitHub 令牌

创建一个只属于本仓库的 Fine-grained personal access token，权限只给：

- Actions：Read and write（读取运行记录并补发 `workflow_dispatch` 必须用到）。
- Metadata：只读（GitHub 自动要求）。

不要给 Contents、Secrets、Variables、Administration、Deployments 或 Pull requests 权限。令牌值不要发给我，也不要写入仓库。

### 2. 部署云函数

在项目根目录打开 PowerShell，确认 `tcb` 命令可用后执行：

```powershell
tcb login
tcb fn deploy monthlyDataWatchdog --dir apps/miniprogram/cloudfunctions/monthlyDataWatchdog --force -e cloud1-d3gpdx70w5d05c68c
```

这里的 `--dir` 明确告诉 CLI 从本项目的守护器目录部署，不会误选其他云函数。CloudBase 官方文档要求定时触发器使用 7 段格式（秒、分、时、日、月、周、年）。

如果提示没有 `tcb`，先执行：

```powershell
npm install -g @cloudbase/cli
```

### 3. 配置环境变量

在腾讯云 CloudBase 控制台打开：云函数 → `monthlyDataWatchdog` → 配置 → 环境变量，填写：

| 变量 | 值 |
| --- | --- |
| `WATCHDOG_GITHUB_TOKEN` | 第1步创建的令牌 |
| `WATCHDOG_REPOSITORY` | `yilugesanhua/housing-price-index` |
| `WATCHDOG_WORKFLOW` | `monthly-data-check.yml` |
| `WATCHDOG_PUBLISH_WORKFLOW` | `monthly-data-auto-publish.yml` |
| `WATCHDOG_DEFAULT_BRANCH` | `main` |
| `WATCHDOG_DRY_RUN` | `true`（先观察，确认无误后再改为 `false`） |
| `WATCHDOG_GRACE_MINUTES` | `10` |
| `WATCHDOG_COOLDOWN_MINUTES` | `15` |
| `WATCHDOG_STALL_MINUTES` | `30` |

不要在这个函数配置任何腾讯云生产数据密钥或正式发布密钥。

### 4. 创建守护器状态集合

在 CloudBase 数据库中新建集合 `monthlyDataWatchdog`，保持默认安全规则，只允许该云函数使用。这个集合只保存“某个时间窗口是否已经领取补触发名额”的小记录，不保存业务数据。

### 5. 增加定时触发器

在同一云函数的触发器中新增“定时触发器”：

- Cron：`0 */5 * * * * *`（每 5 分钟；CloudBase 的 7 段格式）
- 事件内容：`{}`
- 时区：函数内部按 GitHub 工作流使用的 UTC 时间判断窗口；创建后在控制台确认触发器显示的时区。

如果使用 CLI 创建触发器，必须先在 `cloudbaserc.json` 写入该函数的触发器配置；为避免误改现有云函数，建议直接在 CloudBase 控制台点击“新增触发器”，然后确认它显示为 `0 */5 * * * * *`。

先保持 `WATCHDOG_DRY_RUN=true` 运行至少一个完整的官方发布时间窗口。日志中看到 `would_dispatch` 只表示“判断应补触发”，不会真的触发；看到 `schedule_observed` 表示定时任务已经出现；看到 `already_dispatched` 表示本窗口已经补过，不会重复触发；看到 `would_alert` 表示候选发布运行超过30分钟仍未结束；看到 `schedule_failed` 表示原定时任务已经启动但失败，守护器不会盲目再开第二次，应先查看该运行的失败原因。

确认日志和 GitHub Actions 运行记录正常后，才把 `WATCHDOG_DRY_RUN` 改为 `false`。第一次正式补触发后，应在 GitHub Actions 中看到一个 `workflow_dispatch` 的 `monthly-data-check` 运行。`candidate_stalled` 只产生 CloudBase 日志告警并按发布运行 ID 去重，不会自动重启或重复发布；应根据该运行日志人工处理。

## 安全边界和回退

- 守护器只拥有 GitHub Actions 运行读取和工作流补触发权限；它不能发布数据。
- GitHub 工作流自身的生产开关、候选门禁和生产密钥仍按原有门禁执行。
- 关闭守护器只需在 CloudBase 控制台停用该定时触发器，或把 `WATCHDOG_DRY_RUN` 保持为 `true`。
- 本函数没有自动修改生产指针、生产数据或小程序页面。

## 本地自测

在项目根目录运行：

```powershell
node --test scripts/miniprogram/watchdog-decision.test.mjs scripts/miniprogram/watchdog-cloud.test.mjs
```

看到全部测试通过，才适合进入部署步骤。测试使用模拟 GitHub API，不会联网、不需要密钥，也不会触发工作流。
