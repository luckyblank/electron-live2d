# 发版与版本更新流程

应用内置「检查更新」：打开设置（系统页）时自动请求
`https://qny.luckyblank.cn/live2d-pet/latest.yml`，比较其中的
`version` 与应用当前版本，发现新版本时显示「下载更新」按钮
（打开浏览器下载对应安装包）。

## 发布一个新版本

1. **改版本号**：修改 `package.json` 的 `version`（必须高于线上
   `latest.yml` 里的版本号，否则不会提示更新）。

2. **打包**：

   ```bash
   npm run release
   ```

   产物在 `dist/`：

   - `Live2DCompanion-Setup-<version>.exe` — 安装包（`build.artifactName` 统一为连字符命名）
   - `latest.yml` — 更新清单（`version`、安装包文件名、sha512）
   - `Live2DCompanion-Setup-<version>.exe.blockmap` — 差异更新用（当前未启用，可不上传）

3. **上传到 CDN**：把安装包、`latest.yml` 和发布说明上传到
   `https://qny.luckyblank.cn/live2d-pet/`（三者同目录）：

   - `Live2DCompanion-Setup-<version>.exe`
   - `latest.yml`
   - 发布说明 —— 内容取 `release/release-notes-<version>.md`，
     以同名文件上传（应用按 `release-notes-<version>.md` 查找并
     以 Markdown 渲染展示）

   > 应用下载按钮的地址由 `latest.yml` 里的 `path` 字段相对
   > `latest.yml` 自身的 URL 解析，所以文件名必须与 CDN 上的
   > 实际文件名一致。发布说明文件名格式固定为
   > `release-notes-<版本号>.md`。

4. **验证**：打开应用设置 → 系统页，应显示「发现新版本
   v\<version\>」并出现「下载更新」按钮；手动点「检查更新」
   可随时重查。

## 版本比较规则

`latest.yml` 的 `version` 与应用版本按 `x.y.z` 数字段比较。
例如线上 `1.0.1`、本地 `1.0.0` → 提示更新；相同则不提示。

## 应用内相关实现

- 检查逻辑：`main.js` 中 `update:check`（`UPDATE_MANIFEST_URL`）
- 设置页 UI：`renderer/settings.html` / `settings.js` 的版本更新面板
