# 项目交接文档

> 核验日期：2026-08-07；本地分支 `main`。本次GitHub交接整理前的本地基线为 `8690e0627967deb37bef6ef01ff944a0edc90947`，当时远端 `origin/main` 为 `0e43a5ff78ca19da4024edd0a57ba3ca511a1db3`；最终交接提交由标签 `project-handoff-2026-08-07` 标识。本文区分当前源码、历史证据和只读外部回查；未现场确认的状态均明确写为“未知”或“未验证”。

## 1. 项目概况

- 项目名称：70城住宅指数；微信小程序当前对外名称为“住房小二”。
- 项目用途：展示国家统计局70个大中城市的新建商品住宅和二手住宅价格指数，支持环比、同比、面积档、六城概览、70城比较和长期趋势。项目不展示或估算元/平方米价格，不解释涨跌原因，不提供投资建议。
- 主要技术：npm workspaces；Web为 Vite + React + TypeScript + ECharts；小程序为原生微信小程序 + wx-f2；数据工具为 Node.js + TypeScript + Cheerio；共享核心位于 `packages/core/`，设计令牌位于 `packages/design-tokens/`。
- 仓库位置：本机为 `C:\Users\user\Desktop\房产数据页面设计`；GitHub为 [`yilugesanhua/housing-price-index`](https://github.com/yilugesanhua/housing-price-index)。
- 当前分支：`main`；交接整理前本地提交和远端提交见页首核验说明，最终GitHub快照以交接标签为准。
- 最后更新时间：2026-08-07。

## 2. 本次交付结论

- 当前状态：**基本完成**。
- 已交付的核心功能：响应式Web、原生微信小程序、70城住宅指数展示、六城概览、城市搜索和最多三城趋势比较、市场位置分析、三类趋势图、官方数据采集/解析/审计/发布工具、版本化静态数据、远程完整数据包、受保护的月度发现/发布/监测/回滚工作流。
- 尚未交付或明确排除的内容：
  - 明确排除：住宅成交单价、涨跌原因分析、投资建议。
  - Web正式部署平台、正式域名及当前公开访问状态未知。
  - `v2.5.15` 尚无完整稳定归档；`release/miniprogram/` 当前只看到 `v2.0.0`、`v2.0.1`、`v2.0.2`。
  - 尚缺小程序平台构建号、审核通过时间、线上版本与候选提交/ZIP哈希的可复核绑定，以及双真机逐项原始截图或录屏。
  - D19通知接收人、确认时限和恢复闭环未关闭，因此不能称为无人值守自动化。
- 是否已部署：**部分部署**。仓库证据显示微信小程序 `v2.5.15` 已于2026-08-06上线，腾讯云远程数据曾通过正式只读监测；Web正式部署未知。本次没有执行任何部署或生产写入。
- 线上实际可用状态：
  - 小程序：有2026-08-06线上版本截图和维护人自检/双真机确认，但本次未登录微信公众平台或真机实时复核，当前实时状态未验证。
  - 远程数据：2026-08-06运行 `31102773256` 曾通过服务器端完整下载、校验和70城重建；本次未直接读取当前生产指针，当前实时数据状态未验证。
  - Web：正式访问入口和线上可用状态未知。
  - 自动更新：本次只读回查确认仓库变量 `AUTOMATIC_RELEASE_ENABLED` 和 `housing-data-production` Environment变量 `PRODUCTION_RELEASE_AUTHORIZED` 均为精确值 `true`；最新顶部登记将其称为 `supervised_automation`（有人监督自动化）。但同一套规则仍记录未关闭门槛和相反状态，当前启用状态是否满足仓库自己的硬门槛尚未闭环，生产写入前必须重新失败关闭核对。
- GitHub备份状态：`main` 已推送到提交 `473909335ac50a2e9ee1e5cf518741c4f5b5fc3c`，CI运行 [`31159637366`](https://github.com/yilugesanhua/housing-price-index/actions/runs/31159637366) 成功。交接Release附件的最终存在性、大小和SHA-256必须以 [`project-handoff-2026-08-07`](https://github.com/yilugesanhua/housing-price-index/releases/tag/project-handoff-2026-08-07) 页面及下载回读为准，不能由本文链接推断。
- 最终验收结论：核心源码、数据和当前提交CI有通过证据，可以有条件交接；由于Web上线状态、微信平台候选绑定、真机原始附件、`v2.5.15`稳定归档和无人值守通知闭环未完成，不能写为“全部完成”或“完整正式验收闭环”。

## 3. 已完成工作

### Web应用

- 做了什么：实现响应式70城住宅指数页面，包含六城概览、70城市场位置、城市搜索、最多三城趋势比较、环比/同比、新房/二手房、面积档、趋势与累计变化等功能。
- 相关文件或目录：`apps/web/`、`packages/core/`、`packages/design-tokens/`、`apps/web/public/data/`。
- 验证方式：交接文档整理前的源码提交 `0e43a5ff78ca19da4024edd0a57ba3ca511a1db3` 由 GitHub Actions `ci` 运行 `31141986025` 执行 `npm ci`、`npm run check` 和 `npm run test:e2e`。
- 验证结果：该次CI成功；Web单元测试18项通过，生产构建成功；Web E2E共40项，39项通过、1项按既有配置跳过。本次交接新增文档和工具备份的独立验证结果记录在第5节。

### 原生微信小程序

- 做了什么：实现“住房小二”原生小程序，展示70城数据、六城概览、城市筛选、70城温度、历史趋势、累计变化、分享、来源页、远程完整数据包校验/缓存/失败回退等能力。
- 相关文件或目录：`apps/miniprogram/`（唯一源码）、`70城小程序技术验证/`（开发者工具同步副本）、`scripts/miniprogram/`、`docs/MINIPROGRAM_VERSIONING.md`。
- 验证方式：机器版本源现场读取；当前提交CI；候选交接记录；微信公众平台截图；维护人确认。
- 验证结果：机器版本为 `v2.5.15`；当前CI中的小程序测试355项全部通过。候选提交为 `b854f8e6911986b556e45b760f27108596c24845`，40文件ZIP SHA-256为 `1bca26bf2255d85f9033337d5277f8f96cd7c7406e4bae55ff0ec4f56b9eaba4`。线上截图和维护人确认属于历史平台证据；本次未重新编译开发者工具、未重新连接Android/iPhone、未现场登录微信平台。

### 官方数据与发布数据

- 做了什么：建立四类官方表格白名单、历史标题变体识别、重复键冲突阻断、全量重解析、逐记录独立审计、修订账本和Web/小程序数据生成流程。
- 相关文件或目录：`scripts/data/`、`data/raw/`、`data/normalized/`、`data/audit-report.json`、`apps/web/public/data/`、`apps/miniprogram/data/`、`docs/DATA_CONTRACT.md`。
- 验证方式：结构化读取当前 `data/audit-report.json` 与Web数据清单，并核对当前提交CI日志。
- 验证结果：生产解析器 `official-html-v9-product-housing-only-strict-release-date`、独立审计 `full-record-audit-v7`，结果 `passed`；覆盖2011-07至2026-06，共180个月、100,800条记录。当前CI再次显示 `Validated 100800 records (current)`。

### 自动更新、监测与回滚

- 做了什么：建立月度发现、候选门禁、隔离云回放、受保护生产发布、待发布恢复、历史修订、发布后守卫、只读监测和人工回滚工作流。
- 相关文件或目录：`.github/workflows/`、`scripts/miniprogram/`、`data/releases/`、`docs/MINIPROGRAM_DATA_UPDATE.md`、`docs/AUTOMATION_ACTIVATION_CHECKLIST.md`、`docs/IMPLEMENTATION_STATUS.md`。
- 验证方式：本次只读查询GitHub变量与运行；未触发任何工作流。
- 验证结果：
  - 运行 `31137756505` 在提交 `60d3cb38f2bd47694aa1a7c78d674eeb1d1cfb79` 完成36个月普通月度隔离回放，GitHub状态为成功。
  - 运行 `31137756549` 在同一提交完成12轮历史修订回放，GitHub状态为成功。
  - 源码提交 `0e43a5ff78ca19da4024edd0a57ba3ca511a1db3` 的CI运行 `31141986025` 成功。
  - 2026-08-07本次回查时两个生产授权变量均为 `true`。
  - 当日定时发现运行 `31152416842` 成功；后续自动发布运行 `31152461910` 只完成检查，`prepare`和`publish`均跳过；监测运行 `31152478159` 只完成检查，`monitor`跳过。因此这组运行没有形成“本次已写入生产”的证据。
  - D19仍为 `partial/not_tested`，不能称为无人值守闭环。

### 规范、验收和交接证据

- 做了什么：形成产品、设计、数据、验收、版本、自动更新、实施状态和候选交接文档，并明确“源码、测试、部署、审核、发布、线上可用、稳定归档、自动更新”是不同状态。
- 相关文件或目录：`AGENTS.md`、`PRODUCT.md`、`DESIGN.md`、`docs/ACCEPTANCE.md`、`docs/DOCUMENT_INDEX.md`、`docs/IMPLEMENTATION_STATUS.md`、`docs/MINIPROGRAM_V2_5_15_RELEASE_HANDOFF.md`。
- 验证方式：本次逐项对照当前源码、Git状态、CI、GitHub变量和历史证据。
- 验证结果：主要证据可追溯；自动更新文档存在新旧状态冲突，已在第7节列为高优先级风险。

## 4. 变更文件

本次项目收尾和GitHub交接累计只修改文档、截图及个人工作流备份，没有修改、删除任何业务代码、业务配置、数据、小程序版本或部署环境。

| 文件路径 | 类型（新增/修改/删除） | 用途 | 是否已验证 |
|---|---|---|---|
| `HANDOFF.md` | 新增、修改 | 当前项目交接、验证边界、风险和维护入口 | 是；已对照仓库、Git、CI和只读外部状态 |
| `README.md` | 修改 | 增加同事或新电脑首次接手入口 | 是；命令、路径和链接已核对 |
| `docs/PROJECT_TRANSFER.md` | 新增 | GitHub下载、首次启动、文件边界、外部权限和大文件风险 | 是；已按当前仓库逐项盘点 |
| `docs/DOCUMENT_INDEX.md` | 修改 | 登记交接说明和已实现的个人工作流 | 是；链接已核对 |
| `docs/MINIPROGRAM_PROJECT_RETROSPECTIVE_AND_WORKFLOW.md` | 新增、修改 | 项目复盘、Bug、踩坑、教训和后续工作流 | 是；历史结论与当前状态边界已标明 |
| `docs/VERIFIED_DEV_WORKFLOW_SKILL_DESIGN.md` | 新增、修改 | 个人工作流设计与真实实现状态 | 是；已与全局安装文件和14项自测核对 |
| `docs/screenshots/city-picker-mobile.png` | 修改 | 复盘所用城市选择器手机截图 | 是；已目视检查，未发现账号信息；PNG未发现文本或EXIF元数据块 |
| `tools/codex-skills/verified-dev-workflow/` | 新增7个文件 | 可随GitHub迁移的个人Codex工作流源文件 | 是；与本机已安装版本逐文件SHA-256一致，未包含生成缓存 |

## 5. 启动、测试与构建

- 环境要求：Node.js 20或更高版本，npm workspaces。当前电脑现场读取为 Node.js `v24.16.0`、npm `11.13.0`。

### 清理后的首次使用

本次交接收尾已清理可重新生成的根目录 `node_modules/`、`apps/web/node_modules/`、`apps/web/dist/`，以及 `data/raw/` 下180份未压缩HTML本地缓存。开发服务已经停止；180份 `.html.gz` 官方来源档案和180份 `.batch.json` 批次复现文件均已保留。交接整理前Git跟踪834个文件，已读取文件合计至少615,679,058字节；包含中文路径的精确总字节数本次未验证，不用该统计判断下载完整性。

接手同事首次使用时，请在项目根目录依次运行：

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run dev
```

看到终端显示本地地址 `http://127.0.0.1:5173/`，即表示开发服务启动成功。

- 安装依赖：

```powershell
npm.cmd ci
npx.cmd playwright install chromium webkit
```

- 本地启动：

```powershell
npm.cmd run dev
```

需要后台持续预览生产构建时：

```powershell
npm.cmd run build
npm.cmd run dev:start
npm.cmd run dev:status
npm.cmd run dev:stop
```

默认本地入口：`http://127.0.0.1:5173/`。

- 测试命令：

```powershell
npm.cmd run check
npm.cmd run test:e2e
npm.cmd run test:miniprogram
npm.cmd run validate:data
```

- 构建命令：

```powershell
npm.cmd run build
```

- 实际执行结果：
  - 清理前执行 `npm.cmd run dev:status` 时，本地预览运行正常：`http://127.0.0.1:5173/`；交接清理时已停止当时的PID 3780，当前5173端口不再监听。
  - 源码提交 `0e43a5ff78ca19da4024edd0a57ba3ca511a1db3` 的GitHub CI运行 `31141986025` 成功：Web测试18项通过，数据测试59项通过，小程序测试355项通过，发布检查3项通过，100,800条数据校验通过，生产构建成功；E2E为39项通过、1项跳过。
  - 2026-08-07在本机 Node.js `v24.16.0`、npm `11.13.0` 环境从锁文件运行 `npm.cmd ci` 成功，安装393个包；`npx.cmd playwright install chromium webkit` 成功。
  - 本次交接工作区运行 `npm.cmd run check` 成功：Web测试18项、数据测试59项、小程序测试355项、发布检查3项全部通过，设计令牌一致，100,800条数据校验通过，生产构建成功。
  - 本次交接工作区运行 `npm.cmd run test:e2e` 成功：桌面Chromium和手机WebKit共40项，39项通过、1项按既有配置跳过。
  - 仓库备份中的 `verified-dev-workflow` 已现场运行14项自测，全部通过；7个源文件与本机安装版本逐文件SHA-256一致。
  - 小程序机器版本仍为 `v2.5.15`，版本文件无Git差异；源码与开发者工具副本的39个共同受控文件SHA-256一致，副本另有其受控 `package-lock.json`，两边 `project.config.json` 的AppID、项目名和基础库版本一致。
  - GitHub提交 `d1dc8131d4a20bd4f8c25f381543511a01a6303b` 已推送，CI运行 `31158204256` 成功完成 `npm ci`、`npm run check` 和 `npm run test:e2e`。
  - 第一次从公开HTTPS地址克隆时连接被重置且没有生成目录；强制HTTP/1.1后克隆成功，得到精确提交、842个受控文件和干净工作区。
  - 该普通Windows克隆继承全局 `core.autocrlf=true`，把两份设计令牌文件检出为CRLF，导致 `design-tokens:check` 失败；字节检查确认原文件为LF，克隆文件全部为CRLF，忽略行尾后无其他差异。README和 `docs/PROJECT_TRANSFER.md` 已改为首次检出前使用 `git -c core.autocrlf=false clone`，并在仓库本地持久化设置。
  - 按修正命令再次从公开HTTPS地址全新克隆成功：精确提交一致、842个受控文件、工作区干净、仓库本地 `core.autocrlf=false`，两份令牌文件SHA-256与原仓库一致；`npm.cmd ci`、Playwright浏览器安装和 `npm.cmd run check` 全部成功，E2E为39项通过、1项跳过。E2E后 `docs/screenshots/city-picker-mobile.png` 被测试按现有逻辑重写，功能测试没有失败；接手说明已增加测试后检查和有条件恢复截图的步骤。
  - 最终说明提交 `473909335ac50a2e9ee1e5cf518741c4f5b5fc3c` 已推送，GitHub CI运行 `31159637366` 成功完成全部步骤。
  - 本文提交时GitHub Release附件尚待生成、上传和下载回读；任务结束后的实际结果必须查看上面的Release页面和附件校验回执。该交接Release不等于小程序稳定归档、微信重新发布或生产数据写入。
- 尚未执行的验证及原因：
  - 已完成自动化桌面和手机浏览器流程，但未另做本轮人工视觉验收或新截图；本次没有界面改动。
  - 未重新编译微信开发者工具、未重新连接Android/iPhone：本次没有小程序构件改动，也没有取得新的设备现场证据。
  - 未登录微信公众平台复核线上版本：本次未执行平台操作；当前实时平台状态仍未验证。
  - 未读取当前腾讯云生产指针或主动回滚：避免无必要接触生产环境；只采用已有只读监测记录。

## 6. 部署与运行状态

- 部署平台或服务器：
  - Web：正式托管平台未知。
  - 小程序：微信公众平台；仓库历史记录的远程数据环境为腾讯云 CloudBase/COS/SCF，环境标识 `cloud1-d3gpdx70w5d05c68c`，本次未现场回读该云环境。
  - 自动化：GitHub仓库 `yilugesanhua/housing-price-index` 的 GitHub Actions 和 `housing-data-production` Environment。
- 当前环境：本地开发服务已停止，根目录和Web依赖及Web构建输出已清理；小程序有正式版历史上线证据；GitHub双开关当前为 `true`，最新顶部登记称为有人监督自动化，但其是否满足仓库全部启用硬门槛仍有文档冲突。Web正式环境未知。
- 部署步骤：
  - Web：先按 `docs/RELEASE_READINESS.md` 配置环境变量名 `VITE_PUBLIC_SITE_URL`、`VITE_CONTACT_URL` 和 `release/attestations.json`；域名来自正式HTTPS托管服务，反馈入口来自项目正式邮箱或客服页面。然后执行：

```powershell
npm.cmd run release:check
npm.cmd run build
```

  Web托管平台及其上传步骤尚未确定，不能补写。

  - 小程序代码：以 `apps/miniprogram/` 为唯一源码；客户端构件变化时先递增 `apps/miniprogram/config/version.js`，执行同步和检查，再用微信开发者工具打开 `70城小程序技术验证/` 完成编译、双真机、上传、审核、发布和稳定归档。详细步骤只按 `docs/MINIPROGRAM_VERSIONING.md` 执行。

```powershell
npm.cmd run miniprogram:sync
npm.cmd run test:miniprogram
npm.cmd run check
npm.cmd run test:e2e
```

  - 生产数据：正常月度更新由 `.github/workflows/monthly-data-check.yml`、`monthly-data-auto-publish.yml`、`monthly-data-pending-publish.yml` 和 `monthly-data-post-publish-monitor.yml` 受保护执行。不要在本地绕过门禁直接改生产指针。
- 域名或访问入口：
  - 本地：`http://127.0.0.1:5173/`
  - Web正式域名：未知。
  - 微信小程序：公众平台名称“住房小二”；没有可核验的通用网页URL。
  - GitHub仓库：`https://github.com/yilugesanhua/housing-price-index`
- 已确认可用的功能：清理前本地入口能响应并被健康检查识别为本项目页面；当前本地服务已停止，需按第5节步骤重新安装、构建和启动。当前提交CI、生产构建和Web E2E通过；小程序 `v2.5.15` 有历史上线、自检和双真机确认；正式远程数据有2026-08-06服务器端只读监测通过记录。
- 未确认项：Web正式部署；微信小程序当前实时状态；平台构建号和审核时间；候选与线上构件绑定；客户端远程包在弱网/中断/旧缓存下的原始真机记录；当前生产指针内容；无人值守通知闭环。
- 回滚方式：
  - Web：重新部署上一份已验证静态构建；当前正式托管平台和可用构建归档未知，因此具体平台步骤未知。
  - 小程序代码：按微信平台可用的历史版本和 `docs/MINIPROGRAM_VERSIONING.md` 执行；`v2.5.15`尚无稳定归档，当前可回退构件边界未验证。
  - 远程数据：仅使用受保护的 `.github/workflows/manual-data-rollback.yml`，目标必须有符合资格的不可变审计，并按 `docs/MINIPROGRAM_DATA_UPDATE.md` 完整回读。不得手工编辑 `current.json`。本次未执行正式回滚。
- 日志或故障排查位置：
  - 本地后台预览：`.dev-server/vite.log` 和 `.dev-server/state.json`。
  - 自动化：GitHub Actions各运行页面及其Artifact；当前CI为 `31141986025`。
  - 本地/下载证据：`work/`；该目录中的文件可能是临时证据，使用前核对提交和运行ID。
  - 不可变发布/迁移证据：`data/releases/`。
  - 当前差距与规则：`docs/IMPLEMENTATION_STATUS.md`、`docs/AUTOMATION_ACTIVATION_CHECKLIST.md`、`docs/MINIPROGRAM_DATA_UPDATE.md`。
- 敏感配置：只允许在GitHub Environment或腾讯云安全配置中维护。仓库工作流使用的名称包括 `TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY`、`TENCENTCLOUD_MONITOR_SECRET_ID`、`TENCENTCLOUD_MONITOR_SECRET_KEY`；本文不记录其值或获取凭据。

## 7. 已知问题与风险

- 当前阻塞点：
  - 不阻塞本地继续维护，但阻塞“项目全部完成”的结论：Web正式上线未知，小程序候选绑定和稳定归档未闭合，当前实时平台/生产数据未现场核验，D19未关闭。
  - 本次GitHub交接整理开始前，本地提交 `8690e0627967deb37bef6ef01ff944a0edc90947` 的工作区干净；接手人在自己电脑上仍必须重新运行 `git status --short`，不能由本次状态推断未来下载后的状态。
- 已知缺陷：
  - 自动更新文档和治理状态内部冲突。`docs/AUTOMATION_ACTIVATION_CHECKLIST.md` 和 `docs/IMPLEMENTATION_STATUS.md` 顶部登记已启用 `supervised_automation`，但同一清单后文、`docs/MINIPROGRAM_DATA_UPDATE.md`、`docs/MINIPROGRAM_V2_5_15_RELEASE_HANDOFF.md` 仍写开关关闭或 `automation_disabled`；同时仓库规则要求适用硬门槛未取得当前证据时两个开关必须关闭。本次实时回查两个变量确实均为 `true`，但仅凭变量值不能证明全部启用门槛合规关闭。任何生产操作前必须逐项复核硬门槛并统一权威文档；存在不确定项时按失败关闭处理。
  - 当前没有一份经本次实时复核的用户界面缺陷清单；是否仍有其他线上缺陷未知。
  - Windows普通 `git clone` 会受用户全局换行设置影响；若 `core.autocrlf=true`，当前严格设计令牌检查会失败。接手人必须使用 `README.md` 和 `docs/PROJECT_TRANSFER.md` 中带 `-c core.autocrlf=false` 的克隆命令，并设置当前仓库的本地值。
  - E2E测试会按浏览器渲染结果更新3份受Git管理的文档截图；测试可以通过但工作区出现截图改动。没有界面改动时按 `docs/PROJECT_TRANSFER.md` 核对并只恢复对应截图；有真实界面工作时必须保留并人工审查，不能盲目还原。
- 技术债：
  - D19通知接收、确认超时和恢复闭环未完成。
  - D20中Web和小程序的排名、涨平跌计数、累计变化仍分别实现，尚无固定输入的跨平台逐值一致测试；不得直接迁入共享核心。
  - `docs/RELEASE_READINESS.md` 记录的声明校验仍为 `schema_version: 1`，尚未把声明绑定到精确提交、构建、数据、域名和有效期。
  - `v2.5.15`没有稳定归档，平台证据附件不完整。
  - 2026-08-07运行 `npm audit` 报告当前完整依赖树21项告警：13项中危、4项高危、4项严重；其中生产依赖范围为2项，分别是传递依赖 `undici` 高危和直接依赖 `echarts` 中危。部分建议修复涉及版本或破坏性升级，本次按项目冻结要求未运行 `npm audit fix`，也未修改依赖或锁文件。
- 性能、安全、数据或兼容性风险：
  - 两个生产授权变量当前均为 `true`；错误理解旧文档可能导致误操作。自动化仍需按有人监督模式人工巡检。
  - 数据当前只核验到2026-06；下月数据必须继续通过四表白名单、全量重解析、独立审计和发布门禁。
  - 微信开发者工具“构建 npm”和编译缓存可能使实际运行包偏离源码，曾引发Babel运行时缺失和图表异常。
  - 三个受Git管理的数据JSON均为101,957,189字节，距离GitHub 100 MiB单文件上限只剩2,900,411字节；后续数据增长可能使推送被拒绝，更新数据前必须先检查生成文件大小。
  - 外部GitHub、腾讯云、微信平台、设备和Web域名状态会变化，历史截图或运行ID不能替代操作前现场回读。
- 影响范围：生产数据更新、微信小程序正式用户、发布/回滚可靠性、后续维护判断；Web上线问题只影响Web公开访问。
- 建议处理优先级：
  1. **高**：生产操作前统一自动更新状态文档，并再次只读回查双开关、当前提交CI和生产指针。
  2. **高**：继续执行D19要求的人工巡检；未关闭前不得宣传无人值守。
  3. **中**：补齐 `v2.5.15`候选绑定、平台字段、双真机原始附件和稳定归档。
  4. **中**：确认Web是否继续上线；如需要，确定HTTPS托管平台、域名和当前法律/浏览器验收。
  5. **低**：仅在有明确收益和一致测试后处理D20共享逻辑，不做收尾期重构。

## 8. 已尝试但失败的方案

### 宽泛标题和表格顺序解析

- 尝试内容：按宽泛标题或页面表格顺序识别官方数据，重复键由后出现值覆盖前值。
- 失败原因或现象：2018-03至2018-12的150条新建商品住宅整体指数被非目标表覆盖。
- 已有证据：`docs/DATA_CONTRACT.md`、`docs/ACCEPTANCE.md`、`data/normalized/revisions.json` 及全量审计记录；现行解析器和审计器已改为四类表白名单并对冲突重复键失败关闭。
- 后续是否禁止重复尝试：**是**。不得恢复固定表序、宽泛标题或“后值覆盖前值”。

### 原生页面直接使用 `position: sticky`

- 尝试内容：用CSS `position: sticky` 固定小程序顶部筛选/导航。
- 失败原因或现象：目标微信环境的原生页面滚动表现不可靠，导航会消失或布局跳动。
- 已有证据：当前 `apps/miniprogram/pages/index/index.js`、`index.wxss` 使用滚动阈值、固定状态和等高占位；历史复盘记录了该现象。
- 后续是否禁止重复尝试：**禁止未经双真机验证直接恢复**。只有平台行为变化且Android、iPhone均有证据时才可重新评估。

### 开发者工具盲目“构建 npm”

- 尝试内容：让微信开发者工具重新生成 `miniprogram_npm/`，或只补单个运行时文件。
- 失败原因或现象：曾出现 `@babel/runtime` 辅助文件缺失、首页或图表异常；源码依赖、运行包和编译缓存不一致。
- 已有证据：`docs/MINIPROGRAM_VERSIONING.md` 和 `docs/IMPLEMENTATION_STATUS.md` 的2026-08-03事件记录；重新同步自包含运行包、清编译缓存和递归依赖检查后恢复。
- 后续是否禁止重复尝试：**是，禁止盲目重建或手补单文件**。依赖变化后必须同步、清编译缓存、递归检查并重新连接Android/iPhone。

### 未量化目标就连续制作三版大改预览

- 尝试内容：复制完整项目并连续实现三版大范围界面方案。
- 失败原因或现象：方向未先量化，三版均不满意并删除，预览成本高且没有形成可交付结果。
- 已有证据：`docs/MINIPROGRAM_PROJECT_RETROSPECTIVE_AND_WORKFLOW.md` 的历史会话复盘；该文件只作为过程教训，不作为当前产品或外部平台状态证据。
- 后续是否禁止重复尝试：**禁止同样流程**。结构性改版必须先明确3至5个目标，用低成本整页稿确认方向后再实现。

### `REPLAY-001`至`REPLAY-004`自动更新回放绕路

- 尝试内容：CI读取本机未提交HTML；错误的滑动窗口断言；70个COS请求无界并发；用不能取消底层请求的统一60秒包装超时上传完整包。
- 失败原因或现象：CI缺文件、年度首轮断言失败、第11轮挂起超时、完整bootstrap重试可能重叠。
- 已有证据：`docs/MINIPROGRAM_12_MONTH_REPLAY_30338521130.md` 和 `docs/MINIPROGRAM_DATA_UPDATE.md` 的 `REPLAY-001`至`REPLAY-004`记录。修复后使用受版本控制的 `.html.gz`、正确滑动断言、每批10个对象、SDK可取消超时和幂等重试，并从第1轮完整重跑通过。
- 后续是否禁止重复尝试：**是**。不得依赖本机未提交来源、不得无界并发、不得用只停止等待而不取消请求的超时层。

## 9. 后续维护建议

1. 下一步建议做什么：先冻结功能，处理交接证据和文档一致性；生产操作前修正自动更新状态冲突，补齐 `v2.5.15`证据和稳定归档，再决定Web是否需要正式上线。不要在收尾阶段新增功能或重构。
2. 做之前必须先确认什么：
   - `git status --short`是否为空；若有改动，先确认来源、归属和意图。
   - `apps/miniprogram/config/version.js` 的当前值及目标候选提交/ZIP身份。
   - GitHub双开关当前值、当前提交CI、目标云环境、生产指针和待操作工作流。
   - 微信公众平台当前线上版本、构建号、审核状态和正式数据状态。
   - 国家统计局最新月份及来源是否仍符合四类表白名单。
3. 哪些文件必须先阅读：`AGENTS.md`、本文件、`docs/PROJECT_TRANSFER.md`、`docs/DOCUMENT_INDEX.md`、`PRODUCT.md`、`DESIGN.md`、`docs/DATA_CONTRACT.md`、`docs/ACCEPTANCE.md`、`docs/MINIPROGRAM_VERSIONING.md`、`docs/MINIPROGRAM_DATA_UPDATE.md`、`docs/AUTOMATION_ACTIVATION_CHECKLIST.md`、`docs/IMPLEMENTATION_STATUS.md`、`docs/MINIPROGRAM_V2_5_15_RELEASE_HANDOFF.md`。
4. 哪些功能不能轻易修改：官方表格白名单和数据口径、唯一版本源、生成数据流程、远程指针/撤销/回滚协议、生产双开关、稳定归档、当前小程序布局和平台差异、Web与小程序分别实现的D20计算。任何页面结构或整体风格调整都要先取得明确批准。
5. 哪些验证必须在改动后重新执行：
   - 所有代码改动：`npm.cmd run check`、`npm.cmd run test:e2e`。
   - 小程序构件改动：版本递增、`npm.cmd run miniprogram:sync`、`npm.cmd run test:miniprogram`、开发者工具编译、Android和iPhone。
   - 数据解析/契约改动：全量重解析、独立逐值审计、`validate:data`、Web和小程序重新生成与核对。
   - 远程数据/自动化改动：同提交CI、隔离云回放、历史修订回放、生产未触碰证明、变量和生产指针现场回读、发布后监测。
   - 仅文档改动：至少执行Markdown人工核对、链接/路径检查、`git diff --check`和前后范围检查。

## 10. 交接确认清单

- [x] 已列出真实完成状态
- [x] 已列出关键变更文件
- [x] 已记录实际测试结果
- [x] 已说明启动和构建方法
- [x] 已说明部署与线上状态
- [x] 未泄露任何敏感信息
- [x] 已列出风险、遗留项和下一步
