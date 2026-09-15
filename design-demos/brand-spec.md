# Live2D Companion · Brand Spec

> 采集日期：2026-09-15
> 资产来源：当前仓库与本机隔离 QA 截图
> 资产完整度：产品 Logo、主题图、真实 Video Pet 素材与现有 UI 均完整；部分 Live2D 角色封面只在应用运行时生成。
>
> **适用边界：** 本文是品牌资产、色板与历史原型的补充说明。正式 UI 开发以 [`../设计稿/`](../设计稿/README.md) 中选定的设计图为视觉事实来源；两者冲突时以设计稿为准，现有代码与产品文档仅负责补齐设计稿未表达的功能事实。

## 核心资产

### Logo

- 主版本：`../resources/icon@2x.png`
- SVG 版本：`../resources/icon.svg`
- 小尺寸版本：`../resources/icon-64.png`
- 使用：标题栏、品牌签名与原型工具条。
- 禁区：不可拉伸、描边、重画或改变内部渐变关系。

### 产品 UI

- 目标视觉：`../设计稿/` 中与任务主题、页面和状态匹配的设计图。
- 源界面：`../renderer/settings.html`
- 源样式：`../renderer/settings.css`
- 源交互：`../renderer/settings.js`
- QA 参考截图：由 `npm run qa:settings` 在隔离的临时用户数据目录生成；本次核对覆盖玻璃与治愈主题的角色、行为、AI、系统八个页面，QA 结果 `passed: true`。
- 使用：设计稿决定目标视觉；源界面与产品文档决定真实文案、控件状态和产品行为。设计稿没有展示的状态可参考现有 UI 补齐，但不得覆盖设计稿已经明确的布局和风格。

### 角色影像

- 真实透明视频：`../models/deepseek-pet/待机呼吸休闲.webm`
- 动作影像：同目录中的挥手、开心、害羞、困倦、拖动与工作状态 WebM。
- 使用：桌面伙伴主角、说话/互动反馈与模型卡片。
- 其他角色：若没有稳定的项目内封面，显示「封面由正式应用运行时生成」，不以手绘 SVG/CSS 剪影代替。

### 主题资产

- 玻璃主题：`../renderer/assets/theme-glass.png`
- 治愈主题：`../renderer/assets/theme-healing.png`
- 使用：主题选择器与低透明度环境纹理；不可大面积重复平铺。

## 色板

### 玻璃主题

- Canvas：`#E9EBFF`
- Surface：`rgba(255, 255, 255, 0.72)`
- Ink：`#202449`
- Muted：`#666B91`
- Primary：`#7356F6`
- Primary deep：`#5942D9`
- Primary soft：`#E2DFFF`
- Success：`#058449`
- 金色签名：`#F7C86A`

### 治愈主题

- Canvas：`#FFFAF2`
- Surface：`rgba(255, 253, 249, 0.90)`
- Ink：`#302747`
- Muted：`#796E86`
- Primary：`#D44291`
- Primary soft：`#FFF0F7`
- Secondary：`#8268E8`
- Star：`#F7C86A`
- Success：`#3F8A68`

## 字型

- 中文 Display：`STKaiti`, `KaiTi`, `Microsoft YaHei UI`。
- 拉丁 Display：`Segoe UI Variable Display`, `Trebuchet MS`。
- Body：`Microsoft YaHei UI`, `Microsoft YaHei`, `DengXian`, sans-serif。
- Mono：`Cascadia Code`, `Consolas`, monospace。

## 签名细节

- 「伙伴脉冲环」是本原型做到 120% 的细节：真实透明角色位于柔光同心环中，状态变化会改变呼吸、跟随与语音脉冲。
- 页面不是卡片拼贴，而以大段留白、细分隔线、少量浮层和连续的信息带形成层级。
- 设置动作会直接反馈到桌面角色、气泡或背景，强化“设置的是一个伙伴”的因果关系。

## 禁区

- 不使用通用深蓝 SaaS 背景和青紫霓虹。
- 不把所有内容包成同款圆角卡片。
- 不使用 Emoji 作为正式图标。
- 不编造营销数据、评价或用户规模。
- 不用 SVG/CSS 绘制假的动漫角色。
- 不在玻璃主题外随意增加新的紫色或蓝色。

## 气质关键词

- 温柔
- 通透
- 有生命感
- 私密
- 稳定
