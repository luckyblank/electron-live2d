const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')
const sharp = require('sharp')
const { BUBBLE_THEME_DEFINITIONS } = require('../config/bubble-styles')
const { captureSettingsPanel } = require('../settings-screenshot')

const projectRoot = path.resolve(__dirname, '..')

app.commandLine.appendSwitch('force-device-scale-factor', process.env.QA_DEVICE_SCALE || '1')
app.commandLine.appendSwitch('disable-gpu')
app.setPath('userData', path.join(os.tmpdir(), 'live2d-companion-qa-userdata'))

const outDir = path.join(os.tmpdir(), `live2d-companion-qa${process.env.QA_DEVICE_SCALE ? `-${process.env.QA_DEVICE_SCALE}x` : ''}`)
fs.mkdirSync(outDir, { recursive: true })

const coversDir = path.join(process.env.APPDATA || '', 'Live2DCompanion', 'covers')
const modelDefs = [
  ['mori-suit', 'mori-suit'],
  ['hiyori', 'hiyori'],
  ['mao_pro', 'mao_pro'],
]

const qaProfile = {
  species: '狐耳妖精',
  age: '约16岁',
  height: '160 cm',
  personality: '温柔、治愈、有点天然、喜欢撒娇',
  likes: '甜食、午后阳光、和你在一起、被摸头',
  bio: '来自森林的狐耳少女，会一直陪在你身边。希望用温柔的陪伴，让你的每一天都更可爱♡',
  worldview: '生活在现实与梦境交界的森林里。',
  relationship: '把用户视为最重要的伙伴。',
  rules: '保持温暖、自然、简短的中文表达。',
}

const qaAssets = {
  actions: ['待机', '挥手', '坐下', '开心跳跃', '点头', '摇头'].map((label, index) => ({
    id: `action-${index}`,
    label,
    type: 'group',
    group: 'Idle',
    index: 0,
  })),
  expressions: ['默认', '微笑', '开心', '生气', '害羞', '兴奋'].map((label, index) => ({
    id: `expression-${index}`,
    label,
    type: 'native',
    expressionId: `expression-${index}`,
  })),
}

const qaInteractionDefaults = [
  { id: 'greet', label: '打个招呼', kind: 'greet', text: '你好呀～', actionId: '', enabled: true, isDefault: true, defaultLabel: '打个招呼', defaultText: '你好呀～', defaultMapping: '问候 / 挥手动作' },
  { id: 'head', label: '摸摸头', kind: 'head', text: '好舒服～', actionId: '', enabled: true, isDefault: true, defaultLabel: '摸摸头', defaultText: '好舒服～', defaultMapping: '摸头动作' },
  { id: 'praise', label: '夸夸她', kind: 'praise', text: '被夸奖了 ✦', actionId: '', enabled: true, isDefault: true, defaultLabel: '夸夸她', defaultText: '被夸奖了 ✦', defaultMapping: '开心 / 夸奖动作' },
  { id: 'snack', label: '投喂点心', kind: 'snack', text: '好吃！', actionId: '', enabled: true, isDefault: true, defaultLabel: '投喂点心', defaultText: '好吃！', defaultMapping: '投喂动作' },
  { id: 'random', label: '随机互动', kind: 'random', text: '来和我玩吧～', actionId: '', enabled: true, isDefault: true, defaultLabel: '随机互动', defaultText: '来和我玩吧～', defaultMapping: '随机选择可用互动' },
]
const qaGestureDefaults = [
  { id: 'tap-head', label: '单击头部', kind: 'head', actionId: '', text: '好舒服～', defaultMapping: '摸头动作' },
  { id: 'tap-body', label: '单击身体', kind: 'curious', actionId: '', text: '在忙什么呀？', defaultMapping: '点击 / 好奇动作' },
  { id: 'double-click', label: '连续双击', kind: 'praise', actionId: '', text: '被夸奖了 ✦', defaultMapping: '开心 / 夸奖动作' },
  { id: 'triple-click', label: '连续三击', kind: 'excited', actionId: '', text: '最喜欢你啦！', defaultMapping: '兴奋 / 开心动作' },
  { id: 'long-press-head', label: '长按头部', kind: 'head', actionId: '', text: '再摸一下嘛', defaultMapping: '摸头动作' },
  { id: 'long-press-body', label: '长按身体', kind: 'calm', actionId: '', text: '让我靠一会儿', defaultMapping: '休息 / 安静动作' },
  { id: 'drag-end', label: '拖拽结束', kind: 'drag', actionId: '', text: '新位置不错', defaultMapping: '拖拽动作' },
]

function qaInteractions(value) {
  if (!Array.isArray(value)) return structuredClone(qaInteractionDefaults)
  const defaults = qaInteractionDefaults.map(item => ({ ...item, ...(value.find(entry => entry.id === item.id) || {}), kind: item.kind, isDefault: true, defaultLabel: item.defaultLabel, defaultText: item.defaultText, defaultMapping: item.defaultMapping }))
  const customs = value.filter(item => item.id.startsWith('custom-')).map(item => ({ ...item, kind: 'custom', text: item.text || item.label, isDefault: false, defaultLabel: '', defaultText: '', defaultMapping: '' }))
  const byId = new Map([...defaults, ...customs].map(item => [item.id, item]))
  const used = new Set()
  const ordered = []
  for (const item of value) {
    if (!byId.has(item.id) || used.has(item.id)) continue
    used.add(item.id)
    ordered.push(byId.get(item.id))
  }
  for (const item of defaults) {
    if (!used.has(item.id)) ordered.push(item)
  }
  return ordered.sort((left, right) => Number(right.enabled !== false) - Number(left.enabled !== false))
}

function qaGestures(value) {
  if (!Array.isArray(value)) return structuredClone(qaGestureDefaults)
  return qaGestureDefaults.map(item => ({ ...item, ...(value.find(entry => entry.id === item.id) || {}), label: item.label, kind: item.kind, defaultMapping: item.defaultMapping }))
}

function coverUrl(id) {
  for (const name of [`${id}.centered-v3.png`, `${id}.centered-v2.png`, `${id}.png`]) {
    const file = path.join(coversDir, name)
    if (fs.existsSync(file)) return pathToFileURL(file).href
  }
  return ''
}

function plugin({ id, name, shortName, capabilities, activeCapabilities, models, voice = false, voices = [] }) {
  const voiceCatalog = voice
    ? (voices.length ? voices : [{ id: 'female-youthful', name: '温柔少女', previewUrl: '' }])
    : []
  return {
    id,
    name,
    shortName,
    version: '1.0.0',
    description: voice ? '智谱语音合成插件' : `${name} 聊天模型插件`,
    capabilities,
    activeCapabilities,
    installed: true,
    configured: true,
    credentialPreview: 'sk-••••••••••••4a9f',
    credentialSource: 'local',
    apiKeyEnv: id === 'qwen-tts' ? 'DASHSCOPE_API_KEY' : (voice ? 'ZHIPU_API_KEY' : (id === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'ZHIPU_API_KEY')),
    models,
    voices: voiceCatalog,
    ttsTuning: id !== 'qwen-tts',
    config: {
      model: models[0],
      persona: '你是一位温柔、自然、简洁的桌面伙伴。',
      historyLimit: 12,
      maxResponseChars: 300,
      voice: voiceCatalog[0] ? voiceCatalog[0].id : '',
      speed: 1,
      volume: 1,
    },
  }
}

let snapshot = {
  appVersion: '1.0.0',
  currentModelId: 'mori-suit',
  models: modelDefs.map(([id, displayName]) => ({
    id,
    name: id,
    displayName,
    nickname: '',
    status: 'ready',
    statusMessage: '',
    cubismVersion: 4,
    profile: structuredClone(qaProfile),
    assets: structuredClone(qaAssets),
    interactions: qaInteractions(),
    gestures: qaGestures(),
  })),
  covers: Object.fromEntries(modelDefs.map(([id]) => [id, coverUrl(id)])),
  bubbleStyleCatalog: BUBBLE_THEME_DEFINITIONS,
  modelsFolder: 'C:\\Users\\lucky\\AppData\\Roaming\\Live2DCompanion\\models',
  pluginsFolder: 'C:\\Users\\lucky\\AppData\\Roaming\\Live2DCompanion\\plugins',
  runtime: { phase: 'ready', modelId: 'hiyori', message: '' },
  preferences: {
    scale: 0.85,
    cursorFollow: 'near',
    effects: 'subtle',
    interactionMode: 'smart',
    idleEnabled: false,
    qualityMode: 'auto',
    alwaysOnTop: true,
    launchAtLogin: false,
    reducedMotion: 'system',
    onboardingSeen: true,
    backgroundDetection: true,
    settingsPetBackground: true,
    settingsTheme: 'glass',
    bubbleStyles: { glass: 'glass', healing: 'glass' },
    chatGreeting: '你好呀～今天想聊点什么？',
  },
  ai: {
    activePluginIds: { chat: 'deepseek', tts: 'zhipu-tts' },
    readyByCapability: { chat: true, tts: true },
    ready: true,
    plugins: [
      plugin({ id: 'deepseek', name: 'DeepSeek', shortName: 'DS', capabilities: ['chat'], activeCapabilities: ['chat'], models: ['deepseek-chat'] }),
      plugin({ id: 'zhipu-tts', name: '智谱 GLM-TTS', shortName: 'GLM', capabilities: ['tts'], activeCapabilities: ['tts'], models: ['glm-tts'], voice: true }),
      plugin({
        id: 'qwen-tts',
        name: '阿里云 Qwen-TTS',
        shortName: 'QW',
        capabilities: ['tts'],
        activeCapabilities: [],
        models: ['qwen3-tts-flash'],
        voice: true,
        voices: [
          { id: 'Cherry', name: '芊悦', previewUrl: 'https://example.com/cherry.wav' },
          { id: 'Serena', name: '苏瑶', previewUrl: 'https://example.com/serena.wav' },
          { id: 'Ethan', name: '晨煦', previewUrl: 'https://example.com/ethan.wav' },
          { id: 'Chelsie', name: '千雪', previewUrl: 'https://example.com/chelsie.wav' },
          { id: 'Momo', name: '茉兔', previewUrl: 'https://example.com/momo.wav' },
          { id: 'Sunny', name: '四川-晴儿', previewUrl: 'https://example.com/sunny.wav' },
        ],
      }),
    ],
  },
}

let win
const settingsUpdates = []
const modelOrders = []
const modelProfileUpdates = []
const modelPreviews = []
const modelInteractionUpdates = []
const modelInteractionPreviews = []
const modelGestureUpdates = []
const openedUrls = []
const copiedTexts = []
const shortcutCaptureRequests = []
function cloneSnapshot() { return structuredClone(snapshot) }
function patchSnapshot(patch) {
  snapshot.preferences = { ...snapshot.preferences, ...patch }
  return cloneSnapshot()
}

function registerIPC() {
  ipcMain.handle('state:get-snapshot', () => cloneSnapshot())
  ipcMain.handle('settings:update', (_e, patch) => {
    settingsUpdates.push(structuredClone(patch || {}))
    return patchSnapshot(patch || {})
  })
  ipcMain.handle('settings:capture-long-screenshot', (_event, section) => {
    shortcutCaptureRequests.push(section)
    return { ok: false, canceled: true }
  })
  ipcMain.handle('settings:reset', () => cloneSnapshot())
  ipcMain.handle('model:select', (_e, modelId) => {
    snapshot.currentModelId = modelId
    snapshot.runtime.modelId = modelId
    return { ok: true, snapshot: cloneSnapshot() }
  })
  ipcMain.handle('model:reorder', (_e, modelIds) => {
    const order = Array.isArray(modelIds) ? modelIds : []
    modelOrders.push([...order])
    const indexById = new Map(order.map((id, index) => [id, index]))
    snapshot.models.sort((left, right) => (indexById.get(left.id) ?? 999) - (indexById.get(right.id) ?? 999))
    return { ok: true, snapshot: cloneSnapshot() }
  })
  ipcMain.handle('model:import-zip', () => ({ canceled: true }))
  ipcMain.handle('model:nickname-update', (_e, modelId, nickname) => {
    const model = snapshot.models.find(item => item.id === modelId)
    if (model) { model.nickname = nickname; model.displayName = nickname || model.name }
    return { ok: true, snapshot: cloneSnapshot() }
  })
  ipcMain.handle('model:profile-update', (_e, modelId, patch) => {
    modelProfileUpdates.push({ modelId, patch: structuredClone(patch || {}) })
    const model = snapshot.models.find(item => item.id === modelId)
    if (model) model.profile = { ...model.profile, ...(patch || {}) }
    return { ok: true, snapshot: cloneSnapshot() }
  })
  ipcMain.handle('model:interactions-update', (_e, modelId, interactions) => {
    modelInteractionUpdates.push({ modelId, interactions: structuredClone(interactions) })
    const model = snapshot.models.find(item => item.id === modelId)
    if (model) model.interactions = qaInteractions(interactions)
    return { ok: true, snapshot: cloneSnapshot() }
  })
  ipcMain.handle('model:gestures-update', (_e, modelId, gestures) => {
    modelGestureUpdates.push({ modelId, gestures: structuredClone(gestures) })
    const model = snapshot.models.find(item => item.id === modelId)
    if (model) model.gestures = qaGestures(gestures)
    return { ok: true, snapshot: cloneSnapshot() }
  })
  ipcMain.handle('model:interaction-preview', (_e, modelId, interaction) => {
    modelInteractionPreviews.push({ modelId, interaction: structuredClone(interaction) })
    return { ok: true }
  })
  ipcMain.handle('model:preview', (_e, modelId, kind, assetId) => {
    modelPreviews.push({ modelId, kind, assetId })
    return {
      ok: true,
      preview: {
        modelId,
        kind,
        assetId,
        active: true,
        restoreAfterMs: kind === 'expression' ? 3600 : 4200,
        changedParameters: 3,
        parameterDelta: .75,
        largestParameterDelta: .4,
        frame: '',
      },
    }
  })
  ipcMain.handle('model:scale-update', (_e, _modelId, scale) => ({ ok: true, snapshot: patchSnapshot({ scale }) }))
  for (const channel of ['window:reset-pet-position', 'window:move-pet', 'window:open-models-folder', 'window:open-plugins-folder']) {
    ipcMain.handle(channel, () => true)
  }
  ipcMain.handle('window:open-external', (_event, url) => { openedUrls.push(url); return true })
  ipcMain.handle('clipboard:write-text', (_event, value) => { copiedTexts.push(value); return true })
  ipcMain.handle('update:check', () => ({ ok: true, hasUpdate: false, current: '1.0.0', latest: '1.0.0' }))
  ipcMain.handle('update:download', () => ({ ok: false }))
  ipcMain.handle('ai:plugin-install', () => ({ ok: true, ai: cloneSnapshot().ai }))
  ipcMain.handle('ai:plugin-activate', (_e, pluginId, capability) => {
    snapshot.ai.activePluginIds[capability] = pluginId
    snapshot.ai.plugins.forEach(item => {
      item.activeCapabilities = item.activeCapabilities.filter(value => value !== capability)
      if (item.id === pluginId) item.activeCapabilities.push(capability)
    })
    snapshot.ai.readyByCapability[capability] = true
    snapshot.ai.ready = snapshot.ai.readyByCapability.chat
    return { ok: true, ai: cloneSnapshot().ai }
  })
  ipcMain.handle('ai:plugin-deactivate', (_e, pluginId, capability) => {
    if (snapshot.ai.activePluginIds[capability] === pluginId) snapshot.ai.activePluginIds[capability] = ''
    const target = snapshot.ai.plugins.find(item => item.id === pluginId)
    if (target) target.activeCapabilities = target.activeCapabilities.filter(value => value !== capability)
    snapshot.ai.readyByCapability[capability] = false
    snapshot.ai.ready = snapshot.ai.readyByCapability.chat
    return { ok: true, ai: cloneSnapshot().ai }
  })
  ipcMain.handle('ai:plugin-configure', () => ({ ok: true, ai: cloneSnapshot().ai }))
  ipcMain.handle('ai:plugin-test', () => ({ ok: true, message: '连接成功' }))
}

async function makeBackgroundFrame() {
  const cover = ['hiyori.centered-v3.png', 'hiyori.centered-v2.png']
    .map(name => path.join(coversDir, name))
    .find(file => fs.existsSync(file))
  if (!cover) return null
  const resized = await sharp(cover).resize(210, 330, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  }).png().toBuffer()
  return sharp({ create: { width: 240, height: 360, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: resized, gravity: 'center' }])
    .webp({ quality: 90 })
    .toBuffer()
}

async function pageMetrics(theme, section) {
  return win.webContents.executeJavaScript(`(() => {
    const visible = el => {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0
    }
    const rect = el => {
      const r = el.getBoundingClientRect()
      return { x:+r.x.toFixed(2), y:+r.y.toFixed(2), width:+r.width.toFixed(2), height:+r.height.toFixed(2), right:+r.right.toFixed(2), bottom:+r.bottom.toFixed(2) }
    }
    const root = document.documentElement
    const content = document.querySelector('.settings-content')
    const active = document.querySelector('.settings-section.is-active')
    const bg = document.querySelector('.settings-pet-background')
    const canvas = bg.querySelector('canvas')
    const footerLabel = document.querySelector('.app-footer > span:first-child')
    const shell = document.querySelector('.window-shell')
    const titlebar = document.querySelector('.titlebar')
    const primaryNav = document.querySelector('.section-tabs')
    const primaryTabs = [...primaryNav.querySelectorAll('.section-tab')]
    const selected = document.querySelector('.model-card.is-selected')
    const seal = selected && selected.querySelector('.model-seal')
    const companionHero = active.matches('.characters-view') ? active.querySelector('.section-heading') : null
    const companionStatuses = companionHero ? [...companionHero.querySelectorAll('#runtime-status,.companion-status-item')] : []
    const companionPresetButtons = companionHero ? [...companionHero.querySelectorAll('[data-companion-preset]')] : []
    const characterProfile = active.matches('.characters-view') ? active.querySelector('#character-profile') : null
    const characterProfileBody = characterProfile ? characterProfile.querySelector('#character-profile-body') : null
    const characterProfileTabs = characterProfile ? [...characterProfile.querySelectorAll('[data-profile-tab]')] : []
    const characterProfilePanes = characterProfile ? [...characterProfile.querySelectorAll('[data-profile-pane]')] : []
    const pageEyebrow = active.querySelector(':scope > .section-heading > div > .eyebrow')
    const pageEyebrowStyle = pageEyebrow ? getComputedStyle(pageEyebrow) : null
    const heroName = companionHero ? companionHero.querySelector('#current-model-name') : null
    const heroNameText = heroName ? heroName.querySelector('.hero-name-text') : null
    const heroNameMark = heroName ? heroName.querySelector('.hero-name-mark') : null
    const heroNameTextStyle = heroNameText ? getComputedStyle(heroNameText) : null
    const candidates = [...active.querySelectorAll('h1,h2,p,small,strong,label,button,kbd,output,span')]
      .filter(el => visible(el) && el.children.length === 0 && (el.textContent || '').trim())
      .map(el => {
        const cs = getComputedStyle(el)
        return { tag:el.tagName, cls:el.className || '', text:el.textContent.trim().slice(0,80), sw:el.scrollWidth, cw:el.clientWidth, sh:el.scrollHeight, ch:el.clientHeight, ox:cs.overflowX, oy:cs.overflowY, rect:rect(el) }
      })
      .filter(x => (x.sw > x.cw + 2 || x.sh > x.ch + 2) && x.ox !== 'auto' && x.ox !== 'scroll' && x.oy !== 'auto' && x.oy !== 'scroll')
    const unnamedButtons = [...document.querySelectorAll('button')].filter(visible).filter(b => !(b.innerText || b.getAttribute('aria-label') || b.title || '').trim()).length
    const unlabeledInputs = [...active.querySelectorAll('input,textarea,select')].filter(visible).filter(el => !el.labels?.length && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')).length
    const bgStyle = getComputedStyle(bg)
    const canvasStyle = getComputedStyle(canvas)
    const selectedBefore = selected ? getComputedStyle(selected, '::before') : null
    const selectedAfter = selected ? getComputedStyle(selected, '::after') : null
    return {
      theme: ${JSON.stringify(theme)}, section: ${JSON.stringify(section)},
      viewport: { width:innerWidth, height:innerHeight, dpr:devicePixelRatio },
      document: { width:document.documentElement.scrollWidth, height:document.documentElement.scrollHeight },
      shell: rect(shell), content: { ...rect(content), scrollHeight:content.scrollHeight, clientHeight:content.clientHeight, scrollTop:content.scrollTop },
      chrome: {
        titlebar: rect(titlebar),
        navigation: rect(primaryNav),
        tabs: primaryTabs.map(tab => ({ section:tab.dataset.section, active:tab.classList.contains('is-active'), rect:rect(tab) })),
      },
      active: { ...rect(active), scrollHeight:active.scrollHeight, clientHeight:active.clientHeight },
      background: { rect:rect(bg), position:bgStyle.position, inset:bgStyle.inset, opacity:bgStyle.opacity, transform:bgStyle.transform, canvasRect:rect(canvas), canvasTransform:canvasStyle.transform, ready:bg.classList.contains('is-ready') },
      pageEyebrow: pageEyebrow ? { text:pageEyebrow.innerText.trim(), fontSize:pageEyebrowStyle.fontSize, rect:rect(pageEyebrow) } : null,
      footerLabel: rect(footerLabel),
      model: selected ? { selectedCount:document.querySelectorAll('.model-card.is-selected').length, selectedRect:rect(selected), sealRect:rect(seal), beforeContent:selectedBefore.content, afterContent:selectedAfter.content } : null,
      pluginReadyBadgeCount: active.querySelectorAll('.plugin-ready-badge').length,
      companion: companionHero ? {
        heroRect: rect(companionHero),
        scrollWidth: companionHero.scrollWidth,
        clientWidth: companionHero.clientWidth,
        scrollHeight: companionHero.scrollHeight,
        clientHeight: companionHero.clientHeight,
        hasChatShortcut: Boolean(companionHero.querySelector('#companion-chat-action')),
        name: heroName ? {
          text:heroNameText.innerText.trim(), lang:heroName.lang, className:heroName.className,
          rect:rect(heroName), textRect:rect(heroNameText), markRect:rect(heroNameMark),
          textScrollWidth:heroNameText.scrollWidth, textClientWidth:heroNameText.clientWidth,
          fontFamily:heroNameTextStyle.fontFamily, fontSize:heroNameTextStyle.fontSize,
        } : null,
        statuses: companionStatuses.map(el => ({ text:el.innerText.trim(), rect:rect(el) })),
        presets: companionPresetButtons.map(el => ({ text:el.innerText.trim(), ariaLabel:el.getAttribute('aria-label'), pressed:el.getAttribute('aria-pressed'), rect:rect(el) })),
      } : null,
      characterProfile: characterProfile ? {
        rect:rect(characterProfile),
        expanded:characterProfile.querySelector('#character-profile-toggle').getAttribute('aria-expanded'),
        bodyHidden:characterProfileBody.hidden,
        tabs:characterProfileTabs.map(el => ({ tab:el.dataset.profileTab, selected:el.getAttribute('aria-selected'), rect:rect(el) })),
        visiblePanes:characterProfilePanes.filter(visible).map(el => el.dataset.profilePane),
        actionPreviewCount:characterProfile.querySelectorAll('#profile-action-preview .profile-preview-card').length,
        expressionPreviewCount:characterProfile.querySelectorAll('#profile-expression-preview .profile-preview-card').length,
      } : null,
      iconCount: active.querySelectorAll('svg').length,
      pluginDetails: [...active.querySelectorAll('.plugin-detail')].map(el => ({
        text: (el.textContent || '').trim(),
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        rect: rect(el),
      })),
      unnamedButtons, unlabeledInputs, clippedText:candidates,
      visibleSection: root.dataset.settingsView,
      activeTabText: document.querySelector('.section-tab.is-active')?.innerText.trim(),
    }
  })()`)
}

async function alphaEvidence(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const at = (x, y) => data[(y * info.width + x) * 4 + 3]
  const p = [[0,0],[info.width-1,0],[0,info.height-1],[info.width-1,info.height-1]]
  return { width:info.width, height:info.height, corners:p.map(([x,y]) => at(x,y)), nearCorners:[[2,2],[info.width-3,2],[2,info.height-3],[info.width-3,info.height-3]].map(([x,y]) => at(x,y)) }
}

async function characterLayoutMetrics(theme) {
  const previousModelId = snapshot.currentModelId
  const previousNames = snapshot.models.map(model => ({ id: model.id, nickname: model.nickname, displayName: model.displayName }))
  const nicknames = { 'mori-suit': '小眠', hiyori: '小可爱', mao_pro: '魔法' }
  snapshot.models.forEach(model => {
    model.nickname = nicknames[model.id]
    model.displayName = model.nickname
  })
  win.webContents.send('state:changed', { snapshot: cloneSnapshot() })
  await new Promise(resolve => setTimeout(resolve, 120))
  const selections = []
  for (const model of snapshot.models) {
    await win.webContents.executeJavaScript(`document.querySelector('.model-card[data-model-id="${model.id}"]').click()`)
    await new Promise(resolve => setTimeout(resolve, 160))
    const layout = await win.webContents.executeJavaScript(`(() => {
      const page = document.querySelector('.characters-view')
      const picker = page.querySelector('.model-picker')
      page.scrollTop += picker.getBoundingClientRect().top - page.getBoundingClientRect().top - 12
      const profile = page.querySelector('.character-profile')
      const bottomOverflow = profile.getBoundingClientRect().bottom - page.getBoundingClientRect().bottom + 6
      if (bottomOverflow > 0) page.scrollTop += bottomOverflow
      const card = page.querySelector('.model-card.is-selected')
      const cardRect = card.getBoundingClientRect()
      const list = page.querySelector('.model-list')
      const listRect = list.getBoundingClientRect()
      const pickerRect = picker.getBoundingClientRect()
      const nicknameRect = page.querySelector('.nickname-control').getBoundingClientRect()
      const pickerStyle = getComputedStyle(picker)
      const profileRect = profile.getBoundingClientRect()
      const previewRect = page.querySelector('.profile-preview-shelves').getBoundingClientRect()
      const viewportRect = page.getBoundingClientRect()
      const pagination = page.querySelector('.model-pagination')
      const caption = page.querySelector('.profile-portrait-caption')
      const captionName = caption.querySelector('strong')
      const captionNickname = caption.querySelector('span')
      const facts = profile.querySelector('.profile-facts')
      const basic = profile.querySelector('.profile-basic-display')
      const shelves = profile.querySelector('.profile-preview-shelves')
      const bio = profile.querySelector('.profile-bio-row dd')
      const clippingAncestors = []
      for (let parent = card.parentElement; parent && parent !== page; parent = parent.parentElement) {
        const cs = getComputedStyle(parent)
        const r = parent.getBoundingClientRect()
        if (['hidden', 'auto', 'scroll', 'clip'].includes(cs.overflowY)) {
          clippingAncestors.push({
            className: parent.className,
            top: cardRect.top - r.top,
            bottom: r.bottom - cardRect.bottom,
          })
        }
      }
      return {
        id: card.dataset.modelId,
        expectedId: ${JSON.stringify(model.id)},
        ringClearance: { left: cardRect.left - listRect.left, right: listRect.right - cardRect.right },
        clippingAncestors,
        listScrollHeight: list.scrollHeight,
        listClientHeight: list.clientHeight,
        sectionGap: profileRect.top - pickerRect.bottom,
        visibleSectionGap: profileRect.top - pickerRect.bottom,
        nicknamePickerGap: pickerRect.top - nicknameRect.bottom,
        pickerHeadingHeight: picker.querySelector('.subheading-row').getBoundingClientRect().height,
        pickerHasSurface: parseFloat(pickerStyle.borderTopWidth) > 0 &&
          (pickerStyle.backgroundImage !== 'none' || pickerStyle.backgroundColor !== 'rgba(0, 0, 0, 0)'),
        profileVisible: profileRect.top >= viewportRect.top && profileRect.bottom <= viewportRect.bottom,
        previewsVisible: previewRect.top >= viewportRect.top && previewRect.bottom <= viewportRect.bottom,
        noHorizontalOverflow: page.scrollWidth <= page.clientWidth,
        noUnusedPagination: pagination.getBoundingClientRect().height === 0,
        captionName: captionName.textContent,
        captionNickname: captionNickname.textContent,
        captionTextFits: [captionName, captionNickname].every(el => el.scrollWidth <= el.clientWidth + 1),
        profileReadability: {
          portraitHeight: profile.querySelector('.profile-portrait-card').getBoundingClientRect().height,
          captionHeight: caption.getBoundingClientRect().height,
          rowHeights: [...facts.children].map(row => row.getBoundingClientRect().height),
          fontSize: parseFloat(getComputedStyle(facts.querySelector('dd')).fontSize),
          tabHeight: profile.querySelector('[data-profile-tab]').getBoundingClientRect().height,
          previewHeights: [...profile.querySelectorAll('.profile-preview-card')].map(card => card.getBoundingClientRect().height),
          previewGap: shelves.getBoundingClientRect().top - basic.getBoundingClientRect().bottom,
          bioUnclamped: getComputedStyle(bio).webkitLineClamp === 'none',
          bioFits: bio.scrollHeight <= bio.clientHeight + 1,
        },
        scrollTop: page.scrollTop,
      }
    })()`)
    const file = path.join(outDir, `${theme}-character-layout-${model.id}.png`)
    fs.writeFileSync(file, await win.capturePage().then(image => image.toPNG()))
    selections.push({ ...layout, screenshot: file })
  }
  snapshot.currentModelId = previousModelId
  snapshot.runtime.modelId = previousModelId
  previousNames.forEach(saved => Object.assign(snapshot.models.find(model => model.id === saved.id), saved))
  win.webContents.send('state:changed', { snapshot: cloneSnapshot() })
  await new Promise(resolve => setTimeout(resolve, 120))
  await win.webContents.executeJavaScript(`document.querySelector('.characters-view').scrollTop = 0`)
  return selections
}

async function run() {
  registerIPC()
  await app.whenReady()
  win = new BrowserWindow({
    width: 470,
    height: 760,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(projectRoot, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  const consoleMessages = []
  win.webContents.on('console-message', details => {
    consoleMessages.push({
      level: details.level,
      message: details.message,
      sourceId: details.sourceId,
      lineNumber: details.lineNumber,
    })
  })
  await win.loadFile(path.join(projectRoot, 'renderer', 'settings.html'))
  await win.webContents.insertCSS('*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}')
  await new Promise(resolve => setTimeout(resolve, 800))
  const frame = await makeBackgroundFrame()
  if (frame) win.webContents.send('settings:pet-background-frame', frame)
  await new Promise(resolve => setTimeout(resolve, 800))

  const results = {
    generatedAt: new Date().toISOString(),
    window: {
      bounds: win.getBounds(),
      resizable: win.isResizable(),
      maximizable: win.isMaximizable(),
      hasShadow: win.hasShadow(),
    },
    pages: [],
    characterLayouts: {},
    interactions: {},
  }

  for (const theme of ['glass', 'healing']) {
    snapshot.preferences.settingsTheme = theme
    win.webContents.send('state:changed', { snapshot: cloneSnapshot() })
    await new Promise(resolve => setTimeout(resolve, 180))
    for (const section of ['characters', 'behavior', 'ai', 'system']) {
      await win.webContents.executeJavaScript(`(() => {
        document.querySelector('.section-tab[data-section=${JSON.stringify(section)}]').click()
        document.querySelector('.settings-content').scrollTop = 0
      })()`)
      await new Promise(resolve => setTimeout(resolve, 320))
      win.webContents.invalidate()
      await win.capturePage()
      await new Promise(resolve => setTimeout(resolve, 120))
      const png = await win.capturePage().then(image => image.toPNG())
      const file = path.join(outDir, `${theme}-${section}.png`)
      fs.writeFileSync(file, png)
      results.pages.push({ ...(await pageMetrics(theme, section)), screenshot:file, alpha:await alphaEvidence(png) })
      if (section === 'characters') results.characterLayouts[theme] = await characterLayoutMetrics(theme)
    }
  }

  const screenshotBefore = await win.webContents.executeJavaScript(`(() => {
    document.querySelector('.section-tab[data-section="characters"]').click()
    document.querySelector('[data-profile-tab="interactions"]').click()
    const page = document.querySelector('.characters-view')
    page.scrollTo({ top: 96, behavior: 'auto' })
    return {
      scrollTop: page.scrollTop,
      activeSection: document.documentElement.dataset.settingsView,
      profileTab: document.querySelector('[data-profile-tab].is-active').dataset.profileTab,
      profileCollapsed: document.querySelector('#character-profile').classList.contains('is-collapsed'),
    }
  })()`)
  await new Promise(resolve => setTimeout(resolve, 120))
  screenshotBefore.scrollTop = await win.webContents.executeJavaScript('document.querySelector(".characters-view").scrollTop')
  const longScreenshotPath = path.join(outDir, 'app-panel-long-screenshot.png')
  const screenshotWindow = new BrowserWindow({
    width: 470,
    height: 760,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#f3f0ff',
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(projectRoot, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  })
  await screenshotWindow.loadFile(path.join(projectRoot, 'renderer', 'settings.html'), { query: { capture: '1' } })
  const screenshotRendererReady = await screenshotWindow.webContents.executeJavaScript(`new Promise(resolve => {
    const startedAt = Date.now()
    const check = () => {
      if (window.settingsLongScreenshot && document.documentElement.dataset.settingsReady === 'true') resolve(true)
      else if (Date.now() - startedAt > 5000) resolve(false)
      else setTimeout(check, 25)
    }
    check()
  })`)
  if (!screenshotRendererReady) throw new Error('Long screenshot renderer did not become ready')
  const longScreenshotCapture = await captureSettingsPanel({
    browserWindow: screenshotWindow,
    section: screenshotBefore.activeSection,
    state: {
      section: screenshotBefore.activeSection,
      profileTab: screenshotBefore.profileTab,
      profileCollapsed: screenshotBefore.profileCollapsed,
    },
    outputPath: longScreenshotPath,
  })
  screenshotWindow.destroy()
  const screenshotAfter = await win.webContents.executeJavaScript(`(() => {
    const page = document.querySelector('.characters-view')
    return {
      scrollTop: page.scrollTop,
      activeSection: document.documentElement.dataset.settingsView,
      profileTab: document.querySelector('[data-profile-tab].is-active').dataset.profileTab,
      captureModeCleared: !document.documentElement.dataset.longScreenshot,
      titlebarButtonRemoved: !document.getElementById('capture-long-screenshot'),
    }
  })()`)
  const longScreenshotMetadata = fs.existsSync(longScreenshotPath)
    ? await sharp(longScreenshotPath).metadata()
    : null
  const longScreenshotAlpha = fs.existsSync(longScreenshotPath)
    ? await alphaEvidence(await fs.promises.readFile(longScreenshotPath))
    : null
  results.interactions.longScreenshot = {
    before: screenshotBefore,
    after: screenshotAfter,
    request: { outputPath: longScreenshotPath, ...longScreenshotCapture },
    image: longScreenshotMetadata ? {
      width: longScreenshotMetadata.width,
      height: longScreenshotMetadata.height,
      format: longScreenshotMetadata.format,
      opaqueCorners: longScreenshotAlpha && longScreenshotAlpha.corners.every(alpha => alpha === 255),
    } : null,
  }
  await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'S',
    ctrlKey: true,
    shiftKey: true,
  }))`)
  await new Promise(resolve => setTimeout(resolve, 80))
  results.interactions.longScreenshot.shortcutSections = [...shortcutCaptureRequests]
  await win.webContents.executeJavaScript(`document.querySelector('[data-profile-tab="basic"]').click()`)

  results.interactions.bubbleStyles = {}
  for (const theme of ['glass', 'healing']) {
    snapshot.preferences.settingsTheme = theme
    snapshot.preferences.bubbleStyles = { glass: 'glass', healing: 'glass' }
    win.webContents.send('state:changed', { snapshot: cloneSnapshot() })
    await win.webContents.executeJavaScript(`(() => {
      document.querySelector('.section-tab[data-section="ai"]').click()
      const content = document.querySelector('.settings-section.ai-view')
      const customizer = document.querySelector('#bubble-style-customizer')
      content.scrollTo({ top: Math.max(0, customizer.offsetTop - 92), behavior: 'auto' })
    })()`)
    await new Promise(resolve => setTimeout(resolve, 180))
    const updatesBefore = settingsUpdates.length
    await win.webContents.executeJavaScript(`document.querySelector('[data-bubble-style="sweet"]').click()`)
    await new Promise(resolve => setTimeout(resolve, 220))
    const metrics = await win.webContents.executeJavaScript(`(() => {
      const rect = element => {
        const box = element.getBoundingClientRect()
        return { x:+box.x.toFixed(2), y:+box.y.toFixed(2), width:+box.width.toFixed(2), height:+box.height.toFixed(2), right:+box.right.toFixed(2), bottom:+box.bottom.toFixed(2) }
      }
      const customizer = document.querySelector('#bubble-style-customizer')
      const selection = customizer.querySelector('.bubble-style-selection-panel')
      const previewPanel = customizer.querySelector('.bubble-style-preview-panel')
      const stage = customizer.querySelector('.bubble-style-live-preview')
      const chatCard = customizer.closest('.chat-settings-block').querySelector('.chat-settings-card')
      const avatarFrame = customizer.querySelector('.bubble-preview-avatar')
      const avatar = customizer.querySelector('#bubble-preview-avatar')
      const live = customizer.querySelector('.bubble-live-art')
      const liveFrame = live.shadowRoot.querySelector('.frame')
      const liveTail = live.shadowRoot.querySelector('.tail-left')
      const active = customizer.querySelector('.bubble-style-option.is-active')
      const optionRow = customizer.querySelector('#bubble-style-options')
      const optionCards = [...customizer.querySelectorAll('.bubble-style-option')]
      const optionRects = optionCards.map(rect)
      const optionWidths = optionRects.map(item => item.width)
      const previous = customizer.querySelector('#bubble-style-previous')
      const next = customizer.querySelector('#bubble-style-next')
      const pagination = customizer.querySelector('#bubble-style-pagination')
      const hint = customizer.querySelector('.bubble-carousel-hint')
      return {
        optionCount:customizer.querySelectorAll('.bubble-style-option').length,
        optionIds:[...customizer.querySelectorAll('.bubble-style-option')].map(option => option.dataset.bubbleStyle),
        checkedCount:customizer.querySelectorAll('.bubble-style-option[aria-checked="true"]').length,
        activeStyle:active && active.dataset.bubbleStyle,
        activeCheckVisible:active ? getComputedStyle(active.querySelector('.bubble-style-option-check')).display !== 'none' : false,
        liveTheme:live && live.getAttribute('theme'),
        liveStyle:live && live.getAttribute('style-name'),
        liveTailSide:live && live.getAttribute('tail-side'),
        liveLabel:live && live.shadowRoot.querySelector('.label-text').textContent,
        liveMessage:live && live.shadowRoot.querySelector('.message').textContent,
        avatarReady:avatar.classList.contains('has-image') && Boolean(avatar.getAttribute('src')),
        customizerRect:rect(customizer), chatCardRect:rect(chatCard), selectionRect:rect(selection), previewPanelRect:rect(previewPanel), stageRect:rect(stage),
        avatarRect:rect(avatarFrame), liveFrameRect:rect(liveFrame), liveTailRect:rect(liveTail),
        carouselHasOverflowClass:customizer.classList.contains('has-overflow'),
        carouselArrowHidden:previous.hidden && next.hidden && getComputedStyle(previous).display === 'none' && getComputedStyle(next).display === 'none',
        carouselPaginationHidden:pagination.hidden && getComputedStyle(pagination).display === 'none',
        carouselHintHidden:getComputedStyle(hint).display === 'none',
        carouselDoesNotOverflow:optionRow.scrollWidth <= optionRow.clientWidth + 1,
        optionWidthsEqual:Math.max(...optionWidths) - Math.min(...optionWidths) <= .25,
        optionRowFilled:Math.abs(optionRects[0].x - rect(optionRow).x) <= 1 && Math.abs(optionRects.at(-1).right - rect(optionRow).right) <= 1,
        panelsSeparated:+(previewPanel.getBoundingClientRect().top - selection.getBoundingClientRect().bottom).toFixed(2),
        stageContained:stage.getBoundingClientRect().left >= previewPanel.getBoundingClientRect().left && stage.getBoundingClientRect().right <= previewPanel.getBoundingClientRect().right,
      }
    })()`)
    const screenshot = path.join(outDir, `${theme}-bubble-picker.png`)
    fs.writeFileSync(screenshot, await win.capturePage().then(image => image.toPNG()))
    metrics.screenshot = screenshot
    metrics.pixelPreview = await win.webContents.executeJavaScript(`(() => {
      const rect = element => {
        const box = element.getBoundingClientRect()
        return { x:+box.x.toFixed(2), y:+box.y.toFixed(2), width:+box.width.toFixed(2), height:+box.height.toFixed(2), right:+box.right.toFixed(2), bottom:+box.bottom.toFixed(2) }
      }
      const customizer = document.querySelector('#bubble-style-customizer')
      const avatar = customizer.querySelector('.bubble-preview-avatar')
      const live = customizer.querySelector('.bubble-live-art')
      live.styleName = 'pixel'
      const frame = live.shadowRoot.querySelector('.frame')
      const tail = live.shadowRoot.querySelector('.tail-left')
      const smoothTail = tail.querySelector('.tail-left-smooth')
      const pixelTail = tail.querySelector('.tail-left-pixel')
      const tailOutline = pixelTail.querySelector('.tail-left-edge')
      const tailFill = pixelTail.querySelector('.tail-left-fill')
      return {
        tailSide:live.getAttribute('tail-side'),
        avatarRect:rect(avatar),
        frameRect:rect(frame),
        tailRect:rect(tail),
        smoothTailDisplay:getComputedStyle(smoothTail).display,
        pixelTailDisplay:getComputedStyle(pixelTail).display,
        tailOutlineFill:getComputedStyle(tailOutline).stroke,
        tailSurfaceFill:getComputedStyle(tailFill).fill,
      }
    })()`)
    await new Promise(resolve => setTimeout(resolve, 80))
    const pixelScreenshot = path.join(outDir, `${theme}-bubble-picker-pixel.png`)
    fs.writeFileSync(pixelScreenshot, await win.capturePage().then(image => image.toPNG()))
    metrics.pixelPreview.screenshot = pixelScreenshot
    await win.webContents.executeJavaScript(`document.querySelector('#bubble-style-customizer .bubble-live-art').styleName = 'sweet'`)
    snapshot.bubbleStyleCatalog = structuredClone(BUBBLE_THEME_DEFINITIONS)
    snapshot.bubbleStyleCatalog[theme].styles.push({
      id: 'extra',
      name: '扩展气泡',
      shortDescription: '扩展样式',
    })
    win.webContents.send('state:changed', { snapshot: cloneSnapshot() })
    await new Promise(resolve => setTimeout(resolve, 180))
    metrics.overflowCarousel = await win.webContents.executeJavaScript(`(() => {
      const customizer = document.querySelector('#bubble-style-customizer')
      const scroller = customizer.querySelector('#bubble-style-options')
      const previous = customizer.querySelector('#bubble-style-previous')
      const next = customizer.querySelector('#bubble-style-next')
      const pagination = customizer.querySelector('#bubble-style-pagination')
      const hint = customizer.querySelector('.bubble-carousel-hint')
      const before = scroller.scrollLeft
      next.click()
      return new Promise(resolve => setTimeout(() => resolve({
        optionCount:customizer.querySelectorAll('.bubble-style-option').length,
        hasOverflowClass:customizer.classList.contains('has-overflow'),
        arrowsVisible:!previous.hidden && !next.hidden && getComputedStyle(previous).display !== 'none' && getComputedStyle(next).display !== 'none',
        paginationVisible:!pagination.hidden && getComputedStyle(pagination).display !== 'none',
        hintVisible:getComputedStyle(hint).display !== 'none',
        pageCount:pagination.children.length,
        hasHorizontalOverflow:scroller.scrollWidth > scroller.clientWidth + 1,
        movedRight:scroller.scrollLeft > before + 1,
        activePage:[...pagination.children].findIndex(dot => dot.classList.contains('is-active')),
      }), 420))
    })()`)
    snapshot.bubbleStyleCatalog = BUBBLE_THEME_DEFINITIONS
    win.webContents.send('state:changed', { snapshot: cloneSnapshot() })
    await new Promise(resolve => setTimeout(resolve, 180))
    win.webContents.invalidate()
    await win.capturePage()
    await new Promise(resolve => setTimeout(resolve, 120))
    fs.writeFileSync(screenshot, await win.capturePage().then(image => image.toPNG()))
    metrics.submittedPatches = settingsUpdates.slice(updatesBefore)
    results.interactions.bubbleStyles[theme] = metrics
  }

  results.interactions.contactAuthor = {}
  for (const theme of ['glass', 'healing']) {
    snapshot.preferences.settingsTheme = theme
    win.webContents.send('state:changed', { snapshot: cloneSnapshot() })
    await win.webContents.executeJavaScript(`(() => {
      document.querySelector('.section-tab[data-section="system"]').click()
      document.querySelector('.settings-content').scrollTop = 0
      const entry = document.querySelector('#contact-author-open')
      entry.focus()
      entry.click()
    })()`)
    await new Promise(resolve => setTimeout(resolve, 220))
    const metrics = await win.webContents.executeJavaScript(`(() => {
      const root = document.querySelector('#contact-author-dialog')
      const card = root.querySelector('.contact-author-card')
      const profile = root.querySelector('.contact-profile')
      const profileAvatar = root.querySelector('.contact-profile-avatar')
      const entry = document.querySelector('#contact-author-open')
      const visible = element => {
        const style = getComputedStyle(element)
        const box = element.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
      }
      const rect = element => {
        const box = element.getBoundingClientRect()
        return { x:+box.x.toFixed(2), y:+box.y.toFixed(2), width:+box.width.toFixed(2), height:+box.height.toFixed(2), right:+box.right.toFixed(2), bottom:+box.bottom.toFixed(2) }
      }
      return {
        hidden:root.hidden, cardRect:rect(card), profileRect:rect(profile), profileAvatarRect:rect(profileAvatar), entryRect:rect(entry),
        profileAvatarSource:profileAvatar.getAttribute('src'), profileCharacterCount:root.querySelectorAll('.contact-profile-character').length,
        cardScrollWidth:card.scrollWidth, cardClientWidth:card.clientWidth,
        cardScrollHeight:card.scrollHeight, cardClientHeight:card.clientHeight,
        visibleChannels:[...root.querySelectorAll('.contact-channel')].filter(visible).map(row => row.querySelector('strong').innerText.trim()),
        actionLabels:[...root.querySelectorAll('.contact-dialog-actions button')].filter(visible).map(button => button.innerText.trim()),
        closeLabel:root.querySelector('#contact-author-close').getAttribute('aria-label'),
        entryAfterUpdate:entry.previousElementSibling.classList.contains('update-panel'),
        entryBeforeActions:entry.nextElementSibling.classList.contains('system-actions'),
        focusedClose:document.activeElement === root.querySelector('#contact-author-close'),
      }
    })()`)
    const file = path.join(outDir, `${theme}-contact-author.png`)
    fs.writeFileSync(file, await win.capturePage().then(image => image.toPNG()))
    metrics.screenshot = file
    await win.webContents.executeJavaScript(`document.querySelector('[data-contact-copy]').click()`)
    await new Promise(resolve => setTimeout(resolve, 120))
    metrics.copyFeedback = await win.webContents.executeJavaScript(`(() => {
      const root = document.querySelector('#contact-author-dialog')
      const card = root.querySelector('.contact-author-card')
      const toast = document.querySelector('#toast')
      const rootStyle = getComputedStyle(root)
      const toastStyle = getComputedStyle(toast)
      const toastRect = toast.getBoundingClientRect()
      const cardRect = card.getBoundingClientRect()
      return {
        text:toast.textContent.trim(), visible:toast.classList.contains('is-visible'),
        toastZIndex:Number(toastStyle.zIndex), dialogZIndex:Number(rootStyle.zIndex),
        clearsCard:toastRect.bottom <= cardRect.top,
        backdropRadius:rootStyle.borderRadius,
        backdropOverflow:rootStyle.overflow,
        backdropClipPath:rootStyle.clipPath,
      }
    })()`)
    const copyFile = path.join(outDir, `${theme}-contact-author-copy-toast.png`)
    fs.writeFileSync(copyFile, await win.capturePage().then(image => image.toPNG()))
    metrics.copyFeedback.screenshot = copyFile
    await win.webContents.executeJavaScript(`document.querySelectorAll('#contact-author-dialog [data-contact-url]').forEach(button => button.click())`)
    const focusRestored = await win.webContents.executeJavaScript(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }))
      return document.querySelector('#contact-author-dialog').hidden && document.activeElement === document.querySelector('#contact-author-open')
    })()`)
    const backdropCloses = await win.webContents.executeJavaScript(`(() => {
      document.querySelector('#contact-author-open').click()
      const root = document.querySelector('#contact-author-dialog')
      root.click()
      return root.hidden
    })()`)
    metrics.focusRestoredAfterEscape = focusRestored
    metrics.backdropCloses = backdropCloses
    results.interactions.contactAuthor[theme] = metrics
  }

  const currentModel = snapshot.models.find(model => model.id === snapshot.currentModelId)
  const originalModelName = currentModel.displayName
  const originalModelNickname = currentModel.nickname
  const typographyCases = [
    { id:'cjk', value:'大可爱', expectedLanguage:'zh-CN', expectedClass:'is-cjk' },
    { id:'latin', value:'Hiyori', expectedLanguage:'en', expectedClass:'is-latin' },
    { id:'long-latin', value:'Always By Your Side Companion', expectedLanguage:'en', expectedClass:'is-long' },
  ]
  results.interactions.heroTypography = {}
  await win.webContents.executeJavaScript(`document.querySelector('.section-tab[data-section="characters"]').click()`)
  await new Promise(resolve => setTimeout(resolve, 160))
  for (const theme of ['glass', 'healing']) {
    snapshot.preferences.settingsTheme = theme
    results.interactions.heroTypography[theme] = {}
    for (const typographyCase of typographyCases) {
      currentModel.displayName = typographyCase.value
      currentModel.nickname = typographyCase.id === 'cjk' ? typographyCase.value : ''
      win.webContents.send('state:changed', { snapshot: cloneSnapshot() })
      await new Promise(resolve => setTimeout(resolve, 120))
      const result = await win.webContents.executeJavaScript(`(() => {
        const lockup = document.querySelector('#current-model-name')
        const text = lockup.querySelector('.hero-name-text')
        const mark = lockup.querySelector('.hero-name-mark')
        const source = document.querySelector('#current-model-source')
        const hero = document.querySelector('.characters-view > .section-heading')
        const rect = element => {
          const box = element.getBoundingClientRect()
          return { x:+box.x.toFixed(2), y:+box.y.toFixed(2), width:+box.width.toFixed(2), height:+box.height.toFixed(2), right:+box.right.toFixed(2), bottom:+box.bottom.toFixed(2) }
        }
        const style = getComputedStyle(text)
        return {
          text:text.innerText.trim(), lang:lockup.lang, classes:[...lockup.classList],
          lockupRect:rect(lockup), textRect:rect(text), markRect:rect(mark),
          sourceVisible:!source.hidden, sourceRect:source.hidden ? null : rect(source), heroRect:rect(hero),
          textScrollWidth:text.scrollWidth, textClientWidth:text.clientWidth,
          overflowX:style.overflowX, textOverflow:style.textOverflow,
          fontFamily:style.fontFamily, fontSize:style.fontSize,
        }
      })()`)
      result.expectedLanguage = typographyCase.expectedLanguage
      result.expectedClass = typographyCase.expectedClass
      result.expectedSourceVisible = typographyCase.id === 'cjk'
      if (typographyCase.id !== 'long-latin') {
        const file = path.join(outDir, `${theme}-typography-${typographyCase.id}.png`)
        fs.writeFileSync(file, await win.capturePage().then(image => image.toPNG()))
        result.screenshot = file
      }
      results.interactions.heroTypography[theme][typographyCase.id] = result
    }
  }
  currentModel.displayName = originalModelName
  currentModel.nickname = originalModelNickname
  snapshot.preferences.settingsTheme = 'glass'
  win.webContents.send('state:changed', { snapshot: cloneSnapshot() })
  await new Promise(resolve => setTimeout(resolve, 120))

  const defaultGreeting = await win.webContents.executeJavaScript(`(() => {
    const expected = '你好呀～今天想聊点什么？'
    const field = document.querySelector('#chat-greeting')
    const button = [...document.querySelectorAll('#chat-greeting-presets [data-greeting]')]
      .find(item => item.dataset.greeting === expected)
    const initiallySelected = Boolean(button && button.getAttribute('aria-pressed') === 'true')
    field.value = '临时自定义问候'
    field.dispatchEvent(new Event('input', { bubbles:true }))
    if (button) button.click()
    return {
      exists: Boolean(button),
      label: button ? button.innerText.trim() : '',
      initiallySelected,
      value: field.value,
      selected: Boolean(button && button.getAttribute('aria-pressed') === 'true'),
      count: document.querySelector('#chat-greeting-count').innerText.trim(),
    }
  })()`)
  results.interactions.defaultGreeting = defaultGreeting

  await win.webContents.executeJavaScript(`document.querySelector('.section-tab[data-section="characters"]').click()`)
  snapshot.ai.readyByCapability = { chat: true, tts: true }
  snapshot.ai.ready = true
  const expectedPresetPatches = {
    quiet: { cursorFollow:'off', effects:'off', idleEnabled:true, qualityMode:'auto' },
    natural: { cursorFollow:'near', effects:'subtle', idleEnabled:false, qualityMode:'auto' },
    eco: { cursorFollow:'off', effects:'off', idleEnabled:true, qualityMode:'eco' },
  }
  results.interactions.companionPresets = {}
  for (const presetName of Object.keys(expectedPresetPatches)) {
    settingsUpdates.length = 0
    await win.webContents.executeJavaScript(`(() => {
      document.querySelector('.section-tab[data-section="characters"]').click()
      document.querySelector('[data-companion-preset=${JSON.stringify(presetName)}]').click()
    })()`)
    await new Promise(resolve => setTimeout(resolve, 140))
    const pressed = await win.webContents.executeJavaScript(`Object.fromEntries([...document.querySelectorAll('[data-companion-preset]')].map(button => [button.dataset.companionPreset, button.getAttribute('aria-pressed')]))`)
    results.interactions.companionPresets[presetName] = {
      expectedPatch: expectedPresetPatches[presetName],
      submittedPatch: settingsUpdates.at(-1) || null,
      pressed,
    }
  }

  snapshot.preferences = { ...snapshot.preferences, ...expectedPresetPatches.quiet }
  win.webContents.send('state:changed', { snapshot: cloneSnapshot() })
  await new Promise(resolve => setTimeout(resolve, 120))
  results.interactions.externalPresetState = await win.webContents.executeJavaScript(`Object.fromEntries([...document.querySelectorAll('[data-companion-preset]')].map(button => [button.dataset.companionPreset, button.getAttribute('aria-pressed')]))`)

  modelProfileUpdates.length = 0
  modelPreviews.length = 0
  results.interactions.characterProfile = await win.webContents.executeJavaScript(`(async () => {
    const root = document.querySelector('#character-profile')
    const toggle = document.querySelector('#character-profile-toggle')
    const body = document.querySelector('#character-profile-body')
    const initial = {
      expanded:toggle.getAttribute('aria-expanded'),
      bodyHidden:body.hidden,
      tab:document.querySelector('[data-profile-tab].is-active').dataset.profileTab,
      actionCount:document.querySelectorAll('#profile-action-preview [data-profile-asset-id]').length,
      expressionCount:document.querySelectorAll('#profile-expression-preview [data-profile-asset-id]').length,
      actionCountBadge:document.querySelector('#profile-action-count').textContent.trim(),
      expressionCountBadge:document.querySelector('#profile-expression-count').textContent.trim(),
      actionCountLabel:document.querySelector('#profile-action-count').getAttribute('aria-label'),
      expressionCountLabel:document.querySelector('#profile-expression-count').getAttribute('aria-label'),
    }
    toggle.click()
    const collapsed = { expanded:toggle.getAttribute('aria-expanded'), bodyHidden:body.hidden, collapsed:root.classList.contains('is-collapsed') }
    toggle.click()
    document.querySelector('[data-profile-tab="actions"]').click()
    const actionTab = {
      selected:document.querySelector('[data-profile-tab="actions"]').getAttribute('aria-selected'),
      paneHidden:document.querySelector('#profile-pane-actions').hidden,
    }
    document.querySelector('#profile-action-library [data-profile-asset-id]').click()
    await new Promise(resolve => setTimeout(resolve, 80))
    const previewing = Boolean(document.querySelector('#profile-action-library .is-previewing'))
    document.querySelector('[data-profile-tab="basic"]').click()
    document.querySelector('#profile-edit-open').click()
    const species = document.querySelector('#profile-species-input')
    species.value = 'QA 狐耳妖精'
    species.form.requestSubmit()
    await new Promise(resolve => setTimeout(resolve, 100))
    document.querySelector('[data-profile-tab="world"]').click()
    const worldview = document.querySelector('#profile-worldview-input')
    worldview.value = 'QA 世界观'
    worldview.form.requestSubmit()
    await new Promise(resolve => setTimeout(resolve, 100))
    document.querySelector('[data-profile-tab="basic"]').click()
    return {
      initial, collapsed, actionTab, previewing,
      basicVisible:!document.querySelector('#profile-pane-basic').hidden,
      personaFieldExists:Boolean(document.querySelector('#ai-persona-field')),
    }
  })()`)
  results.interactions.characterProfile.profileUpdates = structuredClone(modelProfileUpdates)
  results.interactions.characterProfile.previews = structuredClone(modelPreviews)
  await new Promise(resolve => setTimeout(resolve, 100))

  modelInteractionUpdates.length = 0
  modelInteractionPreviews.length = 0
  modelGestureUpdates.length = 0
  results.interactions.modelInteractions = await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('[data-profile-tab="interactions"]').click()
    const gestureList = document.querySelector('#model-gestures-list')
    const initialGestureRows = gestureList.querySelectorAll('.model-gesture-row').length
    const doubleClick = gestureList.querySelector('[data-gesture-id="double-click"]')
    const gestureText = doubleClick.querySelector('[data-gesture-field="text"]')
    const gestureMapping = doubleClick.querySelector('[data-gesture-field="actionId"]')
    gestureText.value = 'QA 双击提示文字'
    gestureMapping.value = 'action-3'
    gestureMapping.dispatchEvent(new Event('change', { bubbles:true }))
    doubleClick.querySelector('[data-gesture-preview]').click()
    await new Promise(resolve => setTimeout(resolve, 80))
    document.querySelector('#model-gestures-form').requestSubmit()
    await new Promise(resolve => setTimeout(resolve, 120))
    const list = document.querySelector('#model-interactions-list')
    const initialRows = list.querySelectorAll('.model-interaction-row').length
    const defaultName = list.querySelector('.model-interaction-name input').value
    const defaultText = list.querySelector('.model-interaction-message input').value
    const defaultMapping = list.querySelector('.model-interaction-mapping option').textContent.trim()
    document.querySelector('#model-interaction-add').click()
    const custom = list.querySelector('.model-context-interaction-row.is-custom')
    custom.querySelector('[data-interaction-field="label"]').value = 'QA 自定义互动'
    custom.querySelector('[data-interaction-field="text"]').value = 'QA 右键弹出文字'
    const mapping = custom.querySelector('[data-interaction-field="actionId"]')
    mapping.value = 'action-2'
    mapping.dispatchEvent(new Event('change', { bubbles:true }))
    const hiddenTarget = list.querySelector('[data-interaction-id="greet"]')
    const hiddenCheckbox = hiddenTarget.querySelector('[data-interaction-field="enabled"]')
    hiddenCheckbox.checked = false
    hiddenCheckbox.dispatchEvent(new Event('change', { bubbles:true }))
    const orderAfterHide = [...list.querySelectorAll('.model-context-interaction-row')].map(row => ({
      id:row.dataset.interactionId,
      enabled:row.querySelector('[data-interaction-field="enabled"]').checked,
    }))
    custom.querySelector('[data-interaction-preview]').click()
    await new Promise(resolve => setTimeout(resolve, 80))
    document.querySelector('#model-interactions-form').requestSubmit()
    await new Promise(resolve => setTimeout(resolve, 120))
    return {
      initialRows,
      initialGestureRows,
      gestureText:document.querySelector('[data-gesture-id="double-click"] [data-gesture-field="text"]').value,
      gestureAction:document.querySelector('[data-gesture-id="double-click"] [data-gesture-field="actionId"]').value,
      gestureAddButtonExists:Boolean(document.querySelector('#model-gestures-form [data-gesture-add]')),
      afterSaveRows:list.querySelectorAll('.model-interaction-row').length,
      defaultName,
      defaultText,
      defaultMapping,
      customLabel:list.querySelector('.is-custom [data-interaction-field="label"]').value,
      customText:list.querySelector('.is-custom [data-interaction-field="text"]').value,
      customAction:list.querySelector('.is-custom [data-interaction-field="actionId"]').value,
      orderAfterHide,
      sortHandles:list.querySelectorAll('.model-interaction-sort-handle').length,
      tabSelected:document.querySelector('[data-profile-tab="interactions"]').getAttribute('aria-selected'),
      horizontalOverflow:document.querySelector('#profile-pane-interactions').scrollWidth > document.querySelector('#profile-pane-interactions').clientWidth + 1,
    }
  })()`)
  results.interactions.modelInteractions.screenshot = path.join(outDir, 'character-interactions.png')
  await win.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-profile-tab="interactions"]').click()
    document.querySelector('#character-profile').scrollIntoView({ block:'start' })
  })()`)
  await new Promise(resolve => setTimeout(resolve, 80))
  fs.writeFileSync(results.interactions.modelInteractions.screenshot, await win.capturePage().then(image => image.toPNG()))
  await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('#model-gestures-reset').click()
    await new Promise(resolve => setTimeout(resolve, 100))
    document.querySelector('#model-interactions-reset').click()
    await new Promise(resolve => setTimeout(resolve, 100))
    document.querySelector('[data-profile-tab="basic"]').click()
  })()`)
  results.interactions.modelInteractions.updates = structuredClone(modelInteractionUpdates)
  results.interactions.modelInteractions.previews = structuredClone(modelInteractionPreviews)
  results.interactions.modelInteractions.gestureUpdates = structuredClone(modelGestureUpdates)

  results.interactions.profileCarousels = await win.webContents.executeJavaScript(`(async () => {
    const visibleCount = list => {
      const bounds = list.getBoundingClientRect()
      return [...list.querySelectorAll('.profile-preview-card')].filter(card => {
        const rect = card.getBoundingClientRect()
        return rect.left >= bounds.left - .5 && rect.right <= bounds.right + .5
      }).length
    }
    const inspect = kind => {
      const list = document.querySelector(kind === 'action' ? '#profile-action-preview' : '#profile-expression-preview')
      const carousel = list.closest('.profile-preview-carousel')
      const next = carousel.querySelector('.profile-preview-arrow.is-next')
      const previous = carousel.querySelector('.profile-preview-arrow.is-previous')
      const locate = document.querySelector('[data-profile-locate="' + kind + '"]')
      const pagination = document.querySelector('[data-profile-pagination="' + kind + '"]')
      return {
        list, carousel, next, previous, locate, pagination,
        initial: {
          itemCount:list.children.length,
          visibleCount:visibleCount(list),
          overflow:list.scrollWidth > list.clientWidth + 1,
          nextVisible:!next.hidden && !next.disabled,
          previousDisabled:previous.disabled,
          locateEnabled:!locate.disabled,
          pages:pagination.children.length,
        },
      }
    }
    const action = inspect('action')
    action.next.click()
    await new Promise(resolve => setTimeout(resolve, 440))
    const actionMoved = action.list.scrollLeft > 1
    const lastAction = action.list.lastElementChild
    lastAction.click()
    await new Promise(resolve => setTimeout(resolve, 100))
    action.locate.click()
    await new Promise(resolve => setTimeout(resolve, 440))
    const actionSelectedVisible = visibleCount(action.list) > 0 && (() => {
      const outer = action.list.getBoundingClientRect()
      const inner = lastAction.getBoundingClientRect()
      return inner.left >= outer.left - .5 && inner.right <= outer.right + .5
    })()

    const expression = inspect('expression')
    expression.next.click()
    await new Promise(resolve => setTimeout(resolve, 440))
    const expressionMoved = expression.list.scrollLeft > 1
    const lastExpression = expression.list.lastElementChild
    lastExpression.click()
    await new Promise(resolve => setTimeout(resolve, 100))
    expression.locate.click()
    await new Promise(resolve => setTimeout(resolve, 440))
    const expressionSelectedVisible = (() => {
      const outer = expression.list.getBoundingClientRect()
      const inner = lastExpression.getBoundingClientRect()
      return inner.left >= outer.left - .5 && inner.right <= outer.right + .5
    })()
    return {
      action:{ ...action.initial, movedRight:actionMoved, selectedVisible:actionSelectedVisible, selectedId:lastAction.dataset.profileAssetId },
      expression:{ ...expression.initial, movedRight:expressionMoved, selectedVisible:expressionSelectedVisible, selectedId:lastExpression.dataset.profileAssetId },
    }
  })()`)

  const activeModel = snapshot.models.find(model => model.id === snapshot.currentModelId)
  const originalExpressions = structuredClone(activeModel.assets.expressions)
  activeModel.assets.expressions = []
  results.interactions.emptyExpressionShelf = {}
  for (const theme of ['glass', 'healing']) {
    snapshot.preferences.settingsTheme = theme
    win.webContents.send('state:changed', { snapshot: cloneSnapshot() })
    await new Promise(resolve => setTimeout(resolve, 180))
    await win.webContents.executeJavaScript(`(() => {
      document.querySelector('.section-tab[data-section="characters"]').click()
      document.querySelector('[data-profile-tab="basic"]').click()
      document.querySelector('#character-profile').scrollIntoView({ block:'center' })
    })()`)
    await new Promise(resolve => setTimeout(resolve, 100))
    const emptyMetrics = await win.webContents.executeJavaScript(`(() => {
      const list = document.querySelector('#profile-expression-preview')
      const carousel = list.closest('.profile-preview-carousel')
      const previous = carousel.querySelector('.profile-preview-arrow.is-previous')
      const next = carousel.querySelector('.profile-preview-arrow.is-next')
      const pagination = document.querySelector('[data-profile-pagination="expression"]')
      const locate = document.querySelector('[data-profile-locate="expression"]')
      return {
        itemCount:list.querySelectorAll('.profile-preview-card').length,
        emptyClass:list.classList.contains('is-empty'),
        emptyText:(list.querySelector('.profile-assets-empty')?.textContent || '').trim(),
        previousHidden:previous.hidden && getComputedStyle(previous).display === 'none',
        nextHidden:next.hidden && getComputedStyle(next).display === 'none',
        paginationHidden:pagination.hidden && getComputedStyle(pagination).display === 'none',
        locateDisabled:locate.disabled,
        noHorizontalOverflow:list.scrollWidth <= list.clientWidth + 1,
      }
    })()`)
    const screenshot = path.join(outDir, `${theme}-character-profile-empty-expression.png`)
    fs.writeFileSync(screenshot, await win.capturePage().then(image => image.toPNG()))
    results.interactions.emptyExpressionShelf[theme] = { ...emptyMetrics, screenshot }
  }
  activeModel.assets.expressions = originalExpressions
  win.webContents.send('state:changed', { snapshot: cloneSnapshot() })
  await new Promise(resolve => setTimeout(resolve, 180))

  await win.webContents.executeJavaScript(`document.querySelector('.section-tab[data-section="characters"]').click()`)
  await new Promise(resolve => setTimeout(resolve, 180))
  const carousel = await win.webContents.executeJavaScript(`(async () => {
    const list=document.querySelector('#model-list'); const before=list.scrollLeft;
    document.querySelector('#model-next').click();
    await new Promise(r=>setTimeout(r,450));
    return {before,after:list.scrollLeft,max:list.scrollWidth-list.clientWidth};
  })()`)
  results.interactions.carousel = carousel

  results.interactions.scaleKeepsCarousel = await win.webContents.executeJavaScript(`(() => {
    const list = document.querySelector('#model-list')
    window.__qaModelCard = list.firstElementChild
    const beforeOrder = [...list.querySelectorAll('.model-card')].map(card => card.dataset.modelId)
    const beforeDot = [...document.querySelectorAll('.model-pagination i')].findIndex(dot => dot.classList.contains('is-active'))
    return { beforeOrder, beforeDot, scrollLeft:list.scrollLeft }
  })()`)
  snapshot.preferences.scale = 1.05
  win.webContents.send('state:changed', { snapshot: cloneSnapshot() })
  await new Promise(resolve => setTimeout(resolve, 160))
  Object.assign(results.interactions.scaleKeepsCarousel, await win.webContents.executeJavaScript(`(() => {
    const list = document.querySelector('#model-list')
    return {
      firstCardPreserved:window.__qaModelCard === list.firstElementChild,
      afterOrder:[...list.querySelectorAll('.model-card')].map(card => card.dataset.modelId),
      afterDot:[...document.querySelectorAll('.model-pagination i')].findIndex(dot => dot.classList.contains('is-active')),
      afterScrollLeft:list.scrollLeft,
    }
  })()`))

  modelOrders.length = 0
  results.interactions.modelReorder = await win.webContents.executeJavaScript(`(async () => {
    const list = document.querySelector('#model-list')
    const cards = [...list.querySelectorAll('.model-card')]
    const source = cards[0]
    const target = cards[2]
    const handle = source.querySelector('.model-sort-handle')
    const dataTransfer = new DataTransfer()
    handle.dispatchEvent(new DragEvent('dragstart', { bubbles:true, cancelable:true, dataTransfer }))
    const rect = target.getBoundingClientRect()
    target.dispatchEvent(new DragEvent('dragover', { bubbles:true, cancelable:true, dataTransfer, clientX:rect.right - 1 }))
    handle.dispatchEvent(new DragEvent('dragend', { bubbles:true, cancelable:true, dataTransfer }))
    await new Promise(resolve => setTimeout(resolve, 180))
    return {
      sourceId:source.dataset.modelId,
      targetId:target.dataset.modelId,
      order:[...list.querySelectorAll('.model-card')].map(card => card.dataset.modelId),
      handleVisible:getComputedStyle(document.querySelector('.model-sort-handle')).display !== 'none',
    }
  })()`)
  results.interactions.modelReorder.savedOrders = structuredClone(modelOrders)

  await win.webContents.executeJavaScript(`document.querySelector('.section-tab[data-section="ai"]').click()`)
  await new Promise(resolve => setTimeout(resolve, 120))
  results.interactions.voicePicker = await win.webContents.executeJavaScript(`(async () => {
    const card = document.querySelector('.voice-model-group .ai-plugin-card[data-plugin-id="qwen-tts"]')
    card.querySelector('.plugin-action').click()
    await new Promise(resolve => setTimeout(resolve, 80))
    const section = document.querySelector('.settings-section.ai-view')
    const sectionRect = section.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    section.scrollTop += cardRect.top - sectionRect.top - 72
    const trigger = document.querySelector('#tts-ai-voice-trigger')
    trigger.click()
    await new Promise(resolve => setTimeout(resolve, 80))
    const picker = document.querySelector('#tts-ai-voice-picker')
    const popover = document.querySelector('#tts-ai-voice-popover')
    const input = document.querySelector('#tts-ai-voice-search')
    const options = () => [...document.querySelectorAll('#tts-ai-voice-options .ai-voice-option')]
    const search = value => {
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return options().map(option => ({
        name: option.querySelector('strong').textContent,
        id: option.dataset.voiceId,
        active: option.classList.contains('is-active'),
      }))
    }
    const initial = {
      open: picker.classList.contains('is-open') && !popover.hidden,
      expanded: trigger.getAttribute('aria-expanded'),
      count: options().length,
      focusedSearch: document.activeElement === input,
      triggerText: trigger.textContent.replace(/\\s+/g, ' ').trim(),
    }
    const chinese = search('芊')
    const pinyin = search('qy')
    const fuzzyId = search('chry')
    const keyboardChoice = search('cx')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 30))
    const selected = {
      value: document.querySelector('#tts-ai-voice').value,
      name: document.querySelector('#tts-ai-voice-selected-name').textContent,
      id: document.querySelector('#tts-ai-voice-selected-id').textContent,
      closed: popover.hidden,
      focusReturned: document.activeElement === trigger,
    }
    trigger.click()
    await new Promise(resolve => setTimeout(resolve, 30))
    const broadPinyin = search('qian')
    return {
      initial,
      chinese,
      pinyin,
      fuzzyId,
      keyboardChoice,
      selected,
      broadPinyin,
      popoverWidth: popover.getBoundingClientRect().width,
      viewportWidth: document.documentElement.clientWidth,
      horizontalOverflow: document.querySelector('.settings-section.ai-view').scrollWidth > document.querySelector('.settings-section.ai-view').clientWidth + 1,
    }
  })()`)
  results.interactions.voicePicker.searchScreenshot = path.join(outDir, 'qwen-voice-search.png')
  await new Promise(resolve => setTimeout(resolve, 120))
  win.webContents.invalidate()
  await win.capturePage()
  await new Promise(resolve => setTimeout(resolve, 120))
  fs.writeFileSync(results.interactions.voicePicker.searchScreenshot, await win.capturePage().then(image => image.toPNG()))
  results.interactions.voicePicker.empty = await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('#tts-ai-voice-search')
    input.value = '不存在的音色'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const empty = document.querySelector('#tts-ai-voice-empty')
    const result = {
      shown: !empty.hidden,
      text: empty.textContent.replace(/\\s+/g, ' ').trim(),
      optionCount: document.querySelectorAll('#tts-ai-voice-options .ai-voice-option').length,
      clearVisible: !document.querySelector('#tts-ai-voice-search-clear').hidden,
    }
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    result.closedByEscape = document.querySelector('#tts-ai-voice-popover').hidden
    result.focusReturned = document.activeElement === document.querySelector('#tts-ai-voice-trigger')
    return result
  })()`)
  results.interactions.aiDeactivate = await win.webContents.executeJavaScript(`(async () => {
    const card = document.querySelector('.chat-model-group .ai-plugin-card[data-plugin-id="deepseek"]')
    const button = card.querySelector('.plugin-select-action')
    const before = button.textContent.trim()
    button.click()
    await new Promise(resolve => setTimeout(resolve, 100))
    const stopped = document.querySelector('.chat-model-group .ai-plugin-card[data-plugin-id="deepseek"] .plugin-select-action')
    const stoppedText = stopped.textContent.trim()
    const activeLabel = document.querySelector('#ai-chat-active').textContent.trim()
    stopped.click()
    await new Promise(resolve => setTimeout(resolve, 100))
    const restartedText = document.querySelector('.chat-model-group .ai-plugin-card[data-plugin-id="deepseek"] .plugin-select-action').textContent.trim()
    return { before, stoppedText, activeLabel, restartedText }
  })()`)

  await win.webContents.executeJavaScript(`document.querySelector('.section-tab[data-section="behavior"]').click()`)
  const toggle = await win.webContents.executeJavaScript(`(async () => {
    const el=document.querySelector('.settings-section.is-active input[data-setting]');
    const before=el.checked; el.click(); await new Promise(r=>setTimeout(r,100));
    return {setting:el.dataset.setting,before,after:el.checked};
  })()`)
  results.interactions.toggle = toggle

  await win.webContents.executeJavaScript(`document.querySelector('.section-tab[data-section="system"]').click()`)
  const themeSwitch = await win.webContents.executeJavaScript(`(async () => {
    const el=document.querySelector('[data-theme-option="glass"]'); el.click(); await new Promise(r=>setTimeout(r,120));
    return {dataset:document.documentElement.dataset.settingsTheme,checked:el.checked};
  })()`)
  results.interactions.themeSwitch = themeSwitch

  results.consoleErrors = consoleMessages.filter(item => item.level === 'error' || /uncaught|unhandled/i.test(item.message || ''))
  const samePatch = (actual, expected) => {
    if (!actual || Object.keys(actual).length !== Object.keys(expected).length) return false
    return Object.entries(expected).every(([key, value]) => actual[key] === value)
  }
  const characterPages = results.pages.filter(page => page.section === 'characters')
  const heroGeometryValid = characterPages.length === 2 && characterPages.every(page => {
    const companion = page.companion
    if (!companion || companion.statuses.length !== 3 || companion.presets.length !== 3) return false
    const clippedInHero = page.clippedText.some(item => (
      item.rect.bottom > companion.heroRect.y && item.rect.y < companion.heroRect.bottom &&
      (['hidden', 'clip'].includes(item.ox) || ['hidden', 'clip'].includes(item.oy))
    ))
    const controlsInsideHero = [...companion.statuses, ...companion.presets]
      .every(item => item.rect.x >= companion.heroRect.x - 1 && item.rect.right <= companion.heroRect.right + 1 && item.rect.bottom <= companion.heroRect.bottom + 1)
    return companion.scrollWidth <= companion.clientWidth + 1 &&
      companion.scrollHeight <= companion.clientHeight + 1 &&
      !clippedInHero && controlsInsideHero &&
      companion.presets.every(item => Boolean(item.text && item.ariaLabel))
  })
  const presetPatchesValid = Object.entries(expectedPresetPatches).every(([name, expected]) => {
    const result = results.interactions.companionPresets[name]
    return samePatch(result.submittedPatch, expected) &&
      result.pressed[name] === 'true' &&
      Object.entries(result.pressed).filter(([key]) => key !== name).every(([, pressed]) => pressed === 'false')
  })
  const profileInteraction = results.interactions.characterProfile
  const characterProfileIsValid = characterPages.every(page => (
    page.characterProfile && page.characterProfile.expanded === 'true' && !page.characterProfile.bodyHidden &&
    page.characterProfile.visiblePanes.join('|') === 'basic' &&
    page.characterProfile.tabs.length === 5 && page.characterProfile.tabs[0].selected === 'true' &&
    page.characterProfile.actionPreviewCount === qaAssets.actions.length && page.characterProfile.expressionPreviewCount === qaAssets.expressions.length &&
    page.characterProfile.rect.x >= 0 && page.characterProfile.rect.right <= results.window.bounds.width &&
    page.characterProfile.rect.bottom <= page.active.y + page.active.scrollHeight
  )) && profileInteraction.initial.expanded === 'true' && !profileInteraction.initial.bodyHidden &&
    profileInteraction.initial.tab === 'basic' && profileInteraction.initial.actionCount === qaAssets.actions.length && profileInteraction.initial.expressionCount === qaAssets.expressions.length &&
    profileInteraction.initial.actionCountBadge === String(qaAssets.actions.length) && profileInteraction.initial.expressionCountBadge === String(qaAssets.expressions.length) &&
    profileInteraction.initial.actionCountLabel === `共 ${qaAssets.actions.length} 个动作` && profileInteraction.initial.expressionCountLabel === `共 ${qaAssets.expressions.length} 个表情` &&
    profileInteraction.collapsed.expanded === 'false' && profileInteraction.collapsed.bodyHidden && profileInteraction.collapsed.collapsed &&
    profileInteraction.actionTab.selected === 'true' && !profileInteraction.actionTab.paneHidden &&
    profileInteraction.previewing && profileInteraction.basicVisible && !profileInteraction.personaFieldExists &&
    profileInteraction.profileUpdates.length === 2 && profileInteraction.profileUpdates.every(update => update.modelId === 'mori-suit') &&
    profileInteraction.profileUpdates[0].patch.species === 'QA 狐耳妖精' &&
    profileInteraction.profileUpdates[1].patch.worldview === 'QA 世界观' &&
    profileInteraction.previews.length === 1 && profileInteraction.previews[0].modelId === 'mori-suit' &&
    profileInteraction.previews[0].kind === 'action' && profileInteraction.previews[0].assetId === 'action-0'
  const sameRect = (left, right) => ['x', 'y', 'width', 'height'].every(key => Math.abs(left[key] - right[key]) <= .1)
  const chromeIsUniform = ['glass', 'healing'].every(theme => {
    const pages = results.pages.filter(page => page.theme === theme)
    if (pages.length !== 4) return false
    const first = pages[0].chrome
    return pages.every(page =>
      sameRect(page.chrome.titlebar, first.titlebar) &&
      sameRect(page.chrome.navigation, first.navigation) &&
      page.chrome.tabs.length === 4 &&
      page.chrome.tabs.every((tab, index) => sameRect(tab.rect, first.tabs[index].rect)) &&
      Math.max(...page.chrome.tabs.map(tab => tab.rect.width)) - Math.min(...page.chrome.tabs.map(tab => tab.rect.width)) <= .1
    )
  })
  const petPositionIsUniform = ['glass', 'healing'].every(theme => {
    const pages = results.pages.filter(page => page.theme === theme)
    if (pages.length !== 4) return false
    const first = pages[0].background
    return pages.every(page => (
      sameRect(page.background.rect, first.rect) &&
      sameRect(page.background.canvasRect, first.canvasRect) &&
      page.background.canvasTransform === first.canvasTransform
    ))
  })
  const pageEyebrowSizeIsUniform = results.pages.every(page => page.pageEyebrow && page.pageEyebrow.fontSize === '13px')
  const heroTypographyIsAdaptive = Object.values(results.interactions.heroTypography).every(themeCases => (
    Object.values(themeCases).every(result => (
      result.text && result.lang === result.expectedLanguage && result.classes.includes(result.expectedClass) &&
      result.lockupRect.width <= 205.1 && result.markRect.width > 0 &&
      result.sourceVisible === result.expectedSourceVisible && (!result.sourceRect || result.sourceRect.bottom <= result.heroRect.bottom) &&
      (result.expectedClass !== 'is-long' || (
        result.classes.includes('is-compact') && result.overflowX === 'hidden' && result.textOverflow === 'ellipsis'
      ))
    ))
  ))
  const contactAuthorIsValid = Object.values(results.interactions.contactAuthor).every(result => (
    !result.hidden && result.cardRect.width === 410 && result.cardRect.height === 608 &&
    result.cardRect.x >= 0 && result.cardRect.y >= 0 && result.cardRect.right <= results.window.bounds.width && result.cardRect.bottom <= results.window.bounds.height &&
    result.cardScrollWidth <= result.cardClientWidth && result.cardScrollHeight <= result.cardClientHeight &&
    result.profileRect.height === 154 &&
    result.profileAvatarRect.width === 88 && result.profileAvatarRect.height === 88 &&
    result.profileAvatarSource === '../resources/icon@2x.png' && result.profileCharacterCount === 0 &&
    result.visibleChannels.join('|') === '邮箱|GitHub|问题反馈' &&
    result.actionLabels.join('|') === '复制邮箱|打开主页|问题反馈' &&
    result.copyFeedback.text === '邮箱已复制' && result.copyFeedback.visible &&
    result.copyFeedback.toastZIndex > result.copyFeedback.dialogZIndex && result.copyFeedback.clearsCard &&
    result.copyFeedback.backdropRadius === '20px' && result.copyFeedback.backdropOverflow === 'hidden' &&
    result.copyFeedback.backdropClipPath !== 'none' &&
    result.closeLabel === '关闭联系作者面板' && result.entryAfterUpdate && result.entryBeforeActions &&
    result.focusedClose && result.focusRestoredAfterEscape && result.backdropCloses
  )) && copiedTexts.includes('luckyblank@163.com') && [
    'mailto:luckyblank@163.com',
    'https://github.com/luckyblank/electron-live2d',
    'https://github.com/luckyblank/electron-live2d/issues',
  ].every(url => openedUrls.includes(url))
  const voicePicker = results.interactions.voicePicker
  const voicePickerIsValid = voicePicker.initial.open && voicePicker.initial.expanded === 'true' &&
    voicePicker.initial.count === 6 && voicePicker.initial.focusedSearch &&
    voicePicker.initial.triggerText === '芊悦 Cherry' &&
    voicePicker.chinese.length === 1 && voicePicker.chinese[0].id === 'Cherry' &&
    voicePicker.pinyin.length === 1 && voicePicker.pinyin[0].id === 'Cherry' &&
    voicePicker.fuzzyId.length === 1 && voicePicker.fuzzyId[0].id === 'Cherry' &&
    voicePicker.keyboardChoice.length === 1 && voicePicker.keyboardChoice[0].id === 'Ethan' &&
    voicePicker.selected.value === 'Ethan' && voicePicker.selected.name === '晨煦' &&
    voicePicker.selected.id === 'Ethan' && voicePicker.selected.closed && voicePicker.selected.focusReturned &&
    voicePicker.broadPinyin.map(option => option.id).join('|') === 'Cherry|Chelsie' &&
    voicePicker.popoverWidth > 200 && voicePicker.popoverWidth < voicePicker.viewportWidth && !voicePicker.horizontalOverflow &&
    voicePicker.empty.shown && voicePicker.empty.optionCount === 0 && voicePicker.empty.clearVisible &&
    voicePicker.empty.text.includes('没有找到这个音色') && voicePicker.empty.closedByEscape && voicePicker.empty.focusReturned
  const companionChecks = {
    heroGeometryValid,
    // Windows rounds native window bounds at fractional display scales.
    fixedWindowWidthPreserved: Math.abs(results.window.bounds.width - 470) <=
      (Number(process.env.QA_DEVICE_SCALE || 1) % 1 ? 2 : 0),
    themeChromeUniformAcrossAllPages: chromeIsUniform,
    petPositionUniformAcrossAllPages: petPositionIsUniform,
    pageEyebrowSizeUniformAcrossAllPages: pageEyebrowSizeIsUniform,
    heroTypographySupportsCjkLatinAndLongNames: heroTypographyIsAdaptive,
    contactAuthorMatchesReferenceAndWorks: contactAuthorIsValid,
    voicePickerSupportsFuzzySearchAndKeyboard: voicePickerIsValid,
    appPanelLongScreenshotWorks: (() => {
      const result = results.interactions.longScreenshot
      return result.request && result.request.section === 'characters' &&
        result.request.profileTab === 'interactions' && result.before.profileTab === 'interactions' &&
        result.image && result.image.format === 'png' && result.image.width === 470 && result.image.height > 760 && result.image.opaqueCorners &&
        result.after.captureModeCleared && result.after.titlebarButtonRemoved && result.after.activeSection === 'characters' &&
        result.after.profileTab === result.before.profileTab &&
        Math.abs(result.after.scrollTop - result.before.scrollTop) <= 1 &&
        result.shortcutSections.join('|') === 'characters'
    })(),
    companionChatShortcutRemoved: characterPages.every(page => !page.companion.hasChatShortcut),
    pluginCardReadyBadgeRemoved: results.pages.filter(page => page.section === 'ai').every(page => page.pluginReadyBadgeCount === 0),
    defaultGreetingShortcutWorks: results.interactions.defaultGreeting.exists &&
      results.interactions.defaultGreeting.label === '默认' &&
      results.interactions.defaultGreeting.initiallySelected &&
      results.interactions.defaultGreeting.value === '你好呀～今天想聊点什么？' &&
      results.interactions.defaultGreeting.selected &&
      results.interactions.defaultGreeting.count === '12 / 200',
    modelInteractionsArePerCharacterEditable: (() => {
      const result = results.interactions.modelInteractions
      const saved = result.updates.find(update => Array.isArray(update.interactions))
      const reset = result.updates.find(update => update.interactions === null)
      const savedCustom = saved && saved.interactions.find(item => item.id.startsWith('custom-'))
      const firstHidden = result.orderAfterHide.findIndex(item => !item.enabled)
      return result.initialRows === qaInteractionDefaults.length && result.afterSaveRows === qaInteractionDefaults.length + 1 &&
        result.defaultName === '打个招呼' && result.defaultText === '你好呀～' && result.defaultMapping === '按角色默认 · 问候 / 挥手动作' &&
        result.customLabel === 'QA 自定义互动' && result.customText === 'QA 右键弹出文字' && result.customAction === 'action-2' && result.tabSelected === 'true' && !result.horizontalOverflow &&
        result.sortHandles === qaInteractionDefaults.length + 1 && firstHidden > 0 && result.orderAfterHide.slice(0, firstHidden).every(item => item.enabled) && result.orderAfterHide.slice(firstHidden).every(item => !item.enabled) && result.orderAfterHide.at(-1).id === 'greet' &&
        saved && saved.modelId === 'mori-suit' && savedCustom && savedCustom.label === 'QA 自定义互动' && savedCustom.text === 'QA 右键弹出文字' && savedCustom.actionId === 'action-2' &&
        reset && reset.modelId === 'mori-suit' && result.previews.some(preview => preview.interaction.text === 'QA 右键弹出文字' && preview.interaction.actionId === 'action-2')
    })(),
    gestureInteractionsAreFixedAndEditable: (() => {
      const result = results.interactions.modelInteractions
      const saved = result.gestureUpdates.find(update => Array.isArray(update.gestures))
      const reset = result.gestureUpdates.find(update => update.gestures === null)
      const doubleClick = saved && saved.gestures.find(gesture => gesture.id === 'double-click')
      return result.initialGestureRows === qaGestureDefaults.length && !result.gestureAddButtonExists &&
        result.gestureText === 'QA 双击提示文字' && result.gestureAction === 'action-3' &&
        saved && saved.modelId === 'mori-suit' && doubleClick && doubleClick.text === 'QA 双击提示文字' && doubleClick.actionId === 'action-3' &&
        reset && reset.modelId === 'mori-suit' && result.previews.some(preview => (
          preview.interaction.text === 'QA 双击提示文字' && preview.interaction.actionId === 'action-3'
        ))
    })(),
    bubbleStylePickerMatchesThemesAndPersists: Object.entries(results.interactions.bubbleStyles).every(([theme, result]) => (
      result.optionCount === 4 && result.optionIds.join('|') === 'glass|sweet|pixel|sci-fi' &&
      result.checkedCount === 1 && result.activeStyle === 'sweet' && result.activeCheckVisible &&
      result.liveTheme === theme && result.liveStyle === 'sweet' && result.liveLabel === 'mori-suit' && result.liveMessage.includes('今天天气真不错') &&
      result.liveTailSide === 'left' && result.liveTailRect.x - result.avatarRect.right >= 5 &&
      result.liveTailRect.x - result.avatarRect.right <= 14 && result.liveTailRect.x < result.liveFrameRect.x &&
      result.avatarReady && Math.abs(result.customizerRect.width - result.chatCardRect.width) <= 1 &&
      !result.carouselHasOverflowClass && result.carouselArrowHidden && result.carouselPaginationHidden &&
      result.carouselHintHidden && result.carouselDoesNotOverflow && result.optionWidthsEqual && result.optionRowFilled &&
      result.selectionRect.height >= 100 && result.previewPanelRect.height >= 120 &&
      result.panelsSeparated >= 6 && result.stageContained && result.submittedPatches.some(patch => (
        patch.bubbleStyles && patch.bubbleStyles[theme] === 'sweet'
      )) && result.pixelPreview.tailSide === 'left' &&
      result.pixelPreview.tailRect.x - result.pixelPreview.avatarRect.right >= 5 &&
      result.pixelPreview.tailRect.x - result.pixelPreview.avatarRect.right <= 14 &&
      result.pixelPreview.tailRect.x < result.pixelPreview.frameRect.x &&
      result.pixelPreview.smoothTailDisplay === 'none' && result.pixelPreview.pixelTailDisplay !== 'none' &&
      result.pixelPreview.tailOutlineFill !== result.pixelPreview.tailSurfaceFill &&
      result.overflowCarousel.optionCount === 5 && result.overflowCarousel.hasOverflowClass &&
      result.overflowCarousel.arrowsVisible && result.overflowCarousel.paginationVisible &&
      result.overflowCarousel.hintVisible && result.overflowCarousel.pageCount === 2 &&
      result.overflowCarousel.hasHorizontalOverflow && result.overflowCarousel.movedRight &&
      result.overflowCarousel.activePage === 1
    )),
    presetPatchesValid,
    externalSnapshotUpdatesSelection: results.interactions.externalPresetState.quiet === 'true' && results.interactions.externalPresetState.natural === 'false' && results.interactions.externalPresetState.eco === 'false',
    characterProfileMatchesReferenceAndWorks: characterProfileIsValid,
    profileAssetCarouselsMatchVisibleCountsAndLocateSelection: (() => {
      const carousels = results.interactions.profileCarousels
      return carousels.action.itemCount === qaAssets.actions.length && carousels.action.visibleCount === 4 &&
        carousels.action.overflow && carousels.action.nextVisible && carousels.action.previousDisabled &&
        carousels.action.locateEnabled && carousels.action.pages === 2 && carousels.action.movedRight && carousels.action.selectedVisible &&
        carousels.expression.itemCount === qaAssets.expressions.length && carousels.expression.visibleCount === 4 &&
        carousels.expression.overflow && carousels.expression.nextVisible && carousels.expression.previousDisabled &&
        carousels.expression.locateEnabled && carousels.expression.pages === 2 && carousels.expression.movedRight && carousels.expression.selectedVisible
    })(),
    emptyExpressionShelfHasNoMisleadingControls: Object.values(results.interactions.emptyExpressionShelf).every(result => (
      result.itemCount === 0 && result.emptyClass && result.emptyText === '该角色没有可用表情' &&
      result.previousHidden && result.nextHidden && result.paginationHidden && result.locateDisabled && result.noHorizontalOverflow
    )),
    characterCardsAndProfileStayUnclipped: Object.values(results.characterLayouts).flat().every(layout => (
      layout.id === layout.expectedId && layout.ringClearance.left >= 4 && layout.ringClearance.right >= 4 &&
      layout.clippingAncestors.every(parent => parent.top >= 4 && parent.bottom >= 4) &&
      layout.listScrollHeight <= layout.listClientHeight && [10, 12].some(gap => Math.abs(layout.visibleSectionGap - gap) < 1) &&
      layout.profileVisible && layout.previewsVisible && layout.noHorizontalOverflow && layout.scrollTop > 0 &&
      layout.noUnusedPagination && layout.captionName === layout.id && layout.captionNickname && layout.captionTextFits
    )),
    characterProfileKeepsReadableSpacing: Object.values(results.characterLayouts).flat().every(({ profileReadability: p }) => (
      p.portraitHeight >= 189.5 && p.captionHeight >= 47.5 && p.tabHeight >= 31.5 &&
      p.fontSize >= 10 && p.rowHeights.every(height => height >= 20.5) &&
      p.previewHeights.every(height => height >= 57.5) && p.previewGap >= 11.5 &&
      p.bioUnclamped && p.bioFits
    )),
    characterPickerSpacingAndSurface: Object.values(results.characterLayouts).flat().every(layout => (
      Math.abs(layout.nicknamePickerGap - 12) < .5 && layout.pickerHeadingHeight >= 27.5 && layout.pickerHasSurface
    )),
    accessibleControls: characterPages.every(page => page.unnamedButtons === 0 && page.unlabeledInputs === 0),
    scaleKeepsCarouselStable: results.interactions.scaleKeepsCarousel.firstCardPreserved &&
      results.interactions.scaleKeepsCarousel.beforeDot === results.interactions.scaleKeepsCarousel.afterDot &&
      results.interactions.scaleKeepsCarousel.beforeOrder.join('|') === results.interactions.scaleKeepsCarousel.afterOrder.join('|'),
    modelOrderPersists: results.interactions.modelReorder.handleVisible &&
      results.interactions.modelReorder.savedOrders.length === 1 &&
      results.interactions.modelReorder.order.join('|') === results.interactions.modelReorder.savedOrders[0].join('|'),
    activeAIModelCanStopAndRestart: results.interactions.aiDeactivate.before === '停用' &&
      results.interactions.aiDeactivate.stoppedText === '启用' &&
      results.interactions.aiDeactivate.activeLabel === '未启用' &&
      results.interactions.aiDeactivate.restartedText === '停用',
    noPageError: results.consoleErrors.length === 0,
  }
  results.companionAssertions = {
    ...companionChecks,
    passed: Object.values(companionChecks).every(Boolean),
  }

  const jsonPath = path.join(outDir, 'metrics.json')
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2))
  process.stdout.write(JSON.stringify({ outDir, jsonPath, pageCount:results.pages.length, window:results.window, interactions:results.interactions, companionAssertions:results.companionAssertions }, null, 2))
  win.destroy()
  if (!results.companionAssertions.passed) {
    app.exit(1)
    return
  }
  app.quit()
}

run().catch(error => {
  console.error(error)
  app.exit(1)
})
