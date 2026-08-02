# Overview Page Overrides

> **状态：历史设计工具输出（非权威）**
> 本文件仅保存2026-07-16生成的页面建议。当前唯一权威设计规范是 [`DESIGN.md`](../../../DESIGN.md)，不得用本文覆盖当前Web或小程序界面。

> **PROJECT:** 70城住宅指数
> **Generated:** 2026-07-16 05:27:52
> **Page Type:** Dashboard / Data View

> **原生成器逻辑（已失效）：** 本文件曾被设定为覆盖历史Master文件；该规则不适用于当前项目规范。

---

## Page-Specific Rules

### Layout Overrides

- **Max Width:** 1400px or full-width
- **Grid:** 12-column grid for data flexibility
- **Sections:** 1. Hero (product + live preview or status), 2. Key metrics/indicators, 3. How it works, 4. CTA (Start trial / Contact)

### Spacing Overrides

- **Content Density:** High — optimize for information display

### Typography Overrides

- No overrides — use Master typography

### Color Overrides

- **Strategy:** Dark or neutral. Status colors (green/amber/red). Data-dense but scannable.

### Component Overrides

- Avoid: Expect z-index to work across contexts
- Avoid: Use arbitrary large z-index values
- Avoid: Single row actions only

---

## Page-Specific Components

- No unique components for this page

---

## Recommendations

- Effects: Real-time chart animations, alert pulse/glow, status indicator blink animation, smooth data stream updates, loading effect
- Layout: Understand what creates new stacking context
- Layout: Define z-index scale system (10 20 30 50)
- Data Entry: Allow multi-select and bulk edit
- CTA Placement: Primary CTA in nav + After metrics
