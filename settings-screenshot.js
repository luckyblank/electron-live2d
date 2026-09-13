const fs = require('fs')

const MAX_SCREENSHOT_EDGE = 30000
const SETTINGS_SECTIONS = new Set(['characters', 'behavior', 'ai', 'system'])
const PROFILE_TABS = new Set(['basic', 'world', 'actions', 'expressions', 'interactions'])

function normalizedSection(value) {
  return SETTINGS_SECTIONS.has(value) ? value : 'characters'
}

function normalizedCaptureState(value, fallbackSection) {
  const state = value && typeof value === 'object' ? value : {}
  return {
    section: normalizedSection(state.section || fallbackSection),
    profileTab: PROFILE_TABS.has(state.profileTab) ? state.profileTab : 'basic',
    profileCollapsed: Boolean(state.profileCollapsed),
  }
}

function normalizedGeometry(value) {
  if (!value || typeof value !== 'object') throw new Error('设置面板没有返回可截图区域')
  const geometry = {
    x: Math.max(0, Math.floor(Number(value.x) || 0)),
    y: Math.max(0, Math.floor(Number(value.y) || 0)),
    width: Math.ceil(Number(value.width) || 0),
    height: Math.ceil(Number(value.height) || 0),
    section: normalizedSection(value.section),
    profileTab: PROFILE_TABS.has(value.profileTab) ? value.profileTab : 'basic',
    profileCollapsed: Boolean(value.profileCollapsed),
  }
  if (geometry.width < 1 || geometry.height < 1) throw new Error('设置面板截图尺寸无效')
  if (geometry.width > MAX_SCREENSHOT_EDGE || geometry.height > MAX_SCREENSHOT_EDGE) {
    throw new Error(`设置面板过长，单边不能超过 ${MAX_SCREENSHOT_EDGE} 像素`)
  }
  return geometry
}

async function captureSettingsPanel({ browserWindow, section, state, outputPath }) {
  if (!browserWindow || browserWindow.isDestroyed()) throw new Error('设置面板暂不可用')
  if (typeof outputPath !== 'string' || !outputPath) throw new Error('没有选择截图保存位置')

  const webContents = browserWindow.webContents
  const captureState = normalizedCaptureState(state, section)
  let prepared = false
  const originalContentSize = browserWindow.getContentSize()

  try {
    const geometryValue = await webContents.executeJavaScript(
      `window.settingsLongScreenshot.prepare(${JSON.stringify(captureState)})`,
      true
    )
    prepared = true
    let geometry = normalizedGeometry(geometryValue)
    browserWindow.setContentSize(geometry.width, geometry.height, false)
    const settledValue = await webContents.executeJavaScript('window.settingsLongScreenshot.settle()', true)
    const settledHeight = Math.ceil(Number(settledValue && settledValue.height) || 0)
    if (settledHeight > geometry.height && settledHeight <= MAX_SCREENSHOT_EDGE) {
      geometry = { ...geometry, height: settledHeight }
      browserWindow.setContentSize(geometry.width, geometry.height, false)
      await webContents.executeJavaScript('window.settingsLongScreenshot.settle()', true)
    }
    webContents.invalidate()
    const image = await webContents.capturePage(
      { x: 0, y: 0, width: geometry.width, height: geometry.height },
      { stayHidden: true, stayAwake: true }
    )
    if (image.isEmpty()) throw new Error('截图引擎没有返回 PNG 数据')
    const png = image.toPNG()
    await fs.promises.writeFile(outputPath, png)
    const imageSize = image.getSize()
    return {
      width: imageSize.width,
      height: imageSize.height,
      cssWidth: geometry.width,
      cssHeight: geometry.height,
      section: geometry.section,
      profileTab: geometry.profileTab,
      profileCollapsed: geometry.profileCollapsed,
      bytes: png.length,
    }
  } finally {
    if (prepared && !webContents.isDestroyed()) {
      await webContents.executeJavaScript('window.settingsLongScreenshot.restore()', true).catch(() => {})
    }
    if (!browserWindow.isDestroyed()) {
      browserWindow.setContentSize(originalContentSize[0], originalContentSize[1], false)
    }
  }
}

module.exports = {
  MAX_SCREENSHOT_EDGE,
  captureSettingsPanel,
  normalizedCaptureState,
  normalizedGeometry,
  normalizedSection,
}
