# 数据契约

## 范围与时间

- 数据集覆盖：2016年1月至数据清单声明的最新统计月份。
- 默认范围：包含最新月份的最近120个统计月份。
- 近3年为36个月、近5年为60个月、近10年为120个月，均包含最新月份。
- 房屋类型：`new`、`resale`。
- 面积段：`all`、`le90`、`90_144`、`gt144`，分别对应国家统计局原表的全部面积、90平方米及以下、90-144平方米、144平方米以上。
- 温度历史是从每月70城官方指数计算上涨/持平/下跌/缺失城市数的派生数据，不是国家统计局发布的单独指标；四类计数在每个口径下合计70。

稳定城市标识覆盖国家统计局完整70城，由 `packages/core/src/index.ts` 作为应用内权威城市目录维护。北京、上海、广州、深圳、厦门、福州标记为首页常用六城，但数据校验和趋势选择不得只限于这六城。城市中文名、完整拼音及拼音首字母别名必须映射到同一稳定 `city_id`。

官方入口：

- https://www.stats.gov.cn/sj/zxfb/index.html
- 示例：https://www.stats.gov.cn/sj/zxfb/202607/t20260715_1964115.html

## 统计口径

国家统计局发布的是价格指数，不是房屋单价：

```text
mom_change = round(mom_index - 100, 1)
yoy_change = round(yoy_index - 100, 1)
```

- 使用十进制定点数，不用二进制浮点数严格相等做校验。
- 官方发布的 `100.0` 是有效值，表示无变化。
- 空单元格、破折号或无法解析的内容保存为 `null`，记录对应缺失原因，不转换成0或100。
- 正数展示 `+`，负数展示 `-`，零展示 `0.0%`。
- 调查范围为市辖区，不包括县。
- 某城市当月无成交时，保留官方发布的无变化结果，不自行改写。
- 2026年1月起使用2025年为新一轮对比基期并调整分类权数；其他制度变化也必须记录并标注。
- 不得把指数描述为平均房价或每平方米价格。

## 官方表格白名单

每个统计月份只允许从国家统计局“70个大中城市商品住宅销售价格变动情况”中的以下四类表生成生产记录：

1. `YYYY年M月70个大中城市新建商品住宅销售价格指数`。
2. `YYYY年M月70个大中城市二手住宅销售价格指数`。
3. `YYYY年M月70个大中城市新建商品住宅销售价格分类指数`。
4. `YYYY年M月70个大中城市二手住宅销售价格分类指数`。

历史页面允许使用国家统计局同口径旧标题：总体表可能省略“销售”，写作“新建商品住宅价格指数”或“二手住宅价格指数”；分类表可能写作“新建商品住宅分类价格指数”或“二手住宅分类价格指数”。标题差异不得改变 `property_type`、`size_band` 或指标列映射。

除上述四类及其明确历史标题变体外，其他表一律不得采纳。尤其禁止采纳“70个大中城市新建住宅价格指数”、15城或热点城市对比表、价格变动对比表、说明性表格及无法明确识别口径的表格。遇到新标题、标题缺失、结构冲突或多个候选表时必须失败关闭并停止发布，不得按表格先后顺序猜测。

页面中的电脑版、移动版或打印版重复表，以及历史分类表的“（一）（二）”拆分，只是物理HTML结构差异，不增加统计口径。重复唯一键仅在表类型相同且所有指标值一致时允许去重；值不一致时必须停止发布。每月最终必须得到：新建商品住宅总体70条、二手住宅总体70条、新建商品住宅三个面积段210条、二手住宅三个面积段210条，合计560条。

解析器和独立审计器必须分别执行四类表白名单。独立审计必须逐条确认来源表类型、总体/分类属性、城市、指标列和原始单元格值；旧审计报告不得沿用。解析器升级后必须全量重解析全部历史月份，按唯一键比较统计值并生成修订记录，不得只抽查最新月份。

2026年7月历史复核曾发现：旧解析器未识别“价格分类指数”标题，并依赖表序推断，导致2018年3月至12月15个城市的150条新建商品住宅总体记录被后续非目标表覆盖。回归测试必须永久覆盖“新建住宅”与“新建商品住宅”并存且顺序互换、`价格分类指数`与`分类价格指数`两种标题、重复表及冲突唯一键；不得删除或弱化这些断言。
- 不默认根据月度环比生成长期绝对价格曲线。
- 如提供累计推算，必须标注为本站计算，并说明舍入和基期变化误差。

累计变化图使用所选时间范围首月作为比较基准，不表示实际房价：

```text
cumulative_index[0] = 100
cumulative_index[t] = cumulative_index[t - 1] * mom_index[t] / 100
```

- 计算始终使用同一住宅类型的月度环比指数，不使用同比连乘。
- 内部计算不逐月舍入，展示时按公共数字格式化规则舍入。
- 首月只是归一化起点，因此不把首月相对上月的环比变化计入所选区间累计值。
- 任一后续月份的 `mom_index` 缺失时，该月及之后的累计值为 `null`，不得跳过缺口继续连乘。
- “较高点”采用截至当前月份的历史回撤口径：`peak[t] = max(cumulative_index[0...t])`，`drawdown[t] = (cumulative_index[t] / peak[t] - 1) * 100`。创新高月份为 `0.0%`，不得使用未来月份的高点计算当前月份。
- 页面必须标注“起点100为比较基准，不是实际元/㎡房价”，不得使用人民币符号。

## 标准记录

```text
stat_month             统计月份，YYYY-MM
release_date           官方发布日期，YYYY-MM-DD
city_id                稳定城市标识
city_name              城市中文名
property_type          new或resale
size_band              all、le90、90_144或gt144
mom_index              环比原始指数
yoy_index              同比原始指数
ytd_avg_index          年内累计平均指数，可为空
ytd_period_start       累计平均起始月份，可为空
ytd_period_end         累计平均结束月份，可为空
ytd_comparison_base    累计平均比较基准，可为空
mom_change             环比变动率
yoy_change             同比变动率
mom_missing_reason     环比缺失原因，可为空
yoy_missing_reason     同比缺失原因，可为空
ytd_missing_reason     累计平均缺失原因，可为空
source_url             官方页面或官方依据链接
source_type            official-html或official-derived-bootstrap
source_batch_id        来源批次标识
source_record_locator  原文件中的表格、工作表、行号或等价定位信息
fetched_at             ISO 8601抓取时间
methodology_version    统计口径版本
parser_version         解析器版本
```

唯一键为 `stat_month + city_id + property_type + size_band`。城市名称解析时清理全角空格、不换行空格和字符间空格，`city_id` 不直接依赖页面显示文本。

字段不变量：

- `mom_index`、`yoy_index` 和 `ytd_avg_index` 允许为 `null`。
- 指标值为 `null` 时，对应的 `*_missing_reason` 必须非空；指标值非空时，对应缺失原因必须为 `null`。
- `mom_change` 在且仅在 `mom_index` 非空时有值；`yoy_change` 在且仅在 `yoy_index` 非空时有值。
- `fetched_at`、`generated_at`、`imported_at` 等时间戳统一使用UTC ISO 8601并带 `Z`；`release_date` 使用中国大陆官方发布日期 `YYYY-MM-DD`。

`ytd_avg_index` 表示当年1月至 `stat_month` 的平均指数，比较基准通常为上年同期=100。必须根据官方表头填写期间和基准；面积分类表没有该项时保存为 `null`。

## 数据清单

每次生成发布数据时同时生成清单：

```text
dataset_as_of       最新统计月份
schema_version      JSON结构版本，SemVer
dataset_version     本次数据集唯一版本
release_date        最新月份官方发布日期
generated_at        数据集生成时间
record_count        标准化记录总数
overview_data_url   六城最近12个月摘要的版本化地址
overview_record_count 六城摘要记录数
market_data_url     最新月份70城市场快照的版本化地址
market_record_count 市场快照记录数，当前固定为140
city_data_url_template 按城市分片地址模板，包含{city_id}
city_record_counts  70城各自分片记录数
coverage_start      覆盖起始月份
coverage_end        覆盖结束月份
source_counts       按source_type汇总
validation_status   passed或failed
parser_version      解析器版本
data_status         current、updating或stale
last_checked_at     最近一次检查官方发布列表的时间
latest_official_month 最近发现的官方统计月份
latest_official_url 最近发现月份的官方页面
status_reason       当前数据状态原因
next_check_due_at   下次最晚检查时间
coverage_gaps       显式缺月列表
```

发布目录固定包含：

```text
apps/web/public/data/manifest.json  数据清单，短缓存或no-store
apps/web/public/data/data.json      标准化发布数据，可按dataset_version长期缓存
apps/web/public/data/overview-<dataset_version>.json  六城最近12个月摘要
apps/web/public/data/market-<dataset_version>.json  最新月份70城新房/二手房总体记录
apps/web/public/data/cities/<city_id>-<dataset_version>.json  单城完整趋势分片
```

`market-<dataset_version>.json`只包含`dataset_as_of`月份、`size_band=all`、70城的新房和二手房记录，每个城市/住宅类型组合恰好一条，共140条。它用于计算涨平跌分布、全体/同级/省内排名和同级简单平均，不包含本站预先计算的热度分数。

`data.json` 和对应版本化全量文件用于审计、发布校验和离线复现，浏览器不得把它作为首屏数据源。Web端先读取 `manifest.json`，确认 `schema_version`、`dataset_version` 和 `data_status`，再读取六城摘要、市场快照和当前最多三座城市分片；添加城市时按需读取相应分片。小程序适配层使用同一清单语义，不直接拼接内部路径。

`coverage_gaps` 每项至少包含：

```text
stat_month
scope               受影响的城市、房屋类型或all
reason
detected_at
```

缺月只记录在 `coverage_gaps`，不得通过生成一条所有指标均为 `null` 的伪记录表达。页面中的“最新月份”必须读取 `dataset_as_of`，不得根据当前日期推测。前端启动时验证支持的 `schema_version`；不兼容时显示明确错误，不静默解析。

## 更新SLA

生产自动发布启用后，正常月份以国家统计局正式页面被发现的时间为起点，目标在60分钟内完成抓取、校验、构建、远端复核和指针切换。发生隔离异常时仍以官方发布日期次日起3个中国大陆法定工作日作为人工恢复上限。

- 自动化层未正式启用前继续采用可复现的人工更新流程；官方发布后3个工作日内完成抓取、校验、构建和发布。
- 自动化层启用后，正常月份无需维护人员电脑或人工确认；任何机器门禁失败时不得为了满足60分钟目标降低校验标准。
- 每月至少检查一次官方发布列表并登记检查时间和结果。
- `current`：`dataset_as_of == latest_official_month` 且未超过 `next_check_due_at`。
- `updating`：已发现更新月份，自动流水线正在运行，或异常已进入官方发布后3个工作日的人工处理期。
- `stale`：超过处理SLA、超过 `next_check_due_at` 未检查，或数据校验失败。
- 每次检查官方列表后都重新生成清单并部署；`updating` 或 `stale` 时页面显示截止月份和 `status_reason`，不得继续称为“最新数据”。
- 当前已增加预告驱动的只读月度发现与失败告警：`npm run data:release-calendar`优先读取国家统计局数据首页“发布日程”背后的结构化月度日历 `https://www.stats.gov.cn/sj/fbrc/index_fbrc.html`，并与年度发布日程 `https://www.stats.gov.cn/sj/fbrc/bnxxfb/` 逐月交叉核对日期、名称和 `9:30` 发布时间；单一入口不可用时允许使用另一官方入口，两个入口日期冲突时必须停止并告警。系统识别“商品住宅销售价格指数月度报告”“70个大中城市商品住宅销售价格变动情况”等唯一高置信名称；名称变化时按住宅、销售价格、指数或变动、70城或月度等核心含义受控匹配，同等候选一律停止并告警。月度日历中的历史占位 URL 只用于官方页面展示，不得作为正式数据来源。`npm run data:check-latest`及`.github/workflows/monthly-data-check.yml`只在相应预告窗口比较正式发布页的最新月份和当前发布清单，并生成审查报告。发布日程只用于调度，不能证明正式数据已经发布，也不能作为数据来源；发现任务不得直接发布线上数据。
- 微信小程序远程数据更新的目标流程为“只读发现、独立自动发布、全量门禁、原子切换、发布后守卫和失败自动回滚”；发现任务本身不得直接获得生产写权限。当前实现状态、云端目录、客户端缓存、权限、成本和回滚规则见 [小程序每月自动数据更新规范](MINIPROGRAM_DATA_UPDATE.md)。

## 采集流程

```text
官方发布列表
  -> 发现月度页面
  -> 保存原始HTML、来源和校验和
  -> 识别新房、二手房和面积表
  -> 提取完整70城
  -> 标准化和校验
  -> 生成平台发布数据与清单
```

约束：

- 从官方发布列表分页发现页面，不猜测文章URL。
- 使用标题和统计月份去重。
- 请求必须设置超时、重试上限、明确User-Agent和礼貌限速，不并发压垮官方站点；失败批次保留错误日志。
- 记录HTTP状态码、最终URL、重定向链和抓取时间；非2xx响应不得当作空数据成功处理。
- 指数和变动率必须是有限数字，禁止 `NaN`、无穷值和带单位的字符串；按官方显示精度保存，并按一位小数校验变动率。
- 根据标题、表头和字段结构识别表格，不依赖固定 `table` 序号。
- 使用结构化HTML解析器，不用整页文本正则提取数据。
- 原始HTML按URL和抓取时间保存，不覆盖旧快照，并保存内容校验和。
- 识别桌面版、移动版、打印版重复表格，以及合并单元格、脚注、全角空格和不换行空格。
- 历史页面按结构版本拆分解析器。

发布原子性：

- 先在临时版本目录完成全量解析、校验和清单生成。
- 任一城市、房屋类型、唯一键、来源或计算校验失败时，停止发布并保留上一个可用版本；不得生成部分月份或部分城市的“最新数据”。
- 所有校验通过后，以版本目录和清单整体切换到 `apps/web/public/data/`；切换过程不能暴露半套JSON。
- 发布后再次读取发布文件执行校验，确认文件内容与校验清单一致。
- `manifest.json` 使用 `Cache-Control: no-cache` 或等价策略；全量文件、摘要和城市分片使用包含 `dataset_version` 的版本化缓存，不能让旧缓存覆盖新清单。

测试数据要求：

- `tests/fixtures/` 至少覆盖每个已识别的历史页面结构版本、桌面/移动重复表格、合并单元格、脚注、全角空格和缺失值。
- 每个解析器版本至少有一组黄金输出和已知城市、月份、指标断言。
- 解析器升级时先运行旧fixture回归；黄金输出变化必须有修订说明，不得静默更新。

## 来源批次

所有记录，包括官方HTML和历史引导数据，都必须关联统一来源批次：

```text
source_batch_id
source_type             official-html或official-derived-bootstrap
source_url
fetched_at
raw_content_sha256
raw_archive_uri
parser_version
schema_version
verification_status
verification_method
```

官方HTML批次使用发布页面URL和原始HTML校验和。历史引导批次在上述字段之外记录引导文件来源、官方依据和核验信息。

原始文件保留策略：

- 来源批次元数据、校验和和修订日志提交Git。
- 原始HTML和引导数据原文件永久保留，但默认不提交Git；使用项目指定的对象存储或受控归档保存。
- `raw_archive_uri` 必须指向可访问的内部归档位置；没有归档URI的来源批次不能进入生产数据集。
- 本地路径按 `data/raw/YYYY-MM/<sha256>.html` 或等价确定性规则命名，并允许gzip压缩。
- 归档必须能通过 `source_batch_id` 恢复；迁移存储时校验SHA-256。
- 原始文件不得进入Web或小程序生产包，第三方引导数据不得公开再分发，除非其许可明确允许。

## 历史引导数据

所有月份均优先使用可获得的国家统计局原始HTML。2023年7月只作为初始采集工作中观察到的页面结构边界，不作为永久来源规则；每个月份必须在来源清单中记录是否存在官方HTML。无法获得早期原始HTML时，可以使用基于官方月报整理的引导数据，但必须标记为 `official-derived-bootstrap`。

每批引导数据登记：

```text
source_batch_id
dataset_source_url
official_basis_url
imported_at
raw_content_sha256
coverage_start
coverage_end
verification_status     unverified、sampled或verified
verified_record_count
verification_method
verification_notes
```

核验门槛：

- `unverified`：只能用于开发，不得进入预览或生产数据集。
- `sampled`：只能用于明确标记的内部预览，不得进入公开生产数据集。
- `verified`：完整70城的新房/二手房、环比/同比均已逐条与官方依据核对，才可进入生产数据集。

标准记录必须通过 `source_batch_id` 和 `source_record_locator` 反查原始批次及位置。找不到公开来源、官方依据或完整核验记录的数据不能进入生产数据集。

## 修订记录

标准化数据保留当前有效版本；任何同一唯一键的值变化都追加修订记录：

```text
revision_id
record_key              与标准记录唯一键完全相同
previous_value
revised_value
detected_at
source_batch_id
reason
supersedes_revision_id  首次修订时为空
```

修订记录不可变。重新生成标准化数据时不得删除既有修订；页面在第二阶段提供面向用户的修订历史。

## 导入校验

- 国家统计局完整70城全部存在，且城市标识与共享城市目录一致。
- 每座城市同时存在新房和二手房总体数据。
- 唯一键无重复。
- 指数可解析，变动率计算一致。
- 月份连续；缺失月份显式记录，不补0。
- 发布日期、统计月份和来源链接有效。
- `source_batch_id` 能解析到有效来源批次。
- 官方HTML批次的原始文件SHA-256与批次登记一致。
- 生产数据不得引用 `unverified` 或 `sampled` 的历史引导批次。
- 官方HTML批次进入生产前执行 `npm run data:audit`，逐批校验原文SHA-256、官方URL、标题月份、发布日期，并按“官方表格白名单”确认每条记录只来自四类允许表，再按 `source_record_locator` 将全部标准记录回查到原始表格单元格。重复表不得依赖后出现者覆盖前值；历史拆分分类表必须按标题和结构共同识别。审计报告保存为 `data/audit-report.json`。发布门禁只接受当前 `full-record-audit-v4` 方法，旧审计报告必须重跑。
- 新数据与已有记录冲突时生成修订日志，不静默覆盖。
- 缺失值、缺失原因和变动率满足字段不变量。
- `schema_version` 受当前构建支持，`dataset_version` 在每次发布中唯一。
- `dataset_version` 使用 `YYYY-MM` 加构建内容短哈希生成，同一版本内容必须得到同一版本号。
- `current`、`updating`、`stale` 的状态转换有单元测试覆盖边界日期和法定节假日。
- 发布记录数与数据清单一致，`validation_status` 为 `passed`。
