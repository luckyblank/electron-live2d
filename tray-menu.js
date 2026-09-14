function buildConditionalTrayItems(options = {}) {
  const items = []
  const openExternalMessageTester = typeof options.openExternalMessageTester === 'function'
    ? options.openExternalMessageTester
    : () => false
  const captureSettingsFromTray = typeof options.captureSettingsFromTray === 'function'
    ? options.captureSettingsFromTray
    : () => false

  if (options.externalMessagesEnabled) {
    const ready = Boolean(options.externalMessageTesterReady)
    items.push({
      label: '外部消息调试',
      submenu: [
        {
          label: 'APP 窗口',
          enabled: ready,
          click: () => openExternalMessageTester('app'),
        },
        {
          label: '浏览器窗口',
          enabled: ready,
          click: () => openExternalMessageTester('browser'),
        },
      ],
    })
  }

  if (options.appLongScreenshotEnabled && options.settingsPanelVisible) {
    items.push({ label: 'APP 长截图', click: captureSettingsFromTray })
  }

  return items
}

module.exports = { buildConditionalTrayItems }
