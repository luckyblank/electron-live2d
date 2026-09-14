const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const outDir = __dirname
const htmlPath = path.join(outDir, 'live2d-companion-prototype.html')

app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.setPath('userData', path.join(os.tmpdir(), 'live2d-companion-prototype-qa'))

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

async function capture(win, name, width, height) {
  win.setSize(width, height)
  await evaluate(win, `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
  win.webContents.invalidate()
  await delay(520)
  const image = await win.capturePage()
  const target = path.join(outDir, name)
  fs.writeFileSync(target, image.toPNG())
  return { name, width: image.getSize().width, height: image.getSize().height, bytes: image.toPNG().length }
}

async function evaluate(win, source) {
  return win.webContents.executeJavaScript(source, true)
}

app.whenReady().then(async () => {
  const errors = []
  const consoleErrors = []
  const screenshots = []
  const flows = {}
  let win

  try {
    win = new BrowserWindow({
      width: 1600,
      height: 1100,
      show: false,
      backgroundColor: '#e9ebff',
      webPreferences: {
        backgroundThrottling: false,
        offscreen: true,
        paintWhenInitiallyHidden: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    win.webContents.on('console-message', (_event, level, message) => {
      if (level >= 2) consoleErrors.push(message)
    })
    win.webContents.on('render-process-gone', (_event, details) => errors.push(`render-process-gone: ${details.reason}`))
    win.webContents.on('did-fail-load', (_event, code, description) => errors.push(`did-fail-load ${code}: ${description}`))

    await win.loadFile(htmlPath)
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await evaluate(win, 'Boolean(window.__prototypeReady)')) break
      await delay(50)
    }
    await evaluate(win, 'window.prototypeAPI.reset()')
    await delay(900)

    const initial = await evaluate(win, `(() => ({
      ready: Boolean(window.__prototypeReady),
      state: window.prototypeAPI.getState(),
      windowRect: (() => { const r = document.querySelector('.app-window').getBoundingClientRect(); return { width: r.width, height: r.height }; })(),
      appOverflowX: document.querySelector('.app-main').scrollWidth > document.querySelector('.app-main').clientWidth,
      brokenImages: [...document.images].filter(img => !img.complete || img.naturalWidth === 0).map(img => img.getAttribute('src')),
      video: (() => { const video = document.getElementById('pet-video'); return { error: video.error ? video.error.message : '', readyState: video.readyState, source: video.getAttribute('src') }; })(),
      tabs: [...document.querySelectorAll('.section-tab')].map(button => button.textContent.trim()),
      overviewCount: document.querySelectorAll('[data-overview]').length,
      focusableCount: document.querySelectorAll('button,input,select,textarea').length,
      persisted: Boolean(localStorage.getItem('live2d-companion-design-prototype-v1'))
    }))()`)

    if (!initial.ready) errors.push('prototype readiness flag missing')
    if (initial.windowRect.width !== 470 || initial.windowRect.height !== 760) errors.push(`unexpected app window size ${initial.windowRect.width}x${initial.windowRect.height}`)
    if (initial.appOverflowX) errors.push('app content has horizontal overflow')
    if (initial.brokenImages.length) errors.push(`broken images: ${initial.brokenImages.join(', ')}`)
    if (initial.video.error) errors.push(`video error: ${initial.video.error}`)
    if (!initial.persisted) errors.push('prototype state was not persisted')
    if (initial.tabs.join(',') !== '角色,行为,AI,系统') errors.push(`unexpected tabs: ${initial.tabs.join(',')}`)
    if (initial.overviewCount !== 4) errors.push(`expected 4 overview cards, got ${initial.overviewCount}`)

    await evaluate(win, `window.prototypeAPI.setTheme('glass'); window.prototypeAPI.setMode('interactive'); window.prototypeAPI.setSection('character')`)
    screenshots.push(await capture(win, 'live2d-companion-character.png', 1440, 900))

    await evaluate(win, `document.querySelector('[data-action="model"][data-value="hiyori"]').click()`)
    flows.character = await evaluate(win, `(() => { const state = window.prototypeAPI.getState(); return { model: state.model, nickname: state.nickname, placeholderVisible: getComputedStyle(document.getElementById('pet-placeholder')).display !== 'none' }; })()`)
    if (flows.character.model !== 'hiyori' || !flows.character.placeholderVisible) errors.push('character switching flow failed')

    await evaluate(win, `document.querySelector('[data-action="model"][data-value="deepseek"]').click()`)

    await evaluate(win, `window.prototypeAPI.setSection('behavior'); document.querySelector('[data-action="preset"][data-value="quiet"]').click()`)
    flows.behavior = await evaluate(win, `({ ...window.prototypeAPI.getState(), renderedPage: document.querySelector('.page-scroll')?.dataset.page })`)
    if (flows.behavior.preset !== 'quiet' || flows.behavior.cursorFollow || flows.behavior.randomMotion || flows.behavior.renderedPage !== 'behavior') errors.push('quiet preset flow failed')
    screenshots.push(await capture(win, 'live2d-companion-behavior.png', 1440, 900))

    await evaluate(win, `window.prototypeAPI.setSection('ai'); document.querySelector('[data-action="connect-test"]').click()`)
    await delay(1100)
    flows.ai = await evaluate(win, `({ ...window.prototypeAPI.getState(), renderedPage: document.querySelector('.page-scroll')?.dataset.page })`)
    if (flows.ai.aiTest !== 'success' || flows.ai.renderedPage !== 'ai') errors.push('AI connection simulation failed')
    await evaluate(win, `document.querySelector('[data-action="bubble"][data-value="sweet"]').click()`)
    flows.bubble = await evaluate(win, `window.prototypeAPI.getState().bubble`)
    if (flows.bubble !== 'sweet') errors.push('bubble switching flow failed')
    await evaluate(win, `document.querySelector('[data-action="open-chat"]').click()`)
    flows.chat = await evaluate(win, `({ open: document.getElementById('modal-layer').classList.contains('open'), initialMessages: document.querySelectorAll('#chat-log .message').length })`)
    if (!flows.chat.open || flows.chat.initialMessages < 3) errors.push('chat modal flow failed')
    await evaluate(win, `document.getElementById('chat-input').value = '陪我安静一会儿'; document.querySelector('[data-action="chat-send"]').click()`)
    flows.chat.afterSendMessages = await evaluate(win, `document.querySelectorAll('#chat-log .message').length`)
    if (flows.chat.afterSendMessages < flows.chat.initialMessages + 2) errors.push('chat send simulation failed')
    await evaluate(win, `document.querySelector('[data-action="close-modal"]').click(); document.querySelector('[data-action="ai-capability"][data-value="tts"]').click(); document.querySelector('[data-action="voice-preview"]').click()`)
    flows.voice = await evaluate(win, `({ capability: window.prototypeAPI.getState().aiCapability, speaking: document.getElementById('pet-visual').classList.contains('is-speaking') })`)
    if (flows.voice.capability !== 'tts' || !flows.voice.speaking) errors.push('voice preview simulation failed')
    await evaluate(win, `document.querySelector('[data-action="ai-capability"][data-value="chat"]').click()`)
    screenshots.push(await capture(win, 'live2d-companion-ai.png', 1440, 900))

    await evaluate(win, `window.prototypeAPI.setSection('system'); document.querySelector('[data-action="theme"][data-value="healing"]').click()`)
    flows.system = await evaluate(win, `({ ...window.prototypeAPI.getState(), renderedPage: document.querySelector('.page-scroll')?.dataset.page })`)
    if (flows.system.theme !== 'healing' || flows.system.renderedPage !== 'system') errors.push('theme switching flow failed')
    await evaluate(win, `document.querySelector('[data-action="update"]').click()`)
    await delay(2600)
    flows.update = await evaluate(win, `window.prototypeAPI.getState().updatePhase`)
    if (flows.update !== 'ready') errors.push('update simulation failed')
    await evaluate(win, `document.querySelector('[data-action="reset-settings"]').click()`)
    flows.resetConfirm = await evaluate(win, `({ open: document.getElementById('modal-layer').classList.contains('open'), confirm: Boolean(document.querySelector('[data-action="confirm-reset"]')) })`)
    if (!flows.resetConfirm.open || !flows.resetConfirm.confirm) errors.push('reset confirmation flow failed')
    await evaluate(win, `document.querySelector('[data-action="close-modal"]').click()`)
    screenshots.push(await capture(win, 'live2d-companion-system.png', 1440, 900))

    await evaluate(win, `window.prototypeAPI.setReduced(true)`)
    flows.reduced = await evaluate(win, `({ state: window.prototypeAPI.getState().reduced, body: document.body.dataset.reduced })`)
    if (!flows.reduced.state || flows.reduced.body !== 'true') errors.push('reduced motion flow failed')

    await evaluate(win, `window.prototypeAPI.setReduced(false); window.prototypeAPI.setTheme('glass'); window.prototypeAPI.setSection('character'); document.querySelector('[data-action="model"][data-value="deepseek"]').click(); window.prototypeAPI.setMode('overview')`)
    screenshots.push(await capture(win, 'live2d-companion-overview.png', 1600, 1100))
    flows.overview = await evaluate(win, `({ mode: window.prototypeAPI.getState().mode, cards: document.querySelectorAll('[data-overview]').length, visible: getComputedStyle(document.querySelector('.overview-layout')).display !== 'none' })`)
    if (flows.overview.mode !== 'overview' || flows.overview.cards !== 4 || !flows.overview.visible) errors.push('overview mode failed')

    const report = {
      passed: errors.length === 0 && consoleErrors.length === 0,
      htmlPath,
      checkedAt: new Date().toISOString(),
      initial,
      flows,
      screenshots,
      errors,
      consoleErrors,
    }
    fs.writeFileSync(path.join(outDir, 'prototype-verification.json'), JSON.stringify(report, null, 2))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.passed) process.exitCode = 1
  } catch (error) {
    errors.push(error.stack || error.message)
    fs.writeFileSync(path.join(outDir, 'prototype-verification.json'), JSON.stringify({ passed: false, errors, consoleErrors }, null, 2))
    process.stderr.write(`${error.stack || error.message}\n`)
    process.exitCode = 1
  } finally {
    if (win && !win.isDestroyed()) win.destroy()
    app.quit()
  }
})
