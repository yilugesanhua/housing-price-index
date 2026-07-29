# 70城住宅价格指数项目执行指南

## 项目定位

本项目是基于国家统计局“70个大中城市商品住宅销售价格变动情况”的专业数据工具。第一阶段发布完整70城的新建商品住宅和二手住宅环比、同比数据；首页以北京、上海、广州、深圳、厦门、福州作为常用六城概览，长期趋势支持从70城中最多选择三城比较。

首发为响应式网页，重点支持微信内置浏览器；后续适配微信小程序。产品展示价格指数及其变动率，不展示、估算或暗示住宅成交单价，也不提供投资建议。

## 文档与优先级

详细规范：

- [产品与平台](PRODUCT.md)
- [数据契约](docs/DATA_CONTRACT.md)
- [设计规范](DESIGN.md)
- [商业化原则](docs/MONETIZATION.md)
- [第一阶段验收](docs/ACCEPTANCE.md)
- [小程序版本管理](docs/MINIPROGRAM_VERSIONING.md)
- [小程序半自动数据更新](docs/MINIPROGRAM_DATA_UPDATE.md)

根目录 `PRODUCT.md` 和 `DESIGN.md` 同时是权威规范和Impeccable等设计skill自动读取的上下文入口，不维护重复副本。

发生冲突时按以下顺序处理：

1. 数据真实性、统计口径、来源可追溯性和法律合规。
2. `docs/ACCEPTANCE.md` 的第一阶段验收标准。
3. `PRODUCT.md` 的当前阶段范围。
4. 响应式、无障碍和交互要求。
5. 视觉建议、商业化假设和后续规划。

## 技术基线

- 包管理器：npm workspaces，并提交 `package-lock.json`。
- Web：Vite + React + TypeScript + ECharts。
- 数据采集：Node.js + TypeScript + Cheerio。
- 共享核心：平台无关的TypeScript，不直接访问DOM、`window`或微信全局对象。
- 数据：构建时生成静态JSON，浏览器和小程序客户端不得抓取国家统计局页面。
- 小程序框架在真实图表技术验证后决定，不因追求代码复用牺牲包体积、清晰度或触摸性能。

目录职责：

```text
apps/web/                    Vite网页应用
apps/web/public/data/        Web端发布的 `manifest.json` 和 `data.json`
apps/miniprogram/            小程序适配，立项前不创建占位实现
packages/core/               数据类型、筛选、计算和格式化逻辑
packages/design-tokens/      跨平台语义设计令牌及平台生成器
scripts/data/                发现、抓取、解析、标准化和校验脚本
data/raw/                    原始HTML本地归档缓存；持久副本按数据契约保存
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
- 优先沿用现有类型、组件、设计令牌和测试模式；没有实际复用价值时不新增抽象。
- 不得用随机数据、演示数据或手工伪造数据替代官方数据并标成真实结果。
- 生产数据只允许采纳 `docs/DATA_CONTRACT.md`“官方表格白名单”规定的四类70城表及其明确历史标题变体；“新建住宅价格指数”等其他表必须排除。解析器或表格识别规则变更后必须全量重解析、运行当前版本独立审计并比较全部统计值，任何不明确或冲突都必须阻断发布。
- 不得静默修改原始抓取文件、来源字段或历史记录；修订必须保留差异和时间。
- 新增生产依赖前说明用途，优先使用已有依赖或平台原生能力。
- 修改共享核心时必须同时验证Web消费者；小程序存在后还需验证小程序消费者。
- 小程序以 `apps/miniprogram/` 为源目录；每次修改完成后必须同步到微信开发者工具目录 `70城小程序技术验证/`，并确认本次涉及的文件内容一致。
- 小程序稳定版本按 `docs/MINIPROGRAM_VERSIONING.md` 归档到 `release/miniprogram/`；已归档版本只读，不得覆盖或补改。
- 小程序远程数据的生成、上传、缓存、回退和回滚按 `docs/MINIPROGRAM_DATA_UPDATE.md` 执行；发现任务不得直接发布线上数据。
- 无法执行要求的验证时必须明确报告原因和未验证范围。

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
- 按 [第一阶段验收](docs/ACCEPTANCE.md) 检查相关项目。

未通过数据校验、生产构建和相关页面检查时，不得宣称第一阶段完成。
