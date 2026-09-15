# 发版与七牛云更新流程

应用内置“检查更新”：打开设置的系统页时自动请求
`https://qny.luckyblank.cn/live2d-pet/latest.yml`，比较其中的
`version` 与应用当前版本。发现更高版本后显示“下载更新”按钮，
安装包地址由 `latest.yml` 中的 `path` 相对该清单 URL 解析。

`npm run release` 已串联检查、Windows 打包、七牛云覆盖上传和 CDN
文件缓存刷新。任何构建产物、配置、上传或刷新错误都会使命令以非零状态退出。

## 1. 配置七牛云

复制示例配置并填写真实值：

```powershell
Copy-Item .env.example .env
```

`.env`、`.env.*` 已加入 `.gitignore`；electron-builder 的 `build.files`
只排除项目根目录 `.env`。依赖包内部的同名文件不属于项目发版配置，无需
额外排除。不要把 Access Key、Secret Key 或包含真实密钥的环境文件提交到
仓库、打入安装包或粘贴到发布日志。

脚本优先读取项目根目录 `.env` 中的非空值；某项为空或未配置时，再读取
当前进程的同名系统环境变量。
也可以通过 `RELEASE_ENV_FILE` 或 `--env-file <path>` 指定其他配置文件。

### 必填变量

| 变量 | 用途 |
|---|---|
| `QINIU_ACCESS_KEY` | 七牛云账号 Access Key |
| `QINIU_SECRET_KEY` | 七牛云账号 Secret Key |
| `QINIU_BUCKET` | 保存发布文件的 Kodo 空间名称 |

### 可选变量

| 变量 | 默认值 | 用途 |
|---|---|---|
| `QINIU_CDN_BASE_URL` | `https://qny.luckyblank.cn` | 用于拼接待刷新的公开 CDN URL |
| `QINIU_KEY_PREFIX` | `live2d-pet` | 三个发布对象在 Bucket 中的目录前缀；设为空字符串可上传到根目录 |
| `QINIU_REGION` | `auto` | 空间区域；支持 `auto`、`z0`、`cn-east-2`、`z1`、`z2`、`na0`、`as0` |
| `QINIU_UPLOAD_ACCELERATE` | `false` | 是否启用七牛上传加速；仅在空间已开通该能力时设为 `true` |
| `QINIU_UPLOAD_TOKEN_TTL_SECONDS` | `7200` | 每个覆盖上传凭证的有效秒数 |
| `QINIU_RESUME_THRESHOLD_MB` | `4` | 达到该大小后使用分片上传 v2；安装包默认走分片上传 |
| `QINIU_REFRESH_CACHE` | `true` | 全部上传成功后是否提交 CDN 文件刷新 |
| `QINIU_HTTP_TIMEOUT_MS` | `30000` | CDN 刷新 API 请求超时时间 |
| `RELEASE_DIST_DIR` | `dist` | electron-builder 产物目录，支持绝对路径或项目根目录相对路径 |
| `RELEASE_NOTES_DIR` | `release` | 版本说明目录，支持绝对路径或项目根目录相对路径 |
| `RELEASE_DEBUG` | `false` | 设为 `true` 时，失败日志额外输出调用栈；不会主动打印密钥 |

## 2. 发布文件

脚本固定验证并上传以下三个文件：

1. `dist/Live2DCompanion-Setup-<version>.exe`
2. `dist/latest.yml`
3. `release/release-notes-<version>.md`

实际 EXE 文件名从 `latest.yml > path` 读取，版本号必须与
`package.json > version` 完全一致。缺少文件、文件为空、清单版本不一致、
清单指向非 EXE 文件或路径越出 `dist/` 时，上传会在连接七牛云前失败。

默认远程位置为：

```text
live2d-pet/Live2DCompanion-Setup-<version>.exe
live2d-pet/release-notes-<version>.md
live2d-pet/latest.yml
```

上传顺序为 EXE、版本说明、`latest.yml`。更新清单最后覆盖，避免用户先读取到
一个指向尚未上传安装包的新版本。每个文件使用绑定
`<bucket>:<object-key>` 且 `insertOnly: 0` 的上传凭证，因此同名对象会被覆盖。

全部上传成功后，脚本通过七牛官方 HTTPS 缓存刷新 API 一次性刷新这三个
公开 URL。刷新请求被七牛接受后即视为发布脚本成功；全网节点实际生效通常
仍需要数分钟。

## 3. 发布一个新版本

1. 修改 `package.json` 的 `version`。版本必须高于线上 `latest.yml`，
   否则已安装应用不会提示更新。
2. 更新 `release/release-notes-<version>.md`，并同步
   `release/release-notes.md` 索引。
3. 配置 `.env` 或系统环境变量。
4. 先预览计划，确认本地文件、Bucket、对象 Key 和刷新 URL：

   ```bash
   npm run release:upload:dry-run
   ```

5. 执行完整发布：

   ```bash
   npm run release
   ```

完整命令依次执行：

```text
npm run package:win
  -> npm run check
  -> electron-builder --win
npm run release:upload
  -> 校验版本和三个本地文件
  -> 覆盖上传 EXE
  -> 覆盖上传版本说明
  -> 覆盖上传 latest.yml
  -> 刷新三个 CDN 文件 URL
```

如打包已经完成，只需重新上传，可以单独执行：

```bash
npm run release:upload
```

如只需要重新上传但暂时不刷新 CDN，可显式执行：

```bash
   npm run release:upload:no-refresh
```

该选项只用于排障；正式覆盖发布默认必须刷新缓存。

## 4. 构建内容与验证

`package.json > build.files` 会排除 `设计稿/`、`design-demos/`、`docs/`、
`plan/`、`release/`、`qa/`、项目根目录 `.env`、发版上传脚本和其他开发期
文件，避免把设计资料、测试、发布说明源文件或凭据带入 `app.asar`。依赖包
内部的 `.env` 不做全局过滤。

发布后至少完成以下检查：

1. 检查安装包或 `app.asar`，确认不存在上述开发目录和项目根目录 `.env`。
2. 打开 CDN 上的 `latest.yml`，确认 `version`、`path` 和 `sha512` 为本次构建。
3. 下载远程 EXE 并核对文件名、大小；必要时与本地文件计算哈希比对。
4. 打开远程 `release-notes-<version>.md`，确认 Markdown 内容完整。
5. 打开旧版本应用的设置 → 系统页，确认显示“发现新版本 v<version>”并能打开下载地址。
6. 若刷新后仍看到旧文件，等待七牛刷新任务生效，并排除浏览器本地缓存后再验证。

## 5. 版本比较规则

`latest.yml` 的 `version` 与应用版本按 `x.y.z` 数字段比较。例如线上
`1.0.2`、本地 `1.0.1` 时提示更新；版本相同则不提示。

## 6. 相关实现

- 打包与上传命令：`package.json > scripts.package:win / release:upload / release`
- 七牛云上传与刷新：`scripts/release-upload.js`
- 发版脚本 QA：`qa/release-upload.cjs`
- 检查更新：`main.js` 中 `update:check`（`UPDATE_MANIFEST_URL`）
- 设置页版本 UI：`renderer/settings.html` / `renderer/settings.js`
