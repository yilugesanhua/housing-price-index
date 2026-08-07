# 证据状态

每一项单独登记。前一项通过不表示后一项通过。

| `stage` | 含义 | `passed` 所需证据 |
| --- | --- | --- |
| `analyzed` | 已完成只读分析 | 读取范围、结论和证据来源 |
| `plan-ready` | 已形成方案 | 目标、范围、取舍和成功标准 |
| `files-changed` | 文件确实变化 | 范围报告中的本次允许改动 |
| `lint` | 静态规则检查通过 | 命令、退出码和适用范围 |
| `typecheck` | 类型检查通过 | 命令、退出码和适用范围 |
| `unit-tests` | 单元测试通过 | 命令、测试数量和结果 |
| `data-validation` | 数据校验通过 | 命令、覆盖范围、身份和限制 |
| `build` | 生产或目标构建通过 | 命令、退出码和构件身份 |
| `local-runtime` | 本地实际启动可用 | 地址/入口、操作路径和结果 |
| `devtools` | 平台开发者工具通过 | 工具、版本、重新编译和操作结果 |
| `android-device` | Android 真机通过 | 设备/系统、候选身份和操作结果 |
| `iphone-device` | iPhone 真机通过 | 设备/系统、候选身份和操作结果 |
| `deployed` | 已部署到目标环境 | 环境、现场来源、时间和构件身份 |
| `uploaded` | 已上传到平台 | 平台回执、时间和版本/构件身份 |
| `reviewed` | 平台审核已结束 | 平台状态、时间和候选身份 |
| `released` | 已正式发布 | 正式平台状态、时间和版本身份 |
| `online-readback` | 正式环境现场回读通过 | 正式入口、时间、版本和实际结果 |
| `automation-enabled` | 自动化生产写入已启用 | 当前开关、门槛、时间和环境身份 |

`status` 只允许：

- `passed`：当前证据已证明。
- `failed`：已执行但失败。
- `not-run`：没有执行。
- `unavailable`：当前无法访问所需环境、设备或平台。

外部阶段 `deployed` 至 `automation-enabled` 标记 `passed` 时，结果项必须包含非空的 `source`、`checked_at` 和 `identity`。历史截图、旧版本测试和源码推断不能替代当前外部证据。

`finish` 输出中没有提供的阶段保持 `not-claimed`，不是默认通过，也不是默认失败。
