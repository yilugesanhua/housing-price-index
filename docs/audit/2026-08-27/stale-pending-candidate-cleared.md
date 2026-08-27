# 清除缺少严格观察身份的待发布候选

- 状态：`superseded / fail_closed`
- 日期：2026-08-27
- 涉及月份：2026-07
- 触发提交：`f2052de4ac686016b3b41a5aba15a394b7d129ea`（`data: prepare automated monthly release`）

## 原因

该提交创建的 `ready` 待发布状态由旧提交 `08f1cd9fd0174af624287fa6818a6d18b9f8752c` 生成，缺少现行严格发现协议所需的 `cloud_slot_id`、`cloud_observation_id`、`cloud_payload_sha256`、`cloud_timing_status` 和 `cloud_handoff_identity`。现行 `inspect-pending-release.mjs` 因缺少时段身份而拒绝它。

同一提交还改写了同一官方原始内容批次的抓取时间和派生审计摘要。这不是官方来源内容修订，不能作为不同候选或发布重试的依据。

## 处理

1. 用可回退的反向提交移除无效的 `data/releases/auto-update-state.json` 与 `data/releases/pending-auto-release.json`。
2. 将对应批次文件恢复为候选创建前、已审计的字节内容；不删除官方原始 HTML 档案。
3. 不修改云端正式指针、正式发布目录、生产开关或小程序页面。

后续只能由真实严格发现时段生成新的候选；GitHub 必须读取并核验同一腾讯云观察对象，缺失时继续失败关闭。
