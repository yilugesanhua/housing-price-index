---
target: 70城住宅指数首页
total_score: 29
p0_count: 0
p1_count: 2
timestamp: 2026-07-18T03-38-09Z
slug: apps-web-src-app-tsx
---
# 70城住宅指数首页设计审查

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3 | 视觉状态完整，但异步状态和图表加载缺少读屏播报，缩放窗口不显示 |
| 2 | Match System / Real World | 4 | 官方统计术语准确，并明确不推算成交单价 |
| 3 | User Control and Freedom | 2 | 城市 Sheet 关闭后焦点丢失；两个恢复动作作用域不清 |
| 4 | Consistency and Standards | 3 | 控件基本统一，但对话框/listbox语义和状态文案不一致 |
| 5 | Error Prevention | 3 | 三城上限和至少一城有防护，但允许隐藏全部曲线 |
| 6 | Recognition Rather Than Recall | 3 | 主要筛选持续可见，精确数据入口位置和命名仍偏技术化 |
| 7 | Flexibility and Efficiency | 2 | URL、搜索和拖拽有效，但缩放存在双状态，无专家快捷路径 |
| 8 | Aesthetic and Minimalist Design | 3 | 克制可信，但重复 kicker 和同构卡片仍有模板感 |
| 9 | Error Recovery | 3 | 错误、重试和撤销完整，焦点恢复及全线隐藏恢复不足 |
| 10 | Help and Documentation | 3 | 图表口径与来源充分，部分帮助过于靠后 |
| **Total** |  | **29/40** | **Good，正式发布前需修关键问题** |

## Anti-Patterns Verdict

不像粗糙 AI 成品：没有房地产营销模板、超大 Hero、渐变文字或装饰性玻璃。仍有较明显的生成式 dashboard 语法：蓝色 kicker + 标题反复出现，六张完全同构卡片，产品专属视觉语言主要到图表区才出现。

Impeccable detector 对 `App.tsx` 和 `TrendChart.tsx` 返回 `[]`（0项）。最新 Web Interface Guidelines 仍检出异步状态未播报、城市搜索缺少 name、70项列表未优化、部分 hover 状态缺失及 `...` 未使用 `…` 等规范问题。

## Overall Impression

首页信息架构已经成立：先看六城结论，再做城市比较，再看累计路径和来源。最大机会不是继续美化，而是收紧移动端性能、城市选择器无障碍语义和分析控件的作用域。

## What's Working

1. 六城概览是最强价值时刻：排序、方向、变动率、指数和迷你趋势能快速形成判断。
2. 统计口径成熟：主图、累计图、缺失值、基期和发布日期均有解释，不暗示成交单价。
3. 响应式与基础无障碍扎实：手机无水平溢出、控件44px、图表线型不只靠颜色、提供精确数据表。

## Priority Issues

### [P1] 首次加载数据与脚本对微信端偏重

- Why: 页面一次下载并解析全部17640条记录；`data.json` 17,488,970 bytes（gzip约533KB），主JS 738KB（构建gzip约245KB）。网络体积尚可，但17.5MB JSON解析、校验和内存展开会拖慢低端手机。
- Fix: 发布数据拆成 manifest + 六城最新摘要 + 按住宅类型/城市分片的趋势文件；进入趋势区再按需加载；ECharts动态导入并只注册使用组件。
- Evidence: `apps/web/src/App.tsx:31-36`。
- Suggested command: `$impeccable optimize apps/web`

### [P1] 城市选择 Sheet 的视觉行为与无障碍语义不一致

- Why: 实测打开后焦点仍在“添加城市”，`aria-modal=false`，页面主体仍可滚动；关闭后焦点落到 `body`。70个 `role=option` 一次渲染，且未实现完整 listbox 键盘模型。
- Fix: 使用原生 dialog/可靠焦点圈定；打开聚焦搜索框，关闭恢复触发器；改为按钮列表语义或补齐 listbox 方向键；用 `content-visibility`/虚拟化优化70项。
- Evidence: `apps/web/src/App.tsx:218-236`。
- Suggested command: `$impeccable harden apps/web/src/App.tsx`

### [P2] “清除本地筛选”和趋势区“重置”作用域含混

- Why: 两者都接近恢复全部默认状态，但一个位于核心筛选区，一个位于趋势标题旁，用户会误以为“重置”只重置城市。
- Fix: 筛选区改为“恢复默认筛选”；“清除本地保存”移至来源/设置区；趋势区按钮只恢复默认城市并明确命名。
- Evidence: `apps/web/src/App.tsx:76-93,202,215`。
- Suggested command: `$impeccable clarify apps/web/src/App.tsx`

### [P2] 拖动时间条和缩放按钮维护两套不同状态

- Why: ECharts拖动会改变内部 dataZoom，但React的 `zoomStart` 只由按钮更新；拖动后按钮的 disabled 状态与下一次跳转可能不符合当前窗口。
- Fix: 监听 `datazoom` 同步 start/end，并显示当前可见月份范围；全部曲线隐藏时提供明确恢复动作。
- Evidence: `apps/web/src/TrendChart.tsx:55,127-130,224-248`。
- Suggested command: `$impeccable harden apps/web/src/TrendChart.tsx`

### [P2] 精确数据入口保留了功能，但移动端呈现仍未完成

- Why: “查看月份数据表”技术感强，展开后横向表格对手机用户较重；它是必要的无障碍等价信息，但当前仍像附加实现。
- Fix: 改名“查看精确数据”；桌面保留表格，手机使用“月份选择 + 按城市的键值行”，默认最新月份。
- Evidence: `apps/web/src/TrendChart.tsx:265-275`。
- Suggested command: `$impeccable adapt apps/web/src/TrendChart.tsx`

## Persona Red Flags

- Alex: 拖动时间条后缩放按钮可能跳转；“清除/重置”需猜作用域；没有快速月份切换。
- Sam: 城市 Sheet 无焦点管理，dialog/listbox语义不完整；异步数据状态和图表加载缺少 live announcement；精确数据入口靠后。
- Casey: 17.5MB JSON解析对低端微信环境不友好；趋势区同时出现移除、添加、重置、缩放和图例显隐，容易混淆“移除城市”和“隐藏曲线”。

## Minor Observations

- `App.tsx:167` 与 `TrendChart.tsx:234` 的异步状态缺少 `role=status` / `aria-live=polite`。
- `App.tsx:225` 城市搜索缺少 meaningful `name`，placeholder应以 `…` 结束。
- `App.tsx:246` 来源区显示英文枚举 `current`，与页面中文状态不一致；12px来源正文偏轻。
- `styles.css:125` 城市 Sheet 完成按钮、`index.html:44` 启动重载按钮缺少显式 hover。
- `index.html:66` 的 `...` 应改为 `…`。
- 重复蓝色 kicker（`App.tsx:176,210,215`）和六张同构卡片仍有模板感，属P3视觉打磨。

## Questions to Consider

1. 第一版内部工具是否先把“微信端加载速度与选择器可访问性”作为发布门槛，而把视觉个性放后？
2. 趋势区的“重置”应只恢复城市，还是恢复整页筛选？一个按钮不应同时承担两种理解。
3. 精确数据是无障碍备用，还是普通用户也会用的分析功能？后者需要正式的移动端形态。
