# DeepSeek 桌宠接入说明

## 1. 接入结果

本项目已增加内置角色 `deepseek-pet`，设置页、托盘和右键菜单会将它显示为“DeepSeek 小蓝鲸”。它与现有 Live2D 角色共用角色切换、独立缩放、点击/长按/拖动反馈、气泡、AI 对话、TTS 播放、设置页动态背景和封面缓存。

这次接入没有安装、调用或捆绑 DSH，也没有引入 Python、PySide6 或新的 npm 运行时依赖。

## 2. 方案选择

两个参考项目中的这只角色不是 Cubism 模型，而是 640×360 的 VP9 透明 WebM 动画集合：

- [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 提供原始动画资源、动作命名与行为配置。
- [MerZlin/dsh-pet-indesktop](https://github.com/MerZlin/dsh-pet-indesktop) 证明同一套 WebM 素材可以脱离 DSH 作为独立透明桌宠运行。

因此本项目没有把 WebM 伪装成 `.model3.json`，而是在现有模型边界上增加一个轻量的 `video-pet-v1` 类型：

1. 主进程扫描模型目录时识别 `pet.json`，检查至少一个待机动画并验证所有相对路径。
2. renderer 根据模型 `format` 选择原有 `Live2DCubismModel` 或新增的 `VideoPetModel`。
3. `VideoPetModel` 只负责加载透明 WebM、绘制到现有画布、切换语义动作和播放 TTS 音频。
4. 画布继续进入原有的命中蒙版、缩放、拖动、气泡、封面和设置背景链路。

这样保持了现有 Live2D 代码不变，也为后续增加同类视频宠物保留了清晰的小接口。

## 3. 首版素材范围

素材固定取自 `PC2005-cloud/dsh-pet` 提交：

```text
814b0e47812dfd51dbc2df4ca272b57403c5e9cd
```

首版挑选 14 段常用动画，共 6,367,703 字节：

- 待机：待机呼吸休闲。
- 基础互动：元气挥手、开心跃动、害羞惊讶、傲娇生气、挠痒咯咯笑。
- 行为：东张西望、大口吃零食、原地小憩沉眠、拖拽悬空、垂头叹气。
- 扩展反馈：鲸鱼吐泡泡、玩魔方、写代码。

没有搬入上游的一百余段完整素材库，避免首版安装体积和动作配置无必要膨胀。

## 4. 动作映射

`models/deepseek-pet/pet.json` 用语义键连接宿主互动和 WebM 文件：

| 语义键 | 宿主触发 | 当前示例 |
|---|---|---|
| `idle` | 首次加载、动作结束、闲置反馈 | 待机呼吸休闲 |
| `tap` | 单击身体、普通点击的最终兜底 | 5 种点击回应随机选择 |
| `greet` | “打个招呼” | 元气挥手 |
| `head` | 摸头、头部长按 | 挠痒或害羞 |
| `happy` | 夸奖、双击/三击、开心情绪 | 开心跃动 |
| `snack` | “投喂点心” | 大口吃零食 |
| `shy` | AI 害羞情绪 | 害羞惊讶 |
| `curious` | AI 疑惑情绪 | 环顾、吐泡泡、玩魔方或写代码 |
| `surprised` | AI 惊讶情绪 | 害羞惊讶 |
| `sleepy` | 长按安静陪伴、AI 平静情绪、闲置休息 | 原地小憩沉眠 |
| `sad` | AI 难过情绪 | 垂头叹气冒汗 |
| `angry` | AI 生气情绪 | 傲娇生气 |
| `drag` | 完成一次明显拖动 | 被鼠标拖拽悬空反馈 |

非待机动画播放完会自动回到循环待机。若某个语义键缺失，适配层按保守的互动兜底顺序回落，最终使用 `idle`。

## 5. 文件改动

| 文件/目录 | 改动 |
|---|---|
| `models/deepseek-pet/` | 新增 `pet.json`、素材声明和 14 段透明 WebM |
| `model-inspector.js` | 新增 `video-pet-v1` 清单识别、路径约束与资源完整性检查 |
| `main.js` | 向模型元数据透传格式/类型/清单名称，封面任务保留模型类型；通用角色提示词不再限定为 Live2D |
| `renderer/video-pet-model.js` | 新增视频宠物渲染、语义动作、暂停/恢复、资源释放和普通 TTS 播放适配 |
| `renderer/app.js` | 按模型格式创建 renderer，并让预览、缩放、唤醒检查、暂停、头部点击和封面生成兼容视频角色 |
| `config/defaults.json` | 新增 `deepseek-pet` 默认角色档案 |
| `package.json` | 将视频适配层加入 `npm run check` |
| `qa/video-pet-smoke.cjs` | 对透明首帧和 `greet` 动作做一次最小 Electron 冒烟验证 |
| `README.md` | 说明混合模型能力、目录格式、许可和来源 |

## 6. 后续扩展

### 给当前角色增加动画

1. 将新的透明 `.webm` 放入 `models/deepseek-pet/`。
2. 在 `pet.json` 对应语义键的数组中加入文件名。
3. 从托盘执行“刷新模型列表”。

同一语义键有多个文件时会随机选择。新增文件必须留在当前角色目录内；绝对路径、`..` 越级路径和非 WebM 文件都会被扫描器拒绝。

### 增加另一只视频宠物

在任一模型根目录新建独立 ID 目录：

```text
models/my-video-pet/
├── pet.json
├── idle.webm
└── greet.webm
```

最小清单如下：

```json
{
  "format": "video-pet-v1",
  "name": "我的视频宠物",
    "render": { "width": 0.96, "anchor": "center" },
  "animations": {
    "idle": ["idle.webm"],
    "greet": ["greet.webm"]
  }
}
```

`render.width` 表示视频相对 400 px 宠物窗口的基础宽度比例，允许范围为 `0.35`～`1.4`。`render.anchor` 可设为 `center`，使视频画面中心与宠物视口中心对齐；省略时继续使用底部锚定，`render.bottom` 表示视频底部距离窗口底边的像素数。角色缩放仍由现有设置按模型独立保存。

## 7. 已知边界

- 视频角色是预渲染动画，没有 Live2D 的实时头眼跟随、参数表情或语音口型；TTS 可以正常播放，但不会驱动嘴型。
- 当前产品目标为 Windows Electron；素材使用 VP9 WebM 透明通道，不额外引入 GIF/MOV 回退格式。
- 当前设置页的 ZIP 导入入口仍只负责 Cubism ZIP。视频宠物通过目录方式添加，避免扩张首版导入协议。

## 8. 许可与分发

上游 `PC2005-cloud/dsh-pet` 的 README 明确说明：代码使用 MIT；动画、提示词和源视频允许开源使用、禁止商用；衍生、改版、展示或分发时须附原作者 GitHub 地址。

本项目把同样的说明保存在 `models/deepseek-pet/NOTICE.txt`，该文件不会被安装包的 Markdown 排除规则过滤。任何后续发布、演示或再分发都应保留该文件和仓库地址。若计划商用，必须先另行取得素材权利人的授权或替换为拥有商用权的自制素材。

## 9. 验证记录

- `npm run check`：通过。
- `npm run lint -- --quiet`：通过。
- `npm run qa:video`：通过；待机首帧检测到 20,961 个可见像素、219,039 个透明像素，`greet` 切换到“点击回应-元气挥手”。
- `inspectModelDirectory(models/deepseek-pet)`：返回 `status: ready`、`format: video-pet`。
- 待机素材探测：VP9、640×360、24 fps。

按用户要求，本次没有执行完整打包、全量 QA 或长时间稳定性测试。

## 10. 展示与双击闪动修复（2026-09-13）

本轮针对 DeepSeek 视频宠物做了三处小范围修正：

- `renderer/app.js`：生成视频宠物封面时按透明像素包围盒裁切，并保留 10% 安全边距后等比放入竖版封面，避免把整张 16:9 视频画布缩进角色卡而导致角色过小、下半身落入名称栏。
- `renderer/settings.js`、`renderer/settings-reference.css`：为视频宠物缩略图增加类型标记；角色选择卡把封面图片固定到网格行的实际尺寸，避免图片按固有纵横比继续增高后被名称栏裁切；角色档案和气泡样式预览使用完整 `contain` 构图，不再套用普通 Live2D 头像的放大、上移裁切。
- `renderer/video-pet-model.js`：切换 WebM 动作期间保留画布上一帧，等新视频首帧可绘制后再清屏重绘，消除双击触发动作时的透明闪帧。
- `main.js`：封面缓存版本由 `centered-v3` 升至 `centered-v4`，启动后会自动重新生成封面，无需用户手工清缓存。
- `qa/video-pet-smoke.cjs`：在原有透明通道与动作切换冒烟检查上，增加“切换期间仍有可见像素”的最小回归断言。

修复保持 `video-pet-v1` 清单和现有 Live2D 渲染链路不变，没有新增依赖或设置项。

验证结果：`npm run check` 与相关文件 ESLint 通过；`npm run qa:video` 通过，动作切换瞬间仍保留 20,961 个可见像素。新封面尺寸为 220×280，可见角色边界为 176×219，四周分别保留约 10% 的透明安全区。

## 11. 桌面视口居中修复（2026-09-13）

DeepSeek 素材此前沿用了视频宠物的底部锚点，完整视频帧贴近 400×600 宠物窗口底部，导致角色主体明显落在视口下半区。本轮在 `video-pet-v1` 的 `render` 配置中增加可选的 `anchor: "center"`：DeepSeek 使用中心锚点后，视频帧和角色主体随画布尺寸变化始终保持在视口中心；其他未声明该字段的视频宠物仍按原来的 `bottom` 规则落地显示。该调整不会改变用户为每个模型保存的独立缩放比例。

最小冒烟检查测得角色可见区域中心为 `Y=311`，与 400×600 视口中心 `Y=300` 相差 11 px，偏差来自素材内部构图且处于允许范围；动作切换期间仍保留 20,944 个可见像素，没有重新引入透明闪帧。
