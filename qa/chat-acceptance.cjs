const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')
const sharp = require('sharp')
const { BUBBLE_THEME_DEFINITIONS } = require('../config/bubble-styles')
const { DEFAULT_LONG_MESSAGE_CHARACTER_THRESHOLD } = require('../config/long-message')

const projectRoot = path.resolve(__dirname, '..')
const messageOutputOnly = process.argv.includes('--message-output-only')

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.setPath('userData', path.join(os.tmpdir(), messageOutputOnly
  ? 'live2d-message-output-runtime-userdata'
  : 'live2d-chat-acceptance-userdata'))

const outputDirectory = path.join(os.tmpdir(), messageOutputOnly
  ? 'live2d-message-output-runtime-qa'
  : 'live2d-chat-acceptance')
fs.mkdirSync(outputDirectory, { recursive: true })

const modelPath = pathToFileURL(path.join(projectRoot, 'models', 'hiyori', 'Hiyori.zip')).href
const qaPreloadPath = path.join(outputDirectory, 'qa-chat-preload.cjs')
const LONG_MESSAGE_READER_WIDTH = 380
const LONG_MESSAGE_READER_GAP = 14
const LONG_MESSAGE_READER_EDGE = 18
const PET_VIEWPORT_WIDTH = 400
const PET_VIEWPORT_HEIGHT = 600
const LONG_MESSAGE_READER_EXTENSION = LONG_MESSAGE_READER_GAP + LONG_MESSAGE_READER_WIDTH + LONG_MESSAGE_READER_EDGE
const LONG_MESSAGE_READER_WINDOW_WIDTH = LONG_MESSAGE_READER_WIDTH + LONG_MESSAGE_READER_EDGE * 2
const PET_COLLAPSED_HOST_WIDTH = PET_VIEWPORT_WIDTH
const PET_EXPANDED_HOST_WIDTH = PET_VIEWPORT_WIDTH + LONG_MESSAGE_READER_EXTENSION

// The production renderer owns the real model lifecycle. This QA-only preload
// wraps its model class with a deterministic gate so the test can inspect the
// exact interval after chat opens but before the first valid character frame.
fs.writeFileSync(qaPreloadPath, `
require(${JSON.stringify(path.join(projectRoot, 'preload.js'))})
const { ipcRenderer: qaIpcRenderer } = require('electron')
const live2dRenderer = require(${JSON.stringify(require.resolve('live2d-renderer'))})
const OriginalLive2DModel = live2dRenderer.Live2DCubismModel
let releaseModelLoad
const modelLoadGate = new Promise(resolve => { releaseModelLoad = resolve })
window.__qaModelLoadState = { started: false, released: false }
window.__qaReleaseModelLoad = () => {
  window.__qaModelLoadState.released = true
  releaseModelLoad()
}
let controlledAudioResolve = null
window.__qaControlledAudioPlayback = false
window.__qaAudioPlaybackState = {
  inputCalls: [],
  stopCalls: 0,
  pending: false,
  completedCalls: 0,
}
window.__qaUseControlledAudioPlayback = enabled => {
  window.__qaControlledAudioPlayback = Boolean(enabled)
  if (!enabled && controlledAudioResolve) {
    const resolve = controlledAudioResolve
    controlledAudioResolve = null
    window.__qaAudioPlaybackState.pending = false
    window.__qaAudioPlaybackState.completedCalls += 1
    resolve()
  }
  return structuredClone(window.__qaAudioPlaybackState)
}
window.__qaCompleteAudioPlayback = () => {
  if (!controlledAudioResolve) return false
  const resolve = controlledAudioResolve
  controlledAudioResolve = null
  window.__qaAudioPlaybackState.pending = false
  window.__qaAudioPlaybackState.completedCalls += 1
  resolve()
  return true
}
class QADelayedLive2DModel extends OriginalLive2DModel {
  constructor(...args) {
    super(...args)
    window.__qaLive2DModel = this
    const originalLoad = this.load.bind(this)
    const originalInputAudio = typeof this.inputAudio === 'function' ? this.inputAudio.bind(this) : null
    const originalStopAudio = typeof this.stopAudio === 'function' ? this.stopAudio.bind(this) : null
    this.load = async link => {
      window.__qaModelLoadState.started = true
      await modelLoadGate
      return originalLoad(link)
    }
    this.inputAudio = (wavBuffer, playAudio = false) => {
      const byteLength = Number(wavBuffer && wavBuffer.byteLength) || 0
      window.__qaAudioPlaybackState.inputCalls.push({ byteLength, playAudio: Boolean(playAudio) })
      if (!window.__qaControlledAudioPlayback && originalInputAudio) {
        return originalInputAudio(wavBuffer, playAudio)
      }
      if (controlledAudioResolve) controlledAudioResolve()
      window.__qaAudioPlaybackState.pending = true
      return new Promise(resolve => { controlledAudioResolve = resolve })
    }
    this.stopAudio = () => {
      window.__qaAudioPlaybackState.stopCalls += 1
      if (controlledAudioResolve) {
        const resolve = controlledAudioResolve
        controlledAudioResolve = null
        window.__qaAudioPlaybackState.pending = false
        window.__qaAudioPlaybackState.completedCalls += 1
        resolve()
      }
      if (!window.__qaControlledAudioPlayback && originalStopAudio) return originalStopAudio()
      return true
    }
  }
}
window.__qaPrimeLipSyncState = () => {
  const controller = window.__qaLive2DModel && window.__qaLive2DModel.wavController
  if (!controller) return false
  controller.samples = [new Float32Array(320000)]
  controller.numChannels = 1
  controller.sampleRate = 16000
  controller.samplesPerChannel = 320000
  controller.sampleOffset = 0
  controller.userTime = 0
  controller.previousRms = .72
  controller.rms = .72
  return true
}
window.__qaReadLipSyncState = () => {
  const controller = window.__qaLive2DModel && window.__qaLive2DModel.wavController
  return controller ? {
    samplesCleared: controller.samples == null,
    sampleOffset: controller.sampleOffset,
    samplesPerChannel: controller.samplesPerChannel,
    userTime: controller.userTime,
    previousRms: controller.previousRms,
    rms: controller.rms,
  } : null
}
let qaTransitionSampleSignature = ''
function reportTransitionFrameSample() {
  const frame = document.querySelector('.pet-stage-transition-frame')
  const viewport = document.getElementById('pet-viewport')
  if (!frame || !viewport) return
  const frameRect = frame.getBoundingClientRect()
  const viewportRect = viewport.getBoundingClientRect()
  const sample = {
    phase: frame.dataset.phase || '',
    frameLeft: frame.style.left,
    frameRectX: frameRect.x,
    frameWidth: frameRect.width,
    viewportRectX: viewportRect.x,
    innerWidth: window.innerWidth,
  }
  const signature = JSON.stringify(sample)
  if (signature === qaTransitionSampleSignature) return
  qaTransitionSampleSignature = signature
  qaIpcRenderer.send('qa:pet-stage-transition-frame-sample', sample)
}
window.addEventListener('DOMContentLoaded', () => {
  const observer = new MutationObserver(records => {
    if (records.some(record => (
      (record.target instanceof Element && record.target.classList.contains('pet-stage-transition-frame'))
      || [...record.addedNodes].some(node => node instanceof Element && node.classList.contains('pet-stage-transition-frame'))
    ))) queueMicrotask(reportTransitionFrameSample)
  })
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['style', 'data-phase'],
  })
})
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
  appVersion: '1.0.1',
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
    longMessageCharacterThreshold: DEFAULT_LONG_MESSAGE_CHARACTER_THRESHOLD,
    appLongMessageAutoExpand: false,
    externalLongMessageAutoExpand: false,
    appMessageStreamingOutput: false,
    externalMessageStreamingOutput: false,
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
let detachedReaderWindow = null
let detachedReaderFixture = null
const detachedReaderRenderedRevisions = []
const detachedReaderActions = []
let lastHitBounds = null
let lastModelStatus = null
let lastLongMessageBounds = null
let longMessageLayoutRevision = 0
let longMessageLayoutSide = 'right'
let committedLongMessageLayout = null
const longMessageBoundsReports = []
const longMessageLayoutCalls = []
const longMessageTransitionCalls = []
const longMessageTransitionFrameSamples = []
const copiedTexts = []
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
  const resolveLongMessageLayout = (payload = {}, revision = longMessageLayoutRevision + 1) => {
    const open = Boolean(payload && payload.open)
    return open
      ? {
          expanded: true,
          side: longMessageLayoutSide,
          mode: longMessageLayoutSide,
          readerWidth: LONG_MESSAGE_READER_WIDTH,
          gap: LONG_MESSAGE_READER_GAP,
          stageOffsetX: longMessageLayoutSide === 'left' ? LONG_MESSAGE_READER_EXTENSION : 0,
          readerOffsetX: longMessageLayoutSide === 'left'
            ? LONG_MESSAGE_READER_EDGE
            : PET_VIEWPORT_WIDTH + LONG_MESSAGE_READER_GAP,
          outerWidth: PET_EXPANDED_HOST_WIDTH,
          outerHeight: PET_VIEWPORT_HEIGHT,
          stageWidth: PET_VIEWPORT_WIDTH,
          stageHeight: PET_VIEWPORT_HEIGHT,
          revision,
        }
      : {
          expanded: false,
          side: 'none',
          mode: 'collapsed',
          readerWidth: 0,
          gap: LONG_MESSAGE_READER_GAP,
          stageOffsetX: 0,
          readerOffsetX: 0,
          outerWidth: PET_COLLAPSED_HOST_WIDTH,
          outerHeight: PET_VIEWPORT_HEIGHT,
          stageWidth: PET_VIEWPORT_WIDTH,
          stageHeight: PET_VIEWPORT_HEIGHT,
          revision,
        }
  }
  if (!committedLongMessageLayout) {
    committedLongMessageLayout = structuredClone(resolveLongMessageLayout({ open: false }, ++longMessageLayoutRevision))
  }
  const commitLongMessageLayout = (payload = {}, transport = 'async') => {
    const layout = resolveLongMessageLayout(payload, ++longMessageLayoutRevision)
    if (petWindow && !petWindow.isDestroyed()) {
      const bounds = petWindow.getBounds()
      const stageScreenX = bounds.x + Number(committedLongMessageLayout && committedLongMessageLayout.stageOffsetX || 0)
      const nextBounds = {
        x: stageScreenX - Number(layout.stageOffsetX || 0),
        y: bounds.y,
        width: layout.outerWidth,
        height: layout.outerHeight,
      }
      if (bounds.width !== nextBounds.width || bounds.height !== nextBounds.height) {
        petWindow.setBounds(nextBounds, false)
      } else if (bounds.x !== nextBounds.x || bounds.y !== nextBounds.y) {
        petWindow.setBounds(nextBounds, false)
      }
      // Exercise the production preload subscription as well as the invoke
      // response. Both paths deliberately carry the same revision and geometry.
      setImmediate(() => {
        if (petWindow && !petWindow.isDestroyed()) {
          petWindow.webContents.send('pet:window-layout-changed', structuredClone(layout))
        }
      })
    }
    longMessageLayoutCalls.push({
      payload: structuredClone(payload),
      layout: structuredClone(layout),
      transport,
    })
    committedLongMessageLayout = structuredClone(layout)
    return layout
  }
  ipcMain.handle('pet:long-message-layout', (_event, payload = {}) => {
    return commitLongMessageLayout(payload, 'async')
  })
  ipcMain.on('pet:long-message-layout-preview', (event, payload = {}) => {
    event.returnValue = resolveLongMessageLayout(payload)
  })
  ipcMain.on('pet:long-message-layout-commit', (event, payload = {}) => {
    event.returnValue = commitLongMessageLayout(payload, 'sync')
  })
  ipcMain.handle('pet:long-message-transition-frame', async () => {
    if (!petWindow || petWindow.isDestroyed()) return ''
    const image = await petWindow.capturePage({
      x: Number(committedLongMessageLayout && committedLongMessageLayout.stageOffsetX || 0),
      y: 0,
      width: PET_VIEWPORT_WIDTH,
      height: PET_VIEWPORT_HEIGHT,
    })
    return image.toDataURL()
  })
  ipcMain.on('pet:long-message-transition-state', (event, active) => {
    longMessageTransitionCalls.push({
      active: Boolean(active),
      layout: committedLongMessageLayout ? structuredClone(committedLongMessageLayout) : null,
      bounds: petWindow && !petWindow.isDestroyed() ? petWindow.getBounds() : null,
    })
    event.returnValue = Boolean(active)
  })
  ipcMain.on('qa:pet-stage-transition-frame-sample', (event, sample) => {
    if (!petWindow || petWindow.isDestroyed() || event.sender.id !== petWindow.webContents.id) return
    longMessageTransitionFrameSamples.push({
      ...structuredClone(sample),
      nativeBounds: petWindow.getBounds(),
      layout: committedLongMessageLayout ? structuredClone(committedLongMessageLayout) : null,
    })
  })
  ipcMain.handle('clipboard:write-text', (_event, value) => {
    if (typeof value !== 'string' || !value) return false
    copiedTexts.push(value)
    return true
  })
  ipcMain.on('long-message-reader:request-state', event => {
    if (
      !detachedReaderWindow || detachedReaderWindow.isDestroyed() ||
      event.sender.id !== detachedReaderWindow.webContents.id || !detachedReaderFixture
    ) return
    detachedReaderWindow.webContents.send('long-message-reader:state', structuredClone(detachedReaderFixture))
  })
  ipcMain.on('long-message-reader:rendered', (event, revision) => {
    if (
      detachedReaderWindow && !detachedReaderWindow.isDestroyed() &&
      event.sender.id === detachedReaderWindow.webContents.id
    ) detachedReaderRenderedRevisions.push(Number(revision))
  })
  ipcMain.on('long-message-reader:action', (event, action) => {
    if (
      detachedReaderWindow && !detachedReaderWindow.isDestroyed() &&
      event.sender.id === detachedReaderWindow.webContents.id
    ) detachedReaderActions.push(String(action || ''))
  })
  ipcMain.on('pet:hit-bounds', (_event, bounds) => { lastHitBounds = bounds })
  ipcMain.on('pet:long-message-bounds', (_event, bounds) => {
    lastLongMessageBounds = bounds ? structuredClone(bounds) : null
    longMessageBoundsReports.push(lastLongMessageBounds)
  })
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
        appMessageCount: panel.querySelectorAll('.ai-message[data-message-source="app"]').length,
        appSourceBadgeCount: panel.querySelectorAll('.ai-message[data-message-source="app"] .ai-message-source').length,
        appOriginCount: panel.querySelectorAll('.ai-message[data-message-source="app"] .ai-message-origin').length,
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
        backgroundColor: frameStyle.backgroundColor,
        backgroundImage: frameStyle.backgroundImage,
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

async function alphaAtImagePoints(imagePath, points) {
  const { data, info } = await sharp(imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const alphaAt = ([x, y]) => {
    const pixelX = Math.min(info.width - 1, Math.max(0, Math.round(x)))
    const pixelY = Math.min(info.height - 1, Math.max(0, Math.round(y)))
    return data[(pixelY * info.width + pixelX) * 4 + 3]
  }
  return Object.fromEntries(Object.entries(points).map(([name, point]) => [name, alphaAt(point)]))
}

async function readBubble(label) {
  return petWindow.webContents.executeJavaScript(`(() => {
    const bubble = document.getElementById('interaction-bubble')
    const root = bubble.shadowRoot
    const text = root.querySelector('.message')
    const frame = root.querySelector('.frame')
    const title = root.querySelector('.label')
    const titleText = root.querySelector('.label-text')
    const sourceMarker = root.querySelector('.source-marker')
    const titleHeart = root.querySelector('.label-heart')
    const secondaryPaw = root.querySelector('.paw-secondary')
    const tail = root.querySelector('.tail')
    const expand = root.querySelector('.message-expand')
    const rect = bubble.getBoundingClientRect()
    const messageRect = text.getBoundingClientRect()
    const expandRect = expand.getBoundingClientRect()
    const titleRect = title.getBoundingClientRect()
    const sourceRect = sourceMarker.getBoundingClientRect()
    const style = getComputedStyle(bubble)
    const frameStyle = getComputedStyle(frame)
    const titleStyle = getComputedStyle(title)
    const sourceStyle = getComputedStyle(sourceMarker)
    const textStyle = getComputedStyle(text)
    const tailStyle = getComputedStyle(tail)
    const expandStyle = getComputedStyle(expand)
    const lineHeight = Number.parseFloat(textStyle.lineHeight) || 0
    const thirdLineTop = messageRect.top + lineHeight * 2
    const thirdLineBottom = messageRect.top + lineHeight * 3
    return {
      label: ${JSON.stringify(label)},
      theme: document.documentElement.dataset.settingsTheme,
      bubbleTheme: bubble.getAttribute('theme'),
      styleName: bubble.getAttribute('style-name'),
      visible: bubble.classList.contains('is-visible'),
      text: text.textContent,
      fullText: bubble.fullMessage,
      titleText: titleText.textContent,
      source: bubble.source || '',
      sourceText: sourceMarker.textContent.trim(),
      sourceHidden: sourceMarker.hidden,
      sourceDisplay: sourceStyle.display,
      sourceOpacity: sourceStyle.opacity,
      sourceBackgroundColor: sourceStyle.backgroundColor,
      sourceBorderTopWidth: sourceStyle.borderTopWidth,
      sourceBoxShadow: sourceStyle.boxShadow,
      opacity: style.opacity,
      backgroundImage: frameStyle.backgroundImage,
      borderColor: frameStyle.borderTopColor,
      borderRadius: frameStyle.borderRadius,
      boxShadow: frameStyle.boxShadow,
      clipPath: frameStyle.clipPath,
      textLineClamp: textStyle.webkitLineClamp,
      textFontSize: textStyle.fontSize,
      textLineHeight: textStyle.lineHeight,
      textClientHeight: text.clientHeight,
      textScrollHeight: text.scrollHeight,
      expandable: bubble.expandable,
      expanded: bubble.expanded,
      expandHidden: expand.hidden,
      expandDisplay: expandStyle.display,
      expandAriaExpanded: expand.getAttribute('aria-expanded'),
      expandLabel: expand.textContent.trim(),
      expandRightGap: +(rect.right - expandRect.right).toFixed(2),
      expandBottomGap: +(rect.bottom - expandRect.bottom).toFixed(2),
      expandOverlapsThirdLine: expandRect.width > 0 && expandRect.height > 0
        && expandRect.left < messageRect.right && expandRect.right > messageRect.left
        && expandRect.top < thirdLineBottom && expandRect.bottom > thirdLineTop,
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
      messageRect: {
        x: +messageRect.x.toFixed(2),
        y: +messageRect.y.toFixed(2),
        width: +messageRect.width.toFixed(2),
        height: +messageRect.height.toFixed(2),
        right: +messageRect.right.toFixed(2),
        bottom: +messageRect.bottom.toFixed(2),
      },
      expandRect: {
        x: +expandRect.x.toFixed(2),
        y: +expandRect.y.toFixed(2),
        width: +expandRect.width.toFixed(2),
        height: +expandRect.height.toFixed(2),
        right: +expandRect.right.toFixed(2),
        bottom: +expandRect.bottom.toFixed(2),
      },
      titleRect: {
        x: +titleRect.x.toFixed(2),
        y: +titleRect.y.toFixed(2),
        width: +titleRect.width.toFixed(2),
        height: +titleRect.height.toFixed(2),
        right: +titleRect.right.toFixed(2),
        bottom: +titleRect.bottom.toFixed(2),
      },
      sourceRect: {
        x: +sourceRect.x.toFixed(2),
        y: +sourceRect.y.toFixed(2),
        width: +sourceRect.width.toFixed(2),
        height: +sourceRect.height.toFixed(2),
        right: +sourceRect.right.toFixed(2),
        bottom: +sourceRect.bottom.toFixed(2),
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

async function waitForBubblePayload(expectedText, timeoutMs = 3000) {
  const startedAt = Date.now()
  let state = await readBubble(`wait-payload:${expectedText}:initial`)
  while ((!state.visible || state.fullText !== expectedText) && Date.now() - startedAt < timeoutMs) {
    await wait(20)
    state = await readBubble(`wait-payload:${expectedText}:${Date.now() - startedAt}`)
  }
  return { ...state, waitedMs: Date.now() - startedAt }
}

async function waitForBubbleMessage(expectedText, timeoutMs = 3000) {
  const startedAt = Date.now()
  let state = await readBubble(`wait-message:${expectedText}:initial`)
  while (state.text !== expectedText && Date.now() - startedAt < timeoutMs) {
    await wait(25)
    state = await readBubble(`wait-message:${expectedText}:${Date.now() - startedAt}`)
  }
  return { ...state, waitedMs: Date.now() - startedAt }
}

async function waitForBubbleExpandable(expandable = true, timeoutMs = 3000) {
  const startedAt = Date.now()
  let state = await readBubble(`wait-expandable:${expandable}:initial`)
  while (state.expandable !== expandable && Date.now() - startedAt < timeoutMs) {
    await wait(40)
    state = await readBubble(`wait-expandable:${expandable}:${Date.now() - startedAt}`)
  }
  return { ...state, waitedMs: Date.now() - startedAt }
}

async function readLongMessageState(label) {
  return petWindow.webContents.executeJavaScript(`(() => {
    const reader = document.getElementById('long-message-reader')
    const body = document.getElementById('long-message-reader-body')
    const bubble = document.getElementById('interaction-bubble')
    const bubbleMessage = bubble.shadowRoot.querySelector('.message')
    const bubbleExpand = bubble.shadowRoot.querySelector('.message-expand')
    const copy = document.getElementById('long-message-copy')
    const collapse = document.getElementById('long-message-collapse')
    const badge = document.getElementById('long-message-badge')
    const audioKind = document.getElementById('long-message-audio-kind')
    const sourceMarker = document.getElementById('long-message-source')
    const audio = document.getElementById('long-message-audio')
    const sheen = reader.querySelector('.long-message-reader-sheen')
    const connectorPetal = reader.querySelector('.long-message-reader-petal-left')
    const viewport = document.getElementById('pet-viewport')
    const readerRect = reader.getBoundingClientRect()
    const bodyRect = body.getBoundingClientRect()
    const viewportRect = viewport.getBoundingClientRect()
    const readerStyle = getComputedStyle(reader)
    const tailStyle = getComputedStyle(reader, '::before')
    const bodyStyle = getComputedStyle(body)
    const badgeStyle = getComputedStyle(badge)
    const audioKindStyle = getComputedStyle(audioKind)
    const sourceStyle = getComputedStyle(sourceMarker)
    const bubbleMessageStyle = getComputedStyle(bubbleMessage)
    const readerPadding = Number.parseFloat(readerStyle.paddingLeft) + Number.parseFloat(readerStyle.paddingRight)
    const rect = value => ({
      x: +value.x.toFixed(2),
      y: +value.y.toFixed(2),
      width: +value.width.toFixed(2),
      height: +value.height.toFixed(2),
      right: +value.right.toFixed(2),
      bottom: +value.bottom.toFixed(2),
    })
    const apiNames = [
      'setLongMessageLayout',
      'previewLongMessageLayout',
      'commitLongMessageLayout',
      'capturePetTransitionFrame',
      'setLongMessageTransitionState',
      'onPetWindowLayoutChanged',
      'reportLongMessageBounds',
      'writeClipboardText',
    ]
    return {
      label: ${JSON.stringify(label)},
      theme: document.documentElement.dataset.settingsTheme,
      layoutMode: document.documentElement.dataset.longMessageLayout || '',
      apiSurface: Object.fromEntries(apiNames.map(name => [name, typeof window.petAPI[name] === 'function'])),
      windowSize: { width: window.innerWidth, height: window.innerHeight },
      viewport: {
        rect: rect(viewportRect),
        offsetX: getComputedStyle(document.body).getPropertyValue('--pet-stage-offset-x').trim(),
      },
      reader: {
        hidden: reader.hidden,
        visible: !reader.hidden
          && readerStyle.display !== 'none'
          && readerRect.width > 0
          && readerRect.height > 0,
        visibleClass: reader.classList.contains('is-visible'),
        role: reader.getAttribute('role'),
        ariaModal: reader.getAttribute('aria-modal'),
        side: reader.dataset.side || '',
        layoutRevision: reader.dataset.layoutRevision || '',
        rect: rect(readerRect),
        computedHeight: readerStyle.height,
        computedWidth: readerStyle.width,
        boxShadow: readerStyle.boxShadow,
        sheenDisplay: getComputedStyle(sheen).display,
        connectorPetalDisplay: getComputedStyle(connectorPetal).display,
        tail: {
          display: tailStyle.display,
          top: tailStyle.top,
          right: tailStyle.right,
          left: tailStyle.left,
          width: tailStyle.width,
          height: tailStyle.height,
          clipPath: tailStyle.clipPath,
          filter: tailStyle.filter,
          transform: tailStyle.transform,
          boxShadow: tailStyle.boxShadow,
        },
        bodyRect: rect(bodyRect),
        bodyText: body.textContent,
        bodyFontSize: bodyStyle.fontSize,
        bodyColor: bodyStyle.color,
        bodyTextAlign: bodyStyle.textAlign,
        bodyWhiteSpace: bodyStyle.whiteSpace,
        bodyClientWidth: body.clientWidth,
        bodyScrollWidth: body.scrollWidth,
        bodyClientHeight: body.clientHeight,
        bodyScrollHeight: body.scrollHeight,
        bodyScrollTop: +body.scrollTop.toFixed(2),
        contentWidth: +(reader.clientWidth - readerPadding).toFixed(2),
        scrollableClass: reader.classList.contains('is-scrollable'),
        atStartClass: reader.classList.contains('is-at-start'),
        atEndClass: reader.classList.contains('is-at-end'),
        title: document.getElementById('long-message-title').textContent,
        subtitle: document.getElementById('long-message-subtitle').textContent,
        source: {
          value: reader.dataset.source || '',
          text: sourceMarker.textContent.trim(),
          hidden: sourceMarker.hidden,
          display: sourceStyle.display,
          opacity: sourceStyle.opacity,
          backgroundColor: sourceStyle.backgroundColor,
          borderTopWidth: sourceStyle.borderTopWidth,
          boxShadow: sourceStyle.boxShadow,
        },
        badge: badge.textContent.trim(),
        tags: {
          badgePaddingLeft: badgeStyle.paddingLeft,
          badgePaddingRight: badgeStyle.paddingRight,
          badgeClientWidth: badge.clientWidth,
          badgeScrollWidth: badge.scrollWidth,
          audioKindPaddingLeft: audioKindStyle.paddingLeft,
          audioKindPaddingRight: audioKindStyle.paddingRight,
          audioKindClientWidth: audioKind.clientWidth,
          audioKindScrollWidth: audioKind.scrollWidth,
        },
        status: document.getElementById('long-message-status').textContent.trim(),
        count: document.getElementById('long-message-count').textContent.trim(),
        copyLabel: copy.textContent.trim(),
        copyAriaLabel: copy.getAttribute('aria-label'),
        copiedClass: copy.classList.contains('is-copied'),
        collapseLabel: collapse.textContent.trim(),
        focusedBody: document.activeElement === body,
        activeElementId: document.activeElement && document.activeElement.id || '',
        audio: {
          kindExists: Boolean(audioKind),
          kindText: audioKind ? audioKind.textContent.trim() : '',
          buttonExists: Boolean(audio),
          hidden: audio ? audio.hidden : true,
          display: audio ? getComputedStyle(audio).display : 'none',
          playing: audio ? audio.classList.contains('is-playing') : false,
          ariaPressed: audio ? audio.getAttribute('aria-pressed') : null,
          ariaLabel: audio ? audio.getAttribute('aria-label') : null,
          title: audio ? audio.title : '',
        },
      },
      bubble: {
        visible: bubble.classList.contains('is-visible'),
        text: bubble.message || '',
        label: bubble.label || '',
        expandable: bubble.expandable,
        expanded: bubble.expanded,
        expandHidden: bubbleExpand.hidden,
        expandAriaExpanded: bubbleExpand.getAttribute('aria-expanded'),
        messageFontSize: bubbleMessageStyle.fontSize,
      },
    }
  })()`)
}

async function readQAAudioPlaybackState() {
  return petWindow.webContents.executeJavaScript('structuredClone(window.__qaAudioPlaybackState)')
}

async function setControlledAudioPlayback(enabled) {
  return petWindow.webContents.executeJavaScript(`window.__qaUseControlledAudioPlayback(${Boolean(enabled)})`)
}

async function waitForQAAudioState(predicate, timeoutMs = 3000) {
  const startedAt = Date.now()
  let state = await readQAAudioPlaybackState()
  while (!predicate(state) && Date.now() - startedAt < timeoutMs) {
    await wait(30)
    state = await readQAAudioPlaybackState()
  }
  return { ...state, waitedMs: Date.now() - startedAt }
}

async function waitForLongMessageReady(timeoutMs = 4000) {
  const startedAt = Date.now()
  let state = null
  while (Date.now() - startedAt < timeoutMs) {
    state = await readLongMessageState(`wait-reader-ready:${Date.now() - startedAt}`)
    const revision = Number(state.reader.layoutRevision)
    const boundsRevision = Number(lastLongMessageBounds && lastLongMessageBounds.revision)
    if (
      state.reader.visible
      && Math.abs(state.reader.rect.width - LONG_MESSAGE_READER_WIDTH) <= 1
      && Math.abs(state.reader.rect.height - 520) <= 1
      && state.windowSize.width === PET_EXPANDED_HOST_WIDTH
      && revision > 0
      && boundsRevision === revision
    ) return { ...state, waitedMs: Date.now() - startedAt }
    await wait(40)
  }
  return { ...(state || {}), waitedMs: Date.now() - startedAt }
}

async function waitForLongMessageBodyText(expectedText, timeoutMs = 2000) {
  const startedAt = Date.now()
  let state = null
  while (Date.now() - startedAt < timeoutMs) {
    state = await readLongMessageState(`wait-reader-text:${Date.now() - startedAt}`)
    if (state.reader.visible && state.reader.bodyText === expectedText) {
      return { ...state, waitedMs: Date.now() - startedAt }
    }
    await wait(30)
  }
  return { ...(state || {}), waitedMs: Date.now() - startedAt }
}

async function waitForLongMessageClosed(layoutCallStart, boundsReportStart, timeoutMs = 4000) {
  const startedAt = Date.now()
  let state = null
  while (Date.now() - startedAt < timeoutMs) {
    state = await readLongMessageState(`wait-reader-closed:${Date.now() - startedAt}`)
    const closeRequested = longMessageLayoutCalls.slice(layoutCallStart).some(call => call.payload.open === false)
    const reports = longMessageBoundsReports.slice(boundsReportStart)
    if (
      state.reader.hidden
      && !state.reader.visible
      && state.windowSize.width === PET_COLLAPSED_HOST_WIDTH
      && closeRequested
      && reports.length > 0
      && reports.at(-1) === null
      && lastLongMessageBounds === null
    ) return { ...state, waitedMs: Date.now() - startedAt }
    await wait(40)
  }
  return { ...(state || {}), waitedMs: Date.now() - startedAt }
}

async function waitForLongMessageTransitionSettled(callStart, timeoutMs = 2000) {
  const startedAt = Date.now()
  let calls = []
  while (Date.now() - startedAt < timeoutMs) {
    calls = longMessageTransitionCalls.slice(callStart)
    if (calls.some(call => call.active) && calls.at(-1).active === false) return calls
    await wait(20)
  }
  return calls
}

async function waitForLongMessageTransitionFrameSamples(sampleStart, minimum = 4, timeoutMs = 2000) {
  const startedAt = Date.now()
  let samples = []
  while (Date.now() - startedAt < timeoutMs) {
    samples = longMessageTransitionFrameSamples.slice(sampleStart)
    if (samples.length >= minimum) return samples
    await wait(20)
  }
  return samples
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
  await petWindow.webContents.executeJavaScript(`document.getElementById('pet-stage').classList.add('is-drag-hover', 'qa-force-detection-frame')`)
  await wait(250)
  const frameWithChat = await readState(`${theme}:single-detection-frame-with-chat`)
  let frameScreenshot = ''
  let detectionFrameAlpha = { borderEdge: 0, emptyInterior: 0 }
  // Transparent GPU windows occasionally return a stale fully transparent
  // capture even though computed style and the next compositor frame are
  // correct. Retry the visual sample instead of turning that capture race into
  // an unrelated failure for the message-layout suite.
  for (let attempt = 0; attempt < 3 && detectionFrameAlpha.borderEdge === 0; attempt++) {
    if (attempt > 0) {
      await petWindow.webContents.executeJavaScript(`(() => {
        const stage = document.getElementById('pet-stage')
        stage.classList.remove('qa-force-detection-frame')
        void stage.offsetWidth
        stage.classList.add('qa-force-detection-frame')
      })()`)
      await wait(180)
    }
    frameScreenshot = await capture(`${theme}-single-detection-frame.png`)
    detectionFrameAlpha = await alphaAtImagePoints(frameScreenshot, {
      borderEdge: [0, 300],
      emptyInterior: [3, 300],
    })
    if (detectionFrameAlpha.borderEdge === 0) await wait(120)
  }

  await petWindow.webContents.executeJavaScript(`document.getElementById('pet-stage').classList.add('is-dragging')`)
  const draggingFrame = await readState(`${theme}:dragging-detection-frame`)
  await petWindow.webContents.executeJavaScript(`document.getElementById('pet-stage').classList.remove('is-dragging')`)

  await setSnapshot({ backgroundDetection: false })
  await petWindow.webContents.executeJavaScript(`document.getElementById('pet-stage').classList.remove('qa-force-detection-frame')`)
  const frameDisabled = await readState(`${theme}:detection-disabled-chat-open`)
  petWindow.webContents.send('ai:chat-visibility', false)

  const uniform = value => new Set(value).size === 1
  const expectedExpandedHeight = theme === 'healing' ? 268 : 246
  const assertions = {
    opensCollapsed: initial.chat.collapsed && initial.chat.ariaExpanded === 'false' && Math.abs(initial.chat.rect.height - 64) <= 1,
    hoverDoesNotExpand: afterHover.chat.collapsed && Math.abs(afterHover.chat.rect.height - 64) <= 1,
    clickExpands: !expanded.chat.collapsed && expanded.chat.ariaExpanded === 'true' && expanded.chat.rect.height === expectedExpandedHeight,
    appMessagesDoNotRenderSourceOrigin: expanded.chat.appMessageCount > 0
      && expanded.chat.appSourceBadgeCount === 0
      && expanded.chat.appOriginCount === 0,
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
      && frameWithChat.detectionFrame.inset.every(value => value === '0px')
      && frameWithChat.detectionFrame.backgroundColor === 'rgba(0, 0, 0, 0)'
      && frameWithChat.detectionFrame.backgroundImage === 'none'
      && frameWithChat.detectionFrame.boxShadow === 'none',
    detectionFrameTouchesWindowEdgeWithoutPaintingItsInterior: detectionFrameAlpha.borderEdge > 0
      && detectionFrameAlpha.emptyInterior === 0
      && draggingFrame.detectionFrame.backgroundColor === 'rgba(0, 0, 0, 0)'
      && draggingFrame.detectionFrame.backgroundImage === 'none'
      && draggingFrame.detectionFrame.boxShadow === 'none',
    chatDoesNotChangeDetectionFrame: frameWithChat.bodyBefore.content === 'none' && !frameWithChat.rootClasses.includes('has-ai-chat'),
    noFrameWhenDetectionDisabled: frameDisabled.detectionFrame.opacity === '0' && !frameDisabled.stageClasses.includes('has-background-detection'),
  }

  return {
    theme,
    modelReady: Boolean(lastModelStatus && lastModelStatus.phase === 'ready'),
    lastHitBounds,
    states: { initial, afterHover, expanded, afterLeave, collapsedAgain, frameWithChat, draggingFrame, frameDisabled },
    detectionFrameAlpha,
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
  const sourceStates = {}
  const screenshots = {}
  const styleIds = ['glass', 'sweet', 'pixel', 'sci-fi']
  const expectedWidths = { glass: 270, sweet: 264, pixel: 270, 'sci-fi': 278 }
  petWindow.webContents.send('ai:chat-visibility', false)
  await waitForBubbleVisibility(false, 5000)

  for (const theme of ['glass', 'healing']) {
    states[theme] = {}
    sourceStates[theme] = {}
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
      await petWindow.webContents.executeJavaScript("document.getElementById('interaction-bubble').source = 'external'")
      sourceStates[theme][styleId] = await readBubble(`bubble-source-marker:${theme}:${styleId}`)
      await petWindow.webContents.executeJavaScript("document.getElementById('interaction-bubble').source = ''")
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
  const allSourceStates = Object.values(sourceStates).flatMap(themeStates => Object.values(themeStates))
  const boxesOverlap = (a, b) => a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0
    && a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y
  const styleGeometryValid = allStates.every(state => state.visible && centered(state)
    && Math.abs(state.rect.width - expectedWidths[state.styleName]) <= 1
    && Math.abs(state.rect.y - 20) <= 1 && state.rect.right <= 394
    && state.textLineClamp === '3' && titleIsAttached(state))
  const selectionsApplied = ['glass', 'healing'].every(theme => styleIds.every(styleId => (
    states[theme][styleId].theme === theme
    && states[theme][styleId].bubbleTheme === theme
    && states[theme][styleId].styleName === styleId
  )))
  const styleSignature = state => [state.backgroundImage, state.borderRadius, state.clipPath, state.titleBackgroundImage].join('|')
  const assertions = {
    allEightThemeStyleCombinationsRender: allStates.length === 8 && styleGeometryValid && selectionsApplied,
    appBubbleOmitsExternalMarker: allStates.every(state => state.source === ''
      && state.sourceHidden && state.sourceDisplay === 'none'),
    externalMarkerIsLightweightAcrossStyles: allSourceStates.length === 8
      && allSourceStates.every(state => state.source === 'external'
        && state.sourceText === '外部'
        && !state.sourceHidden
        && state.sourceDisplay !== 'none'
        && Number(state.sourceOpacity) <= .7
        && state.sourceBackgroundColor === 'rgba(0, 0, 0, 0)'
        && state.sourceBorderTopWidth === '0px'
        && state.sourceBoxShadow === 'none'
        && !boxesOverlap(state.sourceRect, state.titleRect)
        && !boxesOverlap(state.sourceRect, state.messageRect)),
    glassGeometryMatchesReference: glass.visible && centered(glass)
      && Math.abs(glass.rect.width - 270) <= 1 && Math.abs(glass.rect.y - 20) <= 1
      && glass.rect.height >= 70 && glass.rect.right <= 388,
    glassLabelMatchesReference: glass.titleText === 'hiyori' && titleIsAttached(glass)
      && glass.titleTransform !== 'none' && glass.titleHeartDisplay === 'none',
    glassDecorMatchesReference: glass.secondaryPawDisplay === 'none'
      && glass.tailBottom === '-11px' && glass.textLineClamp === '3',
    healingGeometryMatchesReference: healing.visible && centered(healing)
      && Math.abs(healing.rect.width - 270) <= 1 && Math.abs(healing.rect.y - 20) <= 1
      && healing.rect.height >= 70 && healing.rect.right <= 388,
    healingLabelMatchesReference: healing.titleText === 'hiyori' && titleIsAttached(healing)
      && healing.titleTransform === 'none' && healing.titleHeartDisplay !== 'none',
    healingDecorMatchesReference: healing.secondaryPawDisplay !== 'none'
      && healing.tailBottom === '-11px' && healing.textLineClamp === '3',
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
    sourceStates,
    screenshots,
    assertions,
    passed: Object.values(assertions).every(Boolean),
  }
}

async function waitForLongMessageAudioState(playing, minimumInputCalls, minimumStopCalls, timeoutMs = 3000) {
  const startedAt = Date.now()
  let readerState = null
  let playbackState = null
  while (Date.now() - startedAt < timeoutMs) {
    readerState = await readLongMessageState(`wait-reader-audio:${playing}:${Date.now() - startedAt}`)
    playbackState = await readQAAudioPlaybackState()
    const playbackMatches = playing
      ? readerState.reader.audio.playing
        && readerState.reader.audio.ariaPressed === 'true'
        && playbackState.pending
      : !readerState.reader.audio.playing
        && readerState.reader.audio.ariaPressed === 'false'
        && !playbackState.pending
    if (
      playbackMatches
      && playbackState.inputCalls.length >= minimumInputCalls
      && playbackState.stopCalls >= minimumStopCalls
    ) {
      return { readerState, playbackState, waitedMs: Date.now() - startedAt }
    }
    await wait(30)
  }
  return { readerState, playbackState, waitedMs: Date.now() - startedAt }
}

async function normalizeLongMessageAudioStopped() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const readerState = await readLongMessageState(`reader-audio-normalize:${attempt}`)
    const playbackState = await readQAAudioPlaybackState()
    if (!readerState.reader.audio.playing && !playbackState.pending) {
      return { readerState, playbackState, attempts: attempt }
    }
    await petWindow.webContents.executeJavaScript(`document.getElementById('long-message-audio').click()`)
    await wait(80)
  }
  const readerState = await readLongMessageState('reader-audio-normalize:final')
  const playbackState = await readQAAudioPlaybackState()
  return { readerState, playbackState, attempts: 2 }
}

async function exerciseLongMessageAudioControl(source, text, preview, automaticPlayback) {
  const layoutCallStart = longMessageLayoutCalls.length
  const boundsReportStart = longMessageBoundsReports.length
  await petWindow.webContents.executeJavaScript(`(() => {
    document.getElementById('interaction-bubble').shadowRoot.querySelector('.message-expand').click()
  })()`)
  const opened = await waitForLongMessageReady(4000)
  const readyScreenshot = await capture(`long-message-audio-${source}-ready.png`)
  const normalized = await normalizeLongMessageAudioStopped()

  const beforeStart = await readQAAudioPlaybackState()
  await petWindow.webContents.executeJavaScript(`document.getElementById('long-message-audio').click()`)
  const playing = await waitForLongMessageAudioState(
    true,
    beforeStart.inputCalls.length + 1,
    beforeStart.stopCalls,
    3000
  )

  const beforeSecondClick = await readQAAudioPlaybackState()
  await petWindow.webContents.executeJavaScript(`document.getElementById('long-message-audio').click()`)
  const stopped = await waitForLongMessageAudioState(
    false,
    beforeSecondClick.inputCalls.length,
    beforeSecondClick.stopCalls + 1,
    3000
  )

  const beforeRestart = await readQAAudioPlaybackState()
  await petWindow.webContents.executeJavaScript(`document.getElementById('long-message-audio').click()`)
  const playingBeforeCollapse = await waitForLongMessageAudioState(
    true,
    beforeRestart.inputCalls.length + 1,
    beforeRestart.stopCalls,
    3000
  )
  const playingScreenshot = await capture(`long-message-audio-${source}-playing.png`)

  const beforeCollapse = await readQAAudioPlaybackState()
  const lipSyncPrimed = await petWindow.webContents.executeJavaScript('window.__qaPrimeLipSyncState()')
  await petWindow.webContents.executeJavaScript(`document.getElementById('long-message-collapse').click()`)
  await waitForLongMessageClosed(layoutCallStart, boundsReportStart, 4000)
  const stoppedByCollapse = await waitForLongMessageAudioState(
    false,
    beforeCollapse.inputCalls.length,
    beforeCollapse.stopCalls + 1,
    3000
  )
  const closed = await readLongMessageState(`long-message-audio:${source}:closed`)
  const lipSyncAfterCollapse = await petWindow.webContents.executeJavaScript('window.__qaReadLipSyncState()')
  await setControlledAudioPlayback(false)

  const lastManualInput = playing.playbackState.inputCalls.at(-1)
  const assertions = {
    realSourceCreatesExpandableLongBubble: preview.visible
      && preview.expandable
      && preview.text === text,
    sourceMarkerMatchesMessageOrigin: source === 'external'
      ? preview.source === 'external'
        && preview.sourceText === '外部'
        && !preview.sourceHidden
        && opened.reader.source.value === 'external'
        && opened.reader.source.text === '外部'
        && !opened.reader.source.hidden
        && opened.reader.source.display !== 'none'
      : preview.source === ''
        && preview.sourceHidden
        && opened.reader.source.value === ''
        && opened.reader.source.hidden
        && opened.reader.source.display === 'none',
    sourceAudioReachedModelAutomatically: automaticPlayback.inputCalls.length > 0
      && automaticPlayback.pending,
    speechMetadataAppearsInReader: opened.reader.audio.kindExists
      && opened.reader.audio.kindText === '语音消息'
      && opened.reader.audio.buttonExists
      && !opened.reader.audio.hidden
      && opened.reader.audio.display !== 'none',
    playbackCanBeNormalizedBeforeManualCheck: !normalized.readerState.reader.audio.playing
      && normalized.readerState.reader.audio.ariaPressed === 'false'
      && !normalized.playbackState.pending,
    firstClickUsesModelInputAudio: playing.readerState.reader.audio.playing
      && playing.readerState.reader.audio.ariaPressed === 'true'
      && playing.readerState.reader.audio.ariaLabel === '停止播放这条语音'
      && playing.readerState.reader.audio.title === '停止播放这条语音'
      && playing.playbackState.pending
      && lastManualInput
      && lastManualInput.byteLength > 44
      && lastManualInput.playAudio === true,
    secondClickStopsPlayback: !stopped.readerState.reader.audio.playing
      && stopped.readerState.reader.audio.ariaPressed === 'false'
      && stopped.readerState.reader.audio.ariaLabel === '播放这条语音'
      && stopped.readerState.reader.audio.title === '播放这条语音'
      && !stopped.playbackState.pending
      && stopped.playbackState.stopCalls >= beforeSecondClick.stopCalls + 1,
    playbackCanRestart: playingBeforeCollapse.readerState.reader.audio.playing
      && playingBeforeCollapse.playbackState.pending
      && playingBeforeCollapse.playbackState.inputCalls.length >= beforeRestart.inputCalls.length + 1,
    collapseStopsAndResetsPlayback: closed.reader.hidden
      && !closed.reader.audio.playing
      && closed.reader.audio.ariaPressed === 'false'
      && closed.reader.audio.ariaLabel === '播放这条语音'
      && !stoppedByCollapse.playbackState.pending
      && stoppedByCollapse.playbackState.stopCalls >= beforeCollapse.stopCalls + 1,
    collapseClearsLipSyncState: lipSyncPrimed
      && lipSyncAfterCollapse
      && lipSyncAfterCollapse.samplesCleared
      && lipSyncAfterCollapse.sampleOffset === 0
      && lipSyncAfterCollapse.samplesPerChannel === 0
      && lipSyncAfterCollapse.userTime === 0
      && lipSyncAfterCollapse.previousRms === 0
      && lipSyncAfterCollapse.rms === 0,
  }
  return {
    source,
    text,
    states: {
      preview,
      opened,
      normalized,
      playing,
      stopped,
      playingBeforeCollapse,
      stoppedByCollapse,
      closed,
      lipSyncPrimed,
      lipSyncAfterCollapse,
    },
    playbackBaselines: { automaticPlayback, beforeStart, beforeSecondClick, beforeRestart, beforeCollapse },
    screenshots: { readyScreenshot, playingScreenshot },
    assertions,
    passed: Object.values(assertions).every(Boolean),
  }
}

async function runLongMessageAudio() {
  const appText = Array.from({ length: 5 }, (_, index) => (
    `APP 语音长消息第${index + 1}段：窗外的风轻轻经过，狐耳妹妹把今天发生的有趣小事慢慢讲给你听。`
  )).join('\n\n')
  const externalText = Array.from({ length: 5 }, (_, index) => (
    `外部语音长消息第${index + 1}段：远方服务送来一段完整回复，既保留全部文字，也携带可以再次播放的声音。`
  )).join('\n\n')
  const originalReplyText = aiMockState.replyText
  const sources = []

  await setSnapshot({
    settingsTheme: 'glass',
    bubbleStyles: { ...snapshot.preferences.bubbleStyles, glass: 'glass' },
  })
  petWindow.webContents.send('ai:chat-visibility', true)
  await wait(120)
  await petWindow.webContents.executeJavaScript(`(() => {
    const mute = document.getElementById('ai-chat-mute')
    if (mute.getAttribute('aria-pressed') === 'true') mute.click()
  })()`)
  await setControlledAudioPlayback(true)
  const appAudioBaseline = await readQAAudioPlaybackState()
  aiMockState.chatDelayMs = 0
  aiMockState.speechDelayMs = 0
  aiMockState.replyText = appText
  await petWindow.webContents.executeJavaScript(`(() => {
    const input = document.getElementById('ai-chat-input')
    input.value = '请返回一条可展开的 APP 语音长消息'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.getElementById('ai-chat-form').requestSubmit()
  })()`)
  await waitForBubbleText(appText, 3000)
  const appPreview = await waitForBubbleExpandable(true, 1800)
  const appAutomaticPlayback = await waitForQAAudioState(
    state => state.inputCalls.length >= appAudioBaseline.inputCalls.length + 1 && state.pending,
    3000
  )
  sources.push(await exerciseLongMessageAudioControl('app', appText, appPreview, appAutomaticPlayback))
  petWindow.webContents.send('ai:chat-visibility', false)
  aiMockState.replyText = originalReplyText

  await setControlledAudioPlayback(true)
  const externalAudioBaseline = await readQAAudioPlaybackState()
  const externalMessage = {
    id: 'qa-long-message-external-audio',
    requestId: 'qa-long-message-external-audio-request',
    type: 'relay',
    content: '请返回一条可展开的外部语音长消息',
    speak: true,
    sender: 'QA 外部语音来源',
    source: 'external',
    sourceLabel: '外部',
    receivedAt: new Date().toISOString(),
  }
  petWindow.webContents.send('external-message:event', {
    phase: 'received',
    stage: 'speech',
    progressText: '语音合成中…',
    transient: true,
    message: externalMessage,
  })
  await wait(80)
  petWindow.webContents.send('external-message:event', {
    phase: 'completed',
    message: externalMessage,
    result: {
      text: externalText,
      emotion: 'calm',
      aiGenerated: true,
      speech: {
        requested: true,
        status: 'ready',
        audioBase64: silentWavBase64,
        mimeType: 'audio/wav',
      },
      completedAt: new Date().toISOString(),
    },
  })
  await waitForBubbleText(externalText, 3000)
  const externalPreview = await waitForBubbleExpandable(true, 1800)
  const externalAutomaticPlayback = await waitForQAAudioState(
    state => state.inputCalls.length >= externalAudioBaseline.inputCalls.length + 1 && state.pending,
    3000
  )
  sources.push(await exerciseLongMessageAudioControl(
    'external',
    externalText,
    externalPreview,
    externalAutomaticPlayback
  ))

  // Leave later acceptance scenarios with no external-priority lease. The
  // speech test intentionally cancels playback when the reader collapses, so
  // the original 65-second voice lease no longer has an onComplete callback
  // that can release it. Replacing it with a short non-voice message exercises
  // the public event path and lets the normal two-second lease expire.
  const cleanupMessage = {
    ...externalMessage,
    id: 'qa-long-message-audio-cleanup',
    requestId: 'qa-long-message-audio-cleanup-request',
    type: 'direct',
    content: '好',
    speak: false,
  }
  petWindow.webContents.send('external-message:event', { phase: 'received', message: cleanupMessage })
  await waitForBubbleText(cleanupMessage.content, 1000)
  petWindow.webContents.send('external-message:event', {
    phase: 'completed',
    message: cleanupMessage,
    result: {
      text: cleanupMessage.content,
      emotion: '',
      aiGenerated: false,
      speech: { requested: false, status: 'disabled' },
      completedAt: new Date().toISOString(),
    },
  })
  const cleanup = await waitForBubbleVisibility(false, 3000)

  return {
    sources,
    assertions: {
      appLongReplyCarriesReplayableSpeech: sources[0].passed,
      externalLongReplyCarriesReplayableSpeech: sources[1].passed,
      externalAudioLeaseReturnsToIdle: !cleanup.visible,
    },
    cleanup,
    passed: sources.every(source => source.passed) && !cleanup.visible,
  }
}

async function runLongMessageAutoExpand() {
  const appText = Array.from({ length: 7 }, (_, index) => (
    `APP 自动展开验收第${index + 1}段：这是一条会超出宠物气泡三行高度的最终回复，用来确认 APP 开关只影响应用内对话。`
  )).join('\n\n')
  const externalText = Array.from({ length: 7 }, (_, index) => (
    `外部自动展开验收第${index + 1}段：这是一条来自外部接口的长消息，用来确认外部开关不会改变 APP 回复的展示策略。`
  )).join('\n\n')
  const shortExternalText = '外部短消息不需要展开。'
  const shortVoiceText = '你好哇主人～我是大肥鱼，今天也会乖乖守在桌边陪你，要不要一起聊聊天？'
  const originalAIState = { ...aiMockState }
  const states = {}
  const screenshots = {}
  let externalSequence = 0

  const capacityCalibration = await petWindow.webContents.executeJavaScript(`(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready
    const viewport = document.getElementById('pet-viewport')
    const capacities = []
    for (const theme of ['glass', 'healing']) {
      for (const styleName of ['glass', 'sweet', 'pixel', 'sci-fi']) {
        const probe = document.createElement('pet-speech-bubble')
        probe.className = 'interaction-bubble-widget'
        probe.setAttribute('theme', theme)
        probe.setAttribute('style-name', styleName)
        probe.style.visibility = 'hidden'
        probe.style.pointerEvents = 'none'
        viewport.appendChild(probe)
        let capacity = 0
        for (let characterCount = 1; characterCount <= 120; characterCount += 1) {
          probe.message = '测'.repeat(characterCount)
          if (probe.measureOverflow()) break
          capacity = characterCount
        }
        capacities.push({ theme, styleName, capacity })
        probe.remove()
      }
    }
    return {
      capacities,
      minimum: Math.min(...capacities.map(item => item.capacity)),
    }
  })()`)

  const sendExternal = async (text, label) => {
    externalSequence += 1
    const message = {
      id: `qa-auto-expand-${externalSequence}`,
      requestId: `qa-auto-expand-request-${externalSequence}`,
      type: 'relay',
      content: `QA ${label}`,
      speak: false,
      sender: 'QA 外部来源',
      source: 'external',
      sourceLabel: '外部',
      receivedAt: new Date().toISOString(),
    }
    await petWindow.webContents.executeJavaScript(`(() => {
      if (window.__qaAutoExpandObserver) window.__qaAutoExpandObserver.disconnect()
      const bubble = document.getElementById('interaction-bubble')
      window.__qaAutoExpandVisibilitySamples = []
      const record = () => window.__qaAutoExpandVisibilitySamples.push({
        text: bubble.message || '',
        visible: bubble.classList.contains('is-visible'),
      })
      window.__qaAutoExpandObserver = new MutationObserver(record)
      window.__qaAutoExpandObserver.observe(bubble, {
        attributes: true,
        attributeFilter: ['class', 'message'],
      })
      record()
    })()`)
    petWindow.webContents.send('external-message:event', {
      phase: 'received',
      stage: 'thinking',
      progressText: '思考中…',
      transient: true,
      message,
    })
    await waitForBubbleText('思考中…', 1200)
    const received = await readLongMessageState(`${label}:received`)
    petWindow.webContents.send('external-message:event', {
      phase: 'completed',
      message,
      result: {
        text,
        emotion: 'calm',
        aiGenerated: true,
        speech: { requested: false, status: 'disabled' },
        completedAt: new Date().toISOString(),
      },
    })
    const bubble = await waitForBubbleMessage(text, 1800)
    const expandable = await waitForBubbleExpandable(text !== shortExternalText, 1800)
    const visibilitySamples = await petWindow.webContents.executeJavaScript(`(() => {
      if (window.__qaAutoExpandObserver) window.__qaAutoExpandObserver.disconnect()
      window.__qaAutoExpandObserver = null
      return structuredClone(window.__qaAutoExpandVisibilitySamples || [])
    })()`)
    return { message, received, bubble, expandable, visibilitySamples }
  }

  const sendDirectExternal = async (text, label, expectLongMessage = true) => {
    externalSequence += 1
    const message = {
      id: `qa-auto-expand-direct-${externalSequence}`,
      requestId: `qa-auto-expand-direct-request-${externalSequence}`,
      type: 'direct',
      content: text,
      speak: false,
      sender: 'QA 外部直发来源',
      source: 'external',
      sourceLabel: '外部',
      receivedAt: new Date().toISOString(),
    }
    await petWindow.webContents.executeJavaScript(`(() => {
      if (window.__qaAutoExpandObserver) window.__qaAutoExpandObserver.disconnect()
      const bubble = document.getElementById('interaction-bubble')
      window.__qaAutoExpandVisibilitySamples = []
      const record = () => window.__qaAutoExpandVisibilitySamples.push({
        text: bubble.message || '',
        visible: bubble.classList.contains('is-visible'),
      })
      window.__qaAutoExpandObserver = new MutationObserver(record)
      window.__qaAutoExpandObserver.observe(bubble, {
        attributes: true,
        attributeFilter: ['class', 'message'],
      })
      record()
    })()`)
    petWindow.webContents.send('external-message:event', {
      phase: 'received',
      stage: 'display',
      progressText: '',
      transient: false,
      message,
    })
    const bubble = await waitForBubbleMessage(text, 1800)
    const expandable = await waitForBubbleExpandable(expectLongMessage, 1800)
    const openedAtReceived = expectLongMessage
      ? await waitForLongMessageReady(4000)
      : await readLongMessageState(`${label}:received-short`)
    petWindow.webContents.send('external-message:event', {
      phase: 'completed',
      message,
      result: {
        text,
        emotion: '',
        aiGenerated: false,
        speech: { requested: false, status: 'disabled' },
        completedAt: new Date().toISOString(),
      },
    })
    let completed
    if (expectLongMessage) {
      completed = await waitForLongMessageBodyText(text, 2400)
    } else {
      await wait(100)
      completed = await readLongMessageState(`${label}:completed-short`)
    }
    const visibilitySamples = await petWindow.webContents.executeJavaScript(`(() => {
      if (window.__qaAutoExpandObserver) window.__qaAutoExpandObserver.disconnect()
      window.__qaAutoExpandObserver = null
      return structuredClone(window.__qaAutoExpandVisibilitySamples || [])
    })()`)
    return { message, bubble, expandable, openedAtReceived, completed, visibilitySamples }
  }

  const submitApp = async (prompt, text) => {
    aiMockState.chatDelayMs = 0
    aiMockState.speechDelayMs = 0
    aiMockState.replyText = text
    await petWindow.webContents.executeJavaScript(`(() => {
      if (window.__qaAutoExpandObserver) window.__qaAutoExpandObserver.disconnect()
      const bubble = document.getElementById('interaction-bubble')
      window.__qaAutoExpandVisibilitySamples = []
      const record = () => window.__qaAutoExpandVisibilitySamples.push({
        text: bubble.message || '',
        visible: bubble.classList.contains('is-visible'),
      })
      window.__qaAutoExpandObserver = new MutationObserver(record)
      window.__qaAutoExpandObserver.observe(bubble, {
        attributes: true,
        attributeFilter: ['class', 'message'],
      })
      record()
      const input = document.getElementById('ai-chat-input')
      input.value = ${JSON.stringify(prompt)}
      input.dispatchEvent(new Event('input', { bubbles: true }))
      document.getElementById('ai-chat-form').requestSubmit()
    })()`)
    const bubble = await waitForBubbleMessage(text, 2200)
    const expandable = await waitForBubbleExpandable(true, 1800)
    const visibilitySamples = await petWindow.webContents.executeJavaScript(`(() => {
      if (window.__qaAutoExpandObserver) window.__qaAutoExpandObserver.disconnect()
      window.__qaAutoExpandObserver = null
      return structuredClone(window.__qaAutoExpandVisibilitySamples || [])
    })()`)
    return { bubble, expandable, visibilitySamples }
  }

  const closeReader = async label => {
    const layoutCallStart = longMessageLayoutCalls.length
    const boundsReportStart = longMessageBoundsReports.length
    await petWindow.webContents.executeJavaScript(`document.getElementById('long-message-collapse').click()`)
    return waitForLongMessageClosed(layoutCallStart, boundsReportStart, 4000).then(closed => ({ ...closed, label }))
  }

  const manuallyOpenAndClose = async label => {
    await petWindow.webContents.executeJavaScript(`document.getElementById('interaction-bubble').shadowRoot.querySelector('.message-expand').click()`)
    const opened = await waitForLongMessageReady(4000)
    const closed = await closeReader(label)
    return { opened, closed }
  }

  await setSnapshot({
    settingsTheme: 'glass',
    interactionMode: 'smart',
    longMessageCharacterThreshold: DEFAULT_LONG_MESSAGE_CHARACTER_THRESHOLD,
    appLongMessageAutoExpand: false,
    externalLongMessageAutoExpand: false,
  })
  petWindow.webContents.send('ai:chat-visibility', false)
  await wait(140)

  states.defaultExternal = await sendExternal(externalText, 'default-external')
  await wait(360)
  states.defaultExternal.afterFinal = await readLongMessageState('default-external:after-final')
  states.defaultExternal.manual = await manuallyOpenAndClose('default-external:manual-close')

  await setSnapshot({ appLongMessageAutoExpand: false, externalLongMessageAutoExpand: true })
  states.externalEnabled = await sendExternal(externalText, 'external-enabled')
  states.externalEnabled.opened = await waitForLongMessageReady(4000)
  screenshots.externalEnabled = await capture('long-message-auto-external.png')
  states.externalEnabled.closed = await closeReader('external-enabled:close')

  states.directExternalFirst = await sendDirectExternal(externalText, 'direct-external-first')
  screenshots.directExternalGlass = await capture('long-message-auto-direct-external-glass.png')
  states.directExternalFirst.closed = await closeReader('direct-external-first:close')

  await setSnapshot({
    settingsTheme: 'healing',
    appLongMessageAutoExpand: false,
    externalLongMessageAutoExpand: true,
  })
  await wait(140)
  states.directExternalAfterCollapse = await sendDirectExternal(externalText, 'direct-external-after-collapse')
  screenshots.directExternalHealing = await capture('long-message-auto-direct-external-healing-after-collapse.png')
  states.directExternalAfterCollapse.closed = await closeReader('direct-external-after-collapse:close')
  await setSnapshot({ settingsTheme: 'glass' })
  await wait(140)

  const exactThresholdText = '测'.repeat(DEFAULT_LONG_MESSAGE_CHARACTER_THRESHOLD)
  const raisedThresholdText = `${'测'.repeat(DEFAULT_LONG_MESSAGE_CHARACTER_THRESHOLD)}高`
  const overThresholdText = `${'测'.repeat(DEFAULT_LONG_MESSAGE_CHARACTER_THRESHOLD)}界`
  states.exactThreshold = await sendDirectExternal(exactThresholdText, 'exact-threshold', false)
  await setSnapshot({ longMessageCharacterThreshold: DEFAULT_LONG_MESSAGE_CHARACTER_THRESHOLD + 15 })
  states.raisedThreshold = await sendDirectExternal(raisedThresholdText, 'raised-threshold', false)
  await setSnapshot({ longMessageCharacterThreshold: DEFAULT_LONG_MESSAGE_CHARACTER_THRESHOLD })
  states.overThreshold = await sendDirectExternal(overThresholdText, 'over-threshold')
  screenshots.thresholdBoundary = await capture('long-message-auto-threshold-boundary.png')
  states.overThreshold.closed = await closeReader('over-threshold:close')

  petWindow.webContents.send('ai:chat-visibility', false)
  await wait(100)
  petWindow.webContents.send('ai:chat-visibility', true)
  await wait(180)
  states.appDisabled = await submitApp('请返回 APP 长消息，但不要自动展开', appText)
  await wait(360)
  states.appDisabled.afterFinal = await readLongMessageState('app-disabled:after-final')
  states.appDisabled.manual = await manuallyOpenAndClose('app-disabled:manual-close')

  await setSnapshot({ appLongMessageAutoExpand: true, externalLongMessageAutoExpand: false })
  states.appEnabled = await submitApp('请返回会自动展开的 APP 长消息', appText)
  states.appEnabled.opened = await waitForLongMessageReady(4000)
  screenshots.appEnabled = await capture('long-message-auto-app.png')

  await setControlledAudioPlayback(true)
  const shortVoiceAudioBaseline = await readQAAudioPlaybackState()
  await petWindow.webContents.executeJavaScript(`(() => {
    const mute = document.getElementById('ai-chat-mute')
    if (mute.getAttribute('aria-pressed') === 'true') mute.click()
  })()`)
  aiMockState.chatDelayMs = 360
  aiMockState.speechDelayMs = 420
  aiMockState.replyText = shortVoiceText
  const replacementLayoutCallStart = longMessageLayoutCalls.length
  const replacementBoundsReportStart = longMessageBoundsReports.length
  await petWindow.webContents.executeJavaScript(`(() => {
    const input = document.getElementById('ai-chat-input')
    input.value = '长消息窗口打开时，请回复一条带语音的短消息'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.getElementById('ai-chat-form').requestSubmit()
  })()`)
  states.appEnabled.replacementClosed = await waitForLongMessageClosed(
    replacementLayoutCallStart,
    replacementBoundsReportStart,
    4000
  )
  states.appEnabled.thinking = await waitForBubbleText('思考中…', 1200)
  states.appEnabled.synthesizing = await waitForBubbleText('语音合成中…', 2400)
  states.appEnabled.shortFinal = await waitForBubbleText(shortVoiceText, 3000)
  states.appEnabled.shortExpandable = await waitForBubbleExpandable(false, 1800)
  states.appEnabled.shortFinalReader = await readLongMessageState('app-enabled:short-final')
  states.appEnabled.shortVoiceAudio = await waitForQAAudioState(
    state => state.inputCalls.length >= shortVoiceAudioBaseline.inputCalls.length + 1 && state.pending,
    3000
  )
  screenshots.appShortVoice = await capture('long-message-auto-app-short-voice-stays-bubble.png')
  await setControlledAudioPlayback(false)
  await petWindow.webContents.executeJavaScript(`(() => {
    const mute = document.getElementById('ai-chat-mute')
    if (mute.getAttribute('aria-pressed') === 'false') mute.click()
  })()`)
  await waitForBubbleVisibility(false, 3500)

  states.externalDisabled = await sendExternal(externalText, 'external-disabled')
  await wait(360)
  states.externalDisabled.afterFinal = await readLongMessageState('external-disabled:after-final')
  states.externalDisabled.manual = await manuallyOpenAndClose('external-disabled:manual-close')

  const collapsedBeforeFullChat = await readState('auto-expand:before-full-chat')
  if (collapsedBeforeFullChat.chat.collapsed) {
    await petWindow.webContents.executeJavaScript(`document.getElementById('ai-chat-toggle').click()`)
    await wait(220)
  }
  states.fullChatApp = await submitApp('完整聊天记录中不要重复展开', appText)
  await wait(360)
  states.fullChatApp.afterFinal = await readLongMessageState('full-chat-app:after-final')
  states.fullChatApp.chat = await readState('full-chat-app:chat-state')
  screenshots.fullChatApp = await capture('long-message-auto-app-full-chat-suppressed.png')
  states.fullChatApp.manual = await manuallyOpenAndClose('full-chat-app:manual-close')

  await setSnapshot({ appLongMessageAutoExpand: true, externalLongMessageAutoExpand: true })
  states.externalWithFullChat = await sendExternal(externalText, 'external-with-full-chat')
  states.externalWithFullChat.opened = await waitForLongMessageReady(4000)
  screenshots.externalWithFullChat = await capture('long-message-auto-external-with-full-chat.png')
  states.externalWithFullChat.closed = await closeReader('external-with-full-chat:close')

  states.shortExternal = await sendExternal(shortExternalText, 'short-external')
  await wait(360)
  states.shortExternal.afterFinal = await readLongMessageState('short-external:after-final')
  const cleanup = await waitForBubbleVisibility(false, 3500)

  petWindow.webContents.send('ai:chat-visibility', false)
  await setSnapshot({ appLongMessageAutoExpand: false, externalLongMessageAutoExpand: false })
  Object.assign(aiMockState, originalAIState)

  const assertions = {
    defaultsRemainOptIn: states.defaultExternal.afterFinal.reader.hidden
      && states.defaultExternal.afterFinal.bubble.expandable
      && states.defaultExternal.manual.opened.reader.visible
      && states.defaultExternal.manual.closed.reader.hidden,
    externalOpensOnlyAfterFinalResult: states.externalEnabled.received.reader.hidden
      && states.externalEnabled.opened.reader.visible
      && states.externalEnabled.opened.reader.bodyText === externalText
      && states.externalEnabled.opened.reader.source.value === 'external'
      && !states.externalEnabled.opened.reader.focusedBody
      && !states.externalEnabled.visibilitySamples.some(sample => sample.text === externalText && sample.visible)
      && states.externalEnabled.closed.reader.hidden,
    directExternalLongMessageOpensAtReceivedWithoutBubble: states.directExternalFirst.openedAtReceived.reader.visible
      && states.directExternalFirst.openedAtReceived.reader.bodyText === externalText
      && states.directExternalFirst.openedAtReceived.reader.source.value === 'external'
      && !states.directExternalFirst.visibilitySamples.some(sample => sample.text === externalText && sample.visible)
      && states.directExternalFirst.closed.reader.hidden,
    directExternalLongMessageStillBypassesBubbleAfterCollapse: states.directExternalAfterCollapse.openedAtReceived.reader.visible
      && states.directExternalAfterCollapse.openedAtReceived.reader.bodyText === externalText
      && states.directExternalAfterCollapse.openedAtReceived.theme === 'healing'
      && !states.directExternalAfterCollapse.visibilitySamples.some(sample => (
        sample.text === externalText && sample.visible
      ))
      && states.directExternalAfterCollapse.closed.reader.hidden,
    defaultThresholdMatchesSmallestBubbleCapacity: capacityCalibration.minimum === DEFAULT_LONG_MESSAGE_CHARACTER_THRESHOLD,
    thresholdBoundaryAndSettingControlClassification: states.exactThreshold.bubble.visible
      && !states.exactThreshold.expandable.expandable
      && states.exactThreshold.openedAtReceived.reader.hidden
      && states.raisedThreshold.bubble.visible
      && !states.raisedThreshold.expandable.expandable
      && states.raisedThreshold.openedAtReceived.reader.hidden
      && states.overThreshold.expandable.expandable
      && states.overThreshold.openedAtReceived.reader.visible
      && states.overThreshold.openedAtReceived.reader.bodyText === overThresholdText
      && !states.overThreshold.visibilitySamples.some(sample => sample.text === overThresholdText && sample.visible)
      && states.overThreshold.closed.reader.hidden,
    externalSwitchDoesNotEnableAppReplies: states.appDisabled.afterFinal.reader.hidden
      && states.appDisabled.afterFinal.bubble.expandable
      && states.appDisabled.manual.opened.reader.visible
      && states.appDisabled.manual.closed.reader.hidden,
    appSwitchOpensCollapsedChatReplyWithoutStealingFocus: states.appEnabled.opened.reader.visible
      && states.appEnabled.opened.reader.bodyText === appText
      && states.appEnabled.opened.reader.source.value === ''
      && !states.appEnabled.opened.reader.focusedBody
      && states.appEnabled.opened.reader.activeElementId === 'ai-chat-input'
      && !states.appEnabled.visibilitySamples.some(sample => sample.text === appText && sample.visible),
    appNewRequestClosesOldReaderAndKeepsProgressInBubble: states.appEnabled.replacementClosed.reader.hidden
      && states.appEnabled.thinking.visible
      && states.appEnabled.thinking.text === '思考中…'
      && states.appEnabled.synthesizing.visible
      && states.appEnabled.synthesizing.text === '语音合成中…',
    shortVoiceReplyNeverEntersLongMessageReader: states.appEnabled.shortFinal.visible
      && states.appEnabled.shortFinal.text === shortVoiceText
      && !states.appEnabled.shortExpandable.expandable
      && states.appEnabled.shortFinalReader.reader.hidden
      && states.appEnabled.shortFinalReader.reader.bodyText !== shortVoiceText
      && states.appEnabled.shortVoiceAudio.pending,
    appSwitchDoesNotEnableExternalMessages: states.externalDisabled.afterFinal.reader.hidden
      && states.externalDisabled.afterFinal.bubble.expandable
      && states.externalDisabled.manual.opened.reader.visible
      && states.externalDisabled.manual.closed.reader.hidden,
    expandedAppChatAvoidsRedundantReader: !states.fullChatApp.chat.chat.collapsed
      && states.fullChatApp.afterFinal.reader.hidden
      && states.fullChatApp.afterFinal.bubble.expandable
      && states.fullChatApp.manual.opened.reader.visible
      && states.fullChatApp.manual.closed.reader.hidden,
    externalSwitchStillWorksWhileAppChatIsExpanded: states.externalWithFullChat.received.reader.hidden
      && states.externalWithFullChat.opened.reader.visible
      && states.externalWithFullChat.opened.reader.bodyText === externalText
      && states.externalWithFullChat.opened.reader.source.value === 'external'
      && states.externalWithFullChat.closed.reader.hidden,
    shortMessagesNeverOpenReader: !states.shortExternal.expandable.expandable
      && states.shortExternal.afterFinal.reader.hidden
      && !cleanup.visible,
  }
  return {
    capacityCalibration,
    states,
    screenshots,
    cleanup,
    assertions,
    passed: Object.values(assertions).every(Boolean),
  }
}

async function runLongMessageReader() {
  const referenceText = Array.from({ length: 14 }, (_, index) => (
    `第${index + 1}段：小狐狸去买奶茶，店员问要几分糖。它认真地说：“全加吧，我糖分免疫力很强。”`
    + '结果只喝了一口，就被甜得尾巴都炸毛了。它抱着杯子蹲在路边，决定把剩下的快乐分享给朋友。'
  )).join('\n\n')
  const shortText = '短消息保持原样。'
  const expectedCharacterCount = Array.from(referenceText.replace(/\s/gu, '')).length
  const initialWindowBounds = petWindow.getBounds()
  const initialState = await readLongMessageState('long-message:initial')
  const noAudioMessage = {
    id: 'qa-long-message-no-audio',
    requestId: 'qa-long-message-no-audio-request',
    type: 'direct',
    content: referenceText,
    speak: false,
    sender: 'QA 无语音来源',
    source: 'external',
    sourceLabel: '外部',
    receivedAt: new Date().toISOString(),
  }
  petWindow.webContents.send('external-message:event', { phase: 'received', message: noAudioMessage })
  const seedBubble = await waitForBubbleText(referenceText, 1600)

  const themes = []
  for (const [themeIndex, theme] of ['glass', 'healing'].entries()) {
    await setSnapshot({
      settingsTheme: theme,
      bubbleStyles: { ...snapshot.preferences.bubbleStyles, [theme]: 'glass' },
    })
    if (themeIndex > 0) {
      petWindow.webContents.send('external-message:event', {
        phase: 'received',
        message: {
          ...noAudioMessage,
          id: `${noAudioMessage.id}-${theme}`,
          requestId: `${noAudioMessage.requestId}-${theme}`,
        },
      })
      await waitForBubbleText(referenceText, 1600)
    }
    const layoutCallStart = longMessageLayoutCalls.length
    const boundsReportStart = longMessageBoundsReports.length
    const copiedTextStart = copiedTexts.length

    await petWindow.webContents.executeJavaScript(`(() => {
      const bubble = document.getElementById('interaction-bubble')
      bubble.message = ${JSON.stringify(referenceText)}
    })()`)
    const preview = await waitForBubbleExpandable(true, 1800)
    const previewScreenshot = await capture(`long-message-${theme}-preview.png`)

    await petWindow.webContents.executeJavaScript(`(() => {
      document.getElementById('interaction-bubble').shadowRoot.querySelector('.message-expand').click()
    })()`)
    const opened = await waitForLongMessageReady(4000)
    const expandedWindowBounds = petWindow.getBounds()
    const reportedOpenBounds = lastLongMessageBounds ? structuredClone(lastLongMessageBounds) : null
    const readerScreenshot = await capture(`long-message-${theme}-reader.png`)
    const readerMidX = opened.reader.rect.x + opened.reader.rect.width / 2
    const readerMidY = opened.reader.rect.y + opened.reader.rect.height / 2
    const transparencyAlpha = await alphaAtImagePoints(readerScreenshot, {
      gapSide: [opened.reader.rect.x - LONG_MESSAGE_READER_GAP / 2, readerMidY],
      outerSide: [opened.reader.rect.right + LONG_MESSAGE_READER_EDGE / 2, readerMidY],
      above: [readerMidX, opened.reader.rect.y - 5],
      below: [readerMidX, opened.reader.rect.bottom + 5],
      readerSurface: [readerMidX, readerMidY],
    })
    const replacementText = `${referenceText}\n\n长文本保持展开时收到的新消息（${theme}）`
    const replacementMessage = {
      ...noAudioMessage,
      id: `qa-long-message-replacement-${theme}`,
      requestId: `qa-long-message-replacement-request-${theme}`,
      content: replacementText,
    }
    const replacementLayoutCallStart = longMessageLayoutCalls.length
    const replacementWindowBounds = petWindow.getBounds()
    petWindow.webContents.send('external-message:event', { phase: 'received', message: replacementMessage })
    const replacementReceived = await waitForLongMessageBodyText(replacementText)
    petWindow.webContents.send('external-message:event', {
      phase: 'completed',
      message: replacementMessage,
      result: {
        text: referenceText,
        emotion: '',
        aiGenerated: false,
        speech: { requested: false, status: 'disabled' },
        completedAt: new Date().toISOString(),
      },
    })
    const replacementCompleted = await waitForLongMessageBodyText(referenceText)
    const replacementWindowBoundsAfter = petWindow.getBounds()
    const replacementLayoutCalls = longMessageLayoutCalls.slice(replacementLayoutCallStart)
    await petWindow.webContents.executeJavaScript(`document.getElementById('long-message-reader').dataset.side = 'left'`)
    const leftSideTail = await readLongMessageState(`long-message:${theme}:left-side-tail`)
    await petWindow.webContents.executeJavaScript(`document.getElementById('long-message-reader').dataset.side = 'right'`)

    await petWindow.webContents.executeJavaScript(`(() => {
      const body = document.getElementById('long-message-reader-body')
      body.scrollTop = body.scrollHeight
      body.dispatchEvent(new Event('scroll'))
    })()`)
    await wait(100)
    const scrolled = await readLongMessageState(`long-message:${theme}:scrolled`)

    await petWindow.webContents.executeJavaScript(`document.getElementById('long-message-copy').click()`)
    await wait(100)
    const copied = await readLongMessageState(`long-message:${theme}:copied`)
    const copiedText = copiedTexts.length > copiedTextStart ? copiedTexts.at(-1) : null

    await petWindow.webContents.executeJavaScript(`document.getElementById('long-message-collapse').click()`)
    const closed = await waitForLongMessageClosed(layoutCallStart, boundsReportStart, 4000)
    const collapsedWindowBounds = petWindow.getBounds()
    const layoutCalls = longMessageLayoutCalls.slice(layoutCallStart)
    const boundsReports = longMessageBoundsReports.slice(boundsReportStart)
    const openLayout = layoutCalls.find(call => call.payload.open === true)?.layout || null
    if (openLayout) {
      // A delayed pre-collapse event must not resurrect the old expanded CSS
      // offsets after the newer close revision has already been applied.
      petWindow.webContents.send('pet:window-layout-changed', structuredClone(openLayout))
      await wait(80)
    }
    const afterStaleLayout = await readLongMessageState(`long-message:${theme}:after-stale-layout`)
    const validBounds = bounds => Boolean(
      bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)
      && Number.isFinite(bounds.width) && Number.isFinite(bounds.height)
      && bounds.width > 0 && bounds.height > 0
    )
    const onlyInsetShadows = value => {
      const shadowLayers = (value.match(/rgba?\(/g) || []).length
      const insetLayers = (value.match(/\binset\b/g) || []).length
      return shadowLayers === 2 && insetLayers === shadowLayers
    }
    const assertions = {
      threeLinePreviewKeepsFullText: preview.visible
        && preview.text === referenceText
        && preview.textLineClamp === '3'
        && preview.textScrollHeight > preview.textClientHeight + 1,
      expandControlOnlyAppearsForOverflow: preview.expandable
        && !preview.expandHidden
        // Absolutely positioned inline-flex controls are blockified to `flex`
        // by Chromium's computed style; a non-none box is the stable contract.
        && preview.expandDisplay !== 'none'
        && preview.expandAriaExpanded === 'false'
        && preview.expandLabel === '展开全文',
      expandControlOverlaysThirdLineEnd: preview.expandOverlapsThirdLine
        && Math.abs(preview.expandRightGap - 18) <= 1
        && Math.abs(preview.expandBottomGap - 8) <= 1,
      readerOpensWithAccessibleDialogSemantics: opened.reader.visible
        && !opened.reader.hidden
        && opened.reader.role === 'dialog'
        && opened.reader.ariaModal === 'false'
        && opened.reader.focusedBody,
      originalBubbleHidesWhileReaderOpen: !opened.bubble.visible
        && opened.bubble.expanded
        && opened.bubble.expandAriaExpanded === 'true',
      readerShowsCompleteMessage: opened.reader.bodyText === referenceText
        && opened.reader.title === preview.titleText
        && opened.reader.subtitle === '完整消息'
        && opened.reader.badge.includes('长消息'),
      externalSourceStaysSeparateAndLightweight: preview.source === 'external'
        && preview.sourceText === '外部'
        && !preview.titleText.includes('外部')
        && opened.reader.source.value === 'external'
        && opened.reader.source.text === '外部'
        && !opened.reader.source.hidden
        && opened.reader.source.display !== 'none'
        && Number(opened.reader.source.opacity) <= .7
        && opened.reader.source.backgroundColor === 'rgba(0, 0, 0, 0)'
        && opened.reader.source.borderTopWidth === '0px'
        && opened.reader.source.boxShadow === 'none'
        && !opened.reader.title.includes('外部'),
      incomingMessageUpdatesOpenReaderWithoutWindowResize: replacementReceived.reader.visible
        && replacementReceived.reader.bodyText === replacementText
        && replacementCompleted.reader.visible
        && replacementCompleted.reader.bodyText === referenceText
        && replacementLayoutCalls.length === 0
        && ['x', 'y', 'width', 'height'].every(key => (
          replacementWindowBoundsAfter[key] === replacementWindowBounds[key]
        )),
      nonSpeechMessageHidesPlaybackControl: opened.reader.audio.kindExists
        && opened.reader.audio.kindText === '非语音消息'
        && opened.reader.audio.buttonExists
        && opened.reader.audio.hidden
        && opened.reader.audio.display === 'none'
        && !opened.reader.audio.playing
        && opened.reader.audio.ariaPressed === 'false',
      readerUsesTrueCharacterCount: opened.reader.count === `${expectedCharacterCount} 字`
        && !opened.reader.count.includes('/'),
      readerMatchesBubbleTypography: opened.reader.bodyFontSize === opened.bubble.messageFontSize,
      readerTextUsesFullWidth: opened.reader.bodyTextAlign === 'justify'
        && opened.reader.bodyWhiteSpace === 'pre-wrap'
        && Math.abs(opened.reader.bodyRect.width - opened.reader.contentWidth) <= 1
        && opened.reader.bodyScrollWidth <= opened.reader.bodyClientWidth + 1,
      fixedReaderAndViewportGeometry: Math.abs(opened.reader.rect.width - LONG_MESSAGE_READER_WIDTH) <= 1
        && Math.abs(opened.reader.rect.height - 520) <= 1
        && Math.abs(opened.reader.rect.y - 40) <= 1
        && opened.reader.side === 'right'
        && opened.layoutMode === 'right'
        && opened.viewport.rect.width === PET_VIEWPORT_WIDTH
        && opened.viewport.rect.height === PET_VIEWPORT_HEIGHT
        && opened.windowSize.width === PET_EXPANDED_HOST_WIDTH
        && opened.windowSize.height === PET_VIEWPORT_HEIGHT
        && Math.abs(opened.reader.rect.x - opened.viewport.rect.right - LONG_MESSAGE_READER_GAP) <= 1,
      nativeWindowExpandsRightWithoutMovingStage: expandedWindowBounds.width === PET_EXPANDED_HOST_WIDTH
        && expandedWindowBounds.height === PET_VIEWPORT_HEIGHT
        && expandedWindowBounds.x === initialWindowBounds.x
        && expandedWindowBounds.y === initialWindowBounds.y
        && opened.viewport.rect.x === 0
        && expandedWindowBounds.x + opened.viewport.rect.x === initialWindowBounds.x,
      readerReportsInteractionBounds: validBounds(reportedOpenBounds)
        && Math.abs(reportedOpenBounds.width - opened.reader.rect.width) <= 1
        && Math.abs(reportedOpenBounds.height - opened.reader.rect.height) <= 1,
      readerDoesNotPaintSemitransparentWindowHalo: onlyInsetShadows(opened.reader.boxShadow)
        && opened.reader.sheenDisplay === 'none'
        && [
          transparencyAlpha.gapSide,
          transparencyAlpha.outerSide,
          transparencyAlpha.above,
          transparencyAlpha.below,
        ].every(alpha => alpha <= 4)
        && transparencyAlpha.readerSurface >= 180,
      compactTailFitsInsideWindowGap: opened.reader.tail.display !== 'none'
        && opened.reader.tail.width === '10px'
        && opened.reader.tail.height === '24px'
        && opened.reader.tail.left === '-10px'
        && opened.reader.tail.transform === 'none'
        && opened.reader.tail.clipPath.includes('polygon')
        && opened.reader.tail.filter !== 'none'
        && opened.reader.tail.boxShadow === 'none'
        && opened.reader.connectorPetalDisplay === 'none'
        && leftSideTail.reader.tail.right === '-10px'
        && leftSideTail.reader.tail.transform === 'none'
        && leftSideTail.reader.tail.clipPath.includes('polygon')
        && Math.abs(Number.parseFloat(leftSideTail.reader.tail.left) - (LONG_MESSAGE_READER_WIDTH - 2)) <= 1
        && Math.abs(Number.parseFloat(leftSideTail.reader.tail.right)) < LONG_MESSAGE_READER_GAP,
      messageTagsHaveComfortableInlinePadding: opened.reader.tags.badgePaddingLeft === '11px'
        && opened.reader.tags.badgePaddingRight === '11px'
        && opened.reader.tags.audioKindPaddingLeft === '11px'
        && opened.reader.tags.audioKindPaddingRight === '11px'
        && opened.reader.tags.badgeScrollWidth <= opened.reader.tags.badgeClientWidth
        && opened.reader.tags.audioKindScrollWidth <= opened.reader.tags.audioKindClientWidth,
      readerOpensAtBeginning: opened.reader.bodyScrollTop <= 1
        && opened.reader.atStartClass,
      overflowingBodyScrollsToEnd: opened.reader.bodyScrollHeight > opened.reader.bodyClientHeight + 1
        && opened.reader.scrollableClass
        && scrolled.reader.bodyScrollTop > 0
        && scrolled.reader.atEndClass
        && scrolled.reader.status === '可滚动查看全文',
      copyUsesCompleteUnclampedText: copiedText === referenceText
        && copied.reader.copiedClass
        && copied.reader.copyLabel === '已复制'
        && copied.reader.copyAriaLabel === '完整消息已复制',
      collapseClosesSourceBubble: closed.reader.hidden
        && !closed.reader.visible
        && !closed.bubble.visible
        && !closed.bubble.expanded
        && closed.bubble.expandAriaExpanded === 'false'
        && closed.bubble.text === referenceText,
      collapseRestoresCompactNativeWindow: collapsedWindowBounds.width === PET_COLLAPSED_HOST_WIDTH
        && collapsedWindowBounds.height === PET_VIEWPORT_HEIGHT
        && collapsedWindowBounds.x === initialWindowBounds.x
        && collapsedWindowBounds.y === initialWindowBounds.y
        && expandedWindowBounds.x === collapsedWindowBounds.x
        && expandedWindowBounds.y === collapsedWindowBounds.y
        && expandedWindowBounds.width === PET_EXPANDED_HOST_WIDTH
        && expandedWindowBounds.width !== collapsedWindowBounds.width
        && expandedWindowBounds.height === collapsedWindowBounds.height
        && closed.windowSize.width === PET_COLLAPSED_HOST_WIDTH
        && closed.windowSize.height === PET_VIEWPORT_HEIGHT
        && closed.viewport.rect.width === PET_VIEWPORT_WIDTH
        && closed.viewport.rect.height === PET_VIEWPORT_HEIGHT,
      collapseResetsReaderTransientState: closed.reader.bodyScrollTop <= 1
        && closed.reader.copyLabel === '复制'
        && !closed.reader.copiedClass
        && !closed.reader.audio.playing
        && closed.reader.audio.ariaPressed === 'false'
        && closed.layoutMode === 'collapsed'
        && closed.viewport.offsetX === '0px',
      layoutBridgeReceivesOpenAndClose: layoutCalls.length >= 2
        && layoutCalls.some(call => call.payload.open === true && call.payload.preferredWidth === LONG_MESSAGE_READER_WIDTH)
        && layoutCalls.some(call => call.payload.open === false)
        && Number(opened.reader.layoutRevision) > 0,
      preparedSyncLayoutCommitAvoidsIntermediatePaint: layoutCalls.length >= 2
        && layoutCalls.every(call => call.transport === 'sync'),
      readerBoundsClearOnCollapse: boundsReports.some(validBounds)
        && boundsReports.at(-1) === null
        && lastLongMessageBounds === null,
      staleLayoutEventCannotReopenReader: afterStaleLayout.reader.hidden
        && !afterStaleLayout.reader.visible
        && afterStaleLayout.layoutMode === 'collapsed'
        && afterStaleLayout.viewport.offsetX === '0px'
        && Number(afterStaleLayout.reader.layoutRevision) > Number(openLayout && openLayout.revision),
    }
    themes.push({
      theme,
      states: {
        preview,
        opened,
        replacementReceived,
        replacementCompleted,
        leftSideTail,
        scrolled,
        copied,
        closed,
        afterStaleLayout,
      },
      windowBounds: { expanded: expandedWindowBounds, collapsed: collapsedWindowBounds },
      reportedOpenBounds,
      transparencyAlpha,
      layoutCalls,
      boundsReports,
      copiedTextLength: copiedText ? Array.from(copiedText).length : 0,
      screenshots: { previewScreenshot, readerScreenshot },
      assertions,
      passed: Object.values(assertions).every(Boolean),
    })
  }

  // Re-open the reader, then deliver a genuinely short direct message. The
  // incoming message must close the reader and return to the compact bubble;
  // merely having an old reader open is not a reason to render short content
  // inside the large card.
  const shortReplacementLayoutStart = longMessageLayoutCalls.length
  const shortReplacementBoundsStart = longMessageBoundsReports.length
  petWindow.webContents.send('external-message:event', {
    phase: 'received',
    message: {
      ...noAudioMessage,
      id: 'qa-long-message-before-short',
      requestId: 'qa-long-message-before-short-request',
    },
  })
  await waitForBubbleText(referenceText, 1600)
  await petWindow.webContents.executeJavaScript(`(() => {
    document.getElementById('interaction-bubble').shadowRoot.querySelector('.message-expand').click()
  })()`)
  const beforeShortReader = await waitForLongMessageReady(4000)
  const beforeShortBounds = petWindow.getBounds()
  const shortMessage = {
    ...noAudioMessage,
    id: 'qa-long-message-short-message',
    requestId: 'qa-long-message-short-message-request',
    content: shortText,
  }
  petWindow.webContents.send('external-message:event', { phase: 'received', message: shortMessage })
  await waitForBubbleText(shortText, 1600)
  await waitForLongMessageClosed(shortReplacementLayoutStart, shortReplacementBoundsStart, 4000)
  const shortBubble = await waitForBubbleExpandable(false, 1800)
  const shortReader = await readLongMessageState('long-message:short-message-regression')
  const afterShortBounds = petWindow.getBounds()
  const shortReplacementLayoutCalls = longMessageLayoutCalls.slice(shortReplacementLayoutStart)

  petWindow.webContents.send('external-message:event', {
    phase: 'completed',
    message: shortMessage,
    result: {
      text: shortText,
      emotion: '',
      aiGenerated: false,
      speech: { requested: false, status: 'disabled' },
      completedAt: new Date().toISOString(),
    },
  })
  await waitForBubbleVisibility(false, 5000)

  // Force the left-side geometry used when the pet is close to the right edge
  // of a display. The native host grows to the left while the renderer offsets
  // the 400px stage by the same amount, preserving its screen coordinate.
  longMessageLayoutSide = 'left'
  const leftTransitionCallStart = longMessageTransitionCalls.length
  const leftTransitionFrameSampleStart = longMessageTransitionFrameSamples.length
  const leftLayoutCallStart = longMessageLayoutCalls.length
  const leftBoundsReportStart = longMessageBoundsReports.length
  const leftMessage = {
    ...noAudioMessage,
    id: 'qa-long-message-left-handoff',
    requestId: 'qa-long-message-left-handoff-request',
  }
  petWindow.webContents.send('external-message:event', { phase: 'received', message: leftMessage })
  await waitForBubbleText(referenceText, 1600)
  await waitForBubbleExpandable(true, 1800)
  const leftCollapsedBounds = petWindow.getBounds()
  await petWindow.webContents.executeJavaScript(`(() => {
    document.getElementById('interaction-bubble').shadowRoot.querySelector('.message-expand').click()
  })()`)
  const leftOpened = await waitForLongMessageReady(5000)
  const leftExpandedBounds = petWindow.getBounds()
  const leftReaderScreenshot = await capture('long-message-left-reader.png')
  await petWindow.webContents.executeJavaScript(`document.getElementById('long-message-collapse').click()`)
  const leftClosed = await waitForLongMessageClosed(leftLayoutCallStart, leftBoundsReportStart, 5000)
  const leftRestoredBounds = petWindow.getBounds()
  const leftTransitionCalls = await waitForLongMessageTransitionSettled(leftTransitionCallStart)
  const leftTransitionFrameSamples = await waitForLongMessageTransitionFrameSamples(leftTransitionFrameSampleStart)
  longMessageLayoutSide = 'right'
  const glass = themes.find(result => result.theme === 'glass')
  const healing = themes.find(result => result.theme === 'healing')
  const apiMethodsAvailable = Object.values(initialState.apiSurface).every(Boolean)
  const crossThemeAssertions = {
    preloadExposesLongMessageContract: apiMethodsAvailable,
    noAudioFixtureCreatesVisibleBubble: seedBubble.visible && seedBubble.text === referenceText,
    coolAndHealingReadersShareExactHeight: glass.states.opened.reader.rect.height === 520
      && healing.states.opened.reader.rect.height === 520
      && glass.states.opened.reader.rect.height === healing.states.opened.reader.rect.height,
    expandControlsSharePlacement: Math.abs(glass.states.preview.expandRect.width - healing.states.preview.expandRect.width) <= 1
      && Math.abs(glass.states.preview.expandRect.height - healing.states.preview.expandRect.height) <= 1
      && Math.abs(glass.states.preview.expandRightGap - healing.states.preview.expandRightGap) <= 1
      && Math.abs(glass.states.preview.expandBottomGap - healing.states.preview.expandBottomGap) <= 1
      && glass.states.preview.expandOverlapsThirdLine
      && healing.states.preview.expandOverlapsThirdLine,
    themeTextColorsRemainDistinct: glass.states.opened.reader.bodyColor !== healing.states.opened.reader.bodyColor,
    everyCopyContainsTheFullMessage: copiedTexts.slice(-2).length === 2
      && copiedTexts.slice(-2).every(text => text === referenceText),
    shortMessageRemainsUnchanged: shortBubble.text === shortText
      && !shortBubble.expandable
      && shortBubble.expandHidden
      && shortBubble.expandDisplay === 'none'
      && shortReader.reader.hidden,
    shortMessageClosesAnAlreadyOpenReader: beforeShortReader.reader.visible
      && beforeShortBounds.width === PET_EXPANDED_HOST_WIDTH
      && shortReader.reader.hidden
      && shortReader.layoutMode === 'collapsed'
      && afterShortBounds.x === beforeShortBounds.x
      && afterShortBounds.y === beforeShortBounds.y
      && afterShortBounds.width === PET_COLLAPSED_HOST_WIDTH
      && afterShortBounds.height === PET_VIEWPORT_HEIGHT
      && shortReplacementLayoutCalls.some(call => call.payload.open === false),
    leftSideLayoutKeepsThePetAtOneScreenPosition: leftOpened.reader.visible
      && leftOpened.reader.side === 'left'
      && leftOpened.layoutMode === 'left'
      && leftExpandedBounds.x + leftOpened.viewport.rect.x === leftCollapsedBounds.x
      && leftRestoredBounds.x + leftClosed.viewport.rect.x === leftCollapsedBounds.x
      && leftExpandedBounds.x === leftCollapsedBounds.x - LONG_MESSAGE_READER_EXTENSION
      && leftRestoredBounds.x === leftCollapsedBounds.x
      && leftExpandedBounds.width === PET_EXPANDED_HOST_WIDTH
      && leftRestoredBounds.width === PET_COLLAPSED_HOST_WIDTH,
    leftSideLayoutUsesAtomicStageHandoff: leftTransitionCalls.length >= 4
      && leftTransitionCalls.filter(call => call.active).length === 2
      && leftTransitionCalls.at(-1).active === false
      && leftTransitionFrameSamples.length >= 4
      && leftTransitionFrameSamples.every(sample => (
        Math.abs(sample.nativeBounds.x + sample.frameRectX - leftCollapsedBounds.x) <= 1
        && Math.abs(sample.frameWidth - PET_VIEWPORT_WIDTH) <= 1
      ))
      && [false, true].every(expanded => (
        ['prepared', 'committed'].every(phase => leftTransitionFrameSamples.some(sample => (
          sample.phase === phase && Boolean(sample.layout && sample.layout.expanded) === expanded
        )))
      )),
  }

  return {
    referenceText,
    expectedCharacterCount,
    initialWindowBounds,
    initialState,
    themes,
    shortMessage: {
      bubble: shortBubble,
      reader: shortReader,
      beforeReader: beforeShortReader,
      beforeBounds: beforeShortBounds,
      afterBounds: afterShortBounds,
      layoutCalls: shortReplacementLayoutCalls,
    },
    leftStageHandoff: {
      opened: leftOpened,
      closed: leftClosed,
      collapsedBounds: leftCollapsedBounds,
      expandedBounds: leftExpandedBounds,
      restoredBounds: leftRestoredBounds,
      transitionCalls: leftTransitionCalls,
      transitionFrameSamples: leftTransitionFrameSamples,
      screenshot: leftReaderScreenshot,
    },
    crossThemeAssertions,
    passed: themes.every(theme => theme.passed) && Object.values(crossThemeAssertions).every(Boolean),
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
  await wait(170)
  const thinkingBeforeChatCompleted = await readBubble('voice:thinking-before-chat-completed')
  const speechPhase = await waitForBubbleText('语音合成中…', 1800)
  const speechObservedAtMs = Date.now() - sequenceStartedAt
  await wait(220)
  const speechBeforeTtsCompleted = await readBubble('voice:speech-before-tts-completed')
  const finalPhase = await waitForBubbleText(expectedVoiceText, 1800)
  const finalObservedAtMs = Date.now() - sequenceStartedAt
  const finalBubbleStartedAt = Date.now()
  await wait(360)
  const voiceDuringPlayback = await readBubble('voice:during-playback')
  petWindow.webContents.send('pet:interact', { kind: 'head' })
  await wait(100)
  const voiceAfterCompetingInteraction = await readBubble('voice:after-competing-interaction')
  // Capture after the timing-sensitive assertion. GPU screenshot latency can
  // otherwise consume the remainder of the short deterministic audio fixture.
  const voiceScreenshot = await capture('bubble-voice-during-playback.png')
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
    thinkingPersistsUntilChatCompletes: thinkingBeforeChatCompleted.visible
      && thinkingBeforeChatCompleted.text === '思考中…',
    speechPhaseAppears: speechPhase.visible && speechPhase.text === '语音合成中…',
    speechPersistsUntilTtsCompletes: speechBeforeTtsCompleted.visible
      && speechBeforeTtsCompleted.text === '语音合成中…',
    finalVoiceBubbleAppears: finalPhase.visible && finalPhase.text === expectedVoiceText,
    voiceProgressOrder: thinkingObservedAtMs < speechObservedAtMs
      && speechObservedAtMs < finalObservedAtMs,
    thinkingWaitsForChat: speechObservedAtMs - thinkingObservedAtMs >= 280,
    speechWaitsForTts: finalObservedAtMs - speechObservedAtMs >= 380,
    voiceBubblePersistsDuringPlayback: voiceDuringPlayback.visible
      && voiceDuringPlayback.text === expectedVoiceText,
    interactionCannotOverwriteVoice: voiceAfterCompetingInteraction.visible
      && voiceAfterCompetingInteraction.text === expectedVoiceText,
    voiceBubbleEndsWithPlayback: !voiceEnded.visible,
    // The final text now remains for two seconds after the voice/typewriter
    // finishes instead of disappearing at the audio completion boundary.
    voiceLeaseHasPlaybackDuration: voiceVisibleForMs >= 1800 && voiceVisibleForMs <= 3200,
  }

  return {
    states: {
      idleBeforeTest,
      first,
      afterCompetingInteraction,
      afterFirstLease,
      noQueuedBubble,
      thinkingPhase,
      thinkingBeforeChatCompleted,
      speechPhase,
      speechBeforeTtsCompleted,
      finalPhase,
      voiceDuringPlayback,
      voiceAfterCompetingInteraction,
      voiceEnded,
    },
    metrics: {
      thinkingObservedAtMs,
      speechObservedAtMs,
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

async function runTypewriterLifecycle() {
  const originalPreferences = {
    settingsTheme: snapshot.preferences.settingsTheme,
    externalLongMessageAutoExpand: snapshot.preferences.externalLongMessageAutoExpand,
    externalMessageStreamingOutput: snapshot.preferences.externalMessageStreamingOutput,
  }
  const screenshots = {}
  const themes = []
  petWindow.webContents.send('ai:chat-visibility', false)
  await waitForBubbleVisibility(false, 4000)
  await petWindow.webContents.executeJavaScript('window.__PET_QA_TYPEWRITER_INTERVAL_MS = 55')

  for (const theme of ['glass', 'healing']) {
    await setSnapshot({
      settingsTheme: theme,
      externalLongMessageAutoExpand: false,
      externalMessageStreamingOutput: true,
    })
    const text = `${theme === 'glass' ? '玻璃' : '治愈'}主题正在逐字打印这条外部消息。`
    const message = {
      id: `qa-typewriter-${theme}`,
      requestId: `qa-typewriter-${theme}-request`,
      type: 'direct',
      content: text,
      speak: false,
      sender: '打印机效果验收',
      source: 'external',
      sourceLabel: '外部',
      receivedAt: new Date().toISOString(),
    }
    petWindow.webContents.send('external-message:event', { phase: 'received', message })
    await wait(180)
    const partial = await readBubble(`typewriter:${theme}:partial`)
    screenshots[theme] = await capture(`typewriter-${theme}-partial.png`)
    const completed = await waitForBubbleText(text, 3000)
    await wait(1450)
    const held = await readBubble(`typewriter:${theme}:held`)
    const dismissed = await waitForBubbleVisibility(false, 1000)
    themes.push({ theme, text, partial, completed, held, dismissed })
  }

  await setSnapshot({
    settingsTheme: 'healing',
    externalLongMessageAutoExpand: false,
    externalMessageStreamingOutput: true,
  })
  await petWindow.webContents.executeJavaScript('window.__PET_QA_TYPEWRITER_INTERVAL_MS = 100')
  const longText = '展开长消息以后，阅读器应当保留已经打印的内容，并从当前位置继续展示，而不是重新从第一个字开始计时。'
  const longMessage = {
    id: 'qa-typewriter-long-reader',
    requestId: 'qa-typewriter-long-reader-request',
    type: 'direct',
    content: longText,
    speak: false,
    sender: '打印机效果验收',
    source: 'external',
    sourceLabel: '外部',
    receivedAt: new Date().toISOString(),
  }
  petWindow.webContents.send('external-message:event', { phase: 'received', message: longMessage })
  await wait(240)
  const beforeExpand = await readBubble('typewriter:reader:before-expand')
  const layoutCallStart = longMessageLayoutCalls.length
  const boundsReportStart = longMessageBoundsReports.length
  await petWindow.webContents.executeJavaScript(`(() => {
    document.getElementById('interaction-bubble').shadowRoot.querySelector('.message-expand').click()
  })()`)
  const opened = await waitForLongMessageReady(4000)
  screenshots.readerTyping = await capture('typewriter-reader-partial.png')
  await waitForLongMessageBodyText(longText, 6000)
  await wait(80)
  const readerCompleted = await readLongMessageState('typewriter:reader:completed')
  screenshots.readerCompleted = await capture('typewriter-reader-completed.png')
  await petWindow.webContents.executeJavaScript(`document.getElementById('long-message-collapse').click()`)
  const readerClosed = await waitForLongMessageClosed(layoutCallStart, boundsReportStart, 4000)

  await petWindow.webContents.executeJavaScript('window.__PET_QA_TYPEWRITER_INTERVAL_MS = 1')
  await setSnapshot(originalPreferences)

  const plainTextAssertions = themes.map(result => ({
    theme: result.theme,
    partialStartsImmediately: result.partial.visible
      && result.partial.text.length > 0
      && result.partial.text.length < result.text.length
      && result.text.startsWith(result.partial.text),
    completePayloadStaysAvailable: result.partial.fullText === result.text,
    completesInOrder: result.completed.visible && result.completed.text === result.text,
    remainsForTwoSecondHold: result.held.visible && result.held.text === result.text,
    dismissesAfterHold: !result.dismissed.visible,
  }))
  const expectedLongCount = Array.from(longText.replace(/\s/gu, '')).length
  const assertions = {
    bothThemesPrintProgressively: plainTextAssertions.every(result => result.partialStartsImmediately),
    bothThemesRetainCompletePayload: plainTextAssertions.every(result => result.completePayloadStaysAvailable),
    bothThemesFinishInOrder: plainTextAssertions.every(result => result.completesInOrder),
    bothThemesHoldForTwoSeconds: plainTextAssertions.every(result => result.remainsForTwoSecondHold),
    bothThemesDismissAfterHold: plainTextAssertions.every(result => result.dismissesAfterHold),
    longMessageIsExpandableBeforeTypingFinishes: beforeExpand.visible
      && beforeExpand.expandable
      && beforeExpand.fullText === longText
      && beforeExpand.text.length < longText.length,
    readerContinuesFromExistingPrefix: opened.reader.visible
      && opened.reader.bodyText.startsWith(beforeExpand.text)
      && opened.reader.bodyText.length >= beforeExpand.text.length
      && opened.reader.bodyText.length < longText.length
      && opened.reader.status === '文字展示中…',
    readerUsesFullCountWhileTyping: opened.reader.count === `${expectedLongCount} 字`,
    readerCompletesWithoutRestarting: readerCompleted.reader.bodyText === longText
      && readerCompleted.reader.status !== '文字展示中…',
    expandedReaderWaitsForExplicitCollapse: readerCompleted.reader.visible && readerClosed.reader.hidden,
  }
  return {
    themes,
    longMessage: { beforeExpand, opened, readerCompleted, readerClosed },
    plainTextAssertions,
    assertions,
    screenshots,
    passed: Object.values(assertions).every(Boolean),
  }
}

async function readExternalPriorityState(expectedLocalReply) {
  return petWindow.webContents.executeJavaScript(`(() => {
    const messages = [...document.querySelectorAll('#ai-chat-messages .ai-message')]
    const external = messages.filter(message => message.dataset.messageSource === 'external')
    const app = messages.filter(message => message.dataset.messageSource === 'app')
    const bubble = document.getElementById('interaction-bubble')
    const bubbleSource = bubble.shadowRoot.querySelector('.source-marker')
    const bubbleSourceStyle = getComputedStyle(bubbleSource)
    const panel = document.getElementById('ai-chat-panel')
    const input = document.getElementById('ai-chat-input')
    return {
      externalCount: external.length,
      externalBadges: external.map(message => message.querySelector('.ai-message-source')?.textContent || ''),
      externalSenders: external.map(message => message.querySelector('.ai-message-sender')?.textContent || ''),
      appBadges: app.map(message => message.querySelector('.ai-message-source')?.textContent || ''),
      localReplyPresent: messages.some(message =>
        message.dataset.messageSource === 'app' &&
        message.querySelector('.ai-message-content')?.textContent === ${JSON.stringify(expectedLocalReply)}
      ),
      thinkingCount: messages.filter(message => message.classList.contains('is-thinking')).length,
      panelHidden: panel.hidden,
      panelCollapsed: panel.classList.contains('is-collapsed'),
      panelThinking: panel.classList.contains('is-thinking'),
      presenceText: document.getElementById('ai-chat-presence-text').textContent,
      inputValue: input.value,
      inputDisabled: input.disabled,
      sendDisabled: document.getElementById('ai-chat-send').disabled,
      bubbleVisible: bubble.classList.contains('is-visible'),
      bubbleText: bubble.message || '',
      bubbleLabel: bubble.label || '',
      bubbleSource: bubble.source || '',
      bubbleSourceText: bubbleSource.textContent.trim(),
      bubbleSourceHidden: bubbleSource.hidden,
      bubbleSourceDisplay: bubbleSourceStyle.display,
      bubbleSourceOpacity: bubbleSourceStyle.opacity,
      bubbleSourceBackgroundColor: bubbleSourceStyle.backgroundColor,
      bubbleSourceBorderTopWidth: bubbleSourceStyle.borderTopWidth,
      bubbleSourceBoxShadow: bubbleSourceStyle.boxShadow,
    }
  })()`)
}

async function runExternalMessagePriority() {
  petWindow.webContents.send('ai:chat-visibility', true)
  await wait(120)
  await petWindow.webContents.executeJavaScript(`(() => {
    const panel = document.getElementById('ai-chat-panel')
    if (panel.classList.contains('is-collapsed')) document.getElementById('ai-chat-toggle').click()
  })()`)
  aiMockState.chatDelayMs = 620
  aiMockState.replyText = '这条 APP 回复必须正常完成'
  await petWindow.webContents.executeJavaScript(`(() => {
    const input = document.getElementById('ai-chat-input')
    input.value = '正在处理的 APP 消息'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.getElementById('ai-chat-form').requestSubmit()
  })()`)
  await wait(100)

  const message = {
    id: 'qa-external-priority-1',
    requestId: 'qa-external-priority-request-1',
    type: 'direct',
    content: '外部最高优先级消息',
    speak: false,
    sender: 'QA 外部系统',
    source: 'external',
    sourceLabel: '外部',
    receivedAt: new Date().toISOString(),
  }
  petWindow.webContents.send('external-message:event', { phase: 'received', message })
  await wait(100)
  const received = await readExternalPriorityState(aiMockState.replyText)
  petWindow.webContents.send('pet:interact', { kind: 'greet', text: 'APP 交互不应覆盖' })
  await wait(120)
  const afterCompetingAppMessage = await readExternalPriorityState(aiMockState.replyText)

  await wait(650)
  const appCompletedDuringExternal = await readExternalPriorityState(aiMockState.replyText)
  petWindow.webContents.send('external-message:event', {
    phase: 'completed',
    message,
    result: {
      text: message.content,
      emotion: '',
      aiGenerated: false,
      speech: { requested: false, status: 'disabled' },
      completedAt: new Date().toISOString(),
    },
  })
  await wait(100)
  const completed = await readExternalPriorityState(aiMockState.replyText)

  const relayVoiceMessage = {
    ...message,
    id: 'qa-external-relay-voice',
    requestId: 'qa-external-relay-voice-request',
    type: 'relay',
    content: '请生成一条语音回复',
    speak: true,
  }
  petWindow.webContents.send('external-message:event', {
    phase: 'received',
    stage: 'thinking',
    progressText: '思考中…',
    transient: true,
    message: relayVoiceMessage,
  })
  await wait(90)
  const relayThinking = await readExternalPriorityState(aiMockState.replyText)
  await wait(180)
  const relayThinkingBeforeCompletion = await readExternalPriorityState(aiMockState.replyText)
  petWindow.webContents.send('external-message:event', {
    phase: 'progress',
    stage: 'speech',
    progressText: '语音合成中…',
    transient: true,
    message: relayVoiceMessage,
  })
  await wait(90)
  const relaySpeech = await readExternalPriorityState(aiMockState.replyText)
  await wait(180)
  const relaySpeechBeforeCompletion = await readExternalPriorityState(aiMockState.replyText)
  const relayFinalText = '外部 AI 最终语音回复'
  petWindow.webContents.send('external-message:event', {
    phase: 'completed',
    message: relayVoiceMessage,
    result: {
      text: relayFinalText,
      emotion: '',
      aiGenerated: true,
      speech: { requested: true, status: 'ready' },
      completedAt: new Date().toISOString(),
    },
  })
  await wait(90)
  const relayCompleted = await readExternalPriorityState(aiMockState.replyText)

  const directVoiceMessage = {
    ...message,
    id: 'qa-external-direct-voice',
    requestId: 'qa-external-direct-voice-request',
    content: '外部直连语音正文',
    speak: true,
  }
  petWindow.webContents.send('external-message:event', {
    phase: 'received',
    stage: 'speech',
    progressText: '语音合成中…',
    transient: true,
    message: directVoiceMessage,
  })
  await wait(90)
  const directSpeech = await readExternalPriorityState(aiMockState.replyText)
  await wait(180)
  const directSpeechBeforeCompletion = await readExternalPriorityState(aiMockState.replyText)
  petWindow.webContents.send('external-message:event', {
    phase: 'completed',
    message: directVoiceMessage,
    result: {
      text: directVoiceMessage.content,
      emotion: '',
      aiGenerated: false,
      speech: { requested: true, status: 'ready' },
      completedAt: new Date().toISOString(),
    },
  })
  await wait(90)
  const directCompleted = await readExternalPriorityState(aiMockState.replyText)

  petWindow.webContents.send('ai:chat-visibility', false)
  await wait(100)
  const closedMessage = {
    ...message,
    id: 'qa-external-priority-closed',
    requestId: 'qa-external-priority-closed-request',
    content: '聊天框关闭时的外部消息',
  }
  petWindow.webContents.send('external-message:event', { phase: 'received', message: closedMessage })
  await wait(100)
  const receivedWhileClosed = await readExternalPriorityState(aiMockState.replyText)
  petWindow.webContents.send('external-message:event', {
    phase: 'completed',
    message: closedMessage,
    result: {
      text: closedMessage.content,
      emotion: '',
      aiGenerated: false,
      speech: { requested: false, status: 'disabled' },
      completedAt: new Date().toISOString(),
    },
  })
  const screenshot = await capture('chat-external-message-priority.png')
  aiMockState.chatDelayMs = 0

  const assertions = {
    appMessagesHideRedundantSourceMarker: received.appBadges.length > 0 && received.appBadges.every(label => label === ''),
    externalMessageNeverEntersChat: received.externalCount === 0 && completed.externalCount === 0,
    externalMessagePreservesBusyChatState: received.inputDisabled
      && received.sendDisabled
      && received.thinkingCount === 1
      && received.panelThinking
      && received.presenceText === '思考中',
    externalMessageOwnsBubble: received.bubbleVisible
      && received.bubbleText === message.content
      && !received.bubbleLabel.includes('外部')
      && received.bubbleSource === 'external'
      && received.bubbleSourceText === '外部'
      && !received.bubbleSourceHidden
      && received.bubbleSourceDisplay !== 'none'
      && Number(received.bubbleSourceOpacity) <= .7
      && received.bubbleSourceBackgroundColor === 'rgba(0, 0, 0, 0)'
      && received.bubbleSourceBorderTopWidth === '0px'
      && received.bubbleSourceBoxShadow === 'none',
    appInteractionCannotOverwriteExternal: afterCompetingAppMessage.bubbleText === message.content,
    appReplyContinuesWithoutOverwritingExternal: appCompletedDuringExternal.localReplyPresent
      && appCompletedDuringExternal.bubbleText === message.content
      && appCompletedDuringExternal.thinkingCount === 0
      && !appCompletedDuringExternal.inputDisabled,
    completedExternalDoesNotAlterChat: completed.localReplyPresent
      && !completed.panelHidden
      && !completed.panelCollapsed
      && !completed.panelThinking
      && completed.presenceText === '在线'
      && !completed.inputDisabled,
    externalMessageDoesNotOpenClosedChat: receivedWhileClosed.panelHidden
      && receivedWhileClosed.externalCount === 0
      && receivedWhileClosed.bubbleText === closedMessage.content
      && !receivedWhileClosed.bubbleLabel.includes('外部')
      && receivedWhileClosed.bubbleSource === 'external'
      && !receivedWhileClosed.bubbleSourceHidden,
    externalRelayBeginsWithThinking: relayThinking.bubbleVisible
      && relayThinking.bubbleText === '思考中…',
    externalThinkingPersistsUntilAiCompletes: relayThinkingBeforeCompletion.bubbleVisible
      && relayThinkingBeforeCompletion.bubbleText === '思考中…',
    externalRelayAdvancesToSpeechAfterAi: relaySpeech.bubbleVisible
      && relaySpeech.bubbleText === '语音合成中…',
    externalSpeechPersistsUntilTtsCompletes: relaySpeechBeforeCompletion.bubbleVisible
      && relaySpeechBeforeCompletion.bubbleText === '语音合成中…',
    externalRelayShowsFinalTextOnlyAfterTts: relayCompleted.bubbleVisible
      && relayCompleted.bubbleText === relayFinalText,
    directSpeechSkipsThinking: directSpeech.bubbleVisible
      && directSpeech.bubbleText === '语音合成中…',
    directSpeechPersistsUntilTtsCompletes: directSpeechBeforeCompletion.bubbleVisible
      && directSpeechBeforeCompletion.bubbleText === '语音合成中…',
    directSpeechShowsFinalTextOnlyAfterTts: directCompleted.bubbleVisible
      && directCompleted.bubbleText === directVoiceMessage.content,
    externalStagesNeverEnterAppChat: [
      relayThinking,
      relayThinkingBeforeCompletion,
      relaySpeech,
      relaySpeechBeforeCompletion,
      relayCompleted,
      directSpeech,
      directSpeechBeforeCompletion,
      directCompleted,
    ].every(state => state.externalCount === 0),
    externalStagesKeepSeparateSourceMarker: [
      relayThinking,
      relayThinkingBeforeCompletion,
      relaySpeech,
      relaySpeechBeforeCompletion,
      relayCompleted,
      directSpeech,
      directSpeechBeforeCompletion,
      directCompleted,
    ].every(state => state.bubbleSource === 'external'
      && !state.bubbleSourceHidden
      && !state.bubbleLabel.includes('外部')),
  }
  return {
    states: {
      received,
      afterCompetingAppMessage,
      appCompletedDuringExternal,
      completed,
      relayThinking,
      relayThinkingBeforeCompletion,
      relaySpeech,
      relaySpeechBeforeCompletion,
      relayCompleted,
      directSpeech,
      directSpeechBeforeCompletion,
      directCompleted,
      receivedWhileClosed,
    },
    screenshot,
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
    sampledContinuouslyForAtLeast2200ms: metrics.durationMs >= 2200 && metrics.sampleCount >= 60,
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

async function waitForDetachedReaderRevision(revision, timeoutMs = 3000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (detachedReaderRenderedRevisions.includes(revision)) return true
    await wait(25)
  }
  return false
}

async function readDetachedReaderState() {
  return detachedReaderWindow.webContents.executeJavaScript(`(() => {
    const reader = document.getElementById('long-message-reader')
    const body = document.getElementById('long-message-reader-body')
    const audio = document.getElementById('long-message-audio')
    const source = document.getElementById('long-message-source')
    const rect = reader.getBoundingClientRect()
    const tail = getComputedStyle(reader, '::before')
    return {
      hidden: reader.hidden,
      side: reader.dataset.side,
      theme: document.documentElement.dataset.settingsTheme,
      title: document.getElementById('long-message-title').textContent,
      text: body.textContent,
      count: document.getElementById('long-message-count').textContent,
      sourceHidden: source.hidden,
      sourceText: source.textContent,
      audioHidden: audio.hidden,
      audioPlaying: audio.classList.contains('is-playing'),
      scrollable: reader.classList.contains('is-scrollable'),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      layout: {
        x: reader.offsetLeft,
        y: reader.offsetTop,
        width: reader.offsetWidth,
        height: reader.offsetHeight,
      },
      tail: { left: tail.left, right: tail.right, clipPath: tail.clipPath },
    }
  })()`)
}

async function sendDetachedReaderFixture(fixture) {
  detachedReaderFixture = structuredClone(fixture)
  detachedReaderWindow.webContents.send('long-message-reader:state', structuredClone(fixture))
  return waitForDetachedReaderRevision(fixture.revision)
}

async function captureDetachedReader(name) {
  const image = await detachedReaderWindow.capturePage()
  const target = path.join(outputDirectory, name)
  fs.writeFileSync(target, image.toPNG())
  return target
}

async function runDetachedLongMessageReader() {
  const petBoundsBefore = petWindow.getBounds()
  const copiedTextStart = copiedTexts.length
  const longText = Array.from({ length: 24 }, (_, index) => (
    `独立窗口验收第${index + 1}段：阅读器出现和消失时，宠物透明宿主的原生边界必须保持完全不变。`
  )).join('\n')
  detachedReaderFixture = {
    open: true,
    text: longText,
    label: '独立阅读器',
    source: 'external',
    theme: 'glass',
    hasVoice: true,
    playing: true,
    side: 'right',
    readerWidth: LONG_MESSAGE_READER_WIDTH,
    offsetX: LONG_MESSAGE_READER_EDGE,
    top: 40,
    height: 520,
    revision: 901,
  }
  detachedReaderWindow = new BrowserWindow({
    x: petBoundsBefore.x + PET_VIEWPORT_WIDTH + LONG_MESSAGE_READER_GAP - LONG_MESSAGE_READER_EDGE,
    y: petBoundsBefore.y,
    width: LONG_MESSAGE_READER_WINDOW_WIDTH,
    height: PET_VIEWPORT_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(projectRoot, 'long-message-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  })

  try {
    await detachedReaderWindow.loadFile(path.join(projectRoot, 'renderer', 'long-message-reader.html'))
    const rightRendered = await waitForDetachedReaderRevision(901)
    const rightState = await readDetachedReaderState()
    const rightBounds = detachedReaderWindow.getBounds()
    const rightCardScreenX = rightBounds.x + rightState.layout.x
    const rightScreenshot = await captureDetachedReader('long-message-detached-glass-right.png')
    await detachedReaderWindow.webContents.executeJavaScript("document.getElementById('long-message-copy').click()")
    await wait(40)
    await detachedReaderWindow.webContents.executeJavaScript("document.getElementById('long-message-audio').click(); document.getElementById('long-message-collapse').click()")
    await wait(40)
    const petBoundsAfterRight = petWindow.getBounds()

    const leftFixture = {
      ...detachedReaderFixture,
      theme: 'healing',
      side: 'left',
      playing: false,
      revision: 902,
    }
    detachedReaderWindow.setBounds({
      x: petBoundsBefore.x - LONG_MESSAGE_READER_GAP - LONG_MESSAGE_READER_WIDTH - LONG_MESSAGE_READER_EDGE,
      y: petBoundsBefore.y,
      width: LONG_MESSAGE_READER_WINDOW_WIDTH,
      height: PET_VIEWPORT_HEIGHT,
    }, false)
    const leftRendered = await sendDetachedReaderFixture(leftFixture)
    const leftState = await readDetachedReaderState()
    const leftBounds = detachedReaderWindow.getBounds()
    const leftCardScreenRight = leftBounds.x + leftState.layout.x + leftState.layout.width
    const leftScreenshot = await captureDetachedReader('long-message-detached-healing-left.png')
    const petBoundsAfterLeft = petWindow.getBounds()

    const closedFixture = { ...leftFixture, open: false, revision: 903 }
    detachedReaderFixture = structuredClone(closedFixture)
    detachedReaderWindow.webContents.send('long-message-reader:state', closedFixture)
    await wait(50)
    const closedState = await readDetachedReaderState()
    const petBoundsAfterClose = petWindow.getBounds()
    const sameBounds = (left, right) => ['x', 'y', 'width', 'height'].every(key => left[key] === right[key])
    const copied = copiedTexts.slice(copiedTextStart)
    const assertions = {
      rightReaderRendersBeforeReveal: rightRendered && !rightState.hidden,
      leftReaderRendersBeforeReveal: leftRendered && !leftState.hidden,
      productionReaderUsesExactCardGeometry: [rightState, leftState].every(state => (
        Math.abs(state.layout.x - LONG_MESSAGE_READER_EDGE) <= 1 &&
        Math.abs(state.layout.y - 40) <= 1 &&
        Math.abs(state.layout.width - LONG_MESSAGE_READER_WIDTH) <= 1 &&
        Math.abs(state.layout.height - 520) <= 1
      )),
      rightReaderKeepsFourteenPixelPetGap: Math.abs(
        rightCardScreenX - (petBoundsBefore.x + PET_VIEWPORT_WIDTH + LONG_MESSAGE_READER_GAP)
      ) <= 1,
      leftReaderKeepsFourteenPixelPetGap: Math.abs(
        leftCardScreenRight - (petBoundsBefore.x - LONG_MESSAGE_READER_GAP)
      ) <= 1,
      petNativeBoundsNeverChange: [petBoundsAfterRight, petBoundsAfterLeft, petBoundsAfterClose]
        .every(bounds => sameBounds(bounds, petBoundsBefore)) &&
        petBoundsBefore.width === PET_VIEWPORT_WIDTH && petBoundsBefore.height === PET_VIEWPORT_HEIGHT,
      fullTextAndMetadataSurviveProcessBoundary: rightState.text === longText &&
        rightState.title === '独立阅读器' && !rightState.sourceHidden &&
        rightState.count === `${Array.from(longText.replace(/\s/gu, '')).length} 字`,
      themesAndTailsStayScoped: rightState.theme === 'glass' && rightState.side === 'right' &&
        leftState.theme === 'healing' && leftState.side === 'left' &&
        rightState.tail.left === '-10px' && leftState.tail.right === '-10px',
      speechStateAndActionsBridgeBack: !rightState.audioHidden && rightState.audioPlaying &&
        !leftState.audioHidden && !leftState.audioPlaying &&
        detachedReaderActions.includes('audio') && detachedReaderActions.includes('collapse'),
      copyUsesCompleteText: copied.includes(longText),
      closeHidesOnlyReaderSurface: closedState.hidden && sameBounds(petBoundsAfterClose, petBoundsBefore),
    }
    return {
      assertions,
      passed: Object.values(assertions).every(Boolean),
      petBounds: {
        before: petBoundsBefore,
        afterRight: petBoundsAfterRight,
        afterLeft: petBoundsAfterLeft,
        afterClose: petBoundsAfterClose,
      },
      readerBounds: { right: rightBounds, left: leftBounds },
      states: { right: rightState, left: leftState, closed: closedState },
      actions: detachedReaderActions.slice(),
      screenshots: { rightScreenshot, leftScreenshot },
    }
  } finally {
    if (detachedReaderWindow && !detachedReaderWindow.isDestroyed()) detachedReaderWindow.destroy()
    detachedReaderWindow = null
    detachedReaderFixture = null
  }
}

async function captureFocusedMessageOutput(name) {
  await wait(60)
  await petWindow.webContents.executeJavaScript(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
  )
  return capture(name)
}

async function runFocusedAppMessage({ name, text, appStreaming, externalStreaming, theme }) {
  await setSnapshot({
    settingsTheme: theme,
    appMessageStreamingOutput: appStreaming,
    externalMessageStreamingOutput: externalStreaming,
    appLongMessageAutoExpand: false,
    externalLongMessageAutoExpand: false,
  })
  aiMockState.chatDelayMs = 0
  aiMockState.speechDelayMs = 0
  aiMockState.replyText = text
  const messageStartedAt = Date.now()
  await petWindow.webContents.executeJavaScript(`(() => {
    const mute = document.getElementById('ai-chat-mute')
    if (mute.getAttribute('aria-pressed') === 'false') mute.click()
    const input = document.getElementById('ai-chat-input')
    input.value = ${JSON.stringify('定向验证消息输出方式')}
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.getElementById('ai-chat-form').requestSubmit()
  })()`)
  const payload = await waitForBubblePayload(text, 2500)
  await wait(120)
  const sampled = await readBubble(`${name}:sampled`)
  let completed = sampled
  let completionObservedAt = Date.now()
  const screenshot = await captureFocusedMessageOutput(`${name}.png`)
  if (appStreaming) {
    completed = await waitForBubbleText(text, 5000)
    completionObservedAt = Date.now()
  }
  const dismissed = await waitForBubbleVisibility(false, 7500)
  const completionHoldMs = Date.now() - completionObservedAt
  const visibleLifetimeMs = Date.now() - messageStartedAt
  return {
    name,
    preferences: { appStreaming, externalStreaming, theme },
    text,
    payload,
    sampled,
    completed,
    dismissed,
    completionHoldMs,
    visibleLifetimeMs,
    screenshot,
  }
}

async function runFocusedExternalMessage({ name, text, appStreaming, externalStreaming, theme }) {
  await setSnapshot({
    settingsTheme: theme,
    appMessageStreamingOutput: appStreaming,
    externalMessageStreamingOutput: externalStreaming,
    appLongMessageAutoExpand: false,
    externalLongMessageAutoExpand: false,
  })
  const message = {
    id: `qa-${name}`,
    requestId: `qa-${name}-request`,
    type: 'direct',
    content: text,
    speak: false,
    sender: '消息输出方式定向验收',
    source: 'external',
    sourceLabel: '外部',
    receivedAt: new Date().toISOString(),
  }
  const messageStartedAt = Date.now()
  petWindow.webContents.send('external-message:event', { phase: 'received', message })
  const payload = await waitForBubblePayload(text, 2500)
  await wait(120)
  const sampled = await readBubble(`${name}:sampled`)
  let completed = sampled
  let completionObservedAt = Date.now()
  const screenshot = await captureFocusedMessageOutput(`${name}.png`)
  if (externalStreaming) {
    completed = await waitForBubbleText(text, 5000)
    completionObservedAt = Date.now()
  }
  const dismissed = await waitForBubbleVisibility(false, 7500)
  const completionHoldMs = Date.now() - completionObservedAt
  const visibleLifetimeMs = Date.now() - messageStartedAt
  return {
    name,
    preferences: { appStreaming, externalStreaming, theme },
    text,
    payload,
    sampled,
    completed,
    dismissed,
    completionHoldMs,
    visibleLifetimeMs,
    screenshot,
  }
}

async function runMessageOutputRuntimeFocused(modelReady) {
  await petWindow.webContents.executeJavaScript('window.__PET_QA_TYPEWRITER_INTERVAL_MS = 110')
  petWindow.webContents.send('ai:chat-visibility', true)
  await wait(220)

  const appDirect = await runFocusedAppMessage({
    name: 'app-direct-output',
    text: 'APP关闭流式输出后，这条回复应立即完整显示。',
    appStreaming: false,
    externalStreaming: true,
    theme: 'glass',
  })
  const appStreaming = await runFocusedAppMessage({
    name: 'app-streaming-output',
    text: 'APP开启流式输出后，这条回复正在逐字显示。',
    appStreaming: true,
    externalStreaming: false,
    theme: 'glass',
  })
  const externalDirect = await runFocusedExternalMessage({
    name: 'external-direct-output',
    text: '外部开关关闭后，这条输入消息应立即完整显示。',
    appStreaming: true,
    externalStreaming: false,
    theme: 'healing',
  })
  const externalStreaming = await runFocusedExternalMessage({
    name: 'external-streaming-output',
    text: '外部开关开启后，这条输入消息正在逐字显示。',
    appStreaming: false,
    externalStreaming: true,
    theme: 'healing',
  })
  petWindow.webContents.send('ai:chat-visibility', false)

  const directStateIsComplete = result => result.payload.visible
    && result.sampled.text === result.text
    && result.sampled.fullText === result.text
  const streamingStateIsPartial = result => result.payload.visible
    && result.sampled.text.length > 0
    && result.sampled.text.length < result.text.length
    && result.text.startsWith(result.sampled.text)
    && result.sampled.fullText === result.text
  const assertions = {
    modelReady: Boolean(modelReady),
    appOffDisplaysCompleteTextImmediately: directStateIsComplete(appDirect),
    appOnDisplaysTextProgressively: streamingStateIsPartial(appStreaming)
      && appStreaming.completed.text === appStreaming.text,
    externalOffDisplaysCompleteTextImmediately: directStateIsComplete(externalDirect),
    externalOnDisplaysTextProgressively: streamingStateIsPartial(externalStreaming)
      && externalStreaming.completed.text === externalStreaming.text,
    appAndExternalPreferencesAreIndependent: appDirect.preferences.externalStreaming
      && !appDirect.preferences.appStreaming
      && appStreaming.preferences.appStreaming
      && !appStreaming.preferences.externalStreaming
      && externalDirect.preferences.appStreaming
      && !externalDirect.preferences.externalStreaming
      && !externalStreaming.preferences.appStreaming
      && externalStreaming.preferences.externalStreaming,
    everyFinalBubbleKeepsItsFullPayload: [appDirect, appStreaming, externalDirect, externalStreaming]
      .every(result => result.payload.fullText === result.text),
    everyFinalBubbleStillUsesTheCompletionHold: [appDirect, externalDirect]
      .every(result => !result.dismissed.visible && result.visibleLifetimeMs >= 1850)
      && [appStreaming, externalStreaming]
        .every(result => !result.dismissed.visible && result.completionHoldMs >= 1700),
  }
  return {
    generatedAt: new Date().toISOString(),
    outputDirectory,
    scenarios: { appDirect, appStreaming, externalDirect, externalStreaming },
    assertions,
    passed: Object.values(assertions).every(Boolean),
  }
}

async function run() {
  registerIPC()
  await app.whenReady()
  if (messageOutputOnly) snapshot.preferences.chatGreeting = ''
  petWindow = new BrowserWindow({
    width: PET_COLLAPSED_HOST_WIDTH,
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
  await petWindow.webContents.insertCSS('.ai-chat-panel,.ai-message,#long-message-reader{animation:none!important}.interaction-bubble-widget,.status-toast,#pet-stage::after{transition:none!important}#pet-stage.qa-force-detection-frame::after{opacity:1!important}')
  if (messageOutputOnly) {
    const modelLoadStarted = await waitForModelLoadStarted()
    await petWindow.webContents.executeJavaScript('window.__qaReleaseModelLoad()')
    const modelReady = await waitForModel()
    petWindow.showInactive()
    await wait(120)
    const report = await runMessageOutputRuntimeFocused(modelReady)
    report.modelLoadStarted = modelLoadStarted
    report.lastModelStatus = lastModelStatus
    const reportPath = path.join(outputDirectory, 'message-output-runtime.json')
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
    process.stdout.write(JSON.stringify({
      reportPath,
      passed: report.passed,
      assertions: report.assertions,
      completionHoldMs: Object.fromEntries(Object.entries(report.scenarios).map(
        ([name, result]) => [name, result.completionHoldMs]
      )),
      visibleLifetimeMs: Object.fromEntries(Object.entries(report.scenarios).map(
        ([name, result]) => [name, result.visibleLifetimeMs]
      )),
      screenshots: Object.fromEntries(Object.entries(report.scenarios).map(
        ([name, result]) => [name, result.screenshot]
      )),
    }, null, 2))
    petWindow.destroy()
    if (!report.passed) {
      app.exit(1)
      return
    }
    app.quit()
    return
  }
  // Keep the full acceptance suite fast even when it feeds the reader messages
  // close to the 2,000-character contract limit. Voice fixtures still use the
  // real WAV duration and therefore exercise audio-synchronised pacing.
  await petWindow.webContents.executeJavaScript('window.__PET_QA_TYPEWRITER_INTERVAL_MS = 1')
  const greetingModelReadiness = await runGreetingModelReadiness()
  const modelLoaded = greetingModelReadiness.modelLoaded
  const nicknameChatSync = await runNicknameChatSync()
  const results = []
  for (const theme of ['glass', 'healing']) results.push(await runTheme(theme))
  const themeSwitch = await runExpandedThemeSwitch()
  const bubbleThemeFidelity = await runBubbleThemeFidelity()
  const bubbleLifecycle = await runBubbleLifecycle()
  const typewriterLifecycle = await runTypewriterLifecycle()
  const longMessageAudio = await runLongMessageAudio()
  const scaleToastPlacement = await runScaleToastPlacement()
  const scrollBottomStability = await runScrollBottomStability()
  const externalMessagePriority = await runExternalMessagePriority()
  const longMessageAutoExpand = await runLongMessageAutoExpand()
  // Keep the visual reader coverage last so its expanded native-window geometry
  // cannot interfere with the compact bubble scenarios above if a failure occurs.
  const longMessageReader = await runLongMessageReader()
  const detachedLongMessageReader = await runDetachedLongMessageReader()

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
    typewriterLifecycle,
    longMessageAudio,
    scaleToastPlacement,
    scrollBottomStability,
    externalMessagePriority,
    longMessageAutoExpand,
    longMessageReader,
    detachedLongMessageReader,
    passed: greetingModelReadiness.passed
      && nicknameChatSync.passed
      && results.every(result => result.passed)
      && themeSwitch.passed
      && bubbleThemeFidelity.passed
      && bubbleLifecycle.passed
      && typewriterLifecycle.passed
      && longMessageAudio.passed
      && scaleToastPlacement.passed
      && scrollBottomStability.passed
      && externalMessagePriority.passed
      && longMessageAutoExpand.passed
      && longMessageReader.passed
      && detachedLongMessageReader.passed,
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
    typewriterLifecycle: {
      passed: typewriterLifecycle.passed,
      assertions: typewriterLifecycle.assertions,
      plainTextAssertions: typewriterLifecycle.plainTextAssertions,
      screenshots: typewriterLifecycle.screenshots,
    },
    longMessageAudio: {
      passed: longMessageAudio.passed,
      assertions: longMessageAudio.assertions,
      sources: longMessageAudio.sources.map(source => ({
        source: source.source,
        passed: source.passed,
        assertions: source.assertions,
        screenshots: source.screenshots,
      })),
    },
    scaleToastPlacement: { passed: scaleToastPlacement.passed, assertions: scaleToastPlacement.assertions, screenshots: scaleToastPlacement.screenshots },
    externalMessagePriority,
    longMessageAutoExpand: {
      passed: longMessageAutoExpand.passed,
      assertions: longMessageAutoExpand.assertions,
      screenshots: longMessageAutoExpand.screenshots,
    },
    longMessageReader: {
      passed: longMessageReader.passed,
      expectedCharacterCount: longMessageReader.expectedCharacterCount,
      crossThemeAssertions: longMessageReader.crossThemeAssertions,
      themes: longMessageReader.themes.map(theme => ({
        theme: theme.theme,
        passed: theme.passed,
        assertions: theme.assertions,
        windowBounds: theme.windowBounds,
        reportedOpenBounds: theme.reportedOpenBounds,
        copiedTextLength: theme.copiedTextLength,
        screenshots: theme.screenshots,
      })),
    },
    detachedLongMessageReader,
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
