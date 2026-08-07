# 每月自动更新启用清单

本文只记录必须在外部账号、真实云环境或真机中完成的启用事项。代码实现和常规验证不要求维护人员手工执行命令。

当前源码版本以唯一机器源 `apps/miniprogram/config/version.js` 为准，本次清单快照为 `v2.5.15`。微信公众平台“线上版本”截图确认该版本在线发布时间为2026-08-06 09:16:40，维护人确认审核通过和正式线上自检完成；仓库尚未保存构建号、审核通过时间、正式数据链路明细或其与本地候选ID的可复核绑定。该证据不等于正式远程数据或自动更新能力已经验收，执行启用自动更新或生产写入前仍必须在正式数据链路重新读取。下文涉及 `v2.0.2`、`v2.3.0`、`v2.4.0` 或 `v2.4.1` 的其他实施记录按其日期和固定版本解释。

## 当前结论

- 2026-08-07：维护人已完成最终授权。当前源码版本为 `v2.5.15`，GitHub Actions `31137756505` 在精确提交 `60d3cb38f2bd47694aa1a7c78d674eeb1d1cfb79` 完成唯一一组 36 个月普通月度隔离回放（`2023-07 -> 2026-06`），36/36 通过。下载工件报告 `full-auto-update-replay-31137756505-1/31137756505-1/report.json` 记录 `status=passed`、`production_pointer_untouched=true`、`production_release_prefix_untouched=true` 和回放期间 `automatic_release_enabled=false`；每轮完成官方归档解析、候选失败关闭、隔离 COS 上传回读、隔离指针切换和小程序客户端激活。
- 同日通过 GitHub CLI 分别设置并独立回读：仓库级 `AUTOMATIC_RELEASE_ENABLED=true`，`housing-data-production` Environment 级 `PRODUCTION_RELEASE_AUTHORIZED=true`。两个精确值均为 `true`，因此正常月度自动更新已启用；D19 未关闭时运行模式为 `supervised_automation`，不宣称无人值守通知闭环。

- 自动发现、候选生成、数据门禁、受限发布、发布后守卫、回滚、待发布恢复、私有审计和24小时监测已有基础实现；D01-D16仍存在未关闭的正确性、重跑、审计、客户端状态和回滚差距，不能概括为完整安全闭环。
- 既有 `npm run check`、`npm run test:e2e`、小程序/自动化故障测试和GitHub Actions检查只证明对应提交与已覆盖场景，不能替代D01-D20的关闭证据。
- 公开仓库 `yilugesanhua/housing-price-index` 已创建，初始提交 `4e0713e` 已推送，GitHub Actions `ci / verify` 已通过；仓库当前同时跟踪官方页面 `.html.gz` 和对应批次复现文件，它们不进入Web或小程序生产包。
- `housing-data-production` Environment 已创建；写入与只读监测 Secrets 已分别配置。2026-07-31通过GitHub CLI现场只读回读：仓库级 `AUTOMATIC_RELEASE_ENABLED=false`，生产 Environment 未设置 `PRODUCTION_RELEASE_AUTHORIZED`；当前两级门禁均失败关闭。变量缺失不等于V16已完整验证，真实受保护Environment执行和未来启用时的独立授权证据仍未完成。
- `main-production-guard` 规则集已启用，禁止删除、强制推送和非线性历史；生产Environment仅允许 `main` 分支进入。
- GitHub个人仓库不允许内置Actions身份绕过“必需状态检查”，因此规则集不直接要求 `verify`；自动发布工作流必须在候选生成前通过GitHub API证明基础提交的普通 `ci / verify` 已成功。
- COS/SCF 官方 SDK 联调、完整 70 城隔离上传/回读及有限指针/回滚演练已有历史通过记录；生产开关必须保持关闭，直到R02、D01-D16、I01-I03、I09、I12、候选绑定的开发者工具检查和双真机、平台证据回读及正式数据链路复核全部完成。维护人确认已发布不单独满足自动更新门槛。
- 普通月度远程更新与 `v2.4.0` 起引入、由当前 `v2.4.1` 继续修复的受审计历史修订协议不是同一能力；完成下列当前版本验收并核验平台版本前，不得宣称线上用户已获得该能力。
- 当前运行模式是 `automation_disabled`，不是有人监督或无人值守自动化。R02、D01-D16及I01-I03、I09、I12全部关闭后，生产开关才可由维护人另行确认；D19尚未关闭时即使启用也只能标记为 `supervised_automation`。
- 唯一旧生产控制指针迁移已完成并通过验证：不可变审计 `data/releases/legacy-control-migration-2026-08-02T08-30-08-467Z.json` 绑定迁移 ID `legacy-control-2026-06-e9788d0bddf3`，最终收尾 GitHub Actions 运行 `30750265475` 的 `prepare`、`migrate`、`audit` 均通过。审计已记录迁移前后原字节回读、两次完整70城重建、严格云函数回执及 `AUTOMATIC_RELEASE_ENABLED=false`、`PRODUCTION_RELEASE_AUTHORIZED=false`。这只解除旧控制指针兼容阻断；普通自动发布仍因其余清单项目未关闭而保持阻断。

D01-D20与I01-I14的当前状态和关闭证据见 [实施状态登记](IMPLEMENTATION_STATUS.md)。本清单不得用“规范已更新”把任何实现或验证状态改为通过。

## 一次性legacy迁移门槛

本节只授权把唯一旧生产控制指针升级到现行控制协议，不授权发布新数据、历史修订、回滚、状态部署、待发布恢复或开启自动发布。全部条件必须同时满足：

1. 迁移ID固定为 `legacy-control-2026-06-e9788d0bddf3`，运行来自默认分支精确提交，且同一提交的普通 `ci / verify` 已成功；当前生产指针原始SHA-256、旧manifest/bootstrap、数据包/源版本和撤销关系必须与 `MINIPROGRAM_DATA_UPDATE.md` 的唯一描述符逐项一致并归类为 `ready`。
2. 生产 `housing-data-production` Environment 由维护人针对该次运行人工批准。`LEGACY_CONTROL_MIGRATION_AUTHORIZED` 不得创建为仓库级或 Environment 级持久变量；只有受保护 job 在完成人工批准、默认分支精确提交、同提交普通CI和固定确认串核对后，才可通过 job 临时环境设置精确值 `true`，并且 job 结束自动失效。仓库级 `AUTOMATIC_RELEASE_ENABLED` 和生产 Environment 级 `PRODUCTION_RELEASE_AUTHORIZED` 在迁移前、迁移中和迁移后都必须保持 `false` 或未设置。
3. 取得任何生产存储写权限、上传撤销登记或修改指针前，必须在精确生产云环境调用 `action=describe_validator`，严格核对返回字段只能是 `validator_id='housing-control-validator-v2'`、`receipt_schema_version='1.0.0'`、`max_receipt_validity_ms=600000`。调用失败、字段增减、值错误或环境/函数身份错误必须在写前停止；预检运行ID、响应哈希及核对结果进入迁移审计。
4. 受保护运行必须在任何生产指针写入前生成并耐久保存不可变迁移意图，绑定旧指针和候选指针原始字节SHA-256、manifest、撤销登记、迁移时间、提交SHA、运行ID、验证器预检和第一次完整70城验证证据。最终审计必须内嵌该意图及其SHA-256。运行还必须保留迁移前后指针原始字节及SHA-256、撤销登记SHA-256和代次、两次完整70城逐值验证、旧manifest/bootstrap原字节不变、双重撤销、普通入口拒绝legacy及 `ready/already_migrated/conflict` 结果。任一冲突在写前保持旧指针不变；已经写成唯一预期结果后只允许由同一原始意图执行 `already_migrated` 只读恢复复核和补存审计，不得再次写指针、不得静默恢复legacy，也不得根据当前状态补造迁移前证据。
5. 迁移审计必须把 `describe_validator_observed`、`describe_validator_verified`、`cloud_function_response_observed` 与 `strict_validator_verified` 分列。只读身份预检通过不证明写后数据通过；写后只观察到响应也不证明严格验证成功。最后一项只有在新版严格云函数已有独立部署证据，且同次新鲜 `validation_receipt` 的schema、验证器身份、时间、当前指纹、manifest/撤销哈希和代次全部通过时才能为 `true`。
6. 工作流必须用机器测试证明不读取 `${{ vars.LEGACY_CONTROL_MIGRATION_AUTHORIZED }}`，且该一次性值只能在受保护 job 的全部写前门禁通过后进入临时环境；job 结束后不得存在可供后续运行复用的持久授权。现场仍须回读仓库级 `AUTOMATIC_RELEASE_ENABLED` 和生产 Environment 级 `PRODUCTION_RELEASE_AUTHORIZED` 均保持关闭。下一次普通月度发布还必须证明控制代次递增且完整保留迁移建立的撤销登记。缺少任一证据时迁移保持 `not_verified`。

迁移通过只解除旧控制指针兼容阻断，不等于当前客户端、云函数、普通发布、自动回滚或通知闭环通过，也不能作为开启两个普通生产开关的证据。

## 需要维护人员参与

1. 在腾讯云创建或授权最小权限CI服务身份时，完成必要的扫码、短信、2FA或实名确认。密钥不得粘贴到聊天、代码、日志或普通仓库变量。
2. 已使用生产 Bucket 下严格隔离的 `housing-data/rehearsals/<run-id>/` 目录完成写入、全量版本、指针切换和自动回滚演练；后续如调整权限策略，仍需重新验证凭据失效与回滚失败报警。
3. 分别在一台Android和一台iPhone上完成首次在线、首次离线、旧缓存、清缓存、定位授权、弱网和图表交互验收。
4. 当前版本的线上版本号和发布时间已由微信公众平台截图回读；仍须补齐候选身份、构建号和与交接记录的一致性。用户确认、已上传开发版、已提交审核或审核通过均不能单独满足本项。
5. 使用正式线上版本完成远程完整70城数据读取复核，证明完整下载、校验、原子启用、切换非常用城市零新增下载和失败保留旧版本均符合当前规范；结果及原始证据索引必须写入当前版本交接记录。
6. 上述证据全部通过后，由维护人作出最后一次明确授权，才允许把仓库级 `AUTOMATIC_RELEASE_ENABLED` 和生产 Environment 级 `PRODUCTION_RELEASE_AUTHORIZED` 分别从 `false` 改为 `true`；两项必须独立设置、独立回读，任一不为 `true` 时不得生产写入。

除身份验证、真机操作和最终确认外，其余仓库初始化、工作流配置、环境变量录入、测试执行和结果核对由Codex完成。

当前 `v2.5.15` 已有[候选交接记录](MINIPROGRAM_V2_5_15_RELEASE_HANDOFF.md)，但仍须建立并填写绑定同一精确候选的上线审查、Android验收和iPhone验收记录；用户确认的发布事实不能替代这些记录。

`v2.4.1` 及更早版本的模板或记录只作历史参考，不得直接作为 `v2.5.15` 的通过证据。

## GitHub配置目标

- 公开仓库已创建；`main` 规则集禁止删除、强制推送和非线性历史，发布工作流内部强制验证基础提交的 `ci / verify` 成功记录。
- Environment `housing-data-production` 已创建。
- 仓库级变量目标：`AUTOMATIC_RELEASE_ENABLED=false`；生产 Environment 变量目标：`PRODUCTION_RELEASE_AUTHORIZED=false`。2026-07-31现场值分别为`false`和未设置，当前满足失败关闭要求；若以后设置、改值或启用，必须重新现场回读，不能根据工作流源码或旧截图推断。
- 一次性迁移授权目标：仓库级和 Environment 级均不得持久设置 `LEGACY_CONTROL_MIGRATION_AUTHORIZED`；只有本清单上一节的精确获准受保护 job 可在全部写前门禁后临时设为 `true`，job 结束自动失效。
- 写入服务身份Secrets：`TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY`。
- 只读监测身份Secrets：`TENCENTCLOUD_MONITOR_SECRET_ID`、`TENCENTCLOUD_MONITOR_SECRET_KEY`。
- 生产Secrets不对Fork、Pull Request、任意分支或手动拼接参数开放。

## 启用前证据

- GitHub Actions中的 `ci`、只读发现、候选准备、生产发布恢复和24小时监测工作流语法有效。
- I09关闭证据必须证明：只读发现只生成不可变观察报告；独立受保护状态部署作业只能在基线一致时保持数据/撤销身份、递增控制代次并写后回读，冲突或失败时原指针字节不变。该作业当前尚未完成，不能把观察结果当作已部署的用户可见状态。
- I12关闭证据必须证明：生产信任链中读取Secrets或生成、传递其Artifact的全部外部GitHub Action固定到40位commit SHA，容器Action固定digest，并有机器扫描和可移动标签失败用例。当前本地扫描与失败fixture已通过，精确提交 `cdea2207ff8f570aa1d8725ea474f22df30f26c8` 的普通GitHub CI运行 `30736720927` 也已通过；受保护Environment执行和依赖更新流程仍未复核，因此只能记为 `passed_limited`，不得关闭I12或开放生产授权。
- 测试云完整发布后，云函数、`current.json`、清单、bootstrap和70个城市分片全部回读一致。
- 故障演练证明所有正确性失败均发生在指针切换前，旧指针原始字节和SHA-256保持不变；没有已完整验证的安全回退目标时不会切换，切换后的恢复只使用预验证目标。
- `IMPLEMENTATION_STATUS.md` 中R02、D01-D16及I01-I03、I09、I12均有精确提交、自动测试及所需云端/真机证据，`implementation_status=implemented` 且 `verification_status=passed`；R02必须包含当前精确候选的普通月度12轮和历史修订专项12轮，两条证据不得互相替代。
- 唯一legacy迁移已有两阶段受保护运行证据：写入阶段绑定固定验证器契约并完成迁移前后原字节回读、双重撤销和直接70城校验；随后部署新版严格云函数，收尾阶段完成 `describe_validator` 精确身份预检、第二次完整70城验证、动态回执和不可变迁移审计。四个观察/验证字段分别留证，状态为 `migration_status=completed`、`migration_verification_status=passed`；未达到时不得让现行协议客户端依赖该生产指针，也不得开启普通自动发布。
- 私有运行审计包包含当月压缩原始HTML副本、完整响应/批次元数据、官方日程、发现/生产门禁、发布报告和所有文件哈希；它只允许写入仅维护身份可读的私有云目录，不得进入GitHub运行Artifact。GitHub Artifact只允许保存非敏感证据和 `private-audit-reference.json` 哈希引用，不得与公开源码仓库中的 `.html.gz` 复现档案或完整私有审计混为一谈。
- V14关闭证据必须包含一次真实待发布恢复运行：无Secrets作业拒绝危险pending字段/URL并重验官方来源和候选，受保护发布作业只消费已验证结构化输出。
- V15关闭证据必须完成现有可访问历史Artifact检查；发现曾包含 `work/private-audit/` 时立即删除或确认保留期失效，并保存不复述敏感正文的处置记录。
- V16关闭证据必须现场证明仓库 `AUTOMATIC_RELEASE_ENABLED=false` 与生产Environment `PRODUCTION_RELEASE_AUTHORIZED=false` 分别存在且作用域正确，并以一真一假组合证明任一关闭都会失败。
- V17关闭证据必须包含真实GitHub手动入口的默认分支成功和非默认ref拒绝记录，并现场核对Environment仅允许默认分支。
- V18关闭证据必须包含一次真实待发布恢复：只接受恢复提交自身的成功 `ci.yml` push运行，并把CI运行ID、提交SHA和门禁哈希绑定到生产授权；错提交、Pull Request和旧运行均失败。
- 当前精确候选通过双真机验证并正式发布；微信公众平台线上版本回读、正式版远程完整70城读取复核及其交接记录均已完成。仅上传开发版、提交审核或审核通过不构成生产自动发布的启用证据。

历史云端证据（仅证明对应运行当时的状态）：

- 隔离完整发布与自动回滚：GitHub Actions `30264827489`，该次运行中70城分片全量重建通过。
- 演练后生产只读复核：GitHub Actions `30265087706`，该次运行当时观察到正式版本为 `2026-06-ec36ff8fb2e5`，云函数和70城完整回读通过；该值不是当前线上状态，启用前必须重新现场核验。

## 非当前开关硬门槛

D17-D19不替代R02、D01-D16及I01-I03、I09、I12的生产开关门槛，也不阻止当前已覆盖年份的正常月度发布；它们按以下边界单独治理：

- D17必须在进入2027年SLA计算前关闭；未关闭时只能标记下一年度日历待官方公布，不能自行推算跨年工作日。
- D18未关闭时不得声称系统会自动发现统计局事后修改历史页面；人工发现仍进入隔离修订流程。
- D19未关闭时不得声称已经形成无人值守通知闭环；现有GitHub失败状态和运行摘要只能作为有限信号。若R02、D01-D16及I01-I03、I09、I12全部通过后先启用正确性自动发布，运行模式必须明确标记为“有人监督自动化”，维护人在每个计划发布日10:30、12:30、16:30及次日首个工作时段人工检查发现、发布、守卫和监测运行；任一次未检查即不具备该月SLA声明。D19完成接收人、确认超时和恢复闭环演练后，才可取消该人工巡检。

当前10:30后的12:00/16:00补查无法保证从正式页面任意可访问时点起60分钟内发现；这不改变既定SLA起点，但意味着现有调度尚无资格声明60分钟正式SLA生效。该时效声明缺口不放宽数据正确性门禁；后续调整调度必须另行修改工作流、规范和测试并完成云端验证。

## 启用后正常月份

启用后维护人员无需开机、运行命令、上传小程序版本或逐个确认数据版本；但D19关闭前仍必须执行上一节的固定人工巡检。只有D19关闭并进入 `unattended_automation` 后，正常月份才无需人工查看运行状态，官方日程冲突、页面结构变化、历史修订、数据门禁失败、云权限失效或自动回滚失败时再进入人工隔离。
