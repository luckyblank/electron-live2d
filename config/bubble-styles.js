function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

// 气泡样式是按页面主题分组的产品配置。新增主题或样式时只需要在这里
// 注册元数据、在 bubble-component.js 中补上同名视觉规则；设置页会自动
// 生成选项，主窗口则根据持久化的 style id 切换实际气泡。
const BUBBLE_THEME_DEFINITIONS = deepFreeze({
  glass: {
    fallback: 'glass',
    styles: [
      { id: 'glass', name: '玻璃气泡', shortDescription: '清透柔光' },
      { id: 'sweet', name: '甜美气泡', shortDescription: '爱心柔光' },
      { id: 'pixel', name: '像素气泡', shortDescription: '复古像素' },
      { id: 'sci-fi', name: '科幻气泡', shortDescription: '未来 HUD' },
    ],
  },
  healing: {
    fallback: 'glass',
    styles: [
      { id: 'glass', name: '玻璃气泡', shortDescription: '柔粉玻璃' },
      { id: 'sweet', name: '甜美气泡', shortDescription: '爱心蝴蝶结' },
      { id: 'pixel', name: '像素气泡', shortDescription: '粉色像素' },
      { id: 'sci-fi', name: '科幻气泡', shortDescription: '柔光 HUD' },
    ],
  },
})

function normalizeTheme(theme) {
  return Object.prototype.hasOwnProperty.call(BUBBLE_THEME_DEFINITIONS, theme) ? theme : 'glass'
}

function normalizeBubbleStyle(theme, styleId) {
  const definition = BUBBLE_THEME_DEFINITIONS[normalizeTheme(theme)]
  if (definition.styles.some(style => style.id === styleId)) return styleId
  return definition.fallback
}

function normalizeBubbleStyles(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return Object.fromEntries(Object.keys(BUBBLE_THEME_DEFINITIONS).map(theme => [
    theme,
    normalizeBubbleStyle(theme, source[theme]),
  ]))
}

module.exports = {
  BUBBLE_THEME_DEFINITIONS,
  normalizeBubbleStyle,
  normalizeBubbleStyles,
}
