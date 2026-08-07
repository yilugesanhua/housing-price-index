---
name: verified-dev-workflow
description: >-
  在现有代码项目中执行可信、可复查的开发工作流。适用于用户要求检查、开发、修复、数据处理、安装配置或发布时：先读取项目规则并记录目标、允许和禁止范围及已有 Git 改动，再按风险选择简化或完整流程，小步实施、分层验证、检查越界，并准确区分已分析、已修改、已测试、已部署和已发布状态。用户提出“按我的工作流开发”“先检查再改”“保护已有改动”或“给出验证证据”等要求时使用。
---

# 可信开发工作流

## Overview

在授权范围内完成代码项目任务，同时保护用户已有改动，并让每个完成状态都有对应证据。始终以用户当前要求、项目 `AGENTS.md` 和项目权威规范为准；本 Skill 只提供通用执行框架，不覆盖领域规则。

## Dependencies

按任务条件引用现有能力，不要在本 Skill 中重复实现：

- 查询最新政策、价格、兼容性或官方规则：使用 `agent-reach`。
- 处理密钥、环境变量或凭据：使用 `credentials`。
- 新页面、信息架构或大规模界面重构：使用 `frontend-design` 和 `ui-ux-pro-max`。
- 界面视觉、排版、响应式或交互打磨：使用 `impeccable`。
- 上线前或用户明确要求的 Web 审查：使用 `web-design-guidelines`。
- OpenAI 或 Codex 官方能力问题：使用 `openai-docs`。
- 实际页面、Chrome 登录态、Windows 应用或微信开发者工具验证：按现场能力使用浏览器、Chrome 或电脑控制工具。

只调用当前任务真正需要的依赖。项目自己的 Skill 路由优先。

## Quick Start

1. 读取用户要求、项目规则和相关权威文档。
2. 阅读 [risk-routing.md](references/risk-routing.md)，选择 `readonly`、`simple` 或 `full`。
3. 把证据文件放在项目目录外，不要把密码、密钥、验证码或文件内容写入参数和记录。
4. 在修改前运行 `start`。非只读任务为每个允许范围重复传入 `--allow`。
5. 实施并完成适当验证后，在暂存、提交、上传或发布前运行 `scope-check`。
6. 阅读 [evidence-states.md](references/evidence-states.md)，按 [result-input.example.json](references/result-input.example.json) 准备结果文件，再运行 `finish`。
7. 最终答复只使用交付记录能够证明的状态，并明确未验证范围。

示例：

```powershell
uv run "<skill-dir>\scripts\workflow_guard.py" start `
  --project "C:\项目位置" `
  --goal "修正README中的启动步骤" `
  --task-type fix `
  --route simple `
  --allow "README.md" `
  --success "启动步骤与当前项目一致" `
  --output "C:\临时证据\start.json"
```

## Utility Scripts

所有子命令都必须使用 `uv run` 调用，并要求 `--output`。脚本只读取项目状态和写证据文件，不修改业务文件，不执行 Git 暂存/提交，不安装、上传、发布或回滚。

### `start`

记录任务卡、项目路径、Git 根目录、分支、提交、已有改动和文件指纹。

```text
start --project PATH --goal TEXT --task-type TYPE --route ROUTE
      [--allow PATH ...] [--deny PATH ...] --success TEXT [--success TEXT ...]
      --output FILE
```

- `TYPE`：`readonly`、`develop`、`fix`、`data`、`install` 或 `release`。
- `ROUTE`：`readonly`、`simple` 或 `full`。
- 路径规则相对 Git 根目录；目录规则覆盖后代，支持 `*`、`?` 和 `[]` 通配符；禁止规则优先。
- 只读路线不要传 `--allow`。非只读路线至少传一个明确范围。
- `readonly` 输出必须位于项目外；本 Skill 对所有路线都把证据放在项目外。
- 非 Git 项目只生成受限基线，不得声称完成了全项目越界检查，也不得自动初始化 Git。

### `scope-check`

对比开始基线和当前状态，识别本次允许改动、越界改动、禁止路径变化以及被再次修改的用户原有脏文件。

```powershell
uv run "<skill-dir>\scripts\workflow_guard.py" scope-check `
  --baseline "C:\临时证据\start.json" `
  --output "C:\临时证据\scope.json"
```

通过时退出码为 0。发现越界、基线身份变化、原有脏文件被碰触或证据能力不足时，先写报告，再以退出码 1 结束。不要自动还原现场；先解释并取得扩大范围或恢复方式的授权。

### `finish`

合并任务卡、范围报告和显式验证证据，生成最终交付记录。

```powershell
uv run "<skill-dir>\scripts\workflow_guard.py" finish `
  --baseline "C:\临时证据\start.json" `
  --scope-report "C:\临时证据\scope.json" `
  --result "C:\临时证据\result-input.json" `
  --output "C:\临时证据\delivery.json"
```

范围失败、失败证据或自相矛盾的状态不能输出 `complete`。未提供的阶段保持 `not-claimed`；本地测试不会自动推导为部署、审核、发布或线上可用。

## Workflow

### 1. 定界

- 用一句话写清目标。
- 明确允许范围、禁止范围、成功标准和外部操作权限。
- 用户只要求检查或方案时，保持只读。

### 2. 盘点

- 读取项目规则、当前实现、版本源和相关验收条款。
- 运行 `start`，区分当前源码、用户已有改动、历史记录和不可现场核验的外部状态。
- 已有改动与目标重叠时先理解；不要覆盖或还原。

### 3. 方案

- 默认选择简单、安全、稳定、成本合理且符合项目现状的方案。
- 只有扩大范围、明显产品取舍、删除/覆盖/付费/发布/生产写入或缺少关键权限时暂停询问。
- 普通失败自动诊断根因并尝试不改变目标的安全替代。

### 4. 小步实施

- 一次解决一个问题或紧密相关批次。
- 沿用现有结构、类型、组件、令牌和测试模式。
- 不做无关重构，不为通过测试改变正确需求，不把生成文件手工伪装成可复现结果。

### 5. 分层验证

- 先运行最接近改动的检查，再按风险扩展到完整测试、构建、实际启动、浏览器、开发者工具、真机、隔离云端或正式平台。
- 失败时保留完整错误和安全状态，从根因修复。
- 无法执行的验证写明原因和影响，不用旧版本证据替代。

### 6. 证据交付

- 在任何暂存、提交或外部操作前运行 `scope-check`。
- 按证据状态准备结果文件并运行 `finish`。
- 最终说明结论、用户可见变化、文件/版本、验证、使用步骤、剩余事项和适用时的回退方式。

### 7. 复盘固化

- 可复发问题优先增加防复发测试。
- 再按职责更新已有权威规范、验收标准和执行/交接说明。
- 只有跨项目反复适用的经验才提升为个人 Skill；不要在多个文件复制同一权威规则。

## Rate Limiting

辅助 CLI 不调用外部 API，没有新增限速、密钥或网络依赖。联网任务必须交给对应现有 Skill，并遵守其限速、重试和凭据规则。

## Common Mistakes

- 把审查或建议当成修改授权，顺带改动用户没有要求的区域。
- 只比较 Git 状态字母，未用指纹发现原有脏文件被再次修改。
- 把“已写方案、文件已改、测试通过、已部署、已发布”合并成一个“完成”。
- 把证据输出写进项目，导致只读任务自身制造改动。
- 范围检查失败后擅自还原、删除或扩大范围，进一步覆盖用户现场。
