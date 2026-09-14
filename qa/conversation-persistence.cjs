const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const { createAIPluginManager } = require(path.join(projectRoot, 'ai', 'plugin-manager'))

const qaResults = []
let temporaryRoot = ''

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function createFakeStore() {
  const values = {}
  return {
    get(key) {
      return clone(values[key])
    },
    set(key, value) {
      values[key] = clone(value)
    },
    dump() {
      return clone(values)
    },
  }
}

const fakeSafeStorage = {
  isEncryptionAvailable() {
    return true
  },
  encryptString(value) {
    return Buffer.from(String(value), 'utf8')
  },
  decryptString(value) {
    return Buffer.from(value).toString('utf8')
  },
}

function record(name, value, details = undefined) {
  assert.ok(value, `${name}${details === undefined ? '' : `: ${JSON.stringify(details)}`}`)
  qaResults.push({ name, passed: true, ...(details === undefined ? {} : { details }) })
}

function recordEqual(name, actual, expected) {
  assert.deepStrictEqual(actual, expected, `${name}: actual value did not match expected value`)
  qaResults.push({ name, passed: true })
}

function createPlugin(pluginsDirectory, id, capabilities) {
  const pluginDirectory = path.join(pluginsDirectory, id)
  fs.mkdirSync(pluginDirectory, { recursive: true })
  const supportsSpeech = capabilities.includes('tts')
  const manifest = {
    id,
    name: `QA ${id}`,
    version: '1.0.0',
    capabilities,
    models: [`${id}-model`],
    defaultModel: `${id}-model`,
    main: 'index.js',
    ...(supportsSpeech
      ? {
          voices: [{ id: 'qa-voice', name: 'QA Voice' }],
          defaultVoice: 'qa-voice',
        }
      : {}),
  }
  fs.writeFileSync(path.join(pluginDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  fs.writeFileSync(path.join(pluginDirectory, 'index.js'), `
globalThis.__conversationPersistenceQaCalls ||= []

exports.chat = async function chat({ messages, model, signal }) {
  const copiedMessages = messages.map(message => ({ role: message.role, content: message.content }))
  const messageKeys = messages.map(message => Object.keys(message).sort())
  globalThis.__conversationPersistenceQaCalls.push({ pluginId: ${JSON.stringify(id)}, messages: copiedMessages, messageKeys })
  const latestUserMessage = [...copiedMessages].reverse().find(message => message.role === 'user')
  if (latestUserMessage && latestUserMessage.content.includes('并发等待')) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 80)
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      }, { once: true })
    })
  }
  return {
    text: '[平静]${id} 回复：' + (latestUserMessage ? latestUserMessage.content : ''),
    model,
    usage: { promptTokens: copiedMessages.length },
  }
}

exports.synthesize = async function synthesize({ model, voice }) {
  return {
    audio: Buffer.from('RIFF-qa-audio-binary', 'utf8'),
    format: 'wav',
    mimeType: 'audio/wav',
    model,
    voice,
  }
}
`.trimStart())
}

function makeManager(pluginsDirectory, store, ttsDirectory) {
  return createAIPluginManager({
    pluginsDirectories: [pluginsDirectory],
    store,
    safeStorage: fakeSafeStorage,
    ttsDirectory,
  })
}

async function run() {
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-conversation-persistence-'))
  const pluginsDirectory = path.join(temporaryRoot, 'plugins')
  const ttsDirectory = path.join(temporaryRoot, 'tts')
  fs.mkdirSync(pluginsDirectory, { recursive: true })
  createPlugin(pluginsDirectory, 'qa-alpha', ['chat', 'tts'])
  createPlugin(pluginsDirectory, 'qa-beta', ['chat'])

  const store = createFakeStore()
  store.set('aiConversations', {
    'legacy-mixed': {
      messages: [
        { role: 'user', content: '旧版 APP 消息', source: 'app', sourceLabel: 'APP' },
        { role: 'assistant', content: '旧版外部消息', source: 'external', sourceLabel: '外部' },
      ],
    },
  })
  globalThis.__conversationPersistenceQaCalls = []

  const firstManager = makeManager(pluginsDirectory, store, ttsDirectory)
  recordEqual('旧版混合历史恢复时过滤外部消息', firstManager.getConversation('legacy-mixed').messages, [
    { role: 'user', content: '旧版 APP 消息', source: 'app', sourceLabel: 'APP' },
  ])
  record(
    '旧版外部消息会从 APP 持久化 Store 中迁出',
    !JSON.stringify(store.dump().aiConversations).includes('旧版外部消息'),
    store.dump().aiConversations
  )
  firstManager.install('qa-alpha')
  firstManager.configure('qa-alpha', { apiKey: 'alpha-secret' })
  firstManager.install('qa-beta')
  firstManager.configure('qa-beta', { apiKey: 'beta-secret' })
  firstManager.activate('qa-alpha', 'chat')

  const firstReply = await firstManager.chat({
    text: '角色 A 的第一句话',
    companionName: '角色 A',
    modelId: 'role-a',
  })
  recordEqual('角色 A 首轮回复移除情绪标签', firstReply.text, 'qa-alpha 回复：角色 A 的第一句话')
  const roleAAfterFirstChat = firstManager.getConversation('role-a')
  recordEqual('角色 A 首轮会话记录当前昵称', roleAAfterFirstChat.companionName, '角色 A')
  recordEqual('角色 A 首轮会话写入持久化 Store', roleAAfterFirstChat.messages, [
    { role: 'user', content: '角色 A 的第一句话', source: 'app', sourceLabel: 'APP' },
    { role: 'assistant', content: 'qa-alpha 回复：角色 A 的第一句话', source: 'app', sourceLabel: 'APP' },
  ])
  recordEqual('角色 B 初始会话与角色 A 隔离', firstManager.getConversation('role-b').messages, [])
  firstManager.dispose()

  const secondManager = makeManager(pluginsDirectory, store, ttsDirectory)
  recordEqual(
    '重建 manager 后恢复角色 A 会话',
    secondManager.getConversation('role-a').messages,
    roleAAfterFirstChat.messages
  )

  await secondManager.chat({
    pluginId: 'qa-alpha',
    text: '角色 A 的第二句话',
    companionName: '角色 A 新昵称',
    companionBaseName: 'role-a-model',
    modelId: 'role-a',
  })
  const roleASecondCall = globalThis.__conversationPersistenceQaCalls.at(-1)
  record(
    '恢复的角色 A 历史会传给下一轮模型请求',
    roleASecondCall.messages.some(message => message.role === 'user' && message.content === '角色 A 的第一句话') &&
      roleASecondCall.messages.some(message => message.role === 'assistant' && message.content === 'qa-alpha 回复：角色 A 的第一句话')
  )
  const previousAssistantIndex = roleASecondCall.messages.findIndex(message =>
    message.role === 'assistant' && message.content === 'qa-alpha 回复：角色 A 的第一句话'
  )
  const latestIdentityIndex = roleASecondCall.messages.findLastIndex(message =>
    message.role === 'system' && message.content.includes('最新身份信息')
  )
  const latestUserIndex = roleASecondCall.messages.findLastIndex(message => message.role === 'user')
  record(
    '改名后的身份指令位于旧历史之后、最新用户消息之前',
    latestIdentityIndex > previousAssistantIndex && latestIdentityIndex === latestUserIndex - 1,
    roleASecondCall.messages
  )
  record(
    '改名后的身份指令明确覆盖旧昵称与模型文件名',
    roleASecondCall.messages[latestIdentityIndex].content.includes('角色 A 新昵称') &&
      roleASecondCall.messages[latestIdentityIndex].content.includes('角色 A') &&
      roleASecondCall.messages[latestIdentityIndex].content.includes('role-a-model')
  )
  recordEqual('改名后的昵称写回会话元数据', secondManager.getConversation('role-a').companionName, '角色 A 新昵称')

  await secondManager.chat({
    pluginId: 'qa-alpha',
    text: '角色 B 的独立消息',
    companionName: '角色 B',
    modelId: 'role-b',
  })
  const roleBCall = globalThis.__conversationPersistenceQaCalls.at(-1)
  record(
    '角色 B 请求不携带角色 A 的历史',
    !roleBCall.messages.some(message => /角色 A 的第一句话|角色 A 的第二句话/.test(message.content))
  )

  await secondManager.chat({
    pluginId: 'qa-alpha',
    text: '外部系统的第一条转述',
    companionName: '角色 C',
    modelId: 'role-c',
    source: 'external',
    sourceLabel: '外部',
    sender: 'QA 外部系统',
    requestId: 'external-1',
  })
  await secondManager.chat({
    pluginId: 'qa-alpha',
    text: '外部系统的第二条转述',
    companionName: '角色 C',
    modelId: 'role-c',
    source: 'external',
    sourceLabel: '外部',
    sender: 'QA 外部系统',
    requestId: 'external-2',
  })
  const externalConversation = store.dump().aiExternalConversations['role-c'].messages
  record(
    '外部转述会话持久化到独立 Store 并保留来源',
    externalConversation.length === 4 && externalConversation.every(message =>
      message.source === 'external' && message.sourceLabel === '外部' && message.sender === 'QA 外部系统' &&
      /^external-[12]$/.test(message.requestId)
    ),
    externalConversation
  )
  recordEqual('App 会话读取接口不返回外部转述', secondManager.getConversation('role-c').messages, [])
  const externalSecondCall = globalThis.__conversationPersistenceQaCalls.at(-1)
  record(
    '第二条外部转述只携带独立外部历史',
    externalSecondCall.messages.some(message => message.content === '外部系统的第一条转述') &&
      !externalSecondCall.messages.some(message => /角色 A 的第一句话|角色 B 的独立消息/.test(message.content)),
    externalSecondCall.messages
  )
  record(
    '宿主来源元数据不会传给 provider adapter',
    externalSecondCall.messageKeys.every(keys => keys.length === 2 && keys[0] === 'content' && keys[1] === 'role'),
    externalSecondCall.messageKeys
  )

  await secondManager.chat({
    pluginId: 'qa-alpha',
    text: '无角色设定且不记上下文',
    companionName: '不应出现的昵称',
    companionProfile: '不应出现的人设',
    modelId: 'role-c',
    source: 'external',
    sender: 'QA 外部系统',
    requestId: 'external-stateless',
    useCurrentCharacterProfile: false,
    useExternalContext: false,
  })
  const statelessExternalCall = globalThis.__conversationPersistenceQaCalls.at(-1)
  record(
    '关闭当前角色设定时使用中性外部转述提示',
    statelessExternalCall.messages.some(message => message.role === 'system' && message.content.includes('外部系统消息转述助手')) &&
      !statelessExternalCall.messages.some(message => /不应出现的昵称|不应出现的人设/.test(message.content)),
    statelessExternalCall.messages
  )
  record(
    '关闭外部上下文时不读取旧历史且不写入新记录',
    !statelessExternalCall.messages.some(message => message.content === '外部系统的第一条转述') &&
      store.dump().aiExternalConversations['role-c'].messages.length === 4,
    store.dump().aiExternalConversations['role-c']
  )

  await secondManager.chat({
    pluginId: 'qa-alpha',
    text: '角色 C 的 App 消息',
    companionName: '角色 C',
    modelId: 'role-c',
  })
  const roleCAppCall = globalThis.__conversationPersistenceQaCalls.at(-1)
  record(
    'App 请求不携带外部转述上下文',
    !roleCAppCall.messages.some(message => /外部系统的第一条转述|外部系统的第二条转述/.test(message.content)),
    roleCAppCall.messages
  )
  record(
    'App 与外部上下文分别写入各自 Store',
    store.dump().aiConversations['role-c'].messages.every(message => message.source === 'app') &&
      store.dump().aiExternalConversations['role-c'].messages.every(message => message.source === 'external')
  )
  const concurrentReplies = await Promise.all([
    secondManager.chat({
      pluginId: 'qa-alpha',
      text: 'App 并发等待',
      companionName: '角色 D',
      modelId: 'role-d',
    }),
    secondManager.chat({
      pluginId: 'qa-alpha',
      text: '外部并发等待',
      companionName: '角色 D',
      modelId: 'role-d',
      source: 'external',
      useExternalContext: false,
    }),
  ])
  record(
    'App 与外部转述使用独立请求通道且可同时完成',
    concurrentReplies.length === 2 && concurrentReplies.every(reply => reply.ok),
    concurrentReplies
  )
  const roleABeforePluginStateChanges = secondManager.getConversation('role-a').messages
  const roleBBeforePluginStateChanges = secondManager.getConversation('role-b').messages

  secondManager.activate('qa-beta', 'chat')
  recordEqual(
    '切换文字插件不清除角色 A 会话',
    secondManager.getConversation('role-a').messages,
    roleABeforePluginStateChanges
  )
  recordEqual(
    '切换文字插件不清除角色 B 会话',
    secondManager.getConversation('role-b').messages,
    roleBBeforePluginStateChanges
  )
  secondManager.deactivate('qa-beta', 'chat')
  recordEqual(
    '停用文字插件不清除角色 A 会话',
    secondManager.getConversation('role-a').messages,
    roleABeforePluginStateChanges
  )
  recordEqual(
    '停用文字插件不清除角色 B 会话',
    secondManager.getConversation('role-b').messages,
    roleBBeforePluginStateChanges
  )

  const conversationsBeforeSpeech = store.dump().aiConversations
  const speech = await secondManager.synthesize({ pluginId: 'qa-alpha', text: '这段音频不可进入会话记录' })
  record('语音 QA 成功生成独立归档文件', speech.ok && fs.existsSync(speech.archivePath), speech.archivePath)
  recordEqual('语音生成不会修改持久化会话', store.dump().aiConversations, conversationsBeforeSpeech)
  const serializedConversationStore = JSON.stringify(store.dump().aiConversations)
  record(
    '持久化会话中不保存音频、Base64 或音频路径字段',
    !/audioBase64|archivePath|RIFF-qa-audio-binary|UklGRi1xYS1hdWRpby1iaW5hcnk=/.test(serializedConversationStore)
  )
  const persistedMessages = [store.dump().aiConversations, store.dump().aiExternalConversations]
    .flatMap(collection => Object.values(collection || {}))
    .flatMap(entry => Array.isArray(entry && entry.messages) ? entry.messages : [])
  record(
    '持久化消息只包含对话与来源元数据，不包含音频或 provider 数据',
    persistedMessages.every(message => {
      const allowedKeys = new Set(['role', 'content', 'source', 'sourceLabel', 'sender', 'requestId'])
      return Object.keys(message).every(key => allowedKeys.has(key)) &&
        ((message.source === 'app' && message.sourceLabel === 'APP') ||
          (message.source === 'external' && message.sourceLabel === '外部'))
    })
  )
  record(
    '思考与语音合成中间态不写入持久化会话',
    persistedMessages.every(message => !/^思考中…?$|^语音合成中…?$/.test(message.content))
  )

  secondManager.clearConversation('qa-beta', 'role-a')
  recordEqual('clear 只清除目标角色 A', secondManager.getConversation('role-a').messages, [])
  recordEqual(
    'clear 不影响角色 B',
    secondManager.getConversation('role-b').messages,
    roleBBeforePluginStateChanges
  )
  secondManager.dispose()

  const thirdManager = makeManager(pluginsDirectory, store, ttsDirectory)
  recordEqual('再次重建 manager 后角色 A 仍保持已清空', thirdManager.getConversation('role-a').messages, [])
  recordEqual(
    '再次重建 manager 后角色 B 仍可恢复',
    thirdManager.getConversation('role-b').messages,
    roleBBeforePluginStateChanges
  )
  thirdManager.dispose()

  return {
    passed: qaResults.length,
    failed: 0,
    checks: qaResults,
    persistedRoleIds: Object.keys(store.dump().aiConversations || {}).sort(),
  }
}

run()
  .then(report => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  })
  .catch(error => {
    process.stderr.write(`${JSON.stringify({
      passed: qaResults.length,
      failed: 1,
      checks: qaResults,
      error: error && error.stack ? error.stack : String(error),
    }, null, 2)}\n`)
    process.exitCode = 1
  })
  .finally(() => {
    delete globalThis.__conversationPersistenceQaCalls
    if (temporaryRoot && temporaryRoot.startsWith(os.tmpdir())) {
      fs.rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })
