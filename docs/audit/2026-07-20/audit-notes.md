# Web Interface Guidelines 审查记录

审查日期：2026-07-20
规则来源：`https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`（本次联网获取）
审查范围：`apps/web/src/App.tsx`、`apps/web/src/styles.css`、`apps/web/src/TrendChart.tsx`、`apps/web/src/BreadthHistoryChart.tsx`、`apps/web/index.html`

## 已通过或已修复

- 图标按钮均有 `aria-label` 和 `title`；图表补充了等价的语义数据表和月份选择器。
- 表单控件使用真实 `label`/`aria-label`、稳定 `name`、`autocomplete`；城市搜索关闭自动拼写和自动大写，并使用 `enterKeyHint="search"`。
- 交互焦点使用全局 `:focus-visible`；城市面板关闭后恢复触发按钮焦点，移动端打开面板不自动弹出键盘。
- 城市列表和底部面板使用 `overscroll-behavior: contain`；页面不再全局禁止原生 overscroll，保留微信/iOS边缘手势。
- 低高度横屏优先保留筛选，取消占屏的分区快捷链接；所有视口无水平溢出，图表保留固定高度和触控替代按钮。
- 设计令牌、缺失/错误/离线/网络恢复状态、`prefers-reduced-motion` 和安全区回退均有明确实现。

## 有意保留的产品决策

- 页面使用单一系统字体栈，以匹配微信/iOS阅读环境和数据工具的克制定位；不引入展示字体或远程字体请求。
- 图表使用懒加载 ECharts，首屏主脚本与CSS gzip约72KB；ECharts块按需加载，不为小程序直接复用DOM运行时。

## 尚需外部验证

- Android 微信和 iPhone 微信真机的 Canvas 触摸、键盘、返回手势、分享菜单和来源跳转。
- 正式 HTTPS 域名下微信对 `og:image` 和固定分享元数据的抓取。
- 小程序原生 Canvas 方案、分包体积、低端设备耗时和平台分享生命周期。

## 本地证据

- `npm run check`：通过。
- `npm run test:e2e`：40项全部通过；桌面和手机均覆盖摘要优先、趋势分片失败、微信 UA 分享回退、离线事件和多视口布局。
- `node C:\Users\user\.agents\skills\impeccable\scripts\detect.mjs --json apps/web/src/App.tsx apps/web/src/styles.css apps/web/src/TrendChart.tsx apps/web/src/BreadthHistoryChart.tsx`：空结果。
