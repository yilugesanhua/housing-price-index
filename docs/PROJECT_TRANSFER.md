# 项目接手与 GitHub 备份说明

> 核验日期：2026-08-07。GitHub 仓库为公开仓库 [`yilugesanhua/housing-price-index`](https://github.com/yilugesanhua/housing-price-index)。本文只说明如何取得、启动和维护当前项目，不代表 Web、小程序或远程数据的当前线上状态已经重新验收。

## 1. 推荐的接手方式

优先使用 Git 克隆。这样会同时取得完整文件和版本历史，后续也能正常拉取、提交和回退。

在 Windows PowerShell 中运行：

```powershell
Set-Location "$env:USERPROFILE\Desktop"
git -c core.autocrlf=false clone https://github.com/yilugesanhua/housing-price-index.git
Set-Location ".\housing-price-index"
git config core.autocrlf false
git status --short
```

最后一条命令没有输出，表示刚下载的工作区没有本地改动。

这里的 `core.autocrlf=false` 很重要：项目的生成文件校验按LF字节比较。2026-08-07实测，普通Windows Git在全局 `core.autocrlf=true` 时会把 `packages/design-tokens/tokens.wxss` 和 `tokens.json` 检出为CRLF，导致 `npm.cmd run check` 报“设计令牌生成文件不是最新版本”；两份文件当时仅换行不同。第一条命令保护首次检出，第二条只把设置保存在当前仓库的 `.git/config`，不会改变其他项目或电脑的全局Git设置。

不使用 Git 时，可打开仓库网页，依次点击 `Code`、`Download ZIP`，解压后在项目文件夹空白处右键并选择“在终端中打开”。这种方式可以运行项目，但不包含 `.git` 版本历史，后续提交代码前仍建议改用 Git 克隆。

如果已经用普通命令克隆并遇到上述设计令牌错误，最稳妥的处理是删除这个刚克隆且尚未开始工作的副本，再严格按本节命令重新克隆。不要运行生成命令覆盖文件，也不要在已有工作内容的目录中执行强制还原。

项目交接 Release：[`project-handoff-2026-08-07`](https://github.com/yilugesanhua/housing-price-index/releases/tag/project-handoff-2026-08-07)。Release 中的项目快照是便于离线备份的副本；日常维护仍以仓库 `main` 分支为准。

## 2. 新电脑需要准备什么

| 项目 | 什么时候需要 | 已核验要求 |
| --- | --- | --- |
| Git for Windows | 推荐；用于克隆和版本管理 | 当前仓库可通过公开 HTTPS 地址克隆 |
| Node.js | Web、数据脚本和自动检查都需要 | `package.json` 要求 Node.js 20 或更高版本 |
| npm | 安装依赖和运行命令 | 随 Node.js 安装；必须保留并使用仓库中的 `package-lock.json` |
| Playwright 浏览器 | 首次运行 Web 端到端测试时需要 | 安装 Chromium 和 WebKit |
| 微信开发者工具 | 查看或编译小程序时需要 | 导入 `70城小程序技术验证/`；平台登录和开发者权限需另行移交 |

项目本地运行不需要 `.env`。本次核验时仓库和工作区均没有 `.env` 文件，真实密钥也不应放进项目目录。

## 3. 首次安装、检查和启动

在项目根目录依次运行：

```powershell
node --version
npm.cmd --version
npm.cmd ci
npx.cmd playwright install chromium webkit
npm.cmd run check
npm.cmd run test:e2e
npm.cmd run dev
```

成功判断：

- `node --version` 显示 `v20` 或更高版本。
- `npm.cmd ci` 正常结束，没有依赖安装错误。
- `npm.cmd run check` 和 `npm.cmd run test:e2e` 最终退出码为 0。
- `npm.cmd run dev` 显示本地地址；浏览器打开 `http://127.0.0.1:5173/` 能看到页面。
- 开发服务占用当前终端；按 `Ctrl+C` 停止。

E2E测试会比较并按需更新 `docs/screenshots/mobile-390x844.png`、`desktop-1440x900.png` 和 `city-picker-mobile.png`。不同浏览器渲染可能让测试通过但截图文件发生变化。测试结束后运行：

```powershell
git status --short
```

若本次没有界面改动，且状态中只有上述测试截图变化，可在确认路径后恢复仓库版本：

```powershell
git restore -- docs/screenshots/mobile-390x844.png docs/screenshots/desktop-1440x900.png docs/screenshots/city-picker-mobile.png
```

这条恢复命令会丢弃这三份截图的本地变化。已有界面工作、需要保留新截图或状态中还有其他文件时，不要执行；应先确认每项改动的来源。

需要关闭终端后继续预览生产构建时，使用：

```powershell
npm.cmd run build
npm.cmd run dev:start
npm.cmd run dev:status
```

停止后台预览：

```powershell
npm.cmd run dev:stop
```

PowerShell 如果阻止 `npm.ps1`，不要修改系统执行策略，直接使用本文中的 `npm.cmd` 和 `npx.cmd`。

## 4. 微信小程序如何打开和修改

1. 打开微信开发者工具，点击“导入项目”。
2. 项目目录选择仓库中的 `70城小程序技术验证/`。
3. 项目名和 AppID 已在公开的 `project.config.json` 中；AppID 不是密钥。登录、开发者角色和上传权限不会随 GitHub 文件自动获得，必须由小程序管理员另行添加账号权限。
4. 日常修改只能在 `apps/miniprogram/` 中进行；`70城小程序技术验证/` 只是开发者工具同步副本。
5. 任何会进入小程序构件的改动都必须按 `docs/MINIPROGRAM_VERSIONING.md` 递增版本，然后运行：

```powershell
npm.cmd run miniprogram:sync
npm.cmd run test:miniprogram
```

6. 同步后重新编译开发者工具，并按影响范围重新完成 Android 和 iPhone 验收。不得把源码版本、开发者工具编译、真机通过、平台上传、审核和正式发布合并成一个“已完成”状态。

本次交接没有修改或重新编译小程序，也没有递增 `v2.5.15`。

## 5. GitHub 已包含和未包含的材料

### 已包含，可直接从仓库取得

- Web 源码：`apps/web/`
- 小程序唯一源码：`apps/miniprogram/`
- 微信开发者工具同步目录：`70城小程序技术验证/`
- 共享核心和设计令牌：`packages/`
- 数据采集、校验、发布和小程序同步脚本：`scripts/`
- 180 个月官方压缩来源档案和批次复现文件：`data/raw/**/*.html.gz`、`data/raw/**/*.batch.json`
- 标准化数据、修订账本、Web 发布数据和小程序内置数据
- 测试、CI 工作流、产品规范、验收记录和交接文档
- 已有稳定小程序归档：`release/miniprogram/`；当前只含历史稳定版本，不含 `v2.5.15` 稳定归档
- 个人“可信开发工作流”备份：`tools/codex-skills/verified-dev-workflow/`

### 未进入 Git，可按命令重新生成

- `node_modules/`：运行 `npm.cmd ci`
- `apps/web/dist/`：运行 `npm.cmd run build`
- Playwright 报告、测试结果、日志和开发服务器状态
- `data/raw/**/*.html` 未压缩本地缓存；仓库保留对应确定性 `.html.gz` 复现档案
- `work/` 中的临时下载、候选、回放过程文件和私有审计材料

### 只放在本次 GitHub Release 的补充材料

- `小程序源码-v2.5.15.zip` 和 `candidate-manifest.json`：2026-08-06 候选的历史交接构件，不是新的稳定归档，也不证明当前线上版本。
- 自动更新回放证据包：绑定 GitHub Actions 运行 `31137756505` 和 `31137756549` 的历史报告。
- `SHA256SUMS.txt`：本次 Release 附件的 SHA-256 校验值。

### 禁止上传或必须另行授权

- `.env`、`.env.*`、私钥、证书、Cookie、验证码、账号密码和任何真实密钥。
- `project.private.config.json`；这是微信开发者工具的个人本机配置。
- GitHub Secrets、腾讯云密钥、微信公众平台登录信息和身份材料。
- 原始 Codex 会话、用户截图中的个人信息以及整份 `work/`。

仓库已通过 `.gitignore` 排除上述常见本地文件，但提交前仍必须检查 `git status`，不能只依赖忽略规则。

## 6. 必须单独移交的账号和权限

GitHub 只能备份文件，不能自动移交外部平台控制权。项目负责人应通过各平台的成员管理功能添加同事账号，不要发送自己的密码、验证码或密钥。

| 平台 | 需要单独确认的权限 | 当前可确认状态 |
| --- | --- | --- |
| GitHub | 仓库写入、Pull Request、Actions、Environment 审批和 Secrets 管理 | 仓库公开可读；同事写权限未验证 |
| 微信公众平台 | 小程序开发者、体验、上传、审核和发布权限 | 权限不会随仓库下载；同事权限未验证 |
| 腾讯云 CloudBase/COS/SCF | 只读检查、候选写入、生产发布和回滚所需的最小权限 | 账号移交状态未验证 |
| Web 托管、域名和 DNS | 部署、证书、域名解析和反馈入口 | 当前正式平台、域名和账号均未知 |

生产操作前必须先阅读 `HANDOFF.md`、`docs/AUTOMATION_ACTIVATION_CHECKLIST.md` 和 `docs/MINIPROGRAM_DATA_UPDATE.md`。当前自动更新状态文档存在冲突，任何生产写入都必须先现场回读并按失败关闭处理。

## 7. GitHub 文件大小风险

本次核验时有三个受 Git 管理的文件大小均为 `101,957,189` 字节：

- `apps/web/public/data/data.json`
- `apps/web/public/data/data-2026-06-7231b82f3664.json`
- `data/normalized/records.json`

GitHub 单文件上限是 100 MiB，即 `104,857,600` 字节；每个文件只剩 `2,900,411` 字节余量。当前文件仍可由 GitHub 正常保存和下载，但后续数据更新如果使任一文件继续增大到上限，推送会被拒绝。数据更新前必须先检查生成文件大小；超过或接近上限时先设计并验证拆分方案，不能手工删数据或修改生成文件冒充结果。

## 8. 在另一台电脑安装个人工作流

项目本身不依赖这个 Skill；它是每次开发时用于保护修改范围和记录验证证据的 Codex 工作流。GitHub 只保存了源文件，不会自动安装到新电脑。

在仓库根目录运行以下 PowerShell。若目标目录已经存在，命令只提示，不会覆盖已有版本：

```powershell
$skillSource = Join-Path (Get-Location) "tools\codex-skills\verified-dev-workflow"
$skillRoot = Join-Path $env:USERPROFILE ".agents\skills"
$skillTarget = Join-Path $skillRoot "verified-dev-workflow"

if (Test-Path -LiteralPath $skillTarget) {
  Write-Host "目标已存在，请先比较版本：$skillTarget"
} else {
  New-Item -ItemType Directory -Force -Path $skillRoot | Out-Null
  Copy-Item -Recurse -LiteralPath $skillSource -Destination $skillTarget
  Write-Host "安装完成：$skillTarget"
}
```

该 Skill 的辅助工具要求 `uv`。安装后可在新的 PowerShell 中检查：

```powershell
uv run "$skillTarget\scripts\workflow_guard.py" --help
```

如果系统提示找不到 `uv`，只表示个人工作流工具尚不能运行，不影响本项目的 Node.js 安装、测试和启动。Skill 的设计、使用边界和已验证结果见 `docs/VERIFIED_DEV_WORKFLOW_SKILL_DESIGN.md`。

## 9. 接手第一天清单

- [ ] 从 GitHub 克隆或下载并确认文件完整。
- [ ] 阅读 `AGENTS.md`、`HANDOFF.md`、本文件和 `docs/DOCUMENT_INDEX.md`。
- [ ] 运行 `npm.cmd ci`、`npm.cmd run check` 和 `npm.cmd run test:e2e`。
- [ ] 启动 Web 并打开 `http://127.0.0.1:5173/`。
- [ ] 需要维护小程序时，确认微信公众平台角色并导入同步目录。
- [ ] 需要云端或发布操作时，先确认 GitHub、腾讯云和微信权限，不共享凭据。
- [ ] 修改前先运行 `git status --short`，确认没有来源不明的本地改动。
- [ ] 生产操作前重新核对自动更新双开关、当前提交 CI、生产指针和未关闭门槛。
