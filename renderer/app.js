(async function () {
  const pathModule = require('path')
  const originalJoin = pathModule.join
  const originalDirname = pathModule.dirname
  const normalizePath = value => typeof value === 'string' ? value.replace(/\\/g, '/') : value
  pathModule.join = (...parts) => normalizePath(originalJoin(...parts))
  pathModule.dirname = value => normalizePath(originalDirname(value))

  const { Live2DCubismModel } = require('live2d-renderer')
  const stage = document.getElementById('pet-stage')
  const effectsCanvas = document.getElementById('fx-canvas')
  const effectsContext = effectsCanvas.getContext('2d')
  const statusToast = document.getElementById('status-toast')

  const motionPriority = { idle: 1, normal: 2, force: 3 }
  const idleCopy = ['在这里陪你', '休息一下', '安静待会儿']
  const particleColors = ['#7164d8', '#b7aef0', '#efb5c8', '#fffdf9']
  const state = {
    snapshot: null,
    preferences: null,
    model: null,
    modelMeta: null,
    liveCanvas: null,
    pendingModelId: null,
    loadingModelId: null,
    loading: false,
    paused: false,
    visible: !document.hidden,
    lastInteraction: performance.now(),
    activeUntil: performance.now() + 2500,
    idleStage: 0,
    frameTimer: null,
    frameRequest: null,
    lastFrame: 0,
    followPoint: { clientX: 200, clientY: 300, near: false },
    pointer: { clientX: 0, clientY: 0 },
    capture: false,
    pointerDown: null,
    dragging: false,
    dragCamera: null,
    motionGroups: { idle: [], tap: [] },
    hitMask: null,
    hitMaskPending: false,
    particles: [],
    bubble: null,
    lastFxFrame: 0,
  }

  let toastTimer = null

  function showStatus(message, type = 'info', duration = 0) {
    statusToast.textContent = message
    statusToast.classList.toggle('is-error', type === 'error')
    statusToast.classList.add('is-visible')
    if (toastTimer) clearTimeout(toastTimer)
    if (duration > 0) {
      toastTimer = setTimeout(() => statusToast.classList.remove('is-visible'), duration)
    }
  }

  function hideStatus(delay = 0) {
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => statusToast.classList.remove('is-visible'), delay)
  }

  function reducedMotionEnabled() {
    if (!state.preferences) return false
    if (state.preferences.reducedMotion === 'on') return true
    if (state.preferences.reducedMotion === 'off') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  function resizeEffectsCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const width = document.documentElement.clientWidth
    const height = document.documentElement.clientHeight
    effectsCanvas.width = Math.max(1, Math.round(width * dpr))
    effectsCanvas.height = Math.max(1, Math.round(height * dpr))
    effectsCanvas.style.width = `${width}px`
    effectsCanvas.style.height = `${height}px`
    effectsContext.setTransform(dpr, 0, 0, dpr, 0, 0)
    state.hitMaskPending = true
  }

  function createLiveCanvas() {
    const canvas = document.createElement('canvas')
    canvas.id = 'live2d-canvas'
    canvas.width = Math.max(1, document.documentElement.clientWidth)
    canvas.height = Math.max(1, document.documentElement.clientHeight)
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    stage.appendChild(canvas)
    return canvas
  }

  function createFrozenFrame() {
    if (!state.liveCanvas) return null
    try {
      const frozen = document.createElement('canvas')
      frozen.className = 'model-snapshot'
      frozen.width = state.liveCanvas.width
      frozen.height = state.liveCanvas.height
      frozen.getContext('2d').drawImage(state.liveCanvas, 0, 0)
      stage.appendChild(frozen)
      return frozen
    } catch (error) {
      return null
    }
  }

  function releaseModel(instance, canvas) {
    if (instance) {
      try {
        instance.touchController && instance.touchController.cancelInteractions()
        instance.cameraController && instance.cameraController.removeListeners()
      } catch (error) {
        console.warn('Interaction cleanup failed:', error.message)
      }
      if (instance.loaded) {
        try { instance.destroy() } catch (error) { console.warn('Model cleanup failed:', error.message) }
      } else {
        try { instance.webGLRenderer.deleteShader() } catch (error) { console.warn('Shader cleanup failed:', error.message) }
      }
      try {
        if (instance.audioContext && instance.audioContext.state !== 'closed') instance.audioContext.close()
      } catch (error) {
        console.warn('Audio cleanup failed:', error.message)
      }
    }
    if (canvas) {
      try {
        const context = canvas.getContext('webgl2')
        const contextLoss = context && context.getExtension('WEBGL_lose_context')
        if (contextLoss) contextLoss.loseContext()
      } catch (error) {
        console.warn('WebGL cleanup failed:', error.message)
      }
    }
    if (canvas && canvas.isConnected) canvas.remove()
  }

  function createModelInstance(canvas) {
    const qualityMode = state.preferences ? state.preferences.qualityMode : 'auto'
    const maxTextureSize = qualityMode === 'high' ? 4096 : qualityMode === 'eco' ? 1024 : 2048
    const model = new Live2DCubismModel(canvas, {
      cubismCorePath: window.petAPI.cubismCorePath,
      autoAnimate: false,
      autoInteraction: false,
      tapInteraction: false,
      randomMotion: false,
      zoomEnabled: false,
      enablePan: false,
      doubleClickReset: false,
      enablePhysics: true,
      enableEyeblink: true,
      enableBreath: true,
      enableMovement: true,
      enableMotion: false,
      enablePose: true,
      premultipliedAlpha: true,
      maxTextureSize,
      scale: 1,
    })

    const originalLoadBuffers = model.loadBuffers.bind(model)
    model.loadBuffers = async link => {
      const buffers = await originalLoadBuffers(link)
      buffers.motionGroups = buffers.motionGroups.filter(group => typeof group.group === 'string' && group.group.trim().length > 0)
      model.motionIds = model.motionIds.filter(id => !id.startsWith('_'))
      return buffers
    }

    const originalLoadCubismCore = model.loadCubismCore.bind(model)
    model.loadCubismCore = async function () {
      await originalLoadCubismCore()
      try {
        const { fileURLToPath } = require('url')
        const coreModule = require(fileURLToPath(window.petAPI.cubismCorePath))
        if (coreModule && coreModule._malloc) window.Live2DCubismCore = coreModule
      } catch (error) {
        console.warn('Cubism Core bridge failed:', error.message)
      }
    }

    return model
  }

  function classifyMotionGroups(model) {
    const groups = ((model.buffers && model.buffers.motionGroups) || [])
      .filter(item => item.motionData && item.motionData.motionBuffers && item.motionData.motionBuffers.length)
      .map(item => item.group)

    return {
      idle: groups.filter(name => /idle|wait|stand|tick/i.test(name)),
      tap: groups.filter(name => /tap|touch|body|head|happy|smile/i.test(name)),
    }
  }

  function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)]
  }

  function playMotion(kind, priority = motionPriority.normal) {
    if (!state.model || !state.model.loaded) return
    const groups = state.motionGroups[kind] || []
    if (!groups.length) return
    try {
      state.model.startRandomMotion(randomItem(groups), priority)
      state.activeUntil = performance.now() + 2600
    } catch (error) {
      console.warn('Motion start failed:', error.message)
    }
  }

  function reportStatus(phase, modelId, message) {
    window.petAPI.reportModelStatus({ phase, modelId, message })
  }

  async function switchModel(modelMeta) {
    const frozen = createFrozenFrame()
    const previousModel = state.model
    const previousMeta = state.modelMeta
    const previousCanvas = state.liveCanvas
    state.model = null
    state.liveCanvas = null
    state.hitMask = null
    reportStatus('loading', modelMeta.id, `正在加载 ${modelMeta.name}`)

    releaseModel(previousModel, previousCanvas)

    const canvas = createLiveCanvas()
    const nextModel = createModelInstance(canvas)
    try {
      await nextModel.load(modelMeta.path)
      nextModel.touchController.cancelInteractions()
      nextModel.cameraController.removeListeners()
      nextModel.centerModel()
      nextModel.scale = state.preferences.scale
      nextModel.enableMotion = false
      nextModel.paused = false

      state.model = nextModel
      state.modelMeta = modelMeta
      state.liveCanvas = canvas
      state.motionGroups = classifyMotionGroups(nextModel)
      state.hitMaskPending = true
      state.lastInteraction = performance.now()
      state.activeUntil = performance.now() + 2200
      state.idleStage = 0
      reportStatus('ready', modelMeta.id, `${modelMeta.name} 已就绪`)
      hideStatus(650)

      document.querySelectorAll('.model-snapshot').forEach(snapshot => {
        snapshot.classList.add('is-leaving')
        setTimeout(() => snapshot.remove(), 200)
      })
    } catch (error) {
      releaseModel(nextModel, canvas)
      const message = error && error.message ? error.message : String(error)
      console.error(`Model ${modelMeta.id} failed:`, error)
      reportStatus('error', modelMeta.id, `${modelMeta.name} 加载失败`)
      showStatus(`${modelMeta.name} 加载失败，右键打开设置`, 'error')
      state.modelMeta = null
      if (previousMeta && previousMeta.id !== modelMeta.id) {
        window.petAPI.selectModel(previousMeta.id).catch(() => {})
      } else if (frozen) {
        setTimeout(() => frozen.remove(), 2400)
      }
      throw new Error(message)
    }
  }

  async function processModelQueue() {
    if (state.loading) return
    state.loading = true
    while (state.pendingModelId) {
      const modelId = state.pendingModelId
      state.pendingModelId = null
      state.loadingModelId = modelId
      const modelMeta = state.snapshot.models.find(item => item.id === modelId)
      if (!modelMeta) {
        state.loadingModelId = null
        continue
      }
      try {
        await switchModel(modelMeta)
      } catch (error) {
        console.warn('Model switch stopped:', error.message)
      }
      state.loadingModelId = null
    }
    state.loading = false
    ensureScheduler()
  }

  function requestModel(modelId) {
    if (!modelId) return
    if (state.loadingModelId === modelId) return
    if (state.modelMeta && state.modelMeta.id === modelId && state.model) return
    state.pendingModelId = modelId
    processModelQueue()
  }

  function rebuildHitMask() {
    state.hitMaskPending = false
    if (!state.liveCanvas || !state.model || !state.model.loaded) return
    try {
      const width = 100
      const height = 150
      const maskCanvas = document.createElement('canvas')
      maskCanvas.width = width
      maskCanvas.height = height
      const context = maskCanvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(state.liveCanvas, 0, 0, width, height)
      const data = context.getImageData(0, 0, width, height).data
      let opaquePixels = 0
      for (let index = 3; index < data.length; index += 4) {
        if (data[index] > 16) opaquePixels++
      }
      state.hitMask = opaquePixels >= 12 ? { width, height, data } : null
    } catch (error) {
      state.hitMask = null
    }
  }

  function alphaHit(clientX, clientY) {
    const mask = state.hitMask
    if (!mask) return false
    const x = Math.round((clientX / window.innerWidth) * (mask.width - 1))
    const y = Math.round((clientY / window.innerHeight) * (mask.height - 1))
    if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false

    for (let offsetY = -2; offsetY <= 2; offsetY++) {
      for (let offsetX = -2; offsetX <= 2; offsetX++) {
        const sampleX = x + offsetX
        const sampleY = y + offsetY
        if (sampleX < 0 || sampleY < 0 || sampleX >= mask.width || sampleY >= mask.height) continue
        if (mask.data[(sampleY * mask.width + sampleX) * 4 + 3] > 16) return true
      }
    }
    return false
  }

  function hitAreasAt(clientX, clientY) {
    if (!state.model || !state.model.loaded || !state.model.settings) return []
    try {
      const x = state.model.transformX(clientX)
      const y = state.model.transformY(clientY)
      const matches = []
      const count = state.model.settings.getHitAreasCount()
      for (let index = 0; index < count; index++) {
        const name = state.model.settings.getHitAreaName(index)
        if (state.model.hitTest(name, x, y)) matches.push(String(name).toLowerCase())
      }
      return matches
    } catch (error) {
      return []
    }
  }

  function isOnPet(clientX, clientY) {
    if (!state.model || !state.model.loaded) return false
    if (alphaHit(clientX, clientY)) return true
    if (hitAreasAt(clientX, clientY).length) return true
    if (state.hitMask) return false
    const dx = (clientX - window.innerWidth * 0.5) / (window.innerWidth * 0.34)
    const dy = (clientY - window.innerHeight * 0.56) / (window.innerHeight * 0.43)
    return dx * dx + dy * dy <= 1
  }

  function updateMouseCapture(clientX, clientY) {
    state.pointer = { clientX, clientY }
    if (!state.preferences || state.preferences.interactionMode === 'locked') {
      if (state.capture) {
        state.capture = false
        window.petAPI.setMouseCapture(false)
      }
      return
    }
    if (state.pointerDown) return
    const capture = isOnPet(clientX, clientY)
    if (capture !== state.capture) {
      state.capture = capture
      window.petAPI.setMouseCapture(capture)
    }
  }

  function markInteraction(duration = 2200) {
    const now = performance.now()
    state.lastInteraction = now
    state.activeUntil = now + duration
    state.idleStage = 0
    ensureScheduler()
  }

  function addClickEffect(x, y) {
    if (!state.preferences || state.preferences.effects !== 'subtle' || reducedMotionEnabled()) return
    const available = Math.max(0, 10 - state.particles.length)
    const count = Math.min(6, available)
    for (let index = 0; index < count; index++) {
      const angle = (Math.PI * 2 * index) / count + Math.random() * 0.28
      const speed = 24 + Math.random() * 24
      state.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 8,
        radius: 2.5 + Math.random() * 2.5,
        color: randomItem(particleColors),
        life: 0,
        duration: 0.55 + Math.random() * 0.2,
      })
    }
  }

  function showBubble(text, duration = 2400) {
    if (!state.preferences || state.preferences.effects !== 'subtle' || reducedMotionEnabled()) return
    state.bubble = { text, startedAt: performance.now(), duration }
  }

  function roundedRect(context, x, y, width, height, radius) {
    context.beginPath()
    context.roundRect(x, y, width, height, radius)
    context.fill()
    context.stroke()
  }

  function drawEffects(timestamp) {
    const width = window.innerWidth
    const height = window.innerHeight
    const delta = state.lastFxFrame ? Math.min(0.05, (timestamp - state.lastFxFrame) / 1000) : 0
    state.lastFxFrame = timestamp
    effectsContext.clearRect(0, 0, width, height)

    if (!state.preferences || state.preferences.effects === 'off' || reducedMotionEnabled()) {
      state.particles.length = 0
      state.bubble = null
      return
    }

    state.particles = state.particles.filter(particle => {
      particle.life += delta
      if (particle.life >= particle.duration) return false
      particle.x += particle.vx * delta
      particle.y += particle.vy * delta
      particle.vy += 36 * delta
      const progress = particle.life / particle.duration
      effectsContext.globalAlpha = 1 - progress
      effectsContext.fillStyle = particle.color
      effectsContext.beginPath()
      effectsContext.arc(particle.x, particle.y, particle.radius * (1 - progress * 0.35), 0, Math.PI * 2)
      effectsContext.fill()
      return true
    })
    effectsContext.globalAlpha = 1

    if (state.bubble) {
      const elapsed = timestamp - state.bubble.startedAt
      if (elapsed >= state.bubble.duration) {
        state.bubble = null
      } else {
        const progress = elapsed / state.bubble.duration
        const opacity = Math.min(1, elapsed / 180, (state.bubble.duration - elapsed) / 280)
        effectsContext.save()
        effectsContext.globalAlpha = opacity * 0.94
        effectsContext.font = '12px "Segoe UI Variable", "Microsoft YaHei UI", sans-serif'
        const textWidth = effectsContext.measureText(state.bubble.text).width
        const boxWidth = textWidth + 24
        const x = Math.min(width - boxWidth - 14, Math.max(14, width * 0.54 - boxWidth / 2))
        const y = Math.max(40, height * 0.27 - progress * 10)
        effectsContext.fillStyle = '#fffdf9'
        effectsContext.strokeStyle = 'rgba(113, 100, 216, 0.2)'
        effectsContext.lineWidth = 1
        roundedRect(effectsContext, x, y, boxWidth, 34, 12)
        effectsContext.globalAlpha = opacity
        effectsContext.fillStyle = '#4d4854'
        effectsContext.textAlign = 'center'
        effectsContext.textBaseline = 'middle'
        effectsContext.fillText(state.bubble.text, x + boxWidth / 2, y + 17)
        effectsContext.restore()
      }
    }
  }

  function updateFollow() {
    if (!state.model || !state.model.loaded) return
    if (state.dragging) {
      state.model.setDragging(0, 0)
      return
    }
    if (!state.preferences || state.preferences.cursorFollow !== 'near' || !state.followPoint.near) {
      state.model.setDragging(0, 0)
      return
    }
    try {
      const x = state.model.transformX(state.followPoint.clientX)
      const y = state.model.transformY(state.followPoint.clientY)
      state.model.setDragging(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)))
    } catch (error) {
      state.model.setDragging(0, 0)
    }
  }

  function restoreDragCamera() {
    if (!state.model || !state.dragCamera) return
    state.model.scale = state.dragCamera.scale
    state.model.x = state.dragCamera.x
    state.model.y = state.dragCamera.y
    state.model.setDragging(0, 0)
  }

  function updateIdle(timestamp) {
    if (!state.preferences || !state.preferences.idleEnabled) return
    const idleFor = timestamp - state.lastInteraction
    if (idleFor >= 180000 && state.idleStage < 3) {
      state.idleStage = 3
      showBubble('z · z · z', 3200)
    } else if (idleFor >= 90000 && state.idleStage < 2) {
      state.idleStage = 2
      showBubble('有点困了', 2600)
    } else if (idleFor >= 30000 && state.idleStage < 1) {
      state.idleStage = 1
      playMotion('idle', motionPriority.idle)
      showBubble(randomItem(idleCopy), 2200)
    }
  }

  function targetFrameRate(timestamp) {
    if (state.paused || state.loading || !state.visible) return 2
    if (!state.preferences) return 30
    if (reducedMotionEnabled()) return 20
    if (state.preferences.qualityMode === 'high') return 60
    if (state.preferences.qualityMode === 'eco') return 30
    const idleFor = timestamp - state.lastInteraction
    if (state.preferences.idleEnabled && idleFor >= 180000) return 10
    if (timestamp > state.activeUntil) return 30
    return 60
  }

  function scheduleNextFrame() {
    if (!state.visible || state.frameTimer || state.frameRequest) return
    const fps = targetFrameRate(performance.now())
    state.frameTimer = setTimeout(() => {
      state.frameTimer = null
      state.frameRequest = requestAnimationFrame(frame)
    }, Math.max(0, Math.round(1000 / fps) - 2))
  }

  function frame(timestamp) {
    state.frameRequest = null
    state.lastFrame = timestamp
    updateIdle(timestamp)

    if (!state.paused && !state.loading && !state.dragging && state.model && state.model.loaded) {
      updateFollow()
      try {
        state.model.update()
        if (state.hitMaskPending) rebuildHitMask()
      } catch (error) {
        console.error('Render update failed:', error)
        reportStatus('error', state.modelMeta ? state.modelMeta.id : '', '渲染发生错误')
        state.paused = true
      }
    }
    drawEffects(timestamp)
    scheduleNextFrame()
  }

  function ensureScheduler() {
    if (!state.visible || state.frameTimer || state.frameRequest) return
    scheduleNextFrame()
  }

  function cancelScheduler() {
    if (state.frameTimer) clearTimeout(state.frameTimer)
    if (state.frameRequest) cancelAnimationFrame(state.frameRequest)
    state.frameTimer = null
    state.frameRequest = null
  }

  function applySnapshot(snapshot) {
    const previousModelId = state.snapshot && state.snapshot.currentModelId
    state.snapshot = snapshot
    state.preferences = snapshot.preferences
    state.paused = Boolean(snapshot.runtime && snapshot.runtime.paused)

    if (state.model) {
      const newScale = Number(snapshot.preferences.scale)
      if (Number.isFinite(newScale) && Math.abs(state.model.scale - newScale) > 0.001) {
        state.model.scale = newScale
        state.hitMaskPending = true
        markInteraction(900)
      }
    }

    if (snapshot.preferences.interactionMode === 'locked') {
      state.capture = false
      window.petAPI.setMouseCapture(false)
    } else {
      updateMouseCapture(state.pointer.clientX, state.pointer.clientY)
    }

    if (!previousModelId || previousModelId !== snapshot.currentModelId || !state.model) {
      requestModel(snapshot.currentModelId)
    }
    ensureScheduler()
  }

  document.addEventListener('mousemove', event => {
    updateMouseCapture(event.clientX, event.clientY)
    if (!state.pointerDown) return
    const dx = event.screenX - state.pointerDown.screenX
    const dy = event.screenY - state.pointerDown.screenY
    if (!state.dragging && Math.hypot(dx, dy) >= 6) {
      state.dragging = true
      if (state.model) {
        state.dragCamera = {
          scale: state.model.scale,
          x: state.model.x,
          y: state.model.y,
        }
        state.model.setDragging(0, 0)
      }
      if (state.liveCanvas) state.liveCanvas.classList.add('is-dragging')
      window.petAPI.dragStart()
    }
    if (state.dragging) {
      markInteraction(700)
    }
  })

  document.addEventListener('mousedown', event => {
    if (!state.preferences || event.button !== 0 || state.preferences.interactionMode === 'locked' || !isOnPet(event.clientX, event.clientY)) return
    state.pointerDown = {
      screenX: event.screenX,
      screenY: event.screenY,
      clientX: event.clientX,
      clientY: event.clientY,
      time: performance.now(),
    }
    state.dragging = false
    state.dragCamera = null
    state.capture = true
    window.petAPI.setMouseCapture(true)
    window.petAPI.dragPrime()
    markInteraction()
  })

  document.addEventListener('mouseup', event => {
    if (!state.pointerDown) return
    const pointerDown = state.pointerDown
    const moved = Math.hypot(event.screenX - pointerDown.screenX, event.screenY - pointerDown.screenY)
    const elapsed = performance.now() - pointerDown.time

    if (state.dragging) {
      window.petAPI.dragEnd()
      if (state.liveCanvas) state.liveCanvas.classList.remove('is-dragging')
    } else if (moved < 6 && elapsed < 420 && isOnPet(pointerDown.clientX, pointerDown.clientY)) {
      const hitAreas = hitAreasAt(pointerDown.clientX, pointerDown.clientY)
      playMotion('tap', motionPriority.normal)
      addClickEffect(pointerDown.clientX, pointerDown.clientY)
      if (hitAreas.some(name => name.includes('head')) && Math.random() < 0.35) showBubble('嗯？')
    }

    restoreDragCamera()
    if (!state.dragging) window.petAPI.dragEnd()
    state.pointerDown = null
    state.dragging = false
    state.dragCamera = null
    updateMouseCapture(event.clientX, event.clientY)
  })

  document.addEventListener('contextmenu', event => {
    event.preventDefault()
    if (state.preferences && state.preferences.interactionMode !== 'locked' && isOnPet(event.clientX, event.clientY)) {
      markInteraction(900)
      window.petAPI.showContextMenu()
    }
  })

  window.addEventListener('blur', () => {
    if (state.pointerDown) window.petAPI.dragEnd()
    restoreDragCamera()
    state.pointerDown = null
    state.dragging = false
    state.dragCamera = null
    if (state.liveCanvas) state.liveCanvas.classList.remove('is-dragging')
    state.capture = false
    window.petAPI.setMouseCapture(false)
  })

  document.addEventListener('keydown', event => {
    if (!event.ctrlKey) return
    if (event.key.toLowerCase() === 'm') {
      event.preventDefault()
      window.petAPI.openSettings('characters')
    }
    if (event.key.toLowerCase() === 'l') {
      event.preventDefault()
      if (!state.preferences) return
      const locked = state.preferences.interactionMode === 'locked'
      window.petAPI.updatePreferences({ interactionMode: locked ? 'smart' : 'locked' })
    }
  })

  window.petAPI.onCursorMove(point => {
    state.followPoint = point
    if (point.near) {
      state.activeUntil = Math.max(state.activeUntil, performance.now() + 500)
      ensureScheduler()
    }
  })

  window.petAPI.onPauseChanged(paused => {
    state.paused = Boolean(paused)
    ensureScheduler()
  })

  window.petAPI.onStateChanged(payload => {
    if (payload && payload.snapshot) applySnapshot(payload.snapshot)
  })

  document.addEventListener('visibilitychange', () => {
    state.visible = !document.hidden
    if (state.visible) {
      state.lastFrame = performance.now()
      ensureScheduler()
    } else {
      cancelScheduler()
    }
  })

  window.addEventListener('resize', () => {
    resizeEffectsCanvas()
    if (state.model && state.model.loaded) {
      state.model.needsResize = true
      state.hitMaskPending = true
    }
  })

  resizeEffectsCanvas()
  try {
    const snapshot = await window.petAPI.getSnapshot()
    applySnapshot(snapshot)
    if (!snapshot.models.length) {
      showStatus('没有找到可用模型', 'error')
      reportStatus('empty', '', '没有找到可用模型')
    }
  } catch (error) {
    console.error('App initialization failed:', error)
    showStatus('启动失败，请从托盘退出后重试', 'error')
    reportStatus('error', '', '应用初始化失败')
  }
})()
