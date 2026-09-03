;(async function() {
  const { Live2DCubismModel } = require('live2d-renderer')
  const canvas = document.getElementById('c')
  const fxLayer = document.getElementById('fx-layer')

  // ── Canvas sizing ──────────────────────────────────
  let _lastCW = 0, _lastCH = 0
  function resizeCanvas() {
    const w = document.documentElement.clientWidth
    const h = document.documentElement.clientHeight
    const changed = w !== _lastCW || h !== _lastCH
    _lastCW = w
    _lastCH = h
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    canvas.width = Math.max(1, Math.floor(w))
    canvas.height = Math.max(1, Math.floor(h))
    return changed
  }
  window.addEventListener('resize', () => {
    if (!resizeCanvas()) return
    if (model && model.loaded) {
      if (typeof model.centerModel === 'function') {
        model.centerModel()
      }
      applyVerticalOffset(model)
    }
  })
  resizeCanvas()

  // ── Fix: Node.js path module produces backslashes on Windows ──
  try {
    const p = require('path')
    const _join = p.join
    const _dirname = p.dirname
    const _basename = p.basename
    const _extname = p.extname
    const fwd = (s) => (typeof s === 'string' ? s.replace(/\\/g, '/') : s)
    p.join = function (...args) { return fwd(_join.apply(p, args)) }
    p.dirname = function (arg) { return fwd(_dirname.call(p, arg)) }
    p.basename = function (arg, ext) { return fwd(_basename.call(p, arg, ext)) }
    p.extname = function (arg) { return fwd(_extname.call(p, arg)) }
  } catch (e) { console.warn('path fix failed:', e.message) }

  // ── Model (created on demand) ───────────────────────
  let model = null

  // Nudge model up slightly after centering for better visual positioning
  const VERTICAL_OFFSET = 1.0  // 1.0 = no offset; centerModel() handles positioning
  function applyVerticalOffset(m) { m.y = m.y * VERTICAL_OFFSET }

  function createModelInstance() {
    const m = new Live2DCubismModel(canvas, {
      cubismCorePath: window.petAPI.cubismCorePath,
      autoAnimate: true,
      autoInteraction: true,
      tapInteraction: true,
      randomMotion: true,
      enablePhysics: true,
      enableEyeblink: true,
      enableBreath: true,
      enableMovement: false,
      enablePose: true,
      premultipliedAlpha: true,
      scale: 1,
    })

    // Fix: Cubism Core with nodeIntegration=true
    const _origLoadCC = m.loadCubismCore.bind(m)
    m.loadCubismCore = async function () {
      await _origLoadCC()
      try {
        const { fileURLToPath } = require('url')
        const corePath = fileURLToPath(window.petAPI.cubismCorePath)
        const api = require(corePath)
        if (api && api._malloc) {
          window.Live2DCubismCore = api
        }
      } catch (e) { console.warn('Cubism Core fix failed:', e.message) }
    }

    return m
  }

  // ── State ──────────────────────────────────────────
  let clickStart = null          // { sx, sy, cx, cy, time }
  let lastClickTime = 0
  let clickCount = 0
  let cursorNearPet = false
  let isDragging = false
  let mouseDown = false
  let mouseCaptureEnabled = false
  let clickThroughEnabled = false

  // Idle tracking
  let lastInteractionTime = Date.now()
  let idleStage = 0

  // Cursor follow
  let cursorOffset = { x: 0, y: 0 }
  let followTarget = { x: 0, y: 0 }
  let currentLean = { x: 0, y: 0 }

  // ── Constants ──────────────────────────────────────
  const COLORS = ['#FF6B6B','#FFE66D','#4ECDC4','#FF8E72','#A78BFA','#F472B6','#67E8F9','#34D399','#FB923C']
  const BUBBLES_GREET = ['你好呀~','嗨！','今天天气不错呢','来玩吧！','(◕‿◕)']
  const BUBBLES_HAPPY = ['嘻嘻','好开心！','耶~','好舒服~','❤','✨','再点一下！']
  const BUBBLES_ANNOYED = ['哼！','别弄了啦~','呜...','好痒！','呀！！','不要嘛~']
  const BUBBLES_IDLE = ['好无聊哦...','有人吗？','发发呆...','嗯？','呼...']
  const BUBBLES_SLEEPY = ['有点困了...','zzZ...','眼皮好重...','打个盹...']
  const EMOTES_LOVE = ['❤️','💕','💝','🥰','😍']
  const EMOTES_HAPPY = ['✨','🌟','💫','🎀','🎵','🌈']
  const EMOTES_SHOCK = ['💦','😱','💢','😤','💥']
  const STARS = ['✦','✧','⋆','·','✶']

  // ── FX helpers ─────────────────────────────────────
  function rand(arr) { return arr[Math.floor(Math.random() * arr.length)] }

  function fxBubble(x, y, text) {
    const el = document.createElement('div')
    el.className = 'bubble'
    el.textContent = text
    el.style.left = x + 'px'
    el.style.top = y + 'px'
    fxLayer.appendChild(el)
    setTimeout(() => el.remove(), 2900)
  }

  function fxEmote(x, y, emoji) {
    const el = document.createElement('div')
    el.className = 'emote'
    el.textContent = emoji || rand(EMOTES_HAPPY)
    el.style.left = (x - 22) + 'px'
    el.style.top = (y - 22) + 'px'
    fxLayer.appendChild(el)
    setTimeout(() => el.remove(), 1700)
  }

  function fxParticles(x, y, count, sizeRange) {
    const [minS, maxS] = sizeRange || [5, 10]
    for (let i = 0; i < (count || 8); i++) {
      const p = document.createElement('div')
      p.className = 'particle'
      p.style.left = x + 'px'
      p.style.top = y + 'px'
      p.style.width = (minS + Math.random() * (maxS - minS)) + 'px'
      p.style.height = p.style.width
      p.style.background = rand(COLORS)
      const angle = Math.random() * Math.PI * 2
      const dist = 20 + Math.random() * 50
      p.style.setProperty('--tx', Math.cos(angle) * dist + 'px')
      p.style.setProperty('--ty', Math.sin(angle) * dist + 'px')
      fxLayer.appendChild(p)
      setTimeout(() => p.remove(), 800)
    }
  }

  function fxStars(x, y, count) {
    for (let i = 0; i < (count || 5); i++) {
      const s = document.createElement('div')
      s.className = 'star'
      s.textContent = rand(STARS)
      s.style.left = x + 'px'
      s.style.top = y + 'px'
      s.style.color = rand(COLORS)
      const angle = Math.random() * Math.PI * 2
      const dist = 25 + Math.random() * 45
      s.style.setProperty('--tx', Math.cos(angle) * dist + 'px')
      s.style.setProperty('--ty', Math.sin(angle) * dist + 'px')
      fxLayer.appendChild(s)
      setTimeout(() => s.remove(), 1100)
    }
  }

  function fxZzz(x, y) {
    const el = document.createElement('div')
    el.className = 'zzz'
    el.textContent = 'z'.repeat(2 + Math.floor(Math.random() * 3))
    el.style.left = x + 'px'
    el.style.top = y + 'px'
    fxLayer.appendChild(el)
    setTimeout(() => el.remove(), 2600)
  }

  function shakeCanvas() {
    canvas.classList.remove('shake')
    void canvas.offsetWidth
    canvas.classList.add('shake')
  }

  // ── Hit testing ────────────────────────────────────
  function screenToModel(sx, sy) {
    const rect = canvas.getBoundingClientRect()
    const scale = (model && model.scale) || 1
    return { x: (sx - rect.left) / scale, y: (sy - rect.top) / scale }
  }

  function isOnPet(clientX, clientY) {
    if (!model || !model.loaded) return false
    try {
      const m = screenToModel(clientX, clientY)
      return model.hitTest('body', m.x, m.y)
    } catch (_) { return false }
  }

  function hitPart(clientX, clientY) {
    if (!model || !model.loaded) return null
    try {
      const m = screenToModel(clientX, clientY)
      if (model.hitTest('head', m.x, m.y)) return 'head'
      if (model.hitTest('body', m.x, m.y)) return 'body'
      return null
    } catch (_) { return null }
  }

  function petScreenPos() {
    if (!model) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return { x: rect.left + model.x - 10, y: rect.top + model.y - 120 }
  }

  // ── Click-through + manual drag ───────────────────
  // Transparent areas pass mouse events to windows behind (taskbar, desktop).
  // When the cursor is over the model or UI panel, re-enable mouse capture.
  function shouldCaptureMouse(clientX, clientY) {
    const panelEl = document.getElementById('control-panel')
    const toggleEl = document.getElementById('panel-toggle')
    if (panelEl && panelEl.classList.contains('active')) {
      const r = panelEl.getBoundingClientRect()
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return true
    }
    if (toggleEl) {
      const r = toggleEl.getBoundingClientRect()
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return true
    }
    if (isOnPet(clientX, clientY)) return true
    return false
  }

  function updateMouseCapture(clientX, clientY) {
    if (!clickThroughEnabled || mouseDown) return
    const capture = shouldCaptureMouse(clientX, clientY)
    if (capture !== mouseCaptureEnabled) {
      mouseCaptureEnabled = capture
      window.petAPI.setIgnoreMouseEvents(!capture)
    }
  }

  // Track mousemove globally: handles both click-through detection and dragging.
  // mousemove events are forwarded even when setIgnoreMouseEvents is true.
  document.addEventListener('mousemove', (e) => {
    if (mouseDown && clickStart) {
      const dx = e.screenX - clickStart.sx
      const dy = e.screenY - clickStart.sy
      if (!isDragging) {
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
          isDragging = true
          window.petAPI.dragStart()
        }
      }
      if (isDragging) {
        window.petAPI.dragTo(dx, dy)
      }
      return
    }
    updateMouseCapture(e.clientX, e.clientY)
  })

  // Safety: reset drag state if window loses focus mid-drag
  window.addEventListener('blur', () => {
    if (isDragging) {
      window.petAPI.dragEnd()
      isDragging = false
    }
    mouseDown = false
    clickStart = null
    if (clickThroughEnabled) {
      mouseCaptureEnabled = false
      window.petAPI.setIgnoreMouseEvents(true)
    }
  })

  // ── Cursor follow (head/eye tracking) ──────────────
  function updateCursorFollow() {
    if (!model || !model.loaded) return
    const speed = 0.08
    followTarget.x += (cursorOffset.x - followTarget.x) * speed
    followTarget.y += (cursorOffset.y - followTarget.y) * speed

    const maxDist = 600
    const nx = Math.max(-1, Math.min(1, followTarget.x / maxDist))
    const ny = Math.max(-1, Math.min(1, followTarget.y / maxDist))

    currentLean.x += (nx - currentLean.x) * 0.06
    currentLean.y += (ny - currentLean.y) * 0.06

    // Skip expensive param writes when cursor is still and model has settled
    const settled = Math.abs(cursorOffset.x - followTarget.x) < 0.5 &&
                    Math.abs(cursorOffset.y - followTarget.y) < 0.5 &&
                    Math.abs(nx - currentLean.x) < 0.001 &&
                    Math.abs(ny - currentLean.y) < 0.001
    if (settled) return

    try {
      const im = model.internalModel
      if (im) {
        const setParam = (id, val, weight) => {
          try { im.setParameterValueById(id, val, weight) } catch(_) {}
        }
        setParam('ParamAngleX', currentLean.x * 30, 0.5)
        setParam('ParamAngleY', currentLean.y * 10, 0.3)
        setParam('ParamEyeBallX', currentLean.x, 0.6)
        setParam('ParamEyeBallY', currentLean.y * 0.5, 0.4)
        setParam('ParamBodyAngleX', currentLean.x * 10, 0.3)
      }
    } catch(_) {}
  }

  // ── Idle system ────────────────────────────────────
  function resetIdle() {
    lastInteractionTime = Date.now()
    idleStage = 0
  }

  function checkIdleStage() {
    const elapsed = (Date.now() - lastInteractionTime) / 1000
    if (elapsed > 120 && idleStage < 3) { idleStage = 3; idleStageEnter(3) }
    else if (elapsed > 60 && idleStage < 2) { idleStage = 2; idleStageEnter(2) }
    else if (elapsed > 30 && idleStage < 1) { idleStage = 1; idleStageEnter(1) }
  }

  function idleStageEnter(stage) {
    if (!model || !model.loaded) return
    const pet = petScreenPos()
    switch (stage) {
      case 1: fxBubble(pet.x - 20, pet.y - 30, rand(BUBBLES_IDLE)); break
      case 2:
        fxBubble(pet.x - 10, pet.y - 25, rand(BUBBLES_SLEEPY))
        fxZzz(pet.x + 40, pet.y - 50)
        break
      case 3:
        fxZzz(pet.x + 30, pet.y - 40)
        setTimeout(() => fxZzz(pet.x + 50, pet.y - 55), 2000)
        break
    }
  }

  setInterval(() => { if (document.hidden) return; if (model && model.loaded) checkIdleStage() }, 5000)

  // ── Click handling (via mousedown/mouseup timing) ──
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    clickStart = {
      sx: e.screenX, sy: e.screenY,
      cx: e.clientX, cy: e.clientY,
      time: Date.now(),
    }
    mouseDown = true
    isDragging = false
  })

  document.addEventListener('mouseup', (e) => {
    if (!clickStart) return

    // If this was a drag, finalize window move and skip click logic
    if (isDragging) {
      window.petAPI.dragEnd()
      isDragging = false
      mouseDown = false
      clickStart = null
      updateMouseCapture(e.clientX, e.clientY)
      return
    }
    mouseDown = false

    const ds = Math.abs(e.screenX - clickStart.sx) + Math.abs(e.screenY - clickStart.sy)
    const dt = Date.now() - clickStart.time

    if (ds < 5 && dt < 400) {
      // ── It was a click (not a drag) ────────────────
      if (!isOnPet(clickStart.cx, clickStart.cy)) {
        clickStart = null
        return
      }
      resetIdle()

      const now = Date.now()
      clickCount = (now - lastClickTime < 400) ? clickCount + 1 : 1
      lastClickTime = now

      const rect = canvas.getBoundingClientRect()
      const lx = clickStart.cx - rect.left
      const ly = clickStart.cy - rect.top
      const mx = (lx - model.x) / model.scale
      const my = (ly - model.y) / model.scale
      const part = hitPart(clickStart.cx, clickStart.cy)
      const pet = petScreenPos()

      if (clickCount >= 3) {
        model.startRandomMotion(null, 3)
        fxEmote(pet.x + 20, pet.y, rand(EMOTES_LOVE))
        fxStars(pet.x + 35, pet.y + 10, 14)
        fxParticles(pet.x + 30, pet.y + 30, 20)
        fxBubble(pet.x - 35, pet.y - 50, '啊啊啊！！')
        clickCount = 0
        shakeCanvas()
      } else if (clickCount >= 2) {
        model.startRandomMotion(null, 2)
        fxEmote(pet.x + 10, pet.y, rand(EMOTES_HAPPY))
        fxParticles(pet.x + 40, pet.y + 20, 14)
        fxBubble(pet.x - 30, pet.y - 45, part === 'head' ? '呀！！' : '干嘛呀~')
        clickCount = 0
      } else {
        model.touchController.tap(mx, my)
        if (part === 'head') {
          fxEmote(pet.x + 20, pet.y, rand(EMOTES_LOVE))
          fxParticles(pet.x + 40, pet.y - 10, 8, [3, 7])
          if (Math.random() < 0.4) fxBubble(pet.x - 20, pet.y - 50, rand(BUBBLES_HAPPY))
        } else {
          fxParticles(pet.x + 30, pet.y + 30, 6)
          if (Math.random() < 0.35) fxBubble(pet.x - 20, pet.y - 50, Math.random() < 0.5 ? rand(BUBBLES_HAPPY) : rand(BUBBLES_ANNOYED))
        }
      }
    }

    clickStart = null
  })

  // ── Right click ────────────────────────────────────
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    if (isOnPet(e.clientX, e.clientY)) {
      resetIdle()
      const pet = petScreenPos()
      const part = hitPart(e.clientX, e.clientY)
      fxEmote(pet.x + 10, pet.y, '💢')
      fxBubble(pet.x - 20, pet.y - 45, part === 'head' ? '别点这里！' : '哼！不要！')
      shakeCanvas()
      try { model.startRandomMotion(null, 1) } catch(_) {}
    }
  })

  // ── Keyboard shortcuts ─────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (!model || !model.loaded) return
    const pet = petScreenPos()
    resetIdle()
    switch (e.key.toLowerCase()) {
      case 'h':
        fxEmote(pet.x + 10, pet.y, rand(EMOTES_LOVE))
        fxParticles(pet.x + 30, pet.y + 30, 12)
        try { model.startRandomMotion(null, 2) } catch(_) {}
        break
      case 's':
        fxEmote(pet.x + 10, pet.y, rand(EMOTES_SHOCK))
        fxBubble(pet.x - 20, pet.y - 40, '哇！')
        shakeCanvas()
        break
      case 'b':
        fxBubble(pet.x - 20, pet.y - 40, rand(BUBBLES_HAPPY))
        break
      case 'f':
        fxEmote(pet.x + 10, pet.y, rand(EMOTES_LOVE))
        fxStars(pet.x + 30, pet.y + 10, 10)
        fxParticles(pet.x + 25, pet.y + 35, 16)
        fxBubble(pet.x - 30, pet.y - 50, '好开心！！')
        try { model.startRandomMotion(null, 3) } catch(_) {}
        break
    }
  })

  // ── Control Panel ──────────────────────────
  const panel = document.getElementById('control-panel')
  const panelToggle = document.getElementById('panel-toggle')
  const panelClose = document.getElementById('panel-close')
  const scaleSlider = document.getElementById('scale-slider')
  const scaleDisplay = document.getElementById('scale-display')
  const scaleMinus = document.getElementById('scale-minus')
  const scalePlus = document.getElementById('scale-plus')
  const modelSelect = document.getElementById('model-select')
  const modelStatus = document.getElementById('model-status')
  const btnReset = document.getElementById('btn-reset')
  const btnExit = document.getElementById('btn-exit')
  const clickThroughToggle = document.getElementById('click-through-toggle')
  clickThroughToggle.addEventListener('change', () => {
    clickThroughEnabled = clickThroughToggle.checked
    window.petAPI.setClickThrough(clickThroughEnabled)
    mouseCaptureEnabled = !clickThroughEnabled
  })
  let scaleSaveTimer = null

  function setModelStatus(text, color) {
    modelStatus.textContent = text
    modelStatus.style.color = color || '#777'
  }

  function togglePanel() {
    const isActive = panel.classList.toggle('active')
    // Don't hide the toggle button - always keep it visible
    if (isActive) {
      panelToggle.style.opacity = '0.3'
      panelToggle.title = '关闭控制面板 (Ctrl+M)'
      console.log('[Panel] Opened')
    } else {
      panelToggle.style.opacity = '1'
      panelToggle.title = '打开控制面板 (Ctrl+M)'
      console.log('[Panel] Closed')
    }
  }

  function updateScaleDisplay() {
    const val = parseFloat(scaleSlider.value)
    if (model) model.scale = val
    scaleDisplay.textContent = Math.round(val * 100) + '%'
    if (scaleSaveTimer) clearTimeout(scaleSaveTimer)
    scaleSaveTimer = setTimeout(() => {
      scaleSaveTimer = null
      window.petAPI.setScale(val).catch((error) => console.warn('Failed to save scale:', error))
    }, 200)
  }

  panelToggle.addEventListener('click', () => {
    console.log('[Debug] Panel toggle clicked')
    togglePanel()
  })
  panelClose.addEventListener('click', togglePanel)
  scaleSlider.addEventListener('input', updateScaleDisplay)

  scaleMinus.addEventListener('click', () => {
    scaleSlider.value = Math.max(0.5, parseFloat(scaleSlider.value) - 0.1).toFixed(1)
    updateScaleDisplay()
  })

  scalePlus.addEventListener('click', () => {
    scaleSlider.value = Math.min(2, parseFloat(scaleSlider.value) + 0.1).toFixed(1)
    updateScaleDisplay()
  })

  modelSelect.addEventListener('change', async (e) => {
    if (e.target.value && typeof models !== 'undefined' && models.length > 0) {
      const selected = models.find(m => m.path === e.target.value)
      if (selected) {
        window.petAPI.selectModel(selected.path)
      }
    }
  })

  btnReset.addEventListener('click', async () => {
    if (model && model.loaded) {
      if (typeof model.centerModel === 'function') {
        model.centerModel()
        applyVerticalOffset(model)
      }
      console.log('Model position reset')
    }
  })

  btnExit.addEventListener('click', () => {
    window.petAPI.quitApp()
  })

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'm') {
      e.preventDefault()
      togglePanel()
    }
  })

  // ── Cursor follow: main process provides position ──
  window.petAPI.onCursorMove((pos) => {
    cursorOffset = pos
    // Hover detection via cursor position (since -webkit-app-region:drag blocks mousemove)
    const dist = Math.sqrt(pos.x ** 2 + pos.y ** 2)
    const wasNear = cursorNearPet
    cursorNearPet = dist < 180 && model && model.loaded
    if (cursorNearPet && !wasNear) {
      canvas.style.cursor = 'pointer'
    } else if (!cursorNearPet && wasNear) {
      canvas.style.cursor = 'grab'
    }
  })

  // ── Cursor follow animation loop ───────────────────
  let rafActive = true
  function followLoop() {
    if (rafActive) updateCursorFollow()
    requestAnimationFrame(followLoop)
  }
  requestAnimationFrame(followLoop)

  // Pause heavy work when the window is hidden (tray hide) to save CPU
  document.addEventListener('visibilitychange', () => {
    rafActive = !document.hidden
  })

  // ── Idle ambient bubbles ───────────────────────────
  function scheduleIdleAmbient() {
    const delay = 18000 + Math.random() * 35000
    setTimeout(() => {
      if (!model || !model.loaded) { scheduleIdleAmbient(); return }
      const pet = petScreenPos()
      const elapsed = (Date.now() - lastInteractionTime) / 1000
      if (elapsed > 90) {
        fxZzz(pet.x + 30, pet.y - 40)
        if (Math.random() < 0.5) fxBubble(pet.x - 15, pet.y - 35, rand(BUBBLES_SLEEPY))
      } else if (elapsed > 40) {
        fxBubble(pet.x - 15, pet.y - 35, rand(BUBBLES_IDLE))
      } else {
        if (Math.random() < 0.4) fxBubble(pet.x - 20, pet.y - 40, rand(BUBBLES_GREET))
      }
      scheduleIdleAmbient()
    }, delay)
  }
  setTimeout(scheduleIdleAmbient, 15000)

  // ── Hover idle detection (via cursor tracking) ─────
  let hoverIdleCount = 0
  setInterval(() => {
    if (document.hidden) return
    if (cursorNearPet && model && model.loaded) {
      hoverIdleCount++
      if (hoverIdleCount > 10) {
        const pet = petScreenPos()
        if (Math.random() < 0.35) fxEmote(pet.x + 20, pet.y - 5, rand(EMOTES_LOVE))
        hoverIdleCount = 0
      }
    } else {
      hoverIdleCount = 0
    }
  }, 250)

  // ── Diagnostic helper ─────────────────────────────
  async function diagnoseModelError(modelPath, err) {
    console.error('Model error:', err && (err.stack || err.message || err))
    try {
      const fs = require('fs')
      const p = require('path')
      const { fileURLToPath } = require('url')
      let fp = modelPath
      if (typeof fp === 'string' && fp.startsWith('file://')) fp = fileURLToPath(fp)

      try {
        const stat = fs.statSync(fp)
        if (stat.isFile()) {
          if (fp.endsWith('.model3.json')) {
            const dir = p.dirname(fp)
            console.error('Model folder:', dir)
            try { console.error('Files:', fs.readdirSync(dir)) } catch(_) {}
            try {
              const json = JSON.parse(fs.readFileSync(fp, 'utf8'))
              const moc = json.FileReferences && json.FileReferences.Moc
              console.error('model3.json FileReferences.Moc ->', moc)
            } catch (e) { console.error('Failed to parse model3.json:', e && e.message) }
          } else if (fp.endsWith('.zip')) {
            console.error('Model is a zip file; ensure it contains .model3.json and .moc3 files')
          } else {
            console.error('Model path is a file:', fp)
          }
        } else if (stat.isDirectory()) {
          console.error('Model path is a directory; listing files:')
          try { console.error('Files:', fs.readdirSync(fp)) } catch(_) {}
        } else {
          console.error('Model path exists but is neither file nor directory:', fp)
        }
      } catch (e) {
        console.error('Model file/directory not found at path:', fp)
      }
    } catch (e) { console.error('Diagnosis failed:', e && e.message) }
  }

  // ── Load model ─────────────────────────────────────
  let models = []
  let modelLoadVersion = 0

  async function releaseModel(instance) {
    if (!instance) return
    try {
      if (typeof instance.destroy === 'function') {
        instance.destroy()
      } else if (typeof instance.release === 'function') {
        await instance.release()
      } else if (typeof instance.unload === 'function') {
        await instance.unload()
      } else if (instance.internalModel && typeof instance.internalModel._release === 'function') {
        instance.internalModel._release()
      }
    } catch (error) {
      console.warn('Model release failed:', error && error.message)
    }
  }

  // Load the replacement first, then release the old model. A broken model
  // package therefore leaves the currently visible pet usable.
  async function loadModel(modelPath, modelName) {
    const version = ++modelLoadVersion
    const nextModel = createModelInstance()
    setModelStatus(`正在加载 ${modelName || '模型'}...`, '#667eea')
    try {
      await nextModel.load(modelPath)
      if (version !== modelLoadVersion) {
        await releaseModel(nextModel)
        return false
      }
      if (typeof nextModel.centerModel === 'function') nextModel.centerModel()
      applyVerticalOffset(nextModel)
      nextModel.scale = parseFloat(scaleSlider.value) || 1

      const previousModel = model
      model = nextModel
      modelSelect.value = modelPath
      updateScaleDisplay()
      await releaseModel(previousModel)
      setModelStatus(`${modelName || '模型'} 已就绪`, '#2f9e44')
      console.log('Model loaded:', modelName || modelPath, 'at position:', model.x, model.y)
      return true
    } catch (error) {
      await releaseModel(nextModel)
      setModelStatus(`${modelName || '模型'} 加载失败，请查看日志`, '#d9480f')
      throw error
    }
  }

  let savedModel = null
  let savedSettings = { scale: 1 }
  try {
    [savedModel, savedSettings] = await Promise.all([
      window.petAPI.getCurrentModel(),
      window.petAPI.getSettings(),
    ])
    const savedScale = Number(savedSettings && savedSettings.scale)
    if (Number.isFinite(savedScale)) scaleSlider.value = Math.min(2, Math.max(0.5, savedScale))
    updateScaleDisplay()
    clickThroughEnabled = !!(savedSettings && savedSettings.clickThrough)
    if (clickThroughToggle) clickThroughToggle.checked = clickThroughEnabled
    mouseCaptureEnabled = !clickThroughEnabled
  } catch (error) {
    console.warn('Failed to load saved settings:', error && error.message)
  }

  try {
    models = await window.petAPI.listModels()
  } catch (err) {
    console.error('Failed to list models:', err && err.message)
    setModelStatus('模型列表读取失败，请查看日志', '#d9480f')
  }

  // Populate model select
  modelSelect.replaceChildren(...models.map((item) => {
    const option = document.createElement('option')
    option.value = item.path
    option.textContent = item.name
    option.selected = item.path === savedModel
    return option
  }))

  if (models.length > 0) {
    let modelToLoad = models[0]
    if (savedModel) {
      const found = models.find(m => m.path === savedModel)
      if (found) modelToLoad = found
    }
    try {
      const loaded = await loadModel(modelToLoad.path, modelToLoad.name)
      if (loaded) await window.petAPI.setCurrentModel(modelToLoad.path)
    } catch (err) {
      console.error('Model load failed:', err)
      await diagnoseModelError(modelToLoad.path, err)
    }
  } else {
    console.warn('No models in static/models/')
    modelSelect.replaceChildren(new Option('暂无模型', ''))
    setModelStatus('没有找到可用模型', '#d9480f')
  }

  window.petAPI.onModelChanged(async (modelPath) => {
    const selected = models.find(item => item.path === modelPath)
    if (!selected) {
      console.warn('Ignoring unknown model path:', modelPath)
      return
    }
    try {
      await loadModel(modelPath, selected.name)
    } catch (err) {
      console.error('Model switch failed:', err)
      await diagnoseModelError(modelPath, err)
    }
  })
})()
