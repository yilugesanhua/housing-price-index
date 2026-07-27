# 正式发布门禁

本地开发和工程验收使用普通`npm run build`。公开发布必须额外提供正式配置、完成外部验收声明，并运行`npm run release:check`。门禁不替代平台审核或法律意见。

## 正式配置

PowerShell示例：

```powershell
$env:VITE_PUBLIC_SITE_URL = "https://example.com"
$env:VITE_CONTACT_URL = "mailto:feedback@example.com"
$env:VITE_APP_ENV = "public"
npm.cmd run build
npm.cmd run release:check
```

- `VITE_PUBLIC_SITE_URL`必须是没有路径、查询或片段的HTTPS origin。
- `VITE_CONTACT_URL`必须是可用的`mailto:`邮箱或HTTPS客服/反馈页面。
- `VITE_APP_ENV=public`才会移除内部预览标识；未设置时页面明确显示“内部预览”。
- 正式构建会把`og:url`、`og:image`和canonical地址替换为绝对HTTPS地址，并在页脚显示“纠错与反馈”。

## 验收声明

填写`release/attestations.json`。每项记录必须包含：

```json
{
  "verified_at": "2026-07-15T00:00:00.000Z",
  "tester": "测试人或责任人",
  "device_or_os": "设备型号、系统或审查范围",
  "version": "微信或浏览器版本；法律审查可填n/a",
  "result": "passed"
}
```

必须完成Android微信、iPhone微信、Chrome/Edge/Safari当前与前一稳定版，以及正式主体、域名和用途的法律审查。不得复制`tests/fixtures/release-attestations.valid.json`冒充真实声明，该文件只用于自动化门禁测试。

微信真机至少执行：

1. 打开正式HTTPS链接，确认无需登录即可看到最新月份和六城概览。
2. 切换新房/二手房、环比/同比和36/60/120个月。
3. 触摸Tooltip、拖动图表、使用缩放按钮和图例。
4. 复制或分享带筛选参数的链接，重新打开后状态正确恢复。
5. 打开国家统计局来源、免责声明和纠错入口。
6. 横竖屏切换后无空白、裁切或页面水平溢出。

## 门禁检查

`release:check`会拒绝以下情况：

- 域名不是HTTPS origin，或纠错入口缺失/协议不安全。
- 构建后的OG图片和canonical不是正式域名绝对地址。
- 分享图不是1200×630 PNG。
- 发布数据不是`passed/current`。
- 任一微信真机、浏览器版本或法律审查声明缺失。
