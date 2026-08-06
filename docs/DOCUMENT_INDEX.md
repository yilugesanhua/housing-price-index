# 文档索引与状态

更新日期：2026-08-06

本文件是项目文档的统一入口。当前产品与界面事实以 `apps/web/` 和 `apps/miniprogram/` 为准；小程序唯一机器可读源码版本来自 `apps/miniprogram/config/version.js`，截至本次整理其值为 `v2.5.15`。本文中的版本文字只是该次整理快照，不是第二版本源。`70城小程序技术验证/` 是同步副本，`release/miniprogram/` 是只读稳定归档。源码版本、历史测试或旧交接单均不等于微信平台已审核或发布。

## 当前权威规范

发生冲突时按 `AGENTS.md` 的优先级处理：

| 文档 | 职责 |
| --- | --- |
| [`AGENTS.md`](../AGENTS.md) | 项目执行规则、修改权限、目录职责和完成条件 |
| [`PRODUCT.md`](../PRODUCT.md) | 当前Web与小程序的产品范围、平台策略和品牌命名 |
| [`DATA_CONTRACT.md`](DATA_CONTRACT.md) | 官方来源、字段、560条月度快照、校验、修订和发布契约 |
| [`DESIGN.md`](../DESIGN.md) | 当前Web与小程序唯一权威设计规范 |
| [`ACCEPTANCE.md`](ACCEPTANCE.md) | 当前产品工程验收基线和外部验收边界 |
| [`MONETIZATION.md`](MONETIZATION.md) | 商业化边界；四档面积属于免费基础能力 |
| [`MINIPROGRAM_VERSIONING.md`](MINIPROGRAM_VERSIONING.md) | 小程序源码、同步副本、确定性ZIP、机器可读发布身份和只读归档规则 |
| [`MINIPROGRAM_DATA_UPDATE.md`](MINIPROGRAM_DATA_UPDATE.md) | 小程序自动数据更新、完整70城缓存、回滚和权限规则；“到点发现正式页面”是具体运行时刻的唯一权威文档来源；其中带日期的实施记录仅为 `historical_evidence`，当前生产模式和开关状态必须同时以实施状态登记、启用清单和外部平台现场核验为准 |

## 当前操作清单

这些文件用于执行或复核具体工作，不能覆盖权威规范：

| 文档 | 状态与用途 |
| --- | --- |
| [`README.md`](../README.md) | 当前仓库入口、命令和目录说明；只引用自动更新时间表，不维护Cron副本 |
| [`RELEASE_READINESS.md`](RELEASE_READINESS.md) | Web正式HTTPS发布检查及绑定当前提交、构建、数据、域名和有效期的目标声明契约 |
| [`MINIPROGRAM_LAUNCH_PREP.md`](MINIPROGRAM_LAUNCH_PREP.md) | 小程序账号、备案、审核和试运行准备 |
| [`AUTOMATION_ACTIVATION_CHECKLIST.md`](AUTOMATION_ACTIVATION_CHECKLIST.md) | 自动更新生产开关启用前的外部事项 |
| [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) | S/C/D/R/I/V已批准结论、当前实现差距、阻断范围和关闭证据的唯一登记；不另行定义产品或技术规则，定义缺失的历史项目必须明确标为不可复核 |
| [`MINIPROGRAM_LOCATION_SETUP.md`](MINIPROGRAM_LOCATION_SETUP.md) | 小程序模糊定位、腾讯位置服务、城市匹配和隐私边界配置 |
| [`data/corrections/README.md`](../data/corrections/README.md) | 历史数据修订包规则 |
| [`release/miniprogram/README.md`](../release/miniprogram/README.md) | 小程序稳定版本归档说明 |
| [`docs/miniprogram/住房小二-icons/README.md`](miniprogram/住房小二-icons/README.md) | 品牌图标素材说明 |

## 当前版本待完成证据

当前 `v2.5.15` 已从精确提交生成本地不可变候选，仍未完成绑定该候选的正式双真机记录、同提交CI、微信上传、审核、正式发布或线上回读。当前授权不上传、不审核、不发布、不部署和不稳定归档；旧版本证据不得用于关闭当前版本门禁。候选身份和待补证据见 [`MINIPROGRAM_V2_5_15_RELEASE_HANDOFF.md`](MINIPROGRAM_V2_5_15_RELEASE_HANDOFF.md)。

## 历史证据与记录

以下文件只证明其标注日期、提交、运行或候选版本。它们不得用于证明当前 `v2.5.15` 已通过验收，也不得反向要求当前页面恢复旧设计：

- [`ACCEPTANCE_EVIDENCE.md`](ACCEPTANCE_EVIDENCE.md)：始建于2026-07-19、部分数据证据更新至2026-07-28的Web验收矩阵。
- [`DELIVERY.md`](DELIVERY.md)：按日期追加的历史交付日志；只追加，不重写既有记录。
- [`COMPLIANCE_REVIEW.md`](COMPLIANCE_REVIEW.md)：2026-07-15合规工程记录，正式发布前须按当前主体、用途和规则复核。
- [`MINIPROGRAM_V2_3_0_RELEASE_HANDOFF.md`](MINIPROGRAM_V2_3_0_RELEASE_HANDOFF.md)：`v2.3.0`候选交接证据。
- [`MINIPROGRAM_V2_3_0_DEVICE_TEST.md`](MINIPROGRAM_V2_3_0_DEVICE_TEST.md)：`v2.3.0`未完成双真机验收模板。
- [`MINIPROGRAM_V2_4_9_DEVICE_TEST.md`](MINIPROGRAM_V2_4_9_DEVICE_TEST.md)、[`MINIPROGRAM_V2_4_9_RELEASE_HANDOFF.md`](MINIPROGRAM_V2_4_9_RELEASE_HANDOFF.md)：`v2.4.9`候选及其历史证据；不得代替 `v2.5.15` 的验收、交接或发布证据。
- [`MINIPROGRAM_V2_4_0_LAUNCH_AUDIT.md`](MINIPROGRAM_V2_4_0_LAUNCH_AUDIT.md)、[`MINIPROGRAM_V2_4_0_DEVICE_TEST.md`](MINIPROGRAM_V2_4_0_DEVICE_TEST.md)、[`MINIPROGRAM_V2_4_0_RELEASE_HANDOFF.md`](MINIPROGRAM_V2_4_0_RELEASE_HANDOFF.md)：`v2.4.0`未完成候选模板，只读保留，不得转填为当前版本证据。
- [`MINIPROGRAM_V2_4_2_LAUNCH_AUDIT.md`](MINIPROGRAM_V2_4_2_LAUNCH_AUDIT.md)、[`MINIPROGRAM_V2_4_2_DEVICE_TEST.md`](MINIPROGRAM_V2_4_2_DEVICE_TEST.md)、[`MINIPROGRAM_V2_4_2_RELEASE_HANDOFF.md`](MINIPROGRAM_V2_4_2_RELEASE_HANDOFF.md)、[`MINIPROGRAM_V2_4_2_FULL_CLOUD_REPLAY_20260802.md`](MINIPROGRAM_V2_4_2_FULL_CLOUD_REPLAY_20260802.md)：`v2.4.2`候选及其历史证据；不得代替 `v2.5.15` 的验收、交接或发布证据。
- [`audit/2026-07-29/miniprogram-launch-audit.md`](audit/2026-07-29/miniprogram-launch-audit.md)：`v2.3.0`上线前自动审查。
- [`MINIPROGRAM_12_MONTH_REPLAY_30338521130.md`](MINIPROGRAM_12_MONTH_REPLAY_30338521130.md)、[`MINIPROGRAM_12_MONTH_REPLAY_30372208959.md`](MINIPROGRAM_12_MONTH_REPLAY_30372208959.md)、[`MINIPROGRAM_12_MONTH_REPLAY_30411300588.md`](MINIPROGRAM_12_MONTH_REPLAY_30411300588.md)：指定提交和GitHub运行的12个月隔离回放。
- [`audit/2026-07-19/audit-notes.md`](audit/2026-07-19/audit-notes.md)、[`audit/2026-07-20/audit-notes.md`](audit/2026-07-20/audit-notes.md)：指定日期的Web审查记录。
- [`design-system/70/MASTER.md`](../design-system/70/MASTER.md) 与 [`design-system/70/pages/overview.md`](../design-system/70/pages/overview.md)：2026-07-16设计工具输出，非当前设计规范。

## 维护规则

1. 新的当前规则写入对应权威规范，不在审计或交接文件中另建一套冲突规则。
2. 历史证据保留原始结论，只增加状态边界；不得把旧候选名称或旧测试结果改写成当前事实。
3. `apps/miniprogram/config/version.js` 是当前小程序版本的唯一机器源。当前源码版本发生变化时，更新本索引、产品基线和对应版本验收入口；版本绑定模板与历史证据保留其固定版本号，不得批量替换。未来CI必须校验入口快照、候选证据文件名和身份字段与机器源一致；该门禁实现前按 `IMPLEMENTATION_STATUS.md` 的I14保持未通过。
4. 用户未明确要求的界面、文案、结构、交互或功能不得因文档整理而修改。
5. 权威规范中的目标要求不等于当前实现；实现与验证状态只在 `IMPLEMENTATION_STATUS.md` 登记，并必须绑定可复查证据。
6. 文档修改不能关闭代码问题。只有实现、测试和必要的云端或真机证据全部完成后，才允许把状态改为通过。
7. 月度发现的具体北京时间和Cron只在 `MINIPROGRAM_DATA_UPDATE.md` 维护；其他文档仅链接。可执行工作流仍须由CI与该权威时间表做规范化相等校验。
8. `PRODUCT.md`、`DESIGN.md` 和 `ACCEPTANCE.md` 使用 `[共同]`、`[Web]`、`[小程序]`、适用时的 `[候选]` 明确平台范围；不得把Web专属交互套用到小程序，或反向要求Web复制小程序布局。
9. 只读发现报告、带日期云端运行和本地测试都不是当前生产状态声明。任何“已部署、已启用、已审核、已发布、无人值守”结论必须绑定对应外部系统的当前证据和复核时间。
