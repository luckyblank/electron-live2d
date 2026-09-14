const assert = require('node:assert/strict')
const { buildConditionalTrayItems } = require('../tray-menu')

function labels(items) {
  return items.map(item => item.label)
}

const hidden = buildConditionalTrayItems({
  appLongScreenshotEnabled: false,
  settingsPanelVisible: true,
  externalMessagesEnabled: false,
  externalMessageTesterReady: true,
})
assert.deepEqual(hidden, [])

assert.deepEqual(labels(buildConditionalTrayItems({
  appLongScreenshotEnabled: true,
  settingsPanelVisible: false,
})), [])

const calls = []
const enabled = buildConditionalTrayItems({
  appLongScreenshotEnabled: true,
  settingsPanelVisible: true,
  externalMessagesEnabled: true,
  externalMessageTesterReady: true,
  captureSettingsFromTray: () => calls.push('screenshot'),
  openExternalMessageTester: target => calls.push(target),
})
assert.deepEqual(labels(enabled), ['外部消息调试', 'APP 长截图'])
assert.deepEqual(labels(enabled[0].submenu), ['APP 窗口', '浏览器窗口'])
assert.ok(enabled[0].submenu.every(item => item.enabled))
enabled[0].submenu[0].click()
enabled[0].submenu[1].click()
enabled[1].click()
assert.deepEqual(calls, ['app', 'browser', 'screenshot'])

const starting = buildConditionalTrayItems({
  externalMessagesEnabled: true,
  externalMessageTesterReady: false,
})
assert.equal(starting.length, 1)
assert.ok(starting[0].submenu.every(item => item.enabled === false))

process.stdout.write(JSON.stringify({
  assertions: {
    disabledFeaturesStayHidden: hidden.length === 0,
    screenshotRequiresEnabledSwitchAndVisibleApp: labels(enabled).includes('APP 长截图'),
    externalDebugRequiresExternalAccess: labels(enabled).includes('外部消息调试'),
    externalDebugOffersBothTargets: labels(enabled[0].submenu).join('|') === 'APP 窗口|浏览器窗口',
    startingServiceKeepsTargetsDisabled: starting[0].submenu.every(item => !item.enabled),
  },
  passed: true,
}, null, 2))
