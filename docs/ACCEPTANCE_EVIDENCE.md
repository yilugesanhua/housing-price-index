# 第一阶段验收证据矩阵

审计日期：2026-07-19

状态说明：`已证明`表示当前工作区有直接代码、数据或自动化证据；`外部待验`表示无法在本Windows工作区独立完成，不能据此宣称公开上线完成。

## 数据

| 验收范围 | 状态 | 权威证据 |
|---|---|---|
| 完整70城、2016-01至2026-06、新房/二手房、四档面积、环比/同比完整 | 已证明 | `data/audit-report.json`：126批次、70,560条、覆盖2016-01至2026-06、`full-record-audit-v4`且result=passed；`npm run validate:data` |
| 36/60/120个月且包含最新月份 | 已证明 | `packages/core/src/index.ts`的`getWindowRecords`；`apps/web/tests/core.test.ts`；E2E的36和120个月断言 |
| 指数、变动率、null与缺失原因不变量 | 已证明 | `scripts/data/validate.ts`、`scripts/validate-data.mjs`、`apps/web/src/dataValidation.ts`及对应单测 |
| 唯一键、月份连续、coverage_gaps | 已证明 | `scripts/validate-data.mjs`、`scripts/data/publish.ts`；当前`manifest.json`的`coverage_gaps=[]` |
| 清单schema、版本、记录数、状态和检查时间 | 已证明 | `apps/web/public/data/manifest.json`；`scripts/validate-data.mjs`；前端运行时校验单测 |
| 首屏摘要、市场快照、温度历史与城市分片，完整数据不进入浏览器加载路径 | 已证明 | schema 1.3.0清单、576条六城摘要、560条最新月快照、2,016条温度历史、发布后校验及E2E请求断言 |
| 全部来源URL、抓取时间、SHA-256、四类表白名单、总体/分类、批次和记录定位 | 已证明 | 126个`data/raw/**/*.batch.json`；`data/audit-report.json`的`full-record-audit-v4`；`scripts/data/audit-batches.ts` |
| 原始归档可恢复且不进入生产包 | 已证明 | 126批次均有确定性`raw_archive_uri`并通过SHA-256回查；`apps/web/public/data/`仅有发布JSON |
| 生产不引用unverified或sampled批次 | 已证明 | 126/126批次为verified；`publish.ts`要求当前完整审计报告覆盖同一批次、SHA和记录数 |
| 修订不可变并保留旧值、新值和来源 | 已证明 | `data/normalized/revisions.json`当前保留36,792条追加修订；`publish.ts`追加修订而非覆盖，历史未删除 |
| 来源、月份、发布日期、状态、口径和2026-01基期变化 | 已证明 | 页面正文、Tooltip、0%线和2026-01时间轴标记；E2E断言 |
| 中国大陆工作日SLA状态边界 | 已证明 | `scripts/data/status.ts`、`scripts/data/status.test.ts`；当前清单为current |
| 月度官方页面自动发现与异常告警 | 已证明 | `scripts/data/fetch-release-calendar.ts`、`scripts/data/check-latest.ts`及针对性单测；`.github/workflows/monthly-data-check.yml`每天同步年度预告并在预告窗口检查正式发布页；预告只调度、只告警不自动发布 |
| 校验失败保留上一发布版本 | 已证明 | `scripts/data/atomic-publish.ts`；成功、首次发布和失败回滚3项单测 |
| 历史结构、重复表、合并表头、脚注、空值和空格fixture | 已证明 | `scripts/data/official-parser.test.ts`共4项黄金与已知值测试 |

## 功能与分享

| 验收范围 | 状态 | 权威证据 |
|---|---|---|
| 新房/二手房、环比/同比独立查看 | 已证明 | 分段控件、URL状态单测及E2E |
| 70城温度、同级和省内城市对比 | 已证明 | `getMarketPosition`单测覆盖涨平跌、并列排名、同级平均和福建排序；桌面/手机E2E覆盖新房20/1/49、二手房9/1/60、观察城市切换和省内样本说明 |
| 面积分档与70城温度历史 | 已证明 | schema 1.3.0发布四档面积共70,560条记录和2,016条温度历史；URL单测、数据校验及桌面/手机E2E覆盖面积切换、口径联动和Canvas非空 |
| 重点城市入口、全局口径导航和消费者摘要 | 已证明 | URL单测覆盖独立`focus`；桌面/手机E2E覆盖70城重点城市切换、自动加入趋势、唯一全局口径和三个锚点导航 |
| 累计图确定性渲染与紧凑单城市省内状态 | 已证明 | `TrendChart.tsx`直接初始化累计图并显示骨架；桌面/手机E2E检查Canvas绘制像素；最终截图确认省内单城市状态不再形成空白整列 |
| 70城中文/完整拼音/首字母搜索、分组和选择状态 | 已证明 | `packages/core/src/index.ts`城市目录与搜索别名；`App.tsx`桌面浮层和移动端底部面板；E2E搜索`wlmq`并加入乌鲁木齐 |
| 城市Sheet焦点进入、移动端圈定、关闭恢复和原生按钮语义 | 已证明 | `App.tsx`焦点/滚动管理；E2E验证搜索框自动聚焦及关闭后触发按钮恢复焦点 |
| 最多三城、0%线、缩放、拖动、图例和Tooltip | 已证明 | `TrendChart.tsx`；桌面鼠标与手机真实touchscreen Tooltip E2E |
| 零城市空状态、观察城市保留与重新添加 | 已证明 | `urlState.ts`空选择往返单测；桌面/手机E2E覆盖清空主图、保留观察城市和从空状态添加城市 |
| 拖动与按钮缩放状态同步、当前月份范围和至少一条可见线 | 已证明 | `TrendChart.tsx`的`datazoom`同步与图例保护；E2E验证按钮状态和范围文案 |
| 首月100的累计变化、环比复合与缺口停止 | 已证明 | `getCumulativeIndexSeries`共享计算及单测；`TrendChart.tsx`累计图、最新值和数据表累计列；桌面与手机E2E验证Canvas |
| URL恢复、v=1、无效值回退、空城市往返、三城截断和固定序列化 | 已证明 | `urlState.ts`、6项URL单测和E2E |
| 固定标题、描述和分享缩略图 | 已证明 | `index.html`；1200×630 PNG；E2E校验图片MIME、尺寸元数据和200响应 |
| 正式域名OG、canonical和纠错入口注入 | 已证明 | Vite正式构建配置；模拟HTTPS构建和浏览器检查；`scripts/release-readiness.mjs` |
| 公开数据无需账户或微信授权 | 已证明 | 应用无登录、支付、表单、分析或第三方SDK依赖 |
| 正式HTTPS域名下微信分享抓取 | 外部待验 | 需要正式域名后验证绝对`og:image` URL和微信抓取结果 |

## 响应式、无障碍与视觉

| 验收范围 | 状态 | 权威证据 |
|---|---|---|
| 320×720、375×812、384×824、390×844、768×1024、1366×768、1440×900及844×390 | 已证明 | Chromium与WebKit响应式E2E；320px粘性导航与重点城市摘要无水平溢出，所有视口Canvas非空、尺寸稳定 |
| 加载、失败重试和合法零记录空状态 | 已证明 | `states.spec.ts`在桌面与手机项目执行 |
| 微信弱网的摘要优先、趋势分片失败、离线恢复 | 已证明 | `App.tsx`分层加载、15秒请求超时、online/pageshow/visibilitychange重试；`home.spec.ts`桌面与手机E2E覆盖单分片失败和离线恢复 |
| 触控目标至少44×44且关键间距至少8px | 已证明 | 手机E2E逐项测量可见关键控件，并检查缩放与图例间距 |
| 键盘筛选、图例和focus-visible | 已证明 | 键盘Enter行为E2E及3px焦点环计算样式断言 |
| Tooltip等价数据表与月份选择器 | 已证明 | 语义表格、caption、表头、月份选择器及120项月份E2E |
| 涨红跌绿且不只依赖颜色 | 已证明 | 市场语义令牌、正负号、方向文字/图标、不同线型和图例标签；错误状态使用独立令牌 |
| 趋势口径持续可见 | 已证明 | 桌面粘性导航显示只读全局口径，手机粘性导航提供同一组快速筛选；E2E验证筛选后同步更新 |
| 文本4.5:1、图形3:1 | 已证明 | 令牌对比度复算：小号文字最低5.36:1；实际三条图表线及零轴均不低于3:1 |
| reduced-motion和页面缩放 | 已证明 | CSS媒体查询、ECharts运行时设置；viewport未禁用缩放 |
| Lighthouse Accessibility与最终截图 | 已证明 | `docs/lighthouse.json`为100；`docs/screenshots/`含手机和桌面最终截图 |
| Chrome与Edge正式渠道 | 已证明 | 本机Chrome 149、Edge 147生产预览冒烟：6卡片、无溢出、Canvas有效 |
| Android与iPhone微信真机 | 外部待验 | 必须分别在真机微信完成查看、筛选、触摸图表、分享和来源跳转 |
| 小程序共享状态与设计令牌产物 | 已证明 | `packages/core/src/index.ts`的`HousingViewState`与默认值；`packages/design-tokens/generate.mjs`生成`tokens.wxss`/`tokens.json`；`npm run design-tokens:check` |
| Safari正式版及浏览器前一稳定版矩阵 | 外部待验 | Windows无法运行正式Safari；当前仅有WebKit、Chromium和本机当前版Chrome/Edge证据 |

## 工程、合规与上线门槛

| 验收范围 | 状态 | 权威证据 |
|---|---|---|
| 发布目录、版本化缓存和前端清单优先读取 | 已证明 | `apps/web/public/data/`、`_headers`、`App.tsx`、运行时校验单测 |
| 可复现命令和CI | 已证明 | `README.md`、根`package.json`、`.github/workflows/ci.yml` |
| 最新Web Interface Guidelines审查 | 已证明 | 2026-07-19重新获取官方规则；`docs/DELIVERY.md`和`docs/audit/2026-07-19/audit-notes.md`记录结果 |
| 国家统计局归属、来源链接与免责声明 | 已证明 | 页面显著显示“数据引自国家统计局网站（www.stats.gov.cn）”；官方《服务条款》链接记录于`COMPLIANCE_REVIEW.md` |
| 正式纠错入口 | 外部待验 | 项目所有者需提供正式邮箱或客服入口 |
| 拟上线主体、域名和商业用途法律确认 | 外部待验 | 官方条款允许数据下载使用并规定归属，但后续付费用途边界需所有者或法律顾问确认 |
| 防止未完成外部验收误发布 | 已证明 | `release/attestations.json`保留未完成项；`npm run release:check`要求HTTPS、联系方式、双微信真机、浏览器矩阵和法律审查全部通过 |

## 结论

当前工作区的Web MVP工程项已形成直接证据。外部待验项完成前，只能描述为“本地Web MVP已通过工程验收”，不能描述为“第一阶段已公开上线”。
