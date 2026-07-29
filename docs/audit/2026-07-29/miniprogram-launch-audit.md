# v2.3.0小程序上线前自动化审查

审查日期：2026-07-29

## 范围与规则

- 候选版本：`v2.3.0`。
- 源目录：`apps/miniprogram/`；微信开发者工具目录：`70城小程序技术验证/`。
- UI规则：`web-design-guidelines` skill `1.0.0`，规则于2026-07-29从其GitHub源地址重新获取；按原生微信小程序能力校准，不机械套用Web DOM规则。
- 数据门禁：`official-html-v7-product-housing-only`与`full-record-audit-v4`。

## 已修复发现

- `apps/miniprogram/pages/index/index.wxml:15`：上线审查曾未经用户确认把重新定位由可点击`view`改为原生`button`，导致微信原生控件渲染影响既有视觉；现已按用户要求恢复原`view role="button"`结构，并增加回归断言禁止再次替换。
- `apps/miniprogram/pages/index/index.wxml:18`：定位城市选择器增加明确无障碍名称。
- `apps/miniprogram/pages/index/index.wxml:31`：住宅类型、统计指标、面积范围和时间范围选择器增加明确无障碍名称。
- `apps/miniprogram/pages/index/index.wxml:118`：精确数据月份选择器增加明确无障碍名称。
- `apps/miniprogram/pages/index/index.wxml:136`：城市搜索框增加明确无障碍名称。
- `apps/miniprogram/project.config.json:4`：源配置从`trial`固定为本机已验证的稳定基础库`3.17.0`，避免归档或换机后隐式使用试验库。

## 自动化证据

- 微信开发者工具CLI真实预览编译通过，AppID为`wxf2b2a44f4c788def`，上传包1,594,606字节，低于2MB限制。
- 预览文件：`work/v2.3.0-prelaunch/preview.png`；编译信息：`work/v2.3.0-prelaunch/preview-info.json`。`work/`不进入版本归档。
- 同步脚本执行后，源目录和开发者工具目录的应用代码、页面、数据、资源、云函数和`miniprogram_npm`逐文件SHA-256一致。
- `project.private.config.json`由`.gitignore`排除；仓库高置信扫描未发现`AKID`格式腾讯云密钥或私钥头，腾讯位置Key只通过云函数环境变量`TENCENT_LBS_KEY`引用。
- 仓库级和`housing-data-production` Environment级`AUTOMATIC_RELEASE_ENABLED`均为`false`；写入与只读监测Secret名称齐全且未进入仓库。
- 小程序99项自动化测试通过，包括70城/120个月完整性、同月旧源拒绝、损坏包拒绝、离线回退、一次下载完整70城、切城零下载、定位映射、图表线型和包体积。
- 恢复定位入口后小程序99项测试再次通过；源目录与微信开发者工具目录的应用文件逐文件SHA-256一致。当前预览包为1,594,605字节。
- 还原后的`2.3.0`已由微信开发者工具CLI重新上传到 AppID `wxf2b2a44f4c788def` 的开发版本区，上传命令成功退出并生成1,603,517字节包体信息；尚未在公众平台设为体验版，也未提交审核或公开发布。
- 最终候选提交 `2b868ef` 的12轮云端全链路回放 `30411300588` 通过。每轮逐条核对560条目标记录、上传并回读72个隔离对象、故意损坏1条记录后确认上传前拒绝、激活完整70城并验证切城零下载；生产指针和生产发布目录均未触碰。详见 `docs/MINIPROGRAM_12_MONTH_REPLAY_30411300588.md`。
- 紧随回放的正式环境只读复核 `30412319177` 通过：云函数、正式 `current.json`、70城远端分片和完整重建均正常；正式指针SHA-256仍为 `d2ef3cd4248c0bb8ad1bda305a11587db1ca38012d952178e8cdbae32e8a3c96`。因线上远端来源早于内置修正版，监测结果明确标记为 `known_stale_source`，`v2.3.0` 客户端将拒绝该远端包并保留内置修正版。

## 尚需外部证据

- Windows窗口捕获对当前微信开发者工具返回`0x80004002 不支持此接口`。官方自动化端口9421可监听，但`miniprogram-automator 0.12.1`与当前开发者工具未完成协议握手且没有生成截图；因此模拟器首页和来源页仍需人工目视，CLI编译通过不能替代目视检查。
- Android与iPhone各12项真机验收尚未填写，不得固定稳定归档或提交审核。
- 正式纠错邮箱或可用微信客服入口尚未提供；不得虚构联系方式。
- `v2.3.0`开发版本已上传；设为体验版、测试成员验收、微信审核和正式发布尚未执行。
- 微信正式发布后仍先保持自动生产发布关闭；发布版读取复核通过并取得项目所有者明确授权后才能开启。
