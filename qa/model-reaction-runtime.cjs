const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const os = require('os')
const { pathToFileURL } = require('url')

const projectRoot = path.resolve(__dirname, '..')
const modelCases = [
  { id: 'cafe-gun', archive: 'cafe-gun.zip' },
  { id: 'hiyori', archive: 'Hiyori.zip' },
  // Same ZIP under an unmapped id proves that standards-compliant ZIP groups and
  // native expressions remain available when no product mapping exists.
  {
    id: 'hiyori-unmapped',
    sourceId: 'hiyori',
    archive: 'Hiyori.zip',
    actionId: 'group:PetGreet:0',
    expressionId: 'native:expressions/微笑.exp3.json',
  },
  { id: 'mao_pro', archive: 'mao_pro.zip' },
  { id: 'mori-suit', archive: 'mori-suit.zip' },
]

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.commandLine.appendSwitch('disable-gpu')
app.setPath('userData', path.join(os.tmpdir(), 'live2d-model-reaction-runtime-qa-userdata'))

const preferences = {
  scale: 1,
  cursorFollow: 'off',
  effects: 'off',
  interactionMode: 'smart',
  idleEnabled: false,
  qualityMode: 'eco',
  alwaysOnTop: false,
  launchAtLogin: false,
  reducedMotion: 'off',
  onboardingSeen: true,
  backgroundDetection: false,
  settingsPetBackground: false,
  settingsTheme: 'glass',
  bubbleStyles: { glass: 'glass', healing: 'glass' },
  chatGreeting: '',
}

let activeSnapshot = null
let activeStatus = null
let activeAssets = null
let activePreviewResults = new Map()
const qaWindows = []

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function registerIPC() {
  let longMessageLayoutRevision = 0
  const resolveLongMessageLayout = (payload = {}) => {
    const expanded = Boolean(payload && payload.open)
    return {
      expanded,
      side: expanded ? 'right' : 'none',
      mode: expanded ? 'right' : 'collapsed',
      readerWidth: expanded ? 356 : 0,
      gap: 14,
      stageOffsetX: 0,
      readerOffsetX: expanded ? 414 : 0,
      outerWidth: expanded ? 770 : 400,
      outerHeight: 600,
      stageWidth: 400,
      stageHeight: 600,
      revision: ++longMessageLayoutRevision,
    }
  }

  ipcMain.handle('state:get-snapshot', () => structuredClone(activeSnapshot))
  ipcMain.handle('settings:update', () => structuredClone(activeSnapshot))
  ipcMain.handle('model:select', () => ({ ok: true, snapshot: structuredClone(activeSnapshot) }))
  ipcMain.handle('model:scale-update', () => ({ ok: true, snapshot: structuredClone(activeSnapshot) }))
  ipcMain.handle('ai:chat', () => ({ ok: false }))
  ipcMain.handle('ai:speech-synthesize', () => ({ ok: false, skipped: true }))
  ipcMain.handle('ai:conversation-get', () => [])
  ipcMain.handle('ai:conversation-clear', () => true)
  ipcMain.handle('pet:long-message-layout', (_event, payload) => resolveLongMessageLayout(payload))
  ipcMain.on('pet:long-message-layout-preview', (event, payload) => {
    event.returnValue = resolveLongMessageLayout(payload)
  })
  ipcMain.on('pet:long-message-layout-commit', (event, payload) => {
    event.returnValue = resolveLongMessageLayout(payload)
  })
  ipcMain.handle('pet:long-message-transition-frame', () => '')
  ipcMain.on('pet:long-message-transition-state', (event, active) => {
    event.returnValue = Boolean(active)
  })
  ipcMain.on('model:report-status', (_event, status) => { activeStatus = status })
  ipcMain.on('model:assets-report', (_event, assets) => { activeAssets = assets })
  ipcMain.on('model:preview-result', (_event, result) => {
    if (result && result.requestId) activePreviewResults.set(result.requestId, result)
  })
}

async function waitUntil(predicate, timeoutMs, label) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const result = predicate()
    if (result) return result
    await wait(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function previewAsset(win, modelId, kind, asset) {
  const requestId = `${modelId}-${kind}-${Date.now()}`
  win.webContents.send('model:preview', { requestId, modelId, kind, asset })
  const result = await waitUntil(() => activePreviewResults.get(requestId), 5000, `${modelId} ${kind} preview`)
  const preview = result.preview && typeof result.preview === 'object'
    ? { ...result.preview, frameGenerated: Boolean(result.preview.frame) }
    : result.preview
  if (preview && typeof preview === 'object') delete preview.frame
  return { ...result, preview }
}

function summarizePreviews(results, requireParameterChange = false) {
  const noChange = results
    .filter(item => item.result?.ok && Number(item.result.preview?.changedParameters) === 0)
    .map(item => ({
      id: item.id,
      resourceParameters: Number(item.result.preview?.expressionParameterCount) || 0,
      matchedResourceParameters: Number(item.result.preview?.matchedExpressionParameterCount) || 0,
    }))
  return {
    tested: results.length,
    passed: results.filter(item => item.result?.ok).length,
    noChange,
    failures: results
      .filter(item => !item.result?.ok)
      .map(item => ({ id: item.id, error: item.result?.error || 'unknown preview error' })),
    effective: !requireParameterChange || noChange.length === 0,
  }
}

async function runModelCase(modelCase) {
  process.stdout.write(`QA loading ${modelCase.id}\n`)
  activeStatus = null
  activeAssets = null
  activePreviewResults = new Map()
  const archivePath = path.join(projectRoot, 'models', modelCase.sourceId || modelCase.id, modelCase.archive)
  const modelMeta = {
    id: modelCase.id,
    name: modelCase.id,
    displayName: modelCase.id,
    path: pathToFileURL(archivePath).href,
    format: 'zip',
    cubismVersion: 3,
    status: 'ready',
    statusMessage: '',
  }
  activeSnapshot = {
    appVersion: '1.0.1',
    currentModelId: modelCase.id,
    models: [modelMeta],
    covers: {},
    preferences,
    ai: { ready: false, readyByCapability: { chat: false, tts: false }, activePluginIds: { chat: '', tts: '' }, plugins: [] },
    runtime: { phase: 'loading', modelId: modelCase.id, message: '', paused: false, petVisible: true },
  }

  const consoleMessages = []
  const win = new BrowserWindow({
    width: 400,
    height: 600,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(projectRoot, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
      webSecurity: false,
      backgroundThrottling: false,
    },
  })
  // Keep earlier windows alive until every model is checked. Destroying the only
  // BrowserWindow can put Electron into its shutdown path before the next case.
  qaWindows.push(win)
  win.webContents.on('console-message', details => {
    if (/failed|error|missing/i.test(details.message)) consoleMessages.push(details.message)
  })

  // Use an explicit URL so Windows path separators are normalized before the
  // renderer begins loading ZIP resources.
  await win.loadURL(pathToFileURL(path.join(projectRoot, 'renderer', 'index.html')).href)
  process.stdout.write(`QA loaded page for ${modelCase.id}\n`)
  await waitUntil(() => activeStatus?.phase === 'ready' || activeStatus?.phase === 'error', 20000, `${modelCase.id} load`)
  if (activeStatus?.phase !== 'ready') throw new Error(`${modelCase.id} failed to load: ${activeStatus?.message || 'unknown error'}`)
  await waitUntil(() => activeAssets?.modelId === modelCase.id, 3000, `${modelCase.id} asset catalog`)
  // A hidden BrowserWindow may deliver its first animation callback late. Let the
  // model finish one normal scheduler cycle before judging the first zero-based
  // motion curve, otherwise a valid idle can be sampled only at its t=0 value.
  await wait(450)

  const actions = modelCase.actionId
    ? activeAssets.actions.filter(item => item.id === modelCase.actionId)
    : activeAssets.actions
  const expressions = modelCase.expressionId
    ? activeAssets.expressions.filter(item => item.id === modelCase.expressionId)
    : activeAssets.expressions
  if (modelCase.actionId && !actions.length) {
    throw new Error(`${modelCase.id} action missing from catalog: ${modelCase.actionId}`)
  }
  if (modelCase.expressionId && !expressions.length) {
    throw new Error(`${modelCase.id} expression missing from catalog: ${modelCase.expressionId}`)
  }

  const actionResults = []
  for (const action of actions) {
    actionResults.push({ id: action.id, result: await previewAsset(win, modelCase.id, 'action', action) })
  }
  const expressionResults = []
  for (const expression of expressions) {
    expressionResults.push({ id: expression.id, result: await previewAsset(win, modelCase.id, 'expression', expression) })
  }
  const requireParameterChange = modelCase.id === 'mori-suit'
  const actionPreviews = summarizePreviews(actionResults, requireParameterChange)
  const expressionPreviews = summarizePreviews(expressionResults, requireParameterChange)

  return {
    modelId: modelCase.id,
    status: activeStatus,
    actionCount: activeAssets.actions.length,
    expressionCount: activeAssets.expressions.length,
    actionPreviews,
    expressionPreviews,
    consoleMessages,
    passed: Boolean(
      actionPreviews.tested && actionPreviews.passed === actionPreviews.tested &&
      expressionPreviews.passed === expressionPreviews.tested &&
      actionPreviews.effective && expressionPreviews.effective &&
      consoleMessages.length === 0
    ),
  }
}

async function run() {
  registerIPC()
  await app.whenReady()
  const models = []
  const selectedCases = process.env.QA_MODEL_ID
    ? modelCases.filter(modelCase => modelCase.id === process.env.QA_MODEL_ID)
    : modelCases
  if (!selectedCases.length) throw new Error(`Unknown QA_MODEL_ID: ${process.env.QA_MODEL_ID}`)
  for (const modelCase of selectedCases) models.push(await runModelCase(modelCase))
  const report = { passed: models.every(model => model.passed), models }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  for (const win of qaWindows) if (!win.isDestroyed()) win.destroy()
  app.exit(report.passed ? 0 : 1)
}

run().catch(error => {
  console.error(error)
  for (const win of qaWindows) if (!win.isDestroyed()) win.destroy()
  app.exit(1)
})
