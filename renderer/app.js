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
  const interactionBubble = document.getElementById('interaction-bubble')
  const statusToast = document.getElementById('status-toast')

  const motionPriority = { idle: 1, normal: 2, force: 3 }
  const idleCopy = ['在这里陪你', '休息一下', '安静待会儿']
  const particleColors = ['#7164d8', '#b7aef0', '#efb5c8', '#fffdf9']
  const interactionCopy = {
    greet: ['你好呀～', '今天也一起加油', '见到你真好'],
    head: ['好舒服～', '再摸一下嘛', '嘿嘿，谢谢你'],
    praise: ['被夸奖了 ✦', '谢谢你！', '今天也很开心'],
    snack: ['好吃！', '能量补充完毕', '还想再来一点～'],
    calm: ['让我靠一会儿', '安静陪着你', '呼…放松一下'],
    curious: ['在忙什么呀？', '需要我陪你吗？', '我在听～'],
    excited: ['最喜欢你啦！', '好开心！', '今天超有精神 ✦'],
    drag: ['带我去哪里呀？', '新位置不错', '这里也很好～'],
  }
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
    pointerDown: null,
    dragging: false,
    dragCamera: null,
    reactionPose: null,
    motionGroups: { idle: [], tap: [] },
    clickTimer: null,
    clickCount: 0,
    lastClickAt: 0,
    lastClickPoint: null,
    lastClickHitAreas: [],
    longPressTimer: null,
    longPressTriggered: false,
    lastDragReaction: 0,
    hitMask: null,
    hitMaskPending: false,
    lastMaskRebuild: 0,
    lastHitBounds: null,
    particles: [],
    lastFxFrame: 0,
  }

  let toastTimer = null
  let bubbleTimer = null
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

  function optimizeMotionGroups(motionGroups) {
    // 部分第三方模型把大量参数片段放在空名称组中；Cubism 会把它们
    // 当作完整动作解析并持续报错。保留规范动作，其他互动用轻量姿态回应。
    return motionGroups.filter(group => typeof group.group === 'string' && group.group.trim().length > 0)
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
      buffers.motionGroups = optimizeMotionGroups(buffers.motionGroups)
      model.motionIds = buffers.motionGroups.flatMap(group =>
        group.motionData.motionBuffers.map((_, index) => `${group.group}_${index}`)
      )
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
      tap: groups.filter(name => /tap|touch|body|shake/i.test(name)),
      head: groups.filter(name => /taphead|pethead/i.test(name)),
      greet: groups.filter(name => /greet|petgreet/i.test(name)),
      happy: groups.filter(name => /happy|smile|pethappy/i.test(name)),
      snack: groups.filter(name => /snack|petsnack/i.test(name)),
      shy: groups.filter(name => /shy|petshy/i.test(name)),
      curious: groups.filter(name => /curious|petcurious/i.test(name)),
      sleepy: groups.filter(name => /sleep|petsleepy/i.test(name)),
    }
  }

  function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)]
  }

  function playMotion(kind, priority = motionPriority.normal) {
    if (!state.model || !state.model.loaded) return
    const fallbacks = {
      head: ['head', 'happy', 'tap'],
      greet: ['greet', 'happy', 'tap', 'idle'],
      happy: ['happy', 'head', 'tap'],
      snack: ['snack', 'happy', 'tap'],
      shy: ['shy', 'head', 'tap'],
      curious: ['curious', 'head', 'tap'],
      sleepy: ['sleepy', 'idle'],
      tap: ['tap', 'head', 'happy'],
      idle: ['idle'],
    }
    let groups = []
    for (const candidate of (fallbacks[kind] || [kind, 'tap'])) {
      if (state.motionGroups[candidate] && state.motionGroups[candidate].length) {
        groups = state.motionGroups[candidate]
        break
      }
    }
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
      let minX = width
      let minY = height
      let maxX = -1
      let maxY = -1
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * 4 + 3] > 8) {
            opaquePixels++
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      state.hitMask = opaquePixels >= 12 ? { width, height, data } : null
      state.lastMaskRebuild = performance.now()

      // 角色包围盒（窗口局部 DIP），发给主进程用于位置预设贴角
      const bounds = opaquePixels >= 12
        ? {
            x: Math.round(minX * (window.innerWidth / width)),
            y: Math.round(minY * (window.innerHeight / height)),
            width: Math.round((maxX - minX + 1) * (window.innerWidth / width)),
            height: Math.round((maxY - minY + 1) * (window.innerHeight / height)),
          }
        : null
      if (JSON.stringify(bounds) !== JSON.stringify(state.lastHitBounds)) {
        state.lastHitBounds = bounds
        window.petAPI.reportHitBounds(bounds)
      }
    } catch (error) {
      state.hitMask = null
    }
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
    // 模型加载后整个窗口一律可交互：拖拽区域 = 整个窗口，
    // 保证任何位置都能抓住角色（边缘/头顶/尾巴都不再失效）。
    // 角色精细命中（hitAreasAt）仅用于点击反馈选择。
    if (!state.model || !state.model.loaded) return false
    return clientX >= 0 && clientX < window.innerWidth && clientY >= 0 && clientY < window.innerHeight
  }

  function updateMouseCapture(clientX, clientY) {
    state.pointer = { clientX, clientY }
  }

  function markInteraction(duration = 2200) {
    const now = performance.now()
    state.lastInteraction = now
    state.activeUntil = now + duration
    state.idleStage = 0
    ensureScheduler()
  }

  function addReactionEffect(x, y, kind = 'tap', requestedCount = 6) {
    if (!state.preferences || state.preferences.effects !== 'subtle' || reducedMotionEnabled()) return
    const styles = {
      tap: { glyph: '', colors: particleColors },
      head: { glyph: '♥', colors: ['#ef9fba', '#f3bfd0', '#8f7ce0'] },
      praise: { glyph: '✦', colors: ['#806de2', '#efb5c8', '#f4c76d'] },
      snack: { glyph: '◆', colors: ['#f0a85e', '#f4c76d', '#efb5c8'] },
      calm: { glyph: '·', colors: ['#a99ee7', '#c7c0ee'] },
      curious: { glyph: '?', colors: ['#806de2', '#b7aef0'] },
      excited: { glyph: '♥', colors: ['#e888aa', '#806de2', '#f4c76d'] },
      greet: { glyph: '✦', colors: ['#806de2', '#b7aef0'] },
      drag: { glyph: '·', colors: ['#a99ee7', '#efb5c8'] },
    }
    const style = styles[kind] || styles.tap
    const available = Math.max(0, 14 - state.particles.length)
    const count = Math.min(requestedCount, available)
    for (let index = 0; index < count; index++) {
      const angle = (Math.PI * 2 * index) / count + Math.random() * 0.28
      const speed = 24 + Math.random() * 24
      state.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 8,
        radius: 2.5 + Math.random() * 2.5,
        color: randomItem(style.colors),
        glyph: style.glyph,
        life: 0,
        duration: 0.55 + Math.random() * 0.2,
      })
    }
  }

  function showBubble(text, duration = 2400) {
    if (!text) return
    const bounds = state.lastHitBounds
    const width = window.innerWidth
    const height = window.innerHeight
    const x = bounds
      ? bounds.x + bounds.width * 0.62
      : width * 0.54
    const y = bounds
      ? bounds.y + Math.min(30, Math.max(8, bounds.height * 0.06))
      : height * 0.2

    interactionBubble.textContent = text
    interactionBubble.style.left = `${Math.max(70, Math.min(width - 70, x))}px`
    interactionBubble.style.top = `${Math.max(24, Math.min(height - 64, y))}px`
    interactionBubble.classList.add('is-visible')
    if (bubbleTimer) clearTimeout(bubbleTimer)
    bubbleTimer = setTimeout(() => interactionBubble.classList.remove('is-visible'), duration)
  }

  function runInteraction(requestedKind = 'random', point = null) {
    if (!state.model || !state.model.loaded) return
    const randomKinds = ['greet', 'head', 'praise', 'snack', 'curious']
    const kind = requestedKind === 'random' ? randomItem(randomKinds) : requestedKind
    const config = {
      greet: { motion: 'greet', count: 7, pose: { x: 0.32, y: 0.08 } },
      head: { motion: 'head', count: 8, pose: { x: 0, y: 0.48 } },
      praise: { motion: 'happy', count: 9, pose: { x: -0.22, y: 0.18 } },
      snack: { motion: 'snack', count: 8, pose: { x: 0.2, y: 0.3 } },
      calm: { motion: 'sleepy', count: 5, pose: { x: 0, y: -0.34 } },
      curious: { motion: 'curious', count: 6, pose: { x: 0.38, y: 0.24 } },
      excited: { motion: 'happy', count: 12, pose: { x: -0.4, y: 0.38 } },
      drag: { motion: 'greet', count: 5, pose: { x: 0.22, y: 0.12 } },
    }[kind] || { motion: 'tap', count: 6, pose: { x: 0, y: 0.2 } }
    const x = Math.max(20, Math.min(window.innerWidth - 20, Number(point && point.clientX) || window.innerWidth * 0.5))
    const y = Math.max(20, Math.min(window.innerHeight - 20, Number(point && point.clientY) || window.innerHeight * 0.32))

    playMotion(config.motion, kind === 'excited' ? motionPriority.force : motionPriority.normal)
    state.reactionPose = { ...config.pose, until: performance.now() + (kind === 'calm' ? 1800 : 1150) }
    addReactionEffect(x, y, kind, config.count)
    const copy = interactionCopy[kind] || interactionCopy.greet
    showBubble(randomItem(copy), kind === 'excited' ? 3000 : 2300)
    markInteraction(kind === 'calm' ? 3000 : 2400)
  }

  function drawEffects(timestamp) {
    const width = window.innerWidth
    const height = window.innerHeight
    const delta = state.lastFxFrame ? Math.min(0.05, (timestamp - state.lastFxFrame) / 1000) : 0
    state.lastFxFrame = timestamp
    effectsContext.clearRect(0, 0, width, height)

    if (!state.preferences || state.preferences.effects === 'off') {
      state.particles.length = 0
      return
    }

    if (reducedMotionEnabled()) {
      state.particles.length = 0
    } else {
      state.particles = state.particles.filter(particle => {
        particle.life += delta
        if (particle.life >= particle.duration) return false
        particle.x += particle.vx * delta
        particle.y += particle.vy * delta
        particle.vy += 36 * delta
        const progress = particle.life / particle.duration
        effectsContext.globalAlpha = 1 - progress
        effectsContext.fillStyle = particle.color
        if (particle.glyph) {
          effectsContext.save()
          effectsContext.font = `${Math.round(11 + particle.radius)}px "Segoe UI Symbol", "Microsoft YaHei UI", sans-serif`
          effectsContext.textAlign = 'center'
          effectsContext.textBaseline = 'middle'
          effectsContext.fillText(particle.glyph, particle.x, particle.y)
          effectsContext.restore()
        } else {
          effectsContext.beginPath()
          effectsContext.arc(particle.x, particle.y, particle.radius * (1 - progress * 0.35), 0, Math.PI * 2)
          effectsContext.fill()
        }
        return true
      })
    }
    effectsContext.globalAlpha = 1
  }

  function updateFollow() {
    if (!state.model || !state.model.loaded) return
    if (state.dragging) {
      state.model.setDragging(0, 0)
      return
    }
    if (state.reactionPose) {
      if (performance.now() < state.reactionPose.until) {
        state.model.setDragging(state.reactionPose.x, state.reactionPose.y)
        return
      }
      state.reactionPose = null
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
        // 角色动画会让裙摆/尾巴摆动，定期重建蒙版避免命中区域过时
        if (state.hitMaskPending || timestamp - state.lastMaskRebuild > 2000) rebuildHitMask()
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

  function clearLongPress() {
    if (state.longPressTimer) clearTimeout(state.longPressTimer)
    state.longPressTimer = null
  }

  function pointIsHead(point, hitAreas = []) {
    return hitAreas.some(name => name.includes('head')) || point.clientY <= window.innerHeight * 0.34
  }

  function beginLongPress(point, hitAreas) {
    clearLongPress()
    state.longPressTriggered = false
    state.longPressTimer = setTimeout(() => {
      state.longPressTimer = null
      if (!state.pointerDown || state.dragging) return
      state.longPressTriggered = true
      runInteraction(pointIsHead(point, hitAreas) ? 'head' : 'calm', point)
    }, 650)
  }

  function queueClickInteraction(point, hitAreas) {
    const now = performance.now()
    if (now - state.lastClickAt > 420) state.clickCount = 0
    state.lastClickAt = now
    state.clickCount++
    state.lastClickPoint = point
    state.lastClickHitAreas = hitAreas
    if (state.clickTimer) clearTimeout(state.clickTimer)

    state.clickTimer = setTimeout(() => {
      const count = state.clickCount
      const clickPoint = state.lastClickPoint
      const clickHitAreas = state.lastClickHitAreas
      state.clickTimer = null
      state.clickCount = 0
      if (count >= 3) runInteraction('excited', clickPoint)
      else if (count === 2) runInteraction('praise', clickPoint)
      else runInteraction(pointIsHead(clickPoint, clickHitAreas) ? 'head' : 'curious', clickPoint)
    }, 300)
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
      clearLongPress()
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
      window.petAPI.dragStart(event.screenX, event.screenY)
    }
    if (state.dragging) {
      window.petAPI.dragMove(event.screenX, event.screenY)
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
      hitAreas: hitAreasAt(event.clientX, event.clientY),
    }
    state.dragging = false
    state.dragCamera = null
    beginLongPress(state.pointerDown, state.pointerDown.hitAreas)
    window.petAPI.dragPrime(event.screenX, event.screenY)
    markInteraction()
  })

  document.addEventListener('mouseup', event => {
    if (!state.pointerDown) return
    const pointerDown = state.pointerDown
    const moved = Math.hypot(event.screenX - pointerDown.screenX, event.screenY - pointerDown.screenY)
    const elapsed = performance.now() - pointerDown.time
    clearLongPress()

    if (state.dragging) {
      window.petAPI.dragEnd()
      if (state.liveCanvas) state.liveCanvas.classList.remove('is-dragging')
      if (moved >= 24 && performance.now() - state.lastDragReaction > 1800) {
        state.lastDragReaction = performance.now()
        runInteraction('drag', { clientX: event.clientX, clientY: event.clientY })
      }
    } else if (!state.longPressTriggered && moved < 6 && elapsed < 520 && isOnPet(pointerDown.clientX, pointerDown.clientY)) {
      queueClickInteraction(pointerDown, pointerDown.hitAreas)
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

  function abortDrag() {
    clearLongPress()
    restoreDragCamera()
    state.pointerDown = null
    state.dragging = false
    state.dragCamera = null
    if (state.liveCanvas) state.liveCanvas.classList.remove('is-dragging')
  }

  window.addEventListener('blur', () => {
    if (state.pointerDown) window.petAPI.dragEnd()
    abortDrag()
  })

  // 主进程在鼠标弹起事件丢失（越窗松手等）时主动结束拖拽并通知复位，
  // 避免模型停留在"拖动中"冻结态
  window.petAPI.onDragAborted(() => {
    abortDrag()
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
    if (event.key.toLowerCase() === 'i') {
      event.preventDefault()
      runInteraction('random')
    }
  })

  window.petAPI.onCursorMove(point => {
    state.followPoint = point
    if (point.near) {
      state.activeUntil = Math.max(state.activeUntil, performance.now() + 500)
      ensureScheduler()
    }
    if (point.inside) updateMouseCapture(point.clientX, point.clientY)
  })

  window.petAPI.onPauseChanged(paused => {
    state.paused = Boolean(paused)
    ensureScheduler()
  })

  window.petAPI.onInteractionRequested(request => {
    runInteraction(request && request.kind ? request.kind : 'random')
  })

  // ---- 角色封面生成：串行加载其他模型并截取首帧缩略图 ----
  let coverQueue = []
  let coverBusy = false

  async function renderModelCover(item) {
    const canvas = document.createElement('canvas')
    canvas.width = 220
    canvas.height = 280
    const model = createModelInstance(canvas)
    try {
      await model.load(item.path)
      model.touchController.cancelInteractions()
      model.cameraController.removeListeners()
      model.centerModel()
      model.scale = 0.5
      model.paused = false
      model.update()
      await new Promise(resolve => setTimeout(resolve, 80))
      model.update()
      const dataURL = canvas.toDataURL('image/png')
      window.petAPI.saveCover(item.id, dataURL)
    } catch (error) {
      console.warn(`Cover ${item.id} failed:`, error.message)
    } finally {
      releaseModel(model, canvas)
    }
  }

  async function processCoverQueue() {
    if (coverBusy) return
    coverBusy = true
    while (coverQueue.length) {
      const item = coverQueue.shift()
      await renderModelCover(item)
    }
    coverBusy = false
  }

  window.petAPI.onCoversRequest(missing => {
    if (!Array.isArray(missing)) return
    coverQueue.push(...missing)
    processCoverQueue()
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
