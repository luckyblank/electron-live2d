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

exports.chat = async function chat({ messages, model }) {
  const copiedMessages = messages.map(message => ({ role: message.role, content: message.content }))
  globalThis.__conversationPersistenceQaCalls.push({ pluginId: ${JSON.stringify(id)}, messages: copiedMessages })
  const latestUserMessage = [...copiedMessages].reverse().find(message => message.role === 'user')
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
  globalThis.__conversationPersistenceQaCalls = []

  const firstManager = makeManager(pluginsDirectory, store, ttsDirectory)
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
    { role: 'user', content: '角色 A 的第一句话' },
    { role: 'assistant', content: 'qa-alpha 回复：角色 A 的第一句话' },
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
  const persistedMessages = Object.values(store.dump().aiConversations)
    .flatMap(entry => Array.isArray(entry && entry.messages) ? entry.messages : [])
  record(
    '持久化消息仅包含 role 与 content',
    persistedMessages.every(message => {
      const keys = Object.keys(message).sort()
      return keys.length === 2 && keys[0] === 'content' && keys[1] === 'role'
    })
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
