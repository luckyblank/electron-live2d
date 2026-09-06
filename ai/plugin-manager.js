const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const DEFAULT_PERSONA = '你是住在用户桌面上的可爱 Live2D 伙伴。请使用自然、温暖、简短的中文回复，每次最多三句话，不使用 Markdown，不假装执行你无法执行的操作。'
const DEFAULT_HISTORY_MESSAGES = 12
const MAX_HISTORY_MESSAGES = 40
const DEFAULT_MAX_RESPONSE_CHARACTERS = 300
const MIN_RESPONSE_CHARACTERS = 50
const MAX_RESPONSE_CHARACTERS = 2000
const DEFAULT_TTS_SPEED = 1
const DEFAULT_TTS_VOLUME = 1
const REQUEST_TIMEOUT_MS = 45000
const TTS_REQUEST_TIMEOUT_MS = 60000
const SUPPORTED_CAPABILITIES = ['chat', 'tts']

// 语境情绪标签：要求模型在回复开头标注，主进程解析后驱动宠物情绪动作。
// 键为模型可能输出的标签词（含常见别名），值为跨插件稳定的情绪键。
const EMOTION_TAGS = ['开心', '难过', '生气', '惊讶', '害羞', '疑惑', '平静']
const EMOTION_ALIASES = {
  开心: 'happy', 高兴: 'happy', 快乐: 'happy',
  难过: 'sad', 伤心: 'sad', 委屈: 'sad',
  生气: 'angry', 愤怒: 'angry',
  惊讶: 'surprised', 吃惊: 'surprised',
  害羞: 'shy', 羞涩: 'shy',
  疑惑: 'confused', 困惑: 'confused',
  平静: 'calm', 淡定: 'calm',
}
const EMOTION_TAG_PATTERN = /^\s*[【[]([^[\]【】]{1,4})[】\]]\s*/

function extractEmotion(text) {
  const source = String(text || '')
  const match = source.match(EMOTION_TAG_PATTERN)
  if (!match) return { text: source, emotion: '' }
  const stripped = source.slice(match[0].length).trim()
  // 剥完为空（模型只回了标签）时保留原文，避免空气泡
  if (!stripped) return { text: source, emotion: '' }
  return { text: stripped, emotion: EMOTION_ALIASES[match[1]] || '' }
}

function normalizeHistoryLimit(value, fallback = DEFAULT_HISTORY_MESSAGES) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(MAX_HISTORY_MESSAGES, Math.max(0, Math.round(number)))
}

function normalizeResponseCharacters(value, fallback = DEFAULT_MAX_RESPONSE_CHARACTERS) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(MAX_RESPONSE_CHARACTERS, Math.max(MIN_RESPONSE_CHARACTERS, Math.round(number)))
}

function responseTokenLimit(characterLimit) {
  return Math.min(2048, Math.max(64, Math.ceil(normalizeResponseCharacters(characterLimit) * 1.5) + 16))
}

function truncateResponse(text, characterLimit) {
  const source = String(text || '').trim()
  const characters = Array.from(source)
  const limit = normalizeResponseCharacters(characterLimit)
  if (characters.length <= limit) return source
  return `${characters.slice(0, limit - 1).join('').trimEnd()}…`
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function maskSecret(value) {
  const secret = typeof value === 'string' ? value.trim() : ''
  if (!secret) return ''
  if (secret.length <= 8) return `${secret.slice(0, 2)}••••${secret.slice(-2)}`
  return `${secret.slice(0, 6)}${'•'.repeat(Math.min(12, secret.length - 10))}${secret.slice(-4)}`
}

function createAIPluginManager({ pluginsDirectories, store, safeStorage, ttsDirectory }) {
  let registry = null
  const loadedPlugins = new Map()
  // 会话上下文按「对话插件 × 宠物角色」隔离：换角色后各自的记忆互不干扰，
  // 换插件亦然。键格式 pluginId::modelId
  const conversations = new Map()
  const activeRequests = new Map()

  function conversationKeyFor(pluginId, modelId) {
    return `${pluginId}::${typeof modelId === 'string' ? modelId : ''}`
  }

  function deleteConversationsForPlugin(pluginId) {
    for (const key of conversations.keys()) {
      if (key === pluginId || key.startsWith(`${pluginId}::`)) conversations.delete(key)
    }
  }

  function readState() {
    const value = store.get('aiPlugins')
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { installed: [], activeIds: { chat: '', tts: '' }, settings: {}, secrets: {}, credentialPreferences: {} }
    }
    const activeIds = value.activeIds && typeof value.activeIds === 'object'
      ? {
          chat: typeof value.activeIds.chat === 'string' ? value.activeIds.chat : '',
          tts: typeof value.activeIds.tts === 'string' ? value.activeIds.tts : '',
        }
      : { chat: typeof value.activeId === 'string' ? value.activeId : '', tts: '' }
    return {
      installed: Array.isArray(value.installed) ? value.installed.filter(id => typeof id === 'string') : [],
      activeIds,
      settings: value.settings && typeof value.settings === 'object' ? { ...value.settings } : {},
      secrets: value.secrets && typeof value.secrets === 'object' ? { ...value.secrets } : {},
      credentialPreferences: value.credentialPreferences && typeof value.credentialPreferences === 'object'
        ? { ...value.credentialPreferences }
        : {},
    }
  }

  function saveState(value) {
    store.set('aiPlugins', value)
  }

  function normalizeVoices(manifest) {
    if (!Array.isArray(manifest.voices)) return []
    return manifest.voices.flatMap(voice => {
      if (typeof voice === 'string' && voice.length <= 80) return [{ id: voice, name: voice, previewUrl: '' }]
      if (!voice || typeof voice !== 'object' || typeof voice.id !== 'string' || !voice.id || voice.id.length > 80) return []
      const previewUrl = /^https:\/\/docs\.bigmodel\.cn\/resource\/audio\/[a-z0-9_-]+\.wav$/i.test(voice.previewUrl || '')
        ? voice.previewUrl
        : ''
      return [{ id: voice.id, name: String(voice.name || voice.id).slice(0, 60), previewUrl }]
    })
  }

  function discover() {
    if (registry) return registry
    registry = new Map()
    // 目录数组与 models 相同顺序：[内置, 安装目录, 用户目录]。
    // 倒序扫描让用户目录优先，同名插件允许覆盖内置插件。
    const directories = Array.isArray(pluginsDirectories) ? pluginsDirectories : []
    for (const pluginsDirectory of directories.slice().reverse()) {
      if (!fs.existsSync(pluginsDirectory)) continue
      for (const entry of fs.readdirSync(pluginsDirectory, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^[a-z0-9-]+$/i.test(entry.name)) continue
        const pluginDirectory = path.resolve(pluginsDirectory, entry.name)
        const manifestPath = path.join(pluginDirectory, 'manifest.json')
        if (!fs.existsSync(manifestPath)) continue
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
          if (!manifest || manifest.id !== entry.name || typeof manifest.name !== 'string') continue
          if (registry.has(manifest.id)) continue
          const entryPath = path.resolve(pluginDirectory, manifest.main || 'index.js')
          if (!entryPath.startsWith(`${pluginDirectory}${path.sep}`) || !fs.existsSync(entryPath)) continue
          const capabilities = Array.isArray(manifest.capabilities)
            ? [...new Set(manifest.capabilities.filter(item => SUPPORTED_CAPABILITIES.includes(item)))]
            : []
          const models = Array.isArray(manifest.models)
            ? manifest.models.filter(model => typeof model === 'string' && model.length <= 80)
            : []
          if (!capabilities.length || !models.length) continue
          const voices = normalizeVoices(manifest)
          registry.set(manifest.id, {
            id: manifest.id,
            name: manifest.name.slice(0, 60),
            shortName: String(manifest.shortName || manifest.name).slice(0, 4),
            version: String(manifest.version || '1.0.0').slice(0, 20),
            description: String(manifest.description || '').slice(0, 240),
            homepage: /^https:\/\//.test(manifest.homepage || '') ? manifest.homepage : '',
            apiKeyEnv: /^[A-Z][A-Z0-9_]*$/.test(manifest.apiKeyEnv || '') ? manifest.apiKeyEnv : '',
            credentialId: /^[a-z0-9-]+$/i.test(manifest.credentialId || '') ? manifest.credentialId : manifest.id,
            capabilities,
            models,
            defaultModel: models.includes(manifest.defaultModel) ? manifest.defaultModel : models[0],
            voices,
            defaultVoice: voices.some(voice => voice.id === manifest.defaultVoice)
              ? manifest.defaultVoice
              : (voices[0] ? voices[0].id : ''),
            entryPath,
          })
        } catch (error) {
          console.warn(`Skipping invalid AI plugin ${entry.name}:`, error.message)
        }
      }
    }
    return registry
  }

  function refresh() {
    registry = null
    loadedPlugins.clear()
    return getSnapshot()
  }

  function pluginOrThrow(pluginId) {
    const plugin = discover().get(pluginId)
    if (!plugin) throw new Error('找不到这个 AI 插件')
    return plugin
  }

  function supports(plugin, capability) {
    return plugin.capabilities.includes(capability)
  }

  function activeIdFor(state, capability) {
    const selectedId = state.activeIds[capability]
    const selected = selectedId && discover().get(selectedId)
    if (selected && state.installed.includes(selected.id) && supports(selected, capability)) return selected.id
    const fallback = [...discover().values()].find(plugin => state.installed.includes(plugin.id) && supports(plugin, capability))
    return fallback ? fallback.id : ''
  }

  function environmentKey(plugin) {
    if (!plugin.apiKeyEnv) return ''
    const value = process.env[plugin.apiKeyEnv]
    return typeof value === 'string' ? value.trim() : ''
  }

  function decryptLocalKey(state, plugin) {
    const encrypted = state.secrets[plugin.credentialId]
    if (!encrypted) return ''
    if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法解密 API Key')
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64')).trim()
    } catch (error) {
      throw new Error('API Key 无法解密，请重新配置')
    }
  }

  function credentialDetails(state, plugin) {
    const fromEnvironment = environmentKey(plugin)
    const hasLocal = typeof state.secrets[plugin.credentialId] === 'string' && state.secrets[plugin.credentialId].length > 0
    const legacySettings = state.settings[plugin.id] || {}
    const prefersLocal = state.credentialPreferences[plugin.credentialId] === 'local' || legacySettings.credentialPreference === 'local'
    if (prefersLocal && hasLocal) {
      let preview = '••••••••'
      try { preview = maskSecret(decryptLocalKey(state, plugin)) || preview } catch { /* 测试连接时显示具体错误 */ }
      return { source: 'local', preview, environmentAvailable: Boolean(fromEnvironment) }
    }
    if (fromEnvironment) {
      return { source: 'environment', preview: maskSecret(fromEnvironment), environmentAvailable: true }
    }
    if (hasLocal) {
      let preview = '••••••••'
      try { preview = maskSecret(decryptLocalKey(state, plugin)) || preview } catch { /* 测试连接时显示具体错误 */ }
      return { source: 'local', preview, environmentAvailable: false }
    }
    return { source: 'missing', preview: '', environmentAvailable: false }
  }

  function pluginConfig(state, plugin) {
    const settings = state.settings[plugin.id] || {}
    const voiceIds = plugin.voices.map(voice => voice.id)
    return {
      model: plugin.models.includes(settings.model) ? settings.model : plugin.defaultModel,
      persona: typeof settings.persona === 'string' && settings.persona.trim()
        ? settings.persona.slice(0, 1000)
        : DEFAULT_PERSONA,
      historyLimit: normalizeHistoryLimit(settings.historyLimit),
      maxResponseChars: normalizeResponseCharacters(settings.maxResponseChars),
      voice: voiceIds.includes(settings.voice) ? settings.voice : plugin.defaultVoice,
      speed: clampNumber(settings.speed, 0.5, 2, DEFAULT_TTS_SPEED),
      volume: clampNumber(settings.volume, 0.1, 10, DEFAULT_TTS_VOLUME),
    }
  }

  function getSnapshot() {
    const state = readState()
    const activeIds = {
      chat: activeIdFor(state, 'chat'),
      tts: activeIdFor(state, 'tts'),
    }
    const plugins = [...discover().values()].map(plugin => {
      const credential = credentialDetails(state, plugin)
      return {
        id: plugin.id,
        name: plugin.name,
        shortName: plugin.shortName,
        version: plugin.version,
        description: plugin.description,
        homepage: plugin.homepage,
        capabilities: plugin.capabilities,
        models: plugin.models,
        defaultModel: plugin.defaultModel,
        voices: plugin.voices,
        installed: state.installed.includes(plugin.id),
        activeCapabilities: plugin.capabilities.filter(capability => activeIds[capability] === plugin.id),
        configured: credential.source !== 'missing',
        credentialSource: credential.source,
        credentialPreview: credential.preview,
        environmentAvailable: credential.environmentAvailable,
        apiKeyEnv: plugin.apiKeyEnv,
        config: pluginConfig(state, plugin),
      }
    })
    const readyByCapability = Object.fromEntries(SUPPORTED_CAPABILITIES.map(capability => {
      const active = plugins.find(plugin => plugin.id === activeIds[capability] && plugin.installed)
      return [capability, Boolean(active && active.configured)]
    }))
    return {
      plugins,
      activePluginIds: activeIds,
      activePluginId: activeIds.chat,
      readyByCapability,
      ready: readyByCapability.chat,
      ttsDirectory: typeof ttsDirectory === 'string' ? ttsDirectory : '',
    }
  }

  function defaultSettings(plugin) {
    return {
      model: plugin.defaultModel,
      persona: DEFAULT_PERSONA,
      historyLimit: DEFAULT_HISTORY_MESSAGES,
      maxResponseChars: DEFAULT_MAX_RESPONSE_CHARACTERS,
      voice: plugin.defaultVoice,
      speed: DEFAULT_TTS_SPEED,
      volume: DEFAULT_TTS_VOLUME,
    }
  }

  function install(pluginId) {
    const plugin = pluginOrThrow(pluginId)
    const state = readState()
    const activeBeforeInstall = Object.fromEntries(plugin.capabilities.map(capability => [capability, activeIdFor(state, capability)]))
    if (!state.installed.includes(pluginId)) state.installed.push(pluginId)
    for (const capability of plugin.capabilities) {
      if (!activeBeforeInstall[capability]) state.activeIds[capability] = pluginId
    }
    if (!state.settings[pluginId]) state.settings[pluginId] = defaultSettings(plugin)
    saveState(state)
    return getSnapshot()
  }

  function activate(pluginId, capability) {
    const plugin = pluginOrThrow(pluginId)
    const targetCapability = SUPPORTED_CAPABILITIES.includes(capability) ? capability : plugin.capabilities[0]
    const state = readState()
    if (!state.installed.includes(pluginId)) throw new Error('请先安装这个 AI 插件')
    if (!supports(plugin, targetCapability)) throw new Error('这个插件不支持所选能力')
    state.activeIds[targetCapability] = pluginId
    saveState(state)
    return getSnapshot()
  }

  function uninstall(pluginId) {
    const plugin = pluginOrThrow(pluginId)
    const state = readState()
    const request = activeRequests.get(pluginId)
    if (request) request.abort()
    activeRequests.delete(pluginId)
    deleteConversationsForPlugin(pluginId)
    loadedPlugins.delete(pluginId)
    delete require.cache[plugin.entryPath]
    state.installed = state.installed.filter(id => id !== pluginId)
    delete state.settings[pluginId]
    for (const capability of plugin.capabilities) {
      if (state.activeIds[capability] === pluginId) state.activeIds[capability] = ''
    }
    const credentialStillUsed = [...discover().values()].some(candidate =>
      candidate.id !== pluginId && candidate.credentialId === plugin.credentialId && state.installed.includes(candidate.id)
    )
    if (!credentialStillUsed) {
      delete state.secrets[plugin.credentialId]
      delete state.credentialPreferences[plugin.credentialId]
    }
    for (const capability of SUPPORTED_CAPABILITIES) {
      if (!state.activeIds[capability]) {
        const fallback = [...discover().values()].find(candidate =>
          state.installed.includes(candidate.id) && supports(candidate, capability)
        )
        state.activeIds[capability] = fallback ? fallback.id : ''
      }
    }
    saveState(state)
    return getSnapshot()
  }

  function configure(pluginId, patch = {}) {
    const plugin = pluginOrThrow(pluginId)
    const state = readState()
    if (!state.installed.includes(pluginId)) throw new Error('请先安装这个 AI 插件')
    const previous = { ...defaultSettings(plugin), ...(state.settings[pluginId] || {}) }
    const model = plugin.models.includes(patch.model) ? patch.model :
      (plugin.models.includes(previous.model) ? previous.model : plugin.defaultModel)
    const persona = typeof patch.persona === 'string' && patch.persona.trim()
      ? patch.persona.trim().slice(0, 1000)
      : (previous.persona || DEFAULT_PERSONA)
    const historyLimit = normalizeHistoryLimit(patch.historyLimit, normalizeHistoryLimit(previous.historyLimit))
    const maxResponseChars = normalizeResponseCharacters(
      patch.maxResponseChars,
      normalizeResponseCharacters(previous.maxResponseChars)
    )
    const voiceIds = plugin.voices.map(voice => voice.id)
    const voice = voiceIds.includes(patch.voice) ? patch.voice :
      (voiceIds.includes(previous.voice) ? previous.voice : plugin.defaultVoice)
    const speed = clampNumber(patch.speed, 0.5, 2, clampNumber(previous.speed, 0.5, 2, DEFAULT_TTS_SPEED))
    const volume = clampNumber(patch.volume, 0.1, 10, clampNumber(previous.volume, 0.1, 10, DEFAULT_TTS_VOLUME))

    if (previous.credentialPreference === 'local' && state.secrets[plugin.credentialId]) {
      state.credentialPreferences[plugin.credentialId] = 'local'
    }
    if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法安全保存 API Key')
      state.secrets[plugin.credentialId] = safeStorage.encryptString(patch.apiKey.trim()).toString('base64')
      state.credentialPreferences[plugin.credentialId] = 'local'
    }
    state.settings[pluginId] = { model, persona, historyLimit, maxResponseChars, voice, speed, volume }
    for (const capability of plugin.capabilities) state.activeIds[capability] = pluginId
    saveState(state)
    deleteConversationsForPlugin(pluginId)
    return getSnapshot()
  }

  function decryptKey(state, plugin) {
    const credential = credentialDetails(state, plugin)
    if (credential.source === 'environment') return environmentKey(plugin)
    if (credential.source === 'local') return decryptLocalKey(state, plugin)
    if (credential.source === 'missing') {
      const hint = plugin.apiKeyEnv ? `，或设置环境变量 ${plugin.apiKeyEnv}` : ''
      throw new Error(`请先填写并保存 API Key${hint}`)
    }
    throw new Error('无法读取 API Key')
  }

  function loadPlugin(pluginId, capability) {
    if (loadedPlugins.has(pluginId)) return loadedPlugins.get(pluginId)
    const plugin = pluginOrThrow(pluginId)
    const adapter = require(plugin.entryPath)
    if (!adapter || (supports(plugin, 'chat') && typeof adapter.chat !== 'function')) {
      throw new Error('AI 插件缺少对话能力')
    }
    if (!adapter || (supports(plugin, 'tts') && typeof adapter.synthesize !== 'function')) {
      throw new Error('AI 插件缺少语音合成能力')
    }
    if (capability === 'chat' && typeof adapter.chat !== 'function') throw new Error('AI 插件缺少对话能力')
    if (capability === 'tts' && typeof adapter.synthesize !== 'function') throw new Error('AI 插件缺少语音合成能力')
    loadedPlugins.set(pluginId, adapter)
    return adapter
  }

  async function runRequest(pluginId, timeoutMs, callback) {
    const previousRequest = activeRequests.get(pluginId)
    if (previousRequest) previousRequest.abort()
    const controller = new AbortController()
    activeRequests.set(pluginId, controller)
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await callback(controller.signal)
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('请求超时或已被新的请求取消')
      throw error
    } finally {
      clearTimeout(timeout)
      if (activeRequests.get(pluginId) === controller) activeRequests.delete(pluginId)
    }
  }

  async function runChat(pluginId, messages) {
    const plugin = pluginOrThrow(pluginId)
    const state = readState()
    if (!state.installed.includes(pluginId)) throw new Error('请先安装这个 AI 插件')
    if (!supports(plugin, 'chat')) throw new Error('这个插件不支持文字对话')
    const apiKey = decryptKey(state, plugin)
    const config = pluginConfig(state, plugin)
    const adapter = loadPlugin(pluginId, 'chat')
    return runRequest(pluginId, REQUEST_TIMEOUT_MS, signal =>
      adapter.chat({
        apiKey,
        model: config.model,
        messages,
        maxTokens: responseTokenLimit(config.maxResponseChars),
        signal,
      })
    )
  }

  async function runSpeech(pluginId, input) {
    const plugin = pluginOrThrow(pluginId)
    const state = readState()
    if (!state.installed.includes(pluginId)) throw new Error('请先安装这个语音插件')
    if (!supports(plugin, 'tts')) throw new Error('这个插件不支持语音合成')
    const apiKey = decryptKey(state, plugin)
    const config = pluginConfig(state, plugin)
    const adapter = loadPlugin(pluginId, 'tts')
    return runRequest(pluginId, TTS_REQUEST_TIMEOUT_MS, signal =>
      adapter.synthesize({
        apiKey,
        model: config.model,
        input,
        voice: config.voice,
        speed: config.speed,
        volume: config.volume,
        signal,
      })
    )
  }

  function archiveSpeech(plugin, result) {
    if (!Buffer.isBuffer(result.audio) || !result.audio.length) throw new Error('语音服务没有返回有效音频')
    if (result.audio.length > 32 * 1024 * 1024) throw new Error('生成的语音文件过大')
    const format = ['wav', 'pcm'].includes(result.format) ? result.format : 'wav'
    const now = new Date()
    const pad = value => String(value).padStart(2, '0')
    const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    const label = `${result.model || plugin.defaultModel}-${result.voice || 'voice'}`.replace(/[^a-z0-9-]+/gi, '-').slice(0, 80)
    const targetDirectory = path.join(ttsDirectory, month)
    fs.mkdirSync(targetDirectory, { recursive: true })
    const archivePath = path.join(targetDirectory, `${timestamp}-${label}-${crypto.randomBytes(3).toString('hex')}.${format}`)
    fs.writeFileSync(archivePath, result.audio)
    return archivePath
  }

  async function test(pluginId) {
    const plugin = pluginOrThrow(pluginId)
    if (supports(plugin, 'chat')) {
      const result = await runChat(pluginId, [
        { role: 'system', content: '你正在进行 API 连接测试。' },
        { role: 'user', content: '只回复“连接成功”。' },
      ])
      return { ok: true, reply: result.text, model: result.model }
    }
    if (supports(plugin, 'tts')) {
      const result = await runSpeech(pluginId, '你好，我已经准备好陪你聊天了。')
      const archivePath = archiveSpeech(plugin, result)
      return {
        ok: true,
        model: result.model,
        voice: result.voice,
        mimeType: result.mimeType || 'audio/wav',
        audioBase64: result.audio.toString('base64'),
        archivePath,
      }
    }
    throw new Error('这个插件没有可测试的能力')
  }

  async function chat({ pluginId, text, companionName, modelId }) {
    const state = readState()
    const selectedId = pluginId || activeIdFor(state, 'chat')
    if (!selectedId) throw new Error('请先安装并启用文字对话插件')
    const plugin = pluginOrThrow(selectedId)
    if (!state.installed.includes(selectedId)) throw new Error('请先安装 AI 对话插件')
    const input = typeof text === 'string' ? text.trim().slice(0, 2000) : ''
    if (!input) throw new Error('请输入要说的话')
    const config = pluginConfig(state, plugin)
    const identity = typeof companionName === 'string' && companionName.trim()
      ? companionName.trim().slice(0, 24)
      : '伙伴'
    const conversationKey = conversationKeyFor(selectedId, modelId)
    const history = conversations.get(conversationKey) || []
    const messages = [
      { role: 'system', content: config.persona },
      {
        role: 'system',
        content: `你当前的名字是${JSON.stringify(identity)}。这是用户为你设置的固定昵称；当用户询问你的名字或身份时，请准确使用这个昵称回答，不要自行编造其他名字。`,
      },
      {
        role: 'system',
        content: `每次回复时，在正文最开头输出一个与回复语境最贴合的情绪标签，格式为[标签]，只能从${EMOTION_TAGS.map(tag => `[${tag}]`).join(' ')}中选择。标签后紧跟正文，正文里不要再使用方括号标签。`,
      },
      {
        role: 'system',
        content: `回复正文不得超过 ${config.maxResponseChars} 个字符。请优先完整表达最重要的信息，不要为了凑字数重复内容。`,
      },
      ...(config.historyLimit > 0 ? history.slice(-config.historyLimit) : []),
      { role: 'user', content: input },
    ]
    const result = await runChat(selectedId, messages)
    // 情绪标签只用于驱动宠物动作，展示文本、TTS 文本和对话记忆都用剥离后的正文
    const extracted = extractEmotion(result.text)
    const reply = truncateResponse(extracted.text, config.maxResponseChars)
    const emotion = extracted.emotion
    if (config.historyLimit > 0) {
      conversations.set(conversationKey, [
        ...history,
        { role: 'user', content: input },
        { role: 'assistant', content: reply },
      ].slice(-config.historyLimit))
    } else {
      conversations.delete(conversationKey)
    }
    return { ok: true, pluginId: plugin.id, text: reply, emotion, model: result.model, usage: result.usage }
  }

  async function synthesize({ pluginId, text }) {
    const state = readState()
    const selectedId = pluginId || activeIdFor(state, 'tts')
    if (!selectedId) return { ok: false, skipped: true, error: '未启用语音模型' }
    const plugin = pluginOrThrow(selectedId)
    const input = typeof text === 'string' ? text.trim().slice(0, 1024) : ''
    if (!input) throw new Error('没有可合成的文字')
    const result = await runSpeech(selectedId, input)
    const archivePath = archiveSpeech(plugin, result)
    return {
      ok: true,
      pluginId: plugin.id,
      model: result.model,
      voice: result.voice,
      mimeType: result.mimeType || 'audio/wav',
      audioBase64: result.audio.toString('base64'),
      archivePath,
    }
  }

  function clearConversation(pluginId, modelId) {
    const state = readState()
    const selectedId = pluginId || activeIdFor(state, 'chat')
    if (selectedId) conversations.delete(conversationKeyFor(selectedId, modelId))
    return { ok: true }
  }

  function dispose() {
    for (const controller of activeRequests.values()) controller.abort()
    activeRequests.clear()
    conversations.clear()
    loadedPlugins.clear()
  }

  return { getSnapshot, refresh, install, activate, uninstall, configure, test, chat, synthesize, clearConversation, dispose }
}

module.exports = { createAIPluginManager }
