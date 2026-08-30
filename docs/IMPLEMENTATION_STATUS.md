# 实施状态登记

更新日期：2026-08-30

## 2026-08-30 `v2.5.28` 客户端与平台状态（维护人确认）

- 当前工作区 `apps/miniprogram/config/version.js` 与 `70城小程序技术验证/config/version.js` 均为 `v2.5.28`，文件 SHA-256 均为 `57817bf76cf63d3b272be5a9e27cc72a1037e9ea32f0cd2cb6d1819a4c16141b`。
- 维护人确认 `v2.5.28` 已完成 Android/iPhone 双真机验收、微信平台审核和正式发布。本条来源为维护人2026-08-30本会话确认，不把旧 `v2.5.27` 候选或旧平台记录挪作本版本证据。
- 当前尚未留存该版本的不可变候选 ZIP、精确源码提交、微信平台构建号、审核/发布时间、主包大小、设备/系统明细和正式线上数据回读；因此此处只登记已确认的平台完成状态，候选身份、正式数据自动更新和稳定归档门槛仍为 `passed_limited`。
- 本次状态登记没有开启 `AUTOMATIC_RELEASE_ENABLED` 或 `PRODUCTION_RELEASE_AUTHORIZED`，没有写入正式 `current.json`，没有切换正式数据指针。小程序代码包正式发布与每月数据自动发布是两条独立链路。

## 2026-08-30 当前自动更新回放修复与云端复核

- 针对完整隔离回放中每轮候选缺少对应 `publicationIdentity` 的失败原因，提交 `79db8e264ab5753791b6c3f90163afa00e79258f` 为每个回放月份生成并绑定范围化审计身份；它已作为默认分支提交 `e322e19d031b86934ee90309da6ffc8c0d5f3128` 合并。默认分支 CI `33315713592` 成功完成 `npm run check`、`npm run test:e2e` 和版本身份检查。
- GitHub Actions `33315927833` 在 `main@e322e19d031b86934ee90309da6ffc8c0d5f3128` 完成当前普通月度单组连续6个月完整隔离回放：`2026-01` 至 `2026-06` 共6轮、每轮6个阶段均通过，且每轮 `publication_identity_verified=true`。工件 `report.json` 为 `status=passed`、`replay_count=6`、`production_pointer_untouched=true`、`production_release_prefix_untouched=true`、`automatic_release_enabled=false`；报告 SHA-256 为 `3ced45f6f80a0532b923af45b5696cba247de9c7d2f0a6c3aa4d8102c2341dd2`，已保存到项目外 `C:\Users\user\CodexAuditEvidence\v2.5.28-replay-fix-20260830\full-cloud-replay-33315927833`。
- 随后只读运行 `monthly-data-post-publish-monitor` 的 GitHub Actions `33316750559` 成功回读当前正式数据：`dataset_version=2026-06-f80465ae29a5`、70个城市分片完整、云函数验证通过、`production_pointer_untouched=true`。监测报告 SHA-256 为 `280ebe44dd612b424b42f9573dc120af79f7c3cb7858415bc8784cd3628de391`，保存在项目外 `C:\Users\user\CodexAuditEvidence\v2.5.28-replay-fix-20260830\post-publish-monitor-33316750559`。
- 回放后使用独立授权身份再次回读，仓库 `AUTOMATIC_RELEASE_ENABLED=false`、生产 Environment `PRODUCTION_RELEASE_AUTHORIZED=false`。本轮未写入正式 `current.json`、未切换正式指针、未上传或发布小程序；修复只涉及自动化脚本，不改小程序页面或源码版本。
- 这补齐的是当前代码的普通月度隔离回放与正式数据只读回读证据，不替代 `v2.5.28` 不可变候选、候选绑定的平台原始记录、其余启用清单项或维护人对两个生产开关的未来授权；自动数据更新整体仍为 `passed_limited`，生产自动发布仍未启用。

## 2026-08-30 阶段D后续推进记录

- 候选 PR #6 已合并到默认分支，合并提交为 `06365d8debadb12c6a62bf4145270fe84f5f4155`；该提交的默认分支 CI 运行 `33298180368` 成功。随后修复 `stage-remote-data.mjs` 对 Node.js 异步 glob 的兼容问题，PR #7 已合并，当前默认分支提交为 `e47b9105673c4d97e15e9384238d0b976fa3248b`，修复提交 CI 运行 `33299310891` 成功。
- D19 Actions 评估运行 `33298388664` 成功；D19 负责人变量仍为 `yilugesanhua`。D18 首次复核运行 `33298387289` 复核180个来源后失败（`changed_count=170`、`failed_count=1`）；修复后重跑 `33300833376` 仍按隔离策略以需人工处理状态退出（`source_count=180`、`changed_count=171`、`failed_count=0`），两次均未写入数据或正式指针。修复提交 `7e5ac33cabbfee952aa727d462bb929a465282b8` 的普通 CI 和工作流安全验证均通过。
- 云端隔离链路运行 `33299529772` 成功：在 `housing-data/rehearsals/33299529772-1/` 完成对象上传、HEAD、下载、哈希回读、隔离指针切换、故意守卫失败和自动回滚，以及70个城市分片完整重建。报告明确 `production_pointer_untouched=true`、`production_release_prefix_untouched=true`。Artifact 已保存到项目外 `C:\Users\user\AppData\Local\Temp\stage-d-followup-20260830\cloud-write-rehearsal-33299529772`。
- 微信开发者工具已对 `v2.5.27` 当前候选重新编译；模拟器继续显示首页、2026-06 数据和70城图表，问题面板为0个问题。工具调试器显示7条警告，未取得主包大小报告，因此开发者工具项仍只能记为有限通过，不能替代双真机验收。
- D19 真实受控演练已完成：Issue #8 直连脚本验证超时升级、负责人确认去重和 SHA-256 恢复关闭；Issue #9 通过 Actions `workflow_dispatch` 完成负责人确认与恢复关闭。D18 失败回调运行 `33300284569` 因时间格式问题失败；修复合并后，受控无效时段月度检查 `33300872049` 的失败回调 `33300899238` 成功自动打开 Issue #11，随后 Actions `33300990998`/`33300991022` 完成确认和带 SHA-256 证据恢复关闭。故障通知闭环已在线验证。
- 维护人已确认 D18 重跑产生的171条历史页面变化任务可进入修订评估；已在项目外生成审核确认清单 `C:\Users\user\AppData\Local\Temp\stage-d-followup-20260830\d18-online-33300833376\human-review-approved.json`，清单 SHA-256 为 `d42836175dc3a1e1f071807cb05353b118dcd5307a26d3b6ba5b1f368ea3495f`。该确认不等于自动采纳页面内容，也未写入生产数据。
- D18 数据级复核已完成：对171条确认任务逐页使用当前解析器与归档记录逐字段比对，171条均为页面内容变化但业务字段一致，0条业务字段变化、0条失败；2013-06 首次抓取失败后重试成功，HTTP 200、解析560条且逐字段一致。最终评估报告位于项目外 `C:\Users\user\AppData\Local\Temp\stage-d-followup-20260830\d18-online-33300833376\data-level-assessment.json`，SHA-256 为 `44a927ce7d2c317e29140c26cd8aeeb735bd19d46b99031fc294bb419ad4351c`。结论为不生成历史修订申请、不写入生产数据。
- `v2.5.27` 阶段D执行结束时仍未开启 `AUTOMATIC_RELEASE_ENABLED` 或 `PRODUCTION_RELEASE_AUTHORIZED`，未写入正式 `current.json`、未修改正式指针。其后 `v2.5.28` 的双真机、审核和正式发布状态见本文件开头的维护人确认；该平台操作不改变上述自动数据更新边界。

## 2026-08-30 阶段D第1-6项执行记录（本地/隔离证据）

- 第1项已完成本地干净候选准备：从当前既有改动组装的隔离提交 `d5799b298c7cec464d437a2cfc51f3352a2cee4c` 生成 `v2.5.27` 候选，包含45个小程序文件。候选 ZIP SHA-256 为 `c31b0ab4e66eacbe4282c2691a2af6b8e564f0a6dd5dc87997ded53a96da5a00`，候选清单 SHA-256 为 `6800ecb4d062ac7fb4d6709cd7bb33423a55ce64984d32f7104dad09979df1b6`，文件清单 SHA-256 为 `c6230260d020584c6c13ade3fc6197ea9c1842b80eb03c274be33ddf176a36da`。候选仅保存在项目外临时目录，不代表已提交或发布。
- 第2项已完成候选分支的同提交 GitHub CI 与跨环境复现：两个独立隔离检出生成的候选 ZIP 字节级 SHA-256 一致；版本身份门禁通过；GitHub 普通 CI 运行 `33296581537` 在提交 `d5799b298c7cec464d437a2cfc51f3352a2cee4c` 上成功，包含 `npm run check` 和 `npm run test:e2e`。远端默认分支仍是 `7f7b5176af8a3d6486e25971cf7cfbec6f44bebd`，候选目前仅在独立分支 `codex/stage-d-v2.5.27-20260830`，因此尚未形成默认分支同提交证据。
- 第3项 D18 已完成一次真实只读隔离演练：复核180个实际引用官方来源，`200 + HTML/XHTML` 校验全部通过；9个内容未变，171个内容哈希变化，失败0。脚本状态为 `attention_required`，已生成171份 `pending_human_review` 隔离任务；没有写入数据、远程包或正式指针。完整报告位于项目外 `C:\Users\user\AppData\Local\Temp\stage-d-local-20260830-01\clean-worktree\work\quarterly-historical-page-audit\d18-local-20260830\report.json`。
- 第4项已完成受控变化后的隔离处置准备：171份任务均保留旧/新最终URL、旧/新原始 SHA-256、观察时间、变化原因和后续修订入口，统一标记 `production_untouched=true`；未自动采纳任何变化。真实人工判断和后续修订仍需维护人逐项确认。
- 第5项已完成线上变量配置：GitHub 仓库 Variables 已设置 `HOUSING_DATA_INCIDENT_OWNER=yilugesanhua`，未写入令牌、密码或验证码。
- 第6项已完成 D19 本地和真实 Issue 生命周期演练：本地4/4通过；真实演练 Issue #4 验证超时升级后再次评估返回 `already_escalated`，附本地日志 SHA-256 `5a62f50bea70759d4940031cceee0cacc29cf027e4e3ad7eb18740cfd238588b` 恢复并关闭；Issue #5 验证负责人确认后恢复并关闭。两项演练 Issue 均已关闭。由于工作流文件尚未进入默认分支，尚未完成由 Actions 自动触发的线上工作流演练。
- 本轮执行摘要保存在项目外 `C:\Users\user\AppData\Local\Temp\stage-d-local-20260830-01\execution-summary.json`。只读回读仍确认 `AUTOMATIC_RELEASE_ENABLED=false`、`PRODUCTION_RELEASE_AUTHORIZED=false`；未部署、未推送、未写正式数据、未修改正式指针、未上传或发布小程序。

## 2026-08-30 历史修订完整信任链 `v2.5.27`（本地实现，未部署）

- 当前候选版本为 `v2.5.27`。历史修订包的 `revision-manifest.json` 现在在发布候选复用、状态部署、发布后只读监测、人工/自动回滚和预览验证器中均按固定发布目录下载，并校验原始字节长度和 SHA-256 后才作为控制指针上下文使用。
- 验证器改为按“被引用的清单是否为历史修订包”强制修订清单，而不只看指针的转换类型；因此回滚到历史修订包时也无法跳过修订身份、来源批次、账本和撤销链校验。
- `apps/miniprogram/` 已同步到 `70城小程序技术验证/`；版本、运行时、主验证云函数和预览验证云函数共5个本次相关文件逐一 SHA-256 一致。
- 本轮复核：`npm.cmd run check` 退出码为 `0`（Web `18/18`、数据测试 `71/71`、小程序/自动化 `473/473`、发布门禁 `5/5`、数据校验 `100800` 条、Web 生产构建通过）；`npm.cmd run test:e2e` 退出码为 `0`（`39 passed / 1 skipped`，含电脑和手机视口）。`git diff --check`、D17-D20 定向测试 `16/16` 均通过。
- 只读回读确认仓库 `AUTOMATIC_RELEASE_ENABLED=false`、生产 Environment `PRODUCTION_RELEASE_AUTHORIZED=false`；本轮没有部署、生产写入、生产指针修改、工作流推送、Issue 操作或小程序上传/发布。
- 此候选只修改数据自动更新的运行时、云函数与本地发布/监测脚本，不修改小程序页面；尚未部署云函数、运行受保护工作流、写入正式数据、修改正式指针、改变生产开关、重新编译、上传或发布小程序。D18、D19的外部关闭证据仍缺失。

本轮新增的 D03-D07 本地证据：`publication-identity.mjs` 重新计算并核对候选业务记录、完整审计报告和来源索引的 SHA-256；候选生成前读取实际 `.batch.json` 并逐批核对来源、月份、原始哈希、审计记录哈希和记录数；历史修订回放生成与内容一致的审计报告哈希，并对账本前缀、追加集合、连续 `supersedes_revision_id`、业务字段变化、最新/修订来源批次集合和旧 `revision_type` 兼容字段执行失败关闭测试。相关定向测试 `29/29`，完整小程序套件 `473/473`，因此 D03-D07 从 `not_tested` 更新为本地 `passed_limited`；它们仍不是云端、CI、真机或正式发布证据。

## 2026-08-30 阶段D D17/D20本地补齐（未部署）

- D17 已将中国法定工作日改为带 `source_url`、官方发布时间、配置版本和 `coverage_status` 的年度配置；2026年绑定国务院办公厅2025年11月4日通知，未配置的2027年明确返回 `waiting_for_official_calendar`。跨年工作日计算遇到未知年份返回无截止日，状态保持 `updating`，不再猜测节假日。
- D17 定向测试覆盖官方元数据、已知调休、未知年份查询、跨年截止日和跨年状态判定；`scripts/data/status.test.ts` 共5项通过。
- D20 新增 `scripts/miniprogram/cross-platform-oracle.mjs` 及测试，以当前发布数据和小程序快照的文件字节 SHA-256 固定输入，覆盖新房/二手房、四种面积、环比/同比、近3/5/10年、北京/福州/厦门共144个组合；独立期望结果同时核对Web核心与小程序页面的排名、涨跌计数、层级/省内排名和累计变化，并覆盖缺失值与并列排名边界，3项通过。
- 本轮仅有本地实现与测试证据；D17仍需每年官方配置发布后的现场更新，D20仍需同候选CI和外部客户端证据。未部署、未写生产、未修改生产指针或开关、未上传或发布小程序。

## 2026-08-30 阶段D D18/D19与历史修订运行时（本地实现，未部署）

- 当前候选版本为 `v2.5.26`。小程序运行时已修复历史修订在远端下载、临时缓存校验与缓存回读时漏传已验证修订清单的问题；合法同月修订可原子启用，缺失、损坏或链路不一致的修订仍失败关闭。本地运行时回归 `scripts/miniprogram/data-runtime.test.mjs` 为84/84通过。
- D18新增季度历史页面只读复核脚本和固定SHA Action工作流；当前标准化数据所引用的官方来源会重新下载并校验 HTML/XHTML 内容类型，再比较最终URL/重定向与原始哈希，任一变化或非HTML响应只产出隔离人工任务/失败记录，不修改数据、远程包、生产指针或开关。本地定向测试5/5通过；GitHub首次线上运行与真实变化后的人工隔离处置尚未执行。
- D19新增GitHub Issue故障生命周期脚本和工作流；本地测试覆盖同故障去重、负责人确认、超时只升级一次、带SHA-256恢复证据的关闭以及输入拒绝，4/4通过。工作流增加不可取消的互斥组，避免定时评估、失败回调和人工操作并发处理同一故障。线上仍缺仓库变量 `HOUSING_DATA_INCIDENT_OWNER` 和真实演练；工作流仅有 `contents: read` 与 `issues: write`，不接触腾讯云、正式数据、正式指针或发布开关。
- `apps/miniprogram/` 已同步到 `70城小程序技术验证/`；版本、运行时和两份云函数源码共4个本次涉及文件逐一SHA-256一致。本轮未部署云函数或GitHub工作流、未写生产数据、未修改生产指针、未开启发布开关、未重新编译、未上传或发布小程序。D18、D19均为 `implemented/passed_limited`，不能解除任何生产阻断。

## 2026-08-30 阶段D发布身份门禁（本地实现，未归档或发布）

- 新增稳定候选晋级器、版本身份门禁与 Web 发布声明 schema 2。稳定晋级器只接受已经完整绑定同一候选的 CI、开发者工具、Android、iPhone、微信平台和线上回读证据；它回读候选 ZIP、清单和哈希，在同一磁盘的临时目录生成 `release-manifest.json`、证据索引、`SHA256.txt` 和版本说明，复核后才原子改名为稳定归档。当前没有填写任何外部通过证据，也没有生成新的稳定归档。
- `miniprogram:version:check` 已由普通 CI 执行，读取 `apps/miniprogram/config/version.js` 并校验当前入口快照；候选或稳定归档存在时还会校验文件名、候选 ID、清单和归档目录，客户端路径变化必须伴随语义版本递增。历史文档仍保留其固定版本号，不参加当前快照比较。
- `release:check` 现在只接受 schema 2 声明和独立证据索引，绑定精确源码提交、`dist/` 完整文件清单、发布数据清单、正式域名、证据哈希与有效期。现有 `release/` 中是空白模板，因此命令会明确失败，不能被理解为 Web 已准备发布。
- 定向测试共12项通过，覆盖原字节晋级、缺失/错提交证据、归档原子失败、版本漂移、客户端未升版、构建或数据替换、域名、证据哈希、过期和未来时间。R04、R06、I10、I14 更新为 `implemented/passed_limited`；仍缺真实候选的跨环境复现、开发者工具/双真机/平台/线上回读证据，自动发布双开关保持关闭。

## 2026-08-30 阶段D I09独立状态部署（本地实现，未部署）

- 新增 `.github/workflows/monthly-data-status-deploy.yml` 与 `scripts/miniprogram/deploy-data-status.mjs`。它只接收 `monthly-data-check` 成功运行的不可变 CloudBase 观察对象；在受保护 `housing-data-production` Environment 中重新读取 `current.json`、当前manifest和撤销登记，逐字节比较观察记录绑定的指针基线，保持数据/来源/manifest/撤销身份和原始数据转换类型不变，只变更 `data_status`、`status_reason`、控制生成时间和递增后的 `control_generation`。写前再次读取基线，写后逐字节回读；不接收本地生产写入，实际写入仍严格要求两个生产开关均为`true`。当前两者为`false`，所以受保护部署作业会跳过。
- 新增5项定向测试：状态更新的身份保持、陈旧观察基线拒绝、健康状态免写入、并发基线变化拒绝和存储写失败保留原指针；工作流安全测试45/45通过。尚未运行受保护Environment工作流，没有写入正式 `current.json`，也没有改变发布开关。I09从 `partial/not_tested` 更新为 `implemented/passed_limited`，不能据此关闭阶段D或启用自动发布。

## 2026-08-29 18:45-18:55 按执行方案再次现场复核

- 按方案在第27个时段完成后重新只读导出 CloudBase `monthlyDataWatchdog` 集合到项目外 `C:\Users\user\CodexAuditEvidence\plan-execution-20260829-rerun\`，导出任务成功（221条记录，失败0）。使用 `strict-discovery-window-audit.mjs --date=2026-08-29 --slot-count=27` 复核结果为 `expected_slot_count=27`、`received_slot_count=27`、`unique_slot_count=27`、`errors=[]`；27个业务时段均报告 `update_available`，对应官方新增月份为 `2026-07`。该复核仍属于阶段C日常健康证据，不重新构成测试准入条件。
- 只读现场回读确认 `monthlyDataWatchdog` 为 `Active`、运行时 `Nodejs20.19`、入口 `index.main`，唯一启用触发器为 `monthlyDataWatchdogCron`，七段 Cron 为 `0 * * * * * *`；未写入正式数据、未修改正式指针、未上传或发布小程序。
- 本轮 `npm.cmd run check` 退出码为 `0`：Web 18/18、数据64/64、小程序及自动化435/435、发布门禁3/3、100800条数据校验和生产构建均通过；`npm.cmd run test:e2e` 为 `39 passed / 1 skipped`。测试中的网络、权限、哈希和存储错误均为故障注入场景，按预期失败关闭。

## 2026-08-29 18:23-18:25 按执行方案复核（当前）

- 通过已登录的 CloudBase CLI 只读查询导出 `monthlyDataWatchdog` 集合到项目外证据 `C:\Users\user\CodexAuditEvidence\goal-20260829-plan-execution\cloudbase-records-20260829.json`（共221条历史/当日记录）。对 2026-08-29 明确运行 `strict-discovery-window-audit.mjs` 完整窗口审计，结果为 `expected_slot_count=27`、`received_slot_count=27`、`unique_slot_count=27`、`errors=[]`；当天27次业务时段均首次尝试、`succeeded`、`timing_status=on_time`，均有唯一观察对象并报告官方新增 `2026-07`。审计结果保存在 `C:\Users\user\CodexAuditEvidence\goal-20260829-plan-execution\strict-audit-20260829.json`。这属于阶段C日常健康证据，不重新构成测试门槛；2026-08-27 的单日完整27时段测试准入仍为唯一通过结论。
- 只读回读确认 `monthlyDataWatchdog` 为 `Active`、运行时 `Nodejs20.19`、入口 `index.main`、唯一启用定时器 `monthlyDataWatchdogCron` 为每分钟 `0 * * * * * *`，租约720秒、最多3次尝试，备用 GitHub 审计开启且不为 dry-run；安全摘要保存在 `C:\Users\user\CodexAuditEvidence\goal-20260829-plan-execution\watchdog-safe-summary.json`。未保存令牌值。
- 只读下载正式 `housing-data/current.json` 到项目外并回算 SHA-256：`2026-06-f80465ae29a5`、`d15b9ea0727f2e88b6aa936a3959396e8673ac32c60c873931ffac8934d0989c`。GitHub 仓库变量 `AUTOMATIC_RELEASE_ENABLED=false`、`housing-data-production` Environment 变量 `PRODUCTION_RELEASE_AUTHORIZED=false`；证据分别保存在 `C:\Users\user\CodexAuditEvidence\goal-20260829-plan-execution\production-current-readonly-1825.json` 与 `github-release-switches.json`。
- 最近一次 GitHub 只读发现运行 `33246999674` 成功，消费同一 `slot_id=2026-08-29T09:55:00.000Z` 的腾讯云观察对象并发现 `2026-07`；随后 `monthly-data-auto-publish` 运行 `33247026599` 的 `inspect` 成功，但 `prepare`、`publish` 均为 `skipped`。完整外部构件保存在 `C:\Users\user\CodexAuditEvidence\goal-20260829-plan-execution\github-artifact-33246999674`。
- 本轮 `npm.cmd run check` 退出码为 `0`（Web 18/18、数据64/64、小程序及自动化435/435、发布门禁3/3、数据校验100800条、生产构建通过）；`npm.cmd run test:e2e` 为 `39 passed / 1 skipped`。未上传、审核、发布小程序，未写入正式数据或修改生产指针。

## 2026-08-29 18:11 微信开发者工具重新启动复核（补充证据）

- 使用当前候选 `v2.5.25`（提交 `7f7b5176af8a3d6486e25971cf7cfbec6f44bebd`）重新打开 `70城小程序技术验证`。微信开发者工具 Stable `v2.01.2510290`、基础库 `3.17.0` 的日志记录 `restart appservice compile`、`simulator launch success` 和 `webview page ready`；可访问性树读取到 `pages/index/index` 首页、数据截止 `2026-06`、70城概览和趋势/累计/温度图表，问题面板为 `Errors: 0`、`Warnings: 26`。
- 这补充了当前候选的“开发者工具启动并显示首页”证据，但不等于完整小程序平台验收：当前工具未提供可复查的主包体积报告，窗口截图接口仍因 `SetIsBorderRequired 0x80004002` 不可用，Android/iPhone、正式远程数据链路、微信审核/发布仍未验证。非敏感证据保存在项目外 `C:\Users\user\CodexAuditEvidence\goal-20260829-followup\devtools-runtime-20260829.json`；未执行上传、审核、发布或正式数据写入。

## 2026-08-29 当前复核（本地检查与开发者工具登录）

- 本轮重新执行 `npm.cmd run check` 并以退出码 `0` 完成：静态检查、类型检查、Web 单元测试（18/18）、数据测试（64/64）、小程序与自动化测试（435/435）、100800 条当前数据校验及 Web 生产构建均通过。测试中出现的 `refresh failed`、权限拒绝和网络失败文字属于故障注入场景，测试结果仍为全部通过。
- 微信开发者工具 Stable `v2.01.2510290` 当前窗口仍打开 `70城小程序技术验证`；CLI `islogin --port 21464` 返回 `{"login":true}`。18:11 的重新打开、模拟器启动和首页加载证据见上方补充记录。
- CLI 的 `engine build` 端点仍返回 HTTP `404 Cannot GET /engine/build`，因此不能把该命令当作构建回执；当前工具窗口虽已显示首页，但仍缺少可复查的主包体积报告和可保存截图。未执行上传、审核、发布或生产数据写入。
- 阶段状态更新为：本地候选和代码检查为 `passed_limited`，开发者工具为“启动/首页显示证据已补，完整平台门槛未通过”，Android/iPhone 真机、微信平台、正式远程数据链路和自动发布仍未通过或未执行；两个生产开关继续保持 `false`。

## 2026-08-29 16:38 实时执行复核（23个业务时段）

- 按现行方案从 CloudBase `monthlyDataWatchdog` 只读导出集合记录，共识别当天前23个业务发现时段（09:15至16:35）；严格审计明确传入 `--slot-count=23`，结果为 `expected_slot_count=23`、`received_slot_count=23`、`unique_slot_count=23`、`errors=[]`。23次均为首次 `succeeded`、`timing_status=on_time`，无缺失、迟到、重复、失败或重试遗留；日历和观察记录均未计入业务次数。
- 23个时段对应的不可变观察对象已用只读 COS 身份逐一回读，观察身份、载荷 SHA-256、时段和 `handoff_identity` 全部一致；均报告官方新增月份 `2026-07`，不同记录仍只计为同一份新数据。
- 本次实时证据保存在项目外 `C:\Users\user\CodexAuditEvidence\plan-execution-20260829-live\refresh-1635\`（原始查询、JSON-lines 导出、`audit-20260829-first23.json` 和观察对象回读）。这只是当天运行健康证据；最后4个时段仍由腾讯云继续执行，17:55后才可按方案形成当天完整27时段日终审计。
- 当前生产 `current.json` 仍为 `2026-06-f80465ae29a5`；仓库级 `AUTOMATIC_RELEASE_ENABLED=false`、生产 Environment 级 `PRODUCTION_RELEASE_AUTHORIZED=false`。当天 GitHub `monthly-data-check` 运行继续作为审计/备用信号，自动发布的 `prepare` 与 `publish` 保持跳过，待发布 `2026-07` 候选仍为 `ready`，未写入正式数据、指针或小程序。
- 本轮 `npm.cmd run check` 退出码为 `0`（小程序与自动化测试 `435/435`、发布门禁 `3/3`、数据校验 `100800` 条、生产构建通过）；`npm.cmd run test:e2e` 为 `39 passed / 1 skipped`。开发者工具当前登录，但仍没有新的编译成功证据。

## 2026-08-29 17:17 实时执行复核（25个业务时段）

- 从 CloudBase `monthlyDataWatchdog` 只读导出当天集合记录，严格审计明确传入 `--slot-count=25`，结果为 `expected_slot_count=25`、`received_slot_count=25`、`unique_slot_count=25`、`errors=[]`。截至16:55的25次业务发现均为首次 `succeeded`、`timing_status=on_time`，无缺失、迟到、重复、失败或重试遗留；`calendar`和`discovery-observation`记录未计入业务次数。
- 25个不可变观察对象的时段、载荷 SHA-256 和 `handoff_identity` 均已逐项核对；均报告官方新增月份 `2026-07`。本次证据保存在项目外 `C:\Users\user\CodexAuditEvidence\plan-execution-20260829-live\refresh-1717\`。这是日常健康证据，不是新的测试准入条件；阶段B单日完整27时段门槛已于2026-08-27通过。
- 生产 `current.json` 仍为 `2026-06-f80465ae29a5`，原始文件 SHA-256 为 `d15b9ea0727f2e88b6aa936a3959396e8673ac32c60c873931ffac8934d0989c`；仓库级 `AUTOMATIC_RELEASE_ENABLED=false`，生产 Environment 级 `PRODUCTION_RELEASE_AUTHORIZED=false`。GitHub运行 `33243901939`及其自动候选运行 `33243931825`均成功，`prepare`和`publish`均为 `skipped`；未写入正式数据、指针或小程序。
- 本次重新执行 `npm.cmd run check` 退出码为 `0`（数据校验 `100800` 条、生产构建通过），`npm.cmd run test:e2e` 为 `39 passed / 1 skipped`。微信开发者工具仍无新的编译成功证据。

## 2026-08-29 17:56 日常完整窗口健康复核（27个业务时段）

- 第27个时段完成后从 CloudBase `monthlyDataWatchdog` 导出当天集合记录，严格审计明确传入 `--slot-count=27`，结果为 `expected_slot_count=27`、`received_slot_count=27`、`unique_slot_count=27`、`errors=[]`。27次均为首次 `succeeded`、`timing_status=on_time`，无缺失、迟到、重复、失败或重试遗留；`calendar`和`discovery-observation`记录未计入业务次数。
- 27个不可变 COS 观察对象已用只读身份逐项回读；每个对象的 `slot_id`、`observation_id`、载荷 SHA-256、`handoff_identity` 均与 CloudBase 时段记录一致，回读结果为 `checked_count=27`、`passed_count=27`、`errors=0`。完整证据保存在项目外 `C:\Users\user\CodexAuditEvidence\plan-execution-20260829-live\final-1756\`。
- 本次只是阶段C的日常健康复核，不重新设置测试门槛，也不改变2026-08-27已通过的单日27时段观察结论。生产 `current.json`、双生产开关和小程序发布状态保持不变；未写入正式数据、未修改正式指针、未上传或发布小程序。
- 17:59（北京时间）最终只读回读确认正式 `current.json` 仍为 `2026-06-f80465ae29a5`，原始 SHA-256 仍为 `d15b9ea0727f2e88b6aa936a3959396e8673ac32c60c873931ffac8934d0989c`；仓库级 `AUTOMATIC_RELEASE_ENABLED=false`、生产 Environment 级 `PRODUCTION_RELEASE_AUTHORIZED=false`。证据见项目外 `C:\Users\user\CodexAuditEvidence\plan-execution-20260829-live\production-final-summary.json`。

## 2026-08-29 阶段C只读保障令牌已生成并配置（当前）

- 已新增专用配置脚本 `scripts/miniprogram/configure-watchdog-readonly-audit.mjs`，并以70项定向安全/云函数/工作流测试验证：它只会在明确`--apply`时向`monthlyDataWatchdog`提交5个固定运行变量，令牌不写入源码、文档、日志或输出；默认模式仅输出无敏感计划。该脚本没有生产数据写方法，两个生产发布开关也不在其可写范围。
- 维护人确认生成后，GitHub 细粒度正式令牌 `housing-watchdog-2026-permanent` 已生成并设置为无过期日期，安全保存到本机 `C:\Users\user\.env`，未写入仓库、文档、日志或聊天。GitHub Actions API 只读预检返回 HTTP `200`。
- 已于2026-08-29执行专用配置 `--apply`，CloudBase 请求编号为 `6d9a8cc9-02b0-42a3-9540-3f867b3d104d`。函数现场回读为 `Active`、`Nodejs20.19`、`index.main`；5个固定变量已配置，其中令牌仅脱敏核对。GitHub备用审计路径已切为 `WATCHDOG_GITHUB_AUDIT_ENABLED=true`、`WATCHDOG_DRY_RUN=false`；这不打开生产发布或正式数据写入。
- 该令牌仅授予目标仓库的 `Actions: Read and write` 与强制的 `Metadata: Read-only`。因此读取仓库变量和生产 Environment 变量接口返回 HTTP `403 Resource not accessible by personal access token`；本次不能用该身份复读 `AUTOMATIC_RELEASE_ENABLED` 与 `PRODUCTION_RELEASE_AUTHORIZED`，不把403误记为开关状态。生产指针仍已独立复读且原字节未变。
- 原正式短期令牌 `housing-watchdog-2026-rotated-2`（原到期日2026-09-25）和 `housing-watchdog-2026-rotated-3`（原到期日2026-09-28）已在新令牌验证成功后按维护人确认撤销；GitHub令牌列表现场只剩 `housing-watchdog-2026-permanent`，并显示无过期日期。经典令牌列表为空。
- 非敏感现场回读证据保存在项目外 `C:\Users\user\CodexAuditEvidence\permanent-watchdog-token-20260829\readonly-recheck.json`。后续若要复读两个生产开关，需使用已有的专用只读监测身份或另行授权仅变量读取权限；不得扩大本令牌权限或把令牌写入仓库文件。

## 2026-08-29 `v2.5.25` 候选构件与微信开发者工具复核（未通过编译验收）

- 已从项目外的干净临时检出生成只读候选构件：`v2.5.25+7f7b5176af8a3d6486e25971cf7cfbec6f44bebd+7839793a4ba3228e8ad706d9f69f403b3e4384f26e5425627d30338de67fe4be`。候选 ZIP 共45个文件，SHA-256 为 `7839793a4ba3228e8ad706d9f69f403b3e4384f26e5425627d30338de67fe4be`，清单 SHA-256 为 `08f5203de13561f399c21d318a79c5c9a578db10a7dda0f1e2198e9446128a0c`，文件已设为只读并保存在项目外 `C:\Users\user\CodexAuditEvidence\phase-d-v2.5.25-source-7f7b5176af8a\work\miniprogram-release-candidates\v2.5.25-7f7b5176af8a-7839793a4ba3\`。第二个独立干净检出在同一台电脑生成了相同候选ID、ZIP和文件清单哈希；这只证明本机可复现，不是跨机器证据。实际 `70城小程序技术验证/` 与该精确提交逐文件核对为45/45一致；原工作区的无关未提交改动没有进入候选。
- 已用本机微信开发者工具 CLI 清除该项目的编译缓存并重新打开项目，`islogin` 返回 `true`，工具版本为 Stable `v2.01.2510290`；本地自动化接口已启用。本次没有执行预览、真机调试、上传、审核或发布。
- 开发者工具重新编译**未通过**：其当前 CLI 没有独立的编译命令，`engine build` 虽错误返回了退出码0，输出实际为 `Cannot GET /engine/build`，不能作为成功证据。工具日志随后记录了 `3.17.0` 基础库 `verify md5 error`、`routeTo appLaunch timeout`；虽有“模拟器启动”记录，但没有首页成功启动或可视化验收证据。已从工具配置中的微信官方基础库地址下载同一 `3.17.0.wxapkg` 并与本机文件逐字节核对，SHA-256完全相同；又在项目外副本切至`3.17.1`后切回`3.17.0`、清编译缓存、关闭并重开原项目，错误仍复现。因此这不是可通过替换文件解决的本地包损坏。Windows窗口捕获仍返回 `0x80004002`，可访问性树也不能读取模拟器画面，不能绕过这些失败信号登记为编译通过。
- 因此候选构件和源码/运行目录一致性已完成，但开发者工具、Android/iPhone真机、微信平台审核、正式远程数据链路和生产自动发布均仍未通过或未执行；两个生产开关继续保持关闭。

## 2026-08-29 当日严格发现日常运行快照

- 截至北京时间11:37，CloudBase `monthlyDataWatchdog` 已完成09:15、09:35、09:55、10:15、10:35、10:55、11:15、11:35八个业务发现时段；八次均为首次尝试、`succeeded`、`timing_status=on_time`，均报告官方`2026-07`相对生产`2026-06`可更新。09:00日历记录没有计入业务发现。
- 最新只读导出和部分审计保存在项目外 `C:\Users\user\CodexAuditEvidence\plan-execution-20260829\refresh-1137\database_export-cloud1-d3gpdx70w5d05c68c-monthlyDataWatchdog-1787974808455.json` 与 `audit-20260829-refresh1137-first8.json`；本次审计明确传入`--slot-count=8`，结果为`expected_slot_count=8`、`received_slot_count=8`、`unique_slot_count=8`、`errors=[]`。这是日常运行中的健康证据；2026-08-27已经完成唯一的27时段观察验收，后续时段继续按日程运行，不再被当成新的阶段准入条件。17:55后的完整导出如执行，只登记当日健康状态。
- GitHub备用审计运行 `33226972257`、`33228057238` 以及后续 `33228905128`、`33229729967` 均成功完成发现检查并消费对应观察对象；最新 `monthly-data-auto-publish` 运行 `33229758082` 只完成`inspect`，`prepare`与`publish`均跳过。没有写入正式数据、正式指针或小程序。

## 2026-08-29 阶段C运行复核（11:21）

- 现场只读回读确认 CloudBase `monthlyDataWatchdog` 为`Active`、运行时`Nodejs20.19`、处理器`index.main`，唯一启用触发器为`monthlyDataWatchdogCron`，七段Cron为`0 * * * * * *`；运行变量仅包含租约、重试和只读审计配置，令牌记录均已脱敏。
- 使用只读身份回读生产 `current.json`，其`dataset_version`仍为`2026-06-f80465ae29a5`，原始SHA-256仍为`d15b9ea0727f2e88b6aa936a3959396e8673ac32c60c873931ffac8934d0989c`；仓库级`AUTOMATIC_RELEASE_ENABLED=false`，生产Environment级`PRODUCTION_RELEASE_AUTHORIZED=false`。
- 2026-08-29的 `monthly-data-check` 与 `monthly-data-auto-publish` 现场运行均成功结束，但自动发布的`prepare`与`publish`均为`skipped`；待发布候选仍为`ready`，没有正式数据写入、指针切换或小程序发布。
- 全量 `npm.cmd run check` 退出码为0（含数据校验100800条、435项小程序/自动化测试和生产构建），端到端测试为`39 passed / 1 skipped`；非敏感现场证据保存在项目外 `C:\Users\user\CodexAuditEvidence\plan-execution-20260829\`。
- 此前建立的 Codex 每日北京时间18:05只读复核任务（`automation`）已在确认2026-08-27完整窗口通过后删除；当前没有每日“重新取得27时段通过”的任务。日终完整导出可在需要时作为健康审计人工执行，但不计入发现次数、不构成新的阶段门槛，也不触发候选准备、补发、正式数据写入或小程序发布。

## 2026-08-28 严格观察门槛通过与下一阶段评估（当前）

- 截至北京时间12:19，现场只读导出的 CloudBase `monthlyDataWatchdog` 集合中，实际开始过的业务发现时段为37个：2026-08-27完整27个，2026-08-28当日09:15至12:15为10个。37个均为单次尝试、`succeeded`、`timing_status=on_time`，因此实际业务发现成功率和严格首次准时成功率均为100%。严格审计分别得到2026-08-27的`27/27/27, errors=[]`与2026-08-28前10个时段的`10/10/10, errors=[]`；每个时段均已关联唯一观察对象并逐项核对时段、载荷哈希和交接身份。
- 统计排除了3条`calendar`记录、39条`discovery-observation`记录，以及2026-08-26窗口结束后手动调用产生的27条`attempts=0`过期记录。后者没有实际发起发现请求，不能计入执行次数或拉低成功率。37次成功观察均报告`update_available`，但它们反复发现的是同一份官方新增数据`2026-07`，按不同官方新增月份计为1次发现，不得误记为37份不同数据。
- 该证据按`MONTHLY_DATA_AUTOMATION_PLAN.md`第2.1节验收通过：发现观察阶段为`passed`，允许评估下一阶段。当天较早的“连续10个计划发现时段”和此前“连续3个完整发现窗口”均为历史记录，不再作为后续评估标准。它不把严格发现升级为生产自动发布，也不替代自动更新启用清单中的发布、回滚、真机、平台审核或正式数据链路门槛。
- 下一阶段评估结论：严格只读发现器已在实际执行，后续只可继续其只读运行、时段与最小权限复核。`WATCHDOG_DRY_RUN=true`只限制GitHub备用审计/补发路径；该路径同时由`WATCHDOG_GITHUB_AUDIT_ENABLED=false`关闭，不影响腾讯云严格时段控制器的实际只读发现。无需也未授权把任一变量改为`false`或开启备用补发。
- 2026-08-28 12:28（北京时间）重新只读回读：生产`current.json`仍为`2026-06-f80465ae29a5`，原字节SHA-256仍为`d15b9ea0727f2e88b6aa936a3959396e8673ac32c60c873931ffac8934d0989c`；仓库级`AUTOMATIC_RELEASE_ENABLED=false`、生产Environment级`PRODUCTION_RELEASE_AUTHORIZED=false`。本次未写入正式数据、未改变指针、未修改云函数配置、未上传或发布小程序。非敏感导出、审计和回读证据保存在项目外`C:\Users\user\CodexAuditEvidence\monthly-discovery-summary-20260828\`与`C:\Users\user\CodexAuditEvidence\next-stage-evaluation-20260828\`。
- 阶段D“发布能力的独立评估”尚未获得准入：自动更新启用清单的全部适用项还没有当前可复查通过证据，且候选绑定的开发者工具重新编译、Android/iPhone真机、微信平台与正式远程数据链路证据仍未补齐。两个生产开关必须继续保持`false`，未来只有在清单逐项通过且维护人另行明确授权后，才可单独评估正式自动发布。

## 2026-08-27 GitHub 实际消费观察对象与候选检查依赖修复（当前）

- GitHub 手动只读检查运行 `33049181358` 已成功读取腾讯云同一严格发现观察对象 `8271c9...`。该对象记录北京时间 15:15 时段实际于 `2026-08-27T07:15:05.610Z` 启动，`timing_status=on_time`；官方 `2026-07` 已发布，生产正式指针仍为 `2026-06`。下载的非敏感报告保留在项目外临时证据目录，未读取或输出密钥。
- 该检查随后触发候选工作流 `33049235685`。它在 `inspect` 作业安全停止，`prepare` 与 `publish` 均未执行，未写正式数据、正式指针或待发布候选。根因是 `inspect` 在导入间接依赖 `cheerio` 的检查模块前没有执行 `npm ci`，GitHub 报 `Cannot find module 'cheerio'`。
- 修复提交 `dff1d15b00237f8cb8aab24b36aadca02c194901` 已将 `inspect` 调整为固定 Node 22、执行锁定的 `npm ci`，再下载报告并导入检查模块；工作流安全测试固定该顺序和不可变 Action SHA。该提交的本地定向安全测试 `42/42`、`npm run check` 与 `npm run test:e2e` 均通过。
- 修复后的 GitHub 只读发现运行 `33050314454` 成功；自动候选运行 `33050369807` 的 `inspect` 在安装依赖后成功，`prepare` 成功生成 `2026-07-ca615516ca63` 的待发布候选和可复现 Artifact（ID `9637653717`，SHA-256 `6c23b7ee9a4162bb1e3ec4997f028a53d53a1e0700dc1700c174750ec382d09b`）。全量数据门禁通过：从 `2026-06` 到 `2026-07` 新增 560 条记录、历史修订 0、缺失和重复范围均为 0；候选提交 `47668235a4ec4e5653f1bb0da39bc777ffb7b900` 的普通 CI `33050902154` 也已成功。
- `33050369807` 的候选门禁已绑定同一腾讯云 `2026-08-27T07:35:00Z` 准时观察对象；该对象实际于 `2026-08-27T07:35:05.722Z` 启动，`timing_status=on_time`，读取到生产正式指针仍为 `2026-06`。`publish` 作业显示为 `skipped`，没有执行任何生产写入步骤。随后现场回读仓库级 `AUTOMATIC_RELEASE_ENABLED=false` 和 `housing-data-production` Environment 级 `PRODUCTION_RELEASE_AUTHORIZED=false`；仅核对了环境密钥名称，未读取或输出任何密钥值。
- 截至2026-08-27 16:15（北京时间），当天 09:15 至 16:15 已实际完成 22/27 个严格发现时段；每个时段均为单次尝试、`succeeded`、`timing_status=on_time`，没有迟到、失败或重复记录。最新 16:15 时段实际于 16:15:04 开始、16:15:10 完成，仍在 16:17 准时上限内。GitHub 运行 `33050314454` 已实际消费其中 15:35 的同一腾讯云观察对象，时段、观察身份、载荷哈希和交接身份一致；随后本地只读门禁也直接回读并验证了 15:55 对象。09:15 至 17:55 的完整 27 个时段仍未完成，严格发现验收继续为 `passed_limited`；候选不等于上线，两个生产发布开关继续保持关闭。
- 18:02（北京时间）已在截止后导出当天 CloudBase 记录并运行严格审计：`expected_slot_count=27`、`received_slot_count=27`、`unique_slot_count=27`，`errors=[]`。全部27个发现时段均为单次尝试、`succeeded`、`timing_status=on_time`，没有缺失、重复、迟到、失败或重试残留；日程记录没有被误算入发现时段。最后一个17:55时段于 `2026-08-27T09:55:05.562Z` 开始、`2026-08-27T09:55:10.802Z` 完成，其不可变观察对象 `6f14a983...` 的时段、载荷哈希和交接身份已用只读监测身份直接回读验证。复跑审计必须使用包含发现记录与不可变观察记录的完整集合导出；`recheck-20260828\cloudbase-monthlyDataWatchdog.json` 可直接复核为通过，`cloudbase-slots-final.json` 只是时段汇总，缺少观察记录，不能单独作为完整审计输入。
- 同次生产只读回读确认 `current.json` 的`dataset_version`仍为 `2026-06-f80465ae29a5`，前后原字节 SHA-256 均为 `d15b9ea0727f2e88b6aa936a3959396e8673ac32c60c873931ffac8934d0989c`；仓库级 `AUTOMATIC_RELEASE_ENABLED=false`、生产 Environment 级 `PRODUCTION_RELEASE_AUTHORIZED=false`。本次没有写入正式数据、正式指针或开启发布。非敏感原始导出与审计结果保存在项目外 `C:\Users\user\CodexAuditEvidence\monthly-discovery-20260827\`。
- 2026-08-28，维护人曾将严格发现的有限观察门槛从“连续3个完整发现窗口”改为“连续10个计划发现时段”。该当日决定随后被“单日完整27个计划发现时段全部通过，且成功发现官方新增数据”规则明确取代，现仅为历史记录；当前规则和通过结论以本文件顶部及`MONTHLY_DATA_AUTOMATION_PLAN.md`为准。自动更新启用清单未全部通过前，两个生产发布开关必须继续保持关闭。
- 18:17 与次日04:33（北京时间）`monthly-data-pending-publish` 的 `inspect` 作业分别在运行 `33060733457` 与 `33113912749` 失败：该工作流没有先执行 `npm ci`，而待发布状态检查间接依赖 `cheerio`。失败发生在 `inspect`，没有进入恢复或发布作业，也没有写入正式数据。已补上固定提交的 Node 22 安装、锁定依赖安装和防回归测试；修复后仍须以新的 GitHub 定时运行现场通过为准。
- 2026-08-28 再次从 CloudBase 导出原始集合记录，并用升级后的严格审计器复核：它直接支持腾讯云JSON行导出，且把每个发现时段与唯一观察记录的时段、载荷哈希和交接身份逐项比对，但不把观察记录或日程记录计入27个业务时段。结果仍为 `expected_slot_count=27`、`received_slot_count=27`、`unique_slot_count=27`、`errors=[]`；27条均单次准时成功。正式 `current.json` 的`dataset_version`仍为 `2026-06-f80465ae29a5`，SHA-256 为 `d15b9ea0727f2e88b6aa936a3959396e8673ac32c60c873931ffac8934d0989c`，两个生产发布开关仍为 `false`。原始导出、审计、指针回读和测试日志已保存在项目外 `C:\Users\user\CodexAuditEvidence\monthly-discovery-20260827\recheck-20260828\`。

## 2026-08-26 腾讯云观察交接接入 GitHub 门禁（当前候选）

- 已新增固定对象 `housing-data/discovery/observations/<sha256(slot_id)>.json`：腾讯云函数在观察完成后写入并写后回读；对象只含非敏感的时段、正式指针摘要、官方来源摘要、结果和哈希，不含完整业务数据或密钥。
- GitHub `monthly-data-check` 读取同一 `slot_id` 的观察对象；`monthly-data-auto-publish` 的发现门禁、候选持久化、CI 发布授权和待发布恢复均绑定腾讯云 `observation_id`、`payload_sha256`、`timing_status` 和 `handoff_identity`。缺失、迟到、身份冲突或哈希不一致时失败关闭。
- 本地定向测试 `75/75` 通过，完整 `npm run check` 通过（小程序 `420/420`、数据测试 `64/64`、Web测试 `18/18`、发布门禁 `3/3`）；当前生产开关仍为关闭状态，未写正式数据。
- 本轮候选版本为 `v2.5.25`，已同步 `70城小程序技术验证/` 并于2026-08-26 23:02（北京时间）重新部署 `monthlyDataWatchdog`；CloudBase函数列表回读为 `Deployment completed`，手动调用返回 `strict_status=idle`、`watchdog_status=disabled`。调用发生在当日发现窗口之后，不能作为完整窗口或准时发现证据。
- GitHub 只读监测身份已在本机安全配置，并已写入仓库级只读 Secrets；已用该身份现场验证：可读取正式 `current.json`，读取不存在的观察对象返回 `NoSuchKey`，读取正式发布目录返回 `AccessDenied`。这证明最小权限边界，不替代 GitHub 工作流对同一观察对象的实际消费记录；当时完整27个时段线上窗口尚未完成，后续完整窗口通过证据见本文件顶部。
- 本地 `npm run test:e2e` 为 `39 passed / 1 skipped`（桌面与手机流程均覆盖）；源目录与微信开发者工具目录的44个构建输入逐文件SHA-256一致，开发者工具私有配置按规则保留为允许的本地差异。
- GitHub 仓库变量 `AUTOMATIC_RELEASE_ENABLED=false`、生产 Environment 变量 `PRODUCTION_RELEASE_AUTHORIZED=false` 已现场回读；仓库中两个只读监测 Secret 仅确认存在，未读取或打印其值。

## 2026-08-26 严格发现器部署与有限验证（历史快照）

> 本节保留部署当日的原始状态；2026-08-29阶段C永久令牌配置和当前运行状态以本文件顶部记录为准。

- 严格发现器源码、共享发现契约和时段状态机已完成本地定向验证，并已部署到 CloudBase 环境 `cloud1-d3gpdx70w5d05c68c` 的 `monthlyDataWatchdog` 函数。当前唯一触发器为 `monthlyDataWatchdogCron`，七段 Cron 为 `0 * * * * * *`，由函数内部按北京时间领取 09:15 至 17:55 的 27 个发现时段。
- 腾讯云函数只读取白名单正式 `current.json`、国家统计局公开页面，并将租约、尝试次数、时段状态和不可变观察报告写入 `monthlyDataWatchdog` 集合；不上传数据、不修改正式指针、不切换版本，也不持有生产数据写凭据。
- 当前云端配置精确保留四个非敏感变量：`MONTHLY_DISCOVERY_LEASE_SECONDS=720`、`MONTHLY_DISCOVERY_MAX_ATTEMPTS=3`、`WATCHDOG_GITHUB_AUDIT_ENABLED=false`、`WATCHDOG_DRY_RUN=true`。GitHub 补发路径关闭时不读取 GitHub 令牌。
- 一次部署后的安全手动调用在当日 18:00 截止后登记了 09:00 日程时段和 27 个发现时段，共 28 条 `expired` 记录；该证据证明部署、失败关闭和状态写入可用，但不能证明完整窗口内 27 个时段按时开始。
- 当前源码版本为 `v2.5.25`，已同步到 `70城小程序技术验证/`；本轮只改动云函数、发现契约、工作流安全和数据自动更新相关构建输入，没有修改小程序页面布局或正式数据。
- 本轮严格发现实现登记为 `implementation_status=implemented`。其单日27时段发现观察已在后续实际窗口中通过，见本文件顶部；自动数据更新整体仍为`verification_status=passed_limited`，不得据此开启任何生产发布开关。
- GitHub Actions 仍是独立审计、可复现报告、候选构建和未来受保护发布入口；晚到或漏投的 GitHub 运行不能覆盖腾讯云记录的 `late`、`failed` 或 `expired` 状态。仓库级 `AUTOMATIC_RELEASE_ENABLED` 和生产 Environment 级 `PRODUCTION_RELEASE_AUTHORIZED` 继续保持精确 `false` 或未设置。

## 2026-08-26 自动发现补查与守护器状态

> 历史快照：本节记录严格发现器部署前的状态，已被上方“严格发现器部署与有限验证（当前）”取代，不作为当前实现事实。

- 今日北京时间 09:24 手动补查 `monthly-data-check` 已成功完成：GitHub Actions 运行 `32918833520`（`workflow_dispatch`，提交 `0a560edfae1d21cd22eeaff75d1f8856e096600c`）。随后 `monthly-data-auto-publish` 运行 `32918879532` 的 `inspect` 成功，`prepare` 与 `publish` 按关闭门禁跳过；没有生产写入。
- 09:55 现场调用 CloudBase `monthlyDataWatchdog` 返回 `already_dispatched`，对应 09:00 北京时间窗口和补查运行 `32918833520`。这证明今天的漏投窗口已由人工补查覆盖，但不是 GitHub `schedule` 自身准时到达的证据。
- 守护器当前仍为 `WATCHDOG_DRY_RUN=true`，因此尚未具备自动补触发资格。启用前必须先撤销已在函数详情中明文回显的旧 GitHub Fine-grained token，换成新的仓库级最小权限令牌，并在 CloudBase 现场回读新令牌已配置、dry-run 仍为 `true`；完成一个完整发布时间窗口观察后，维护人再单独确认是否改为 `false`。该项不涉及小程序页面或版本号，也不改变两个生产发布开关（仍为 `false`）。

## 2026-08-26 月度自动更新执行方案

- 用户已确认后续月度自动更新必须遵循 [`MONTHLY_DATA_AUTOMATION_PLAN.md`](MONTHLY_DATA_AUTOMATION_PLAN.md)。该方案定义严格20分钟发现、职责分离、失败关闭和验收边界；具体北京时间与Cron仍只以 `MINIPROGRAM_DATA_UPDATE.md` 为准。
- 当时状态为 `approved / not_started`；该结论仅保留为部署前历史记录。后续严格发现器已完成部署，但完整发布时间窗口的线上 27 时段证据仍未完成。

## 2026-08-25 本轮收尾状态

- A01-A06 自动更新可靠性修复、独立守护器和小程序构建输入已提交到 `main`，实现提交为 `be351cca8a36c26898f4f46da372ef63205991c2`，文档收尾提交为 `783263de6795023a17dae7a82beec802ffc0af72`；当前候选版本号已由 `v2.5.16` 调整为 `v2.5.17`，并同步到微信开发者工具目录。历史 `v2.5.16` 候选曾在 `1a91ae2` 短暂使用，随后由 `958a9c6` 改回 `v2.5.15`，不作为当前候选或发布证据。
- GitHub Actions 普通 `ci / verify` 运行 `32747632680` 已成功完成 `npm run check` 和 `npm run test:e2e`（39项通过、1项按配置跳过）。这只证明当前主分支提交的普通 CI 通过，不代表生产发布或微信平台发布。
- GitHub 仓库级 `AUTOMATIC_RELEASE_ENABLED=false` 与生产 Environment 级 `PRODUCTION_RELEASE_AUTHORIZED=false` 已现场复读；CloudBase 守护器保持 `WATCHDOG_DRY_RUN=true`，没有触发线上工作流、生产数据、正式指针或生产发布写入。
- 2026-08-25 手动触发只读 `monthly-data-check`（运行 `32749279961`）已实际执行到发现任务，但因仓库级 `TENCENTCLOUD_MONITOR_SECRET_ID`、`TENCENTCLOUD_MONITOR_SECRET_KEY` 为空而在“读取正式指针”步骤失败。两项同名密钥目前只存在于 `housing-data-production` Environment；按工作流安全测试，候选准备任务不得绑定该受保护环境，因此必须由维护人把只读密钥以同名方式配置到仓库级 Secrets 后再重跑。该失败未生成候选、未进入发布、未写生产数据。

## 2026-08-07 自动更新历史记录（不代表当前启用）

- 当前源码版本为 `v2.5.15`，精确提交为 `60d3cb38f2bd47694aa1a7c78d674eeb1d1cfb79`。GitHub Actions `31137756505` 已成功完成唯一一组 36 个月普通月度隔离回放：`2023-07 -> 2026-06` 共 36/36 轮通过。工件报告位于 `work/evidence-download/31137756505/full-auto-update-replay-31137756505-1/31137756505-1/report.json`；报告记录生产指针与正式发布目录均未触碰，且回放时 `automatic_release_enabled=false`。
- 独立的历史修订云端回放为 GitHub Actions `31137756549`，12 轮通过。普通月度与历史修订的两类证据分别保留，不互相替代。
- 维护人授权后，历史记录曾独立设置并回读仓库级 `AUTOMATIC_RELEASE_ENABLED=true` 和 `housing-data-production` Environment 级 `PRODUCTION_RELEASE_AUTHORIZED=true`。该记录只证明当时状态，不能替代当前现场回读；当前实现和启用清单仍按 `automation_disabled` 失败关闭处理，D19 未关闭前不得宣称通知链路已完全无人值守。

## 2026-08-21 月度自动更新可靠性修复（本地验证）

- 按 `MONTHLY_DATA_AUTOMATION_AUDIT_20260820.md` 的 A01-A06 完成当前本地实现：候选数据只生成到 `work/auto-release/candidate/`；状态在确认官方原文身份后先写入 `preparing`；稳定 `release_key`、候选身份和首次时间种子用于重试；发现与排队候选都会复查默认分支上的持久化状态；已发布月份以生产 `current.json` 的只读回读为准；HTTP完整正文读取纳入重试边界。
- 待发布恢复现在从首次候选运行的精确 Artifact 恢复 `snapshot.cjs` 和远程候选包，并逐项核验，不再重新抓取、审计或生成另一份候选。待发布状态保存该 Artifact 的运行编号，缺失或格式不正确时失败关闭。
- 本机已通过 `npm run check`、`npm run test:e2e`（39项通过、1项按配置跳过）、工作流YAML解析、TypeScript检查和恢复流程定向测试。上述只证明本地实现和测试结果，不代表工作流已在GitHub实际运行、腾讯云守护器已部署或生产环境可用。
- 2026-08-21 按当时生效的36个月标准，使用隔离审计报告完成改造后本地36个月回放，`36/36` 轮通过；包含远程文件缺失、下载中断、缓存写入失败和撤销注册表故障注入，报告确认 `production_pointer_untouched=true`、`production_release_prefix_untouched=true`。该记录现仅作历史证据；可复查报告保存在项目外临时证据目录 `C:\Users\user\AppData\Local\Temp\housing-data-auto-update-audit-20260821-remainder\replay-36-report.json`。
- 2026-08-24 已将只读监测函数部署到 CloudBase 环境 `cloud1-d3gpdx70w5d05c68c`，配置 GitHub 最小权限令牌、状态集合 `monthlyDataWatchdog` 和 `0 */5 * * * * *` 定时触发器；首次线上 dry-run 返回 `schedule_observed`，未补触发工作流。随后现场发现仓库级和生产 Environment 级发布开关均为 `true`，已关闭并分别复读为 `false`；没有生产数据、正式指针或发布写入。
- 2026-08-24 线上 `monthly-data-auto-publish.yml` 运行 `32683024358` 在候选持久化阶段失败，原因是旧提交仍把生成的 `apps/miniprogram/data/snapshot.js` 判为未允许路径；该失败没有进入 publish job。修复已由 `be351cca8a36c26898f4f46da372ef63205991c2` 推送并通过普通 CI，后续仍须按启用清单完成真实发布时间窗口和平台证据，不能据此开启生产发布。

## 2026-08-25 隔离验证标准决策

- 用户明确将普通月度自动更新的隔离验证从原先的 36 个月/多组重复执行，永久收敛为**单组连续 6 个月**；历史 36 个月报告和旧回放失败证据保持原样，只作为历史证据。
- 当前 R02 关闭条件因此改为：当前精确候选完成单组 6 个月普通月度回放，并另行完成历史修订专项 12 轮；两条证据仍不得互相替代。脚本保留更长月份的诊断能力，但非 6 个月运行不具备当前启用门槛资格。
- 该决策已同步 `MINIPROGRAM_DATA_UPDATE.md`、`AUTOMATION_ACTIVATION_CHECKLIST.md`、`.github/workflows/full-auto-update-replay.yml` 和工作流安全测试；两个生产开关继续保持失败关闭。
- 本次外部状态复核：仓库级与 `housing-data-production` Environment 级两个生产开关均为精确字符串 `false`；只读监测Secret名称已在两级作用域存在，`monthly-data-check` 运行 `32823542147` 成功，随后 `monthly-data-auto-publish` 运行 `32823605926` 的 `prepare/publish` 均因关闭门禁跳过，未写入生产。`monthly-data-post-publish-monitor` 的相关只读运行成功，但不构成发布或自动化启用证据。
- GitHub 全历史回放运行 `32824619838` 在正式隔离写入前因根目录审计报告落后于仓库已存在的 `2026-07` 原始批次而失败；生产指针和正式目录未触碰。修复后提交 `4fe02a4a6f856d5d29f58f8bf23d55585ae79505` 已推送，并在运行前生成、复用当前临时审计报告。
- 本地重新生成当前临时审计报告后，普通月度单组连续6个月回放 `6/6`（2026-01至2026-06）通过；报告记录 `production_pointer_untouched=true`、`production_release_prefix_untouched=true` 和 `automatic_release_enabled=false`，仅为本地/隔离证据，不能替代真实云端、开发者工具或真机证据。
- 真实云端复核已完成：`full-auto-update-replay` 运行 `32835008415` 在提交 `4fe02a4` 上完成普通月度 `6/6`（2026-01至2026-06），每轮72个数据对象全量回读、切城下载为0；`historical-correction-replay` 运行 `32835011782` 完成历史修订 `12/12`。两份报告均确认生产指针和正式目录未触碰、`automatic_release_enabled=false`，写入前缀分别为各自 `housing-data/rehearsals/<run-id>/`。随后只读 `monthly-data-check` 运行 `32836001672` 成功，回读的生产 `current.json` 与回放前运行 `32823542147` 的 SHA-256 均为 `d15b9ea0727f2e88b6aa936a3959396e8673ac32c60c873931ffac8934d0989c`；该检查发现官方 `2026-07` 已发布但没有自动上线。

### 2026-08-24 独立守护器实现（已部署，dry-run）

- 已新增 `apps/miniprogram/cloudfunctions/monthlyDataWatchdog/`，只查询 GitHub Actions 定时/手动运行记录，在宽限时间后对缺失的 `monthly-data-check.yml` 进行一次性补触发判断，并按发布运行 ID 对长时间卡住的候选发布生成一次性日志告警；不读取生产对象、不持有腾讯云生产密钥、不修改生产开关。
- 已新增本地决策测试和模拟 GitHub API 测试；真实函数、最小权限令牌、CloudBase 状态集合和定时触发器已部署，`WATCHDOG_DRY_RUN=true` 的线上首次调用返回 `schedule_observed`。必须继续观察完整官方发布时间窗口，确认日志正常后才可由维护人将 `WATCHDOG_DRY_RUN` 改为 `false`；步骤见 [`MONTHLY_DATA_WATCHDOG.md`](MONTHLY_DATA_WATCHDOG.md)。

本文件记录权威规范与当前实现之间的差距，不另行定义产品、数据或发布规则。R01-R07、D01-D20、I01-I14与V01-V19涉及的目标要求以 `AGENTS.md`、`PRODUCT.md`、`DATA_CONTRACT.md`、`ACCEPTANCE.md`、`MINIPROGRAM_VERSIONING.md`、`RELEASE_READINESS.md` 和 `MINIPROGRAM_DATA_UPDATE.md` 的对应条款为准；项目全部权威规范及职责边界以 [文档索引](DOCUMENT_INDEX.md) 为准。

当前界面和功能事实以 `apps/web/` 与 `apps/miniprogram/` 为准。唯一源码版本为 `v2.5.28`；`v2.5.27` 及更早版本的候选、CI和平台记录均按其日期保留为历史证据，不能替代当前版本的身份补证。维护人已确认当前版本的双真机、微信审核和正式发布；当前工作区尚未生成可回读的 `v2.5.28` 不可变候选、同提交 CI和正式远程数据回读，因此自动更新代码仍只能按已登记的有限证据评估。S00-S09及V01-V12最初的规范治理轮次没有修改 Web、小程序、生成数据、云端资源或当前页面；后续单独批准的S10只修改小程序远程数据运行时、控制面和发布/回滚工具，不修改正常数据页面。V13-V18与D08后续实施只修改已批准的数据审计、客户端元数据、工作流安全、测试和对应规范；2026-07-31另行批准实施D08-D14、I01-I03、I11、V01和V07后，小程序新增数据不可用错误态、定位披露及缓存清理。真实默认启动随后暴露“没有可信控制状态即禁用完整内置快照”的严重回退，原失败证据和重新打开记录继续保留；同日完成最小运行时修复及本地回归后，D10、D13恢复为 `implemented/passed_limited`，S10和I01恢复为 `partial/passed_limited`，仍不代表真实CI、云端、远程完整包或自动更新验收通过。下表中的 `approved` 只表示方案已经确认，不能理解为代码已经实现、测试已经通过或生产能力已经启用；各项实现与有限验证另按本文件专项登记。

2026-08-01至2026-08-02完成唯一legacy控制迁移实现、固定验证器契约、两阶段写入/严格收尾、十分钟动态严格回执、精确旧包兼容和 `onShow` 同步非阻塞收口；这些变更已整理到精确提交 `cdea2207ff8f570aa1d8725ea474f22df30f26c8`，普通GitHub CI运行 `30736720927` 已通过 `npm run check` 与 `npm run test:e2e`。上述证据仍不代表云函数部署、生产迁移、开发者工具、双真机或微信平台/正式发布通过。写入阶段不再依赖旧云函数的`describe_validator`，收尾阶段才在新版云函数部署后执行真实预检和回执验证。

## 状态规则

- `spec_status`：`approved` 或 `superseded`。`approved` 表示当前生效的已批准目标，`superseded` 表示已被后续决策替代且不再执行；两者互斥，不再使用含义重复的 `current`。
- `implementation_status`：`not_started`、`partial`、`implemented`。
- `verification_status`：`not_tested`、`failed`、`passed_limited`、`passed`。`not_tested`表示没有当前可复查证据；`failed`表示当前证据与目标不符并阻断关闭；`passed_limited`表示只在登记的有限范围内通过，必须绑定`verification_scope`、证据身份、复核人和复核日期，不能解除生产阻断、不能描述为完整能力或外部平台已通过；`passed`只表示全部适用实现、测试、外部演练和独立复核证据齐全并可解除对应阻断。
- 本规则建立前已有的`passed_limited`只保留其行内明确限定的历史范围；没有补齐证据登记字段时不得扩大解释，也不得据此关闭编号。下一次状态变化前必须先补齐对应证据登记和迁移记录。
- `not_approved` 只用于记录用户明确拒绝的备选方案，不属于待实施的 `spec_status`。该行的实现和验证状态使用 `-`，不得在后续工作中自动重新加入待办。
- 用户对规范目标的变化追加到“决策记录”，包含日期、决策依据和 `supersedes`；实现/验证状态变化追加到“状态迁移记录”，包含编号、原状态、新状态、`verification_scope`、证据身份、复核人和日期。不得覆盖旧决策或旧迁移，也不得把旧目标改写成新目标。新目标使用新编号，旧编号只更新为 `superseded`。
- `partial` 必须在“当前实现依据”中绑定精确源码基线和路径；这些路径只证明已有相关代码，不能替代关闭证据。
- 只有代码、自动化测试、必要的云端/真机演练和可复查证据全部完成后，才能把项目标记为 `passed`。
- 文档补充、口头确认、旧版本测试或仅有模拟结果都不能单独关闭问题。
- 生产自动发布完整硬门槛只在 `AUTOMATION_ACTIVATION_CHECKLIST.md` 维护；本文件只登记该清单引用编号的实现、验证和证据状态。清单任一适用项未关闭时，仓库级 `AUTOMATIC_RELEASE_ENABLED` 必须保持 `false`，生产 Environment 级 `PRODUCTION_RELEASE_AUTHORIZED` 必须保持 `false` 或未设置；不得把普通月度发布、历史修订或回滚描述为已经具备完整无人值守安全闭环。
- `D17-D19` 分别限制跨年 SLA、历史页面修订发现和无人值守通知声明；`D20` 在跨平台结果契约建立前阻止共享计算逻辑重构，但不要求改变当前页面。

## S00-S09 前次治理结论可追溯性

仓库现有文档只保留了“S00-S09已同意、以当前Web和小程序为事实基线、本轮不改页面或代码”的汇总结论，没有保留十项原始问题定义、逐项规范落点或关闭证据。为避免凭聊天记忆补造历史，本表只登记能够确认的事实；在找到原始审计报告前，十项均为 `definition_missing / cannot_reverify`，不得据此宣称已经实现、验证或关闭，也不得把未知定义换名后重新列为新要求。

| ID | 已知用户决策 | 原始定义 | 实现状态 | 复核状态 | 当前处理 |
| --- | --- | --- | --- | --- | --- |
| S00 | `approved` | `definition_missing` | `unknown` | `cannot_reverify` | 保留汇总结论；找到原始证据后只追加定义和落点，不反推实现 |
| S01 | `approved` | `definition_missing` | `unknown` | `cannot_reverify` | 同上 |
| S02 | `approved` | `definition_missing` | `unknown` | `cannot_reverify` | 同上 |
| S03 | `approved` | `definition_missing` | `unknown` | `cannot_reverify` | 同上 |
| S04 | `approved` | `definition_missing` | `unknown` | `cannot_reverify` | 同上 |
| S05 | `approved` | `definition_missing` | `unknown` | `cannot_reverify` | 同上 |
| S06 | `approved` | `definition_missing` | `unknown` | `cannot_reverify` | 同上 |
| S07 | `approved` | `definition_missing` | `unknown` | `cannot_reverify` | 同上 |
| S08 | `approved` | `definition_missing` | `unknown` | `cannot_reverify` | 同上 |
| S09 | `approved` | `definition_missing` | `unknown` | `cannot_reverify` | 同上 |

该缺口只影响历史决策的逐项复核，不授权修改当前 `apps/web/`、`apps/miniprogram/`、数据、工作流或页面。后续发现原始定义时，必须保存原始来源、日期和证据身份；无法证明与某项完全相同时使用新编号，不覆盖本表。

## C01-C05 文档一致性登记

本组登记时的历史事实基线是源码提交 `c1b52a06be9c53dc16af7ec97cf2c574c7735496` 的 `apps/web/`、`apps/miniprogram/` 及当时仓库状态；当前实现事实以精确提交 `cdea2207ff8f570aa1d8725ea474f22df30f26c8` 及源码为准。C组结论不构成对当前代码、生产或平台状态的重新验收。

| ID | 用户决策 | 当前问题 | 本轮文档处理 | 保留边界 |
| --- | --- | --- | --- | --- |
| C01 | `approved` | 公开仓库实际跟踪官方 `.html.gz` 和批次复现文件，旧文档却称其为私有或默认不进Git | 已区分公开源码复现档案、未压缩本地缓存、私有运行审计和客户端生产包 | 不删除或迁移现有文件；事实对齐不等于转载、署名或商业使用法律复核通过 |
| C02 | `not_approved` | SLA起点存在备选调整方案 | 不修改 | 继续执行当前权威规范中的SLA起点和计算规则 |
| C03 | `approved` | 旧文档写成精确定位或统一称“重点城市”，与小程序模糊定位及平台术语不一致 | 已按Web“重点城市”和小程序“定位城市/当前城市”分别记录，并补充路由、缓存、匹配和隐私边界 | 不修改定位代码、权限、界面或平台配置；双真机定位验收仍未完成 |
| C04 | `not_approved` | 稳定版本归档与回退存在备选调整方案 | 不修改 | 继续执行 `MINIPROGRAM_VERSIONING.md` 的现有只读归档和回退规则 |
| C05 | `approved` | 市场排名未完整定义并列、分母、子集重排和稳定顺序 | 已明确竞赛排名 `1、1、3`，并登记六城概览的当前平台差异 | 不修改任何排名代码或页面；跨平台实现仍按D20保持 `partial/not_tested`，六城差异继续保留 |

## R01-R07 版本与发布证据登记

本组治理“当前版本能否被旧证据代替、发布包能否复现、Web声明是否属于当前构建、运维时间是否唯一”问题。2026-07-29的原始事实基线是提交 `c1b52a06be9c53dc16af7ec97cf2c574c7735496` 和源码版本 `v2.4.0`；当前源码版本为 `v2.5.15`，精确提交 `b854f8e6911986b556e45b760f27108596c24845` 已生成40文件本地不可变候选。已完成来源身份与构件身份分离、针对性本地测试和完整仓库检查；微信公众平台截图确认该版本在线发布时间为2026-08-06 09:16:40，维护人确认审核通过和正式线上自检完成，但尚无同提交CI、候选绑定的开发者工具和双真机记录、构建号、审核通过时间、正式数据链路明细或稳定归档。旧 `v2.4.10`、`v2.4.9` 和更早候选的 CI、云端回放、构件和真机记录仅属历史候选，不能替代当前源码。文档模板或批准目标不能替代代码、云端、开发者工具、真机和平台证据。

| ID | 用户决策 | 当前问题 | 已批准目标或保留决定 | 实现状态 | 验证状态 | 当前阻断 |
| --- | --- | --- | --- | --- | --- | --- |
| R01 | `approved` | 当前源码为 `v2.5.15`；精确提交已生成本地不可变候选，微信公众平台截图确认线上版本和发布时间，维护人确认审核通过和线上自检完成，但尚无同提交CI、候选绑定的开发者工具/双真机记录、构建号、审核通过时间或正式数据链路明细 | 使用现有不可变候选补齐上线审查、交接、Android和iPhone全量验收及正式数据链路回读；旧版证据只读保留 | `partial` | `passed_limited` | 阻断候选与线上版本的可复核绑定、稳定归档、远程数据和自动更新结论 |
| R02 | `approved` | 普通月度与历史修订的真实隔离回放已在当前提交完成，但不能证明外部微信平台验收 | 在当前精确提交分别完成普通月度单组连续6个月和历史修订专项12轮故障回放，两条证据不得互相替代 | `partial` | `passed_limited` | 云函数部署、开发者工具和双真机证据仍待补齐；两条回放本身已由 `32835008415` 与 `32835011782` 通过 |
| R03 | `approved` | `v2.5.25` 已从干净临时检出的精确提交生成45文件只读候选ZIP并回读清单和哈希；稳定归档仍不能按新规则生成 | `scripts/miniprogram/deterministic-candidate.mjs` 已能从精确提交生成确定性候选ZIP、回读清单和候选哈希；重复构建、乱序、排除项、非ASCII路径和损坏ZIP测试已覆盖。下一步须在另一环境复现同一候选字节，再完成候选绑定的开发者工具和双真机验收 | `implemented` | `passed_limited` | 仍阻断按新规则新增稳定归档、候选跨环境复现和全部外部验收 |
| R04 | `approved` | 归档只有人工版本说明和ZIP SHA，未绑定代码、数据、解析器、审计器及CI运行 | 自动生成并校验 `release-manifest.json`，机器绑定Git SHA、数据身份、归档身份、解析器、审计器、CI和编译证据 | `implemented` | `passed_limited` | 尚无真实候选的全部外部通过证据、跨环境复现和首个新格式归档；阻断可追溯稳定归档和精确恢复声明 |
| R05 | `not_approved` | 曾提出用受保护Git Tag或GitHub Release增强防篡改 | 不实施该备选方案；继续使用只读归档目录与同目录ZIP SHA-256规则 | - | - | 不是待办，不得新增为发布前置条件 |
| R06 | `approved` | Web声明与校验器已升级为schema 2；空白模板和任一身份/有效期不一致均失败关闭 | schema 2绑定精确提交、规范化构建哈希、数据版本和清单哈希、正式域名、证据索引及有效期 | `implemented` | `passed_limited` | 尚无真实正式构建、外部验收证据索引和线上回读；阻断把本地测试描述为构建级发布证明 |
| R07 | `approved` | 自动发现时段曾在多份文档和工作流中漂移 | 具体时间只在自动更新规范维护，README只引用；CI同时校验规范、工作流和守护器时段 | `implemented` | `passed_limited` | 本地机器测试可阻断时段漂移；仍需默认分支生效后观察GitHub与守护器实际运行 |

### 当前实现依据与关闭条件

| ID | 当前实现依据 | 仍需关闭证据 |
| --- | --- | --- |
| R01 | `apps/miniprogram/config/version.js`；精确提交 `b854f8e6911986b556e45b760f27108596c24845` 的 `v2.5.15` 40文件本地候选；微信公众平台截图确认版本`2.5.15`在线发布时间为2026-08-06 09:16:40，维护人确认审核通过和线上自检完成；所有 `v2.5.6` 及更早候选、模板和真机记录均为历史证据 | 完成同提交CI、候选绑定的开发者工具重新编译和Android/iPhone结果、构建号、审核通过时间、正式数据链路回读及完整交接 |
| R02 | `.github/workflows/full-auto-update-replay.yml`、`.github/workflows/historical-correction-replay.yml`：提交 `4fe02a4` 的真实运行 `32835008415` 已完成普通月度单组6/6（2026-01至2026-06），运行 `32835011782` 已完成历史修订12/12；普通回放逐轮验证560条新增、历史零变化、错误候选阻断、72个数据对象全量回读、完整70城启用和切城零下载，历史回放逐轮验证隔离对象、指针中断前后回滚和失败关闭。两次生产指针/正式目录均未触及，自动发布仍关闭 | 云函数部署、开发者工具和双真机证据；回放结果不能替代正式平台验收 |
| R03 | `scripts/miniprogram/deterministic-candidate.mjs`、`deterministic-candidate.test.mjs`、`package.json` 的 `miniprogram:candidate` 命令；精确提交 `b854f8e6911986b556e45b760f27108596c24845` 的定向9项测试、完整仓库检查和336项小程序测试通过，已生成40文件的`v2.5.15`候选并回读ZIP、候选清单和文件清单哈希 | 在另一环境复现相同候选SHA-256；随后实现原字节晋级和稳定归档记录 |
| R04 | `promote-stable-candidate.mjs` 会验证候选原字节、候选清单、CI/开发者工具/双真机/平台/线上回读证据，临时生成并回读稳定归档后原子完成；定向正反向测试已通过 | 真实候选的跨环境复现、六类外部证据和首个新格式稳定归档 |
| R05 | 用户明确不同意 | 无；保持现状，除非未来取得新的明确决定并使用新决策记录 |
| R06 | `release/attestations.json`、`release/evidence-index.json` 与 `release-readiness.mjs` 使用schema 2绑定提交/构建/数据/域名/证据/有效期；12项定向测试覆盖正反向情形 | 一次真实正式构建、外部验收证据索引和线上回读验证 |
| R07 | `README.md` 已只引用权威规范；`MINIPROGRAM_DATA_UPDATE.md` 已集中时间表；工作流当前实际时间与表一致 | CI从规范和工作流分别解析规范化时间集合、证明相等，并用漂移fixture证明不一致时失败 |

## D01-D20 登记

| ID | 当前问题 | 已批准目标 | 权威规范落点 | 实现状态 | 验证状态 | 当前阻断 |
| --- | --- | --- | --- | --- | --- | --- |
| D01 | 候选指针可能先切换，守卫失败且无安全回退目标时无法保证线上指针不变 | 全部正确性检查、远端回读和逐值重建在切指针前完成；无安全回退目标禁止切换；失败时原指针字节和哈希不变 | `MINIPROGRAM_DATA_UPDATE.md`“自动生成与发布”“受保护发布与回滚” | `implemented` | `passed_limited`（验证范围：本地 `npm run check`，含351项小程序测试；网页端到端39项通过、1项按配置跳过。证据身份：当前未提交工作区；复核：Codex；日期：2026-08-06。覆盖候选写入前的完整回退包预检、旧完整审计原字节绑定、云环境/存储桶/运行ID与重跑编号精确绑定） | 仍缺当前精确提交CI、真实受保护Environment、生产只读监测和真实云端故障/回滚证据；`AUTOMATIC_RELEASE_ENABLED` 与 `PRODUCTION_RELEASE_AUTHORIZED` 继续保持关闭 |
| D02 | 历史修订激活后重跑时，新旧来源判断不唯一 | 建立 `old_active`、`candidate_active`、`conflict` 三态及每个中断点的幂等恢复规则 | `MINIPROGRAM_DATA_UPDATE.md`“受保护发布与回滚” | `partial` | `passed_limited`（本地三态和不完整身份冲突测试） | 仍缺真实云端全部中断点恢复证据，阻断历史修订发布 |
| D03 | 独立审计未绑定即将发布的完整候选内容 | 审计报告和门禁绑定完整标准记录哈希、完整来源索引哈希及精确提交 SHA | `DATA_CONTRACT.md`“版本身份与独立审计” | `implemented` | `passed_limited`（本地身份重算、报告自身哈希、来源索引逐批证据与候选集合测试；定向 `29/29`、完整小程序套件 `473/473`） | 仍缺当前精确提交CI、真实受保护Environment和正式候选外部证据，阻断生产自动发布 |
| D04 | 未证明 `revisions.json` 只做了准确追加 | 校验旧账本前缀、前后哈希、本次新增集合和 `supersedes_revision_id` 连续性 | `DATA_CONTRACT.md`“修订记录” | `implemented` | `passed_limited`（本地账本前缀、追加集合、哈希和连续 supersession 失败关闭测试） | 仍缺真实云端跨运行恢复和正式历史修订证据，阻断历史修订发布 |
| D05 | `revision_type` 同时被当作发布类别和错误原因 | 发布类别固定使用 `release_type=historical_correction`；原因使用独立 `reason_type` 枚举 | `DATA_CONTRACT.md`“修订记录”；`MINIPROGRAM_DATA_UPDATE.md`“修订申请与证据” | `implemented` | `passed_limited`（本地 release/reason 字段分离及旧 `revision_type` 拒绝测试） | 仍缺真实受保护Environment和正式历史修订证据，阻断历史修订发布 |
| D06 | 数据版本哈希未定义完整业务字段输入 | 定义规范化序列化和哈希字段全集；任一业务字段变化必须产生新版本 | `DATA_CONTRACT.md`“版本身份与独立审计” | `implemented` | `passed_limited`（完整候选业务字段规范化哈希、业务字段变化与运行时元数据排除测试） | 仍缺当前精确提交CI、正式候选外部证据，阻断生产自动发布 |
| D07 | 单一 `source_batch_ids` 可能漏记被修订的历史批次 | 分开记录最新月份批次和全部历史修订批次，并与逐项差异双向核对 | `MINIPROGRAM_DATA_UPDATE.md`“清单契约”“修订申请与证据” | `implemented` | `passed_limited`（最新/修订来源批次集合精确匹配及候选 staging 门禁测试） | 仍缺真实云端私有审计索引、跨运行回读和正式候选外部证据，阻断历史修订发布 |
| D08 | 客户端结构校验不足以证明身份、城市资料、数值和派生结果正确 | 精确验证版本月份、发布日期、国家统计局URL、70城集合及 `name/search/province/tier/tierLabel` 城市资料、有限数/允许的 `null`、连续月份和趋势原始序列，并逐月重算温度所用涨平跌缺失计数、排名和累计结果 | `MINIPROGRAM_DATA_UPDATE.md`“下载与原子启用” | `implemented` | `passed_limited`（本地完整快照正反向测试） | 仍需当前精确候选CI、真实云端包和双真机证据 |
| D09 | 客户端落盘后的逐文件回读和崩溃边界证据不足 | 临时目录写入完成后逐文件回读大小、哈希和版本；全部通过才单次切活动状态 | `MINIPROGRAM_DATA_UPDATE.md`“下载与原子启用” | `implemented` | `passed_limited`（本地写后回读、改名后损坏和状态提交失败测试） | 仍需真机文件系统及崩溃恢复证据 |
| D10 | 无正确数据时仍可能让全 `null` 快照进入正常计算；本轮曾把完整内置快照在无控制状态时误判为无正确数据 | 使用真正的运行时 `unavailable` 状态，禁止排名、平均、温度、趋势、累计及市场结论，只保留说明、重试和来源入口；随包审计快照是独立可信基线，只有自身校验失败或命中已知撤销且无安全替代时才不可用 | `PRODUCT.md`“不可用数据状态”；`DATA_CONTRACT.md`“数据清单”；`ACCEPTANCE.md`“功能” | `implemented` | `passed_limited`（本地首次安装、清储、离线、控制过期、远程损坏、已知撤销及页面启动回归） | 仍需微信开发者工具、真实云函数及Android/iPhone验证 |
| D11 | 人工回滚只验证清单，未验证完整目标版本 | 回滚前完整下载并验证清单、bootstrap、70城兼容分片、修订文件、派生结果、兼容性和当前撤销登记，再生成新指针 | `MINIPROGRAM_DATA_UPDATE.md`“回滚规范” | `partial` | `passed_limited`（本地完整包、数据包/源版本同代次双重撤销、不可变Intent、切换后只读审计恢复、损坏目标、冲突阻断、受保护工作流和双开关授权测试） | 仍缺对象级CAS、真实GitHub跨运行Artifact恢复、受保护Environment及真实云端中断/回滚证据，阻断生产自动发布 |
| D12 | 活动指针、撤销列表和缓存状态分开保存时可能产生数据指针分裂，单一主状态写入失败又可能丢失刚取得的撤销 | 使用单一带版本号的主状态原子保存活动版本、源版本、缓存、检查及完整控制状态；另以不含任何数据指针的只增控制墓碑先行保存最近受信控制和撤销，启动合并较新代次，既避免缓存双指针又防止主状态失败后复活已撤销数据 | `MINIPROGRAM_DATA_UPDATE.md`“本地状态事务与缓存保留” | `implemented` | `passed_limited`（本地schema迁移、主状态/墓碑独立失败、合法新旧代次合并、安全回退和重启测试） | 仍需真机存储失败和崩溃恢复证据 |
| D13 | 清除本地存储后会丢失曾持久化的撤销记忆，且无法可靠区分首次安装离线和清储后离线 | 随包审计快照是独立可信基线；首次安装/清储/控制状态过期或暂不可得时可在自身校验后使用，并立即或恢复联网后刷新控制面。已持久化或在线取得的撤销必须单调生效；控制过期不得授权新远程切换，但不单独触发 `unavailable` | `MINIPROGRAM_DATA_UPDATE.md`“检查频率”“失败与降级” | `implemented` | `passed_limited`（本地首次安装、清储、离线、控制/回执过期及撤销单调性测试） | 仍需真实云函数部署、前后台和Android/iPhone验证 |
| D14 | 失败半包、崩溃后孤儿目录和长期累积的本地旧版本缺少统一清理 | 失败回调删除临时包；每次启动按单一本地状态幂等清理未引用临时/孤儿目录；成功后只保留活动版本和一个未撤销且已验证的安全回退版本；删除失败必须显式返回失败 | `MINIPROGRAM_DATA_UPDATE.md`“本地状态事务与缓存保留” | `implemented` | `passed_limited`（本地临时/孤儿清理、删除失败和三版本保留测试） | 仍需真机文件系统和进程中断证据 |
| D15 | 历史修订未证明自动进入统一私有审计和24小时监测 | 月度发布与历史修订使用同一发布登记；修订切换成功后自动触发同一只读监测并绑定修订身份 | `MINIPROGRAM_DATA_UPDATE.md`“统一发布登记与监测” | `partial` | `passed_limited`（本地统一选择器覆盖普通发布、人工修正版、历史修订和回滚审计及24小时边界） | 仍缺真实GitHub定时触发、私有审计索引和故障通知闭环，阻断历史修订发布 |
| D16 | 私有审计仍按单月份/单组原始文件假设收集证据 | 按全部 `revision_source_batch_ids` 收齐并验证原始归档、URL、SHA和恢复结果 | `DATA_CONTRACT.md`“来源批次”；`MINIPROGRAM_DATA_UPDATE.md`“修订申请与证据” | `implemented` | `passed_limited`（本地精确批次集合、缺失/重复/损坏归档和原始字节恢复测试） | 真实云端私有审计索引、跨运行回读和当前候选外部证据仍未完成，阻断历史修订发布 |
| D17 | 中国法定工作日配置只覆盖2026年 | 每年使用可追溯官方配置；下一年未发布时标记 `waiting_for_official_calendar`，只限制跨年 SLA | `DATA_CONTRACT.md`“更新SLA”；`MINIPROGRAM_DATA_UPDATE.md`“长期维护职责” | `implemented` | `passed_limited`（`scripts/data/status.test.ts` 5/5；覆盖2026官方元数据、调休、未知2027和跨年截止日） | 2027官方配置发布后需现场更新并回读；当前无外部部署证据 |
| D18 | 只发现新月份，不定期检查官方历史页面变化 | 定期复核历史官方 URL 和哈希；变化只创建隔离修订任务，不直接改数据或指针 | `DATA_CONTRACT.md`“采集流程”；`MINIPROGRAM_DATA_UPDATE.md`“历史页面复核” | `implemented` | `passed_limited`（本地只读复核、HTML/XHTML响应校验、哈希/重定向变化隔离和失败关闭测试） | GitHub季度工作流首次线上运行、真实变化后的人工隔离处置和证据保留仍未完成 |
| D19 | GitHub任务失败没有接收人、确认时限和恢复闭环 | 使用去重 Issue 或等价渠道，记录负责人、时限、状态、故障指纹和恢复证据 | `MINIPROGRAM_DATA_UPDATE.md`“通知闭环” | `implemented` | `passed_limited`（本地去重、负责人确认、一次升级、SHA-256恢复关闭和输入拒绝测试） | `HOUSING_DATA_INCIDENT_OWNER`、真实GitHub打开/确认/超时/恢复演练仍未完成；不得声称无人值守 |
| D20 | Web和小程序分别计算排名、涨跌计数和累计变化 | 先建立绑定SHA-256的版本化输入、独立期望结果和完整筛选/边界矩阵的跨平台逐值一致测试，再逐步迁入共享核心；页面结果和交互保持不变 | `PRODUCT.md`“跨平台计算一致性”；`ACCEPTANCE.md`“工程与复现” | `implemented` | `passed_limited`（`cross-platform-oracle.test.mjs` 3/3；144个组合逐值核对，含缺失/并列边界） | 仍需当前候选同提交CI、开发者工具和双真机证据；本轮未迁移共享逻辑 |

## 当前实现依据

本表登记当前 Web 和小程序事实基线。2026-07-31的 `v2.4.1` 本地候选在原S10增量上继续实现D08-D14及I01-I03的客户端和控制面路径；默认启动回退及其失败记录继续保留，当前实现已完成最小运行时修复并恢复D10、D13、S10和I01的本地有限证据。2026-08-01至2026-08-02进一步加入唯一legacy迁移、动态验证回执、生产写入双开关、受保护人工回滚、不可变回滚Intent、切换后审计恢复、精确`run_id + run_attempt`写入/恢复边界、最终收尾attempt监测身份和递归工作流安全扫描；当前小程序脚本套件285项及legacy迁移/回滚Intent/授权/监测选择/工作流安全定向组合65项全部通过；标准 npm 迁移入口已固定使用批准的 `legacy-control-2026-06-e9788d0bddf3`，默认保持 dry-run，本地迁移 dry-run 和入口回归验证通过，未写入生产对象；另完成两次独立6轮普通月度隔离回放，合计12次执行，登记在R02和当前版本回放报告中。代码及工作流已固定在精确提交 `cdea2207ff8f570aa1d8725ea474f22df30f26c8`，普通GitHub CI运行 `30736720927` 已通过；尚未形成稳定归档、真实云端/云函数、开发者工具、双真机或微信平台证据。这些本地结果不能替代受保护生产迁移、开发者工具、双真机或发布证据。

| ID | 当前实现依据 | 边界 |
| --- | --- | --- |
| D01 | `scripts/miniprogram/guarded-activation.mjs`、`post-publish-guard.mjs`、`publish-remote-data.mjs` | 已有指针守卫和发布后检查，未证明全部门禁和安全回退都先于切换 |
| D02 | `scripts/miniprogram/publish-remote-data-guards.mjs`、`publish-remote-data.mjs`、`historical-correction-lib.mjs`、对应测试 | 已实现`old_active/candidate_active/conflict`三态及双重撤销身份检查；未证明真实云端全部中断点幂等恢复 |
| D03 | `scripts/miniprogram/release-audit-lib.mjs`、`bind-auto-gate.mjs`、`publish-private-audit.mjs` | 已有审计绑定，未证明完整候选内容、来源索引和精确提交同时受门禁保护 |
| D04 | `scripts/miniprogram/historical-correction-lib.mjs`、`scripts/data/revision.ts` | 已有修订账本处理，未证明旧前缀和本次追加集合的完整闭环 |
| D05 | `scripts/miniprogram/historical-correction-lib.mjs`、`prepare-historical-correction.mjs` | 已有发布类别和原因字段相关处理，尚未完成全链路字段迁移验证 |
| D06 | `scripts/data/publish.ts`、`scripts/miniprogram/build-data.ts`、`stage-remote-data.mjs` | 已有内容版本生成，尚无完整字段变异黄金样本 |
| D07 | `scripts/miniprogram/historical-correction-lib.mjs`、`publish-private-audit.mjs` | 已有来源批次记录，未证明最新月与全部修订批次双向精确集合 |
| D08 | `apps/miniprogram/utils/data-integrity.js`、`data-runtime.js`、`scripts/miniprogram/data-runtime.test.mjs`、`snapshot.test.mjs` | 已校验版本月份、发布日期、国家统计局URL、精确权威70城集合、城市名称/搜索/省份/线级资料、有限数/`null`、完整series/latest/breadth和派生变化；趋势原始序列逐值验证，逐月重算涨平跌缺失计数、排名与累计计算；仅有本地证据 |
| D09 | `apps/miniprogram/utils/data-runtime.js`、`scripts/miniprogram/data-runtime.test.mjs` | 已使用临时目录写入、逐文件回读、目录改名和状态提交后激活，覆盖损坏及提交失败清理；未做真机进程崩溃演练 |
| D10 | `apps/miniprogram/utils/data-runtime.js`、`apps/miniprogram/pages/index/index.js`/`.wxml`、`scripts/miniprogram/data-runtime.test.mjs`、`scripts/miniprogram/snapshot.test.mjs` | `unavailable` 页面短路、重试和来源入口已存在；完整内置快照在无控制、控制失败或过期时可独立使用，只有自身损坏或命中已知撤销且无安全替代时才不可用；当前只有本地有限证据 |
| D11 | `scripts/miniprogram/rollback-remote-data.mjs`、`scripts/miniprogram/manual-rollback-intent.mjs`、`scripts/miniprogram/ci-rollback-authorization.mjs`、`.github/workflows/manual-data-rollback.yml`、`post-publish-guard.mjs`、`control-plane.mjs`、`repair-current-pointer.mjs` | 已在写指针前下载并校验目标完整包、以同一稳定revision原子撤销坏数据包及其源版本、复核线上基线，并阻止活动回滚已撤销的候选再次发布；任何生产对象写入前先持久化内容寻址`manual-data-rollback-intent-v2`，只有Intent绑定的原始精确`run_id + run_attempt`可在`old_active`写入，同run其他attempt和其他恢复run只能在`target_active`只读重建`manual-data-rollback-audit-v4`，`conflict`失败关闭；Artifact按attempt隔离，审计绑定收尾普通CI，已有耐久审计由无云密钥作业恢复提交。仍缺对象级CAS、真实GitHub跨运行Artifact恢复、受保护Environment和真实云端迁移/回滚证据 |
| D12 | `apps/miniprogram/utils/data-runtime.js` | 已使用单一schema v2状态合并活动版本、安全回退、撤销身份、控制代次、检查状态和目录索引；主状态与控制墓碑任一路径失败仍尝试另一持久化路径，启动可验证合法的新旧代次并保留安全回退；真机事务边界未验证 |
| D13 | `apps/miniprogram/utils/data-runtime.js`、`apps/miniprogram/config/data.js`、`apps/miniprogram/pages/index/index.js`、`apps/miniprogram/cloudfunctions/getHousingDataManifest/validation-receipt.js` | 已有 `control_valid_until`、最长24小时、十分钟身份绑定回执、独立控制调度和`onShow`同步非阻塞/内部防抖；无可信或过期控制只阻断新远程切换并触发刷新，过期回执只允许持久化其精确绑定的撤销，不阻断已验证且无已知撤销的本地数据；真实云函数和真机未验证 |
| D14 | `apps/miniprogram/utils/data-runtime.js` | 已在失败和启动时清理临时/孤儿目录，只保留活动版本与一个验证过的安全回退，并在目录枚举或删除失败时显式报告失败；未做真机进程中断演练 |
| D15 | `scripts/miniprogram/monitor-remote-release.mjs`、`scripts/miniprogram/select-monitor-target.mjs`、`.github/workflows/monthly-data-post-publish-monitor.yml` | 定时入口已从全部不可变发布/回滚审计选择最近24小时最新事件，监测器可用严格回滚审计作为当前指针基线并在末尾复读指针；恢复型人工回滚的即时触发绑定审计v4中的最终收尾提交、`run_id + run_attempt`，原始attempt只用于追溯。已有耐久审计由新run仅恢复提交时不会用新run即时触发，只能依赖原Intent 24小时窗口内的每小时调度；仍缺真实GitHub触发、历史修订私有审计索引和通知恢复证据 |
| D16 | `scripts/miniprogram/private-audit-sources.mjs`、`scripts/miniprogram/private-audit-sources.test.mjs`、`scripts/miniprogram/publish-private-audit.mjs`、`.github/workflows/historical-data-correction.yml` | 本地按完整 `revision_source_batch_ids` 精确枚举唯一归档，逐批恢复并校验官方 URL、原始 SHA-256、压缩归档和恢复字节；真实云端私有审计索引与跨运行回读仍未完成 |
| D17 | `scripts/data/fetch-release-calendar.ts`、`scripts/data/status.ts` | `status.ts` 已保存年度官方配置元数据；未知年份返回 `waiting_for_official_calendar`，跨年SLA不产生猜测截止日；每年仍需官方发布后更新配置 |
| D18 | `scripts/data/historical-page-audit.ts`、`.github/workflows/quarterly-historical-page-audit.yml`、`scripts/data/historical-page-audit.test.ts` | 只枚举当前数据实际引用的官方来源批次，先校验 HTML/XHTML 内容类型，再比较最终 URL/重定向和原始 SHA-256；任一变化或非HTML响应只写入 `work/quarterly-historical-page-audit/` 的隔离人工任务/失败记录。工作流尚未在线运行，真实变化后的人工处置证据仍缺失 |
| D19 | `scripts/miniprogram/incident-lifecycle.mjs`、`scripts/miniprogram/incident-lifecycle.test.mjs`、`.github/workflows/housing-data-incident-lifecycle.yml` | 同故障指纹只创建一个 Issue，指定负责人可确认，逾期只升级一次，工作流并发互斥，恢复必须附带 SHA-256 证据后关闭；负责人变量和真实 GitHub 演练尚未完成 |
| D20 | `apps/web/src/App.tsx`、`apps/miniprogram/pages/index/index.js`、`packages/core/src/index.ts`、`scripts/miniprogram/cross-platform-oracle.mjs` | 已有版本化输入文件身份、独立期望结果和144组合矩阵，逐值核对两端排名/计数/累计结果；尚未迁移共享计算逻辑，外部客户端证据未完成 |

## S10 坏版本撤销与客户端强制回滚

| 编号 | 问题 | 已实现范围 | 实现状态 | 验证状态 | 未关闭边界 |
| --- | --- | --- | --- | --- | --- |
| S10 | 新月份坏包已被客户端激活后，云端回到旧月份会被普通防降级规则拒绝，且旧回滚指针没有携带坏版本撤销信息，重启后可能继续使用坏缓存 | 当前本地候选已有单调控制代次、不可变双重撤销、坏活动状态停用、早于内置月份的精确受控回滚、统一控制指针验证器、唯一legacy指针精确字节迁移、写前验证器身份预检、绑定指针/manifest/撤销/代次的十分钟动态回执、历史修订三态/一般legacy失败关闭、全包验证、人工回滚不可变Intent、原始/收尾attempt绑定、切换后只读审计恢复、冲突失败关闭和最终收尾attempt监测身份，以及不依赖当前控制新鲜度的本地安全替代选择；撤销远程活动包后可切换到已验证远程回退并通知页面重建，持久化故障后重启也不复活坏包 | `partial` | `passed_limited`（本地客户端/控制面故障矩阵、精确legacy迁移、动态回执、回滚Intent与运行时回放） | 仍未部署云函数或生产控制面，未修改生产 `current.json`，未执行受保护生产迁移、真实云端回滚、开发者工具、双真机坏包演练或监测撤销链验证；对象存储仍无真正CAS |

S10相关路径为 `apps/miniprogram/utils/data-runtime.js`、`data-integrity.js`、`apps/miniprogram/cloudfunctions/getHousingDataManifest/validate-current.js`、`scripts/miniprogram/control-plane.mjs`、发布/回滚/守卫/监测入口及对应测试。2026-07-31执行时基线为未提交工作树 `main@c1b52a06be9c53dc16af7ec97cf2c574c7735496`；定向组合测试88项、`npm.cmd run test:miniprogram` 174项、`npm.cmd run check`和`npm.cmd run test:e2e` 40项曾成功退出，随后真实默认启动截图证明该集合漏掉“无远程控制状态但完整内置快照有效”的基线场景，原结果仅作为历史执行记录。完成修复并补齐首次安装/清储/离线/过期控制、远程回退、墓碑/主状态持久化故障、重启、缓存清理失败以及内置来源覆盖起点失败关闭场景后，修复内容已进入精确提交 `cdea2207ff8f570aa1d8725ea474f22df30f26c8`，普通GitHub CI运行 `30736720927` 已通过 `npm run check` 和 `npm run test:e2e`；这些检查不是云函数、开发者工具、双真机或发布证据。`AUTOMATIC_RELEASE_ENABLED` 必须继续保持 `false`。

2026-08-01对 `legacy-control-migration.test.mjs`、`legacy-control-runtime.test.mjs` 和 `validation-receipt.test.mjs` 同次执行36项，全部通过；`snapshot.test.mjs` 与 `validation-receipt.test.mjs` 同次执行31项，全部通过。该组测试在提交前工作区执行，报告绑定其执行时基线；当前实现已固定在 `cdea2207ff8f570aa1d8725ea474f22df30f26c8`，普通GitHub CI运行 `30736720927` 已通过标准检查，但该CI不等于这组回放在同一提交上的重跑，也不表示云函数已部署、生产已迁移或双真机已通过。

## I01-I14 增量收口审计登记

本组是2026-07-29只读增量审计发现并经用户逐项批准的治理目标。`approved` 只表示问题和推荐方向获准；2026-07-31用户随后批准实施，当前本地候选已修改小程序和相关发布/控制面代码，但没有修改Web、生产指针、Secrets、微信平台或稳定归档。与既有D/C/R/S编号重叠时，本表记录新增缺口和关闭条件，不覆盖原编号，也不恢复已否决的C02、C04或R05。

| ID | 当前问题 | 已批准的规范处理 | 与既有项目关系 | 实现状态 | 验证状态 | 页面影响 |
| --- | --- | --- | --- | --- | --- | --- |
| I01 | 客户端合法受控回滚及其失败后的安全替代选择缺少外部闭环证据 | 明确受控回滚优先于普通月份/内置基线比较；目标必须由当前撤销登记精确绑定并完整验证，失败时不得恢复坏包，但应保留另一份自身验证通过且未命中已知撤销的本地数据，只有不存在时才进入 `unavailable` | 补充S10、D10-D14 | `partial` | `passed_limited`（本地安全替代、受控回滚、持久化故障和重启测试） | 正常页面不变；仍需真实云端及双真机闭环，只有确无安全数据时显示独立不可用态 |
| I02 | 生产控制指针缺少供发布、回滚、守卫、云函数和客户端共同执行的统一完整校验器 | 定义单一版本化控制指针验证契约，完整校验字段、代次、转换类型、文件身份、撤销闭环和回滚关系；任一消费者不得维护弱化分支 | 补充D01、D11 | `implemented` | `passed_limited`（本地共享验证器与消费者故障测试） | 否 |
| I03 | 历史修订幂等恢复和legacy迁移遗漏数据包与源版本的双重撤销绑定；既有legacy拒绝测试不能证明唯一旧生产指针可安全正向迁移 | `old_active/candidate_active/conflict` 判定必须同时验证两类撤销及精确替代目标；一般legacy记录缺任一侧时隔离且不得推断补齐。唯一获准旧指针只能按固定迁移ID、原始字节、双重撤销、两次70城验证、一次性授权和严格回执闭环迁移 | 补充D02、D04、D07、D15-D16及S10 | `implemented` | `passed_limited`（本地三态、双重撤销、一般legacy拒绝、唯一迁移正反向、严格动态回执和客户端历史回放；生产迁移未执行） | 否 |
| I04 | S00-S09只有汇总结论，没有仓库内逐项定义和证据 | 使用本文件的 `definition_missing/cannot_reverify` 登记；找到原始证据前不补造、不关闭 | 独立历史追溯缺口 | `implemented`（仅登记缺失事实） | `passed_limited`（仅文档可复核） | 否 |
| I05 | 产品、设计和验收条款缺少统一平台适用标记，Web专属要求可能被误套到小程序 | 统一使用 `[共同]`、`[Web]`、`[小程序]`、`[候选]`；当前未实现能力不得作为当前平台验收项 | 补充C03、C05 | `implemented`（文档分类） | `passed_limited`（未改页面） | 否 |
| I06 | 上线准备清单把局部实现或旧证据勾选为当前候选已测试 | 定义 `[x]/[-]/[ ]/[N/A]` 证据语义，把无精确候选闭环的项目降为局部证据或待验证 | 补充R01-R02及D01-D16 | `implemented`（文档状态修正） | `passed_limited` | 否 |
| I07 | 产品规范混写当前能力、有限实现和候选路线图 | 以状态表区分 `current`、`partial`、`approved_not_implemented`、`candidate`、`out_of_scope`，并写明平台和验收入口；已有基础但未闭环的远程数据能力不得整体写成当前已完成能力 | 独立范围治理 | `implemented`（文档分类） | `passed_limited`（只证明分类已修正） | 否 |
| I08 | “无人值守”、有人监督、SLA层级、生产开关和带日期云端记录表达不统一 | 当前统一为 `automation_disabled`；仓库总开关使用 `AUTOMATIC_RELEASE_ENABLED`，生产Environment授权使用 `PRODUCTION_RELEASE_AUTHORIZED`，启用条件只引用统一硬门槛；满足正确性硬门槛但D19未关闭时才可称 `supervised_automation`，D19关闭后才可称 `unattended_automation`。10-25分钟为正常预期、30分钟为内部SLO、45分钟为预警、60分钟为正式SLA目标；带日期云端记录只证明当时状态。计划发现现为每日09:15至17:55每20分钟，但GitHub定时可能延迟或丢失，尚未完成该配置的线上窗口观察，必须如实登记 | 补充C02保留决定、D17、D19、V02、V04、V10、V16 | `implemented`（术语与门槛文档） | `passed_limited`（本地时段一致性测试通过；SLA调度的线上覆盖仍未验证，生产开关保持关闭） | 否 |
| I09 | 每次检查后的状态部署与只读发现边界缺少责任流程 | 只读发现只能产出报告；用户可见 `data_status` 变更必须经独立受保护状态部署作业，递增控制代次、保持数据身份和撤销身份并回读验证；脚本只能在基线一致时写入，实际写入仍须两个生产开关均为`true` | 补充D01、D19 | `implemented` | `passed_limited`（5项状态部署定向测试及45项工作流安全测试；未在受保护Environment运行） | 未来只影响数据状态提示 |
| I10 | 候选身份要求稳定归档清单，而稳定归档又要求全部候选证据，形成循环依赖 | 先生成不可变候选构件并固定ZIP/清单哈希，外部验收全部绑定该构件；通过后把原字节晋级到稳定归档，不重新打包。候选和原字节晋级工具均已实现，本地测试覆盖身份与原子完成 | 补充R03-R04及V05；不采用R05方案 | `implemented` | `passed_limited`（本地候选/晋级工具和定向测试） | 否 |
| I11 | 小程序来源页和授权说明没有完整披露模糊位置处理、本地匹配城市缓存及保留边界 | 来源页和`app.json`披露模糊位置、项目云函数、腾讯位置服务、不持久化经纬度和本机`cityId/locatedAt`最长24小时；两条读取路径删除过期/无效缓存，来源页清除全部相关本地记录；平台隐私指引和双真机仍须核对 | 补充C03及V01 | `partial` | `passed_limited`（本地源码与定向测试） | 最小披露文案和错误态已变化，不改变正常定位功能或页面布局 |
| I12 | 生产信任链曾使用可移动Action标签；当前本地工作流已固定完整SHA，普通GitHub CI `30736720927` 已通过，但受保护Environment执行尚未复核 | 所有可接触生产Secrets或承接其Artifact的外部Action固定40位commit SHA；更新走审查和依赖更新流程，标签仅可写在注释中 | 补充D19、V17及权限安全 | `implemented` | `passed_limited`（本地机器扫描、失败fixture和普通CI） | 否 |
| I13 | 平台显示文案矩阵遗漏Web页面/OG标题、系统分享标题、两端栏目、导航和区块名称 | 按当前源码分别登记Web页面/OG标题、系统Share API标题及两端其他显示文案，允许平台和使用位置存在当前差异，不要求统一文案 | 补充品牌与术语治理及V08 | `implemented`（文档矩阵） | `passed_limited`（只读核对） | 否 |
| I14 | 小程序版本号在多个入口文档硬编码，现有漂移门禁已覆盖当前快照与候选/归档身份 | `apps/miniprogram/config/version.js` 是唯一机器版本源；CI校验当前入口、候选证据文件名和身份字段一致，历史文档不自动替换 | 补充R01 | `implemented` | `passed_limited`（本地正反向测试与CI入口） | 否 |

I02在当前本地候选已有共享验证器和有限故障测试，登记为 `implemented/passed_limited`；I03已有历史修订三态、双重撤销、一般legacy拒绝、唯一正向迁移、写前验证器身份预检、写后严格动态回执和客户端历史回放的本地实现与定向测试，因此登记为 `implemented/passed_limited`；其 `implemented` 只表示本地实现范围，不表示生产已迁移。I01的内置基线信任回退已经最小修复，当前为 `partial/passed_limited`。三项仍缺云函数部署、受保护生产迁移/真实云端回滚、开发者工具或双真机证据，不能据此宣称已部署、已迁移或关闭生产阻断。I09已有独立受保护状态部署作业和本地故障测试，保持 `implemented/passed_limited`；仍缺受保护Environment实际运行、最小权限回读和真实云端失败演练，不能写入或宣称用户可见状态已部署。I10已补齐原字节晋级、最终发布清单和本地身份冲突测试，保持`implemented/passed_limited`；真实候选的跨环境与外部平台证据仍未完成。I14的当前入口、候选文件名和身份字段门禁已加入普通CI，历史文件继续只读保留。

### I01-I14 关闭证据

| ID | 本轮文档落点 | 仍需关闭证据 |
| --- | --- | --- |
| I01 | `apps/miniprogram/utils/data-runtime.js`、`data-integrity.js`、`scripts/miniprogram/data-runtime.test.mjs`、`PRODUCT.md`、`ACCEPTANCE.md`、`MINIPROGRAM_DATA_UPDATE.md` | 内置独立基线、远程损坏保留当前数据、撤销替代失败、控制过期、持久化故障和重启场景已通过本地回归；仍需真实云端崩溃恢复和双真机演练 |
| I02 | `MINIPROGRAM_DATA_UPDATE.md` | 已有单一验证器、消费者接入和本地故障矩阵；仍需真实云函数/发布/回滚同一fixture和受保护环境证据 |
| I03 | `DATA_CONTRACT.md`、`MINIPROGRAM_DATA_UPDATE.md` | 本地已有双重撤销三态、一般legacy拒绝、唯一迁移原字节/70城/撤销/代次闭环、固定验证器契约、写入后部署新版云函数再执行`describe_validator`和十分钟严格回执，以及客户端首次安装、旧缓存、离线防复活、下一月普通发布和篡改阻断回放证据；仍需精确候选CI、云函数部署、受保护生产运行、迁移前后生产原字节与两次70城验证、写后新鲜回执、一次性授权撤销、真实云端各中断点恢复、统一监测、开发者工具和双真机证据 |
| I04 | `IMPLEMENTATION_STATUS.md` | 原始S00-S09定义和来源；没有来源时保持 `cannot_reverify` |
| I05 | `PRODUCT.md`、`DESIGN.md`、`ACCEPTANCE.md` | 文档复核即可；不得用本项要求页面变更 |
| I06 | `MINIPROGRAM_LAUNCH_PREP.md` | 当前精确候选的CI、开发者工具、双真机、回放及平台证据 |
| I07 | `PRODUCT.md` | 文档复核即可；候选能力仍按各自实现编号关闭 |
| I08 | `DATA_CONTRACT.md`、`MINIPROGRAM_DATA_UPDATE.md`、`AUTOMATION_ACTIVATION_CHECKLIST.md` | D19通知闭环、从任意正式页面可访问时点起60分钟内完成发现至可用切换的调度/流水线/监控覆盖及云端故障验证、当前云端现场核验 |
| I09 | `MINIPROGRAM_DATA_UPDATE.md`、`.github/workflows/monthly-data-status-deploy.yml`、`scripts/miniprogram/deploy-data-status.mjs` | 已有工作流与基线冲突/写失败/回读本地测试；仍需受保护Environment实际运行、最小权限现场回读和真实云端失败演练 |
| I10 | `MINIPROGRAM_VERSIONING.md`、`promote-stable-candidate.mjs` | 原字节晋级和`release-manifest.json`生成/校验已由本地测试覆盖；仍需跨环境重复构建及真实外部候选证据 |
| I11 | `MINIPROGRAM_LOCATION_SETUP.md`、`MINIPROGRAM_LAUNCH_PREP.md`、`ACCEPTANCE.md` | 来源页、`app.json`、过期/无效缓存删除及本地测试已完成；仍需微信平台隐私指引现场回读和Android/iPhone真机核对 |
| I12 | `MINIPROGRAM_DATA_UPDATE.md`、`AUTOMATION_ACTIVATION_CHECKLIST.md` | 已有本地完整SHA扫描、可移动标签失败fixture和普通CI `30736720927`；仍需受保护Environment真实执行及一次受审依赖升级证据 |
| I13 | `PRODUCT.md` | 当前源码只读核对；未来文案变更须同步矩阵 |
| I14 | `version-identity-gate.mjs`、`DOCUMENT_INDEX.md`、`MINIPROGRAM_VERSIONING.md` | 本地正反向测试和CI入口已完成；仍需在下一次真实升版候选中现场证明 |

## V01-V12 规范治理复核登记

本组来自2026-07-30只读复核并经用户全部批准。最初只修正规范、状态登记和验收模板；2026-07-31用户进一步批准实施V01和V07，因此两项已更新为本地候选状态。表中的本地有限通过不代表微信平台、云端、真机或生产能力已经完成。

| ID | 规范治理范围 | 本轮处理 | 实现状态 | 验证状态 | 页面或代码边界 |
| --- | --- | --- | --- | --- | --- |
| V01 | 定位披露和缓存边界 | 来源页和`app.json`已披露模糊位置处理链与本机缓存最长24小时；启动和点击定位均删除过期/无效记录，来源页清除全部相关本地状态 | `partial` | `passed_limited`（本地源码与定向测试） | 未修改微信平台配置；双真机未验证 |
| V02 | 自动发布最终门槛 | 把正式发布、线上版本回读、正式版完整70城远程读取、交接证据和维护人最终授权列为开关前置 | `implemented`（文档门槛） | `passed_limited`（只读文档核对） | 不开启开关，不执行发布 |
| V03 | 产品状态分类 | 增加`partial`并拆分当前能力、有限实现、已批准未实现、候选和不做范围 | `implemented`（文档分类） | `passed_limited`（只读文档核对） | 不改变当前产品或页面 |
| V04 | 生产开关名称和门槛来源 | 仓库总开关统一为`AUTOMATIC_RELEASE_ENABLED`，生产Environment授权统一为`PRODUCTION_RELEASE_AUTHORIZED`；`AUTOMATION_ACTIVATION_CHECKLIST.md`仍是完整启用硬门槛唯一来源，其他文档只引用或登记状态；保留C02既定SLA起点 | `implemented`（文档与代码名称一致） | `passed_limited`（2026-07-31现场回读仓库`false`、Environment未设置，均失败关闭） | 未开启生产授权或执行生产操作 |
| V05 | I10状态真实性 | 保持两阶段候选/归档边界；候选生成基础工具已实现，但原字节晋级、最终发布清单和跨环境证据仍由R03-R04关闭且不恢复R05 | `implemented`（状态修正与工具状态登记） | `passed_limited`（文档和本地测试核对） | 已生成仅本地候选，尚未稳定归档 |
| V06 | v2.4.0真机模板 | 删除不存在的精确数据入口要求，仅验收当前数值、统计和图表同步 | `implemented`（模板修正） | `passed_limited`（只读文档核对） | 未显示或新增精确数据入口；当前真机结果仍未填写 |
| V07 | 图表错误状态文案 | `apps/miniprogram/pages/index/index.wxml`已删除指向隐藏“查看精确数据”入口的错误提示，改为稍后重试及恢复后在图表滑动查看 | `implemented` | `passed_limited`（本地模板断言） | 只影响图表错误状态文案，正常页面不变 |
| V08 | 平台显示文案矩阵 | 分开登记Web页面/OG标题与系统Share API标题，并保留当前平台差异 | `implemented`（文档矩阵） | `passed_limited`（只读源码核对） | 不统一或修改现有文案 |
| V09 | v2.4.0验收模板入口 | 改为引用并填写现有三份模板，不再要求重复新建 | `implemented`（入口修正） | `passed_limited`（只读文档核对） | 三份模板继续保持未完成，不构成验收证据 |
| V10 | 自动化术语 | 用“云端CI/自动CI复核”替代易与`unattended_automation`混淆的表达 | `implemented`（术语修正） | `passed_limited`（只读文档核对） | 不改变运行模式；当前仍为`automation_disabled` |
| V11 | `passed_limited`证据模型 | 定义有限通过的证据范围、不可关闭阻断的效力及证据登记字段；区分规范决策和实现/验证状态迁移 | `implemented`（状态规则与登记模型） | `passed_limited`（文档规则核对） | 不改变页面、代码或生产状态 |
| V12 | 历史设计执行记录边界 | 在`DESIGN.md`明确2026-07-16/18记录为带日期历史证据，不作为当前设计验收或实现通过证明 | `implemented`（证据边界标注） | `passed_limited`（文档边界核对） | 不改变页面、代码或设计规则 |

## V13-V18 安全与数据实现登记

本组来自2026-07-30全项目规范审计并经用户批准实施。`implemented/passed_limited`只表示当前本地代码和明确列出的测试范围完成，不代表GitHub真实运行、生产Environment、历史Artifact、云端、微信平台或正式发布已通过；生产授权继续关闭。

| ID | 已批准范围 | 当前实现 | 实现状态 | 验证状态 | 仍需关闭证据 |
| --- | --- | --- | --- | --- | --- |
| V13 | 独立审计补齐总体/面积分类的新房二手房来源关联 | `full-record-audit-v5`逐条校验白名单、property type、size band、定位和原始单元格；126批、70,560条本地全量审计通过 | `implemented` | `passed_limited`（本地全量审计与13项定向测试） | 当前精确候选普通CI、候选门禁与生产链重新验证 |
| V14 | 待发布恢复在取得Secrets前校验不可信pending状态和官方URL | 无Secrets inspect/recover作业先校验字段、URL白名单、危险字符、官方来源和候选门禁；受保护publish作业只消费结构化输出 | `implemented` | `passed_limited`（本地安全测试） | 一次真实GitHub待发布恢复的成功与恶意输入拒绝证据 |
| V15 | 完整私有审计不得进入公开GitHub Artifact | 完整包只写私有云目录；GitHub只保留非敏感证据和`private-audit-reference.json`哈希引用 | `partial` | `passed_limited`（当前工作流本地扫描） | 检查所有仍可访问历史Artifact并处置曾暴露的完整私有包 |
| V16 | 仓库自动化开关与生产Environment授权分离 | 代码分别要求`AUTOMATIC_RELEASE_ENABLED`和`PRODUCTION_RELEASE_AUTHORIZED`精确为`true`，任一缺失/为假都失败关闭；2026-07-31现场回读分别为仓库`false`和Environment未设置 | `partial` | `passed_limited`（本地组合测试及当前失败关闭现场值） | 仍需真实受保护Environment执行、一真一假组合和未来启用时独立授权证据 |
| V17 | Secret手动入口拒绝非默认ref并闭合默认分支HEAD | 授权器及手动工作流核对`GITHUB_REF`、`GITHUB_WORKFLOW_REF`、检出SHA和远端默认分支HEAD；全部外部Action固定完整SHA | `implemented` | `passed_limited`（本地授权与工作流安全测试） | 真实GitHub默认分支成功、非默认ref拒绝和Environment分支策略现场证据 |
| V18 | 待发布恢复只接受同一提交的普通CI成功证明 | 恢复作业查找同一精确提交的`ci.yml` push成功运行，并把run ID、提交、数据版本和门禁哈希写入授权 | `implemented` | `passed_limited`（本地正反向测试） | 一次真实same-commit恢复及错提交/PR/旧运行拒绝证据 |

## V19 产品状态分类一致性修复

本项来自2026-07-30全项目规范只读审计并经用户批准修复。`PRODUCT.md`只维护状态类别及解释，逐编号实现、验证和证据状态继续以本文件为唯一登记；本项不改变I12的实现或验证状态，也不把普通CI证据描述为云端已部署、生产已迁移或正式版已发布。

| ID | 已批准范围 | 当前实现 | 实现状态 | 验证状态 | 页面或生产边界 |
| --- | --- | --- | --- | --- | --- |
| V19 | 消除`PRODUCT.md`把I12同时列为“无实现证据”与本文件`implemented/passed_limited`的状态冲突 | `PRODUCT.md`的`partial`与`approved_not_implemented`改为按本文件状态字段动态分类，不再重复维护I12状态；I12仍保留本地有限通过和远端未验证边界 | `implemented`（文档分类） | `passed_limited`（文档交叉核对） | 不修改Web、小程序、工作流、数据、云端、微信平台或生产状态 |

## MP15 近15年完整包目标登记（2026-08-04）

本节记录用户已批准的 `v2.5.0` 目标，不能作为当前 `v2.4.11`、云端数据、开发者工具、真机或微信发布已经具备近15年能力的证据。本轮只更新规范，没有修改小程序源码、数据、云端文件、开发者工具副本、版本号或生产配置。

| ID | 已批准目标 | spec_status | implementation_status | verification_status | 当前阻断与关闭证据 |
| --- | --- | --- | --- | --- | --- |
| MP15-01 | 将小程序完整历史扩展为2011年7月至2026年6月，共180个月、100,800条记录；历史来源逐表核对统计月份，任何来源或数据异常整包失败关闭 | `approved` | `not_started` | `not_tested` | 尚未补齐54个月/30,240条历史数据、解析与独立全量审计；需保留完整来源和逐值审计证据 |
| MP15-02 | 使用一个完整15年远程业务数据文件替换一个完整10年快照，不按城市、月份、指标或数据类型拆分，禁止10年加5年拼接 | `approved` | `not_started` | `not_tested` | 尚未设计/实现新协议、生成器、迁移、哈希与缓存兼容；现有 `bootstrap.json` 加 `cities/` 仅是当前/旧协议，不可作为关闭证据 |
| MP15-03 | 首屏后自动检查并在Wi-Fi及移动网络后台下载；成功后本次会话直接可用，不重开、不自动切换范围、不丢失城市/筛选/滚动位置 | `approved` | `not_started` | `not_tested` | 尚未实现后台下载、会话通知、状态保持和自动重试；需Android/iPhone及网络矩阵实测 |
| MP15-04 | 下载或验证失败时始终保留可信完整快照，删除半包/孤儿缓存，禁止缓存复活和错误更新 | `approved` | `not_started` | `not_tested` | 当前安全缓存证据不能自动覆盖新15年文件协议；需新协议的中断、存储不足、回读、崩溃恢复和离线回退测试 |
| MP15-05 | 主包先实测压至不高于1.45MB；保留单个紧凑10年内置快照，首页图表依赖不迁分包；15年远程文件与下载耗时采用实测值 | `approved` | `not_started` | `not_tested` | 尚未实施紧凑编码或取得开发者工具主包报告；3.8MB与各网络耗时目前都是估算，不可作为验收通过证据 |

### MP15 本地候选状态迁移（2026-08-04）

以下是对上表“批准时尚未实施”事实的追加，不覆盖原记录。当前候选为 `v2.5.0`，完整远程候选为 `2026-06-d9f3eef905fe`；它仅在本地暂存，未上传、未部署、未审核、未发布。

| ID | 实现状态 | 本地验证 | 仍待完成 |
| --- | --- | --- | --- |
| MP15-01 | `implemented` | 180个官方来源批次、100,800条记录，2011-07至2026-06全量审计通过；`validate:data`通过 | 云端候选上传后的独立回读和平台验证 |
| MP15-02 | `implemented` | schema `2.0.0` 只生成一个业务文件`complete-snapshot.json`；重建、大小和SHA-256复核通过 | 云端对象上传和旧客户端实测 |
| MP15-03 | `implemented` | 首屏后后台检查、当前会话出现近15年且不重置状态的自动化测试通过 | Android、iPhone、Wi-Fi/移动网络/弱网实测 |
| MP15-04 | `implemented` | 下载中断、哈希不符、半包、存储失败、孤儿清理、离线回退和缓存不复活自动化测试通过 | Android、iPhone文件系统实测 |
| MP15-05 | `partial` | 内置10年快照可逆压缩与重建通过；源码目录测得约1.402MiB，完整远程业务文件为1,998,341字节 | 微信开发者工具主包实际报告不高于1.45MB，以及真机实际下载耗时 |

## 决策记录

本表只追加。聊天确认以日期和范围摘要登记；后续若有可持久化任务或提交链接，再补充到同一行，不改写原结论。

| decision_ref | 日期 | 编号 | 决策 | supersedes | 范围 |
| --- | --- | --- | --- | --- | --- |
| `2026-07-29-D01-D20-user-approved` | 2026-07-29 | D01-D20 | `approved` | - | 仅修改规范和文档治理；以当前 `apps/web/` 和 `apps/miniprogram/` 为事实基线，不修改页面或代码 |
| `2026-07-29-C01-user-approved` | 2026-07-29 | C01 | `approved` | - | 对齐公开源码复现档案事实，不删除、迁移或发布任何文件 |
| `2026-07-29-C02-user-not-approved` | 2026-07-29 | C02 | `not_approved` | - | SLA起点保持现有规范，不实施备选方案 |
| `2026-07-29-C03-user-approved` | 2026-07-29 | C03 | `approved` | - | 按当前模糊定位实现治理文档，不改小程序或平台配置 |
| `2026-07-29-C04-user-not-approved` | 2026-07-29 | C04 | `not_approved` | - | 稳定归档和回退条款保持现状，不实施备选方案 |
| `2026-07-29-C05-user-approved` | 2026-07-29 | C05 | `approved` | - | 明确当前排名口径并登记六城差异，不改Web或小程序页面与逻辑 |
| `2026-07-29-R01-user-approved` | 2026-07-29 | R01 | `approved` | - | 为当前 `v2.4.0` 建立独立审查、交接和双真机证据；本轮只治理文档 |
| `2026-07-29-R02-user-approved` | 2026-07-29 | R02 | `superseded` | - | 原决策要求普通月度12轮和历史修订专项回放；仅保留为历史决策记录 |
| `2026-08-25-R02-six-month-isolation-user-approved` | 2026-08-25 | R02 | `approved` | `2026-07-29-R02-user-approved` | 普通月度隔离验证永久改为单组连续6个月；历史修订专项仍12轮；同步当前规范、GitHub入口和安全测试，不改变生产开关状态 |
| `2026-08-26-monthly-data-automation-plan-user-approved` | 2026-08-26 | 月度自动更新流程 | `approved` | - | 后续月度自动更新必须遵循 `MONTHLY_DATA_AUTOMATION_PLAN.md`；先实现并隔离验收严格20分钟发现，再单独评估只读保障和自动发布，两个生产开关继续保持关闭 |
| `2026-07-29-R03-user-approved` | 2026-07-29 | R03 | `approved` | - | 定义确定性可复现ZIP目标；本轮不实现归档脚本 |
| `2026-07-29-R04-user-approved` | 2026-07-29 | R04 | `approved` | - | 定义机器可读发布清单；不追填或改写既有归档 |
| `2026-07-29-R05-user-not-approved` | 2026-07-29 | R05 | `not_approved` | - | 不采用受保护Git Tag或GitHub Release；保持现行归档防篡改规则 |
| `2026-07-29-R06-user-approved` | 2026-07-29 | R06 | `approved` | - | 定义Web声明schema 2目标；本轮不改Web、门禁脚本或声明JSON |
| `2026-07-29-R07-user-approved` | 2026-07-29 | R07 | `approved` | - | 自动更新时间集中为单一文档来源；本轮不改工作流或CI测试代码 |
| `2026-07-29-S10-user-approved` | 2026-07-29 | S10 | `approved` | - | 单独修复坏新月份包撤销与受控回滚闭环；仅修改小程序数据运行时、控制面、发布/回滚工具、测试和对应规范，不改普通页面，不执行生产写入 |
| `2026-07-29-S00-S09-user-approved-prior` | 2026-07-29 | S00-S09 | `approved` | - | 只确认前次治理结论已获同意；原始逐项定义在仓库中缺失，登记为 `cannot_reverify`，不补造实现结论 |
| `2026-07-29-I01-I14-user-approved` | 2026-07-29 | I01-I14 | `approved` | - | 只修改规范和文档治理；需要代码、工作流、云端、平台或页面才能关闭的项目继续保持未完成；当前Web和小程序页面不变 |
| `2026-07-30-V01-V10-user-approved` | 2026-07-30 | V01-V10 | `approved` | - | 只修改规范、状态登记和验收模板；V01、V07及其他需要代码、平台、真机或生产操作的部分继续保持未完成，当前Web和小程序页面不变 |
| `2026-07-30-V11-V12-user-approved` | 2026-07-30 | V11-V12 | `approved` | - | 明确`passed_limited`证据模型、状态迁移记录和历史设计执行记录边界；只修改文档，不改变页面、代码、工作流、数据或生产状态 |
| `2026-07-30-V13-V18-D08-user-approved` | 2026-07-30 | V13-V18、D08 | `approved` | - | 实施审计v5、客户端双覆盖起点、待发布恢复与工作流安全、私有审计边界及双层授权；保持当前Web/小程序页面与生产状态，自动发布继续关闭 |
| `2026-07-30-V19-user-approved` | 2026-07-30 | V19 | `approved` | - | 修复产品状态分类与I12实施登记冲突；只修改`PRODUCT.md`和本文件，不改变I12关闭条件、页面、代码、工作流、数据或生产状态 |
| `2026-08-04-MP15-user-approved` | 2026-08-04 | MP15-01至MP15-05 | `approved` | - | 定义小程序`v2.5.0`近15年完整快照目标：180个月、严格官方数据阻断、单一完整远程业务文件、首屏后自动后台下载、不中断当前会话、失败保留可信快照、主包1.45MB门槛和全设备网络验收；本轮只修改规范，不改代码、数据、云端、开发者工具目录、版本号、生产配置或发布状态 |
| `2026-07-31-v2.4.1-local-implementation-user-approved` | 2026-07-31 | D08-D14、I01-I03、I11、V01、V07及S10关联路径 | `approved` | - | 用户批准按现行规范实施小程序数据真实性失败关闭、控制面、缓存/回滚、定位披露和错误态，版本升为`v2.4.1`并执行本地测试与审计；该批准不表示实现完成，候选随后发现默认启动回退，且未修改Web页面、未执行云端部署、生产写入、微信上传/审核/发布或稳定归档 |
| `2026-07-31-legacy-migration-receipt-lifecycle-user-approved` | 2026-07-31 | I03、D13及S10关联协议 | `approved` | - | 用户确认继续实施唯一legacy控制迁移、本次动态验证回执及`onShow`同步非阻塞修复；仅允许本地代码、专用受保护工作流、fixture、测试和对应规范，正常页面保持不变。本批准不授权部署云函数、执行生产迁移或其他生产写入，三个生产授权保持关闭或未设置 |
| `2026-08-01-production-write-boundary-user-approved` | 2026-08-01 | D11、I12、V16-V18及相关发布/回滚入口 | `approved` | - | 用户确认收口生产写入边界；历史修订、固定修正、月度发布、待发布恢复和人工回滚统一经过双开关与同提交CI授权，本地脚本仅允许dry-run，新增人工回滚工作流和递归Action固定扫描。本批准不授权云端写入、生产回滚、微信平台操作或正式发布 |

## 证据登记

以下字段按编号独立维护；`-` 表示本轮只有文档目标，没有可关闭该问题的实现证据。

| ID | 规范状态 | 证据链接/身份 | 复核人 | 最后通过日期 | 下一复核条件 |
| --- | --- | --- | --- | --- | --- |
| D01 | `approved` | - | - | - | 指针前门禁实现及原字节不变故障测试 |
| D02 | `approved` | - | - | - | 三态重跑实现和全部中断点恢复测试 |
| D03 | `approved` | - | - | - | 候选记录/来源索引/提交SHA绑定测试 |
| D04 | `approved` | - | - | - | 修订账本前缀、追加集合和链测试 |
| D05 | `approved` | - | - | - | 申请、发布端和客户端字段迁移测试 |
| D06 | `approved` | - | - | - | 规范化哈希黄金样本和字段变异测试 |
| D07 | `approved` | - | - | - | 最新月/修订批次集合完整性测试 |
| D08 | `approved` | `data-integrity.js`及完整快照正反向测试覆盖版本月份、发布日期、国家统计局URL、来源覆盖起点、城市资料、数值和派生结果；2026-07-31本地小程序203项与`check`通过 | Codex本地复核 | 2026-07-31 | 仍需精确候选CI、真实云端完整包及双真机逐值验证 |
| D09 | `approved` | 临时目录、逐文件回读、改名后损坏和状态提交失败测试；2026-07-31本地小程序203项通过 | Codex本地复核 | 2026-07-31 | 真机文件系统逐文件回读和进程崩溃恢复证据 |
| D10 | `approved` | 保留用户默认启动失败截图；修复后首次安装/清储/离线/过期控制、远程损坏、已知撤销无替代和页面启动回归测试通过，本地小程序203项与`check`通过 | Codex本地复核 | 2026-07-31 | 微信开发者工具默认启动、真实云函数及Android/iPhone验收 |
| D11 | `approved` | 完整目标包、早于内置月份回滚、撤销绑定、不可变Intent、`old_active/target_active/conflict`、切换后只读审计重建、损坏目标和指针基线测试；受保护人工回滚工作流、双开关授权、精确attempt和独立无云密钥审计测试；2026-08-02定向组合65项及小程序285项通过 | Codex本地复核 | 2026-08-02 | 对象级CAS、真实GitHub跨运行Artifact恢复、受保护Environment及真实云端回滚/失败恢复证据 |
| D12 | `approved` | 单一本地schema v2、主状态/墓碑独立写失败、合法代次合并、安全回退和重启测试；2026-07-31本地小程序203项通过 | Codex本地复核 | 2026-07-31 | Android/iPhone存储失败、强退和重启事务边界证据 |
| D13 | `approved` | 保留默认启动失败截图；修复后首次安装/清储/离线/过期控制不禁用内置基线且已知撤销单调生效的正反向测试通过，本地小程序203项与`check`通过；2026-08-01动态回执、过期撤销及`onShow`内部收敛定向测试通过 | Codex本地复核 | 2026-08-01 | 真实云函数部署、前后台切换和Android/iPhone证据 |
| D14 | `approved` | 临时/孤儿清理、目录删除失败显式返回及活动包加一个安全回退保留测试；2026-07-31本地小程序203项通过 | Codex本地复核 | 2026-07-31 | 双真机文件系统和真实进程中断证据 |
| D15 | `approved` | 本地统一监测选择器覆盖普通发布、修订和回滚；人工回滚审计v4区分原始attempt与最终收尾attempt，只有审计绑定的收尾attempt可立即触发监测；2026-08-02定向组合65项通过 | Codex本地复核 | 2026-08-02 | 已有耐久审计由新run恢复提交后的即时监测仍依赖小时调度；另缺真实GitHub触发、私有审计索引和通知恢复证据 |
| D16 | `approved` | - | - | - | 多批次私有审计精确集合测试 |
| D17 | `approved` | - | - | - | 下一年度官方日历配置和跨年SLA测试 |
| D18 | `approved` | `historical-page-audit.ts`及4项定向测试：只读重抓、哈希相同、哈希变化隔离和请求失败不写数据 | Codex本地复核 | 2026-08-30 | GitHub季度工作流实际运行、真实变化后的人工隔离处置和证据保留 |
| D19 | `approved` | `incident-lifecycle.mjs`及4项定向测试：去重、负责人确认、一次超时升级、带哈希恢复关闭和输入拒绝 | Codex本地复核 | 2026-08-30 | 配置 `HOUSING_DATA_INCIDENT_OWNER`、GitHub线上打开/确认/超时/恢复演练与接收人复核 |
| D20 | `approved` | - | - | - | 固定输入/期望哈希及完整筛选边界矩阵的跨平台逐值一致测试 |
| S10 | `approved` | 保留默认启动失败证据；修复后的本地客户端/控制面故障矩阵、精确legacy迁移、动态回执、人工回滚Intent/恢复/attempt监测身份均有本地正反向测试；2026-08-02定向组合65项及小程序285项通过 | Codex本地复核 | 2026-08-02 | 精确候选CI、云函数部署、受保护生产迁移/真实云端回滚、撤销链、对象级CAS、开发者工具和双真机演练 |
| V04 | `approved` | `AUTOMATION_ACTIVATION_CHECKLIST.md`唯一完整自动发布硬门槛；2026-07-31 GitHub CLI回读仓库`AUTOMATIC_RELEASE_ENABLED=false`、`housing-data-production`未设置`PRODUCTION_RELEASE_AUTHORIZED` | Codex本地复核 | 2026-07-31 | 真实启用前仍需全部门槛证据、双变量重新现场回读和维护人授权 |
| V11 | `approved` | 本文件状态规则、V11登记和关闭流程 | Codex文档复核 | 2026-07-30 | 后续状态变更必须追加迁移记录并绑定有限范围证据 |
| V12 | `approved` | `DESIGN.md`历史证据边界说明 | Codex文档复核 | 2026-07-30 | 设计验收必须使用当前候选和适用平台证据，不得引用历史记录替代 |
| V13 | `approved` | `data/audit-report.json`：`full-record-audit-v5`、126批、70,560条、result=passed；13项定向测试 | Codex本地复核 | 2026-07-30 | 绑定当前精确候选的普通CI和发布门禁 |
| V14 | `approved` | `inspect-pending-release.mjs`、`official-source-url.mjs`及工作流安全测试 | Codex本地复核 | 2026-07-30 | 真实GitHub待发布恢复运行 |
| V15 | `approved` | 当前工作流不上传`work/private-audit/`，只发布`private-audit-reference.json` | Codex本地复核 | 2026-07-30 | 历史可访问Artifact排查与处置 |
| V16 | `approved` | 双变量失败关闭测试；2026-07-31 GitHub CLI回读仓库变量为`false`、`housing-data-production`的生产授权变量未设置 | Codex本地复核 | 2026-07-31 | 真实受保护Environment执行、一真一假组合及未来启用时独立授权 |
| V17 | `approved` | 默认分支/ref授权正反向测试；递归扫描全部11个工作流文件的外部Action并要求完整SHA | Codex本地复核 | 2026-08-01 | 真实GitHub手动入口与Environment策略验证 |
| V18 | `approved` | same-commit普通CI授权正反向测试覆盖月度发布、历史修订、固定修正和人工回滚 | Codex本地复核 | 2026-08-01 | 真实same-commit恢复/修订/回滚运行 |
| V19 | `approved` | `PRODUCT.md`状态表与本文件I12实现、验证及证据状态交叉核对 | Codex文档复核 | 2026-07-30 | I12后续状态变化时只更新本文件，并确认`PRODUCT.md`类别定义无需逐编号同步 |
| I12 | `approved` | 当前全部11个工作流外部Action递归完整SHA扫描、可移动标签失败fixture；2026-08-02迁移/回滚/监测/工作流安全定向组合65项及小程序285项通过 | Codex本地复核 | 2026-08-02 | 普通CI、受保护Environment真实执行及依赖升级复核 |
| I01 | `approved` | 保留默认启动失败证据；替代包损坏、独立内置基线、已知撤销、远程安全回退、持久化故障和重启测试通过，本地小程序203项与`check`通过 | Codex本地复核 | 2026-07-31 | 真实云端受控回滚、崩溃恢复及双真机演练 |
| I02 | `approved` | `control-plane.mjs`及发布、回滚、守卫、云函数消费者正反向测试；2026-07-31定向组合88项通过 | Codex本地复核 | 2026-07-31 | 同一fixture在真实云函数、发布/回滚和受保护Environment通过 |
| I03 | `approved` | 历史修订三态、双重撤销、一般legacy失败关闭及幂等重跑测试；2026-08-01唯一legacy迁移/运行时/动态回执定向36项通过，覆盖精确原字节、双重撤销、`describe_validator`预检、十分钟回执、首次安装/旧缓存/离线防复活/下一月普通发布与篡改阻断 | Codex本地复核 | 2026-08-01 | 精确候选CI、云函数部署、受保护生产运行、迁移审计、生产原字节/双重撤销/两次70城回读、写后新鲜云函数回执、授权撤销、统一监测、开发者工具和双真机证据 |
| I11 | `approved` | 来源页、`app.json`、定位缓存两条读取路径及清除测试；2026-07-31`snapshot.test.mjs`25项通过 | Codex本地复核 | 2026-07-31 | 微信公众平台隐私保护指引回读及Android/iPhone真机核对 |
| V01 | `approved` | 模糊位置处理链、24小时本机缓存、无效记录删除和来源页清除测试；2026-07-31`snapshot.test.mjs`25项通过 | Codex本地复核 | 2026-07-31 | 微信平台隐私披露和双真机验证 |
| V07 | `approved` | 图表错误态模板断言；2026-07-31`snapshot.test.mjs`25项通过 | Codex本地复核 | 2026-07-31 | 开发者工具和双真机触发图表失败后的文案与恢复验证 |

## 关闭流程

1. 只修改一个编号的最小实现范围，不捆绑未获批准的页面、文案、结构或功能调整。
2. 为该编号补充正常、失败、重跑、断网/中断及边界测试；涉及云端、真机或外部账号时保存对应证据。
3. 运行受影响测试，并按范围运行 `npm run check` 与 `npm run test:e2e`；无法执行的项目必须保持未通过状态。
4. 在证据登记和状态迁移记录中补充提交 SHA、测试结果、云端运行或真机记录、`verification_scope`、复核人和日期，再将 `implementation_status` 更新为 `implemented`。
5. 独立复核确认权威条款与实际行为一致后，才能把 `verification_status` 更新为 `passed` 并解除相应阻断；`passed_limited`只能保留有限范围，不得解除阻断。

## 状态迁移记录

本表只追加实现/验证状态变化；规范批准或否决仍记录在上方“决策记录”。已有编号在首次登记时可视为初始状态，后续任何变化必须追加一行，不得覆盖历史。

| 日期 | ID | 原实现状态 | 新实现状态 | 原验证状态 | 新验证状态 | `verification_scope` | 证据身份 | 复核人 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-07-30 | V11 | `not_started` | `implemented` | `not_tested` | `passed_limited` | `document_review` | 本文件状态规则、证据登记和关闭流程 | Codex文档复核 |
| 2026-07-30 | V12 | `not_started` | `implemented` | `not_tested` | `passed_limited` | `document_review` | `DESIGN.md`历史证据边界说明 | Codex文档复核 |
| 2026-07-30 | D08 | `partial` | `partial` | `not_tested` | `passed_limited` | `client_window_metadata_and_fail_closed_validation` | 小程序生成/远程/runtime定向64项通过 | Codex本地复核 |
| 2026-07-30 | I12 | `not_started` | `implemented` | `not_tested` | `passed_limited` | `local_workflow_supply_chain_scan` | 外部Action完整SHA扫描及可移动标签失败fixture | Codex本地复核 |
| 2026-07-30 | V13 | `not_started` | `implemented` | `not_tested` | `passed_limited` | `local_full_record_audit_v5` | 126批、70,560条全量审计及13项定向测试 | Codex本地复核 |
| 2026-07-30 | V14 | `not_started` | `implemented` | `not_tested` | `passed_limited` | `local_pending_recovery_trust_boundary` | pending/URL/工作流安全正反向测试 | Codex本地复核 |
| 2026-07-30 | V15 | `not_started` | `partial` | `not_tested` | `passed_limited` | `current_workflow_artifact_scan` | 当前工作流只上传非敏感引用；历史Artifact未核验 | Codex本地复核 |
| 2026-07-30 | V16 | `not_started` | `partial` | `not_tested` | `passed_limited` | `local_dual_authorization_gate` | 双变量组合测试；Environment现场值未核验 | Codex本地复核 |
| 2026-07-30 | V17 | `not_started` | `implemented` | `not_tested` | `passed_limited` | `local_default_ref_and_action_pin_tests` | 默认ref授权与完整SHA扫描 | Codex本地复核 |
| 2026-07-30 | V18 | `not_started` | `implemented` | `not_tested` | `passed_limited` | `local_same_commit_ci_recovery_tests` | same-commit CI授权正反向测试 | Codex本地复核 |
| 2026-07-30 | V19 | `not_started` | `implemented` | `not_tested` | `passed_limited` | `document_status_classification_review` | `PRODUCT.md`状态类别与本文件I12状态交叉核对 | Codex文档复核 |
| 2026-07-31 | D08 | `partial` | `implemented` | `passed_limited` | `passed_limited` | `local_complete_snapshot_integrity` | 70城集合、数值、series/latest/breadth及派生结果正反向测试；小程序174项与`check`通过 | Codex本地复核 |
| 2026-07-31 | D09 | `partial` | `implemented` | `not_tested` | `passed_limited` | `local_atomic_cache_readback` | 写后回读、改名后损坏、状态提交失败和清理测试 | Codex本地复核 |
| 2026-07-31 | D10 | `partial` | `implemented` | `not_tested` | `passed_limited` | `local_unavailable_page_fail_closed` | 无可信数据不计算、不可用页、刷新防重和重试恢复测试；`snapshot.test.mjs`25项通过 | Codex本地复核 |
| 2026-07-31 | D11 | `partial` | `partial` | `not_tested` | `passed_limited` | `local_complete_rollback_guard` | 完整包、撤销绑定、早于内置月份回滚和损坏目标测试 | Codex本地复核 |
| 2026-07-31 | D12 | `partial` | `implemented` | `not_tested` | `passed_limited` | `local_runtime_state_schema_v2` | 单一状态、提交失败和重启恢复测试 | Codex本地复核 |
| 2026-07-31 | D13 | `partial` | `implemented` | `not_tested` | `passed_limited` | `local_control_freshness_and_foreground_check` | 24小时控制有效期、首次启动、独立调度和`onShow`测试 | Codex本地复核 |
| 2026-07-31 | D14 | `partial` | `implemented` | `not_tested` | `passed_limited` | `local_cache_cleanup_and_retention` | 失败/启动清理及活动包加一个安全回退保留测试 | Codex本地复核 |
| 2026-07-31 | I01 | `partial` | `implemented` | `failed` | `passed_limited` | `local_prebundled_month_controlled_rollback` | 早于内置月份受控回滚正反向、失败及重启测试 | Codex本地复核 |
| 2026-07-31 | I02 | `partial` | `implemented` | `failed` | `passed_limited` | `local_shared_control_pointer_validator` | 共享验证器和全部本地消费者故障矩阵 | Codex本地复核 |
| 2026-07-31 | I03 | `partial` | `implemented` | `failed` | `passed_limited` | `local_dual_revocation_recovery` | `old_active/candidate_active/conflict`、双重撤销和legacy拒绝测试 | Codex本地复核 |
| 2026-07-31 | I11 | `not_started` | `partial` | `not_tested` | `passed_limited` | `local_location_disclosure_and_cache` | 来源页/授权说明、24小时缓存删除及清除测试 | Codex本地复核 |
| 2026-07-31 | V01 | `not_started` | `partial` | `not_tested` | `passed_limited` | `local_location_privacy_boundary` | 模糊位置披露、缓存保留与删除测试 | Codex本地复核 |
| 2026-07-31 | V07 | `not_started` | `implemented` | `not_tested` | `passed_limited` | `local_chart_error_copy_assertion` | 图表错误态不再引用隐藏入口；`snapshot.test.mjs`25项通过 | Codex本地复核 |
| 2026-07-31 | D10 | `implemented` | `partial` | `passed_limited` | `failed` | `bundled_baseline_startup_regression` | 用户提供的`v2.4.1`默认启动截图及运行时路径复核：完整内置快照被错误判为不可用，原测试矩阵漏测 | 用户现场反馈与Codex复核 |
| 2026-07-31 | D13 | `implemented` | `partial` | `passed_limited` | `failed` | `control_freshness_trust_regression` | 无可信/过期控制状态被错误作为内置数据无效条件，违反独立内置基线 | 用户现场反馈与Codex复核 |
| 2026-07-31 | S10 | `partial` | `partial` | `passed_limited` | `failed` | `safe_fallback_trust_regression` | 远程控制暂不可得时安全替代选择错误锁死内置快照，客户端撤销/回退闭环重新打开 | 用户现场反馈与Codex复核 |
| 2026-07-31 | I01 | `implemented` | `partial` | `passed_limited` | `failed` | `rollback_safe_alternative_regression` | 替代目标失败/控制暂不可得后的本地安全版本判定缺少独立内置基线场景 | 用户现场反馈与Codex复核 |
| 2026-07-31 | D10 | `partial` | `implemented` | `failed` | `passed_limited` | `local_bundled_baseline_and_unavailable_recovery` | 首次安装/清储/离线/过期控制、远程损坏、已知撤销无替代和页面启动回归；小程序203项与`check`通过 | Codex本地复核 |
| 2026-07-31 | D13 | `partial` | `implemented` | `failed` | `passed_limited` | `local_control_freshness_and_revocation_recovery` | 无可信/过期控制不阻断内置基线，已知撤销在离线及重启后单调生效；小程序203项与`check`通过 | Codex本地复核 |
| 2026-07-31 | S10 | `partial` | `partial` | `failed` | `passed_limited` | `local_safe_fallback_and_revocation_recovery` | 撤销活动远程包切换安全回退、页面更新通知、双持久化故障和重启测试；小程序203项与`check`通过 | Codex本地复核 |
| 2026-07-31 | I01 | `partial` | `partial` | `failed` | `passed_limited` | `local_rollback_safe_alternative_recovery` | 独立内置基线、远程安全回退、替代失败、持久化故障和重启测试；小程序203项与`check`通过 | Codex本地复核 |
| 2026-07-31 | I03 | `implemented` | `partial` | `passed_limited` | `passed_limited` | `exact_legacy_positive_migration_gap` | 新批准的唯一legacy正向迁移、动态回执和客户端历史回放尚未实现；原三态/双重撤销有限证据保留 | Codex本地复核 |
| 2026-08-01 | I03 | `partial` | `implemented` | `passed_limited` | `passed_limited` | `local_exact_legacy_migration_runtime_and_receipt` | 唯一legacy迁移、运行时历史回放和动态严格回执定向36项全部通过；生产仍为`not_run/not_verified` | Codex本地复核 |
| 2026-08-01 | D11 | `partial` | `partial` | `passed_limited` | `passed_limited` | `protected_manual_rollback_boundary` | 人工回滚工作流、双开关、同提交普通CI、目标二次确认、完整目标包与独立审计测试；生产回滚未执行 | Codex本地复核 |
| 2026-08-01 | V16 | `partial` | `partial` | `passed_limited` | `passed_limited` | `production_dual_switch_write_boundary` | 历史修订、固定修正、月度发布、待发布恢复和人工回滚统一双开关正反向测试；GitHub Environment实时值未核验 | Codex本地复核 |
| 2026-08-01 | V17 | `implemented` | `implemented` | `passed_limited` | `passed_limited` | `recursive_workflow_action_pin_scan` | 全部11个工作流递归Action固定扫描与可移动标签失败fixture；真实GitHub执行未核验 | Codex本地复核 |
| 2026-08-01 | V18 | `implemented` | `implemented` | `passed_limited` | `passed_limited` | `same_commit_ci_for_protected_writes` | 四类生产写入入口同提交`.github/workflows/ci.yml`查询与错提交拒绝测试；真实恢复/修订/回滚运行未核验 | Codex本地复核 |
| 2026-08-02 | D11 | `partial` | `partial` | `passed_limited` | `passed_limited` | `local_durable_manual_rollback_recovery` | 写前内容寻址Intent、原运行写权限、切换后恢复运行只读重建审计、耐久审计无云密钥恢复提交及冲突失败关闭；真实GitHub/云端未运行 | Codex本地复核 |
| 2026-08-02 | D15 | `partial` | `partial` | `passed_limited` | `passed_limited` | `local_manual_rollback_finalizer_monitor_identity` | 审计v3分别绑定原始运行和最终收尾运行，只有最终收尾运行可立即触发统一监测；真实GitHub触发未运行 | Codex本地复核 |
| 2026-08-02 | S10 | `partial` | `partial` | `passed_limited` | `passed_limited` | `local_manual_rollback_intent_and_monitor_recovery` | 回滚Intent、三态、审计恢复和最终收尾监测身份纳入本地故障矩阵；生产控制面和双真机未验证 | Codex本地复核 |
| 2026-08-02 | D11 | `partial` | `partial` | `passed_limited` | `passed_limited` | `local_exact_attempt_rollback_recovery_v4` | `manual-data-rollback-intent-v2`与审计v4绑定原始/收尾`run_id + run_attempt`、Artifact attempt和收尾普通CI；同run不同attempt写入被拒，首次入口成对参数校验已恢复；定向65项及小程序285项通过，真实GitHub/云端未运行 | Codex本地复核 |
| 2026-08-02 | D15 | `partial` | `partial` | `passed_limited` | `passed_limited` | `local_exact_attempt_monitor_identity_v4` | 即时监测精确绑定审计v4最终收尾attempt；已有耐久审计由新run恢复提交仍只依赖原24小时窗口内的小时调度，未错误关闭 | Codex本地复核 |
| 2026-08-02 | I03 | `implemented` | `implemented` | `passed_limited` | `passed_limited` | `local_legacy_migration_attempt_binding_v3` | legacy Intent v3与审计v3绑定原始/收尾attempt，恢复使用`getWorkflowRunAttempt`，Artifact按attempt隔离，写前二次核对默认分支HEAD；生产迁移未运行 | Codex本地复核 |
| 2026-08-02 | S10 | `partial` | `partial` | `passed_limited` | `passed_limited` | `local_attempt_bound_control_writes` | 人工回滚与唯一legacy迁移的生产写权限均绑定精确attempt；本地定向65项及小程序285项通过，生产控制面、对象级CAS和双真机仍未验证 | Codex本地复核 |
| 2026-08-02 | I03 | `partial` | `implemented` | `passed_limited` | `passed_limited` | `local_npm_legacy_migration_entry_and_dry_run` | 标准 npm 入口固定传入批准的 `legacy-control-2026-06-e9788d0bddf3`，未带生产写入参数；入口回归测试通过，迁移 dry-run 的126个审计批次通过且未写入生产对象 | Codex本地复核 |
| 2026-08-02 | I03 | `implemented` | `implemented` | `passed_limited` | `passed_limited` | `local_legacy_migration_two_phase_finalize_order` | Intent v3只绑定验证器契约；apply阶段完成撤销登记、指针切换和直接70城回读，工作流随后部署严格云函数并由finalize阶段执行`describe_validator`、动态回执和审计；迁移工作流安全测试31项、迁移协议测试17项通过，生产迁移未运行 | Codex本地复核 |
| 2026-08-02 | R02 | `partial` | `partial` | `not_tested` | `passed_limited` | `local_v2.4.1_ordinary_monthly_replay_12_runs` | 两次独立6轮连续隔离回放均通过，合计12次执行；覆盖 `2025-12 -> 2026-06`，逐轮验证560条新增、历史零变化、错误候选上传前阻断、73个隔离对象回读和切城零下载；报告绑定提交前工作区执行时基线，当前代码已固定在 `cdea2207ff8f570aa1d8725ea474f22df30f26c8`，普通CI `30736720927` 已通过但不是回放证据；未执行真实云端/历史修订专项 | Codex本地复核 |
| 2026-08-02 | R02 | `partial` | `partial` | `passed_limited` | `passed_limited` | `cloud_v2.4.1_ordinary_monthly_replay_12_runs` | GitHub Actions `30752209300` 在 `main@53ac616` 连续通过 `2025-06 -> 2026-06` 的12轮真实隔离云端回放；每轮70城完整包、73对象回读、两类错误候选阻断和客户端完整包启用通过，生产指针/正式目录未触及且自动发布为`false`。历史修订、云函数、开发者工具和双真机未关闭 | Codex工件复核 |
| 2026-08-03 | R03 | `not_started` | `implemented` | `not_tested` | `passed_limited` | `local_deterministic_candidate_generator_v1` | 新增 `scripts/miniprogram/deterministic-candidate.mjs`、`deterministic-candidate.test.mjs` 和 `miniprogram:candidate` 命令；本地定向5项及全量小程序295项通过。尚未在干净精确提交上生成候选构件，未形成跨环境回读证据 | Codex本地复核 |
| 2026-08-03 | I10 | `not_started` | `partial` | `not_tested` | `passed_limited` | `local_candidate_stage_boundary_v1` | 候选生成基础能力已实现并通过本地测试；原字节晋级、最终 `release-manifest.json`、跨环境相同SHA-256和稳定归档仍未实现 | Codex本地复核 |
| 2026-08-03 | R03 | `implemented` | `implemented` | `passed_limited` | `passed_limited` | `local_exact_candidate_generation_v2` | 在干净临时检出中从`3b84e9a293e18fbd960328be243e0e84f18612a1`生成`v2.4.2`候选；36个文件的ZIP SHA-256为`9537150768abb6d452ad2fec57bb8c01121f5867426bfc6cb8fb9911e3b1603d`，清单SHA-256为`e08b69d4d97f26ccfa92927bf09403c30bd2002cdf2a42a5a67c0ab04945e547`，两次独立生成完全一致。未推送、未形成跨环境复现、未晋级稳定归档 | Codex本地复核 |
| 2026-08-03 | R01 | `partial` | `partial` | `not_tested` | `passed_limited` | `v2.4.9_local_candidate_and_basic_device_confirmation` | 精确提交`83efac8401b633916c6577600141a0f542a2ce0c`；`npm.cmd run test:miniprogram` 299/299通过；开发者工具源码已同步；用户确认Android与iPhone基础可用。未生成不可变候选，未完成18项全量双真机、CI、上传、审核、发布或稳定归档 | Codex本地复核与用户现场确认 |
| 2026-08-03 | R01 | `partial` | `partial` | `passed_limited` | `passed_limited` | `v2.4.9_deterministic_candidate_v2` | 精确提交`31f99d5c69e71b85e600b7412fcbfbe43fd3b693`生成36文件候选；ZIP SHA-256为`c7d979ec036057bc7ff4d8e9411b80734ea7c5b2690e1a4cc817f822261ee2c2`，候选清单SHA-256为`a185c9e9e306da7e15a24f52a2af89c1e77886d5ec85ed3a545babf46bbcc184`，文件清单SHA-256为`c513c0f4dc4f29495be4da8a1ee74b4233ea98b674315f42ce1dce314c0becbd`；同提交CI `30802632748` 通过；用户确认开发版已上传，但平台构建号、上传时间和线上回读证据未补；当前候选双真机、体验版、审核发布和稳定归档仍未完成 | Codex本地复核与用户确认 |
| 2026-08-06 | R03 | `implemented` | `implemented` | `passed_limited` | `passed_limited` | `v2.5.15_local_candidate_generation_with_compressed_snapshot` | 原候选生成器在当前压缩快照导出格式下失败关闭；精确提交`b854f8e6911986b556e45b760f27108596c24845`补齐受限JSON解析和测试后，`npm.cmd run check`通过（小程序336项），生成40文件`v2.5.15`候选。ZIP SHA-256为`1bca26bf2255d85f9033337d5277f8f96cd7c7406e4bae55ff0ec4f56b9eaba4`，候选字段SHA-256为`8d28f6c39b4e96d0ee70abd4c0588a5980a4071a867e59e64f5e532ac1b7d618`，文件清单SHA-256为`fb5501bd6d37ec33ed02ff8d60fd7464f0a8e23ffb37c07c9441e4e3caa43263`；未推送、未形成同提交CI、未晋级稳定归档 | Codex本地复核 |
| 2026-08-06 | I10 | `partial` | `partial` | `passed_limited` | `passed_limited` | `v2.5.15_candidate_stage_boundary` | 候选只写入`work/miniprogram-release-candidates/`，未写入`release/miniprogram/`；候选清单与ZIP哈希现场回读一致。原字节晋级、`release-manifest.json`、跨环境复现和稳定归档仍未完成 | Codex本地复核 |
| 2026-08-06 | R01 | `partial` | `partial` | `passed_limited` | `passed_limited` | `v2.5.15_user_confirmed_wechat_release_unbound` | 维护人确认该版本已于2026-08-05上传、审核通过并正式发布；未提供平台构建号、审核/发布时间、截图、正式线上数据回读或其与精确提交/ZIP候选ID的绑定，因此只登记用户确认的发布事实，不关闭候选绑定、远程数据、自动更新或稳定归档门禁 | 用户现场确认 |
| 2026-08-06 | R01 | `partial` | `partial` | `passed_limited` | `passed_limited` | `v2.5.15_wechat_online_screenshot_unbound` | 微信公众平台“线上版本”截图直接确认版本`2.5.15`、发布者“一路格桑花”、发布时间2026-08-06 09:16:40和备注“图标显示修复”，更正前一条用户口头确认中的发布时间；维护人确认审核通过及首页、城市筛选、三张图表、分享、来源页和数据截至2026-06的正式线上自检已完成。截图未显示构建号、审核通过时间、候选绑定或正式数据链路明细，因此不关闭候选绑定、远程数据、自动更新或稳定归档门禁 | 微信公众平台截图与用户现场确认 |
| 2026-08-07 | R02 | `partial` | `partial` | `passed_limited` | `passed_limited` | `local_v2.5.15_historical_correction_replay_12_rounds` | 精确提交`f829d52ab051ab4ce89ff0e3afb309815124a63d`上的本地内存回放连续12轮通过；每轮覆盖单条、多城市、多月份和最高150条修订，并拦截未批准差异、批准项缺失、旧值错误、来源定位错误、修订链断裂、冲突、已撤销版本恢复、切换前中断、切换后中断及无安全回退。报告为`work/historical-correction-replay/historical-v2-5-15-f829d52-20260807/report.json`，明确`automatic_release_enabled=false`且生产指针和正式发布前缀未触及；无GitHub运行、工作流哈希或测试云环境，不能关闭R02或开启自动发布 | Codex本地复核 |
| 2026-08-30 | R04 | `not_started` | `implemented` | `not_tested` | `passed_limited` | `local_stable_candidate_promotion_v1` | 候选原字节回读、六类外部证据身份、临时目录复核、原子完成、重复归档和失败清理的定向测试通过；未生成真实稳定归档 | Codex本地复核 |
| 2026-08-30 | R06 | `partial` | `implemented` | `not_tested` | `passed_limited` | `local_web_release_attestation_schema_2` | 提交、构建清单、数据/清单、域名、证据哈希、过期和未来时间的正反向测试通过；当前为未填写模板，未运行真实发布验收 | Codex本地复核 |
| 2026-08-30 | I10 | `partial` | `implemented` | `passed_limited` | `passed_limited` | `local_candidate_to_stable_identity_boundary` | 原字节晋级与最终清单已由R04工具和定向测试覆盖；跨环境与平台证据未完成 | Codex本地复核 |
| 2026-08-30 | I14 | `not_started` | `implemented` | `not_tested` | `passed_limited` | `local_version_identity_gate` | 当前入口、候选/归档身份和客户端未升版的正反向测试通过，普通CI入口已配置；下一次真实升版候选仍需现场验证 | Codex本地复核 |
| 2026-08-30 | D18 | `not_started` | `implemented` | `not_tested` | `passed_limited` | `local_quarterly_historical_page_isolation` | 官方来源重抓、HTML/XHTML内容类型校验、最终URL/重定向与原始哈希比较、相同页无动作、变化页仅产出隔离任务、请求失败不写入的5项测试通过；未运行GitHub季度任务 | Codex本地复核 |
| 2026-08-30 | D19 | `not_started` | `implemented` | `not_tested` | `passed_limited` | `local_github_issue_incident_lifecycle` | 同故障去重、负责人确认、一次超时升级、带SHA-256恢复关闭和非法输入拒绝的4项测试通过；负责人变量和真实GitHub演练未完成 | Codex本地复核 |
| 2026-08-30 | D18 | `implemented` | `implemented` | `passed_limited` | `passed_limited` | `online_historical_page_review_33300833376` | GitHub季度复核运行 `33300833376` 检出171条页面哈希变化、0条失败；维护人确认后逐页数据级复核171/171业务字段一致，0条修订申请、0次生产写入。该证据证明一次真实隔离闭环，不替代未来季度持续运行 | Codex工件复核与维护人确认 |
| 2026-08-30 | D19 | `implemented` | `implemented` | `passed_limited` | `passed_limited` | `online_incident_lifecycle_33300899238` | `HOUSING_DATA_INCIDENT_OWNER=yilugesanhua` 已配置；失败回调自动打开 Issue #11，Actions `33300990998` 与 `33300991022` 完成负责人确认和带SHA-256恢复关闭。该受控演练已验证闭环，不开启生产自动发布 | Codex工件复核 |
| 2026-08-30 | R01 | `partial` | `partial` | `passed_limited` | `passed_limited` | `v2.5.28_maintainer_confirmed_platform_completion` | 本机源码与开发者工具目录均为 `v2.5.28`；维护人确认 Android/iPhone 双真机、微信审核和正式发布完成。缺少不可变候选、精确提交、平台构建号/时间、主包大小、设备明细及正式数据回读，不关闭自动更新或稳定归档门槛 | 维护人确认与Codex本地版本核对 |

## v2.4.2 候选切换登记（2026-08-02）

`apps/miniprogram/config/version.js` 已从 `v2.4.1` 递增为 `v2.4.2`。原因是 `53ac616` 修改了小程序运行时校验文件；按照 `AGENTS.md` 和 `MINIPROGRAM_VERSIONING.md`，客户端构件发生变化后，旧版本候选和外部证据不能继续作为新候选证据。

- 当前源码版本：`v2.4.2`。
- 开发者工具同步：已完成；`apps/miniprogram/config/version.js` 与 `70城小程序技术验证/config/version.js` SHA-256 一致。
- 本地验证：小程序 296 项、`npm.cmd run check`通过；Web E2E为39项通过、1项有意跳过（八尺寸响应式矩阵已在电脑Chromium项目完整执行，手机专属交互另有覆盖）。
- 新模板：`MINIPROGRAM_V2_4_2_LAUNCH_AUDIT.md`、`MINIPROGRAM_V2_4_2_DEVICE_TEST.md`、`MINIPROGRAM_V2_4_2_RELEASE_HANDOFF.md` 已建立，均为未执行模板。
- `v2.4.1` 的云端回放 `30752209300` 只保留为旧版本证据，不能证明 `v2.4.2`；`v2.4.2` 云端回放已通过。精确本地候选已从干净提交`3b84e9a293e18fbd960328be243e0e84f18612a1`生成并双次一致回读，但尚未推送、尚无同提交CI、开发者工具、双真机或微信平台证据。
- 当前状态：`implementation_status=partial`，`verification_status=passed_limited`（仅限本地检查）；未部署、未上传、未审核、未发布，自动发布开关保持关闭。

### v2.4.2 云端回放结果更新（2026-08-02）

- GitHub Actions `30755834116` 已在 `main@94db4dd` 通过，报告和工件 `run_id=30755834116-1` 均为 `passed`。
- `2025-06 -> 2026-06` 连续 12 轮普通月度隔离云端回放全部通过；每轮 560 条目标记录、历史零变化、70 城完整包、72 个数据对象加 1 个控制对象回读、两类错误候选阻断和客户端完整包激活均通过，切换城市下载次数为 0。
- 生产指针和生产发布目录未触及，`AUTOMATIC_RELEASE_ENABLED=false`。
- R02 仍为 `partial/passed_limited`：本次只覆盖普通月度隔离云端回放；历史修订专项、云函数部署、开发者工具、双真机和微信平台证据仍未关闭。
- 本次回放总耗时 `1,740,890 ms`（29 分 00.890 秒）；逐轮耗时和 14 条历史/信息问题记录见 `MINIPROGRAM_V2_4_2_FULL_CLOUD_REPLAY_20260802.md`。

### 开发者工具 npm 运行包事件（2026-08-03）

- 用户在 Android 真机调试中观察到 `miniprogram_npm/@antv/wx-f2/index.js` 加载时缺少 `@babel/runtime/helpers/slicedToArray.js`、`Arrayincludes.js`，首页因此无法显示。该现象属于开发者工具旧 npm 产物或编译缓存与当前源码运行包不一致，不能归类为数据错误或已发布版本故障。
- 已执行源码到 `70城小程序技术验证/` 的重新同步、开发者工具编译缓存清理和项目重开；当前运行目录的 `@antv/wx-f2/index.js` 与源码同为 SHA-256 `00645843974f1f96ac5185c6e979c3c8f234652fdc9a323071e55efa5f91f333`，运行目录扫描未发现上述 Babel 外部引用。`snapshot.test.mjs` 28 项通过。
- 本次只恢复本地开发者工具运行状态，未改动 `apps/miniprogram/` 源码、数据、云端、生产指针或版本号，也未上传、审核或发布。Android 与 iPhone 必须在重新连接后的当前候选上重新确认首页和三张图表，才能恢复对应真机验收结论。
- 后续关闭条件：实现可达 npm 依赖的自动扫描与开发者工具缓存重建门禁，并保留 Android/iPhone 重新连接后的同候选证据。在此之前，此项仅有 `passed_limited` 的本地运行包复核，不得把它写成完整双真机通过。

### v2.4.2 基础双真机确认（2026-08-03）

- 用户确认 Android 与 iPhone 在当前 `v2.4.2` 候选上均正常使用；Android现场已确认首页及 `breadth`、`trend`、`cumulative` 三张图表完成初始化，Babel缺包错误未再出现。该结果已写入 `MINIPROGRAM_V2_4_2_DEVICE_TEST.md`，并绑定候选 `3b84e9a293e18fbd960328be243e0e84f18612a1` 与其不可变ZIP身份。
- 这是 `passed_limited` 的基础可用性证据，不等于模板所列18项全部完成，更不等于远程更新、历史修订、定位/缓存、弱网、回滚、开发版上传、微信审核或正式发布通过。Android与iPhone全量项及原始证据未补齐前，R01仍保持 `partial/not_tested`。

## v2.4.9 候选切换登记（2026-08-03）

`apps/miniprogram/config/version.js` 当前为 `v2.4.9`；最终候选提交为 `31f99d5c69e71b85e600b7412fcbfbe43fd3b693`，同提交 CI `30802632748` 已通过。此前所有 `v2.4.2` 的候选、CI、回放、构件和真机记录，以及旧 `v2.4.9` 候选 `75b05d8c...`，均保留为历史证据，不得用于关闭当前候选的任何门禁。

- 已知本地与 CI 证据：`npm.cmd run test:miniprogram` 299/299 通过；同提交 CI `30802632748` 通过；开发者工具源码已同步。旧候选的 Android 与 iPhone 基础确认因候选 ZIP 身份变化失效，当前候选需重新确认。详细边界见 `MINIPROGRAM_V2_4_9_DEVICE_TEST.md`。
- 已建立 `MINIPROGRAM_V2_4_9_RELEASE_HANDOFF.md`；该候选已推送并通过同提交 CI，用户确认开发版已上传，但未设体验版、未提交审核、未发布，尚未生成稳定归档；平台构建号、上传时间和线上回读证据待补。
- 当前状态：R01 为 `partial/passed_limited`，只限本地自动化、同提交 CI、候选生成和开发者工具源码同步；当前候选双真机、云端/数据回放、微信平台现场复核和所有发布门禁继续保持未完成。
- 当前候选 ZIP 与清单已绑定同一精确源码提交；候选构件本身不构成开发者工具编译、双真机、微信平台或正式发布证据。
- 旧候选的重复生成结果只作为历史确定性证据保留，不能替代当前 `c7d979...` 候选的重新生成和真机证据。

## v2.4.10 本地修复登记（2026-08-03）

`apps/miniprogram/config/version.js` 已递增为 `v2.4.10`。本轮修复覆盖严格发布日期阻断和审计身份、Web与小程序异步状态竞争、图表错误降级、反向定位超时与响应限制、候选源码白名单及开发者工具目录一致性；正常页面结构和视觉布局未重构，页面可见变化只在图表失败重试和缺失城市异常提示出现时显示。

- 当前数据版本为 `2026-06-59401537d29a`；解析器为 `official-html-v8-product-housing-only-strict-release-date`，独立审计为 `full-record-audit-v6`、报告 schema 2。126个来源批次、70,560条标准记录通过全量重解析、独立审计和 `validate:data`，统计指数值与修复前逐值一致。
- 本地验证：小程序测试 304/304，Web单元测试 18/18，数据测试 46/46，发布门禁测试 3/3；`npm.cmd run check` 完整通过；Web E2E 39项通过、1项按既有项目配置跳过，覆盖电脑和手机视口、加载、离线、错误恢复、空数据、筛选、键盘、触控和图表绘制。
- `apps/miniprogram/` 已同步到 `70城小程序技术验证/`；36个允许进入客户端构件的源码文件逐一一致，目录未发现白名单外额外文件。该结论只证明文件同步，不代表微信开发者工具编译或真机运行通过。
- 当前仍是未提交工作区，不是不可变候选。未生成候选ZIP或稳定归档，未运行同提交CI，未上传、未部署云函数、未审核、未发布，也未执行Android/iPhone双真机验收；R01继续保持 `partial/passed_limited`。

## v2.4.11 本地来源身份修复登记（2026-08-03）

`apps/miniprogram/config/version.js` 已递增为 `v2.4.11`。本轮将“数据来源身份”与“客户端构件身份”分开：同一统计月份、同一官方来源但解析器或构建时间不同的包不再误报数据冲突；较新的内置构件会继续使用，旧的同源远程包及缓存不会重新激活。同月不同来源仍失败关闭，新月份和经审计的历史修订仍按原有安全链处理。本轮没有调整页面布局、正常状态文案或图表样式。

- 当前内置构件为 `2026-06-59401537d29a`，其兼容来源身份为已发布的 `2026-06-4fd1d1a8ff12`；当前规范化数据计算出的稳定来源摘要为 `2026-06-ac103a1b1b18`，仅通过精确兼容映射关联到该已发布来源，不对其他月份或近似摘要放宽。内置与已发布远程数据的70,560条记录、120个月、268,800个小程序图表值及发布日期逐值一致，差异仅为解析器构建元数据。
- 本地验证：数据测试 49/49、小程序测试 305/305、发布门禁测试 3/3、Web单元测试 18/18；`npm.cmd run check` 完整通过，`validate:data` 校验70,560条记录，生产构建通过。历史修订字段绑定与旧生产控制迁移重放均已纳入上述结果。
- `apps/miniprogram/` 已重新同步到 `70城小程序技术验证/`；本轮结束前再次执行目录一致性检查。该结论只证明本地文件同步，不代表微信开发者工具编译或真机运行通过。
- 本轮未上传或修改生产云端包、生产指针和云函数，未部署、未提交、未推送、未生成不可变候选、未运行同提交CI、未审核、未发布，也未执行 `v2.4.11` 的Android/iPhone双真机验收；R01继续保持 `partial/passed_limited`。
- 2026-08-03完成 `2025-06 -> 2026-06` 的12个连续月份本地隔离全链路回放，详见 `MINIPROGRAM_V2_4_11_12_MONTH_REPLAY.md`。前两次分别因审计批次新增 `records_sha256` 和模拟快照缺少稳定来源身份而失败关闭，修复回放工具后从第1轮重跑，12/12通过；每轮560条新增、历史零变化、两类错误候选上传前阻断、73对象全量回读、70城客户端激活和切城零下载均通过。
- 2026-08-04先完成 `2023-06 -> 2026-06` 的三组各36个月本地隔离回放，共108次，详见 `MINIPROGRAM_V2_4_11_108_MONTH_REPLAY.md`。该本地演练三组均36/36通过，合计重解析60,480条目标月记录、阻断216个错误候选、回读7,884个隔离对象并完成108次70城客户端激活；它不能替代后续真实云端回放或外部平台验收。`REPLAY-012` 和 `REPLAY-013` 已修复并复验。

## v2.4.11 三次真实隔离云端回放登记（2026-08-04）

- 候选精确提交 `2bd9e4e354c113f091f1fe7302a54a1c41e2f163` 已通过普通 CI `30868705225`，并已 squash 合并到 GitHub 默认分支 `main`；三次云端回放均绑定该提交。
- GitHub Actions `30868946299`、`30872081163`、`30877516940` 均成功完成，分别为 36/36 月、216/216 阶段通过；目标范围均为 `2023-07 -> 2026-06`，基线为 `2023-06`。
- 三次共验证 60,480 条新增目标记录、历史变化 0；216 个损坏候选均在上传前拒绝；回读 2,592 个数据对象和 36 个控制对象；完成 108 次远程小程序激活，切城下载均为 0。
- 三次均证明生产 `current.json`、生产发布前缀未触碰，`AUTOMATIC_RELEASE_ENABLED=false`；这只证明隔离回放，不证明生产发布、微信开发者工具编译或双真机验收。
- 第 3 次工作流收尾出现的 GitHub Node.js 20 弃用提示（`REPLAY-014`）已修复：所有工作流统一升级到支持 Node.js 24 的官方 Action，并继续固定完整提交 SHA（`checkout v7.0.1`、`setup-node v7.0.0`、`upload-artifact v7.0.1`、`download-artifact v8.0.1`）。新提交的普通 CI 和回放回归仍需完成后，才能关闭该问题的验证状态。
- R02 仍保持 `partial/passed_limited`：三次真实云端回放已补齐当前候选的月度全链路证据，但开发者工具编译、Android/iPhone 真机、审核和正式发布仍未完成。

## v2.5.6 近15年全量复核与修复登记（2026-08-05）

本节登记本轮近15年住房价格指数全量复核、修复和本地候选证据；不表示当前候选已经上传隔离云端、编译到微信开发者工具、通过真机验收或进入正式发布。

- 数据范围为 `2011-07` 至 `2026-06`，180个月、180个官方HTML批次、70座城市、100,800个标准记录。唯一键重复0，月份跳跃/重复0，城市缺失0，来源URL/批次/原始单元格定位缺失0，发布日期缺失0，非国家统计局HTTPS来源0。
- 100,800个记录槽位包含201,600个环比/同比指数单元格：有效数值201,489，官方空单元格或破折号形成的合规`null` 111，非法数值、错精度和未说明缺失0。累计口径字段中12,600个为官方已发布值，88,200个按表口径记录为`not-published-for-this-table`，未用0或推算值填补。
- 当前解析器为 `official-html-v9-product-housing-only-strict-release-date`，独立审计为 `full-record-audit-v7`，审计报告 `schema_version: 2`；180/180批次、100,800/100,800条记录通过官方四类表白名单、表内统计月份、原始单元格、字段不变量和身份绑定审计。审计提交 `1c32244d55fd1e7efd2d04ac84b7ad6896e3271c`，审计代码SHA-256 `8236227a59883fc309e8578b76039dbff10eaea46267618c7404a3ddfab2af29`，审计报告SHA-256 `3d576bf61277c0f6e662d76b4d192cd392e0abe1cc8e3c953a5673b3692f1e17`，规范记录SHA-256 `283028e67b0a07edf0c9e5d733ad7c6090b865a9bb8da4c8a8584f87bba3a229`。
- 本轮修复了严格发布日期和伪日期阻断、四类官方表及历史标题识别、指数与环比/同比配对、缺失原因白名单、YTD期间和上年同期基准校验，并将审计报告绑定到完整记录、来源索引、解析器、审计代码、精确提交和报告自身哈希；同时补齐完整15年候选的来源批次、输入快照和客户端二次阻断测试。
- 跨产物独立逐值复核：标准化数据与Web `data.json` 的100,800条业务记录及四个展示值差异0；内置10年快照的120个月×70城×8口径×4值共268,800个值差异0；15年完整候选的180个月×70城×8口径×4值共403,200个值差异0。内置快照文件为730,455字节，完整候选文件为1,998,341字节，候选SHA-256为 `430520342fa26ca96b6142854045309759788fa300a272b466b1eeeece5e16ed`。
- 当前候选身份为小程序 `v2.5.6`、远程协议 `2.1.0`、平台数据版本 `2026-06-d399211073dd`、来源数据版本 `2026-06-69fa180bd8db`；候选清单绑定180个来源批次、v7审计身份和最低兼容版本 `v2.5.6`。`apps/miniprogram/` 与 `70城小程序技术验证/` 本次构件输入逐文件核对38个文件，SHA-256差异0。
- 本地验证结果：数据测试59/59、小程序测试325/325、`validate:data` 100,800条通过；2026-08-05在当前工作区串行执行 `npm run check` 全部通过（165.9秒），Web端到端测试电脑/手机共40项，其中39项通过、1项按项目配置跳过；当前完整候选验证器再次输出 `Verified 2026-06-d399211073dd: one complete 180-month data file`。
- 当前仍为 `partial/passed_limited`：候选提交为 `1c32244d55fd1e7efd2d04ac84b7ad6896e3271c`，已上传到隔离预览前缀 `housing-data/preview/` 并完成上传脚本回读和独立下载回读；预览 `current.json` SHA-256 为 `341c2e23f40286bde2b72b661b69bd4298d69308cdf0cdad02d6b1be2a119a43`，完整包远端 SHA-256 与候选 `430520342fa26ca96b6142854045309759788fa300a272b466b1eeeece5e16ed` 一致。生产指针和生产发布前缀均未触碰。微信开发者工具实际编译、Android/iPhone真机、Wi-Fi/移动网络/弱网下载耗时、审核和正式发布仍未验证。
- 本轮未写入正式`housing-data/current.json`或正式发布目录，未切换正式指针，未推送、审核或发布；已形成本地候选提交并保留用户未跟踪文件。近15年数据可以进入后续专项平台验收，但在上述外部证据补齐前仍禁止正式发布和生产自动更新。

## 正式环境门槛证据补充（2026-08-06）

- 唯一 legacy 控制迁移不是待办事项：不可变审计 `data/releases/legacy-control-migration-2026-08-02T08-30-08-467Z.json` 记录迁移 ID `legacy-control-2026-06-e9788d0bddf3`、最终收尾提交 `8c7f7577458820daaed24dde35970f8391214a8d` 及 GitHub Actions 运行 `30750265475`。该运行的 `prepare`、`migrate`、`audit` 均通过；审计记录的 `production_pointer_round_trip_verified`、`full_release_verified_before`、`full_release_verified_after`、`strict_validator_verified` 均为 `true`。
- 隔离云端写入和自动回滚演练已由 GitHub Actions `31007828723` 完成。写入限定在 `housing-data/rehearsals/31007828723-1/`，完成上传、HEAD、下载和哈希回读，隔离指针的故意守卫失败后自动回滚成功；该演练明确证明 `production_pointer_untouched=true`、`production_release_prefix_untouched=true`。
- 这些是 D11、I03 与 S10 的新增有限范围云端证据，三项仍为 `passed_limited`，不解除任何生产阻断。没有执行正式数据人工回滚，也不能为了补证据主动回滚正式数据。
- `AUTOMATIC_RELEASE_ENABLED` 和 `PRODUCTION_RELEASE_AUTHORIZED` 在迁移审计中均为 `false`；本次未修改它们，继续保持关闭。仍需当前候选同提交CI、候选绑定的开发者工具和双真机原始记录，以及完整客户端远程包原子启用、失败回退、历史修订和通知闭环证据，才可再次讨论自动发布。
