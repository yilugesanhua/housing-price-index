# 70城住宅指数

项目当前包含响应式Web和原生微信小程序，展示国家统计局70个大中城市商品住宅销售价格指数完整数据。首页提供北京、上海、广州、深圳、厦门、福州常用六城概览，长期趋势可通过中文、完整拼音或拼音首字母搜索，从70城中最多选择三城比较。仅展示价格指数及其减100后的变动率，不提供元/平方米价格、原因解释或投资建议。

当前实现基线为 `apps/web/` 和 `apps/miniprogram/`；小程序唯一机器可读源码版本来自 `apps/miniprogram/config/version.js`，截至2026-08-03的当前值为 `v2.4.11`。本行只是当前快照，不是独立版本源。微信开发者工具目录 `70城小程序技术验证/` 是同步副本，源码版本不代表微信平台已经审核或发布。文档入口及当前/历史状态见 [docs/DOCUMENT_INDEX.md](docs/DOCUMENT_INDEX.md)。

## 环境

- Node.js 20或更高版本
- npm workspaces
- 首次运行：`npm ci`
- 首次E2E：`npx playwright install chromium webkit`

## 本地运行

```powershell
npm.cmd run dev
```

需要在终端或 Codex 任务结束后继续访问页面时，使用独立后台模式：

```powershell
npm.cmd run dev:start
npm.cmd run dev:status
npm.cmd run dev:stop
```

后台模式固定使用 `http://127.0.0.1:5173/` 提供生产构建预览，启动成功前会执行 HTTP 健康检查，重复启动不会创建第二个实例。页面代码变更后先运行 `npm.cmd run build`，再重新启动后台预览。

默认地址：`http://127.0.0.1:5173/`

## 检查

```powershell
npm.cmd run check
npm.cmd run test:e2e
```

`check`依次运行lint、Web与数据TypeScript检查、单元测试、数据fixture测试、发布数据校验和生产构建。E2E覆盖桌面Chromium与手机WebKit。

## 数据更新

```powershell
npm.cmd run data:discover
npm.cmd run data:release-calendar
npm.cmd run data:check-latest
npm.cmd run data:discover-historical
npm.cmd run data:fetch-all
npm.cmd run data:reparse
npm.cmd run data:validate-source
npm.cmd run data:audit
npm.cmd run data:publish
npm.cmd run check
npm.cmd run test:e2e
```

规则：

- 浏览器不抓取国家统计局页面，Web只读取构建生成的静态JSON。
- `data/raw/**/*.html`为本地缓存，不进入Git；同内容的确定性压缩档`.html.gz`及对应`.batch.json`是当前公开源码仓库中的官方来源复现档案，供云端CI按原始SHA自动复核。上述文件均不进入Web或小程序生产包，私有运行审计另行保存。
- 所有批次必须通过逐记录审计并标记为`verified`，发布命令才会执行。
- 发布先生成临时目录并回读校验，失败时恢复上一版本。
- `manifest.json`短缓存；数据清单指向带`dataset_version`的长期缓存文件。
- `data/normalized/revisions.json`追加同一唯一键的值变化，不覆盖历史修订。
- `data:release-calendar`读取国家统计局“主要统计信息发布日程表”，解析“商品住宅销售价格指数月度报告”的12个月预告日期与时间，保存`work/monthly-data-check/release-calendar.json`及原页SHA-256证据。
- `data:check-latest`先同步发布预告；未进入下一期预告窗口时不请求正式发布列表，进入窗口后才比较官方最新统计月份和当前发布清单，并生成报告。发现新月份时额外生成绑定日程、来源、提交和运行ID的`handoff.json`，由独立工作流重新抓取并通过全量门禁后发布；生产开关关闭或任一门禁失败时不会上线。

GitHub Actions 的月度发现时刻只在 [`docs/MINIPROGRAM_DATA_UPDATE.md`](docs/MINIPROGRAM_DATA_UPDATE.md)“到点发现正式页面”中维护，本 README 不复制具体 Cron 或北京时间表。发现、候选准备、生产发布、待发布恢复和发布后24小时监测使用独立作业与权限；生产发布默认关闭，报告作为任务摘要和构件保留。运行时间变更必须同步更新该权威章节，并通过时间表与工作流一致性检查后才能合并；该检查的当前实现状态见 [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md)。

## 目录

```text
apps/web/                   React + Vite Web应用
apps/miniprogram/           原生微信小程序唯一源目录
packages/core/              共享类型、筛选和格式化逻辑
packages/design-tokens/     语义设计令牌
scripts/data/               发现、抓取、解析、审计与发布
data/raw/                   公开跟踪的官方压缩来源档案与批次复现文件；未压缩HTML仅为本地缓存
data/normalized/            标准化全量记录与修订日志
tests/fixtures/             历史页面最小测试样本
docs/                       数据、设计、商业化与验收规范
```

权威规范见[PRODUCT.md](PRODUCT.md)、[DESIGN.md](DESIGN.md)和[docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)。

始建于2026-07-19、部分数据证据更新至2026-07-28的Web验收矩阵见[docs/ACCEPTANCE_EVIDENCE.md](docs/ACCEPTANCE_EVIDENCE.md)，它不证明当前小程序或 `v2.4.1` 已完成验收；公开上线前合规记录见[docs/COMPLIANCE_REVIEW.md](docs/COMPLIANCE_REVIEW.md)，使用时必须按当前主体、用途和平台规则复核。

正式HTTPS发布必须按[docs/RELEASE_READINESS.md](docs/RELEASE_READINESS.md)配置域名和纠错入口、填写真机/浏览器/法律验收声明，并执行`npm run release:check`。
