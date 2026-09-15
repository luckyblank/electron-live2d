const fs = require('fs')

function parseEnv(contents) {
  const parsed = {}
  const lines = String(contents).replace(/^\uFEFF/, '').split(/\r?\n/)

  lines.forEach((originalLine, index) => {
    let line = originalLine.trim()
    if (!line || line.startsWith('#')) return

    if (line.startsWith('export ')) line = line.slice('export '.length).trim()

    const separator = line.indexOf('=')
    if (separator <= 0) throw new Error(`Invalid .env entry on line ${index + 1}`)

    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid .env variable name on line ${index + 1}`)
    }

    const quote = value[0]
    if (quote === '"' || quote === "'") {
      if (value.length < 2 || value[value.length - 1] !== quote) {
        throw new Error(`Unclosed quote in .env on line ${index + 1}`)
      }
      value = value.slice(1, -1)
      if (quote === '"') {
        value = value
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\')
      }
    } else {
      value = value.replace(/\s+#.*$/, '').trim()
    }

    parsed[key] = value
  })

  return parsed
}

function normalizedEnvironmentValue(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveEnvironmentValue(name, fileEnvironment = {}, processEnvironment = process.env) {
  const fromFile = normalizedEnvironmentValue(fileEnvironment[name])
  if (fromFile) return { value: fromFile, source: 'dotenv' }

  const fromProcess = normalizedEnvironmentValue(processEnvironment[name])
  if (fromProcess) return { value: fromProcess, source: 'environment' }

  return { value: '', source: 'missing' }
}

function mergeEnvironment(fileEnvironment = {}, processEnvironment = process.env) {
  const merged = { ...processEnvironment }
  for (const [name, value] of Object.entries(fileEnvironment)) {
    if (normalizedEnvironmentValue(value)) merged[name] = value
  }
  return merged
}

function readEnvFile(envPath, { required = false } = {}) {
  if (!fs.existsSync(envPath)) {
    if (required) throw new Error(`Environment file does not exist: ${envPath}`)
    return { loaded: false, values: {} }
  }
  return {
    loaded: true,
    values: parseEnv(fs.readFileSync(envPath, 'utf8')),
  }
}

module.exports = {
  mergeEnvironment,
  parseEnv,
  readEnvFile,
  resolveEnvironmentValue,
}
