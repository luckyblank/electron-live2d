const { app, globalShortcut } = require('electron')
const { PREFERENCE_DEFAULTS } = require('../config/defaults')
const { mergeShortcutBindingsWithDefaults } = require('../config/shortcut-bindings')

async function main() {
  await app.whenReady()
  const repairOnly = process.argv.includes('--repair-only')

  const bindings = Array.isArray(PREFERENCE_DEFAULTS.shortcutBindings)
    ? PREFERENCE_DEFAULTS.shortcutBindings
    : []
  const legacyBindings = bindings
    .filter(binding => [
      'toggle-visibility',
      'open-settings',
      'toggle-animation',
      'random-interaction',
      'toggle-lock',
      'quit-app',
    ].includes(binding.id))
    .map(binding => ({
      ...binding,
      accelerator: binding.id === 'open-settings'
        ? 'CommandOrControl+Shift+Comma'
        : binding.accelerator,
    }))
  legacyBindings.push({
    id: 'custom-reset-position-qa',
    action: 'reset-position',
    accelerator: 'CommandOrControl+Alt+Home',
  })
  const repairedBindings = mergeShortcutBindingsWithDefaults(legacyBindings, bindings, {
    validActions: [...new Set([...bindings.map(binding => binding.action), 'reset-position'])],
    limit: 24,
  })
  const repairedById = new Map(repairedBindings.map(binding => [binding.id, binding]))
  const repairPassed = bindings.every(binding => repairedById.has(binding.id))
    && repairedById.get('open-settings')?.accelerator === 'CommandOrControl+Shift+,'
    && repairedById.get('app-long-screenshot')?.accelerator === 'CommandOrControl+Shift+S'
    && repairedById.get('custom-reset-position-qa')?.accelerator === 'CommandOrControl+Alt+Home'
  const results = []

  if (!repairOnly) {
    try {
      for (const binding of bindings) {
        let registered = false
        let error = ''
        try {
          registered = globalShortcut.register(binding.accelerator, () => {})
        } catch (registrationError) {
          error = registrationError instanceof Error
            ? registrationError.message
            : String(registrationError)
        }
        results.push({
          id: binding.id,
          accelerator: binding.accelerator,
          registered,
          error,
        })
      }
    } finally {
      globalShortcut.unregisterAll()
    }
  }

  const failed = results.filter(result => !result.registered)
  const registrationPassed = repairOnly || (failed.length === 0 && results.length === bindings.length)
  console.log(JSON.stringify({
    passed: registrationPassed && repairPassed,
    repairOnly,
    total: results.length,
    failed,
    firstVersionRepair: {
      passed: repairPassed,
      before: legacyBindings.length,
      after: repairedBindings.length,
      ids: repairedBindings.map(binding => binding.id),
      settingsAccelerator: repairedById.get('open-settings')?.accelerator || '',
      longScreenshotAccelerator: repairedById.get('app-long-screenshot')?.accelerator || '',
    },
    results,
  }, null, 2))

  app.exit(registrationPassed && repairPassed ? 0 : 1)
}

main().catch(error => {
  console.error(error)
  app.exit(1)
})
