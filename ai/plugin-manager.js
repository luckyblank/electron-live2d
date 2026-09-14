const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { INITIAL_USER_DEFAULTS } = require('../config/defaults')
const { createTTSCache } = require('./tts-cache')

const DEFAULT_PERSONA = INITIAL_USER_DEFAULTS.ai.persona
const DEFAULT_HISTORY_MESSAGES = INITIAL_USER_DEFAULTS.ai.historyLimit
const MAX_HISTORY_MESSAGES = 40
const DEFAULT_MAX_RESPONSE_CHARACTERS = INITIAL_USER_DEFAULTS.ai.maxResponseChars
const MIN_RESPONSE_CHARACTERS = 50
const MAX_RESPONSE_CHARACTERS = 2000
const DEFAULT_TTS_SPEED = INITIAL_USER_DEFAULTS.ai.speed
const DEFAULT_TTS_VOLUME = INITIAL_USER_DEFAULTS.ai.volume
const REQUEST_TIMEOUT_MS = 45000
const TTS_REQUEST_TIMEOUT_MS = 60000
const SUPPORTED_CAPABILITIES = ['chat', 'tts']
const DEFAULT_TTS_CACHE_KEY_FIELDS = ['model', 'voice', 'speed', 'volume']
const MAX_PERSISTED_MESSAGE_CHARACTERS = 2000
const PREVIEW_AUDIO_URL_PATTERNS = [
  /^https:\/\/docs\.bigmodel\.cn\/resource\/audio\/[a-z0-9_-]+\.wav$/i,
  /^https:\/\/help-static-aliyun-doc\.aliyuncs\.com\/file-manage-files\/zh-CN\/\d{8}\/[a-z0-9]+\/[a-z0-9+_.%-]+\.wav$/i,
]

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

function normalizeTTSCacheKeyFields(value) {
  const fields = Array.isArray(value)
    ? [...new Set(value.filter(field => typeof field === 'string' && /^[a-z][a-zA-Z0-9]{0,39}$/.test(field)))]
    : []
  return fields.length ? fields : [...DEFAULT_TTS_CACHE_KEY_FIELDS]
}

function createAIPluginManager({ pluginsDirectories, store, safeStorage, ttsDirectory }) {
  let registry = null
  const loadedPlugins = new Map()
  // APP 对话和外部转述各自拥有独立的持久化空间。两条通道即使使用
  // 同一个角色、同一个文字插件，也绝不会读到或写入对方的上下文。
  const conversationCaches = {
    app: new Map(),
    external: new Map(),
  }
  const activeRequests = new Map()
  const externalSpeechRequests = new Map()
  const ttsCache = createTTSCache({
    directory: typeof ttsDirectory === 'string' && ttsDirectory ? path.join(ttsDirectory, 'cache-v1') : '',
  })

  function conversationKeyFor(modelId) {
    return typeof modelId === 'string' ? modelId.trim() : ''
  }

  function normalizedConversationMessages(value, scope = 'app') {
    const messageSource = scope === 'external' ? 'external' : 'app'
    if (!Array.isArray(value)) return []
    return value
      .filter(message => (
        message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string' &&
        !(messageSource === 'app' && message.source === 'external')
      ))
      .map(message => ({
        role: message.role,
        content: Array.from(message.content.trim()).slice(0, MAX_PERSISTED_MESSAGE_CHARACTERS).join(''),
        source: messageSource,
        sourceLabel: messageSource === 'external' ? '外部' : 'APP',
        ...(messageSource === 'external' && typeof message.sender === 'string' && message.sender.trim()
          ? { sender: Array.from(message.sender.trim()).slice(0, 60).join('') }
          : {}),
        ...(messageSource === 'external' && typeof message.requestId === 'string' && message.requestId.trim()
          ? { requestId: Array.from(message.requestId.trim()).slice(0, 120).join('') }
          : {}),
      }))
      .filter(message => message.content)
      .slice(-MAX_HISTORY_MESSAGES)
  }

  function conversationScope(value) {
    return value === 'external' ? 'external' : 'app'
  }

  function conversationStoreKey(scope) {
    return conversationScope(scope) === 'external' ? 'aiExternalConversations' : 'aiConversations'
  }

  function readPersistedConversations(scope = 'app') {
    const normalizedScope = conversationScope(scope)
    const storeKey = conversationStoreKey(normalizedScope)
    const value = store.get(storeKey)
    const stored = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}
    if (normalizedScope !== 'app') return stored

    // v1.0.1 早期版本曾把外部转述写进 aiConversations。读取旧配置时
    // 就地剥离这些条目，确保磁盘上的 APP 历史也不再残留外部消息。
    let changed = false
    for (const [key, entry] of Object.entries(stored)) {
      const messages = entry && Array.isArray(entry.messages) ? entry.messages : entry
      if (!Array.isArray(messages)) continue
      const appMessages = messages.filter(message => !message || message.source !== 'external')
      if (appMessages.length === messages.length) continue
      changed = true
      if (!appMessages.length) delete stored[key]
      else stored[key] = Array.isArray(entry) ? appMessages : { ...entry, messages: appMessages }
    }
    if (changed) store.set(storeKey, stored)
    return stored
  }

  function readConversation(modelId, scope = 'app') {
    const key = conversationKeyFor(modelId)
    if (!key) return []
    const normalizedScope = conversationScope(scope)
    const cache = conversationCaches[normalizedScope]
    if (cache.has(key)) return cache.get(key)
    const stored = readPersistedConversations(normalizedScope)[key]
    const messages = normalizedConversationMessages(
      stored && Array.isArray(stored.messages) ? stored.messages : stored,
      normalizedScope
    )
    cache.set(key, messages)
    return messages
  }

  function conversationIdentity(modelId, scope = 'app') {
    const key = conversationKeyFor(modelId)
    if (!key) return ''
    const stored = readPersistedConversations(scope)[key]
    const value = stored && !Array.isArray(stored) ? stored.companionName : ''
    return typeof value === 'string' ? Array.from(value.trim()).slice(0, 24).join('') : ''
  }

  function persistConversation(modelId, messages, companionName = '', scope = 'app') {
    const key = conversationKeyFor(modelId)
    if (!key) return
    const normalizedScope = conversationScope(scope)
    const cache = conversationCaches[normalizedScope]
    const normalized = normalizedConversationMessages(messages, normalizedScope)
    const stored = readPersistedConversations(normalizedScope)
    if (normalized.length) {
      const identity = typeof companionName === 'string'
        ? Array.from(companionName.trim()).slice(0, 24).join('')
        : ''
      stored[key] = {
        messages: normalized,
        ...(identity ? { companionName: identity } : {}),
        updatedAt: new Date().toISOString(),
      }
      cache.set(key, normalized)
    } else {
      delete stored[key]
      cache.delete(key)
    }
    store.set(conversationStoreKey(normalizedScope), stored)
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
      const previewUrl = PREVIEW_AUDIO_URL_PATTERNS.some(pattern => pattern.test(voice.previewUrl || ''))
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
          const configuredDefaults = INITIAL_USER_DEFAULTS.ai.pluginDefaults[manifest.id] || {}
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
            defaultModel: models.includes(configuredDefaults.model)
              ? configuredDefaults.model
              : (models.includes(manifest.defaultModel) ? manifest.defaultModel : models[0]),
            ttsTuning: manifest.ttsTuning !== false,
            ttsCacheKeyFields: normalizeTTSCacheKeyFields(manifest.ttsCacheKeyFields),
            voices,
            defaultVoice: voices.some(voice => voice.id === configuredDefaults.voice)
              ? configuredDefaults.voice
              : (voices.some(voice => voice.id === manifest.defaultVoice)
                  ? manifest.defaultVoice
                  : (voices[0] ? voices[0].id : '')),
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
    return ''
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
        ttsTuning: plugin.ttsTuning,
        ttsCacheKeyFields: plugin.ttsCacheKeyFields,
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

  function deactivate(pluginId, capability) {
    const plugin = pluginOrThrow(pluginId)
    const targetCapability = SUPPORTED_CAPABILITIES.includes(capability) ? capability : plugin.capabilities[0]
    const state = readState()
    if (!state.installed.includes(pluginId)) throw new Error('这个 AI 模型尚未安装')
    if (!supports(plugin, targetCapability)) throw new Error('这个模型不支持所选能力')
    for (const [requestKey, request] of activeRequests) {
      if (request.pluginId !== pluginId || request.capability !== targetCapability) continue
      request.controller.abort()
      activeRequests.delete(requestKey)
    }
    if (state.activeIds[targetCapability] === pluginId) state.activeIds[targetCapability] = ''
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
    if (patch.credentialPreference === 'environment') {
      if (!environmentKey(plugin)) {
        const name = plugin.apiKeyEnv || 'API Key 环境变量'
        throw new Error(`未检测到环境变量 ${name}，无法切换`)
      }
      // A manually entered key sets a persistent local preference. Remove that
      // override when the user explicitly switches back so every plugin sharing
      // this credential immediately reads the environment value again.
      delete state.secrets[plugin.credentialId]
      state.credentialPreferences[plugin.credentialId] = 'environment'
    } else if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法安全保存 API Key')
      state.secrets[plugin.credentialId] = safeStorage.encryptString(patch.apiKey.trim()).toString('base64')
      state.credentialPreferences[plugin.credentialId] = 'local'
    }
    state.settings[pluginId] = { model, persona, historyLimit, maxResponseChars, voice, speed, volume }
    for (const capability of plugin.capabilities) state.activeIds[capability] = pluginId
    saveState(state)
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

  async function runRequest(pluginId, capability, lane, timeoutMs, callback) {
    const requestLane = typeof lane === 'string' && lane.trim() ? lane.trim() : 'app'
    const requestKey = `${pluginId}:${capability}:${requestLane}`
    const previousRequest = activeRequests.get(requestKey)
    if (previousRequest) previousRequest.controller.abort()
    const controller = new AbortController()
    activeRequests.set(requestKey, { capability, controller, pluginId, lane: requestLane })
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await callback(controller.signal)
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('请求超时或已被新的请求取消')
      throw error
    } finally {
      clearTimeout(timeout)
      const active = activeRequests.get(requestKey)
      if (active && active.controller === controller) activeRequests.delete(requestKey)
    }
  }

  async function runChat(pluginId, messages, lane = 'app') {
    const plugin = pluginOrThrow(pluginId)
    const state = readState()
    if (!state.installed.includes(pluginId)) throw new Error('请先安装这个 AI 插件')
    if (!supports(plugin, 'chat')) throw new Error('这个插件不支持文字对话')
    const apiKey = decryptKey(state, plugin)
    const config = pluginConfig(state, plugin)
    const adapter = loadPlugin(pluginId, 'chat')
    return runRequest(pluginId, 'chat', lane, REQUEST_TIMEOUT_MS, signal =>
      adapter.chat({
        apiKey,
        model: config.model,
        messages,
        maxTokens: responseTokenLimit(config.maxResponseChars),
        signal,
      })
    )
  }

  function speechRuntime(pluginId) {
    const plugin = pluginOrThrow(pluginId)
    const state = readState()
    if (!state.installed.includes(pluginId)) throw new Error('请先安装这个语音插件')
    if (!supports(plugin, 'tts')) throw new Error('这个插件不支持语音合成')
    return { plugin, state, config: pluginConfig(state, plugin) }
  }

  async function runSpeech(pluginId, input, lane = 'app', runtime = null) {
    const context = runtime || speechRuntime(pluginId)
    const { plugin, state, config } = context
    const apiKey = decryptKey(state, plugin)
    const adapter = loadPlugin(pluginId, 'tts')
    return runRequest(pluginId, 'tts', lane, TTS_REQUEST_TIMEOUT_MS, signal =>
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

  async function chat({
    pluginId,
    text,
    companionName,
    companionBaseName,
    companionProfile,
    modelId,
    source = 'app',
    sourceLabel,
    sender,
    requestId,
    useCurrentCharacterProfile = true,
    useExternalContext = true,
  }) {
    const state = readState()
    const selectedId = pluginId || activeIdFor(state, 'chat')
    if (!selectedId) throw new Error('请先安装并启用文字对话插件')
    const plugin = pluginOrThrow(selectedId)
    if (!state.installed.includes(selectedId)) throw new Error('请先安装 AI 对话插件')
    const input = typeof text === 'string' ? text.trim().slice(0, 2000) : ''
    if (!input) throw new Error('请输入要说的话')
    const config = pluginConfig(state, plugin)
    const messageSource = source === 'external' ? 'external' : 'app'
    const contextScope = messageSource === 'external' ? 'external' : 'app'
    const shouldUseCharacterProfile = messageSource !== 'external' || useCurrentCharacterProfile !== false
    const shouldUseContext = messageSource !== 'external' || useExternalContext !== false
    const identity = typeof companionName === 'string' && companionName.trim()
      ? Array.from(companionName.trim()).slice(0, 24).join('')
      : '伙伴'
    const baseIdentity = typeof companionBaseName === 'string' && companionBaseName.trim()
      ? Array.from(companionBaseName.trim()).slice(0, 120).join('')
      : ''
    const previousIdentity = shouldUseContext ? conversationIdentity(modelId, contextScope) : ''
    const history = shouldUseContext ? readConversation(modelId, contextScope) : []
    const staleIdentities = [...new Set([previousIdentity, baseIdentity])]
      .filter(value => value && value !== identity)
    const identityCorrection = staleIdentities.length
      ? `历史对话中出现的${staleIdentities.map(value => JSON.stringify(value)).join('、')}都是旧称呼或模型文件名，不能再用作你的名字。`
      : '如果历史对话中出现其他名字，一律视为已经失效的旧称呼。'
    const characterInstructions = shouldUseCharacterProfile
      ? [
          {
            role: 'system',
            content: typeof companionProfile === 'string' && companionProfile.trim()
              ? companionProfile.trim().slice(0, 4000)
              : DEFAULT_PERSONA,
          },
          {
            // 兼容只读取开头 system 指令的服务端实现；历史之后还会再放一条
            // 最新身份校正，用来覆盖旧对话里的过期自称。
            role: 'system',
            content: `你当前的名字是${JSON.stringify(identity)}。这是用户设置的固定昵称；当用户询问你的名字或身份时，请准确使用这个昵称回答。`,
          },
        ]
      : [
          {
            role: 'system',
            content: '你是外部系统消息转述助手。请根据外部系统提供的内容给出简洁、自然的回复；不要声称自己是当前桌宠角色，也不要使用桌宠的姓名或人格设定。',
          },
        ]
    const identityCorrectionMessage = shouldUseCharacterProfile
      ? [{
          // 身份指令必须放在历史之后：改名以前的 assistant 消息可能仍在
          // 上下文里自称旧昵称，最后再校正一次才能让当前昵称覆盖旧记忆。
          role: 'system',
          content: `最新身份信息：你当前且唯一的名字是${JSON.stringify(identity)}。${identityCorrection}从本轮开始，当用户询问你的名字、身份或要求自我介绍时，只能准确使用${JSON.stringify(identity)}回答。`,
        }]
      : []
    const messages = [
      ...characterInstructions,
      {
        role: 'system',
        content: `每次回复时，在正文最开头输出一个与回复语境最贴合的情绪标签，格式为[标签]，只能从${EMOTION_TAGS.map(tag => `[${tag}]`).join(' ')}中选择。标签后紧跟正文，正文里不要再使用方括号标签。`,
      },
      {
        role: 'system',
        content: `回复正文不得超过 ${config.maxResponseChars} 个字符。请优先完整表达最重要的信息，不要为了凑字数重复内容。`,
      },
      ...(shouldUseContext && config.historyLimit > 0
        ? history.slice(-config.historyLimit).map(message => ({ role: message.role, content: message.content }))
        : []),
      ...identityCorrectionMessage,
      { role: 'user', content: input },
    ]
    const result = await runChat(selectedId, messages, messageSource)
    // 情绪标签只用于驱动宠物动作，展示文本、TTS 文本和对话记忆都用剥离后的正文
    const extracted = extractEmotion(result.text)
    const reply = truncateResponse(extracted.text, config.maxResponseChars)
    const emotion = extracted.emotion
    const persistedSource = {
      source: messageSource,
      sourceLabel: messageSource === 'external' ? '外部' : 'APP',
      ...(messageSource === 'external' && typeof sender === 'string' ? { sender } : {}),
      ...(messageSource === 'external' && typeof requestId === 'string' ? { requestId } : {}),
    }
    if (shouldUseContext && config.historyLimit > 0) {
      persistConversation(modelId, [
        ...history,
        { role: 'user', content: input, ...persistedSource },
        { role: 'assistant', content: reply, ...persistedSource },
      ].slice(-config.historyLimit), shouldUseCharacterProfile ? identity : '', contextScope)
    } else if (shouldUseContext) {
      persistConversation(modelId, [], '', contextScope)
    }
    return {
      ok: true,
      pluginId: plugin.id,
      text: reply,
      emotion,
      model: result.model,
      usage: result.usage,
      source: messageSource,
      sourceLabel: messageSource === 'external'
        ? (typeof sourceLabel === 'string' && sourceLabel.trim() ? sourceLabel.trim().slice(0, 20) : '外部')
        : 'APP',
    }
  }

  async function synthesize({ pluginId, text, source = 'app' }) {
    const state = readState()
    const selectedId = pluginId || activeIdFor(state, 'tts')
    if (!selectedId) return { ok: false, skipped: true, error: '未启用语音模型' }
    const runtime = speechRuntime(selectedId)
    const { plugin, config } = runtime
    const input = typeof text === 'string' ? text.trim().slice(0, 1024) : ''
    if (!input) throw new Error('没有可合成的文字')
    const externalRequest = source === 'external'
    let cached = false
    let result = externalRequest ? ttsCache.read(plugin, input, config) : null
    if (result) {
      cached = true
    } else if (externalRequest) {
      const cacheKey = ttsCache.keyFor(plugin, input, config)
      const pending = externalSpeechRequests.get(cacheKey)
      if (pending) {
        result = await pending
        cached = true
      } else {
        const request = runSpeech(selectedId, input, 'external', runtime).then(generated => {
          const normalized = {
            ...generated,
            model: generated.model || config.model,
            voice: generated.voice || config.voice,
          }
          ttsCache.write(plugin, input, config, normalized)
          return normalized
        })
        externalSpeechRequests.set(cacheKey, request)
        try {
          result = await request
        } finally {
          if (externalSpeechRequests.get(cacheKey) === request) externalSpeechRequests.delete(cacheKey)
        }
      }
    } else {
      result = await runSpeech(selectedId, input, 'app', runtime)
    }
    const archivePath = archiveSpeech(plugin, result)
    return {
      ok: true,
      pluginId: plugin.id,
      model: result.model,
      voice: result.voice,
      format: ['wav', 'pcm'].includes(result.format) ? result.format : 'wav',
      mimeType: result.mimeType || 'audio/wav',
      audioBase64: result.audio.toString('base64'),
      archivePath,
      cached,
    }
  }

  function getConversation(modelId) {
    return {
      ok: true,
      modelId: conversationKeyFor(modelId),
      companionName: conversationIdentity(modelId, 'app'),
      messages: readConversation(modelId, 'app').map(message => ({ ...message })),
    }
  }

  function clearConversation(_pluginId, modelId) {
    persistConversation(modelId, [], '', 'app')
    return { ok: true }
  }

  function cancelActive(capability = '') {
    const state = readState()
    const targetId = SUPPORTED_CAPABILITIES.includes(capability) ? activeIdFor(state, capability) : ''
    let cancelled = 0
    for (const request of activeRequests.values()) {
      if (targetId && request.pluginId !== targetId) continue
      if (capability && request.capability !== capability) continue
      request.controller.abort()
      cancelled += 1
    }
    return cancelled
  }

  function dispose() {
    for (const request of activeRequests.values()) request.controller.abort()
    activeRequests.clear()
    externalSpeechRequests.clear()
    conversationCaches.app.clear()
    conversationCaches.external.clear()
    loadedPlugins.clear()
  }

  return { getSnapshot, refresh, install, activate, deactivate, configure, test, chat, synthesize, getConversation, clearConversation, cancelActive, dispose }
}

module.exports = { createAIPluginManager }
