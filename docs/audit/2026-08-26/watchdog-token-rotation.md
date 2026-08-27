# 守护器令牌轮换记录（2026-08-26）

## 结果

- GitHub Fine-grained 令牌 `housing-watchdog-2026-rotated-2` 已在 GitHub 设置页重新生成；最后一次重新生成会使此前同一令牌的旧值失效。
- 令牌范围保持最小：仅 `yilugesanhua/housing-price-index`，Actions 读写，Metadata 只读；未授予 Contents、Secrets、Variables、Administration、Deployments 或 Pull requests 权限。
- 新值未写入仓库、文档、命令历史或对话；配置完成后已清除本机剪贴板。

## CloudBase 配置

- 环境：`cloud1-d3gpdx70w5d05c68c`
- 函数：`monthlyDataWatchdog`
- 更新方式：CloudBase CLI 合并更新，仅替换 `WATCHDOG_GITHUB_TOKEN`，保留其他环境变量。
- `WATCHDOG_DRY_RUN` 仍为 `true`；没有打开自动补触发，也没有修改正式发布开关。
- 配置回读仅确认令牌字段存在及 dry-run 值为 `true`，没有读取或记录令牌值。

## 线上核验

- 令牌配置完成后再次现场调用返回 `idle / already_dispatched`，对应已有的 `workflow_dispatch` 运行，说明函数能够使用最终新凭据读取 GitHub Actions。
- CloudBase 调用 RequestId：`f50d7702-294b-4a54-a8e5-4a7b5d7cb796`。
- 本次操作未触碰生产数据、正式 `current.json`、生产发布目录或小程序页面。

## 后续

在完成至少一个完整官方发布时间窗口的 dry-run 观察前，不得把 `WATCHDOG_DRY_RUN` 改为 `false`。生产自动发布仍须同时满足现行启用清单，仓库级 `AUTOMATIC_RELEASE_ENABLED` 和生产 Environment 级 `PRODUCTION_RELEASE_AUTHORIZED` 继续保持 `false`。

## 后续严格发现部署的状态更正（2026-08-26）

本记录描述的是令牌轮换阶段，不代表严格发现器的最终配置。随后部署的严格只读发现模式将 `WATCHDOG_GITHUB_AUDIT_ENABLED` 固定为 `false`，并只保留四个非敏感配置变量；当前 `monthlyDataWatchdog` 不配置或读取 `WATCHDOG_GITHUB_TOKEN`，也不会自动补发 GitHub 工作流。以上令牌轮换事实和旧令牌失效事实仍保留为历史审计，不能解释为当前云函数持有 GitHub 令牌。
