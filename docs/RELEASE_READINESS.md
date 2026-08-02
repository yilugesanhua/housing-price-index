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

## 当前验收声明实现（schema 1）

当前 `scripts/release-readiness.mjs` 与 `release/attestations.json` 仍使用 `schema_version: 1`。它检查必需验收项和文本字段是否填写、结果是否为 `passed`，以及 `verified_at` 是否为可解析时间，但尚未把声明绑定到精确提交、当前构建、数据版本、正式域名或证据有效期。即使当前 `release:check` 通过，也不能据此关闭R06或证明这些声明属于本次构建。

现行文件中每项记录包含：

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

## 已批准的目标契约（schema 2）

R06要求把Web发布声明升级为构建级证据。实现后，`release/attestations.json` 必须使用 `schema_version: 2`，并至少包含：

```json
{
  "schema_version": 2,
  "release_id": "唯一发布身份",
  "source_commit_sha": "40位Git提交SHA",
  "build_manifest_sha256": "64位小写SHA-256",
  "dataset_version": "发布数据版本",
  "dataset_manifest_sha256": "发布数据清单SHA-256",
  "public_origin": "https://example.com",
  "evidence_bundle_sha256": "验收证据索引SHA-256",
  "issued_at": "ISO 8601时间",
  "expires_at": "ISO 8601时间",
  "attestations": {
    "android_wechat": {},
    "iphone_wechat": {},
    "chrome_current": {},
    "chrome_previous": {},
    "edge_current": {},
    "edge_previous": {},
    "safari_current": {},
    "safari_previous": {},
    "legal_review": {}
  }
}
```

绑定和有效性规则：

- `source_commit_sha` 必须等于本次构建检出的精确提交；分支名、短SHA或工作树当前状态不能替代。
- `build_manifest_sha256` 对生产 `dist/` 的规范化文件清单计算。清单按相对路径排序，每项固定记录路径、字节数和文件SHA-256；验收后任一构建文件变化都会产生新身份并使旧声明失效。
- `dataset_version` 与 `dataset_manifest_sha256` 必须从本次 `dist/data/manifest.json` 读取并校验；替换数据但沿用旧声明必须被拒绝。
- `public_origin` 必须与 `VITE_PUBLIC_SITE_URL` 及构建内 canonical、`og:url` 一致；域名变化后旧声明立即失效。
- `evidence_bundle_sha256` 指向一份规范化证据索引，索引逐项记录验收类型、测试人、设备/系统、软件版本、时间、结果和原始证据SHA-256。证据缺失、重复身份或哈希不符均拒绝发布。
- `issued_at` 和 `expires_at` 必须为有效时间且尚未过期。浏览器、微信和设备声明默认最长30天，法律审查默认最长90天；代码、构建、数据、域名、主体、用途或适用平台规则变化时，即使未到期也必须重新验收。
- 顶层身份必须应用到全部验收项；不得从不同提交、不同数据版本或不同域名拼接一份“完整”声明。

升级实现必须同时修改校验器、fixture和自动测试，覆盖提交不一致、构建内容变化、数据替换、域名变化、证据哈希错误、过期和未来时间。该代码变更不在本轮文档治理范围内；完成前R06保持 `partial/not_tested`。

## 门禁检查

`release:check`会拒绝以下情况：

- 域名不是HTTPS origin，或纠错入口缺失/协议不安全。
- 构建后的OG图片和canonical不是正式域名绝对地址。
- 分享图不是1200×630 PNG。
- 发布数据不是`passed/current`。
- 任一微信真机、浏览器版本或法律审查声明缺失。

升级到schema 2后还必须拒绝提交SHA、构建清单、数据版本、数据清单、正式域名或证据索引任一不匹配，以及任一声明过期。当前schema 1校验尚不具备这些检查。
