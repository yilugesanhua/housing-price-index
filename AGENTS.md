# 70城住宅价格指数项目执行指南

## 项目定位

本项目是基于国家统计局“70个大中城市商品住宅销售价格变动情况”的专业数据工具。当前同时维护响应式Web和原生微信小程序，发布完整70城的新建商品住宅和二手住宅环比、同比数据；首页以北京、上海、广州、深圳、厦门、福州作为常用六城概览，长期趋势支持从70城中最多选择三城比较。

产品展示价格指数及其变动率，不展示、估算或暗示住宅成交单价，也不提供投资建议。当前产品和界面事实以 `apps/web/` 与 `apps/miniprogram/` 为准；小程序唯一机器可读源码版本来自 `apps/miniprogram/config/version.js`，截至2026-08-03其值为 `v2.4.11`。文档中的当前版本文字只是快照，不是第二版本源；源码版本也不等于微信平台已发布版本，不能替代开发者工具、双真机、微信审核或发布验收。

## 文档与优先级

详细规范：

- [文档索引与状态](docs/DOCUMENT_INDEX.md)
- [产品与平台](PRODUCT.md)
- [数据契约](docs/DATA_CONTRACT.md)
- [设计规范](DESIGN.md)
- [商业化原则](docs/MONETIZATION.md)
- [当前产品验收](docs/ACCEPTANCE.md)
- [小程序版本管理](docs/MINIPROGRAM_VERSIONING.md)
- [小程序每月自动数据更新](docs/MINIPROGRAM_DATA_UPDATE.md)
- [实施状态登记](docs/IMPLEMENTATION_STATUS.md)

根目录 `PRODUCT.md` 和 `DESIGN.md` 同时是权威规范和Impeccable等设计skill自动读取的上下文入口，不维护重复副本。历史审计、回放、交接和生成式设计文件只能证明其标注日期或版本，不能覆盖当前源码和权威规范。

发生冲突时按以下顺序处理：

1. 数据真实性、统计口径、来源可追溯性和法律合规。
2. `docs/ACCEPTANCE.md` 的当前产品验收标准。
3. `PRODUCT.md` 的当前阶段范围。
4. 响应式、无障碍和交互要求。
5. 视觉建议、商业化假设和后续规划。

## 技术基线

- 包管理器：npm workspaces，并提交 `package-lock.json`。
- Web：Vite + React + TypeScript + ECharts。
- 数据采集：Node.js + TypeScript + Cheerio。
- 共享核心：平台无关的TypeScript，不直接访问DOM、`window`或微信全局对象。
- 数据：构建时生成静态JSON，浏览器和小程序客户端不得抓取国家统计局页面。
- 小程序：原生微信小程序 + wx-f2；不得用WebView替代原生适配。

目录职责：

```text
apps/web/                    Vite网页应用
apps/web/public/data/        Web端发布的 `manifest.json` 和 `data.json`
apps/miniprogram/            原生微信小程序唯一源目录
packages/core/               数据类型、筛选、计算和格式化逻辑
packages/design-tokens/      跨平台语义设计令牌及平台生成器
scripts/data/                发现、抓取、解析、标准化和校验脚本
data/raw/                    未压缩HTML本地缓存，以及公开源码仓库跟踪的确定性压缩官方来源档案和批次复现文件
data/bootstrap/              历史引导数据原文件与来源清单
data/normalized/             标准化全量数据与修订日志
tests/fixtures/              历史页面结构的最小测试样本
docs/                        产品、数据、设计、商业化和验收规范
```

生成文件必须由脚本产生。不得手工修改 `data/normalized/` 或 `apps/web/public/data/` 后冒充可复现结果。原始HTML和历史引导数据不得进入生产站点。

## 标准命令

初始化后，根目录 `package.json` 必须提供：

```text
npm run dev             启动Web开发环境
npm run lint            静态检查
npm run typecheck       所有workspace的TypeScript检查
npm run test            单元测试
npm run test:e2e        Web关键流程端到端测试
npm run validate:data   数据完整性、唯一性、连续性和计算校验
npm run build           生产构建
npm run check           依次执行lint、typecheck、test、validate:data和build
```

根脚本必须覆盖所有适用workspace；`dev` 默认启动Web，`test:e2e` 使用Playwright或仓库已有等价工具，在生产构建或等价预览环境运行。CI执行 `npm run check` 和 `npm run test:e2e`，不得维护另一套不同的检查命令。

## 执行规则

持续集成配置放在 `.github/workflows/ci.yml`，至少执行 `npm ci`、`npm run check` 和 `npm run test:e2e`；CI失败不得发布Web数据或生产构建。

- 修改前检查现有目录、脚本和工作区状态，不覆盖无关的用户改动。
- 严格遵守用户明确指定的修改范围。用户没有要求修改的界面、文案、组件结构、交互或功能，只能指出问题并提出方案；未取得用户明确确认前不得实施。设计、无障碍、上线审查和技术优化建议均不得绕过此确认要求。
- 规范与当前实现冲突时，先以 `apps/web/` 和 `apps/miniprogram/` 的现状记录事实并提出修订方案；除数据正确性、安全、隐私、合规或发布可靠性缺陷外，不得借“对齐规范”擅自改动当前界面。即使属于上述例外，也必须只做阻断风险所需的最小改动并明确说明。
- 优先沿用现有类型、组件、设计令牌和测试模式；没有实际复用价值时不新增抽象。
- 不得用随机数据、演示数据或手工伪造数据替代官方数据并标成真实结果。
- 生产数据只允许采纳 `docs/DATA_CONTRACT.md`“官方表格白名单”规定的四类70城表及其明确历史标题变体；“新建住宅价格指数”等其他表必须排除。解析器或表格识别规则变更后必须全量重解析、运行当前版本独立审计并比较全部统计值，任何不明确或冲突都必须阻断发布。
- 不得静默修改原始抓取文件、来源字段或历史记录；修订必须保留差异和时间。
- 新增生产依赖前说明用途，优先使用已有依赖或平台原生能力。
- 修改共享核心时必须同时验证Web消费者；小程序存在后还需验证小程序消费者。
- Web与小程序仍分别实现的排名、涨平跌计数或累计变化不得直接迁入共享核心。必须先建立同一固定输入的跨平台逐值一致测试；迁移后当前页面结果和交互保持不变。
- 小程序以 `apps/miniprogram/` 为源目录；每次修改完成后必须同步到微信开发者工具目录 `70城小程序技术验证/`，并确认本次涉及的文件内容一致。凡是修改 `apps/miniprogram/` 中会进入客户端构件的源码、运行时校验、配置、内置数据、云函数源码或其他构建输入，必须在同一候选中递增 `apps/miniprogram/config/version.js` 的版本号；只改文档、测试报告或不进入小程序构件的云端脚本不触发小程序版本递增。提交前必须检查变更路径与版本文件是否成对变化，路径已变而版本未变时该候选不合格，不得继续同步、验收、归档或发布。
- 小程序稳定版本按 `docs/MINIPROGRAM_VERSIONING.md` 归档到 `release/miniprogram/`；已归档版本只读，不得覆盖或补改。
- 小程序远程数据的生成、上传、缓存、回退和回滚按 `docs/MINIPROGRAM_DATA_UPDATE.md` 执行；发现任务不得直接发布线上数据。
- 权威规范描述目标要求，`docs/IMPLEMENTATION_STATUS.md` 只登记当前实现和验证差距。不得把“规范已写入”当成“代码已实现”，也不得用旧版本或有限演练证据关闭当前问题。
- 生产自动发布完整启用硬门槛只在 `docs/AUTOMATION_ACTIVATION_CHECKLIST.md` 维护；本文件、`docs/MINIPROGRAM_DATA_UPDATE.md`、`docs/IMPLEMENTATION_STATUS.md` 和其他文档只能引用该清单或登记逐项状态，不得复制门槛集合。该清单任一适用项没有当前可复查通过证据时，仓库级 `AUTOMATIC_RELEASE_ENABLED` 必须保持 `false`，生产 Environment 级 `PRODUCTION_RELEASE_AUTHORIZED` 必须保持 `false` 或未设置；普通发布、历史修订、回滚、状态部署和待发布恢复只有在两者独立验证且同时为精确字符串 `true` 时才能授权生产写入。关闭任何编号都必须同时更新实现、测试和证据状态。
- 上述双开关规则只有一个极窄、一次性例外：把精确旧生产控制指针迁移到现行控制协议的 `legacy-control-2026-06-e9788d0bddf3`。该例外必须由默认分支精确提交上的专用受保护工作流执行，绑定同一提交普通CI成功、精确迁移ID和生产 Environment 人工批准；`LEGACY_CONTROL_MIGRATION_AUTHORIZED=true` 不得保存为仓库级或 Environment 级持久变量，只能在受保护 job 已完成人工批准、精确提交和全部写前门禁后写入该 job 的临时环境，job 结束即失效。仓库级 `AUTOMATIC_RELEASE_ENABLED` 与生产 Environment 级 `PRODUCTION_RELEASE_AUTHORIZED` 在迁移前后都必须保持 `false` 或未设置。迁移授权不得被任何普通发布、历史修订、回滚、状态部署、恢复或其他生产写入读取或复用。迁移的详细原字节身份、双重撤销、写前耐久意图、写后中断恢复、前后全量回读和失败关闭规则只在 `docs/MINIPROGRAM_DATA_UPDATE.md` 维护；本例外不表示迁移已经执行，也不表示自动发布已经启用。
- 任何直接读取生产Secrets、生成生产候选或传递生产信任链Artifact的GitHub Actions工作流，所有非本地 `uses:` 必须固定40位完整commit SHA；禁止使用 `@v4`、`@v7`、`@main` 等可移动标签。容器Action固定镜像digest，本地Action使用受同一提交保护的相对路径；升级只能经普通Pull Request、CI和人工复核，版本标签只可保留在旁注中。
- `PRODUCT.md`、`DESIGN.md` 和 `docs/ACCEPTANCE.md` 的平台要求使用 `[共同]`、`[Web]`、`[小程序]` 明确范围。不得为满足Web专属键盘、缩放、精确数据或响应式条款而擅自修改小程序，也不得反向改动Web以复制小程序当前布局。
- 无法执行要求的验证时必须明确报告原因和未验证范围。

## 经验固化：跨系统身份、语义与证据

- 跨平台、跨版本和跨提交的关键对象必须有唯一身份、单一字段语义和可复查证据链。权限动作与资源表达式必须按目标云平台实际语法做最小权限验证；本地策略文件可解析不等于云端授权成功，扩大资源到通配符只能作为明确记录的临时阻断措施，不得当作永久修复。
- 数据字段不得复用表达不同概念；历史兼容只能绑定批准的迁移 ID 并在适配边界内转换，不得对所有新数据放宽校验。迁移意图、受保护执行提交、运行尝试和恢复提交必须分别记录并分别核验，恢复不得改写原始意图。
- 任何方案、登记、源码实现、本地测试、CI、云端部署、微信开发者工具编译、真机验收、审核、发布和稳定归档都必须单独登记；前一状态不得推断后一状态。失败时必须保留最后一个安全版本或安全指针，并保留不可变的原始证据、差异和失败原因。

## UI Skill 路由

按任务使用必要的skill，不要求所有UI改动机械执行完整流程：

- 新页面、信息架构调整或大规模重构：`frontend-design` + `ui-ux-pro-max`。
- 视觉层级、排版、颜色、响应式或交互打磨：`impeccable`。
- 上线前或用户明确要求审查：`web-design-guidelines`，记录所用规则版本或获取日期及 `file:line` 结果。
- 小范围样式或无障碍修复：只使用直接相关的skill，并进行针对性验证。
- 纯数据采集、解析、校验、部署任务：不调用UI skills。

Skill建议必须经过“专业住宅指数工具”场景校准。拒绝房地产营销模板、超大Hero、衬线展示字体、强转化CTA、装饰性毛玻璃和与数据无关的视觉效果。

## 完成条件

代码修改完成后至少运行相关测试，并根据影响范围运行：

```text
npm run check
npm run test:e2e
```

涉及布局、图表或交互时，还必须：

- 启动本地开发服务器，通过浏览器实际操作页面。
- 检查至少一个手机视口和一个电脑视口，并保存最终截图。
- 覆盖加载、空数据、缺失数据、错误、禁用、焦点、按下和选中状态。
- 验证触摸交互、键盘操作、横竖屏重排和页面水平溢出。
- 按 [当前产品验收](docs/ACCEPTANCE.md) 检查相关项目。

未通过数据校验、生产构建和相关页面检查时，不得宣称当前版本完成；外部平台、真机或审核证据未完成时，不得宣称已正式发布。
