# 实施状态登记

更新日期：2026-08-03

本文件记录权威规范与当前实现之间的差距，不另行定义产品、数据或发布规则。R01-R07、D01-D20、I01-I14与V01-V19涉及的目标要求以 `AGENTS.md`、`PRODUCT.md`、`DATA_CONTRACT.md`、`ACCEPTANCE.md`、`MINIPROGRAM_VERSIONING.md`、`RELEASE_READINESS.md` 和 `MINIPROGRAM_DATA_UPDATE.md` 的对应条款为准；项目全部权威规范及职责边界以 [文档索引](DOCUMENT_INDEX.md) 为准。

当前界面和功能事实以 `apps/web/` 与 `apps/miniprogram/` 为准。S00-S09及V01-V12最初的规范治理轮次没有修改 Web、小程序、生成数据、云端资源或当前页面；后续单独批准的S10只修改小程序远程数据运行时、控制面和发布/回滚工具，不修改正常数据页面。V13-V18与D08后续实施只修改已批准的数据审计、客户端元数据、工作流安全、测试和对应规范；2026-07-31另行批准实施D08-D14、I01-I03、I11、V01和V07后，小程序新增数据不可用错误态、定位披露及缓存清理。真实默认启动随后暴露“没有可信控制状态即禁用完整内置快照”的严重回退，原失败证据和重新打开记录继续保留；同日完成最小运行时修复及本地回归后，D10、D13恢复为 `implemented/passed_limited`，S10和I01恢复为 `partial/passed_limited`，仍不代表真实CI、云端、开发者工具、双真机或发布通过。下表中的 `approved` 只表示方案已经确认，不能理解为代码已经实现、测试已经通过或生产能力已经启用；各项实现与有限验证另按本文件专项登记。

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

本组治理“当前版本能否被旧证据代替、发布包能否复现、Web声明是否属于当前构建、运维时间是否唯一”问题。2026-07-29的原始事实基线是提交 `c1b52a06be9c53dc16af7ec97cf2c574c7735496` 和源码版本 `v2.4.0`；当前候选为 `v2.4.9`，最终精确提交为 `31f99d5c69e71b85e600b7412fcbfbe43fd3b693`。本地小程序自动化 299/299 通过，同提交 GitHub CI `30802632748` 通过，开发者工具源码已同步；用户已确认开发版上传，但未提供平台构建号、上传时间或线上回读证据；当前候选的18项双真机、体验版、云端生产和微信平台完整证据仍未完成，尚未形成稳定归档、审核或正式发布证据。旧 `v2.4.2` 和旧 `v2.4.9` 候选的 CI、云端回放、构件和真机记录仅属历史候选，不能替代当前候选。文档模板或批准目标不能替代代码、云端、开发者工具、真机和平台证据。

| ID | 用户决策 | 当前问题 | 已批准目标或保留决定 | 实现状态 | 验证状态 | 当前阻断 |
| --- | --- | --- | --- | --- | --- | --- |
| R01 | `approved` | 当前源码为 `v2.4.9`，最终精确提交、不可变候选和同提交 CI 已固定；旧候选真机确认因 ZIP 身份变化失效，当前候选尚未完成双真机或完整验收 | 绑定最终精确提交完成上线审查、交接、Android和iPhone全量验收并绑定同一身份；旧版证据只读保留 | `partial` | `passed_limited` | 阻断 `v2.4.9` 稳定归档、审核和发布结论 |
| R02 | `approved` | 普通月度路径已有 `v2.4.2` 精确提交的12轮隔离云端证据，但不能证明历史修订协议安全或外部微信平台验收 | 在当前精确提交分别保留普通月度12次执行和历史修订专项12轮故障回放，两条证据不得互相替代 | `partial` | `passed_limited` | 普通月度12轮云端回放已在 `main@94db4dd` 通过；仍缺独立历史修订12轮、云函数部署、开发者工具和双真机证据 |
| R03 | `approved` | 此前没有确定性候选构件工具，稳定归档仍不能按新规则生成 | `scripts/miniprogram/deterministic-candidate.mjs` 已能从精确提交生成确定性候选ZIP、回读清单和候选哈希；重复构建、乱序、排除项、非ASCII路径和损坏ZIP测试已覆盖。稳定归档晋级仍未实现 | `implemented` | `passed_limited` | 仍阻断按新规则新增稳定归档；候选生成须在干净提交且开发者工具目录逐文件一致时执行 |
| R04 | `approved` | 归档只有人工版本说明和ZIP SHA，未绑定代码、数据、解析器、审计器及CI运行 | 自动生成并校验 `release-manifest.json`，机器绑定Git SHA、数据身份、归档身份、解析器、审计器、CI和编译证据 | `not_started` | `not_tested` | 阻断可追溯稳定归档和精确恢复声明 |
| R05 | `not_approved` | 曾提出用受保护Git Tag或GitHub Release增强防篡改 | 不实施该备选方案；继续使用只读归档目录与同目录ZIP SHA-256规则 | - | - | 不是待办，不得新增为发布前置条件 |
| R06 | `approved` | Web声明与校验器仍为schema 1，只验证必填结构、`passed`和时间格式，不绑定具体构建，旧声明可被用于新构建 | schema 2绑定精确提交、规范化构建哈希、数据版本和清单哈希、正式域名、证据索引及有效期 | `partial` | `not_tested` | 阻断把当前 `release:check` 结果描述为构建级发布证明 |
| R07 | `approved` | README曾写08:07至17:37每30分钟，与实际09:27至10:30集中检查及12:00/16:00补查冲突 | 具体时间只在自动更新规范维护，README只引用；CI规范化比较规范与工作流时间集合 | `partial` | `not_tested` | 文档冲突已消除，CI漂移门禁尚未实现 |

### 当前实现依据与关闭条件

| ID | 当前实现依据 | 仍需关闭证据 |
| --- | --- | --- |
| R01 | `apps/miniprogram/config/version.js`；三份 `MINIPROGRAM_V2_4_1_*` 当前未执行模板；`v2.4.0`未执行模板和`v2.3.0`记录均为历史证据 | 精确提交 `cdea2207ff8f570aa1d8725ea474f22df30f26c8` 的自动审查、开发者工具编译/上传、Android和iPhone结果、平台状态及完整交接均通过 |
| R02 | `.github/workflows/full-auto-update-replay.yml` 和 `docs/MINIPROGRAM_V2_4_1_FULL_CLOUD_REPLAY_20260802.md`：`main@53ac616` 的云端运行 `30752209300` 已从第1轮连续通过12轮普通月度隔离回放；每轮验证560条新增、历史零变化、两类错误候选上传前阻断、72个数据对象加1个控制对象回读、完整70城客户端启用和切城零下载。生产指针和正式目录未触及，自动发布仍关闭 | 独立历史修订12轮故障报告，绑定当前解析器、审计器、工作流SHA和真实云端运行；另需适用的云函数、开发者工具和双真机证据 |
| R03 | `scripts/miniprogram/deterministic-candidate.mjs`、`deterministic-candidate.test.mjs`、`package.json` 的 `miniprogram:candidate` 命令；本地定向测试6项、全量小程序测试296项通过；已从干净精确提交`3b84e9a293e18fbd960328be243e0e84f18612a1`生成36文件的`v2.4.2`候选，并两次独立回读为相同ZIP/清单哈希 | 在另一环境复现相同候选SHA-256；随后实现原字节晋级和稳定归档记录 |
| R04 | 现有 `release/miniprogram/v2.0.*` 只有ZIP、版本说明和 `SHA256.txt` | 清单生成器、schema校验器、身份冲突故障测试和首个完整新格式归档 |
| R05 | 用户明确不同意 | 无；保持现状，除非未来取得新的明确决定并使用新决策记录 |
| R06 | `release/attestations.json` 与 `scripts/release-readiness.mjs` 当前固定schema 1 | schema 2实现及提交/构建/数据/域名/证据/有效期的正反向自动测试和一次真实发布候选验证 |
| R07 | `README.md` 已只引用权威规范；`MINIPROGRAM_DATA_UPDATE.md` 已集中时间表；工作流当前实际时间与表一致 | CI从规范和工作流分别解析规范化时间集合、证明相等，并用漂移fixture证明不一致时失败 |

## D01-D20 登记

| ID | 当前问题 | 已批准目标 | 权威规范落点 | 实现状态 | 验证状态 | 当前阻断 |
| --- | --- | --- | --- | --- | --- | --- |
| D01 | 候选指针可能先切换，守卫失败且无安全回退目标时无法保证线上指针不变 | 全部正确性检查、远端回读和逐值重建在切指针前完成；无安全回退目标禁止切换；失败时原指针字节和哈希不变 | `MINIPROGRAM_DATA_UPDATE.md`“自动生成与发布”“受保护发布与回滚” | `partial` | `not_tested` | 阻断生产自动发布 |
| D02 | 历史修订激活后重跑时，新旧来源判断不唯一 | 建立 `old_active`、`candidate_active`、`conflict` 三态及每个中断点的幂等恢复规则 | `MINIPROGRAM_DATA_UPDATE.md`“受保护发布与回滚” | `partial` | `passed_limited`（本地三态和不完整身份冲突测试） | 仍缺真实云端全部中断点恢复证据，阻断历史修订发布 |
| D03 | 独立审计未绑定即将发布的完整候选内容 | 审计报告和门禁绑定完整标准记录哈希、完整来源索引哈希及精确提交 SHA | `DATA_CONTRACT.md`“版本身份与独立审计” | `partial` | `not_tested` | 阻断生产自动发布 |
| D04 | 未证明 `revisions.json` 只做了准确追加 | 校验旧账本前缀、前后哈希、本次新增集合和 `supersedes_revision_id` 连续性 | `DATA_CONTRACT.md`“修订记录” | `partial` | `not_tested` | 阻断历史修订发布 |
| D05 | `revision_type` 同时被当作发布类别和错误原因 | 发布类别固定使用 `release_type=historical_correction`；原因使用独立 `reason_type` 枚举 | `DATA_CONTRACT.md`“修订记录”；`MINIPROGRAM_DATA_UPDATE.md`“修订申请与证据” | `partial` | `not_tested` | 阻断历史修订发布 |
| D06 | 数据版本哈希未定义完整业务字段输入 | 定义规范化序列化和哈希字段全集；任一业务字段变化必须产生新版本 | `DATA_CONTRACT.md`“版本身份与独立审计” | `partial` | `not_tested` | 阻断生产自动发布 |
| D07 | 单一 `source_batch_ids` 可能漏记被修订的历史批次 | 分开记录最新月份批次和全部历史修订批次，并与逐项差异双向核对 | `MINIPROGRAM_DATA_UPDATE.md`“清单契约”“修订申请与证据” | `partial` | `not_tested` | 阻断历史修订发布 |
| D08 | 客户端结构校验不足以证明身份、城市资料、数值和派生结果正确 | 精确验证版本月份、发布日期、国家统计局URL、70城集合及 `name/search/province/tier/tierLabel` 城市资料、有限数/允许的 `null`、连续月份和趋势原始序列，并逐月重算温度所用涨平跌缺失计数、排名和累计结果 | `MINIPROGRAM_DATA_UPDATE.md`“下载与原子启用” | `implemented` | `passed_limited`（本地完整快照正反向测试） | 仍需当前精确候选CI、真实云端包和双真机证据 |
| D09 | 客户端落盘后的逐文件回读和崩溃边界证据不足 | 临时目录写入完成后逐文件回读大小、哈希和版本；全部通过才单次切活动状态 | `MINIPROGRAM_DATA_UPDATE.md`“下载与原子启用” | `implemented` | `passed_limited`（本地写后回读、改名后损坏和状态提交失败测试） | 仍需真机文件系统及崩溃恢复证据 |
| D10 | 无正确数据时仍可能让全 `null` 快照进入正常计算；本轮曾把完整内置快照在无控制状态时误判为无正确数据 | 使用真正的运行时 `unavailable` 状态，禁止排名、平均、温度、趋势、累计及市场结论，只保留说明、重试和来源入口；随包审计快照是独立可信基线，只有自身校验失败或命中已知撤销且无安全替代时才不可用 | `PRODUCT.md`“不可用数据状态”；`DATA_CONTRACT.md`“数据清单”；`ACCEPTANCE.md`“功能” | `implemented` | `passed_limited`（本地首次安装、清储、离线、控制过期、远程损坏、已知撤销及页面启动回归） | 仍需微信开发者工具、真实云函数及Android/iPhone验证 |
| D11 | 人工回滚只验证清单，未验证完整目标版本 | 回滚前完整下载并验证清单、bootstrap、70城兼容分片、修订文件、派生结果、兼容性和当前撤销登记，再生成新指针 | `MINIPROGRAM_DATA_UPDATE.md`“回滚规范” | `partial` | `passed_limited`（本地完整包、数据包/源版本同代次双重撤销、不可变Intent、切换后只读审计恢复、损坏目标、冲突阻断、受保护工作流和双开关授权测试） | 仍缺对象级CAS、真实GitHub跨运行Artifact恢复、受保护Environment及真实云端中断/回滚证据，阻断生产自动发布 |
| D12 | 活动指针、撤销列表和缓存状态分开保存时可能产生数据指针分裂，单一主状态写入失败又可能丢失刚取得的撤销 | 使用单一带版本号的主状态原子保存活动版本、源版本、缓存、检查及完整控制状态；另以不含任何数据指针的只增控制墓碑先行保存最近受信控制和撤销，启动合并较新代次，既避免缓存双指针又防止主状态失败后复活已撤销数据 | `MINIPROGRAM_DATA_UPDATE.md`“本地状态事务与缓存保留” | `implemented` | `passed_limited`（本地schema迁移、主状态/墓碑独立失败、合法新旧代次合并、安全回退和重启测试） | 仍需真机存储失败和崩溃恢复证据 |
| D13 | 清除本地存储后会丢失曾持久化的撤销记忆，且无法可靠区分首次安装离线和清储后离线 | 随包审计快照是独立可信基线；首次安装/清储/控制状态过期或暂不可得时可在自身校验后使用，并立即或恢复联网后刷新控制面。已持久化或在线取得的撤销必须单调生效；控制过期不得授权新远程切换，但不单独触发 `unavailable` | `MINIPROGRAM_DATA_UPDATE.md`“检查频率”“失败与降级” | `implemented` | `passed_limited`（本地首次安装、清储、离线、控制/回执过期及撤销单调性测试） | 仍需真实云函数部署、前后台和Android/iPhone验证 |
| D14 | 失败半包、崩溃后孤儿目录和长期累积的本地旧版本缺少统一清理 | 失败回调删除临时包；每次启动按单一本地状态幂等清理未引用临时/孤儿目录；成功后只保留活动版本和一个未撤销且已验证的安全回退版本；删除失败必须显式返回失败 | `MINIPROGRAM_DATA_UPDATE.md`“本地状态事务与缓存保留” | `implemented` | `passed_limited`（本地临时/孤儿清理、删除失败和三版本保留测试） | 仍需真机文件系统和进程中断证据 |
| D15 | 历史修订未证明自动进入统一私有审计和24小时监测 | 月度发布与历史修订使用同一发布登记；修订切换成功后自动触发同一只读监测并绑定修订身份 | `MINIPROGRAM_DATA_UPDATE.md`“统一发布登记与监测” | `partial` | `passed_limited`（本地统一选择器覆盖普通发布、人工修正版、历史修订和回滚审计及24小时边界） | 仍缺真实GitHub定时触发、私有审计索引和故障通知闭环，阻断历史修订发布 |
| D16 | 私有审计仍按单月份/单组原始文件假设收集证据 | 按全部 `revision_source_batch_ids` 收齐并验证原始归档、URL、SHA和恢复结果 | `DATA_CONTRACT.md`“来源批次”；`MINIPROGRAM_DATA_UPDATE.md`“修订申请与证据” | `partial` | `not_tested` | 阻断历史修订发布 |
| D17 | 中国法定工作日配置只覆盖2026年 | 每年使用可追溯官方配置；下一年未发布时标记 `waiting_for_official_calendar`，只限制跨年 SLA | `DATA_CONTRACT.md`“更新SLA”；`MINIPROGRAM_DATA_UPDATE.md`“长期维护职责” | `partial` | `not_tested` | 2027年前必须关闭 |
| D18 | 只发现新月份，不定期检查官方历史页面变化 | 定期复核历史官方 URL 和哈希；变化只创建隔离修订任务，不直接改数据或指针 | `DATA_CONTRACT.md`“采集流程”；`MINIPROGRAM_DATA_UPDATE.md`“历史页面复核” | `not_started` | `not_tested` | 不得声称可自动发现历史修订 |
| D19 | GitHub任务失败没有接收人、确认时限和恢复闭环 | 使用去重 Issue 或等价渠道，记录负责人、时限、状态、故障指纹和恢复证据 | `MINIPROGRAM_DATA_UPDATE.md`“通知闭环” | `partial` | `not_tested` | 不得声称无人值守运维闭环 |
| D20 | Web和小程序分别计算排名、涨跌计数和累计变化 | 先建立绑定SHA-256的版本化输入、独立期望结果和完整筛选/边界矩阵的跨平台逐值一致测试，再逐步迁入共享核心；页面结果和交互保持不变 | `PRODUCT.md`“跨平台计算一致性”；`ACCEPTANCE.md`“工程与复现” | `partial` | `not_tested` | 阻断共享计算逻辑重构 |

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
| D16 | `scripts/miniprogram/publish-private-audit.mjs`、`.github/workflows/historical-data-correction.yml` | 已有私有审计，未证明多修订批次精确全集 |
| D17 | `scripts/data/fetch-release-calendar.ts`、`scripts/data/status.ts` | 已有日程和状态逻辑，年度法定工作日来源及跨年边界未闭合 |
| D18 | - | `scripts/data/discover-historical.ts` 不等于定期历史页面哈希复核闭环 |
| D19 | `.github/workflows/monthly-data-auto-publish.yml`、`monthly-data-post-publish-monitor.yml` | 已有运行状态和摘要，未形成接收人、确认时限和恢复闭环 |
| D20 | `apps/web/src/App.tsx`、`apps/miniprogram/pages/index/index.js`、`packages/core/src/index.ts` | 已有两端计算及有限共享代码，尚无版本化跨平台oracle矩阵 |

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
| I08 | “无人值守”、有人监督、SLA层级、生产开关和带日期云端记录表达不统一 | 当前统一为 `automation_disabled`；仓库总开关使用 `AUTOMATIC_RELEASE_ENABLED`，生产Environment授权使用 `PRODUCTION_RELEASE_AUTHORIZED`，启用条件只引用统一硬门槛；满足正确性硬门槛但D19未关闭时才可称 `supervised_automation`，D19关闭后才可称 `unattended_automation`。10-25分钟为正常预期、30分钟为内部SLO、45分钟为预警、60分钟为正式SLA目标；带日期云端记录只证明当时状态。现有10:30后仅12:00/16:00补查不能覆盖任意可访问时点的60分钟目标，必须如实登记 | 补充C02保留决定、D17、D19、V02、V04、V10、V16 | `implemented`（术语与门槛文档） | `passed_limited`（SLA调度覆盖未通过；2026-07-31现场开关为仓库`false`、Environment未设置） | 否 |
| I09 | 每次检查后的状态部署与只读发现边界缺少责任流程 | 只读发现只能产出报告；用户可见 `data_status` 变更必须经独立受保护状态部署作业，递增控制代次、保持数据身份和撤销身份并回读验证；未实现时由维护人按监督流程处理 | 补充D01、D19 | `partial` | `not_tested` | 未来只影响数据状态提示 |
| I10 | 候选身份要求稳定归档清单，而稳定归档又要求全部候选证据，形成循环依赖 | 先生成不可变候选构件并固定ZIP/清单哈希，外部验收全部绑定该构件；通过后把原字节晋级到稳定归档，不重新打包。确定性候选生成器和基础自动测试已实现；原字节晋级、最终`release-manifest.json`和跨环境证据仍未实现 | 补充R03-R04及V05；不采用R05方案 | `partial` | `passed_limited`（本地工具和295项小程序测试） | 否 |
| I11 | 小程序来源页和授权说明没有完整披露模糊位置处理、本地匹配城市缓存及保留边界 | 来源页和`app.json`披露模糊位置、项目云函数、腾讯位置服务、不持久化经纬度和本机`cityId/locatedAt`最长24小时；两条读取路径删除过期/无效缓存，来源页清除全部相关本地记录；平台隐私指引和双真机仍须核对 | 补充C03及V01 | `partial` | `passed_limited`（本地源码与定向测试） | 最小披露文案和错误态已变化，不改变正常定位功能或页面布局 |
| I12 | 生产信任链曾使用可移动Action标签；当前本地工作流已固定完整SHA，普通GitHub CI `30736720927` 已通过，但受保护Environment执行尚未复核 | 所有可接触生产Secrets或承接其Artifact的外部Action固定40位commit SHA；更新走审查和依赖更新流程，标签仅可写在注释中 | 补充D19、V17及权限安全 | `implemented` | `passed_limited`（本地机器扫描、失败fixture和普通CI） | 否 |
| I13 | 平台显示文案矩阵遗漏Web页面/OG标题、系统分享标题、两端栏目、导航和区块名称 | 按当前源码分别登记Web页面/OG标题、系统Share API标题及两端其他显示文案，允许平台和使用位置存在当前差异，不要求统一文案 | 补充品牌与术语治理及V08 | `implemented`（文档矩阵） | `passed_limited`（只读核对） | 否 |
| I14 | 小程序版本号在多个入口文档硬编码，缺少漂移门禁 | `apps/miniprogram/config/version.js` 是唯一机器版本源；当前快照文档可保留版本号，但未来CI必须校验入口、候选证据文件名和身份字段一致，历史文档不自动替换 | 补充R01 | `not_started` | `not_tested` | 否 |

I02在当前本地候选已有共享验证器和有限故障测试，登记为 `implemented/passed_limited`；I03已有历史修订三态、双重撤销、一般legacy拒绝、唯一正向迁移、写前验证器身份预检、写后严格动态回执和客户端历史回放的本地实现与定向测试，因此登记为 `implemented/passed_limited`；其 `implemented` 只表示本地实现范围，不表示生产已迁移。I01的内置基线信任回退已经最小修复，当前为 `partial/passed_limited`。三项仍缺云函数部署、受保护生产迁移/真实云端回滚、开发者工具或双真机证据，不能据此宣称已部署、已迁移或关闭生产阻断。I09仍只有只读发现和状态字段基础，独立受保护状态部署作业不存在，保持 `partial/not_tested`。I10的候选生成基础工具和自动测试已实现并通过本地验证，但原字节晋级、最终发布清单和跨环境证据仍未完成，因此保持 `partial/passed_limited`。

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
| I09 | `MINIPROGRAM_DATA_UPDATE.md` | 独立状态部署工作流、最小权限、回读及失败保持原指针测试 |
| I10 | `MINIPROGRAM_VERSIONING.md`、当前版本审查/真机/交接模板 | 确定性候选构件工具、原字节晋级、`release-manifest.json`生成/校验、身份漂移和重复构建测试仍按R03-R04关闭；文档模型不能作为实现证据 |
| I11 | `MINIPROGRAM_LOCATION_SETUP.md`、`MINIPROGRAM_LAUNCH_PREP.md`、`ACCEPTANCE.md` | 来源页、`app.json`、过期/无效缓存删除及本地测试已完成；仍需微信平台隐私指引现场回读和Android/iPhone真机核对 |
| I12 | `MINIPROGRAM_DATA_UPDATE.md`、`AUTOMATION_ACTIVATION_CHECKLIST.md` | 已有本地完整SHA扫描、可移动标签失败fixture和普通CI `30736720927`；仍需受保护Environment真实执行及一次受审依赖升级证据 |
| I13 | `PRODUCT.md` | 当前源码只读核对；未来文案变更须同步矩阵 |
| I14 | `AGENTS.md`、`DOCUMENT_INDEX.md`、`MINIPROGRAM_VERSIONING.md` | 版本漂移检查脚本、CI正反向测试及一次升版演练 |

## V01-V12 规范治理复核登记

本组来自2026-07-30只读复核并经用户全部批准。最初只修正规范、状态登记和验收模板；2026-07-31用户进一步批准实施V01和V07，因此两项已更新为本地候选状态。表中的本地有限通过不代表微信平台、云端、真机或生产能力已经完成。

| ID | 规范治理范围 | 本轮处理 | 实现状态 | 验证状态 | 页面或代码边界 |
| --- | --- | --- | --- | --- | --- |
| V01 | 定位披露和缓存边界 | 来源页和`app.json`已披露模糊位置处理链与本机缓存最长24小时；启动和点击定位均删除过期/无效记录，来源页清除全部相关本地状态 | `partial` | `passed_limited`（本地源码与定向测试） | 未修改微信平台配置；双真机未验证 |
| V02 | 自动发布最终门槛 | 把正式发布、线上版本回读、正式版完整70城远程读取、交接证据和维护人最终授权列为开关前置 | `implemented`（文档门槛） | `passed_limited`（只读文档核对） | 不开启开关，不执行发布 |
| V03 | 产品状态分类 | 增加`partial`并拆分当前能力、有限实现、已批准未实现、候选和不做范围 | `implemented`（文档分类） | `passed_limited`（只读文档核对） | 不改变当前产品或页面 |
| V04 | 生产开关名称和门槛来源 | 仓库总开关统一为`AUTOMATIC_RELEASE_ENABLED`，生产Environment授权统一为`PRODUCTION_RELEASE_AUTHORIZED`；`AUTOMATION_ACTIVATION_CHECKLIST.md`仍是完整启用硬门槛唯一来源，其他文档只引用或登记状态；保留C02既定SLA起点 | `implemented`（文档与代码名称一致） | `passed_limited`（2026-07-31现场回读仓库`false`、Environment未设置，均失败关闭） | 未开启生产授权或执行生产操作 |
| V05 | I10状态真实性 | 保持两阶段候选/归档边界；候选生成基础工具已实现，但原字节晋级、最终发布清单和跨环境证据仍由R03-R04关闭且不恢复R05 | `implemented`（状态修正与工具状态登记） | `passed_limited`（文档和本地测试核对） | 未生成可验收候选或稳定归档 |
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
| `2026-07-29-R02-user-approved` | 2026-07-29 | R02 | `approved` | - | 当前版本分别执行普通月度12轮和历史修订专项回放；本轮不运行云端回放 |
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
| D18 | `approved` | - | - | - | 历史页面哈希变化隔离任务测试 |
| D19 | `approved` | - | - | - | 通知去重、确认超时和恢复闭环演练 |
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
