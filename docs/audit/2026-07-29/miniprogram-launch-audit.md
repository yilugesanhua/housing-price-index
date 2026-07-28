# v2.3.0小程序上线前自动化审查

审查日期：2026-07-29

## 范围与规则

- 候选版本：`v2.3.0`。
- 源目录：`apps/miniprogram/`；微信开发者工具目录：`70城小程序技术验证/`。
- UI规则：`web-design-guidelines` skill `1.0.0`，规则于2026-07-29从其GitHub源地址重新获取；按原生微信小程序能力校准，不机械套用Web DOM规则。
- 数据门禁：`official-html-v7-product-housing-only`与`full-record-audit-v4`。

## 已修复发现

- `apps/miniprogram/pages/index/index.wxml:15`：重新定位由可点击`view`改为原生`button`，保留原尺寸、位置和图标。
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

## 尚需外部证据

- Windows窗口捕获对当前微信开发者工具返回“不支持此接口”，因此模拟器首页和来源页仍需人工目视；CLI编译通过不能替代目视检查。
- Android与iPhone各12项真机验收尚未填写，不得固定稳定归档或提交审核。
- 正式纠错邮箱或可用微信客服入口尚未提供；不得虚构联系方式。
- `v2.3.0`体验版上传、测试成员验收、微信审核和正式发布尚未执行。
- 微信正式发布后仍先保持自动生产发布关闭；发布版读取复核通过并取得项目所有者明确授权后才能开启。
