const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createAIPluginManager } = require('../ai/plugin-manager')
const { mergeEnvironment, parseEnv, readEnvFile, resolveEnvironmentValue } = require('../config/environment')

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-ai-environment-'))
const pluginsDirectory = path.join(temporaryRoot, 'plugins')
const pluginDirectory = path.join(pluginsDirectory, 'credential-probe')

function makeStore({ localKey = '', preference = '' } = {}) {
  const state = {
    installed: ['credential-probe'],
    activeIds: { chat: 'credential-probe', tts: '' },
    settings: {},
    secrets: localKey ? { 'credential-probe': Buffer.from(localKey).toString('base64') } : {},
    credentialPreferences: preference ? { 'credential-probe': preference } : {},
  }
  const values = { aiPlugins: state }
  return {
    get(key) { return values[key] },
    set(key, value) { values[key] = value },
  }
}

function makeManager({ fileEnvironment = {}, processEnvironment = {}, localKey = '', preference = '' } = {}) {
  return createAIPluginManager({
    pluginsDirectories: [pluginsDirectory],
    store: makeStore({ localKey, preference }),
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(value),
      decryptString: value => value.toString(),
    },
    ttsDirectory: path.join(temporaryRoot, 'tts'),
    fileEnvironment,
    processEnvironment,
  })
}

async function main() {
  fs.mkdirSync(pluginDirectory, { recursive: true })
  fs.writeFileSync(path.join(pluginDirectory, 'manifest.json'), JSON.stringify({
    id: 'credential-probe',
    name: 'Credential Probe',
    main: 'index.js',
    apiKeyEnv: 'PROBE_API_KEY',
    capabilities: ['chat'],
    models: ['probe-model'],
  }))
  fs.writeFileSync(path.join(pluginDirectory, 'index.js'), `
async function chat({ apiKey, model }) {
  const source = apiKey === 'dotenv-ai-key'
    ? 'dotenv'
    : (apiKey === 'system-ai-key' ? 'environment' : (apiKey === 'local-ai-key' ? 'local' : 'unexpected'))
  return { text: source, model }
}
module.exports = { chat }
`)

  const parsed = parseEnv('PROBE_API_KEY=dotenv-ai-key\nEMPTY=\nQUOTED="hello world"\n')
  assert.deepStrictEqual(parsed, {
    PROBE_API_KEY: 'dotenv-ai-key',
    EMPTY: '',
    QUOTED: 'hello world',
  })
  assert.deepStrictEqual(
    resolveEnvironmentValue('PROBE_API_KEY', parsed, { PROBE_API_KEY: 'system-ai-key' }),
    { value: 'dotenv-ai-key', source: 'dotenv' }
  )
  assert.deepStrictEqual(
    resolveEnvironmentValue('EMPTY', parsed, { EMPTY: 'system-ai-key' }),
    { value: 'system-ai-key', source: 'environment' }
  )
  assert.strictEqual(
    mergeEnvironment(parsed, { PROBE_API_KEY: 'system-ai-key', EMPTY: 'system-ai-key' }).EMPTY,
    'system-ai-key'
  )

  const envPath = path.join(temporaryRoot, '.env')
  fs.writeFileSync(envPath, 'PROBE_API_KEY=dotenv-ai-key\n')
  assert.deepStrictEqual(readEnvFile(envPath), {
    loaded: true,
    values: { PROBE_API_KEY: 'dotenv-ai-key' },
  })

  const dotenvManager = makeManager({
    fileEnvironment: { PROBE_API_KEY: 'dotenv-ai-key' },
    processEnvironment: { PROBE_API_KEY: 'system-ai-key' },
    localKey: 'local-ai-key',
    preference: 'local',
  })
  assert.strictEqual(dotenvManager.getSnapshot().plugins[0].credentialSource, 'dotenv')
  assert.strictEqual((await dotenvManager.test('credential-probe')).reply, 'dotenv')
  dotenvManager.dispose()

  const systemManager = makeManager({
    fileEnvironment: { PROBE_API_KEY: '' },
    processEnvironment: { PROBE_API_KEY: 'system-ai-key' },
  })
  assert.strictEqual(systemManager.getSnapshot().plugins[0].credentialSource, 'environment')
  assert.strictEqual((await systemManager.test('credential-probe')).reply, 'environment')
  systemManager.dispose()

  const localManager = makeManager({
    localKey: 'local-ai-key',
    preference: 'local',
  })
  assert.strictEqual(localManager.getSnapshot().plugins[0].credentialSource, 'local')
  assert.strictEqual((await localManager.test('credential-probe')).reply, 'local')
  localManager.dispose()

  console.log('AI environment credential QA passed')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
}).finally(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
})
