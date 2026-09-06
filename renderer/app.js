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
  const interactionBubbleText = document.getElementById('interaction-bubble-text')
  const statusToast = document.getElementById('status-toast')
  const chatPanel = document.getElementById('ai-chat-panel')
  const chatMessages = document.getElementById('ai-chat-messages')
  const chatForm = document.getElementById('ai-chat-form')
  const chatInput = document.getElementById('ai-chat-input')
  const chatSend = document.getElementById('ai-chat-send')
  const chatToggle = document.getElementById('ai-chat-toggle')
  const chatMute = document.getElementById('ai-chat-mute')
  const chatName = document.getElementById('ai-chat-name')
  const chatPresenceText = document.getElementById('ai-chat-presence-text')

  const motionPriority = { idle: 1, normal: 2, force: 3 }
  const idleCopy = ['在这里陪你', '休息一下', '安静待会儿']
  const particleColors = ['#7164d8', '#b7aef0', '#efb5c8', '#fffdf9']
  const MODEL_SCALE_MIN = 0.5
  const MODEL_SCALE_MAX = 2
  const MODEL_SCALE_STEP = 0.05
  const WHEEL_SCALE_DEBOUNCE_MS = 120
  const SETTINGS_BACKGROUND_FRAME_INTERVAL = 1000 / 15
  const SETTINGS_BACKGROUND_WIDTH = 240
  const SETTINGS_BACKGROUND_HEIGHT = 360
  const interactionCopy = {
    greet: ['你好呀～', '今天也一起加油', '见到你真好'],
    head: ['好舒服～', '再摸一下嘛', '嘿嘿，谢谢你'],
    praise: ['被夸奖了 ✦', '谢谢你！', '今天也很开心'],
    snack: ['好吃！', '能量补充完毕', '还想再来一点～'],
    calm: ['让我靠一会儿', '安静陪着你', '呼…放松一下'],
    curious: ['在忙什么呀？', '需要我陪你吗？', '我在听～'],
    excited: ['最喜欢你啦！', '好开心！', '今天超有精神 ✦'],
    sad: ['呜…', '有点难过', '要抱抱'],
    angry: ['哼！', '生气了！', '不想理你了'],
    drag: ['带我去哪里呀？', '新位置不错', '这里也很好～'],
  }
  // AI 回复开头的情绪标签（plugin-manager 解析为稳定键）到互动反应的映射
  const emotionInteractions = {
    happy: 'excited',
    sad: 'sad',
    angry: 'angry',
    surprised: 'curious',
    shy: 'head',
    confused: 'curious',
    calm: 'calm',
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
    hostVisible: null,
    visible: false,
    lastInteraction: performance.now(),
    activeUntil: performance.now() + 2500,
    idleStage: 0,
    frameTimer: null,
    frameRequest: null,
    frameWatchdog: null,
    wakeCheckTimer: null,
    recoveringVisibility: false,
    wakeRecoveryAttempts: 0,
    webglContextLost: false,
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
    chatAnchorBottom: null,
    chatAnchorModelId: null,
    chatAnchorScale: null,
    chatAnchorViewportHeight: null,
    settingsBackgroundCaptureActive: false,
    settingsBackgroundCapturePending: false,
    settingsBackgroundLastFrameAt: 0,
    settingsBackgroundCanvas: null,
    settingsBackgroundErrorReported: false,
    particles: [],
    lastFxFrame: 0,
  }

  let toastTimer = null
  let bubbleTimer = null
  let chatBusy = false
  let chatCollapsed = true
  let chatMuted = true
  let speechSequence = 0
  let activeSpeechButton = null
  let wheelScaleTimer = null
  let wheelScaleDirection = 0
  let wheelScaleModelId = null
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
    canvas.classList.add('is-preparing')
    canvas.width = Math.max(1, document.documentElement.clientWidth)
    canvas.height = Math.max(1, document.documentElement.clientHeight)
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault()
      if (canvas !== state.liveCanvas) return
      state.webglContextLost = true
      if (state.visible) recoverVisibleModel('WebGL context lost')
    })
    canvas.addEventListener('webglcontextrestored', () => {
      if (canvas !== state.liveCanvas) return
      state.webglContextLost = false
      if (state.visible) scheduleWakeHealthCheck(80)
    })
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
      try { instance.stopAudio && instance.stopAudio() } catch (error) { /* 没有正在播放的语音 */ }
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
      enableLipsync: true,
      lipsyncSmoothing: 0.16,
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

  function visibleCanvasBounds(canvas) {
    if (!canvas) return null
    try {
      const sampleWidth = 100
      const sampleHeight = 150
      const scanCanvas = document.createElement('canvas')
      scanCanvas.width = sampleWidth
      scanCanvas.height = sampleHeight
      const context = scanCanvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(canvas, 0, 0, sampleWidth, sampleHeight)
      const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data
      let opaquePixels = 0
      let minX = sampleWidth
      let minY = sampleHeight
      let maxX = -1
      let maxY = -1
      for (let y = 0; y < sampleHeight; y++) {
        for (let x = 0; x < sampleWidth; x++) {
          if (pixels[(y * sampleWidth + x) * 4 + 3] <= 8) continue
          opaquePixels++
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
        }
      }
      if (opaquePixels < 12) return null
      const widthRatio = canvas.clientWidth / sampleWidth
      const heightRatio = canvas.clientHeight / sampleHeight
      return {
        x: minX * widthRatio,
        y: minY * heightRatio,
        width: (maxX - minX + 1) * widthRatio,
        height: (maxY - minY + 1) * heightRatio,
      }
    } catch (error) {
      console.warn('Unable to measure visible model bounds:', error.message)
      return null
    }
  }

  function modelBoundsCenter(bounds, canvas) {
    return bounds
      ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      : { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }
  }

  function renderModelAtScale(model, scale, bounds = state.lastHitBounds) {
    const currentScale = Number(model.scale)
    const nextScale = clampModelScale(Number(scale) || 1)
    if (!Number.isFinite(currentScale) || currentScale <= 0) {
      model.scale = nextScale
      model.update()
      return
    }

    // 围绕当前可见角色中心缩放，而不是再次调用 centerModel()。
    // CameraController 使用右起点 X 和画布中线起点 Y，沿用它的坐标换算
    // 可以让不同 Live2D 文件的画布原点/留白差异不影响视觉锚点。
    const anchor = modelBoundsCenter(bounds, model.canvas)
    const canvasRect = model.canvas.getBoundingClientRect()
    const anchorX = canvasRect.width - (anchor.x - canvasRect.left)
    const anchorY = (anchor.y - canvasRect.top) - canvasRect.height / 2
    const worldX = (anchorX - model.x) / currentScale
    const worldY = (anchorY - model.y) / currentScale
    model.scale = nextScale
    model.x = anchorX - worldX * nextScale
    model.y = anchorY - worldY * nextScale
    model.update()
  }

  function initializeModelAtScale(model, scale) {
    // 初次加载只在 100% 时使用一次库的自动居中，然后以实际可见中心
    // 应用用户保存的尺寸。这样重启或切回模型后与交互缩放的结果一致。
    model.scale = 1
    model.centerModel()
    model.update()
    const targetScale = clampModelScale(Number(scale) || 1)
    if (Math.abs(targetScale - 1) < 0.001) return
    renderModelAtScale(model, targetScale, visibleCanvasBounds(model.canvas))
  }

  function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)]
  }

  async function captureSettingsPetBackground(timestamp) {
    if (
      !state.settingsBackgroundCaptureActive || state.settingsBackgroundCapturePending ||
      !state.liveCanvas || !state.model || !state.model.loaded || state.loading ||
      timestamp - state.settingsBackgroundLastFrameAt < SETTINGS_BACKGROUND_FRAME_INTERVAL
    ) return

    const sourceCanvas = state.liveCanvas
    const sourceModel = state.model
    if (!state.settingsBackgroundCanvas) {
      state.settingsBackgroundCanvas = document.createElement('canvas')
      state.settingsBackgroundCanvas.width = SETTINGS_BACKGROUND_WIDTH
      state.settingsBackgroundCanvas.height = SETTINGS_BACKGROUND_HEIGHT
    }

    state.settingsBackgroundCapturePending = true
    state.settingsBackgroundLastFrameAt = timestamp
    try {
      const captureCanvas = state.settingsBackgroundCanvas
      const context = captureCanvas.getContext('2d', { alpha: true })
      const sourceWidth = sourceCanvas.clientWidth || sourceCanvas.width
      const sourceHeight = sourceCanvas.clientHeight || sourceCanvas.height
      const currentScale = Number(sourceModel.scale)
      const normalizer = Number.isFinite(currentScale) && currentScale > 0 ? 1 / currentScale : 1
      const bounds = state.lastHitBounds
      const anchorX = (bounds ? bounds.x + bounds.width / 2 : sourceWidth / 2) * (SETTINGS_BACKGROUND_WIDTH / sourceWidth)
      const anchorY = (bounds ? bounds.y + bounds.height / 2 : sourceHeight / 2) * (SETTINGS_BACKGROUND_HEIGHT / sourceHeight)
      context.clearRect(0, 0, SETTINGS_BACKGROUND_WIDTH, SETTINGS_BACKGROUND_HEIGHT)
      // 设置页背景始终以模型的 100% 基准尺寸展示，不受桌面窗口
      // 中用户自定义缩放比例影响；缩放锚点保持在当前角色视觉中心。
      context.save()
      context.translate(anchorX, anchorY)
      context.scale(normalizer, normalizer)
      context.translate(-anchorX, -anchorY)
      context.drawImage(sourceCanvas, 0, 0, SETTINGS_BACKGROUND_WIDTH, SETTINGS_BACKGROUND_HEIGHT)
      context.restore()
      const blob = await new Promise(resolve => captureCanvas.toBlob(resolve, 'image/webp', 0.76))
      if (!blob) throw new Error('浏览器未生成背景帧')
      const frame = await blob.arrayBuffer()
      if (
        state.settingsBackgroundCaptureActive &&
        sourceCanvas === state.liveCanvas && sourceModel === state.model
      ) {
        window.petAPI.sendSettingsPetBackgroundFrame(frame)
        state.settingsBackgroundErrorReported = false
      }
    } catch (error) {
      if (!state.settingsBackgroundErrorReported) {
        console.warn('Settings pet background capture failed:', error.message)
        state.settingsBackgroundErrorReported = true
      }
    } finally {
      state.settingsBackgroundCapturePending = false
    }
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
      sad: ['sleepy', 'idle'],
      angry: ['tap'],
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
    stopCurrentSpeech()
    if (state.settingsBackgroundCaptureActive) window.petAPI.sendSettingsPetBackgroundFrame(null)
    invalidateChatAnchor(true)
    state.model = null
    state.liveCanvas = null
    state.hitMask = null
    reportStatus('loading', modelMeta.id, `正在加载 ${modelMeta.name}`)

    releaseModel(previousModel, previousCanvas)

    const canvas = createLiveCanvas()
    const nextModel = createModelInstance(canvas)
    try {
      await nextModel.load(modelMeta.path)
      // live2d-renderer 0.6.6 兼容修正：模型在 .model3.json 里声明了
      // LipSync 参数时，库只填充 lipSyncIds，内部 lipsync 开关保持
      // undefined（只有未声明时的 ParamMouthOpenY 兜底分支才赋值），
      // 渲染循环 if (lipsync && enableLipsync) 永不成立，TTS 有声无口型。
      // 这里按 lipSyncIds 补齐开关，不动 node_modules。
      if (!nextModel.lipsync && nextModel.lipSyncIds && nextModel.lipSyncIds.getSize() > 0) {
        nextModel.lipsync = true
      }
      // mori 系列把 ParamMouthOpenY 重复声明了 3 次；渲染循环对每条
      // 记录按 0.8 权重叠加，重复项会让嘴型幅度放大 2~3 倍甚至顶满。
      // 按参数名去重，只留一条。
      if (nextModel.lipSyncIds && nextModel.lipSyncIds.getSize() > 1) {
        const seen = new Set()
        for (let i = nextModel.lipSyncIds.getSize() - 1; i >= 0; i--) {
          const id = nextModel.lipSyncIds.at(i)
          const key = id && id.getString ? id.getString().s : String(id)
          if (seen.has(key)) nextModel.lipSyncIds.remove(i)
          else seen.add(key)
        }
      }
      nextModel.touchController.cancelInteractions()
      nextModel.cameraController.removeListeners()
      initializeModelAtScale(nextModel, state.preferences.scale)
      nextModel.enableMotion = false
      nextModel.paused = false
      // 定位和最终首帧准备完成后才显示新画布，避免加载过程中的临时
      // 相机位置被用户看到。
      canvas.classList.remove('is-preparing')

      state.model = nextModel
      state.modelMeta = modelMeta
      state.liveCanvas = canvas
      state.webglContextLost = false
      state.motionGroups = classifyMotionGroups(nextModel)
      state.hitMaskPending = true
      if (!chatPanel.hidden) rebuildHitMask()
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
    if (!state.liveCanvas || !state.model || !state.model.loaded) return false
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
      if (!chatPanel.hidden && !chatAnchorMatchesCurrentModel()) {
        captureChatAnchor(bounds)
        updateChatPosition()
      }
      return opaquePixels >= 12
    } catch (error) {
      state.hitMask = null
      return false
    }
  }

  async function recoverVisibleModel(reason) {
    if (!state.visible || state.loading || state.recoveringVisibility) return
    if (state.wakeRecoveryAttempts >= 1 || !state.snapshot) return
    const modelId = (state.modelMeta && state.modelMeta.id) || state.snapshot.currentModelId
    if (!modelId) return

    state.recoveringVisibility = true
    state.wakeRecoveryAttempts++
    state.pendingModelId = modelId
    console.warn(`Recovering model after visibility change: ${reason}`)
    try {
      await processModelQueue()
    } finally {
      state.recoveringVisibility = false
      state.webglContextLost = false
      if (state.visible) {
        markInteraction(2200)
        scheduleWakeHealthCheck(320, false)
      }
    }
  }

  function scheduleWakeHealthCheck(delay = 220, allowRecovery = true) {
    if (state.wakeCheckTimer) clearTimeout(state.wakeCheckTimer)
    state.wakeCheckTimer = setTimeout(() => {
      state.wakeCheckTimer = null
      if (!state.visible || state.loading || state.recoveringVisibility || !state.model || !state.model.loaded) return

      let contextLost = state.webglContextLost
      try {
        const context = state.liveCanvas && state.liveCanvas.getContext('webgl2')
        contextLost = contextLost || !context || context.isContextLost()
        if (!contextLost) state.model.update()
      } catch (error) {
        contextLost = true
      }

      const hasVisiblePixels = !contextLost && rebuildHitMask()
      if (!hasVisiblePixels && allowRecovery) {
        recoverVisibleModel(contextLost ? 'WebGL context unavailable' : 'blank frame after wake')
      }
    }, delay)
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

  function isDraggablePoint(clientX, clientY, target = null) {
    const hoveredElement = target instanceof Element ? target : document.elementFromPoint(clientX, clientY)
    const overChat = Boolean(hoveredElement && hoveredElement.closest('#ai-chat-panel'))
    return Boolean(
      state.preferences &&
      state.preferences.interactionMode !== 'locked' &&
      !overChat &&
      isOnPet(clientX, clientY)
    )
  }

  function setDragAffordance(visible) {
    const enabled = Boolean(state.preferences && state.preferences.backgroundDetection)
    stage.classList.toggle('is-drag-hover', enabled && Boolean(visible))
  }

  function updateMouseCapture(clientX, clientY, target = null) {
    state.pointer = { clientX, clientY }
    setDragAffordance(isDraggablePoint(clientX, clientY, target))
  }

  function clampModelScale(value) {
    return Math.min(MODEL_SCALE_MAX, Math.max(MODEL_SCALE_MIN, value))
  }

  function steppedModelScale(value, direction) {
    const aligned = Math.round((Number(value) || 1) / MODEL_SCALE_STEP) * MODEL_SCALE_STEP
    return Number(clampModelScale(aligned + direction * MODEL_SCALE_STEP).toFixed(2))
  }

  async function applyWheelScale() {
    wheelScaleTimer = null
    const modelId = wheelScaleModelId
    const direction = wheelScaleDirection
    wheelScaleModelId = null
    wheelScaleDirection = 0
    if (!modelId || !direction || !state.snapshot || state.snapshot.currentModelId !== modelId) return

    const currentScale = Number(state.preferences && state.preferences.scale)
    const nextScale = steppedModelScale(currentScale, direction)
    if (!Number.isFinite(currentScale) || Math.abs(nextScale - currentScale) < 0.001) return

    try {
      const result = await window.petAPI.updateModelScale(modelId, nextScale)
      if (!result || !result.ok) {
        showStatus(result && result.error ? result.error : '角色尺寸保存失败', 'error', 1800)
        return
      }
      markInteraction(1200)
      showStatus(`角色尺寸 ${Math.round(nextScale * 100)}%`, 'info', 900)
    } catch (error) {
      console.error('Wheel scale update failed:', error)
      showStatus('角色尺寸保存失败', 'error', 1800)
    }
  }

  function queueWheelScale(event) {
    if (state.pointerDown || state.dragging) return
    if (!isDraggablePoint(event.clientX, event.clientY, event.target)) return
    if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return
    event.preventDefault()
    wheelScaleDirection = event.deltaY < 0 ? 1 : -1
    wheelScaleModelId = state.snapshot && state.snapshot.currentModelId
    if (wheelScaleTimer) clearTimeout(wheelScaleTimer)
    wheelScaleTimer = setTimeout(applyWheelScale, WHEEL_SCALE_DEBOUNCE_MS)
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
      sad: { glyph: '·', colors: ['#7d8fc4', '#a99ee7', '#c7c0ee'] },
      angry: { glyph: '!', colors: ['#e2606d', '#f0a85e', '#e888aa'] },
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

  function currentMouthAnchor() {
    const model = state.model
    if (model && model.loaded && model.settings && model.model && model.projection) {
      try {
        let headDrawableId = null
        for (let index = 0; index < model.settings.getHitAreasCount(); index++) {
          if (String(model.settings.getHitAreaName(index)).toLowerCase() === 'head') {
            headDrawableId = model.settings.getHitAreaId(index)
            break
          }
        }
        if (headDrawableId) {
          const drawableIndex = model.model.getDrawableIndex(headDrawableId)
          const vertexCount = model.model.getDrawableVertexCount(drawableIndex)
          const vertices = model.model.getDrawableVertices(drawableIndex)
          let left = Infinity
          let right = -Infinity
          let top = Infinity
          let bottom = -Infinity
          for (let index = 0; index < vertexCount; index++) {
            const modelX = vertices[index * 2]
            const modelY = vertices[index * 2 + 1]
            const screenX = ((model.projection.transformX(modelX) + 1) * model.canvas.clientWidth) / 2
            const screenY = ((1 - model.projection.transformY(modelY)) * model.canvas.clientHeight) / 2
            if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) continue
            left = Math.min(left, screenX)
            right = Math.max(right, screenX)
            top = Math.min(top, screenY)
            bottom = Math.max(bottom, screenY)
          }
          if (left < right && top < bottom) {
            return {
              x: (left + right) / 2,
              y: top + (bottom - top) * 0.68,
              head: { left, right, top, bottom },
            }
          }
        }
      } catch (error) {
        console.warn('Unable to calculate mouth anchor:', error.message)
      }
    }

    const bounds = state.lastHitBounds
    if (bounds) {
      const centerX = bounds.x + bounds.width * 0.5
      const headHalfWidth = Math.min(62, Math.max(38, bounds.width * 0.2))
      return {
        x: centerX,
        y: bounds.y + Math.min(96, Math.max(50, bounds.height * 0.2)),
        head: {
          left: centerX - headHalfWidth,
          right: centerX + headHalfWidth,
          top: bounds.y,
          bottom: bounds.y + Math.min(130, bounds.height * 0.3),
        },
      }
    }
    return {
      x: window.innerWidth * 0.5,
      y: window.innerHeight * 0.22,
      head: {
        left: window.innerWidth * 0.38,
        right: window.innerWidth * 0.62,
        top: window.innerHeight * 0.12,
        bottom: window.innerHeight * 0.3,
      },
    }
  }

  function bubbleDurationForText(text) {
    const characterCount = Array.from(String(text || '').trim()).length
    if (characterCount <= 10) return 2000
    if (characterCount <= 20) return 3000
    if (characterCount <= 40) return 4500
    if (characterCount <= 70) return 6500
    if (characterCount <= 100) return 8500
    return 10000
  }

  function showBubble(text, duration = null, source = 'interaction') {
    if (!text) return
    // AI 请求期间只允许最终回复占用宠物气泡；拖动、点击和闲置反馈
    // 仍可执行动作与粒子效果，但不覆盖对话状态，也不在结束后补发。
    if (chatBusy && source !== 'ai') return
    const width = window.innerWidth
    const height = window.innerHeight
    const edge = 10
    const gap = 10
    const mouth = currentMouthAnchor()
    const bounds = state.lastHitBounds
    const characterTop = bounds ? bounds.y : mouth.head.top
    const bubbleWidth = Math.min(220, width - edge * 2)
    const left = Math.max(edge, Math.round((width - bubbleWidth) * 0.5))

    interactionBubbleText.textContent = text
    interactionBubble.classList.remove('is-left', 'is-right')
    interactionBubble.classList.add('is-top')
    interactionBubble.style.width = `${bubbleWidth}px`
    interactionBubble.style.left = `${left}px`
    interactionBubble.style.top = `${edge}px`
    interactionBubble.classList.add('is-visible')
    const bubbleRect = interactionBubble.getBoundingClientRect()
    const top = Math.max(edge, Math.min(height - edge - bubbleRect.height, characterTop - gap - bubbleRect.height))
    interactionBubble.style.top = `${top}px`
    interactionBubble.style.setProperty('--bubble-tail-x', `${Math.max(18, Math.min(bubbleRect.width - 18, mouth.x - left))}px`)
    window.petAPI.reportBubbleBounds({ x: left, y: top, width: bubbleRect.width, height: bubbleRect.height })
    if (bubbleTimer) clearTimeout(bubbleTimer)
    const visibleDuration = Number.isFinite(duration) && duration > 0
      ? duration
      : bubbleDurationForText(text)
    bubbleTimer = setTimeout(() => {
      interactionBubble.classList.remove('is-visible')
      window.petAPI.reportBubbleBounds(null)
    }, visibleDuration)
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
      sad: { motion: 'sleepy', count: 4, pose: { x: 0, y: -0.46 } },
      angry: { motion: 'tap', count: 7, pose: { x: -0.36, y: -0.14 } },
      drag: { motion: 'greet', count: 5, pose: { x: 0.22, y: 0.12 } },
    }[kind] || { motion: 'tap', count: 6, pose: { x: 0, y: 0.2 } }
    const x = Math.max(20, Math.min(window.innerWidth - 20, Number(point && point.clientX) || window.innerWidth * 0.5))
    const y = Math.max(20, Math.min(window.innerHeight - 20, Number(point && point.clientY) || window.innerHeight * 0.32))

    playMotion(config.motion, kind === 'excited' ? motionPriority.force : motionPriority.normal)
    state.reactionPose = { ...config.pose, until: performance.now() + (kind === 'calm' ? 1800 : 1150) }
    addReactionEffect(x, y, kind, config.count)
    const copy = interactionCopy[kind] || interactionCopy.greet
    showBubble(randomItem(copy))
    markInteraction(kind === 'calm' ? 3000 : 2400)
  }

  function appendChatMessage(text, type = 'assistant', speech = null, kind = null) {
    const message = document.createElement('div')
    message.className = `ai-message is-${type}`
    message.dataset.messageKind = kind || (type === 'thinking' || type === 'error' ? 'system' : 'conversation')
    const content = document.createElement('span')
    content.className = 'ai-message-content'
    content.textContent = text
    message.appendChild(content)
    if (type === 'assistant' && speech && speech.audioBase64) {
      const audioButton = document.createElement('button')
      audioButton.className = 'ai-message-audio'
      audioButton.type = 'button'
      audioButton.setAttribute('aria-label', '播放这条语音')
      audioButton.title = '播放这条语音'
      audioButton.innerHTML = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 7h3l3.5-2.8v9.6L6 11H3z"/><path d="M12 6.2a4 4 0 0 1 0 5.6M14 4.3a6.6 6.6 0 0 1 0 9.4"/></svg>'
      audioButton.addEventListener('click', () => playGeneratedSpeech(speech.audioBase64, audioButton))
      message.classList.add('has-audio')
      message.appendChild(audioButton)
    }
    chatMessages.appendChild(message)
    chatMessages.scrollTop = chatMessages.scrollHeight
    updateChatPosition()
    return message
  }

  // 可见聊天记录按角色隔离：切换角色时把当前面板对话存回原角色名下，
  // 再恢复新角色的对话（LLM 上下文隔离由主进程 plugin-manager 负责）。
  // 恢复出来的历史消息不带语音回放按钮，避免常驻大量 base64 音频。
  const chatHistories = new Map()
  const CHAT_HISTORY_KEEP = 50

  function snapshotChatHistory(modelId) {
    if (!modelId) return
    const entries = []
    chatMessages.querySelectorAll('.ai-message').forEach(el => {
      if (el.classList.contains('is-thinking')) return
      const type = ['user', 'error'].find(t => el.classList.contains(`is-${t}`)) || 'assistant'
      const kind = el.dataset.messageKind || (type === 'error' ? 'system' : 'conversation')
      const content = el.querySelector('.ai-message-content')
      if (content && content.textContent) entries.push({ type, kind, text: content.textContent })
    })
    chatHistories.set(modelId, entries.slice(-CHAT_HISTORY_KEEP))
  }

  function restoreChatHistory(modelId) {
    chatMessages.replaceChildren()
    const entries = (modelId && chatHistories.get(modelId)) || []
    for (const entry of entries) appendChatMessage(entry.text, entry.type, null, entry.kind)
  }

  function invalidateChatAnchor(clearBounds = false) {
    state.chatAnchorBottom = null
    state.chatAnchorModelId = null
    state.chatAnchorScale = null
    state.chatAnchorViewportHeight = null
    if (clearBounds) state.lastHitBounds = null
  }

  function ensureChatGreeting() {
    const greeting = state.preferences && typeof state.preferences.chatGreeting === 'string'
      ? state.preferences.chatGreeting.trim()
      : ''
    const hasConversation = chatMessages.querySelector('.ai-message[data-message-kind="conversation"]')
    const hasGreeting = chatMessages.querySelector('.ai-message[data-message-kind="greeting"]')
    if (!greeting || hasConversation || hasGreeting) return false
    appendChatMessage(greeting, 'assistant', null, 'greeting')
    snapshotChatHistory(state.snapshot && state.snapshot.currentModelId)
    showBubble(greeting, null, 'ai')
    return true
  }

  function chatAnchorMatchesCurrentModel() {
    const modelId = state.modelMeta && state.modelMeta.id
    const modelScale = state.model && Number(state.model.scale)
    return Number.isFinite(state.chatAnchorBottom)
      && state.chatAnchorModelId === modelId
      && Number.isFinite(modelScale)
      && Math.abs(state.chatAnchorScale - modelScale) < 0.001
      && state.chatAnchorViewportHeight === window.innerHeight
  }

  function captureChatAnchor(bounds = state.lastHitBounds) {
    if (!bounds || !state.modelMeta || !state.model) return false
    const modelScale = Number(state.model.scale)
    if (!Number.isFinite(modelScale)) return false
    state.chatAnchorBottom = Math.max(0, Math.min(window.innerHeight, bounds.y + bounds.height))
    state.chatAnchorModelId = state.modelMeta.id
    state.chatAnchorScale = modelScale
    state.chatAnchorViewportHeight = window.innerHeight
    return true
  }

  function updateStatusToastPosition() {
    if (chatPanel.hidden) {
      statusToast.style.removeProperty('--toast-bottom')
      return
    }
    const chatTop = chatPanel.offsetTop
    const bottom = Math.max(18, window.innerHeight - chatTop + 10)
    statusToast.style.setProperty('--toast-bottom', `${bottom}px`)
  }

  function updateChatPosition() {
    const bounds = state.lastHitBounds
    if (chatPanel.hidden) {
      chatPanel.classList.remove('is-overlapping-pet')
      chatPanel.style.removeProperty('--chat-top')
      updateStatusToastPosition()
      return
    }
    if (!chatAnchorMatchesCurrentModel() && !captureChatAnchor(bounds)) {
      updateStatusToastPosition()
      return
    }
    const characterBottom = state.chatAnchorBottom
    const panelHeight = chatPanel.offsetHeight || 222
    const maximumTop = Math.max(10, window.innerHeight - panelHeight - 10)
    chatPanel.classList.toggle('is-overlapping-pet', characterBottom > maximumTop)
    chatPanel.style.setProperty('--chat-top', `${Math.min(characterBottom, maximumTop)}px`)
    updateStatusToastPosition()
  }

  function setChatCollapsed(collapsed) {
    chatCollapsed = Boolean(collapsed)
    chatPanel.classList.toggle('is-collapsed', chatCollapsed)
    chatToggle.setAttribute('aria-expanded', String(!chatCollapsed))
    chatToggle.setAttribute('aria-label', chatCollapsed ? '展开对话' : '收起对话')
    chatToggle.title = chatCollapsed ? '展开对话' : '收起对话'
    updateChatPosition()
    if (!chatCollapsed) chatMessages.scrollTop = chatMessages.scrollHeight
  }

  function setChatOpen(open, notifyHost = true) {
    const next = Boolean(open)
    const wasHidden = chatPanel.hidden
    chatPanel.hidden = !next
    if (!next || wasHidden) setChatMuted(true)
    if (notifyHost) window.petAPI.setChatPanelOpen(next)
    if (next) {
      setDragAffordance(false)
      if (wasHidden) {
        captureChatAnchor(state.lastHitBounds)
        setChatCollapsed(true)
      }
      hideStatus()
      markInteraction(5000)
      updateChatIdentity()
      ensureChatGreeting()
      updateChatPosition()
      setTimeout(() => {
        chatMessages.scrollTop = chatMessages.scrollHeight
        chatInput.focus()
      }, 0)
    } else {
      chatInput.value = ''
      resizeChatInput()
      updateChatSendState()
    }
  }

  // 面板身份跟随当前角色：名字、输入框占位符
  let lastChatIdentityName = '伙伴'
  function currentModelMeta() {
    const modelId = (state.modelMeta && state.modelMeta.id) || (state.snapshot && state.snapshot.currentModelId)
    const snapshotMeta = modelId && state.snapshot && state.snapshot.models
      ? state.snapshot.models.find(item => item.id === modelId)
      : null
    return snapshotMeta || state.modelMeta
  }

  function updateChatIdentity() {
    // 昵称更新不会重新加载 Live2D 模型，因此必须优先读取最新快照，
    // 不能继续使用加载模型时保存的旧 modelMeta。
    const meta = currentModelMeta()
    const name = (meta && meta.displayName) || (meta && meta.name) || lastChatIdentityName
    lastChatIdentityName = name
    chatName.textContent = name
    chatPanel.setAttribute('aria-label', `与${name}对话`)
    if (meta) chatInput.placeholder = `和${name}说点什么…`
  }

  function resizeChatInput() {
    chatInput.style.height = 'auto'
    chatInput.style.height = `${Math.min(82, chatInput.scrollHeight)}px`
  }

  function updateChatSendState() {
    chatSend.disabled = chatBusy || chatInput.value.trim().length === 0
  }

  function stopCurrentSpeech() {
    speechSequence += 1
    if (activeSpeechButton) {
      activeSpeechButton.classList.remove('is-playing')
      activeSpeechButton.setAttribute('aria-label', '播放这条语音')
      activeSpeechButton.title = '播放这条语音'
      activeSpeechButton = null
    }
    if (!state.model || typeof state.model.stopAudio !== 'function') return
    try { state.model.stopAudio() } catch (error) { /* 没有正在播放的语音 */ }
  }

  function setChatMuted(muted) {
    chatMuted = Boolean(muted)
    chatMute.classList.toggle('is-muted', chatMuted)
    chatMute.setAttribute('aria-pressed', String(chatMuted))
    const label = chatMuted ? '已静音，点击开启语音' : '语音已开启，点击静音'
    chatMute.setAttribute('aria-label', label)
    chatMute.title = label
    if (chatMuted) stopCurrentSpeech()
  }

  function base64ToArrayBuffer(value) {
    const binary = window.atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    return bytes.buffer
  }

  async function synthesizeAssistantSpeech(text) {
    const ai = state.snapshot && state.snapshot.ai
    if (!ai || !ai.readyByCapability || !ai.readyByCapability.tts) return null
    const requestId = ++speechSequence
    try {
      const result = await window.petAPI.synthesizeSpeech(text)
      if (requestId !== speechSequence) return null
      if (!result || !result.ok) {
        if (!result || !result.skipped) showStatus(result && result.error ? result.error : '语音生成失败', 'error', 3200)
        return null
      }
      if (!result.audioBase64) throw new Error('语音服务没有返回可播放音频')
      return { audioBase64: result.audioBase64, mimeType: result.mimeType || 'audio/wav' }
    } catch (error) {
      if (requestId !== speechSequence) return null
      console.warn('Speech synthesis failed:', error.message)
      showStatus(error.message || '语音生成失败', 'error', 3200)
      return null
    }
  }

  async function playGeneratedSpeech(audioBase64, button = null) {
    if (!audioBase64 || !state.model || typeof state.model.inputAudio !== 'function') return false
    if (chatMuted) {
      showStatus('请先解除静音再播放语音', 'info', 2200)
      return false
    }
    if (button && activeSpeechButton === button) {
      stopCurrentSpeech()
      return false
    }
    stopCurrentSpeech()
    const requestId = ++speechSequence
    const model = state.model
    if (button) {
      activeSpeechButton = button
      button.classList.add('is-playing')
      button.setAttribute('aria-label', '停止这条语音')
      button.title = '停止这条语音'
    }
    try {
      if (model.audioContext && model.audioContext.state === 'suspended') await model.audioContext.resume()
      if (requestId !== speechSequence || model !== state.model) return false
      markInteraction(60000)
      const playback = model.inputAudio(base64ToArrayBuffer(audioBase64), true)
      Promise.resolve(playback).then(() => {
        if (requestId !== speechSequence) return
        if (button && activeSpeechButton === button) {
          button.classList.remove('is-playing')
          button.setAttribute('aria-label', '播放这条语音')
          button.title = '播放这条语音'
          activeSpeechButton = null
        }
        markInteraction(1600)
      }).catch(error => {
        if (requestId !== speechSequence) return
        stopCurrentSpeech()
        console.warn('Speech playback failed:', error.message)
        showStatus(error.message || '语音播放失败', 'error', 3200)
      })
      return true
    } catch (error) {
      if (requestId !== speechSequence) return false
      stopCurrentSpeech()
      console.warn('Speech playback failed:', error.message)
      showStatus(error.message || '语音播放失败', 'error', 3200)
      return false
    }
  }

  async function submitChat() {
    const text = chatInput.value.trim()
    if (!text || chatBusy) return
    stopCurrentSpeech()
    chatBusy = true
    chatInput.value = ''
    resizeChatInput()
    updateChatSendState()
    chatInput.disabled = true
    chatPanel.classList.add('is-thinking')
    chatPresenceText.textContent = '思考中'
    appendChatMessage(text, 'user')
    const thinking = appendChatMessage('正在想', 'thinking')
    showBubble('思考中…', 45000, 'ai')
    markInteraction(60000)
    try {
      const result = await window.petAPI.sendAIMessage(text)
      if (!result || !result.ok) throw new Error(result && result.error ? result.error : '暂时没有收到回复')
      const ai = state.snapshot && state.snapshot.ai
      const ttsReady = Boolean(!chatMuted && ai && ai.readyByCapability && ai.readyByCapability.tts)
      let speech = null
      if (ttsReady) {
        thinking.textContent = '语言组织中'
        chatPresenceText.textContent = '语言组织中'
        showBubble('语言组织中…', 60000, 'ai')
        markInteraction(60000)
        speech = await synthesizeAssistantSpeech(result.text)
      }
      thinking.remove()
      const assistantMessage = appendChatMessage(result.text, 'assistant', speech)
      // 回复开头的情绪标签已由主进程剥离并解析为稳定键，映射到对应
      // 的情绪动作；模型没给标签时退回好奇反应（原默认行为）
      runInteraction(emotionInteractions[result.emotion] || 'curious')
      const bubbleText = result.text.length > 42 ? `${result.text.slice(0, 42)}…` : result.text
      showBubble(bubbleText, null, 'ai')
      if (speech) {
        const audioButton = assistantMessage.querySelector('.ai-message-audio')
        playGeneratedSpeech(speech.audioBase64, audioButton)
      }
    } catch (error) {
      thinking.remove()
      const message = error.message || '连接失败，请稍后再试'
      appendChatMessage(message, 'error')
      showBubble(message, null, 'ai')
    } finally {
      chatBusy = false
      chatInput.disabled = false
      updateChatSendState()
      chatPanel.classList.remove('is-thinking')
      chatPresenceText.textContent = '在线'
      chatInput.focus()
    }
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
      showBubble('z · z · z')
    } else if (idleFor >= 90000 && state.idleStage < 2) {
      state.idleStage = 2
      showBubble('有点困了')
    } else if (idleFor >= 30000 && state.idleStage < 1) {
      state.idleStage = 1
      playMotion('idle', motionPriority.idle)
      showBubble(randomItem(idleCopy))
    }
  }

  function targetFrameRate(timestamp) {
    if (state.paused || state.loading || !state.visible) return 2
    if (!state.preferences) return 30
    const idleFor = timestamp - state.lastInteraction
    let fps = 60
    if (state.preferences.idleEnabled && idleFor >= 180000) fps = 10
    else if (state.preferences.idleEnabled && idleFor >= 90000) fps = 20
    else if (reducedMotionEnabled()) fps = 20
    else if (state.preferences.qualityMode === 'eco') fps = 30
    else if (state.preferences.qualityMode !== 'high' && timestamp > state.activeUntil) fps = 30
    return state.settingsBackgroundCaptureActive ? Math.max(20, fps) : fps
  }

  function scheduleNextFrame() {
    if (!state.visible || state.frameTimer || state.frameRequest) return
    const fps = targetFrameRate(performance.now())
    const frameDelay = Math.max(0, Math.round(1000 / fps) - 2)
    state.frameTimer = setTimeout(() => {
      state.frameTimer = null
      state.frameRequest = requestAnimationFrame(frame)
      // Windows 将透明窗口移出屏幕时可能暂停 rAF。正常帧到来会清除
      // 看门狗；若没有到来，就主动撤销陈旧句柄并补画一帧。
      state.frameWatchdog = setTimeout(() => {
        state.frameWatchdog = null
        if (!state.frameRequest) return
        cancelAnimationFrame(state.frameRequest)
        state.frameRequest = null
        if (state.visible) frame(performance.now())
      }, Math.max(250, Math.round(3000 / fps)))
    }, frameDelay)
  }

  function frame(timestamp) {
    if (state.frameWatchdog) clearTimeout(state.frameWatchdog)
    state.frameWatchdog = null
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
    captureSettingsPetBackground(timestamp)
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
    if (state.frameWatchdog) clearTimeout(state.frameWatchdog)
    state.frameTimer = null
    state.frameRequest = null
    state.frameWatchdog = null
  }

  function syncVisibility(hostVisible = state.hostVisible) {
    const previousHostVisible = state.hostVisible
    const nextHostVisible = Boolean(hostVisible)
    // 透明桌面窗口失去焦点或被系统判定为 occluded 时，Chromium 可能把
    // document.hidden 设为 true。桌面宠物仍应继续低频绘制，否则 WebGL
    // 合成层会被清空；真正的显隐只由主进程的托盘状态控制。
    const nextVisible = nextHostVisible || state.settingsBackgroundCaptureActive
    const becameVisible = nextVisible && !state.visible
    const hostBecameVisible = nextHostVisible && previousHostVisible === false

    state.hostVisible = nextHostVisible
    state.visible = nextVisible
    if (!nextVisible) {
      if (state.wakeCheckTimer) clearTimeout(state.wakeCheckTimer)
      state.wakeCheckTimer = null
      cancelScheduler()
      return
    }
    if (!becameVisible && !hostBecameVisible) return

    // 每次从托盘恢复都从休息状态真正唤醒，不能沿用被系统遮挡优化
    // 冻结的 rAF 句柄。先同步补画一帧，再恢复自适应调度。
    cancelScheduler()
    const now = performance.now()
    state.lastFrame = now
    state.lastFxFrame = now
    state.lastInteraction = now
    state.activeUntil = now + 2600
    state.idleStage = 0
    state.hitMaskPending = true
    state.wakeRecoveryAttempts = 0
    if (!state.loading && state.model && state.model.loaded) {
      try {
        updateFollow()
        state.model.update()
      } catch (error) {
        console.warn('Wake redraw failed:', error.message)
      }
      if (hostBecameVisible) showBubble('我醒啦～')
      if (nextHostVisible) scheduleWakeHealthCheck()
    }
    ensureScheduler()
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
    const modelChanged = previousModelId !== snapshot.currentModelId
    if (modelChanged) invalidateChatAnchor(true)
    state.snapshot = snapshot
    if (state.modelMeta && state.modelMeta.id === snapshot.currentModelId) {
      const refreshedMeta = snapshot.models.find(item => item.id === state.modelMeta.id)
      if (refreshedMeta) state.modelMeta = refreshedMeta
    }
    state.preferences = snapshot.preferences
    stage.classList.toggle('has-background-detection', Boolean(snapshot.preferences.backgroundDetection))
    if (!snapshot.preferences.backgroundDetection) setDragAffordance(false)
    state.paused = Boolean(snapshot.runtime && snapshot.runtime.paused)
    syncVisibility(Boolean(snapshot.runtime && snapshot.runtime.petVisible))
    if (!snapshot.ai || !snapshot.ai.ready) setChatOpen(false)
    if (!chatPanel.hidden) updateChatIdentity()

    if (state.model && state.modelMeta && state.modelMeta.id === snapshot.currentModelId) {
      const newScale = Number(snapshot.preferences.scale)
      if (Number.isFinite(newScale) && Math.abs(state.model.scale - newScale) > 0.001) {
        invalidateChatAnchor()
        renderModelAtScale(state.model, newScale)
        state.hitMaskPending = true
        if (!chatPanel.hidden) rebuildHitMask()
        markInteraction(900)
      }
    }

    if (previousModelId && previousModelId !== snapshot.currentModelId) {
      snapshotChatHistory(previousModelId)
    }
    if (modelChanged) {
      restoreChatHistory(snapshot.currentModelId)
    }
    if (!chatPanel.hidden) ensureChatGreeting()

    if (!previousModelId || modelChanged || !state.model) {
      requestModel(snapshot.currentModelId)
    }
    ensureScheduler()
  }

  document.addEventListener('wheel', queueWheelScale, { passive: false })

  document.addEventListener('mousemove', event => {
    updateMouseCapture(event.clientX, event.clientY, event.target)
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
      stage.classList.add('is-dragging')
      window.petAPI.dragStart(event.screenX, event.screenY)
    }
    if (state.dragging) {
      window.petAPI.dragMove(event.screenX, event.screenY)
      markInteraction(700)
    }
  })

  document.addEventListener('mousedown', event => {
    if (event.target.closest('#ai-chat-panel')) return
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
    setDragAffordance(true)
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
      stage.classList.remove('is-dragging')
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
    updateMouseCapture(event.clientX, event.clientY, event.target)
  })

  document.addEventListener('mouseleave', () => {
    if (!state.dragging) setDragAffordance(false)
  })

  document.addEventListener('contextmenu', event => {
    if (event.target.closest('#ai-chat-panel')) return
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
    stage.classList.remove('is-dragging')
    setDragAffordance(false)
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
    if (event.key === 'Escape' && !chatPanel.hidden) {
      event.preventDefault()
      setChatOpen(false)
      return
    }
    if (event.target.closest('#ai-chat-panel')) return
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
    else if (!state.dragging) setDragAffordance(false)
  })

  window.petAPI.onPauseChanged(paused => {
    state.paused = Boolean(paused)
    ensureScheduler()
  })

  window.petAPI.onInteractionRequested(request => {
    runInteraction(request && request.kind ? request.kind : 'random')
  })

  window.petAPI.onChatVisibility(open => setChatOpen(open, false))

  window.petAPI.onSettingsPetBackgroundCapture(active => {
    const next = Boolean(active)
    if (state.settingsBackgroundCaptureActive === next) return
    state.settingsBackgroundCaptureActive = next
    state.settingsBackgroundLastFrameAt = 0
    state.settingsBackgroundErrorReported = false
    syncVisibility(state.hostVisible)
    if (next) ensureScheduler()
  })

  document.getElementById('ai-chat-close').addEventListener('click', () => setChatOpen(false))
  chatToggle.addEventListener('click', () => {
    setChatCollapsed(!chatCollapsed)
    chatInput.focus()
  })
  chatMute.addEventListener('click', () => setChatMuted(!chatMuted))
  document.getElementById('ai-chat-clear').addEventListener('click', async () => {
    stopCurrentSpeech()
    await window.petAPI.clearAIConversation()
    // 只清当前角色的会话：LLM 上下文（主进程按 插件×角色 隔离）和本地记录
    if (state.snapshot) chatHistories.delete(state.snapshot.currentModelId)
    chatMessages.replaceChildren()
    ensureChatGreeting()
    chatInput.focus()
  })
  chatForm.addEventListener('submit', event => {
    event.preventDefault()
    submitChat()
  })
  chatInput.addEventListener('input', () => {
    resizeChatInput()
    updateChatSendState()
  })
  chatInput.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submitChat()
    }
  })
  updateChatSendState()

  // ---- 角色封面生成：串行加载其他模型并截取首帧缩略图 ----
  let coverQueue = []
  let coverBusy = false

  async function centeredCoverDataURL(sourceCanvas) {
    const rawDataURL = sourceCanvas.toDataURL('image/png')
    try {
      const image = new Image()
      image.src = rawDataURL
      await image.decode()

      const scanCanvas = document.createElement('canvas')
      scanCanvas.width = sourceCanvas.width
      scanCanvas.height = sourceCanvas.height
      const scanContext = scanCanvas.getContext('2d', { willReadFrequently: true })
      scanContext.drawImage(image, 0, 0)
      const pixels = scanContext.getImageData(0, 0, scanCanvas.width, scanCanvas.height).data
      let minX = scanCanvas.width
      let minY = scanCanvas.height
      let maxX = -1
      let maxY = -1

      for (let y = 0; y < scanCanvas.height; y++) {
        for (let x = 0; x < scanCanvas.width; x++) {
          if (pixels[(y * scanCanvas.width + x) * 4 + 3] <= 8) continue
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
        }
      }
      if (maxX < minX || maxY < minY) return rawDataURL

      const contentWidth = maxX - minX + 1
      const contentHeight = maxY - minY + 1
      const targetX = Math.round((scanCanvas.width - contentWidth) / 2)
      const targetY = Math.round((scanCanvas.height - contentHeight) / 2)
      const outputCanvas = document.createElement('canvas')
      outputCanvas.width = scanCanvas.width
      outputCanvas.height = scanCanvas.height
      outputCanvas.getContext('2d').drawImage(
        scanCanvas,
        minX, minY, contentWidth, contentHeight,
        targetX, targetY, contentWidth, contentHeight
      )
      return outputCanvas.toDataURL('image/png')
    } catch (error) {
      console.warn('Cover centering failed:', error.message)
      return rawDataURL
    }
  }

  async function renderModelCover(item) {
    const canvas = document.createElement('canvas')
    canvas.width = 220
    canvas.height = 280
    const model = createModelInstance(canvas)
    try {
      await model.load(item.path)
      model.touchController.cancelInteractions()
      model.cameraController.removeListeners()
      renderModelAtScale(model, 0.5)
      model.paused = false
      await new Promise(resolve => setTimeout(resolve, 80))
      model.update()
      const dataURL = await centeredCoverDataURL(canvas)
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
    if (state.hostVisible) ensureScheduler()
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
    if (!snapshot.models.some(model => model.status === 'ready')) {
      showStatus('没有找到可用的 Cubism 3/4 模型', 'error')
      reportStatus('empty', '', '没有找到可用的 Cubism 3/4 模型')
    }
  } catch (error) {
    console.error('App initialization failed:', error)
    showStatus('启动失败，请从托盘退出后重试', 'error')
    reportStatus('error', '', '应用初始化失败')
  }
})()
