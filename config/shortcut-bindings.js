const LEGACY_ACCELERATOR_KEYS = Object.freeze({
  comma: ',',
  period: '.',
})

function normalizeShortcutAccelerator(value) {
  if (typeof value !== 'string') return ''
  const accelerator = value.trim().replace(/\s+/g, '')
  if (!accelerator || accelerator.length > 64 || /[\r\n\0]/.test(accelerator)) return ''
  return accelerator
    .split('+')
    .map(key => LEGACY_ACCELERATOR_KEYS[key.toLowerCase()] || key)
    .join('+')
}

function normalizeBinding(candidate, validActions) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
  const id = typeof candidate.id === 'string'
    ? candidate.id.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 48)
    : ''
  const action = typeof candidate.action === 'string' ? candidate.action : ''
  const accelerator = normalizeShortcutAccelerator(candidate.accelerator)
  if (!id || !action || !accelerator || (validActions.size && !validActions.has(action))) return null
  return { id, action, accelerator }
}

function fallbackAccelerators(accelerator) {
  const parts = accelerator.split('+')
  const key = parts.at(-1)
  if (!key) return []
  return [
    `CommandOrControl+Alt+${key}`,
    `CommandOrControl+Alt+Shift+${key}`,
  ]
}

function mergeShortcutBindingsWithDefaults(value, defaults, { validActions = [], limit = 24 } = {}) {
  const validActionSet = new Set(validActions)
  const normalizedDefaults = (Array.isArray(defaults) ? defaults : [])
    .map(binding => normalizeBinding(binding, validActionSet))
    .filter(Boolean)
  const defaultIds = new Set(normalizedDefaults.map(binding => binding.id))
  const existing = []
  const existingIds = new Set()
  const occupiedAccelerators = new Set()

  for (const candidate of Array.isArray(value) ? value : []) {
    const binding = normalizeBinding(candidate, validActionSet)
    if (!binding) continue
    const acceleratorKey = binding.accelerator.toLowerCase()
    if (existingIds.has(binding.id) || occupiedAccelerators.has(acceleratorKey)) continue
    existingIds.add(binding.id)
    occupiedAccelerators.add(acceleratorKey)
    existing.push(binding)
  }

  const existingById = new Map(existing.map(binding => [binding.id, binding]))
  const mergedDefaults = normalizedDefaults.map(defaultBinding => {
    const storedBinding = existingById.get(defaultBinding.id)
    if (storedBinding) {
      return {
        id: defaultBinding.id,
        action: defaultBinding.action,
        accelerator: storedBinding.accelerator,
      }
    }

    const candidates = [defaultBinding.accelerator, ...fallbackAccelerators(defaultBinding.accelerator)]
    const accelerator = candidates.find(candidate => !occupiedAccelerators.has(candidate.toLowerCase()))
      || defaultBinding.accelerator
    occupiedAccelerators.add(accelerator.toLowerCase())
    return { ...defaultBinding, accelerator }
  })
  const customBindings = existing.filter(binding => !defaultIds.has(binding.id))

  return [...mergedDefaults, ...customBindings].slice(0, Math.max(normalizedDefaults.length, limit))
}

module.exports = {
  mergeShortcutBindingsWithDefaults,
  normalizeShortcutAccelerator,
}
