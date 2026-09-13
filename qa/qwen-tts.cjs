const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createAIPluginManager } = require('../ai/plugin-manager')

const projectRoot = path.resolve(__dirname, '..')
const manifestPath = path.join(projectRoot, 'plugins', 'qwen-tts', 'manifest.json')
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-qwen-tts-'))
const originalFetch = global.fetch
const originalApiKey = process.env.DASHSCOPE_API_KEY

function makeWav() {
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
  audio.writeInt16LE(0, 44)
  return audio
}

function makeStore() {
  const values = {
    aiPlugins: {
      installed: ['qwen-tts'],
      activeIds: { chat: '', tts: 'qwen-tts' },
      settings: {},
      secrets: {},
      credentialPreferences: {},
    },
  }
  return {
    get(key) { return values[key] },
    set(key, value) { values[key] = value },
  }
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  assert.strictEqual(manifest.defaultModel, 'qwen3-tts-flash')
  assert.strictEqual(manifest.defaultVoice, 'Cherry')
  assert.strictEqual(manifest.voices.length, 48)
  assert.strictEqual(new Set(manifest.voices.map(voice => voice.id)).size, manifest.voices.length)

  process.env.DASHSCOPE_API_KEY = 'qa-dashscope-key'
  const wav = makeWav()
  const requests = []
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options })
    if (requests.length === 1) {
      return new Response(JSON.stringify({
        status_code: 200,
        request_id: 'qa-request',
        output: {
          finish_reason: 'stop',
          audio: {
            data: '',
            url: 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/qa/audio.wav?Expires=9999999999',
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(wav, {
      status: 200,
      headers: {
        'content-type': 'audio/wav',
        'content-length': String(wav.length),
      },
    })
  }

  const manager = createAIPluginManager({
    pluginsDirectories: [path.join(projectRoot, 'plugins')],
    store: makeStore(),
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(value),
      decryptString: value => value.toString(),
    },
    ttsDirectory: path.join(temporaryRoot, 'tts'),
  })

  const snapshot = manager.getSnapshot()
  const plugin = snapshot.plugins.find(item => item.id === 'qwen-tts')
  assert(plugin, 'Qwen-TTS plugin should be discovered')
  assert.strictEqual(plugin.config.model, 'qwen3-tts-flash')
  assert.strictEqual(plugin.config.voice, 'Cherry')
  assert.strictEqual(plugin.ttsTuning, false)
  assert.strictEqual(plugin.voices.length, 48)
  assert(plugin.voices.every(voice => voice.previewUrl.startsWith('https://help-static-aliyun-doc.aliyuncs.com/')))

  const result = await manager.test('qwen-tts')
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.model, 'qwen3-tts-flash')
  assert.strictEqual(result.voice, 'Cherry')
  assert.strictEqual(requests.length, 2)

  const apiRequest = requests[0]
  const requestBody = JSON.parse(apiRequest.options.body)
  assert.strictEqual(apiRequest.url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
  assert.strictEqual(apiRequest.options.headers.Authorization, 'Bearer qa-dashscope-key')
  assert.strictEqual(apiRequest.options.headers['X-DashScope-SSE'], undefined)
  assert.strictEqual(requestBody.model, 'qwen3-tts-flash')
  assert.deepStrictEqual(requestBody.input, {
    text: '你好，我已经准备好陪你聊天了。',
    voice: 'Cherry',
    language_type: 'Auto',
  })
  assert.strictEqual(Object.prototype.hasOwnProperty.call(requestBody, 'stream'), false)

  assert.strictEqual(
    requests[1].url,
    'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/qa/audio.wav?Expires=9999999999'
  )
  assert.strictEqual(requests[1].options.signal, requests[0].options.signal)
  assert(fs.existsSync(result.archivePath), 'Generated speech should be archived locally')
  assert.deepStrictEqual(fs.readFileSync(result.archivePath), wav)
  assert(result.archivePath.includes(`${path.sep}tts${path.sep}`))
  assert(result.archivePath.endsWith('.wav'))

  manager.dispose()
  console.log('Qwen-TTS QA passed: non-streaming request, 48 previews, WAV download and local archive verified.')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
}).finally(() => {
  global.fetch = originalFetch
  if (originalApiKey === undefined) delete process.env.DASHSCOPE_API_KEY
  else process.env.DASHSCOPE_API_KEY = originalApiKey
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
})
