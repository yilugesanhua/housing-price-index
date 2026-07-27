# 每月自动更新启用清单

本文只记录必须在外部账号、真实云环境或真机中完成的启用事项。代码实现和常规验证不要求维护人员手工执行命令。

## 当前结论

- 自动发现、候选生成、全量数据门禁、受限发布、发布后守卫、自动回滚、待发布恢复、私有审计和24小时监测代码已实现。
- `npm run check`、`npm run test:e2e`、小程序/自动化故障测试和GitHub Actions静态检查已通过。
- 私有仓库 `yilugesanhua/housing-price-index` 已创建，初始提交 `4e0713e` 已推送，GitHub Actions `ci / verify` 已通过。
- `housing-data-production` Environment 已创建；仓库级和Environment级 `AUTOMATIC_RELEASE_ENABLED` 均为 `false`，且尚未配置任何生产Secret。
- 当前GitHub套餐不支持私有仓库分支保护；GitHub API明确要求升级GitHub Pro或将仓库公开。项目必须保持私有，因此分支保护仍是启用前阻塞项。
- 生产开关必须保持关闭，直到下面的测试云演练、双真机和权限检查全部完成。
- 当前已发布微信版本 `v2.0.2` 不包含远程更新客户端；完成下列事项前，不得宣称线上用户已获得自动更新能力。

## 需要维护人员参与

1. 决定是否升级GitHub Pro以启用私有仓库分支保护。不得通过公开仓库绕过此项。
2. 在腾讯云创建或授权最小权限CI服务身份时，完成必要的扫码、短信、2FA或实名确认。密钥不得粘贴到聊天、代码、日志或普通仓库变量。
3. 确认测试云环境或与生产完全隔离的测试目录。测试必须覆盖上传中断、指针中断、损坏文件、凭据失效、守卫失败、自动回滚成功和回滚失败报警。
4. 分别在一台Android和一台iPhone上完成首次在线、首次离线、旧缓存、清缓存、定位授权、弱网和图表交互验收。
5. 确认上传首个包含远程数据客户端的小程序版本并提交微信审核。
6. 上述证据全部通过后，明确确认允许把仓库级和GitHub Environment级 `AUTOMATIC_RELEASE_ENABLED` 从 `false` 改为 `true`。

除身份验证、真机操作和最终确认外，其余仓库初始化、工作流配置、环境变量录入、测试执行和结果核对由Codex完成。

## GitHub配置目标

- 私有仓库已创建；默认分支保护待GitHub Pro启用，目标是禁止强制推送并要求 `ci / verify` 通过。
- Environment `housing-data-production` 已创建。
- 仓库级和Environment级变量已设置：`AUTOMATIC_RELEASE_ENABLED=false`。
- 写入服务身份Secrets：`TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY`。
- 只读监测身份Secrets：`TENCENTCLOUD_MONITOR_SECRET_ID`、`TENCENTCLOUD_MONITOR_SECRET_KEY`。
- 生产Secrets不对Fork、Pull Request、任意分支或手动拼接参数开放。

## 启用前证据

- GitHub Actions中的 `ci`、只读发现、候选准备、生产发布恢复和24小时监测工作流语法有效。
- 测试云完整发布后，云函数、`current.json`、清单、bootstrap和70个城市分片全部回读一致。
- 故障演练证明线上旧指针保持不变，或在新指针守卫失败后自动恢复。
- 私有审计包包含当月压缩原始HTML、批次元数据、官方日程、发现/生产门禁、发布报告和所有文件哈希。
- 正式小程序版本通过双真机验证并完成微信审核。

## 启用后正常月份

维护人员无需开机、运行命令、上传小程序版本或确认数据版本。只有官方日程冲突、页面结构变化、历史修订、数据门禁失败、云权限失效或自动回滚失败时进入人工隔离。
