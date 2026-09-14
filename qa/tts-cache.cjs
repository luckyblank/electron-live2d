const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createAIPluginManager } = require('../ai/plugin-manager')

const projectRoot = path.resolve(__dirname, '..')
const pluginsDirectory = path.join(projectRoot, 'plugins')
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-tts-cache-'))
const ttsDirectory = path.join(temporaryRoot, 'tts')
const originalFetch = global.fetch
const originalDashScopeKey = process.env.DASHSCOPE_API_KEY
const originalZhipuKey = process.env.ZHIPU_API_KEY

function makeWav(sample = 0) {
  const audio = Buffer.alloc(46)
  audio.write('RIFF', 0, 'ascii')
  audio.writeUInt32LE(38, 4)
  audio.write('WAVE', 8, 'ascii')
  audio.write('fmt ', 12, 'ascii')
  audio.writeUInt32LE(16, 16)
  audio.writeUInt16LE(1, 20)
  audio.writeUInt16LE(1, 22)
  audio.writeUInt32LE(24000, 24)
  audio.writeUInt32LE(48000, 28)
  audio.writeUInt16LE(2, 32)
  audio.writeUInt16LE(16, 34)
  audio.write('data', 36, 'ascii')
  audio.writeUInt32LE(2, 40)
  audio.writeInt16LE(sample, 44)
  return audio
}

function makeStore() {
  const values = {
    aiPlugins: {
      installed: ['qwen-tts', 'zhipu-tts'],
      activeIds: { chat: '', tts: 'qwen-tts' },
      settings: {
        'qwen-tts': { model: 'qwen3-tts-flash', voice: 'Cherry', speed: 1, volume: 1 },
        'zhipu-tts': { model: 'glm-tts', voice: 'tongtong', speed: 1, volume: 1 },
      },
      secrets: {},
      credentialPreferences: {},
    },
  }
  return {
    get(key) { return values[key] },
    set(key, value) { values[key] = value },
  }
}

function makeManager(store) {
  return createAIPluginManager({
    pluginsDirectories: [pluginsDirectory],
    store,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(value),
      decryptString: value => value.toString(),
    },
    ttsDirectory,
  })
}

async function main() {
  process.env.DASHSCOPE_API_KEY = 'qa-dashscope-cache-key'
  process.env.ZHIPU_API_KEY = 'qa-zhipu-cache-key'
  let qwenCalls = 0
  let zhipuCalls = 0

  global.fetch = async url => {
    const target = String(url)
    if (target.includes('dashscope.aliyuncs.com')) {
      qwenCalls += 1
      return new Response(JSON.stringify({
        status_code: 200,
        output: { audio: { data: makeWav(qwenCalls).toString('base64'), url: '' } },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (target.includes('open.bigmodel.cn')) {
      zhipuCalls += 1
      return new Response(makeWav(zhipuCalls), { status: 200, headers: { 'content-type': 'audio/wav' } })
    }
    throw new Error(`Unexpected QA URL: ${target}`)
  }

  const store = makeStore()
  let manager = makeManager(store)
  const snapshot = manager.getSnapshot()
  const qwenPlugin = snapshot.plugins.find(plugin => plugin.id === 'qwen-tts')
  const zhipuPlugin = snapshot.plugins.find(plugin => plugin.id === 'zhipu-tts')
  assert.deepStrictEqual(qwenPlugin.ttsCacheKeyFields, ['model', 'voice'])
  assert.deepStrictEqual(zhipuPlugin.ttsCacheKeyFields, ['model', 'voice', 'speed', 'volume'])

  const qwenFirst = await manager.synthesize({ text: '相同的外部消息', source: 'external' })
  const qwenHit = await manager.synthesize({ text: '  相同的外部消息  ', source: 'external' })
  assert.strictEqual(qwenFirst.cached, false)
  assert.strictEqual(qwenHit.cached, true)
  assert.strictEqual(qwenCalls, 1, '相同规范化文本和 Qwen 配置应只调用一次供应商')
  assert.notStrictEqual(qwenFirst.archivePath, qwenHit.archivePath, '每条历史消息应保留独立归档')
  assert.deepStrictEqual(fs.readFileSync(qwenFirst.archivePath), fs.readFileSync(qwenHit.archivePath))

  manager.configure('qwen-tts', { speed: 1.6, volume: 3 })
  const qwenTuningIgnored = await manager.synthesize({ text: '相同的外部消息', source: 'external' })
  assert.strictEqual(qwenTuningIgnored.cached, true)
  assert.strictEqual(qwenCalls, 1, 'Qwen 缓存键不应包含不受支持的语速和音量')

  manager.configure('qwen-tts', { voice: 'Serena' })
  const qwenVoiceMiss = await manager.synthesize({ text: '相同的外部消息', source: 'external' })
  assert.strictEqual(qwenVoiceMiss.cached, false)
  assert.strictEqual(qwenCalls, 2, 'Qwen 音色变化必须重新生成')
  manager.dispose()

  manager = makeManager(store)
  const qwenPersistentHit = await manager.synthesize({ text: '相同的外部消息', source: 'external' })
  assert.strictEqual(qwenPersistentHit.cached, true)
  assert.strictEqual(qwenCalls, 2, '缓存应在 manager 重建后仍然命中')

  const appFirst = await manager.synthesize({ text: 'APP 不使用外部缓存', source: 'app' })
  const appSecond = await manager.synthesize({ text: 'APP 不使用外部缓存', source: 'app' })
  assert.strictEqual(appFirst.cached, false)
  assert.strictEqual(appSecond.cached, false)
  assert.strictEqual(qwenCalls, 4, 'APP 内部语音应保持每次实时生成')

  manager.configure('zhipu-tts', { voice: 'tongtong', speed: 1, volume: 1 })
  const zhipuFirst = await manager.synthesize({ text: '智谱外部缓存', source: 'external' })
  const zhipuHit = await manager.synthesize({ text: '智谱外部缓存', source: 'external' })
  assert.strictEqual(zhipuFirst.cached, false)
  assert.strictEqual(zhipuHit.cached, true)
  assert.strictEqual(zhipuCalls, 1)

  manager.configure('zhipu-tts', { speed: 1.2 })
  assert.strictEqual((await manager.synthesize({ text: '智谱外部缓存', source: 'external' })).cached, false)
  manager.configure('zhipu-tts', { volume: 2 })
  assert.strictEqual((await manager.synthesize({ text: '智谱外部缓存', source: 'external' })).cached, false)
  manager.configure('zhipu-tts', { voice: 'chuichui' })
  assert.strictEqual((await manager.synthesize({ text: '智谱外部缓存', source: 'external' })).cached, false)
  assert.strictEqual((await manager.synthesize({ text: '另一段智谱外部缓存', source: 'external' })).cached, false)
  assert.strictEqual(zhipuCalls, 5, '智谱文本、音色、语速或音量变化都必须重新生成')

  const cacheDirectory = path.join(ttsDirectory, 'cache-v1')
  const metadata = fs.readdirSync(cacheDirectory)
    .filter(name => name.endsWith('.json'))
    .map(name => fs.readFileSync(path.join(cacheDirectory, name), 'utf8'))
    .join('\n')
  assert(!metadata.includes('相同的外部消息'), '缓存元数据不应保存明文消息')
  assert(!metadata.includes('qa-dashscope-cache-key'), '缓存元数据不应保存供应商密钥')
  assert(!metadata.includes('qa-zhipu-cache-key'), '缓存元数据不应保存供应商密钥')
  manager.dispose()

  console.log('TTS cache QA passed: external-only cache, provider-specific keys, disk persistence and unique history archives verified.')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
}).finally(() => {
  global.fetch = originalFetch
  if (originalDashScopeKey === undefined) delete process.env.DASHSCOPE_API_KEY
  else process.env.DASHSCOPE_API_KEY = originalDashScopeKey
  if (originalZhipuKey === undefined) delete process.env.ZHIPU_API_KEY
  else process.env.ZHIPU_API_KEY = originalZhipuKey
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
})
