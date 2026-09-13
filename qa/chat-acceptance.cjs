const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')
const { BUBBLE_THEME_DEFINITIONS } = require('../config/bubble-styles')

const projectRoot = path.resolve(__dirname, '..')

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.setPath('userData', path.join(os.tmpdir(), 'live2d-chat-acceptance-userdata'))

const outputDirectory = path.join(os.tmpdir(), 'live2d-chat-acceptance')
fs.mkdirSync(outputDirectory, { recursive: true })

const modelPath = pathToFileURL(path.join(projectRoot, 'models', 'hiyori', 'Hiyori.zip')).href
const qaPreloadPath = path.join(outputDirectory, 'qa-chat-preload.cjs')

// The production renderer owns the real model lifecycle. This QA-only preload
// wraps its model class with a deterministic gate so the test can inspect the
// exact interval after chat opens but before the first valid character frame.
fs.writeFileSync(qaPreloadPath, `
require(${JSON.stringify(path.join(projectRoot, 'preload.js'))})
const live2dRenderer = require(${JSON.stringify(require.resolve('live2d-renderer'))})
const OriginalLive2DModel = live2dRenderer.Live2DCubismModel
let releaseModelLoad
const modelLoadGate = new Promise(resolve => { releaseModelLoad = resolve })
window.__qaModelLoadState = { started: false, released: false }
window.__qaReleaseModelLoad = () => {
  window.__qaModelLoadState.released = true
  releaseModelLoad()
}
class QADelayedLive2DModel extends OriginalLive2DModel {
  constructor(...args) {
    super(...args)
    const originalLoad = this.load.bind(this)
    this.load = async link => {
      window.__qaModelLoadState.started = true
      await modelLoadGate
      return originalLoad(link)
    }
  }
}
Object.defineProperty(live2dRenderer, 'Live2DCubismModel', {
  configurable: true,
  enumerable: true,
  value: QADelayedLive2DModel,
})
`.trimStart())

function createSilentWav(durationMs = 900) {
  const sampleRate = 16000
  const samples = Math.round(sampleRate * durationMs / 1000)
  const dataSize = samples * 2
  const wav = Buffer.alloc(44 + dataSize)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + dataSize, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(dataSize, 40)
  return wav.toString('base64')
}

const silentWavBase64 = createSilentWav()

const snapshot = {
  appVersion: '1.0.0',
  currentModelId: 'hiyori',
  models: [{
    id: 'hiyori',
    name: 'hiyori',
    displayName: '验收角色',
    path: modelPath,
    format: 'directory',
    cubismVersion: 4,
    status: 'ready',
    statusMessage: '',
  }],
  covers: {},
  bubbleStyleCatalog: BUBBLE_THEME_DEFINITIONS,
  preferences: {
    scale: 0.85,
    cursorFollow: 'off',
    effects: 'off',
    interactionMode: 'smart',
    idleEnabled: false,
    qualityMode: 'auto',
    alwaysOnTop: true,
    launchAtLogin: false,
    reducedMotion: 'off',
    onboardingSeen: true,
    backgroundDetection: false,
    settingsPetBackground: true,
    settingsTheme: 'glass',
    bubbleStyles: { glass: 'glass', healing: 'glass' },
    chatGreeting: '你好呀～今天想聊点什么？',
  },
  ai: {
    ready: true,
    readyByCapability: { chat: true, tts: true },
    activePluginIds: { chat: 'acceptance-chat', tts: 'acceptance-tts' },
    plugins: [
      { id: 'acceptance-chat', installed: true, configured: true, capabilities: ['chat'] },
      { id: 'acceptance-tts', installed: true, configured: true, capabilities: ['tts'] },
    ],
  },
  runtime: {
    phase: 'ready',
    modelId: 'hiyori',
    message: '',
    paused: false,
    petVisible: true,
  },
}

let petWindow
let lastHitBounds = null
let lastModelStatus = null
const aiMockState = {
  chatDelayMs: 0,
  speechDelayMs: 0,
  replyText: '验收语音回复',
}

function cloneSnapshot() {
  return structuredClone(snapshot)
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function registerIPC() {
  ipcMain.handle('state:get-snapshot', () => cloneSnapshot())
  ipcMain.handle('settings:update', (_event, patch) => {
    snapshot.preferences = { ...snapshot.preferences, ...(patch || {}) }
    return cloneSnapshot()
  })
  ipcMain.handle('model:select', () => ({ ok: true, snapshot: cloneSnapshot() }))
  ipcMain.handle('model:scale-update', () => ({ ok: true, snapshot: cloneSnapshot() }))
  ipcMain.handle('ai:chat', async () => {
    const delayMs = aiMockState.chatDelayMs
    const text = aiMockState.replyText
    if (delayMs > 0) await wait(delayMs)
    return { ok: true, text, emotion: 'calm' }
  })
  ipcMain.handle('ai:speech-synthesize', async () => {
    const delayMs = aiMockState.speechDelayMs
    if (delayMs > 0) await wait(delayMs)
    return { ok: true, audioBase64: silentWavBase64, mimeType: 'audio/wav' }
  })
  ipcMain.handle('ai:conversation-get', () => ({ ok: true, messages: [] }))
  ipcMain.handle('ai:conversation-clear', () => true)
  ipcMain.on('pet:hit-bounds', (_event, bounds) => { lastHitBounds = bounds })
  ipcMain.on('model:report-status', (_event, status) => { lastModelStatus = status })
}

async function waitForModel() {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 12000) {
    if (lastModelStatus && lastModelStatus.phase === 'ready' && lastHitBounds) return true
    await wait(200)
  }
  return false
}

async function waitForModelLoadStarted(timeoutMs = 4000) {
  const startedAt = Date.now()
  let state = null
  while (Date.now() - startedAt < timeoutMs) {
    state = await petWindow.webContents.executeJavaScript('structuredClone(window.__qaModelLoadState || null)')
    if (state && state.started) return { ...state, waitedMs: Date.now() - startedAt }
    await wait(40)
  }
  return { ...(state || {}), waitedMs: Date.now() - startedAt }
}

async function runGreetingModelReadiness() {
  const loadGate = await waitForModelLoadStarted()
  petWindow.webContents.send('ai:chat-visibility', true)
  await wait(240)

  const beforeReady = await readBubble('greeting:before-model-ready')
  const beforeReadyScreenshot = await capture('greeting-before-model-ready.png')
  const beforeReadyStatus = lastModelStatus ? structuredClone(lastModelStatus) : null
  const hitBoundsBeforeReady = lastHitBounds ? structuredClone(lastHitBounds) : null
  const greetingQueuedInChat = await petWindow.webContents.executeJavaScript(`(() => {
    const greeting = document.querySelector('#ai-chat-messages .ai-message[data-message-kind="greeting"] .ai-message-content')
    return greeting ? greeting.textContent : ''
  })()`)

  await petWindow.webContents.executeJavaScript('window.__qaReleaseModelLoad()')
  const modelLoaded = await waitForModel()
  const afterReady = await waitForBubbleVisibility(true, 2500)
  const afterReadyScreenshot = await capture('greeting-after-model-ready.png')
  const hitBoundsAfterReady = lastHitBounds ? structuredClone(lastHitBounds) : null
  petWindow.webContents.send('ai:chat-visibility', false)

  const validHitBounds = bounds => Boolean(
    bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) && Number.isFinite(bounds.height) &&
    bounds.width > 0 && bounds.height > 0
  )
  const expectedGreeting = snapshot.preferences.chatGreeting
  const assertions = {
    modelLoadWasHeldByQA: loadGate.started && !loadGate.released,
    greetingExistsInChatWhileLoading: greetingQueuedInChat === expectedGreeting,
    bubbleHiddenBeforeModelReady: !beforeReady.visible,
    noHitBoundsBeforeModelReady: !validHitBounds(hitBoundsBeforeReady),
    rendererNotReadyBeforeRelease: !beforeReadyStatus || beforeReadyStatus.phase !== 'ready',
    modelAndHitBoundsBecomeReady: modelLoaded && validHitBounds(hitBoundsAfterReady),
    greetingAppearsOnlyAfterReady: afterReady.visible && afterReady.text === expectedGreeting,
  }

  return {
    loadGate,
    modelLoaded,
    states: {
      beforeReady,
      beforeReadyStatus,
      hitBoundsBeforeReady,
      greetingQueuedInChat,
      afterReady,
      hitBoundsAfterReady,
    },
    screenshots: { beforeReadyScreenshot, afterReadyScreenshot },
    assertions,
    passed: Object.values(assertions).every(Boolean),
  }
}

async function runNicknameChatSync() {
  const currentModel = snapshot.models.find(model => model.id === snapshot.currentModelId)
  const originalNickname = currentModel.nickname
  const originalDisplayName = currentModel.displayName
  const nextNickname = '刚改好的昵称'

  petWindow.webContents.send('ai:chat-visibility', true)
  await wait(100)
  currentModel.nickname = nextNickname
  currentModel.displayName = nextNickname
  petWindow.webContents.send('state:changed', {
    reason: 'model-nickname-updated',
    snapshot: cloneSnapshot(),
  })
  await wait(100)

  const updated = await petWindow.webContents.executeJavaScript(`(() => {
    const panel = document.getElementById('ai-chat-panel')
    const input = document.getElementById('ai-chat-input')
    const bubble = document.getElementById('interaction-bubble')
    return {
      name: document.getElementById('ai-chat-name').textContent,
      ariaLabel: panel.getAttribute('aria-label'),
      placeholder: input.placeholder,
      bubbleLabel: bubble.shadowRoot.querySelector('.label-text').textContent,
    }
  })()`)

  currentModel.nickname = originalNickname
  currentModel.displayName = originalDisplayName
  petWindow.webContents.send('state:changed', {
    reason: 'nickname-chat-qa-reset',
    snapshot: cloneSnapshot(),
  })
  petWindow.webContents.send('ai:chat-visibility', false)

  const assertions = {
    headerUsesNewNickname: updated.name === nextNickname,
    panelLabelUsesNewNickname: updated.ariaLabel === `与${nextNickname}对话`,
    inputPlaceholderUsesNewNickname: updated.placeholder === `和${nextNickname}说点什么…`,
    bubbleUsesNewNickname: updated.bubbleLabel === nextNickname,
  }
  return { updated, assertions, passed: Object.values(assertions).every(Boolean) }
}

async function readState(label) {
  return petWindow.webContents.executeJavaScript(`(() => {
    const panel = document.getElementById('ai-chat-panel')
    const stage = document.getElementById('pet-stage')
    const toggle = document.getElementById('ai-chat-toggle')
    const panelStyle = getComputedStyle(panel)
    const panelRect = panel.getBoundingClientRect()
    const frameStyle = getComputedStyle(stage, '::after')
    const bodyBefore = getComputedStyle(document.body, '::before')
    return {
      label: ${JSON.stringify(label)},
      theme: document.documentElement.dataset.settingsTheme,
      rootClasses: [...document.documentElement.classList],
      stageClasses: [...stage.classList],
      bodyBefore: {
        content: bodyBefore.content,
        borderTopWidth: bodyBefore.borderTopWidth,
        opacity: bodyBefore.opacity,
      },
      chat: {
        hidden: panel.hidden,
        collapsed: panel.classList.contains('is-collapsed'),
        ariaExpanded: toggle.getAttribute('aria-expanded'),
        rect: {
          x: +panelRect.x.toFixed(2),
          y: +panelRect.y.toFixed(2),
          width: +panelRect.width.toFixed(2),
          height: +panelRect.height.toFixed(2),
          right: +panelRect.right.toFixed(2),
          bottom: +panelRect.bottom.toFixed(2),
        },
        borderWidths: [panelStyle.borderTopWidth, panelStyle.borderRightWidth, panelStyle.borderBottomWidth, panelStyle.borderLeftWidth],
        borderColors: [panelStyle.borderTopColor, panelStyle.borderRightColor, panelStyle.borderBottomColor, panelStyle.borderLeftColor],
        borderRadius: panelStyle.borderRadius,
        boxShadow: panelStyle.boxShadow,
      },
      detectionFrame: {
        opacity: frameStyle.opacity,
        inset: [frameStyle.top, frameStyle.right, frameStyle.bottom, frameStyle.left],
        borderWidths: [frameStyle.borderTopWidth, frameStyle.borderRightWidth, frameStyle.borderBottomWidth, frameStyle.borderLeftWidth],
        borderColors: [frameStyle.borderTopColor, frameStyle.borderRightColor, frameStyle.borderBottomColor, frameStyle.borderLeftColor],
        borderRadius: frameStyle.borderRadius,
        boxShadow: frameStyle.boxShadow,
      },
    }
  })()`)
}

async function capture(name) {
  petWindow.webContents.invalidate()
  await petWindow.capturePage()
  const png = await petWindow.capturePage().then(image => image.toPNG())
  const outputPath = path.join(outputDirectory, name)
  fs.writeFileSync(outputPath, png)
  return outputPath
}

async function readBubble(label) {
  return petWindow.webContents.executeJavaScript(`(() => {
    const bubble = document.getElementById('interaction-bubble')
    const root = bubble.shadowRoot
    const text = root.querySelector('.message')
    const frame = root.querySelector('.frame')
    const title = root.querySelector('.label')
    const titleText = root.querySelector('.label-text')
    const titleHeart = root.querySelector('.label-heart')
    const secondaryPaw = root.querySelector('.paw-secondary')
    const tail = root.querySelector('.tail')
    const rect = bubble.getBoundingClientRect()
    const titleRect = title.getBoundingClientRect()
    const style = getComputedStyle(bubble)
    const frameStyle = getComputedStyle(frame)
    const titleStyle = getComputedStyle(title)
    const textStyle = getComputedStyle(text)
    const tailStyle = getComputedStyle(tail)
    return {
      label: ${JSON.stringify(label)},
      theme: document.documentElement.dataset.settingsTheme,
      bubbleTheme: bubble.getAttribute('theme'),
      styleName: bubble.getAttribute('style-name'),
      visible: bubble.classList.contains('is-visible'),
      text: text.textContent,
      titleText: titleText.textContent,
      opacity: style.opacity,
      backgroundImage: frameStyle.backgroundImage,
      borderColor: frameStyle.borderTopColor,
      borderRadius: frameStyle.borderRadius,
      boxShadow: frameStyle.boxShadow,
      clipPath: frameStyle.clipPath,
      textLineClamp: textStyle.webkitLineClamp,
      titleBackgroundImage: titleStyle.backgroundImage,
      titleColor: titleStyle.color,
      titleTransform: titleStyle.transform,
      titleHeartDisplay: getComputedStyle(titleHeart).display,
      secondaryPawDisplay: getComputedStyle(secondaryPaw).display,
      tailBottom: tailStyle.bottom,
      rect: {
        x: +rect.x.toFixed(2),
        y: +rect.y.toFixed(2),
        width: +rect.width.toFixed(2),
        height: +rect.height.toFixed(2),
        right: +rect.right.toFixed(2),
        bottom: +rect.bottom.toFixed(2),
      },
      titleRect: {
        x: +titleRect.x.toFixed(2),
        y: +titleRect.y.toFixed(2),
        width: +titleRect.width.toFixed(2),
        height: +titleRect.height.toFixed(2),
        right: +titleRect.right.toFixed(2),
        bottom: +titleRect.bottom.toFixed(2),
      },
    }
  })()`)
}

async function waitForBubbleVisibility(visible, timeoutMs = 3000) {
  const startedAt = Date.now()
  let state = await readBubble(`wait:${visible}:initial`)
  while (state.visible !== visible && Date.now() - startedAt < timeoutMs) {
    await wait(40)
    state = await readBubble(`wait:${visible}:${Date.now() - startedAt}`)
  }
  return { ...state, waitedMs: Date.now() - startedAt }
}

async function waitForBubbleText(expectedText, timeoutMs = 3000) {
  const startedAt = Date.now()
  let state = await readBubble(`wait-text:${expectedText}:initial`)
  while ((!state.visible || state.text !== expectedText) && Date.now() - startedAt < timeoutMs) {
    await wait(25)
    state = await readBubble(`wait-text:${expectedText}:${Date.now() - startedAt}`)
  }
  return { ...state, waitedMs: Date.now() - startedAt }
}

async function readScaleStatus(label) {
  return petWindow.webContents.executeJavaScript(`(() => {
    const toast = document.getElementById('status-toast')
    const panel = document.getElementById('ai-chat-panel')
    const toastRect = toast.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const style = getComputedStyle(toast)
    return {
      label: ${JSON.stringify(label)},
      visible: toast.classList.contains('is-visible'),
      isScaleStatus: toast.classList.contains('is-scale-status'),
      text: toast.textContent,
      viewportHeight: window.innerHeight,
      computedBottom: style.bottom,
      inlineToastBottom: toast.style.getPropertyValue('--toast-bottom'),
      toast: {
        x: +toastRect.x.toFixed(2),
        y: +toastRect.y.toFixed(2),
        width: +toastRect.width.toFixed(2),
        height: +toastRect.height.toFixed(2),
        bottom: +toastRect.bottom.toFixed(2),
      },
      chat: {
        hidden: panel.hidden,
        offsetTop: panel.offsetTop,
        transform: getComputedStyle(panel).transform,
        y: +panelRect.y.toFixed(2),
        bottom: +panelRect.bottom.toFixed(2),
      },
    }
  })()`)
}

async function setSnapshot(patch) {
  snapshot.preferences = { ...snapshot.preferences, ...patch }
  petWindow.webContents.send('state:changed', { snapshot: cloneSnapshot() })
  await wait(300)
}

async function runTheme(theme) {
  await setSnapshot({ settingsTheme: theme, backgroundDetection: false })
  petWindow.webContents.send('ai:chat-visibility', false)
  await wait(100)
  petWindow.webContents.send('ai:chat-visibility', true)
  await wait(350)
  await petWindow.webContents.executeJavaScript(`document.getElementById('ai-chat-panel').style.transition = 'none'`)

  const initial = await readState(`${theme}:initial-collapsed`)
  await petWindow.webContents.executeJavaScript(`document.getElementById('ai-chat-panel').dispatchEvent(new PointerEvent('pointerenter'))`)
  await wait(350)
  const afterHover = await readState(`${theme}:after-hover`)
  const collapsedScreenshot = await capture(`${theme}-collapsed.png`)

  await petWindow.webContents.executeJavaScript(`document.getElementById('ai-chat-toggle').click()`)
  await wait(350)
  const expanded = await readState(`${theme}:expanded-by-click`)
  const expandedScreenshot = await capture(`${theme}-expanded.png`)

  await petWindow.webContents.executeJavaScript(`document.getElementById('ai-chat-panel').dispatchEvent(new PointerEvent('pointerleave'))`)
  await wait(450)
  const afterLeave = await readState(`${theme}:after-pointer-leave`)

  await petWindow.webContents.executeJavaScript(`document.getElementById('ai-chat-toggle').click()`)
  await wait(250)
  const collapsedAgain = await readState(`${theme}:collapsed-again`)

  await setSnapshot({ backgroundDetection: true })
  await petWindow.webContents.executeJavaScript(`document.getElementById('pet-stage').classList.add('is-drag-hover')`)
  await wait(250)
  const frameWithChat = await readState(`${theme}:single-detection-frame-with-chat`)
  const frameScreenshot = await capture(`${theme}-single-detection-frame.png`)

  await setSnapshot({ backgroundDetection: false })
  const frameDisabled = await readState(`${theme}:detection-disabled-chat-open`)
  petWindow.webContents.send('ai:chat-visibility', false)

  const uniform = value => new Set(value).size === 1
  const expectedExpandedHeight = theme === 'healing' ? 268 : 246
  const assertions = {
    opensCollapsed: initial.chat.collapsed && initial.chat.ariaExpanded === 'false' && Math.abs(initial.chat.rect.height - 64) <= 1,
    hoverDoesNotExpand: afterHover.chat.collapsed && Math.abs(afterHover.chat.rect.height - 64) <= 1,
    clickExpands: !expanded.chat.collapsed && expanded.chat.ariaExpanded === 'true' && expanded.chat.rect.height === expectedExpandedHeight,
    expandedFitsWindow: expanded.chat.rect.bottom <= 590,
    pointerLeaveDoesNotCollapse: !afterLeave.chat.collapsed && afterLeave.chat.ariaExpanded === 'true',
    secondClickCollapses: collapsedAgain.chat.collapsed && collapsedAgain.chat.ariaExpanded === 'false',
    chatBorderUniform: uniform(initial.chat.borderWidths) && uniform(initial.chat.borderColors) && uniform(expanded.chat.borderWidths) && uniform(expanded.chat.borderColors),
    noChatOwnedWindowFrame: initial.bodyBefore.content === 'none' && !initial.rootClasses.includes('has-ai-chat'),
    detectionFrameSingleLine: frameWithChat.detectionFrame.opacity === '1'
      && uniform(frameWithChat.detectionFrame.borderWidths)
      && frameWithChat.detectionFrame.borderWidths[0] === '1px'
      && uniform(frameWithChat.detectionFrame.borderColors)
      && frameWithChat.detectionFrame.borderRadius === '26px'
      && frameWithChat.detectionFrame.inset.every(value => value === '8px')
      && !frameWithChat.detectionFrame.boxShadow.includes('0px 0px 0px 1px'),
    chatDoesNotChangeDetectionFrame: frameWithChat.bodyBefore.content === 'none' && !frameWithChat.rootClasses.includes('has-ai-chat'),
    noFrameWhenDetectionDisabled: frameDisabled.detectionFrame.opacity === '0' && !frameDisabled.stageClasses.includes('has-background-detection'),
  }

  return {
    theme,
    modelReady: Boolean(lastModelStatus && lastModelStatus.phase === 'ready'),
    lastHitBounds,
    states: { initial, afterHover, expanded, afterLeave, collapsedAgain, frameWithChat, frameDisabled },
    screenshots: { collapsedScreenshot, expandedScreenshot, frameScreenshot },
    assertions,
    passed: Object.values(assertions).every(Boolean),
  }
}

async function runExpandedThemeSwitch() {
  await setSnapshot({ settingsTheme: 'glass', backgroundDetection: false })
  petWindow.webContents.send('ai:chat-visibility', false)
  await wait(100)
  petWindow.webContents.send('ai:chat-visibility', true)
  await wait(300)
  await petWindow.webContents.executeJavaScript(`document.getElementById('ai-chat-toggle').click()`)
  await wait(80)

  const glassBefore = await readState('theme-switch:glass-before')
  snapshot.preferences = { ...snapshot.preferences, settingsTheme: 'healing' }
  petWindow.webContents.send('state:changed', { snapshot: cloneSnapshot() })
  const healingSamples = []
  for (const delay of [20, 40, 80]) {
    await wait(delay)
    healingSamples.push(await readState(`theme-switch:healing-${delay}`))
  }
  const healingScreenshot = await capture('theme-switch-healing-expanded.png')

  snapshot.preferences = { ...snapshot.preferences, settingsTheme: 'glass' }
  petWindow.webContents.send('state:changed', { snapshot: cloneSnapshot() })
  const glassSamples = []
  for (const delay of [20, 40, 80]) {
    await wait(delay)
    glassSamples.push(await readState(`theme-switch:glass-${delay}`))
  }
  const glassScreenshot = await capture('theme-switch-glass-expanded.png')
  petWindow.webContents.send('ai:chat-visibility', false)

  const staysVisible = state => !state.chat.collapsed
    && state.chat.rect.y >= 10
    && state.chat.rect.bottom <= 590
  const assertions = {
    startsExpandedAndVisible: staysVisible(glassBefore) && Math.abs(glassBefore.chat.rect.height - 246) <= 1,
    healingTransitionAlwaysFits: healingSamples.every(staysVisible),
    healingFinalHeight: Math.abs(healingSamples.at(-1).chat.rect.height - 268) <= 1,
    glassTransitionAlwaysFits: glassSamples.every(staysVisible),
    glassFinalHeight: Math.abs(glassSamples.at(-1).chat.rect.height - 246) <= 1,
  }

  return {
    states: { glassBefore, healingSamples, glassSamples },
    screenshots: { healingScreenshot, glassScreenshot },
    assertions,
    passed: Object.values(assertions).every(Boolean),
  }
}

async function runBubbleThemeFidelity() {
  const referenceText = '晨风拂窗台，我守你身边。键声似细雨，心愿装满怀。这首诗你会喜欢吗？'
  const states = {}
  const screenshots = {}
  const styleIds = ['glass', 'sweet', 'pixel', 'sci-fi']
  const expectedWidths = { glass: 270, sweet: 264, pixel: 270, 'sci-fi': 278 }
  petWindow.webContents.send('ai:chat-visibility', false)
  await waitForBubbleVisibility(false, 5000)

  for (const theme of ['glass', 'healing']) {
    states[theme] = {}
    screenshots[theme] = {}
    for (const styleId of styleIds) {
      await setSnapshot({
        settingsTheme: theme,
        bubbleStyles: { ...snapshot.preferences.bubbleStyles, [theme]: styleId },
      })
      petWindow.webContents.send('pet:interact', { kind: 'greet' })
      await waitForBubbleVisibility(true, 1000)
      await petWindow.webContents.executeJavaScript(`document.getElementById('interaction-bubble').message = ${JSON.stringify(referenceText)}`)
      await wait(220)
      states[theme][styleId] = await readBubble(`bubble-fidelity:${theme}:${styleId}`)
      petWindow.webContents.invalidate()
      const screenshotPath = path.join(outputDirectory, `bubble-fidelity-${theme}-${styleId}.png`)
      fs.writeFileSync(screenshotPath, await petWindow.capturePage().then(image => image.toPNG()))
      screenshots[theme][styleId] = screenshotPath
      await waitForBubbleVisibility(false, 4000)
    }
  }

  const glass = states.glass.glass
  const healing = states.healing.glass
  const centered = state => Math.abs(state.rect.x + state.rect.width / 2 - 200) <= 1
  const titleIsAttached = state => state.titleRect.y >= 0
    && state.titleRect.y < state.rect.y
    && state.titleRect.bottom > state.rect.y
  const allStates = Object.values(states).flatMap(themeStates => Object.values(themeStates))
  const styleGeometryValid = allStates.every(state => state.visible && centered(state)
    && Math.abs(state.rect.width - expectedWidths[state.styleName]) <= 1
    && Math.abs(state.rect.y - 20) <= 1 && state.rect.right <= 394
    && state.textLineClamp === '4' && titleIsAttached(state))
  const selectionsApplied = ['glass', 'healing'].every(theme => styleIds.every(styleId => (
    states[theme][styleId].theme === theme
    && states[theme][styleId].bubbleTheme === theme
    && states[theme][styleId].styleName === styleId
  )))
  const styleSignature = state => [state.backgroundImage, state.borderRadius, state.clipPath, state.titleBackgroundImage].join('|')
  const assertions = {
    allEightThemeStyleCombinationsRender: allStates.length === 8 && styleGeometryValid && selectionsApplied,
    glassGeometryMatchesReference: glass.visible && centered(glass)
      && Math.abs(glass.rect.width - 270) <= 1 && Math.abs(glass.rect.y - 20) <= 1
      && glass.rect.height >= 70 && glass.rect.right <= 388,
    glassLabelMatchesReference: glass.titleText === 'hiyori' && titleIsAttached(glass)
      && glass.titleTransform !== 'none' && glass.titleHeartDisplay === 'none',
    glassDecorMatchesReference: glass.secondaryPawDisplay === 'none'
      && glass.tailBottom === '-11px' && glass.textLineClamp === '4',
    healingGeometryMatchesReference: healing.visible && centered(healing)
      && Math.abs(healing.rect.width - 270) <= 1 && Math.abs(healing.rect.y - 20) <= 1
      && healing.rect.height >= 70 && healing.rect.right <= 388,
    healingLabelMatchesReference: healing.titleText === 'hiyori' && titleIsAttached(healing)
      && healing.titleTransform === 'none' && healing.titleHeartDisplay !== 'none',
    healingDecorMatchesReference: healing.secondaryPawDisplay !== 'none'
      && healing.tailBottom === '-11px' && healing.textLineClamp === '4',
    themesAreVisuallyDistinct: glass.backgroundImage !== healing.backgroundImage
      && glass.borderColor !== healing.borderColor
      && glass.titleBackgroundImage !== healing.titleBackgroundImage
      && glass.titleColor !== healing.titleColor,
    stylesAreVisuallyDistinctPerTheme: ['glass', 'healing'].every(theme => (
      new Set(styleIds.map(styleId => styleSignature(states[theme][styleId]))).size === styleIds.length
    )),
  }

  return {
    referenceText,
    states,
    screenshots,
    assertions,
    passed: Object.values(assertions).every(Boolean),
  }
}

async function runBubbleLifecycle() {
  petWindow.webContents.send('ai:chat-visibility', false)
  const idleBeforeTest = await waitForBubbleVisibility(false, 5000)

  petWindow.webContents.send('pet:interact', { kind: 'greet' })
  const first = await waitForBubbleVisibility(true, 1000)
  const firstScreenshot = await capture('bubble-single-instance-first.png')

  // A second interaction arrives while the first bubble still owns the lease.
  // It must be discarded instead of replacing or queueing behind the first.
  petWindow.webContents.send('pet:interact', { kind: 'head' })
  await wait(120)
  const afterCompetingInteraction = await readBubble('single-instance:after-competing-interaction')
  const afterFirstLease = await waitForBubbleVisibility(false, 3000)
  await wait(180)
  const noQueuedBubble = await readBubble('single-instance:no-queued-bubble')

  petWindow.webContents.send('ai:chat-visibility', true)
  await wait(120)
  const unmuted = await petWindow.webContents.executeJavaScript(`(() => {
    const button = document.getElementById('ai-chat-mute')
    if (button.getAttribute('aria-pressed') === 'true') button.click()
    return button.getAttribute('aria-pressed') === 'false'
  })()`)
  aiMockState.chatDelayMs = 360
  aiMockState.speechDelayMs = 480
  const expectedVoiceText = aiMockState.replyText
  const sequenceStartedAt = Date.now()
  await petWindow.webContents.executeJavaScript(`(() => {
    const input = document.getElementById('ai-chat-input')
    input.value = '播放语音气泡验收'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.getElementById('ai-chat-form').requestSubmit()
  })()`)

  const thinkingPhase = await waitForBubbleText('思考中…', 1000)
  const thinkingObservedAtMs = Date.now() - sequenceStartedAt
  const languagePhase = await waitForBubbleText('语言组织中…', 1800)
  const languageObservedAtMs = Date.now() - sequenceStartedAt
  const finalPhase = await waitForBubbleText(expectedVoiceText, 1800)
  const finalObservedAtMs = Date.now() - sequenceStartedAt
  const finalBubbleStartedAt = Date.now()
  await wait(360)
  const voiceDuringPlayback = await readBubble('voice:during-playback')
  const voiceScreenshot = await capture('bubble-voice-during-playback.png')
  petWindow.webContents.send('pet:interact', { kind: 'head' })
  await wait(100)
  const voiceAfterCompetingInteraction = await readBubble('voice:after-competing-interaction')
  const voiceEnded = await waitForBubbleVisibility(false, 2500)
  const voiceVisibleForMs = Date.now() - finalBubbleStartedAt
  aiMockState.chatDelayMs = 0
  aiMockState.speechDelayMs = 0
  petWindow.webContents.send('ai:chat-visibility', false)

  const assertions = {
    startsWithoutStaleBubble: !idleBeforeTest.visible,
    firstInteractionShowsBubble: first.visible && first.text.length > 0,
    laterInteractionCannotOverwrite: afterCompetingInteraction.visible
      && afterCompetingInteraction.text === first.text,
    laterInteractionIsNotQueued: !afterFirstLease.visible && !noQueuedBubble.visible,
    voiceCanBeEnabled: unmuted,
    thinkingPhaseAppears: thinkingPhase.visible && thinkingPhase.text === '思考中…',
    languagePhaseAppears: languagePhase.visible && languagePhase.text === '语言组织中…',
    finalVoiceBubbleAppears: finalPhase.visible && finalPhase.text === expectedVoiceText,
    voiceProgressOrder: thinkingObservedAtMs < languageObservedAtMs
      && languageObservedAtMs < finalObservedAtMs,
    thinkingWaitsForChat: languageObservedAtMs - thinkingObservedAtMs >= 280,
    languageWaitsForSpeech: finalObservedAtMs - languageObservedAtMs >= 380,
    voiceBubblePersistsDuringPlayback: voiceDuringPlayback.visible
      && voiceDuringPlayback.text === expectedVoiceText,
    interactionCannotOverwriteVoice: voiceAfterCompetingInteraction.visible
      && voiceAfterCompetingInteraction.text === expectedVoiceText,
    voiceBubbleEndsWithPlayback: !voiceEnded.visible,
    voiceLeaseHasPlaybackDuration: voiceVisibleForMs >= 650 && voiceVisibleForMs <= 2200,
  }

  return {
    states: {
      idleBeforeTest,
      first,
      afterCompetingInteraction,
      afterFirstLease,
      noQueuedBubble,
      thinkingPhase,
      languagePhase,
      finalPhase,
      voiceDuringPlayback,
      voiceAfterCompetingInteraction,
      voiceEnded,
    },
    metrics: {
      thinkingObservedAtMs,
      languageObservedAtMs,
      finalObservedAtMs,
      voiceVisibleForMs,
      chatMockDelayMs: 360,
      speechMockDelayMs: 480,
    },
    screenshots: { firstScreenshot, voiceScreenshot },
    assertions,
    passed: Object.values(assertions).every(Boolean),
  }
}

async function dispatchScaleWheel(deltaY = -120) {
  await petWindow.webContents.executeJavaScript(`(() => {
    const stage = document.getElementById('pet-stage')
    stage.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: 16,
      clientY: 240,
      deltaY: ${Number(deltaY)},
    }))
  })()`)
  await wait(260)
}

async function runScaleToastPlacement() {
  await waitForBubbleVisibility(false, 2500)
  petWindow.webContents.send('ai:chat-visibility', false)
  await wait(100)
  await dispatchScaleWheel(-120)
  const withoutChat = await readScaleStatus('scale:without-chat')
  const withoutChatScreenshot = await capture('scale-toast-without-chat.png')

  petWindow.webContents.send('ai:chat-visibility', true)
  await wait(180)
  await dispatchScaleWheel(-120)
  const withChat = await readScaleStatus('scale:with-chat')
  const withChatScreenshot = await capture('scale-toast-with-chat.png')
  petWindow.webContents.send('ai:chat-visibility', false)

  const assertions = {
    visibleWithoutChat: withoutChat.visible && withoutChat.isScaleStatus && /\d+%/.test(withoutChat.text),
    defaultsToBottomWithoutChat: withoutChat.chat.hidden
      && withoutChat.inlineToastBottom === ''
      && Math.abs(withoutChat.toast.bottom - (withoutChat.viewportHeight - 18)) <= 1,
    visibleWithChat: withChat.visible && withChat.isScaleStatus && /\d+%/.test(withChat.text),
    sitsAboveChat: !withChat.chat.hidden
      && withChat.toast.bottom < withChat.chat.y
      && withChat.chat.y - withChat.toast.bottom <= 16,
  }

  return {
    states: { withoutChat, withChat },
    screenshots: { withoutChatScreenshot, withChatScreenshot },
    assertions,
    passed: Object.values(assertions).every(Boolean),
  }
}

async function prepareThinkingScrollFixture() {
  return petWindow.webContents.executeJavaScript(`(() => {
    const panel = document.getElementById('ai-chat-panel')
    const messages = document.getElementById('ai-chat-messages')
    messages.replaceChildren()
    panel.classList.add('is-thinking')
    for (let index = 0; index < 16; index++) {
      const item = document.createElement('div')
      item.className = index % 3 === 0 ? 'ai-message is-user' : 'ai-message is-assistant'
      item.dataset.messageKind = 'conversation'
      const content = document.createElement('span')
      content.className = 'ai-message-content'
      content.textContent = index === 15
        ? '从前有只小猫咪，特别喜欢趴在窗台上看星星。有天它发现一颗流星掉进了花园。'
        : '验收消息 ' + (index + 1)
      item.appendChild(content)
      messages.appendChild(item)
    }
    const thinking = document.createElement('div')
    thinking.id = 'qa-thinking-message'
    thinking.className = 'ai-message is-thinking'
    thinking.dataset.messageKind = 'system'
    const content = document.createElement('span')
    content.className = 'ai-message-content'
    content.textContent = '正在想'
    thinking.appendChild(content)
    messages.appendChild(thinking)
    messages.scrollTop = messages.scrollHeight
    const pseudo = getComputedStyle(thinking, '::after')
    return {
      thinkingClassPresent: thinking.classList.contains('is-thinking'),
      pseudoContent: pseudo.content,
      pseudoAnimationName: pseudo.animationName,
      pseudoAnimationDuration: pseudo.animationDuration,
    }
  })()`)
}

async function resolveThinkingScrollFixture() {
  return petWindow.webContents.executeJavaScript(`(() => {
    const panel = document.getElementById('ai-chat-panel')
    const messages = document.getElementById('ai-chat-messages')
    document.getElementById('qa-thinking-message')?.remove()
    panel.classList.remove('is-thinking')
    const reply = document.createElement('div')
    reply.id = 'qa-long-reply'
    reply.className = 'ai-message is-assistant'
    reply.dataset.messageKind = 'conversation'
    const content = document.createElement('span')
    content.className = 'ai-message-content'
    content.textContent = '从前有只小猫咪，特别喜欢趴在窗台上看星星。有天它发现一颗流星掉进了花园，跑过去一看，原来是只发光的小萤火虫迷路了。小猫陪它穿过长长的草地，最后把它送回了伙伴身边。这是一条用于验证自动换行、底部滚动位置和消息气泡尺寸稳定性的长回复。'
    reply.appendChild(content)
    messages.appendChild(reply)
    messages.scrollTop = messages.scrollHeight
    return {
      thinkingRemoved: !document.querySelector('.ai-message.is-thinking'),
      replyAdded: messages.lastElementChild === reply,
      replyTextLength: Array.from(content.textContent).length,
    }
  })()`)
}

async function sampleBottomGeometry(durationMs = 2300) {
  return petWindow.webContents.executeJavaScript(`(async () => {
    const messages = document.getElementById('ai-chat-messages')
    messages.scrollTop = messages.scrollHeight
    // Chromium deliberately reduces requestAnimationFrame to about 1 FPS for a
    // hidden BrowserWindow. A 16 ms timer remains unthrottled because this QA
    // window sets backgroundThrottling:false, giving us dense continuous
    // geometry samples while the real CSS pseudo-element animation keeps going.
    await new Promise(resolve => setTimeout(resolve, 32))
    const values = []
    const startedAt = performance.now()
    do {
      await new Promise(resolve => setTimeout(resolve, 16))
      const items = messages.querySelectorAll('.ai-message')
      const previous = items[items.length - 2].getBoundingClientRect()
      const last = items[items.length - 1].getBoundingClientRect()
      const panel = document.getElementById('ai-chat-panel').getBoundingClientRect()
      values.push({
        scrollTop: +messages.scrollTop.toFixed(3),
        scrollHeight: messages.scrollHeight,
        clientHeight: messages.clientHeight,
        bottomGap: +(messages.scrollHeight - messages.clientHeight - messages.scrollTop).toFixed(3),
        previousRect: {
          x: +previous.x.toFixed(3),
          y: +previous.y.toFixed(3),
          width: +previous.width.toFixed(3),
          height: +previous.height.toFixed(3),
          top: +previous.top.toFixed(3),
          right: +previous.right.toFixed(3),
          bottom: +previous.bottom.toFixed(3),
          left: +previous.left.toFixed(3),
        },
        lastRect: {
          x: +last.x.toFixed(3),
          y: +last.y.toFixed(3),
          width: +last.width.toFixed(3),
          height: +last.height.toFixed(3),
          top: +last.top.toFixed(3),
          right: +last.right.toFixed(3),
          bottom: +last.bottom.toFixed(3),
          left: +last.left.toFixed(3),
        },
        panelTop: +panel.top.toFixed(3),
        horizontalOverflow: Math.max(0, messages.scrollWidth - messages.clientWidth),
      })
    } while (performance.now() - startedAt < ${Number(durationMs)})
    return {
      durationMs: +(performance.now() - startedAt).toFixed(3),
      values,
    }
  })()`)
}

function analyzeScrollSamples(sampleRun, fixtureAssertion = true) {
  const samples = sampleRun.values
  const spread = values => Math.max(...values) - Math.min(...values)
  const spreadFor = key => +spread(samples.map(sample => sample[key])).toFixed(3)
  const rectProperties = ['x', 'y', 'width', 'height', 'top', 'right', 'bottom', 'left']
  const rectSpreads = rectKey => Object.fromEntries(rectProperties.map(property => [
    property,
    +spread(samples.map(sample => sample[rectKey][property])).toFixed(3),
  ]))
  const previousRectSpreads = rectSpreads('previousRect')
  const lastRectSpreads = rectSpreads('lastRect')
  const maximumRectSpread = Math.max(...Object.values(previousRectSpreads), ...Object.values(lastRectSpreads))
  const metrics = {
    durationMs: sampleRun.durationMs,
    sampleCount: samples.length,
    scrollTopSpread: spreadFor('scrollTop'),
    scrollHeightSpread: spreadFor('scrollHeight'),
    clientHeightSpread: spreadFor('clientHeight'),
    bottomGapSpread: spreadFor('bottomGap'),
    previousRectSpreads,
    lastRectSpreads,
    maximumRectSpread: +maximumRectSpread.toFixed(3),
    panelTopSpread: spreadFor('panelTop'),
    maximumBottomGap: +Math.max(...samples.map(sample => Math.abs(sample.bottomGap))).toFixed(3),
    maximumHorizontalOverflow: +Math.max(...samples.map(sample => sample.horizontalOverflow)).toFixed(3),
  }
  const assertions = {
    fixtureStateIsCorrect: fixtureAssertion,
    sampledContinuouslyForAtLeast2200ms: metrics.durationMs >= 2200 && metrics.sampleCount >= 100,
    remainsAtBottom: metrics.maximumBottomGap <= 1,
    scrollTopStable: metrics.scrollTopSpread <= 1,
    scrollHeightStable: metrics.scrollHeightSpread <= 1,
    bottomGapStable: metrics.bottomGapSpread <= 1,
    previousMessageRectStable: Object.values(metrics.previousRectSpreads).every(value => value <= 1),
    lastMessageRectStable: Object.values(metrics.lastRectSpreads).every(value => value <= 1),
    panelTopStable: metrics.panelTopSpread <= 1,
    noHorizontalOverflow: metrics.maximumHorizontalOverflow <= 1,
  }
  return {
    metrics,
    firstSample: samples[0],
    lastSample: samples.at(-1),
    samples,
    assertions,
    passed: Object.values(assertions).every(Boolean),
  }
}

async function runScrollBottomStabilityTheme(theme) {
  await setSnapshot({ settingsTheme: theme, backgroundDetection: false })
  petWindow.webContents.send('ai:chat-visibility', false)
  await wait(80)
  petWindow.webContents.send('ai:chat-visibility', true)
  await wait(150)
  await petWindow.webContents.executeJavaScript(`(() => {
    const panel = document.getElementById('ai-chat-panel')
    if (panel.classList.contains('is-collapsed')) document.getElementById('ai-chat-toggle').click()
  })()`)
  await wait(250)

  const thinkingFixture = await prepareThinkingScrollFixture()
  const thinkingSamples = await sampleBottomGeometry(2300)
  const thinkingScreenshot = await capture(`chat-scroll-${theme}-thinking.png`)
  const thinkingAnimationActive = thinkingFixture.thinkingClassPresent
    && thinkingFixture.pseudoContent !== 'none'
    && thinkingFixture.pseudoAnimationName.includes('thinking-opacity')
    && thinkingFixture.pseudoAnimationDuration !== '0s'
  const thinking = analyzeScrollSamples(thinkingSamples, thinkingAnimationActive)

  const resolvedFixture = await resolveThinkingScrollFixture()
  const resolvedSamples = await sampleBottomGeometry(2300)
  const resolvedScreenshot = await capture(`chat-scroll-${theme}-resolved.png`)
  const resolved = analyzeScrollSamples(
    resolvedSamples,
    resolvedFixture.thinkingRemoved && resolvedFixture.replyAdded && resolvedFixture.replyTextLength >= 100
  )
  petWindow.webContents.send('ai:chat-visibility', false)

  const assertions = {
    thinkingPhaseStable: thinking.passed,
    longReplyPhaseStable: resolved.passed,
  }
  return {
    theme,
    fixtures: { thinking: thinkingFixture, resolved: resolvedFixture },
    phases: { thinking, resolved },
    screenshots: { thinkingScreenshot, resolvedScreenshot },
    assertions,
    passed: Object.values(assertions).every(Boolean),
  }
}

async function runScrollBottomStability() {
  const themes = []
  for (const theme of ['glass', 'healing']) {
    themes.push(await runScrollBottomStabilityTheme(theme))
  }
  return {
    themes,
    passed: themes.every(theme => theme.passed),
  }
}

async function run() {
  registerIPC()
  await app.whenReady()
  petWindow = new BrowserWindow({
    width: 400,
    height: 600,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    hasShadow: false,
    webPreferences: {
      preload: qaPreloadPath,
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
      webSecurity: false,
      backgroundThrottling: false,
    },
  })
  petWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    process.stderr.write(`[renderer:${level}] ${message} (${sourceId}:${line})\n`)
  })

  await petWindow.loadFile(path.join(projectRoot, 'renderer', 'index.html'))
  // Hidden BrowserWindows do not advance CSS entry animations predictably until
  // capture/rAF work begins. Disable entry-only motion so geometry assertions
  // measure the stable UI rather than a frozen first animation frame. The
  // thinking dots live on .is-thinking::after, keep their own animation, and
  // each theme test verifies that animation is active before sampling.
  await petWindow.webContents.insertCSS('.ai-chat-panel,.ai-message{animation:none!important}.interaction-bubble-widget,.status-toast,#pet-stage::after{transition:none!important}')
  const greetingModelReadiness = await runGreetingModelReadiness()
  const modelLoaded = greetingModelReadiness.modelLoaded
  const nicknameChatSync = await runNicknameChatSync()
  const results = []
  for (const theme of ['glass', 'healing']) results.push(await runTheme(theme))
  const themeSwitch = await runExpandedThemeSwitch()
  const bubbleThemeFidelity = await runBubbleThemeFidelity()
  const bubbleLifecycle = await runBubbleLifecycle()
  const scaleToastPlacement = await runScaleToastPlacement()
  const scrollBottomStability = await runScrollBottomStability()

  const report = {
    generatedAt: new Date().toISOString(),
    outputDirectory,
    modelLoaded,
    lastModelStatus,
    greetingModelReadiness,
    nicknameChatSync,
    results,
    themeSwitch,
    bubbleThemeFidelity,
    bubbleLifecycle,
    scaleToastPlacement,
    scrollBottomStability,
    passed: greetingModelReadiness.passed
      && nicknameChatSync.passed
      && results.every(result => result.passed)
      && themeSwitch.passed
      && bubbleThemeFidelity.passed
      && bubbleLifecycle.passed
      && scaleToastPlacement.passed
      && scrollBottomStability.passed,
  }
  const reportPath = path.join(outputDirectory, 'results.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  process.stdout.write(JSON.stringify({
    reportPath,
    modelLoaded,
    lastModelStatus,
    greetingModelReadiness: {
      passed: greetingModelReadiness.passed,
      assertions: greetingModelReadiness.assertions,
      screenshots: greetingModelReadiness.screenshots,
    },
    nicknameChatSync,
    themes: results.map(result => ({ theme: result.theme, passed: result.passed, assertions: result.assertions, screenshots: result.screenshots })),
    themeSwitch: { passed: themeSwitch.passed, assertions: themeSwitch.assertions, screenshots: themeSwitch.screenshots },
    bubbleThemeFidelity: {
      passed: bubbleThemeFidelity.passed,
      assertions: bubbleThemeFidelity.assertions,
      states: bubbleThemeFidelity.states,
      screenshots: bubbleThemeFidelity.screenshots,
    },
    bubbleLifecycle: { passed: bubbleLifecycle.passed, assertions: bubbleLifecycle.assertions, metrics: bubbleLifecycle.metrics, screenshots: bubbleLifecycle.screenshots },
    scaleToastPlacement: { passed: scaleToastPlacement.passed, assertions: scaleToastPlacement.assertions, screenshots: scaleToastPlacement.screenshots },
    scrollBottomStability: {
      passed: scrollBottomStability.passed,
      themes: scrollBottomStability.themes.map(theme => ({
        theme: theme.theme,
        passed: theme.passed,
        fixtures: theme.fixtures,
        assertions: theme.assertions,
        screenshots: theme.screenshots,
        phases: {
          thinking: { passed: theme.phases.thinking.passed, assertions: theme.phases.thinking.assertions, metrics: theme.phases.thinking.metrics },
          resolved: { passed: theme.phases.resolved.passed, assertions: theme.phases.resolved.assertions, metrics: theme.phases.resolved.metrics },
        },
      })),
    },
    passed: report.passed,
  }, null, 2))
  petWindow.destroy()
  app.quit()
}

run().catch(error => {
  console.error(error)
  if (petWindow && !petWindow.isDestroyed()) petWindow.destroy()
  app.exit(1)
})
