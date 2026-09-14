# 宠物模型验证

在提交结论前，根据变更范围选择最小但足够的验证组合。不要把“文件存在”当成“模型可用”。

## 1. 静态检查

目录型模型：

```powershell
node -e "const m=require('./model-inspector'); console.log(m.inspectModelDirectory(process.argv[1]))" "models\my-character"
```

ZIP：

```powershell
node -e "const m=require('./model-inspector'); console.log(m.inspectModelArchive(process.argv[1]))" "models\my-character\my-character.zip"
```

预期结果至少满足：

- `status` 为 `ready`；
- `format` 与预期一致；
- Live2D 为 `cubismVersion: 3`；
- 视频宠物为 `format: video-pet`、`modelType: video`。

静态检查不能证明纹理、动作、表情、透明通道或首帧可绘制。

## 2. 命令矩阵

| 变更 | 至少运行 |
|---|---|
| 仅调整 `pet.json` 或透明 WebM | 静态 inspector、`npm run check`、`npm run qa:video` |
| 调整视频 renderer 或视频清单协议 | 上述项目，加 `npm run lint -- --quiet` |
| 增加/修改内置 Live2D 资源或反应档案 | inspector、`npm run check`、`npm run qa:models`、`npm run qa:reactions` |
| 调整目录型 Live2D 加载 | 上述相关项目，加 `npm run qa:directory` |
| 调整设置页模型卡、预览、排序或导入 | 目标模型 QA，加 `npm run qa:settings` |
| 调整设置动态背景或封面采集 | 目标模型 QA，加 `npm run qa:background` |
| 改主进程/renderer 通用模型边界 | `npm run check`、安静 lint、所有受影响的模型 QA |
| 发布安装包 | 仅在用户要求或发布流程要求时运行 `npm run package:win` |

`npm run qa:models` 对当前所有内置 Cubism 模型执行严格档案检查；新增内置 Live2D 模型时需要同步加入完整的 `MODEL_REACTION_PROFILES`，否则此检查会报告 `missingProfiles`。

## 3. Live2D 可观察验收

确认：

- 首次加载到 `ready`，画布有可见像素，没有连续错误日志；
- `Idle` 能稳定循环，不会被短动作永久打断；
- 头部与身体命中符合导出 Hit Area；
- 单击、双击、三击、长按和拖动结束映射到可用动作；
- 每个设置页动作预览确实开始播放并在适当时恢复；
- 每个表情预览产生参数变化，结束后恢复中性表情；
- 生气、脸红、泪水、特殊眼型等参数不会泄漏到下一表情；
- 鼠标跟随不会因生成表情被覆盖；
- 有 `LipSync` 时 TTS 能驱动口型；没有时准确报告能力边界；
- 模型缩放、隐藏/显示、暂停/恢复、切换角色和窗口唤醒稳定；
- 封面比例正确，角色没有被名字栏裁切；
- 设置页动态背景不会保留上一个模型的帧。

## 4. 视频宠物可观察验收

确认：

- 待机首帧在 400×600 画布中有足够的可见和透明像素；
- 可见主体中心与目标锚点一致；
- WebM 的透明通道在当前 Electron/Chromium 解码器中生效；
- `idle` 循环；非待机动画结束后返回 `idle`；
- 同一语义组的随机候选都存在且可解码；
- 切换视频源时旧帧保持到新首帧可用，没有透明闪烁；
- 精确 `video:<filename>` 动作可以从设置映射播放；
- 暂停、隐藏、唤醒和销毁不会继续解码或留下对象 URL；
- 切换离开视频模型后没有旧角色快照盖住新角色；
- 音频能播放，但测试或文档不声称有视频口型。

## 5. 回归失败时的定位顺序

1. 先看 `model-inspector.js` 的格式与路径结果。
2. 再看 renderer 的模型状态报告和第一条具体错误。
3. 检查资源描述中的大小写、相对路径、ZIP 层级和文件编码。
4. 检查动作/表情 stem 是否与 `config/model-reactions.js` 完全一致。
5. 检查更高优先级用户模型是否覆盖了仓库版本。
6. 只有确认现有协议无法表示需求后，才修改 loader 或 IPC。

## 6. 交付记录

最终报告应包含：

- 新增或修改的模型 ID 与格式；
- 内容变更与宿主代码变更分别是什么；
- 哪些动作/表情是原生、生成或回退；
- 实际运行的命令和结果；
- 未运行的高成本检查及原因；
- 已知素材能力边界；
- 素材来源、许可证和必须保留的 notice。
