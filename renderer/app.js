(async function () {
  const pathModule = require('path')
  const originalJoin = pathModule.join
  const originalDirname = pathModule.dirname
  const normalizePath = value => typeof value === 'string' ? value.replace(/\\/g, '/') : value
  const isResourceUrl = value => typeof value === 'string' && /^[a-z][a-z\d+.-]*:\/\//i.test(value)
  // live2d-renderer uses Node's path.dirname/path.join for both filesystem paths
  // and browser URLs. On Windows, joining a file:// URL turns it into
  // `.\file:\D:\...`, so fetch() resolves a bogus relative URL. Keep ordinary
  // path behaviour, but resolve URL-backed model resources with the URL API.
  pathModule.join = (...parts) => {
    if (isResourceUrl(parts[0])) {
      const base = normalizePath(parts[0])
      const relative = parts.slice(1).map(normalizePath).join('/')
      return new URL(relative, base.endsWith('/') ? base : `${base}/`).href
    }
    return normalizePath(originalJoin(...parts))
  }
  pathModule.dirname = value => isResourceUrl(value)
    ? new URL('.', normalizePath(value)).href
    : normalizePath(originalDirname(value))

  const { Live2DCubismModel } = require('live2d-renderer')
  const { VideoPetModel } = require('./video-pet-model')
  const {
    AI_EMOTION_INTERACTIONS: emotionInteractions,
    MODEL_REACTION_PROFILES: modelReactionProfiles,
    PREVIEW_ACTION_LABELS: previewActionLabels,
    PREVIEW_EXPRESSION_LABELS: previewExpressionLabels,
  } = require('../config/model-reactions')
  const {
    normalizeLongMessageCharacterThreshold,
    isLongMessageText,
  } = require('../config/long-message')
  const {
    PET_GESTURE_LIMITS,
    advanceMultiClick,
    classifyHitAreaRole,
    classifyPointerRelease,
    pointIsHeadByPolicy,
  } = require('../config/pet-gesture-policy')
  const petViewport = document.getElementById('pet-viewport')
  const stage = document.getElementById('pet-stage')
  const effectsCanvas = document.getElementById('fx-canvas')
  const effectsContext = effectsCanvas.getContext('2d')
  const interactionBubble = document.getElementById('interaction-bubble')
  const statusToast = document.getElementById('status-toast')
  const longMessageReader = document.getElementById('long-message-reader')
  const longMessageBody = document.getElementById('long-message-reader-body')
  const longMessageCopy = document.getElementById('long-message-copy')
  const longMessageCollapse = document.getElementById('long-message-collapse')
  const longMessageTitle = document.getElementById('long-message-title')
  const longMessageSubtitle = document.getElementById('long-message-subtitle')
  const longMessageSource = document.getElementById('long-message-source')
  const longMessageBadge = document.getElementById('long-message-badge')
  const longMessageAudioKind = document.getElementById('long-message-audio-kind')
  const longMessageAudio = document.getElementById('long-message-audio')
  const longMessageStatus = document.getElementById('long-message-status')
  const longMessageCount = document.getElementById('long-message-count')
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
  const MODEL_SCALE_MIN = 0.1
  const MODEL_SCALE_MAX = 2
  const MODEL_SCALE_STEP = 0.05
  const WHEEL_SCALE_DEBOUNCE_MS = 120
  const SETTINGS_BACKGROUND_FRAME_INTERVAL = 1000 / 4
  const SETTINGS_BACKGROUND_ACK_TIMEOUT = 1500
  const SETTINGS_BACKGROUND_WIDTH = 240
  const SETTINGS_BACKGROUND_HEIGHT = 360
  const PET_VIEWPORT_WIDTH = 400
  const PET_VIEWPORT_HEIGHT = 600
  const LONG_MESSAGE_READER_WIDTH = 380
  const TYPEWRITER_CHARACTER_INTERVAL_MS = 36
  const TYPEWRITER_COMPLETE_HOLD_MS = 2000
  const interactionCopy = {
    tap: ['碰到我啦～', '我在这里', '有什么事吗？'],
    greet: ['你好呀～', '今天也一起加油', '见到你真好'],
    head: ['好舒服～', '再摸一下嘛', '嘿嘿，谢谢你'],
    praise: ['被夸奖了 ✦', '谢谢你！', '今天也很开心'],
    snack: ['好吃！', '能量补充完毕', '还想再来一点～'],
    calm: ['让我靠一会儿', '安静陪着你', '呼…放松一下'],
    curious: ['在忙什么呀？', '需要我陪你吗？', '我在听～'],
    surprised: ['呀！', '吓我一跳', '发生什么了？'],
    shy: ['有、有点害羞…', '别一直看着我嘛', '脸要红啦'],
    excited: ['最喜欢你啦！', '好开心！', '今天超有精神 ✦'],
    sad: ['呜…', '有点难过', '要抱抱'],
    angry: ['哼！', '生气了！', '不想理你了'],
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
    reactionSequence: 0,
    reactionMotionTimer: null,
    expressionResetTimer: null,
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
    settingsBackgroundFrameSequence: 0,
    settingsBackgroundAwaitingAck: 0,
    settingsBackgroundAckTimer: null,
    settingsBackgroundCanvas: null,
    settingsBackgroundProbeCanvas: null,
    settingsBackgroundErrorReported: false,
    particles: [],
    lastFxFrame: 0,
  }

  let toastTimer = null
  let bubbleTimer = null
  let bubbleLeaseSequence = 0
  let activeBubbleLease = null
  let activeBubbleSource = ''
  let typewriterSequence = 0
  let typewriterTimer = null
  let activeTypewriter = null
  let pendingGreetingBubble = null
  let chatBusy = false
  let chatCollapsed = true
  let chatPositionAnimationFrame = null
  let chatMuted = true
  let speechSequence = 0
  let speechAssetSequence = 0
  const normalizedSpeechAssets = new WeakMap()
  let activeSpeechButton = null
  let activeSpeechAssetId = null
  let activeSpeechBubbleLease = null
  let activeBubbleSpeech = null
  let chatRequestSequence = 0
  let externalPriorityMessageId = ''
  let externalPriorityBubbleLease = null
  let externalPriorityTimer = null
  let wheelScaleTimer = null
  let wheelScaleDirection = 0
  let wheelScaleModelId = null
  let petWindowLayout = {
    expanded: false,
    detached: false,
    side: 'none',
    mode: 'collapsed',
    readerWidth: 0,
    gap: 0,
    stageOffsetX: 0,
    readerOffsetX: 0,
    outerWidth: PET_VIEWPORT_WIDTH,
    outerHeight: PET_VIEWPORT_HEIGHT,
    stageWidth: PET_VIEWPORT_WIDTH,
    stageHeight: PET_VIEWPORT_HEIGHT,
    revision: 0,
  }
  let longMessageState = {
    open: false,
    text: '',
    visibleText: '',
    label: '',
    source: '',
    lease: null,
    speech: null,
    typing: false,
  }
  let longMessageRequestSequence = 0
  let longMessageLayoutQueue = Promise.resolve()
  let longMessageMeasureFrame = null
  let longMessageCopyTimer = null
  let longMessageCopySequence = 0
  let lastLongMessageBoundsSignature = ''
  let lastChatPanelBoundsSignature = ''
  let lastViewportSize = { width: PET_VIEWPORT_WIDTH, height: PET_VIEWPORT_HEIGHT }

  function petViewportRect() {
    const rect = petViewport && petViewport.getBoundingClientRect()
    if (rect && rect.width > 0 && rect.height > 0) return rect
    return {
      left: Number(petWindowLayout.stageOffsetX) || 0,
      top: 0,
      right: (Number(petWindowLayout.stageOffsetX) || 0) + PET_VIEWPORT_WIDTH,
      bottom: PET_VIEWPORT_HEIGHT,
      width: PET_VIEWPORT_WIDTH,
      height: PET_VIEWPORT_HEIGHT,
    }
  }

  function petViewportSize() {
    const rect = petViewportRect()
    return {
      width: Math.round(rect.width) || PET_VIEWPORT_WIDTH,
      height: Math.round(rect.height) || PET_VIEWPORT_HEIGHT,
    }
  }

  function viewportPoint(clientX, clientY) {
    const rect = petViewportRect()
    return {
      clientX: Number(clientX) - rect.left,
      clientY: Number(clientY) - rect.top,
    }
  }

  function isInteractivePetUi(target) {
    const element = target instanceof Element ? target : null
    return Boolean(element && element.closest('#ai-chat-panel, #long-message-reader, pet-speech-bubble'))
  }

  function applyPetWindowLayout(layout) {
    if (!layout || typeof layout !== 'object') return false
    const next = {
      expanded: Boolean(layout.expanded),
      detached: Boolean(layout.detached),
      side: ['left', 'right', 'overlay'].includes(layout.side) ? layout.side : 'none',
      mode: ['left', 'right', 'overlay'].includes(layout.mode) ? layout.mode : 'collapsed',
      readerWidth: Number(layout.readerWidth) || 0,
      gap: Number(layout.gap) || 0,
      stageOffsetX: Number(layout.stageOffsetX) || 0,
      readerOffsetX: Number(layout.readerOffsetX) || 0,
      outerWidth: Number(layout.outerWidth) || PET_VIEWPORT_WIDTH,
      outerHeight: Number(layout.outerHeight) || PET_VIEWPORT_HEIGHT,
      stageWidth: Number(layout.stageWidth) || PET_VIEWPORT_WIDTH,
      stageHeight: Number(layout.stageHeight) || PET_VIEWPORT_HEIGHT,
      revision: Number(layout.revision) || 0,
    }
    // Window resize notifications and invoke replies travel on separate IPC
    // paths. Ignore a late event from an older open/close cycle so it cannot
    // move the fixed pet stage back to a stale side after a quick collapse.
    if (next.revision < petWindowLayout.revision) return false
    const layoutKeys = [
      'expanded', 'detached', 'side', 'mode', 'readerWidth', 'gap', 'stageOffsetX',
      'readerOffsetX', 'outerWidth', 'outerHeight', 'stageWidth', 'stageHeight', 'revision',
    ]
    if (layoutKeys.every(key => next[key] === petWindowLayout[key])) return false
    petWindowLayout = next
    document.body.style.setProperty('--pet-stage-offset-x', `${next.stageOffsetX}px`)
    document.body.style.setProperty('--long-message-reader-offset-x', `${next.readerOffsetX}px`)
    document.body.style.setProperty('--long-message-reader-width', `${next.readerWidth || LONG_MESSAGE_READER_WIDTH}px`)
    document.documentElement.dataset.longMessageLayout = next.mode
    if (longMessageReader) {
      longMessageReader.dataset.side = next.side
      longMessageReader.dataset.layoutRevision = String(next.revision)
    }
    if (interactionBubble.classList.contains('is-visible')) requestAnimationFrame(layoutInteractionBubble)
    if (statusToast.classList.contains('is-visible')) requestAnimationFrame(reportStatusToastBounds)
    if (longMessageState.open) scheduleLongMessageMeasurement()
    return true
  }

  // Read the host geometry synchronously during the parser-blocking startup
  // script, before Chromium can present its first frame. This initializes both
  // compact dynamic hosts and any platform that still uses a fixed stage gutter.
  if (typeof window.petAPI.previewLongMessageLayout === 'function') {
    try {
      applyPetWindowLayout(window.petAPI.previewLongMessageLayout({
        open: false,
        preferredWidth: LONG_MESSAGE_READER_WIDTH,
      }))
    } catch (error) {
      console.warn('Initial pet-window layout sync failed:', error.message)
    }
  }

  function reportStatusToastBounds() {
    if (!statusToast.classList.contains('is-visible')) {
      window.petAPI.reportStatusBounds(null)
      return
    }
    const rect = statusToast.getBoundingClientRect()
    const viewport = petViewportRect()
    window.petAPI.reportStatusBounds({
      x: rect.left - viewport.left,
      y: rect.top - viewport.top,
      width: rect.width,
      height: rect.height,
    })
  }

  function showStatus(message, type = 'info', duration = 0, placement = 'default') {
    statusToast.textContent = message
    statusToast.classList.toggle('is-error', type === 'error')
    statusToast.classList.toggle('is-scale-status', placement === 'scale')
    updateStatusToastPosition()
    statusToast.classList.add('is-visible')
    reportStatusToastBounds()
    if (toastTimer) clearTimeout(toastTimer)
    if (duration > 0) {
      toastTimer = setTimeout(() => {
        statusToast.classList.remove('is-visible')
        window.petAPI.reportStatusBounds(null)
        toastTimer = null
      }, duration)
    }
  }

  function hideStatus(delay = 0) {
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      statusToast.classList.remove('is-visible')
      window.petAPI.reportStatusBounds(null)
      toastTimer = null
    }, delay)
  }

  function reducedMotionEnabled() {
    if (!state.preferences) return false
    if (state.preferences.reducedMotion === 'on') return true
    if (state.preferences.reducedMotion === 'off') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  function resizeEffectsCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const { width, height } = petViewportSize()
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
    const { width, height } = petViewportSize()
    canvas.width = Math.max(1, width)
    canvas.height = Math.max(1, height)
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
      if (instance.loaded || instance.kind === 'video-pet') {
        try { instance.destroy() } catch (error) { console.warn('Model cleanup failed:', error.message) }
      } else if (instance.webGLRenderer) {
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

  function motionFileStem(fileName) {
    return String(fileName || '')
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      .replace(/\.motion3\.json$/i, '')
  }

  function expressionFileStem(fileName) {
    return String(fileName || '')
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      .replace(/\.exp3\.json$/i, '')
  }

  function decodeMotionBuffer(buffer) {
    const bytes = buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : ArrayBuffer.isView(buffer)
        ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        : null
    if (!bytes || !bytes.byteLength) throw new Error('动作数据为空')
    return JSON.parse(new TextDecoder('utf-8').decode(bytes))
  }

  function motionHasPlayableCurves(motion) {
    return (Array.isArray(motion && motion.Curves) ? motion.Curves : []).some(curve => (
      curve && ['Parameter', 'PartOpacity'].includes(curve.Target) &&
      Array.isArray(curve.Segments) && curve.Segments.length >= 2
    ))
  }

  function encodeJsonBuffer(value) {
    return new TextEncoder().encode(JSON.stringify(value)).buffer
  }

  function normalizedMotionBuffer(buffer) {
    const motion = decodeMotionBuffer(buffer)
    const curves = Array.isArray(motion.Curves) ? motion.Curves : []
    let totalSegmentCount = 0
    let totalPointCount = 0
    for (const curve of curves) {
      const segments = Array.isArray(curve && curve.Segments) ? curve.Segments : []
      if (segments.length < 2) continue
      totalPointCount++
      for (let position = 2; position < segments.length;) {
        const segmentType = Number(segments[position])
        const segmentWidth = segmentType === 1 ? 7 : 3
        if (![0, 1, 2, 3].includes(segmentType) || position + segmentWidth > segments.length) {
          throw new Error(`动作曲线 ${curve.Id || ''} 的分段数据无效`)
        }
        totalSegmentCount++
        totalPointCount += segmentType === 1 ? 3 : 1
        position += segmentWidth
      }
    }
    motion.Meta = {
      ...(motion.Meta || {}),
      CurveCount: curves.length,
      TotalSegmentCount: totalSegmentCount,
      TotalPointCount: totalPointCount,
    }
    return encodeJsonBuffer(motion)
  }

  function expressionBufferFromMotion(buffer) {
    const motion = decodeMotionBuffer(buffer)
    const parameters = (Array.isArray(motion.Curves) ? motion.Curves : [])
      .filter(curve => curve && curve.Target === 'Parameter' && typeof curve.Id === 'string')
      .map(curve => {
        const segments = Array.isArray(curve.Segments) ? curve.Segments : []
        return {
          Id: curve.Id,
          Value: Number(segments[segments.length - 1]),
          Blend: 'Overwrite',
        }
      })
      .filter(parameter => Number.isFinite(parameter.Value))
    if (!parameters.length) throw new Error('动作中没有可转换的表情参数')
    const expression = {
      Type: 'Live2D Expression',
      FadeInTime: 0.18,
      FadeOutTime: 0.35,
      Parameters: parameters,
    }
    return encodeJsonBuffer(expression)
  }

  function expressionBufferFromParameters(definition) {
    const parameters = definition && Array.isArray(definition.parameters)
      ? definition.parameters
          .filter(parameter => parameter && typeof parameter.id === 'string' && Number.isFinite(parameter.value))
          .map(parameter => ({
            Id: parameter.id,
            Value: parameter.value,
            Blend: parameter.blend || 'Overwrite',
          }))
      : []
    if (!parameters.length) throw new Error('表情映射中没有有效参数')
    return encodeJsonBuffer({
      Type: 'Live2D Expression',
      FadeInTime: Number(definition.fadeInTime) || 0.22,
      FadeOutTime: Number(definition.fadeOutTime) || 0.35,
      Parameters: parameters,
    })
  }

  function prepareModelReactionBuffers(model, buffers, modelId) {
    const profile = modelReactionProfiles[modelId]
    if (!profile) return false

    const motionClips = new Map()
    for (const group of (buffers.motionGroups || [])) {
      // 建立文件 stem 索引，所有内置模型动作都从原始 buffer 按需播放。
      // live2d-renderer 0.6.x 的批量预加载缓存键会串组，而且部分第三方动作
      // 的事件数据会在预加载阶段触发解析异常；不把这些分组交给预加载器。
      const motionBuffers = group.motionData && Array.isArray(group.motionData.motionBuffers)
        ? group.motionData.motionBuffers
        : []
      for (let index = 0; index < motionBuffers.length; index++) {
        const fileName = model.settings.getMotionFileName(group.group, index)
        const stem = motionFileStem(fileName)
        if (!stem) continue
        let motion = null
        try {
          motion = decodeMotionBuffer(motionBuffers[index])
        } catch (error) {
          console.warn(`Motion metadata ${stem} failed:`, error.message)
          continue
        }
        if (!motionHasPlayableCurves(motion)) {
          console.warn(`Motion ${stem} skipped: no playable parameter curves`)
          continue
        }
        motionClips.set(stem, {
          buffer: motionBuffers[index],
          duration: Number(motion.Meta && motion.Meta.Duration) || 0,
          group: group.group,
          index,
        })
      }
    }

    model.petMotionClips = motionClips
    model.petExpressionIds = new Map()
    const actionSources = new Set()
    for (const candidates of Object.values(profile.actions || {})) {
      for (const candidate of candidates) {
        if (candidate && candidate.clip) actionSources.add(candidate.clip)
        if (candidate && candidate.followUp && candidate.followUp.clip) {
          actionSources.add(candidate.followUp.clip)
        }
      }
    }
    for (const source of actionSources) {
      if (!motionClips.has(source)) console.warn(`Reaction profile ${modelId} action source missing: ${source}`)
    }
    const expressionSources = new Set([
      profile.neutralExpression,
      ...Object.values(profile.expressions || {}),
    ].filter(Boolean))
    const nativeExpressions = new Map(
      (model.expressionIds || []).map(expressionId => [expressionFileStem(expressionId), expressionId])
    )
    let nativeExpressionCount = 0
    let generatedExpressionCount = 0
    for (const source of expressionSources) {
      const generatedDefinition = profile.generatedExpressions && profile.generatedExpressions[source]
      if (generatedDefinition) {
        try {
          const expressionId = `pet:${modelId}:expression:${source}`
          buffers.expressionBuffers.push(expressionBufferFromParameters(generatedDefinition))
          model.expressionIds.push(expressionId)
          model.petExpressionIds.set(source, expressionId)
          generatedExpressionCount++
        } catch (error) {
          console.warn(`Reaction profile ${modelId} generated expression ${source} failed:`, error.message)
        }
        continue
      }
      const nativeExpressionId = nativeExpressions.get(source)
      if (nativeExpressionId) {
        model.petExpressionIds.set(source, nativeExpressionId)
        nativeExpressionCount++
        continue
      }
      const clip = motionClips.get(source)
      if (!clip) {
        console.warn(`Reaction profile ${modelId} expression source missing: ${source}`)
        continue
      }
      try {
        const expressionId = `pet:${modelId}:${source}`
        buffers.expressionBuffers.push(expressionBufferFromMotion(clip.buffer))
        model.expressionIds.push(expressionId)
        model.petExpressionIds.set(source, expressionId)
        generatedExpressionCount++
      } catch (error) {
        console.warn(`Reaction profile ${modelId} expression ${source} failed:`, error.message)
      }
    }

    // petMotionClips 已保留所有审核通过的资源。清空批量预加载输入，避免库的
    // 缓存键冲突和事件解析错误；设置页与互动入口仍可按 stem 精确播放。
    buffers.motionGroups = []
    model.motionIds = [...motionClips.keys()].map(stem => `pet:${modelId}:${stem}`)
    console.info(
      `Reaction profile ${modelId}: ${motionClips.size} motions, ` +
      `${model.petExpressionIds.size} expressions ` +
      `(${nativeExpressionCount} native, ${generatedExpressionCount} generated)`
    )
    return true
  }

  function optimizeMotionGroups(motionGroups) {
    // 部分第三方模型把大量参数片段放在空名称组中；Cubism 会把它们
    // 当作完整动作解析并持续报错。保留规范动作，其他互动用轻量姿态回应。
    return motionGroups.filter(group => typeof group.group === 'string' && group.group.trim().length > 0)
  }

  function createModelInstance(canvas, modelMeta = null) {
    if (modelMeta && modelMeta.format === 'video-pet') return new VideoPetModel(canvas)

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

    // Live2D 在 draw() 之后会 loadParameters() 恢复本帧基线，因此从帧末
    // 读取核心参数无法判断表情是否真正生效。仅在启动表情后的短窗口内，
    // 于 ExpressionController 写入参数后记录变化，供设置页预览自检使用。
    const originalExpressionUpdate = model.expressionController.update.bind(model.expressionController)
    model.expressionController.update = deltaTime => {
      const probe = model.petExpressionProbe
      const shouldProbe = probe && performance.now() <= probe.expiresAt && model.model
      const before = shouldProbe ? modelParameterSnapshot(model) : null
      const result = originalExpressionUpdate(deltaTime)
      if (before) {
        const change = changedModelParameters(before, modelParameterSnapshot(model))
        probe.changed = Math.max(probe.changed, change.changed)
        probe.totalDelta = Math.max(probe.totalDelta, change.totalDelta)
        probe.largestDelta = Math.max(probe.largestDelta, change.largestDelta)
      }
      return result
    }
    const originalMotionUpdate = model.motionController.update.bind(model.motionController)
    model.motionController.update = deltaTime => {
      const probe = model.petMotionProbe
      const shouldProbe = probe && performance.now() <= probe.expiresAt && model.model
      const before = shouldProbe ? modelParameterSnapshot(model) : null
      const result = originalMotionUpdate(deltaTime)
      if (before) {
        const change = changedModelParameters(before, modelParameterSnapshot(model))
        probe.changed = Math.max(probe.changed, change.changed)
        probe.totalDelta = Math.max(probe.totalDelta, change.totalDelta)
        probe.largestDelta = Math.max(probe.largestDelta, change.largestDelta)
      }
      return result
    }

    const originalLoadBuffers = model.loadBuffers.bind(model)
    model.loadBuffers = async link => {
      const buffers = await originalLoadBuffers(link)
      const modelId = modelMeta && modelMeta.id
      if (!prepareModelReactionBuffers(model, buffers, modelId)) {
        buffers.motionGroups = optimizeMotionGroups(buffers.motionGroups)
        model.motionIds = buffers.motionGroups.flatMap(group =>
          group.motionData.motionBuffers.map((_, index) => `${group.group}_${index}`)
        )
      }
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

  function installMappedCursorFollow(model, modelId) {
    const followProfile = modelReactionProfiles[modelId] && modelReactionProfiles[modelId].cursorFollow
    const configured = followProfile && Array.isArray(followProfile.parameters)
      ? followProfile.parameters
      : []
    const parameterIds = model && model.parameters && Array.isArray(model.parameters.ids)
      ? model.parameters.ids
      : []
    if (!configured.length || !parameterIds.length || !model.motionController || typeof model.setDragging !== 'function') return false

    const parameters = configured.map(parameter => ({
      ...parameter,
      index: parameterIds.indexOf(parameter.id),
    })).filter(parameter => parameter.index >= 0 && Number.isFinite(parameter.scale))
    if (!parameters.length) {
      console.warn(`Cursor follow profile ${modelId} has no matching model parameters`)
      return false
    }

    const missing = configured.filter(parameter => !parameterIds.includes(parameter.id))
    if (missing.length) {
      console.warn(`Cursor follow profile ${modelId} parameters missing: ${missing.map(parameter => parameter.id).join(', ')}`)
    }

    const clampFollowAxis = value => Math.max(-1, Math.min(1, Number(value) || 0))
    const deadZone = Math.max(0, Math.min(0.25, Number(followProfile.deadZone) || 0))
    const softenFollowAxis = value => {
      const clamped = clampFollowAxis(value)
      const magnitude = Math.abs(clamped)
      if (magnitude <= deadZone) return 0
      const normalized = (magnitude - deadZone) / (1 - deadZone)
      // smoothstep 让中心附近的细小鼠标抖动更安静，到边缘时又能完整转向。
      const softened = normalized * normalized * (3 - 2 * normalized)
      return Math.sign(clamped) * softened
    }
    const target = { x: 0, y: 0 }
    const originalSetDragging = model.setDragging.bind(model)
    model.setDragging = (x, y) => {
      target.x = clampFollowAxis(x)
      target.y = clampFollowAxis(y)
      return originalSetDragging(target.x, target.y)
    }

    const originalMotionUpdate = model.motionController.update.bind(model.motionController)
    model.motionController.update = deltaTime => {
      const motionUpdated = originalMotionUpdate(deltaTime)
      const elapsed = Math.max(1 / 240, Math.min(0.05, Number(deltaTime) || 1 / 60))
      const drag = {
        x: softenFollowAxis(model.dragX),
        y: softenFollowAxis(model.dragY),
      }
      const desired = {
        x: softenFollowAxis(target.x),
        y: softenFollowAxis(target.y),
      }

      // 动作管理器会先恢复并写入当前 motion 参数。此时再叠加专用视线值，
      // 既不会被待机/互动动作覆盖，又能继续作为后续头发和衣物物理的输入。
      for (const parameter of parameters) {
        const input = parameter.input === 'target' ? desired : drag
        const sourceValue = parameter.source === 'xy'
          ? input.x * input.y
          : parameter.source === 'y' ? input.y : input.x
        const targetValue = sourceValue * parameter.scale
        const response = Math.max(0.1, Number(parameter.response) || 7)
        const blend = 1 - Math.exp(-response * elapsed)
        parameter.value = (Number(parameter.value) || 0) + (targetValue - (Number(parameter.value) || 0)) * blend
        model.model.addParameterValueByIndex(parameter.index, parameter.value)
      }
      return motionUpdated
    }

    // 通用移动只认识 ParamAngleX 一类新版参数；该模型完全使用旧式参数名，
    // 关闭无效的通用写入。眼睛使用快速目标缓动，头部和身体继续复用
    // dragManager 的惯性，并按各自 response 形成不同层次的跟随速度。
    model.enableMovement = false
    model.petCursorFollowParameters = parameters.map(parameter => parameter.id)
    console.info(`Cursor follow profile ${modelId}: ${parameters.length} parameters`)
    return true
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
      surprised: groups.filter(name => /surpris|petsurpris|惊讶/i.test(name)),
      sleepy: groups.filter(name => /sleep|petsleepy/i.test(name)),
    }
  }

  // 未配置模型或映射项失效时，按常见中英文表情文件名识别 ZIP 原生表情。
  // 这是低于 config/model-reactions.js 显式映射的第二级兜底；规则宁可保守，
  // 避免把含义不明的表情随机叠加到角色上。
  const nativeExpressionPatterns = {
    idle: [/默认|neutral|normal|\bnor\b/i],
    greet: [/微笑|smile/i],
    head: [/害羞|羞涩|shy|touched/i],
    shy: [/害羞|羞涩|脸红|shy|blush|touched/i],
    praise: [/大笑|开心|笑眼|happy|delight/i],
    snack: [/微笑|笑眼|满足|smile|snack/i],
    calm: [/困倦|平静|calm|sleep/i],
    curious: [/好奇|curious/i],
    surprised: [/惊讶|惊喜|surpris/i],
    excited: [/惊喜|兴奋|大笑|excited|happy/i],
    sad: [/难过|焦虑|害怕|sad|sorrow|worry/i],
    angry: [/生气|angry/i],
    drag: [/惊讶|好奇|surpris|curious/i],
  }

  function findNativeExpressionId(model, kind) {
    const patterns = nativeExpressionPatterns[kind] || []
    return (model && Array.isArray(model.expressionIds) ? model.expressionIds : [])
      .find(expressionId => {
        const stem = expressionFileStem(expressionId)
        return patterns.some(pattern => pattern.test(stem))
      }) || ''
  }

  function readablePreviewLabel(value, fallback) {
    const stem = String(value || '')
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      .replace(/\.(motion3|exp3)\.json$/i, '')
    if (previewActionLabels[stem]) return previewActionLabels[stem]
    if (previewExpressionLabels[stem]) return previewExpressionLabels[stem]
    const numbered = stem.match(/(?:mtn|motion|exp)[_-]?(\d+)/i)
    if (numbered) return `${fallback} ${Number(numbered[1])}`
    return stem
      .replace(/^(mtn|motion|face|exp)[_-]?/i, '')
      .replace(/[_-]+/g, ' ')
      .trim() || fallback
  }

  function modelPreviewCatalog(model, modelId) {
    if (model && model.kind === 'video-pet' && typeof model.previewCatalog === 'function') {
      return { modelId, ...model.previewCatalog() }
    }
    const actions = []
    const expressions = []
    const profile = modelReactionProfiles[modelId]
    const hasCuratedPreview = profile && Array.isArray(profile.previewClips)
    const hasCuratedExpressionPreview = profile && Array.isArray(profile.previewExpressions)
    const preferredClips = hasCuratedPreview
      ? profile.previewClips
      : ['mtn_idle', 'mtn_shake_huishou', 'mtn_fushen', 'mtn_shakeh', 'head_diantou', 'head_yaotou', 'mtn_shake', 'mtn_qishen']
    if (model.petMotionClips && model.petMotionClips.size) {
      const clipNames = [...model.petMotionClips.keys()]
      // 有显式清单的内置模型只展示审核过的完整动作。自动补入 mtn_/head_
      // 会把第三方包里的瞬时姿态、恢复片段甚至空动作暴露成可点击项目。
      const ordered = hasCuratedPreview
        ? preferredClips.filter(name => clipNames.includes(name))
        : [
            ...preferredClips.filter(name => clipNames.includes(name)),
            ...clipNames.filter(name => !preferredClips.includes(name) && /^(mtn_|head_)/i.test(name)),
          ]
      for (const clip of ordered.slice(0, 24)) {
        actions.push({
          id: `clip:${clip}`,
          label: readablePreviewLabel(clip, '动作'),
          type: 'clip',
          clip,
        })
      }
    }
    if (!actions.length) {
      for (const group of (model.buffers && model.buffers.motionGroups) || []) {
        const count = group.motionData && Array.isArray(group.motionData.motionBuffers)
          ? group.motionData.motionBuffers.length
          : 0
        for (let index = 0; index < count && actions.length < 24; index++) {
          let source = ''
          try { source = model.settings.getMotionFileName(group.group, index) } catch { source = '' }
          actions.push({
            id: `group:${group.group}:${index}`,
            label: readablePreviewLabel(source || `${group.group}_${index + 1}`, '动作'),
            type: 'group',
            group: group.group,
            index,
          })
        }
      }
    }
    const includedExpressionIds = new Set()
    if (model.petExpressionIds && model.petExpressionIds.size) {
      const preferred = ['face_nor', 'face_weixiao', 'face_daxiao', 'face_xiaoqi', 'face_gandong', 'face_xingfen', 'face_jusang', 'face_haoqi', 'face_xiao']
      const sources = [...model.petExpressionIds.keys()]
      const ordered = hasCuratedExpressionPreview
        ? profile.previewExpressions.filter(source => sources.includes(source))
        : [...preferred.filter(source => sources.includes(source)), ...sources.filter(source => !preferred.includes(source))]
      for (const source of ordered.slice(0, 24)) {
        const expressionId = model.petExpressionIds.get(source)
        expressions.push({
          id: `profile:${source}`,
          label: readablePreviewLabel(source, '表情'),
          type: 'profile',
          source,
          expressionId,
        })
        includedExpressionIds.add(expressionId)
      }
    }
    // 未配置精选列表时，映射表情排在前面并补齐 ZIP 原生资源；配置了精选
    // 列表的模型则只展示审核过、差异明确的入口，避免默认态和近似态重复。
    if (!hasCuratedExpressionPreview) {
      for (const expressionId of (model.expressionIds || [])) {
        if (expressions.length >= 24) break
        if (includedExpressionIds.has(expressionId)) continue
        expressions.push({
          id: `native:${expressionId}`,
          label: readablePreviewLabel(expressionId, '表情'),
          type: 'native',
          expressionId,
        })
      }
    }
    if (!actions.length && profile) {
      actions.push(
        { id: 'interaction:idle', label: '待机', type: 'interaction', interaction: 'idle' },
        { id: 'interaction:greet', label: '挥手', type: 'interaction', interaction: 'greet' },
        { id: 'interaction:sleepy', label: '坐下', type: 'interaction', interaction: 'sleepy' },
        { id: 'interaction:happy', label: '开心跳跃', type: 'interaction', interaction: 'happy' }
      )
    }
    return { modelId, actions, expressions }
  }

  function finishModelAssetPreview(request, ok, error = '', preview = null) {
    if (request && request.requestId && window.petAPI.reportModelPreviewResult) {
      window.petAPI.reportModelPreviewResult({ requestId: request.requestId, ok, error, preview })
    }
    return ok
  }

  function modelParameterSnapshot(model) {
    const coreModel = model && model.model
    if (!coreModel || typeof coreModel.getParameterCount !== 'function' || typeof coreModel.getParameterValueByIndex !== 'function') return []
    const values = []
    for (let index = 0; index < coreModel.getParameterCount(); index++) {
      values.push(Number(coreModel.getParameterValueByIndex(index)) || 0)
    }
    return values
  }

  function changedModelParameters(before, after) {
    const count = Math.min(before.length, after.length)
    let changed = 0
    let totalDelta = 0
    let largestDelta = 0
    for (let index = 0; index < count; index++) {
      const delta = Math.abs(after[index] - before[index])
      if (delta > .0001) changed++
      totalDelta += delta
      largestDelta = Math.max(largestDelta, delta)
    }
    return {
      changed,
      totalDelta: Number(totalDelta.toFixed(5)),
      largestDelta: Number(largestDelta.toFixed(5)),
    }
  }

  function waitForPreviewFrames(frameCount = 8, minimumDuration = 180) {
    return new Promise(resolve => {
      let remaining = frameCount
      let finished = false
      const startedAt = performance.now()
      const fallback = setTimeout(() => {
        if (finished) return
        finished = true
        resolve()
      }, Math.max(620, minimumDuration + 240))
      const next = () => {
        if (finished) return
        remaining--
        if (remaining <= 0 && performance.now() - startedAt >= minimumDuration) {
          finished = true
          clearTimeout(fallback)
          resolve()
          return
        }
        requestAnimationFrame(next)
      }
      requestAnimationFrame(next)
    })
  }

  function restoreModelPreview(kind, model, baseline, sequence, request) {
    if (sequence !== state.reactionSequence || model !== state.model || !model.loaded) return
    try {
      if (model.kind === 'video-pet') {
        model.playReaction('idle').catch(error => console.warn('Restore video preview failed:', error.message))
        state.activeUntil = performance.now() + 650
        ensureScheduler()
        if (window.petAPI.reportModelPreviewRestored) {
          window.petAPI.reportModelPreviewRestored({
            modelId: request.modelId,
            kind,
            assetId: request.asset && request.asset.id,
          })
        }
        return
      }
      if (kind === 'expression' && model.expressionManager) model.expressionManager.stopAllMotions()
      if (kind === 'action' && model.motionManager) model.motionManager.stopAllMotions()
      const profile = currentReactionProfile()
      const neutralExpression = profile && model.petExpressionIds
        ? model.petExpressionIds.get(profile.neutralExpression)
        : Array.isArray(model.expressionIds) ? model.expressionIds[0] : ''
      if (kind === 'expression' && neutralExpression) {
        startNativeExpressionPreview(neutralExpression)
      } else if (baseline.length && model.model) {
        const count = Math.min(baseline.length, model.model.getParameterCount())
        for (let index = 0; index < count; index++) {
          model.model.setParameterValueByIndex(index, baseline[index])
        }
        model.model.saveParameters()
      }
      state.activeUntil = performance.now() + 650
      ensureScheduler()
      if (window.petAPI.reportModelPreviewRestored) {
        window.petAPI.reportModelPreviewRestored({
          modelId: request.modelId,
          kind,
          assetId: request.asset && request.asset.id,
        })
      }
    } catch (error) {
      console.warn(`Restore ${kind} preview failed:`, error.message)
    }
  }

  async function previewModelAsset(request) {
    const asset = request && request.asset
    if (!asset || !state.model || !state.model.loaded || !state.modelMeta || request.modelId !== state.modelMeta.id) {
      return finishModelAssetPreview(request, false, '角色还没有准备好')
    }
    const previewModel = state.model
    const before = modelParameterSnapshot(previewModel)
    clearReactionTimers()
    const previewSequence = state.reactionSequence
    const restoreAfterMs = request.kind === 'expression' ? 3600 : 4200
    let playback = null
    if (request.kind === 'expression') {
      const expressionId = asset.type === 'profile' && state.model.petExpressionIds
        ? state.model.petExpressionIds.get(asset.source)
        : asset.expressionId
      if (!expressionId) return finishModelAssetPreview(request, false, '表情资源不存在')
      playback = startNativeExpressionPreview(expressionId)
      if (!playback) {
        return finishModelAssetPreview(request, false, '表情资源无法解析')
      }
      state.activeUntil = performance.now() + 4200
    } else {
      if (asset.type === 'clip') {
        playback = startProfileMotionClip(asset.clip, motionPriority.force)
      } else if (asset.type === 'video' && previewModel.kind === 'video-pet') {
        playback = await previewModel.playAnimation(asset.video, false)
      } else if (asset.type === 'interaction') {
        playback = playMotion(asset.interaction, motionPriority.force)
      } else if (asset.group) {
        playback = startNativeMotion(asset.group, Number(asset.index) || 0, motionPriority.force)
      }
      if (!playback) return finishModelAssetPreview(request, false, '动作资源无法解析')
      markInteraction(3200)
    }
    const timerKey = request.kind === 'expression' ? 'expressionResetTimer' : 'reactionMotionTimer'
    state[timerKey] = setTimeout(() => {
      state[timerKey] = null
      restoreModelPreview(request.kind, previewModel, before, previewSequence, request)
    }, restoreAfterMs)
    ensureScheduler()
    try {
      await waitForPreviewFrames()
      if (previewModel !== state.model || !previewModel.loaded) {
        return finishModelAssetPreview(request, false, '预览期间角色已切换')
      }
      if (previewModel.kind === 'video-pet') {
        const frame = await centeredCoverDataURL(previewModel.canvas, true)
        return finishModelAssetPreview(request, true, '', {
          modelId: request.modelId,
          kind: request.kind,
          assetId: asset.id,
          active: true,
          restoreAfterMs,
          changedParameters: 0,
          parameterDelta: 0,
          largestParameterDelta: 0,
          frame: typeof frame === 'string' && frame.length <= 700000 ? frame : '',
        })
      }
      const finalParameterChange = changedModelParameters(before, modelParameterSnapshot(previewModel))
      const expressionProbe = request.kind === 'expression' && playback && previewModel.petExpressionProbe &&
        previewModel.petExpressionProbe.source === playback.source
        ? previewModel.petExpressionProbe
        : null
      const motionProbe = request.kind === 'action' && playback && previewModel.petMotionProbe &&
        previewModel.petMotionProbe.source === playback.source
        ? previewModel.petMotionProbe
        : null
      const parameterChange = expressionProbe || motionProbe
        ? {
            changed: (expressionProbe || motionProbe).changed,
            totalDelta: (expressionProbe || motionProbe).totalDelta,
            largestDelta: (expressionProbe || motionProbe).largestDelta,
          }
        : finalParameterChange
      const manager = request.kind === 'expression' ? previewModel.expressionManager : previewModel.motionManager
      const handle = playback && typeof playback === 'object' ? playback.handle : null
      const active = handle !== null && handle !== undefined && handle !== -1 && manager && typeof manager.isFinishedByHandle === 'function'
        ? !manager.isFinishedByHandle(handle)
        : parameterChange.changed > 0
      if (!active && parameterChange.changed === 0) {
        return finishModelAssetPreview(request, false, `${request.kind === 'expression' ? '表情' : '动作'}已加载，但没有产生播放变化`)
      }
      const frame = await centeredCoverDataURL(previewModel.canvas)
      return finishModelAssetPreview(request, true, '', {
        modelId: request.modelId,
        kind: request.kind,
        assetId: asset.id,
        active,
        restoreAfterMs,
        changedParameters: parameterChange.changed,
        parameterDelta: parameterChange.totalDelta,
        largestParameterDelta: parameterChange.largestDelta,
        expressionParameterCount: Number(playback && playback.parameterCount) || 0,
        matchedExpressionParameterCount: Number(playback && playback.matchedParameterCount) || 0,
        frame: typeof frame === 'string' && frame.length <= 700000 ? frame : '',
      })
    } catch (error) {
      console.warn(`Preview verification ${asset.id} failed:`, error.message)
      return finishModelAssetPreview(request, false, '预览画面验证失败')
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
    if (model.kind === 'video-pet') {
      model.scale = nextScale
      model.update()
      return
    }
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
    // lastHitBounds is always pet-viewport local. The viewport may be shifted
    // inside a widened BrowserWindow when the long-message reader opens, so
    // never mix it with the canvas' outer-window left/top coordinates.
    const anchorX = canvasRect.width - anchor.x
    const anchorY = anchor.y - canvasRect.height / 2
    const worldX = (anchorX - model.x) / currentScale
    const worldY = (anchorY - model.y) / currentScale
    model.scale = nextScale
    model.x = anchorX - worldX * nextScale
    model.y = anchorY - worldY * nextScale
    model.update()
  }

  function centerVisibleModel(model) {
    if (model && model.kind === 'video-pet') return true
    const canvas = model && model.canvas
    if (!canvas) return false
    const canvasRect = canvas.getBoundingClientRect()
    if (!canvasRect.width || !canvasRect.height) return false

    // live2d-renderer 的 centerModel() 主要对齐模型坐标系，含尾巴、长发或
    // 非对称画布留白的角色仍可能偏离窗口中央。用实际 alpha 包围盒做两次
    // 小幅校正，让用户首次看到的是角色可见轮廓的中心，而不是资源原点。
    for (let pass = 0; pass < 2; pass++) {
      model.update()
      const bounds = visibleCanvasBounds(canvas)
      if (!bounds) return false
      const offsetX = canvasRect.width / 2 - (bounds.x + bounds.width / 2)
      const offsetY = canvasRect.height / 2 - (bounds.y + bounds.height / 2)
      if (Math.abs(offsetX) < 0.75 && Math.abs(offsetY) < 0.75) return true
      model.x -= offsetX * (canvas.width / canvasRect.width)
      model.y += offsetY * (canvas.height / canvasRect.height)
    }
    model.update()
    return true
  }

  function initializeModelAtScale(model, scale) {
    if (model.kind === 'video-pet') {
      model.scale = clampModelScale(Number(scale) || 1)
      model.centerModel()
      model.update()
      return
    }
    // 初次加载先使用一次库的坐标系居中，再以可见轮廓精确居中；用户保存的
    // 尺寸仍围绕角色中心应用，因此重启或切回模型时不会产生位置跳变。
    model.scale = 1
    model.centerModel()
    model.update()
    const targetScale = clampModelScale(Number(scale) || 1)
    if (Math.abs(targetScale - 1) >= 0.001) {
      renderModelAtScale(model, targetScale, visibleCanvasBounds(model.canvas))
    }
    centerVisibleModel(model)
  }

  function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)]
  }

  function settingsBackgroundFrameHasVisiblePixels(canvas) {
    if (!state.settingsBackgroundProbeCanvas) {
      state.settingsBackgroundProbeCanvas = document.createElement('canvas')
      state.settingsBackgroundProbeCanvas.width = 24
      state.settingsBackgroundProbeCanvas.height = 36
    }
    const probe = state.settingsBackgroundProbeCanvas
    const context = probe.getContext('2d', { alpha: true, willReadFrequently: true })
    context.clearRect(0, 0, probe.width, probe.height)
    context.drawImage(canvas, 0, 0, probe.width, probe.height)
    const pixels = context.getImageData(0, 0, probe.width, probe.height).data
    let visiblePixels = 0
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 8 && ++visiblePixels >= 3) return true
    }
    return false
  }

  function releaseSettingsBackgroundFrame(sequence = 0) {
    if (sequence && state.settingsBackgroundAwaitingAck !== sequence) return
    if (state.settingsBackgroundAckTimer) clearTimeout(state.settingsBackgroundAckTimer)
    state.settingsBackgroundAckTimer = null
    state.settingsBackgroundAwaitingAck = 0
  }

  function waitForSettingsBackgroundFrameAck(sequence) {
    releaseSettingsBackgroundFrame()
    state.settingsBackgroundAwaitingAck = sequence
    state.settingsBackgroundAckTimer = setTimeout(() => {
      if (state.settingsBackgroundAwaitingAck !== sequence) return
      state.settingsBackgroundAckTimer = null
      state.settingsBackgroundAwaitingAck = 0
    }, SETTINGS_BACKGROUND_ACK_TIMEOUT)
  }

  async function captureSettingsPetBackground(timestamp) {
    if (
      !state.settingsBackgroundCaptureActive || state.settingsBackgroundCapturePending ||
      state.settingsBackgroundAwaitingAck ||
      !state.liveCanvas || !state.model || !state.model.loaded || state.loading || state.dragging ||
      timestamp - state.settingsBackgroundLastFrameAt < SETTINGS_BACKGROUND_FRAME_INTERVAL
    ) return

    const sourceCanvas = state.liveCanvas
    const sourceModel = state.model
    const sourceMeta = state.modelMeta
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
      // Windows 在移动透明 BrowserWindow 时可能短暂清空 WebGL 合成层。
      // 全透明帧不是错误数据，但绝不能覆盖设置页上一张有效角色画面。
      if (!settingsBackgroundFrameHasVisiblePixels(captureCanvas)) {
        if (!state.wakeCheckTimer) scheduleWakeHealthCheck(80)
        return
      }
      const blob = await new Promise(resolve => captureCanvas.toBlob(resolve, 'image/webp', 0.76))
      if (!blob) throw new Error('浏览器未生成背景帧')
      const frame = await blob.arrayBuffer()
      if (
        state.settingsBackgroundCaptureActive &&
        sourceCanvas === state.liveCanvas && sourceModel === state.model &&
        sourceMeta && sourceMeta === state.modelMeta
      ) {
        const sequence = ++state.settingsBackgroundFrameSequence
        waitForSettingsBackgroundFrameAck(sequence)
        window.petAPI.sendSettingsPetBackgroundFrame({
          sequence,
          modelId: sourceMeta.id,
          format: sourceMeta.format,
          frame,
        })
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

  function currentReactionProfile() {
    const modelId = state.modelMeta && state.modelMeta.id
    return modelId ? modelReactionProfiles[modelId] || null : null
  }

  function clearReactionTimers() {
    state.reactionSequence++
    if (state.reactionMotionTimer) clearTimeout(state.reactionMotionTimer)
    if (state.expressionResetTimer) clearTimeout(state.expressionResetTimer)
    state.reactionMotionTimer = null
    state.expressionResetTimer = null
  }

  function startNativeMotion(groupName, index, priority = motionPriority.normal) {
    const model = state.model
    const group = model && model.buffers && Array.isArray(model.buffers.motionGroups)
      ? model.buffers.motionGroups.find(item => item.group === groupName)
      : null
    const motionBuffers = group && group.motionData && group.motionData.motionBuffers
    const motionIndex = Number.isInteger(Number(index)) ? Number(index) : 0
    const sourceBuffer = Array.isArray(motionBuffers) ? motionBuffers[motionIndex] : null
    if (!model || !sourceBuffer || !model.motionManager) return false
    try {
      // live2d-renderer 0.6.x 预加载多动作分组时会复用错误的缓存键。
      // 预览时直接从已加载的分组 buffer 创建动作，确保点击的就是该索引。
      const motionBuffer = normalizedMotionBuffer(sourceBuffer)
      const motionData = decodeMotionBuffer(motionBuffer)
      if (!motionHasPlayableCurves(motionData)) return false
      const parameterIds = (motionData.Curves || [])
        .filter(curve => curve && curve.Target === 'Parameter' && curve.Id)
        .map(curve => curve.Id)
      const modelParameterIds = model.parameters && Array.isArray(model.parameters.ids) ? model.parameters.ids : []
      const matchedParameterCount = parameterIds.filter(id => modelParameterIds.includes(id)).length
      if (parameterIds.length && !matchedParameterCount) return false
      const motionMeta = motionData.Meta || {}
      const motion = model.loadMotion(
        motionBuffer,
        motionBuffer.byteLength,
        null,
        null,
        null,
        model.settings,
        groupName,
        motionIndex
      )
      if (!motion) return false
      if (typeof motion.setLoop === 'function') motion.setLoop(false)
      if (typeof motion.setLoopFadeIn === 'function') motion.setLoopFadeIn(false)
      motion.setEffectIds(model.eyeBlinkIds, model.lipSyncIds)
      model.motionManager.stopAllMotions()
      model.motionManager.setReservePriority(priority)
      const handle = model.motionManager.startMotionPriority(motion, true, priority)
      if (handle === -1 || handle === null || handle === undefined) return false
      model.petMotionProbe = {
        source: `${groupName}:${motionIndex}`,
        expiresAt: performance.now() + 750,
        changed: 0,
        totalDelta: 0,
        largestDelta: 0,
      }
      const duration = Number(motionMeta.Duration)
      state.activeUntil = performance.now() + (Number.isFinite(duration)
        ? Math.max(2600, duration * 1000 + 500)
        : 3200)
      return {
        handle,
        kind: 'motion',
        source: `${groupName}:${motionIndex}`,
        parameterCount: parameterIds.length,
        matchedParameterCount,
      }
    } catch (error) {
      console.warn(`Motion ${groupName}:${motionIndex} failed:`, error.message)
      return false
    }
  }

  function startNativeExpressionPreview(expressionId) {
    const model = state.model
    if (!model || !model.expressionManager) return false
    try {
      const index = Array.isArray(model.expressionIds) ? model.expressionIds.indexOf(expressionId) : -1
      const sourceBuffer = index >= 0 && model.buffers && Array.isArray(model.buffers.expressionBuffers)
        ? model.buffers.expressionBuffers[index]
        : null
      if (sourceBuffer) {
        const expressionData = decodeMotionBuffer(sourceBuffer)
        const parameterIds = (Array.isArray(expressionData.Parameters) ? expressionData.Parameters : [])
          .map(parameter => parameter && parameter.Id)
          .filter(Boolean)
        const modelParameterIds = model.parameters && Array.isArray(model.parameters.ids)
          ? model.parameters.ids
          : []
        const matchedParameterCount = parameterIds.filter(id => modelParameterIds.includes(id)).length
        if (!matchedParameterCount) {
          console.warn(`Expression ${expressionId} has no parameters used by this model`)
          return false
        }
        const expression = model.loadExpression(sourceBuffer, sourceBuffer.byteLength, expressionId)
        if (!expression) return false
        model.expressionManager.stopAllMotions()
        const handle = model.expressionManager.startMotion(expression, true)
        if (handle !== -1 && handle !== null && handle !== undefined) {
          model.petExpressionProbe = {
            source: expressionId,
            expiresAt: performance.now() + 750,
            changed: 0,
            totalDelta: 0,
            largestDelta: 0,
          }
          return {
              handle,
              kind: 'expression',
              source: expressionId,
              parameterCount: parameterIds.length,
              matchedParameterCount,
            }
        }
        return false
      }
      const cached = model.expressions && model.expressions.getValue(expressionId)
      if (!cached) return false
      model.expressionManager.stopAllMotions()
      const handle = model.expressionManager.startMotion(cached, false)
      if (handle !== -1 && handle !== null && handle !== undefined) {
        model.petExpressionProbe = {
          source: expressionId,
          expiresAt: performance.now() + 750,
          changed: 0,
          totalDelta: 0,
          largestDelta: 0,
        }
        return { handle, kind: 'expression', source: expressionId }
      }
      return false
    } catch (error) {
      console.warn(`Expression ${expressionId} failed:`, error.message)
      return false
    }
  }

  function startProfileMotionClip(clipName, priority = motionPriority.normal) {
    const model = state.model
    const clips = model && model.petMotionClips
    const clip = clips && clips.get(clipName)
    if (!model || !clip || !model.motionManager) return false
    try {
      const motionBuffer = clip.normalizedBuffer || (clip.normalizedBuffer = normalizedMotionBuffer(clip.buffer))
      const motionData = decodeMotionBuffer(motionBuffer)
      if (!motionHasPlayableCurves(motionData)) return false
      const parameterIds = (motionData.Curves || [])
        .filter(curve => curve && curve.Target === 'Parameter' && curve.Id)
        .map(curve => curve.Id)
      const modelParameterIds = model.parameters && Array.isArray(model.parameters.ids) ? model.parameters.ids : []
      const matchedParameterCount = parameterIds.filter(id => modelParameterIds.includes(id)).length
      if (parameterIds.length && !matchedParameterCount) return false
      const motion = model.loadMotion(
        motionBuffer,
        motionBuffer.byteLength,
        null,
        null,
        null,
        null,
        clip.group,
        clip.index
      )
      if (!motion) return false
      if (typeof motion.setLoop === 'function') motion.setLoop(false)
      if (typeof motion.setLoopFadeIn === 'function') motion.setLoopFadeIn(false)
      motion.setFadeInTime(0.12)
      motion.setFadeOutTime(0.22)
      motion.setEffectIds(model.eyeBlinkIds, model.lipSyncIds)
      // 显式预览必须替换上一条动作。只提高 reserve priority 会让 SDK
      // 接受请求却继续混合旧动作，设置页因此会显示“预览中”但角色不动。
      model.motionManager.stopAllMotions()
      model.motionManager.setReservePriority(priority)
      const handle = model.motionManager.startMotionPriority(motion, true, priority)
      if (handle === -1 || handle === null || handle === undefined) return false
      model.petMotionProbe = {
        source: clipName,
        expiresAt: performance.now() + 750,
        changed: 0,
        totalDelta: 0,
        largestDelta: 0,
      }
      state.activeUntil = performance.now() + Math.max(2600, clip.duration * 1000 + 500)
      return {
        handle,
        kind: 'motion',
        source: clipName,
        parameterCount: parameterIds.length,
        matchedParameterCount,
      }
    } catch (error) {
      console.warn(`Profile motion ${clipName} failed:`, error.message)
      return false
    }
  }

  function playProfileMotion(kind, priority) {
    const profile = currentReactionProfile()
    const candidates = profile && profile.actions && profile.actions[kind]
    if (!Array.isArray(candidates) || !candidates.length) return false
    const model = state.model
    const available = candidates.filter(candidate => (
      candidate && candidate.clip && model && model.petMotionClips && model.petMotionClips.has(candidate.clip)
    ))
    let selected = null
    // 映射的优先级高于 ZIP 动作组。单个映射文件若解析失败，继续尝试同一
    // 语义下的其他映射候选；全部失败后 playMotion() 才会走原生分组兜底。
    while (available.length) {
      const index = Math.floor(Math.random() * available.length)
      const candidate = available.splice(index, 1)[0]
      if (startProfileMotionClip(candidate.clip, priority)) {
        selected = candidate
        break
      }
    }
    if (!selected) return false
    if (selected.followUp) {
      const sequence = state.reactionSequence
      state.reactionMotionTimer = setTimeout(() => {
        state.reactionMotionTimer = null
        if (sequence !== state.reactionSequence || model !== state.model) return
        startProfileMotionClip(selected.followUp.clip, motionPriority.normal)
      }, selected.followUp.delay)
    }
    return true
  }

  function applyInteractionExpression(kind, expressionId, neutralId, sourceLabel) {
    const model = state.model
    if (!expressionId || !model || !model.expressionManager) return false
    try {
      // ExpressionController.setExpression() 没有返回值，资源缺失时也不会抛错。
      // 直接启动并校验句柄，避免点击无效却仍被界面标记为成功。
      if (!startNativeExpressionPreview(expressionId)) return false
      const sequence = state.reactionSequence
      const duration = kind === 'calm' || kind === 'sad' ? 3600 : kind === 'excited' ? 3200 : 2600
      state.expressionResetTimer = setTimeout(() => {
        state.expressionResetTimer = null
        if (sequence !== state.reactionSequence || model !== state.model) return
        if (neutralId) startNativeExpressionPreview(neutralId)
      }, duration)
      return true
    } catch (error) {
      console.warn(`${sourceLabel} expression ${expressionId} failed:`, error.message)
      return false
    }
  }

  function playProfileExpression(kind) {
    const profile = currentReactionProfile()
    const model = state.model
    const source = profile && profile.expressions && profile.expressions[kind]
    const expressionId = source && model && model.petExpressionIds && model.petExpressionIds.get(source)
    const neutralId = profile && profile.neutralExpression && model && model.petExpressionIds
      ? model.petExpressionIds.get(profile.neutralExpression)
      : ''
    return applyInteractionExpression(kind, expressionId, neutralId, `Profile ${source || kind}`)
  }

  function playNativeExpression(kind) {
    const model = state.model
    const expressionId = findNativeExpressionId(model, kind)
    const neutralId = findNativeExpressionId(model, 'idle')
    return applyInteractionExpression(kind, expressionId, neutralId, `Native ${kind}`)
  }

  function playMotion(kind, priority = motionPriority.normal) {
    if (!state.model || !state.model.loaded) return false
    if (state.model.kind === 'video-pet' && typeof state.model.playReaction === 'function') {
      state.model.playReaction(kind).catch(error => console.warn(`Video reaction ${kind} failed:`, error.message))
      state.activeUntil = performance.now() + 4200
      return true
    }
    // 产品级映射是经过模型逐项校对的高优先级来源；映射缺失或播放失败时，
    // 再使用 ZIP 自带的规范动作组，最后由 runInteraction 的轻量姿态响应兜底。
    if (playProfileMotion(kind, priority)) return true
    const fallbacks = {
      head: ['head', 'happy', 'tap'],
      greet: ['greet', 'happy', 'tap', 'idle'],
      happy: ['happy', 'head', 'tap'],
      snack: ['snack', 'happy', 'tap'],
      shy: ['shy', 'head', 'tap'],
      curious: ['curious', 'head', 'tap'],
      surprised: ['surprised', 'curious', 'tap', 'head'],
      sleepy: ['sleepy', 'idle'],
      sad: ['sleepy', 'idle'],
      angry: ['tap'],
      drag: ['greet', 'happy', 'tap', 'idle'],
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
    if (!groups.length) return false
    const groupName = randomItem(groups)
    const group = (state.model.buffers.motionGroups || []).find(item => item.group === groupName)
    const count = group && group.motionData && Array.isArray(group.motionData.motionBuffers)
      ? group.motionData.motionBuffers.length
      : 0
    if (!count) return false
    return startNativeMotion(groupName, Math.floor(Math.random() * count), priority)
  }

  function playMappedAction(actionId, priority = motionPriority.normal) {
    if (!actionId || !state.modelMeta || !state.modelMeta.assets) return false
    const actions = Array.isArray(state.modelMeta.assets.actions) ? state.modelMeta.assets.actions : []
    const asset = actions.find(item => item.id === actionId)
    if (!asset) return false
    if (asset.type === 'clip') return startProfileMotionClip(asset.clip, priority)
    if (asset.type === 'group') return startNativeMotion(asset.group, Number(asset.index) || 0, priority)
    if (asset.type === 'interaction') return playMotion(asset.interaction, priority)
    if (asset.type === 'video' && state.model.kind === 'video-pet') {
      state.model.playAnimation(asset.video, false).catch(error => console.warn(`Video action ${asset.video} failed:`, error.message))
      state.activeUntil = performance.now() + 4200
      return true
    }
    return false
  }

  function reportStatus(phase, modelId, message) {
    window.petAPI.reportModelStatus({ phase, modelId, message })
  }

  async function switchModel(modelMeta) {
    const previousModel = state.model
    const previousMeta = state.modelMeta
    const previousCanvas = state.liveCanvas
    const switchingAwayFromVideoPet = previousModel && previousModel.kind === 'video-pet' &&
      previousMeta && previousMeta.id !== modelMeta.id
    // 视频宠物的画布本身就是上一段视频的最后一帧。跨角色切换时若再把它
    // 复制成过渡快照，旧角色会一直盖在新角色上方，直到新模型加载完成。
    // 只有离开视频宠物时立即清掉旧快照；同一角色恢复以及普通 Live2D
    // 之间的切换仍保留原有的无白屏过渡。
    if (switchingAwayFromVideoPet) {
      document.querySelectorAll('.model-snapshot').forEach(snapshot => snapshot.remove())
    }
    const frozen = switchingAwayFromVideoPet ? null : createFrozenFrame()
    clearReactionTimers()
    stopCurrentSpeech()
    // 切模期间保留设置页最后一张有效角色帧；新模型首帧就绪后会原子替换。
    invalidateChatAnchor(true)
    state.model = null
    state.liveCanvas = null
    state.hitMask = null
    reportStatus('loading', modelMeta.id, `正在加载 ${modelMeta.name}`)

    releaseModel(previousModel, previousCanvas)

    const canvas = createLiveCanvas()
    const nextModel = createModelInstance(canvas, modelMeta)
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
      installMappedCursorFollow(nextModel, modelMeta.id)
      nextModel.touchController.cancelInteractions()
      nextModel.cameraController.removeListeners()
      initializeModelAtScale(nextModel, state.preferences.scale)
      nextModel.enableMotion = false
      nextModel.paused = state.paused || !state.visible
      // 定位和最终首帧准备完成后才显示新画布，避免加载过程中的临时
      // 相机位置被用户看到。
      canvas.classList.remove('is-preparing')

      state.model = nextModel
      state.modelMeta = modelMeta
      state.liveCanvas = canvas
      if (!chatPanel.hidden) updateChatIdentity()
      state.webglContextLost = false
      state.motionGroups = classifyMotionGroups(nextModel)
      state.hitMaskPending = true
      if (!chatPanel.hidden) rebuildHitMask()
      state.lastInteraction = performance.now()
      state.activeUntil = performance.now() + 2200
      state.idleStage = 0
      reportStatus('ready', modelMeta.id, `${modelMeta.name} 已就绪`)
      window.petAPI.reportModelAssets(modelPreviewCatalog(nextModel, modelMeta.id))
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
      const viewport = petViewportSize()
      const bounds = opaquePixels >= 12
        ? {
            x: Math.round(minX * (viewport.width / width)),
            y: Math.round(minY * (viewport.height / height)),
            width: Math.round((maxX - minX + 1) * (viewport.width / width)),
            height: Math.round((maxY - minY + 1) * (viewport.height / height)),
          }
        : null
      if (JSON.stringify(bounds) !== JSON.stringify(state.lastHitBounds)) {
        state.lastHitBounds = bounds
        window.petAPI.reportHitBounds(bounds)
      }
      if (bounds) flushPendingGreetingBubble()
      if (!chatPanel.hidden && !chatAnchorMatchesCurrentModel()) {
        captureChatAnchor(bounds)
        updateChatPosition()
      }
      return opaquePixels >= 12
    } catch (error) {
      state.hitMask = null
      if (state.lastHitBounds) {
        state.lastHitBounds = null
        window.petAPI.reportHitBounds(null)
      }
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

      let contextLost = false
      if (state.model.kind === 'video-pet') {
        try { state.model.update() } catch (error) { contextLost = true }
      } else {
        contextLost = state.webglContextLost
        try {
          const context = state.liveCanvas && state.liveCanvas.getContext('webgl2')
          contextLost = contextLost || !context || context.isContextLost()
          if (!contextLost) state.model.update()
        } catch (error) {
          contextLost = true
        }
      }

      const hasVisiblePixels = !contextLost && rebuildHitMask()
      if (!hasVisiblePixels && allowRecovery) {
        recoverVisibleModel(contextLost ? 'WebGL context unavailable' : 'blank frame after wake')
      }
    }, delay)
  }

  function hitAreasAt(clientX, clientY) {
    const empty = { hits: [], hasHeadArea: false }
    if (!state.model || !state.model.loaded || !state.model.settings) return empty
    try {
      const x = state.model.transformX(clientX)
      const y = state.model.transformY(clientY)
      const hits = []
      let hasHeadArea = false
      const count = state.model.settings.getHitAreasCount()
      for (let index = 0; index < count; index++) {
        const name = state.model.settings.getHitAreaName(index)
        const drawId = typeof state.model.settings.getHitAreaId === 'function'
          ? state.model.settings.getHitAreaId(index)
          : null
        const drawIdString = (() => {
          if (!drawId) return ''
          if (typeof drawId === 'string') return drawId
          const value = typeof drawId.getString === 'function' ? drawId.getString() : drawId
          if (typeof value === 'string') return value
          return value && typeof value.s === 'string' ? value.s : ''
        })()
        const normalizedName = String(name || '').trim().toLowerCase()
        const normalizedId = String(drawIdString || '').trim().toLowerCase()
        const role = classifyHitAreaRole(normalizedName, normalizedId)
        if (role === 'head') hasHeadArea = true

        let hit = false
        if (drawId && typeof state.model.isHit === 'function') hit = state.model.isHit(drawId, x, y)
        else if (name && typeof state.model.hitTest === 'function') hit = state.model.hitTest(name, x, y)
        if (hit) hits.push({ name: normalizedName, id: normalizedId, role })
      }
      return { hits, hasHeadArea }
    } catch (error) {
      return empty
    }
  }

  function isOnPet(clientX, clientY) {
    // 模型加载后整个窗口一律可交互：拖拽区域 = 整个窗口，
    // 保证任何位置都能抓住角色（边缘/头顶/尾巴都不再失效）。
    // 角色精细命中（hitAreasAt）仅用于点击反馈选择。
    if (!state.model || !state.model.loaded) return false
    const viewport = petViewportSize()
    return clientX >= 0 && clientX < viewport.width && clientY >= 0 && clientY < viewport.height
  }

  function isDraggablePoint(clientX, clientY, target = null) {
    const hoveredElement = target instanceof Element ? target : document.elementFromPoint(clientX, clientY)
    const point = viewportPoint(clientX, clientY)
    return Boolean(
      state.preferences &&
      state.preferences.interactionMode !== 'locked' &&
      !isInteractivePetUi(hoveredElement) &&
      isOnPet(point.clientX, point.clientY)
    )
  }

  function setDragAffordance(visible) {
    const enabled = Boolean(
      state.preferences &&
      state.preferences.backgroundDetection &&
      state.preferences.interactionMode !== 'locked'
    )
    stage.classList.toggle('is-drag-hover', enabled && Boolean(visible))
  }

  function updateMouseCapture(clientX, clientY, target = null) {
    state.pointer = viewportPoint(clientX, clientY)
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
    if (!Number.isFinite(currentScale)) return
    if (Math.abs(nextScale - currentScale) < 0.001) {
      showStatus(`角色尺寸已达 ${Math.round(currentScale * 100)}%`, 'info', 1300, 'scale')
      return
    }

    // 先给出即时视觉反馈，避免等待跨进程持久化时让滚轮操作显得没有生效。
    showStatus(`角色尺寸 ${Math.round(nextScale * 100)}%`, 'info', 1300, 'scale')

    try {
      const result = await window.petAPI.updateModelScale(modelId, nextScale)
      if (!result || !result.ok) {
        showStatus(result && result.error ? result.error : '角色尺寸保存失败', 'error', 1800)
        return
      }
      markInteraction(1200)
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
      surprised: { glyph: '!', colors: ['#f4c76d', '#e888aa', '#806de2'] },
      shy: { glyph: '♥', colors: ['#ef9fba', '#f3bfd0', '#b7aef0'] },
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
    const viewport = petViewportSize()
    return {
      x: viewport.width * 0.5,
      y: viewport.height * 0.22,
      head: {
        left: viewport.width * 0.38,
        right: viewport.width * 0.62,
        top: viewport.height * 0.12,
        bottom: viewport.height * 0.3,
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

  function typewriterCharacterInterval() {
    const qaInterval = Number(window.__PET_QA_TYPEWRITER_INTERVAL_MS)
    return Number.isFinite(qaInterval) && qaInterval > 0
      ? Math.max(1, qaInterval)
      : TYPEWRITER_CHARACTER_INTERVAL_MS
  }

  function typewriterDuration(text, speech = null) {
    const characterCount = Array.from(String(text || '')).length
    if (characterCount <= 1) return 0
    if (speech && Number.isFinite(speech.durationMs) && speech.durationMs > 0) {
      return Math.max(1, Math.round(speech.durationMs))
    }
    return Math.max(1, Math.round((characterCount - 1) * typewriterCharacterInterval()))
  }

  function isMessageStreamingOutputEnabled(source) {
    if (!state.preferences) return false
    return source === 'external'
      ? state.preferences.externalMessageStreamingOutput === true
      : state.preferences.appMessageStreamingOutput === true
  }

  function cancelTypewriter(lease = null) {
    if (lease != null && (!activeTypewriter || activeTypewriter.lease !== lease)) return false
    typewriterSequence += 1
    if (typewriterTimer) clearTimeout(typewriterTimer)
    typewriterTimer = null
    activeTypewriter = null
    return true
  }

  function applyTypewriterText(typewriter, visibleText) {
    if (!typewriter || typewriter.lease !== activeBubbleLease) return false
    interactionBubble.fullMessage = typewriter.fullText
    interactionBubble.visibleMessage = visibleText
    if (typeof interactionBubble.measureOverflow === 'function') interactionBubble.measureOverflow()
    if (longMessageState.open && longMessageState.lease === typewriter.lease) {
      syncLongMessageContent(
        visibleText,
        interactionBubble.label,
        interactionBubble.source,
        typewriter.fullText
      )
    } else if (interactionBubble.classList.contains('is-visible')) {
      layoutInteractionBubble()
    }
    return true
  }

  function scheduleTypewriterDismissal(typewriter = activeTypewriter) {
    if (
      !typewriter || !typewriter.complete || typewriter.lease !== activeBubbleLease ||
      (longMessageState.open && longMessageState.lease === typewriter.lease)
    ) return false
    if (typewriter.speech && !typewriter.speechCompleted) return false
    if (typewriter.source === 'external') {
      const messageId = typewriter.messageId || externalPriorityMessageId
      if (!messageId || messageId !== externalPriorityMessageId) return false
      scheduleExternalPriorityRelease(messageId, typewriter.fullText, TYPEWRITER_COMPLETE_HOLD_MS)
      return true
    }
    if (bubbleTimer) clearTimeout(bubbleTimer)
    bubbleTimer = setTimeout(() => {
      bubbleTimer = null
      dismissBubble(typewriter.lease)
    }, TYPEWRITER_COMPLETE_HOLD_MS)
    return true
  }

  function renderTypewriterFrame(sequence) {
    const typewriter = activeTypewriter
    if (!typewriter || typewriter.sequence !== sequence || typewriter.lease !== activeBubbleLease) return
    const elapsed = Math.max(0, performance.now() - typewriter.startedAt)
    const totalCharacters = typewriter.characters.length
    const visibleCount = typewriter.durationMs <= 0 || elapsed >= typewriter.durationMs
      ? totalCharacters
      : Math.max(1, Math.min(
          totalCharacters,
          1 + Math.floor(elapsed / typewriter.durationMs * (totalCharacters - 1))
        ))
    if (visibleCount !== typewriter.visibleCount) {
      typewriter.visibleCount = visibleCount
      applyTypewriterText(typewriter, typewriter.characters.slice(0, visibleCount).join(''))
    }
    if (visibleCount >= totalCharacters) {
      typewriter.complete = true
      typewriterTimer = null
      scheduleTypewriterDismissal(typewriter)
      return
    }
    const nextVisibleAt = typewriter.startedAt
      + typewriter.durationMs * visibleCount / Math.max(1, totalCharacters - 1)
    typewriterTimer = setTimeout(
      () => renderTypewriterFrame(sequence),
      Math.max(4, Math.min(80, nextVisibleAt - performance.now()))
    )
  }

  function startTypewriter(lease, text, options = {}) {
    const fullText = String(text || '').trim()
    if (!fullText || lease == null || lease !== activeBubbleLease) return false
    const speech = normalizePlayableSpeech(options.speech, options.source)
      || bubbleSpeechForLease(lease)
    if (
      activeTypewriter && activeTypewriter.lease === lease &&
      activeTypewriter.fullText === fullText
    ) {
      if (speech) {
        activeTypewriter.speech = speech
        setBubbleSpeech(lease, speech, options.source)
      }
      return true
    }

    cancelTypewriter()
    if (bubbleTimer) clearTimeout(bubbleTimer)
    bubbleTimer = null
    if (externalPriorityTimer) clearTimeout(externalPriorityTimer)
    externalPriorityTimer = null
    if (speech) setBubbleSpeech(lease, speech, options.source)

    const characters = Array.from(fullText)
    const streaming = options.streaming !== false
    const firstFrameText = streaming ? (characters[0] || '') : fullText
    interactionBubble.fullMessage = fullText
    interactionBubble.visibleMessage = firstFrameText
    syncBubbleChrome()
    if (typeof interactionBubble.measureOverflow === 'function') interactionBubble.measureOverflow()

    const autoExpandSource = options.autoExpandSource === 'external'
      ? 'external'
      : options.autoExpandSource === 'ai' ? 'ai' : ''
    const shouldOpenReader = autoExpandSource && shouldAutoOpenLongMessage(autoExpandSource)
      && messageExceedsLongMessageThreshold(fullText)
    if (longMessageState.open && longMessageState.lease === lease) {
      syncLongMessageContent(firstFrameText, interactionBubble.label, interactionBubble.source, fullText)
      longMessageBody.scrollTop = 0
    } else if (shouldOpenReader) {
      interactionBubble.classList.remove('is-visible')
      void openLongMessageReader({
        text: firstFrameText,
        fullText,
        label: interactionBubble.label,
        source: autoExpandSource,
      }, { focus: false })
    } else {
      interactionBubble.classList.add('is-visible')
      layoutInteractionBubble()
    }

    const sequence = ++typewriterSequence
    activeTypewriter = {
      sequence,
      lease,
      source: options.source === 'external' ? 'external' : 'ai',
      messageId: typeof options.messageId === 'string' ? options.messageId : '',
      fullText,
      characters,
      visibleCount: streaming ? (firstFrameText ? 1 : 0) : characters.length,
      durationMs: streaming ? typewriterDuration(fullText, speech) : 0,
      startedAt: performance.now(),
      speech,
      speechCompleted: !speech,
      complete: !streaming || characters.length <= 1,
    }
    if (activeTypewriter.complete) {
      scheduleTypewriterDismissal(activeTypewriter)
    } else {
      renderTypewriterFrame(sequence)
    }
    return true
  }

  function currentBubbleTheme() {
    return document.documentElement.dataset.settingsTheme === 'healing' ? 'healing' : 'glass'
  }

  function currentBubbleStyle() {
    const theme = currentBubbleTheme()
    const selected = state.preferences && state.preferences.bubbleStyles
      ? state.preferences.bubbleStyles[theme]
      : ''
    return ['glass', 'sweet', 'pixel', 'sci-fi'].includes(selected) ? selected : 'glass'
  }

  function currentLongMessageCharacterThreshold() {
    return normalizeLongMessageCharacterThreshold(
      state.preferences && state.preferences.longMessageCharacterThreshold
    )
  }

  function messageExceedsLongMessageThreshold(text) {
    return isLongMessageText(text, currentLongMessageCharacterThreshold())
  }

  function syncBubbleChrome() {
    const meta = currentModelMeta()
    const nickname = meta && typeof meta.nickname === 'string' ? meta.nickname.trim() : ''
    const modelName = meta && typeof meta.name === 'string' ? meta.name.trim() : ''
    const displayName = meta && typeof meta.displayName === 'string' ? meta.displayName.trim() : ''
    const theme = currentBubbleTheme()
    interactionBubble.setAttribute('theme', theme)
    interactionBubble.styleName = currentBubbleStyle()
    interactionBubble.setAttribute(
      'long-message-threshold',
      String(currentLongMessageCharacterThreshold())
    )
    // Bubble identity is model-owned, not theme-owned: a saved nickname wins;
    // otherwise show the model's original role name.
    const identity = nickname || modelName || displayName || '伙伴'
    interactionBubble.label = identity
    interactionBubble.source = externalPriorityMessageId ? 'external' : ''
    if (longMessageState.open) {
      longMessageState.label = interactionBubble.label
      longMessageTitle.textContent = interactionBubble.label
      syncLongMessageSource(interactionBubble.source)
      longMessageReader.setAttribute('aria-label', `${interactionBubble.label}的完整消息`)
      publishLongMessageReaderState()
    }
  }

  function reportBubbleVisualBounds(bounds) {
    // 标签、花瓣和光晕会超出主体矩形。把视觉外溢一并交给主进程，
    // 避免 Windows setShape() 裁掉参考设计中的悬浮装饰。
    const overflow = interactionBubble.visualOverflow || 18
    window.petAPI.reportBubbleBounds({
      x: bounds.left - overflow,
      y: bounds.top - overflow,
      width: bounds.width + overflow * 2,
      height: bounds.height + overflow * 2,
    })
  }

  function layoutInteractionBubble() {
    const { width, height } = petViewportSize()
    const bodyEdge = 20
    const gap = 10
    const mouth = currentMouthAnchor()
    const bounds = state.lastHitBounds
    const characterTop = bounds ? bounds.y : mouth.head.top
    const preferredWidth = interactionBubble.preferredWidth || 270
    const bubbleWidth = Math.min(preferredWidth, width - 24)
    const left = Math.max(12, Math.round((width - bubbleWidth) * 0.5))

    interactionBubble.style.width = `${bubbleWidth}px`
    interactionBubble.style.left = `${left}px`
    interactionBubble.style.top = `${bodyEdge}px`
    const bubbleHeight = interactionBubble.offsetHeight
    const top = Math.max(bodyEdge, Math.min(height - 12 - bubbleHeight, characterTop - gap - bubbleHeight))
    interactionBubble.style.top = `${top}px`
    interactionBubble.setTailX(Math.max(28, Math.min(bubbleWidth - 28, mouth.x - left)))
    reportBubbleVisualBounds({ left, top, width: bubbleWidth, height: bubbleHeight })
  }

  function normalizePlayableSpeech(speech, source = 'ai') {
    if (!speech) return null
    if (typeof speech === 'object') {
      const cached = normalizedSpeechAssets.get(speech)
      if (cached) return cached
    }
    const audioBase64 = typeof speech === 'string'
      ? speech.trim()
      : typeof speech.audioBase64 === 'string'
        ? speech.audioBase64.trim()
        : ''
    if (!audioBase64) return null
    const descriptor = {
      id: `speech-${++speechAssetSequence}`,
      audioBase64,
      mimeType: typeof speech === 'object' && typeof speech.mimeType === 'string' && speech.mimeType.trim()
        ? speech.mimeType.trim()
        : 'audio/wav',
      source: source === 'external' ? 'external' : 'ai',
      durationMs: Number.isFinite(speech && speech.durationMs) && speech.durationMs > 0
        ? Math.round(speech.durationMs)
        : wavDurationMs(base64ToArrayBuffer(audioBase64)),
    }
    if (typeof speech === 'object') normalizedSpeechAssets.set(speech, descriptor)
    normalizedSpeechAssets.set(descriptor, descriptor)
    return Object.freeze(descriptor)
  }

  function bubbleSpeechForLease(lease = activeBubbleLease) {
    return activeBubbleSpeech && activeBubbleSpeech.lease === lease
      ? activeBubbleSpeech.descriptor
      : null
  }

  function setSpeechButtonPlaying(button, playing) {
    if (!button) return
    const isPlaying = Boolean(playing)
    const label = isPlaying ? '停止播放这条语音' : '播放这条语音'
    button.classList.toggle('is-playing', isPlaying)
    button.setAttribute('aria-pressed', String(isPlaying))
    button.setAttribute('aria-label', label)
    button.title = label
  }

  function publishLongMessageReaderState() {
    if (typeof window.petAPI.updateLongMessageReaderState !== 'function') return
    const speech = longMessageState.speech
    window.petAPI.updateLongMessageReaderState({
      open: Boolean(longMessageState.open),
      text: longMessageState.visibleText,
      fullText: longMessageState.text,
      label: longMessageState.label || '伙伴',
      source: longMessageState.source,
      theme: currentBubbleTheme(),
      hasVoice: Boolean(speech),
      playing: Boolean(speech && activeSpeechAssetId && speech.id === activeSpeechAssetId),
      typing: Boolean(longMessageState.typing),
    })
  }

  function syncSpeechControlState() {
    document.querySelectorAll('.ai-message-audio[data-speech-asset-id]').forEach(button => {
      setSpeechButtonPlaying(button, Boolean(
        activeSpeechAssetId && button.dataset.speechAssetId === activeSpeechAssetId
      ))
    })
    if (!longMessageAudio) return
    const speech = longMessageState.speech
    if (speech) longMessageAudio.dataset.speechAssetId = speech.id
    else delete longMessageAudio.dataset.speechAssetId
    setSpeechButtonPlaying(longMessageAudio, Boolean(
      speech && activeSpeechAssetId && speech.id === activeSpeechAssetId
    ))
    publishLongMessageReaderState()
  }

  function syncLongMessageSpeech(speech = longMessageState.speech) {
    const playableSpeech = normalizePlayableSpeech(speech, speech && speech.source)
    longMessageState.speech = playableSpeech
    const hasVoice = Boolean(playableSpeech)
    longMessageAudioKind.dataset.kind = hasVoice ? 'voice' : 'text'
    longMessageAudioKind.textContent = hasVoice ? '语音消息' : '非语音消息'
    longMessageAudioKind.setAttribute('aria-label', hasVoice ? '这是一条语音消息' : '这是一条非语音消息')
    longMessageAudio.hidden = !hasVoice
    syncSpeechControlState()
  }

  function setBubbleSpeech(lease, speech, source = 'ai') {
    if (lease == null || lease !== activeBubbleLease) return false
    const previousSpeech = bubbleSpeechForLease(lease)
    const playableSpeech = normalizePlayableSpeech(speech, source)
    if (
      previousSpeech && activeSpeechAssetId === previousSpeech.id &&
      (!playableSpeech || playableSpeech.id !== previousSpeech.id)
    ) stopCurrentSpeech()
    activeBubbleSpeech = playableSpeech ? { lease, descriptor: playableSpeech } : null
    if (longMessageState.open && longMessageState.lease === lease) {
      syncLongMessageSpeech(playableSpeech)
    }
    return true
  }

  function longMessageCharacterCount(text) {
    return Array.from(String(text || '').replace(/\s/gu, '')).length
  }

  function syncLongMessageSource(source = longMessageState.source) {
    const normalizedSource = source === 'external' ? 'external' : ''
    longMessageState.source = normalizedSource
    longMessageSource.hidden = normalizedSource !== 'external'
    if (normalizedSource) longMessageReader.dataset.source = normalizedSource
    else delete longMessageReader.dataset.source
  }

  function setLongMessageStatusText(value) {
    const statusTextNode = Array.from(longMessageStatus.childNodes)
      .find(node => node.nodeType === Node.TEXT_NODE)
    if (statusTextNode) statusTextNode.nodeValue = value
    else longMessageStatus.appendChild(document.createTextNode(value))
  }

  function syncLongMessageContent(
    visibleText = longMessageState.visibleText || longMessageState.text,
    label = longMessageState.label,
    source = longMessageState.source,
    fullText = longMessageState.text || visibleText
  ) {
    const normalizedText = String(fullText || '').trim()
    const normalizedVisibleText = String(visibleText || '').trim()
    const normalizedLabel = String(label || interactionBubble.label || '伙伴').trim() || '伙伴'
    const fullTextChanged = normalizedText !== longMessageState.text
    longMessageState.text = normalizedText
    longMessageState.visibleText = normalizedVisibleText
    longMessageState.typing = normalizedVisibleText !== normalizedText
    longMessageState.label = normalizedLabel
    longMessageBody.textContent = normalizedVisibleText
    const scrollable = longMessageBody.scrollHeight > longMessageBody.clientHeight + 1
    setLongMessageStatusText(longMessageState.typing
      ? '文字展示中…'
      : scrollable ? '可滚动查看全文' : '内容已完整显示')
    longMessageTitle.textContent = normalizedLabel
    longMessageSubtitle.textContent = '完整消息'
    syncLongMessageSource(source)
    const characterCount = longMessageCharacterCount(normalizedText)
    longMessageCount.textContent = `${characterCount} 字`
    longMessageBadge.setAttribute('aria-label', `长消息，共 ${characterCount} 字`)
    longMessageReader.setAttribute('aria-label', `${normalizedLabel}的完整消息`)
    syncLongMessageSpeech(longMessageState.speech)
    if (fullTextChanged) resetLongMessageCopyFeedback()
    scheduleLongMessageMeasurement()
  }

  function reportLongMessageVisualBounds() {
    if (!longMessageState.open || longMessageReader.hidden) {
      if (lastLongMessageBoundsSignature !== 'closed') {
        lastLongMessageBoundsSignature = 'closed'
        window.petAPI.reportLongMessageBounds(null)
      }
      return
    }
    // offset* describes the final layout box and is unaffected by the 220ms
    // transform entry animation. Reporting getBoundingClientRect() here would
    // briefly shrink/shift the Windows native shape and clip the glass card.
    const bounds = {
      x: longMessageReader.offsetLeft,
      y: longMessageReader.offsetTop,
      width: longMessageReader.offsetWidth,
      height: longMessageReader.offsetHeight,
      revision: petWindowLayout.revision,
    }
    if (bounds.width <= 0 || bounds.height <= 0) return
    const signature = JSON.stringify(bounds)
    if (signature === lastLongMessageBoundsSignature) return
    lastLongMessageBoundsSignature = signature
    window.petAPI.reportLongMessageBounds(bounds)
  }

  function updateLongMessageOverflowState() {
    if (!longMessageState.open || longMessageReader.hidden) return
    const scrollable = longMessageBody.scrollHeight > longMessageBody.clientHeight + 1
    const atStart = longMessageBody.scrollTop <= 1
    const atEnd = longMessageBody.scrollTop + longMessageBody.clientHeight >= longMessageBody.scrollHeight - 1
    longMessageReader.classList.toggle('is-scrollable', scrollable)
    longMessageReader.classList.toggle('is-at-start', atStart)
    longMessageReader.classList.toggle('is-at-end', atEnd)
    const statusText = longMessageState.typing
      ? '文字展示中…'
      : scrollable ? '可滚动查看全文' : '内容已完整显示'
    setLongMessageStatusText(statusText)
    reportLongMessageVisualBounds()
  }

  function scheduleLongMessageMeasurement() {
    if (!longMessageState.open || longMessageReader.hidden) return
    if (longMessageMeasureFrame != null) cancelAnimationFrame(longMessageMeasureFrame)
    longMessageMeasureFrame = requestAnimationFrame(() => {
      longMessageMeasureFrame = requestAnimationFrame(() => {
        longMessageMeasureFrame = null
        updateLongMessageOverflowState()
      })
    })
  }

  function resetLongMessageCopyFeedback() {
    longMessageCopySequence += 1
    if (longMessageCopyTimer) clearTimeout(longMessageCopyTimer)
    longMessageCopyTimer = null
    longMessageCopy.classList.remove('is-copied')
    const copyLabel = longMessageCopy.querySelector('span')
    if (copyLabel) copyLabel.textContent = '复制'
    longMessageCopy.setAttribute('aria-label', '复制完整消息')
  }

  function resumeBubbleDismissalAfterReader(stateBeforeClose) {
    if (!stateBeforeClose || stateBeforeClose.lease == null || stateBeforeClose.lease !== activeBubbleLease) return
    if (activeTypewriter && activeTypewriter.lease === stateBeforeClose.lease) {
      scheduleTypewriterDismissal(activeTypewriter)
      return
    }
    if (externalPriorityMessageId) {
      scheduleExternalPriorityRelease(externalPriorityMessageId, stateBeforeClose.text)
      return
    }
    if (bubbleTimer) clearTimeout(bubbleTimer)
    bubbleTimer = setTimeout(() => {
      bubbleTimer = null
      dismissBubble(stateBeforeClose.lease)
    }, bubbleDurationForText(stateBeforeClose.text))
  }

  function hideBubbleForLongMessageReader(lease) {
    if (lease == null || lease !== activeBubbleLease) return false
    interactionBubble.expanded = true
    interactionBubble.setAttribute('aria-hidden', 'true')
    interactionBubble.classList.remove('is-visible')
    return true
  }

  function restoreBubbleAfterLongMessageReader(stateBeforeClose) {
    if (
      !stateBeforeClose || stateBeforeClose.lease == null ||
      stateBeforeClose.lease !== activeBubbleLease || !interactionBubble.message
    ) return false
    interactionBubble.expanded = false
    interactionBubble.removeAttribute('aria-hidden')
    interactionBubble.classList.add('is-visible')
    requestAnimationFrame(() => {
      if (
        stateBeforeClose.lease === activeBubbleLease &&
        interactionBubble.classList.contains('is-visible')
      ) layoutInteractionBubble()
    })
    return true
  }

  function waitForVisualFrames(count = 1) {
    return new Promise(resolve => {
      const step = remaining => requestAnimationFrame(() => {
        if (remaining <= 1) resolve()
        else step(remaining - 1)
      })
      step(Math.max(1, Number(count) || 1))
    })
  }

  function shouldAutoOpenLongMessage(source) {
    if (!state.preferences || state.preferences.interactionMode === 'locked') return false
    if (source === 'external') return state.preferences.externalLongMessageAutoExpand === true
    if (source !== 'ai' || state.preferences.appLongMessageAutoExpand !== true) return false
    // The expanded APP chat already shows the complete reply. Its collapsed
    // input bar does not, so the reader remains useful in that compact state.
    return chatPanel.hidden || chatCollapsed
  }

  async function createPetStageTransitionFrame(dataURL, stageOffsetX) {
    if (typeof dataURL !== 'string' || !dataURL.startsWith('data:image/')) return null
    const frame = new Image()
    frame.className = 'pet-stage-transition-frame'
    frame.alt = ''
    frame.setAttribute('aria-hidden', 'true')
    frame.dataset.phase = 'prepared'
    frame.style.left = `${Math.round(Number(stageOffsetX) || 0)}px`
    frame.src = dataURL
    try { await frame.decode() } catch (error) { return null }
    return frame
  }

  async function performLongMessageLayoutRequest(options) {
    const canCommitSynchronously = typeof window.petAPI.previewLongMessageLayout === 'function'
      && typeof window.petAPI.commitLongMessageLayout === 'function'
    if (!canCommitSynchronously) return window.petAPI.setLongMessageLayout(options)

    // Right-side expansion keeps the stage origin and takes the direct path.
    // Left-side expansion/collapse changes BrowserWindow.x and uses a captured
    // stage frame so the pet remains visually fixed across the native resize.
    const previousLayout = { ...petWindowLayout }
    const preview = window.petAPI.previewLongMessageLayout(options)
    if (!preview || typeof preview !== 'object') return window.petAPI.setLongMessageLayout(options)
    const stageMoves = Number(preview.stageOffsetX) !== Number(previousLayout.stageOffsetX)
    const canStageVisualHandoff = stageMoves
      && typeof window.petAPI.capturePetTransitionFrame === 'function'
      && typeof window.petAPI.setLongMessageTransitionState === 'function'
    let transitionFrame = null
    let transitionActive = false
    try {
      if (canStageVisualHandoff) {
        const dataURL = await window.petAPI.capturePetTransitionFrame()
        transitionFrame = await createPetStageTransitionFrame(dataURL, previousLayout.stageOffsetX)
        if (transitionFrame) {
          transitionActive = window.petAPI.setLongMessageTransitionState(true) === true
          document.body.appendChild(transitionFrame)
        }
      }
      applyPetWindowLayout(preview)
      // The captured stage remains at the old physical screen position while
      // Chromium paints the live stage at its future offset. The main process
      // exposes only the stage shape during this hand-off, so neither copy can
      // leak into the reader area.
      if (transitionActive) await waitForVisualFrames(2)
      // Keep the capture at the same physical screen coordinate on both sides
      // of the synchronous native resize. Moving it and committing bounds in
      // one JS task prevents Chromium from painting the new local offset while
      // it still belongs to the old window origin.
      if (transitionFrame) {
        transitionFrame.style.left = `${Math.round(Number(preview.stageOffsetX) || 0)}px`
      }
      const committed = window.petAPI.commitLongMessageLayout(options)
      if (!committed || typeof committed !== 'object') throw new Error('窗口布局提交失败')
      applyPetWindowLayout(committed)
      if (transitionFrame) transitionFrame.dataset.phase = 'committed'
      if (transitionActive) await waitForVisualFrames(2)
      return committed
    } catch (error) {
      applyPetWindowLayout({ ...previousLayout, revision: petWindowLayout.revision })
      throw error
    } finally {
      if (transitionFrame) transitionFrame.remove()
      if (transitionActive) window.petAPI.setLongMessageTransitionState(false)
    }
  }

  function requestLongMessageLayout(options) {
    // A fast double click can enqueue close while open is still handing its
    // compositor frame to the new native bounds. Keep those transactions in
    // order so a late open commit can never win over the user's collapse.
    const operation = longMessageLayoutQueue
      .catch(() => undefined)
      .then(() => performLongMessageLayoutRequest(options))
    longMessageLayoutQueue = operation.catch(() => undefined)
    return operation
  }

  async function openLongMessageReader(detail = {}, options = {}) {
    const text = String(
      detail.fullText || interactionBubble.fullMessage || detail.text || interactionBubble.message || ''
    ).trim()
    const visibleText = String(detail.text || interactionBubble.message || text).trim()
    const lease = activeBubbleLease
    if (!text || lease == null || !messageExceedsLongMessageThreshold(text)) return false

    const requestSequence = ++longMessageRequestSequence
    if (bubbleTimer) clearTimeout(bubbleTimer)
    bubbleTimer = null
    if (externalPriorityTimer) clearTimeout(externalPriorityTimer)
    externalPriorityTimer = null
    longMessageState = {
      open: true,
      text,
      visibleText,
      label: String(detail.label || interactionBubble.label || '伙伴'),
      source: detail.source === 'external' || interactionBubble.source === 'external' ? 'external' : '',
      lease,
      speech: bubbleSpeechForLease(lease),
      typing: visibleText !== text,
    }
    syncLongMessageContent()
    hideBubbleForLongMessageReader(lease)

    try {
      const layout = await requestLongMessageLayout({
        open: true,
        preferredWidth: LONG_MESSAGE_READER_WIDTH,
      })
      if (requestSequence !== longMessageRequestSequence || lease !== activeBubbleLease || !longMessageState.open) return false
      applyPetWindowLayout(layout)
      const detached = Boolean(layout && layout.detached)
      longMessageReader.hidden = detached
      // The host ignores the hidden bubble while the reader layout is open.
      // Clear its cached bounds only after the atomic window-layout commit so
      // Windows does not rebuild the collapsed shape immediately beforehand.
      window.petAPI.reportBubbleBounds(null)
      if (detached) {
        longMessageReader.classList.remove('is-visible', 'is-scrollable', 'is-at-start', 'is-at-end')
        reportLongMessageVisualBounds()
        publishLongMessageReaderState()
        setDragAffordance(false)
        markInteraction(60000)
        return true
      }
      // Chromium does not reliably apply scrollTop while an element is
      // display:none via [hidden]. Every newly opened message must begin at
      // the first line, including after the previous theme was scrolled down.
      longMessageBody.scrollTop = 0
      longMessageReader.classList.remove('is-visible')
      requestAnimationFrame(() => {
        if (!longMessageState.open) return
        longMessageReader.classList.add('is-visible')
        if (options.focus !== false) longMessageBody.focus({ preventScroll: true })
        scheduleLongMessageMeasurement()
      })
      setDragAffordance(false)
      markInteraction(60000)
      return true
    } catch (error) {
      if (requestSequence !== longMessageRequestSequence) return false
      console.warn('Long-message reader failed to open:', error.message)
      longMessageState.open = false
      longMessageState.source = ''
      syncLongMessageSource('')
      longMessageState.speech = null
      syncLongMessageSpeech(null)
      interactionBubble.expanded = false
      longMessageReader.hidden = true
      restoreBubbleAfterLongMessageReader({ text, lease })
      resumeBubbleDismissalAfterReader({ text, lease })
      showStatus('完整消息展开失败', 'error', 2200)
      return false
    }
  }

  async function closeLongMessageReader(options = {}) {
    const stateBeforeClose = { ...longMessageState }
    const hadExpandedLayout = Boolean(petWindowLayout.expanded)
    if (!stateBeforeClose.open && !hadExpandedLayout) return false
    const readerOwnsActiveSpeech = Boolean(
      stateBeforeClose.speech && activeSpeechAssetId === stateBeforeClose.speech.id
    ) || activeSpeechBubbleLease === stateBeforeClose.lease || activeSpeechButton === longMessageAudio
    if (readerOwnsActiveSpeech) stopCurrentSpeech()
    const requestSequence = ++longMessageRequestSequence
    longMessageState = {
      open: false,
      text: '',
      visibleText: '',
      label: '',
      source: '',
      lease: null,
      speech: null,
      typing: false,
    }
    syncLongMessageSource('')
    syncLongMessageSpeech(null)
    if (longMessageMeasureFrame != null) cancelAnimationFrame(longMessageMeasureFrame)
    longMessageMeasureFrame = null
    interactionBubble.expanded = false
    longMessageReader.classList.remove('is-visible', 'is-scrollable', 'is-at-start', 'is-at-end')
    longMessageBody.scrollTop = 0
    longMessageReader.hidden = true
    resetLongMessageCopyFeedback()
    reportLongMessageVisualBounds()

    try {
      // Paint the hidden state before changing the native origin/width. Without
      // this frame barrier Windows can reuse the previous card texture at its
      // collapsed offset and the reader visibly slides before disappearing.
      if (!options.hostLayout && !petWindowLayout.detached) await waitForVisualFrames(2)
      const layout = options.hostLayout || await requestLongMessageLayout({ open: false })
      if (requestSequence === longMessageRequestSequence) applyPetWindowLayout(layout)
    } catch (error) {
      console.warn('Long-message reader failed to collapse:', error.message)
    }
    if (requestSequence === longMessageRequestSequence) {
      if (options.dismissBubble === true) {
        if (
          stateBeforeClose.lease === externalPriorityBubbleLease &&
          externalPriorityMessageId
        ) {
          releaseExternalPriority(externalPriorityMessageId)
        } else {
          dismissBubble(stateBeforeClose.lease, true)
        }
      } else {
        if (options.restoreBubble !== false) restoreBubbleAfterLongMessageReader(stateBeforeClose)
        if (options.resumeBubble !== false) resumeBubbleDismissalAfterReader(stateBeforeClose)
      }
    }
    return true
  }

  function dismissBubble(lease = activeBubbleLease, force = false) {
    if (lease == null || lease !== activeBubbleLease) return false
    if (longMessageState.open && longMessageState.lease === lease) {
      if (!force) return false
      closeLongMessageReader({ resumeBubble: false, restoreBubble: false })
    }
    if (bubbleTimer) clearTimeout(bubbleTimer)
    bubbleTimer = null
    cancelTypewriter(lease)
    activeBubbleLease = null
    activeBubbleSource = ''
    if (activeBubbleSpeech && activeBubbleSpeech.lease === lease) activeBubbleSpeech = null
    interactionBubble.removeAttribute('aria-hidden')
    interactionBubble.classList.remove('is-visible')
    interactionBubble.fullMessage = ''
    window.petAPI.reportBubbleBounds(null)
    return true
  }

  function updateBubbleText(lease, text, options = {}) {
    if (lease == null || lease !== activeBubbleLease || !text) return false
    cancelTypewriter(lease)
    if (Object.prototype.hasOwnProperty.call(options, 'speech')) {
      setBubbleSpeech(lease, options.speech, options.source)
    }
    interactionBubble.fullMessage = text
    interactionBubble.message = text
    syncBubbleChrome()
    if (typeof interactionBubble.measureOverflow === 'function') interactionBubble.measureOverflow()
    if (longMessageState.open && longMessageState.lease === lease) {
      syncLongMessageContent(text, interactionBubble.label, interactionBubble.source, text)
    } else {
      const autoExpandSource = options.autoExpandSource === 'external'
        ? 'external'
        : options.autoExpandSource === 'ai' ? 'ai' : ''
      const shouldOpenReader = autoExpandSource && shouldAutoOpenLongMessage(autoExpandSource)
        && messageExceedsLongMessageThreshold(text)
      if (shouldOpenReader) {
        // Decide and switch surfaces synchronously. Waiting for a later frame
        // would paint the complete long reply in the bubble before the reader
        // opens, producing a visible one-frame flash.
        interactionBubble.classList.remove('is-visible')
        void openLongMessageReader({
          text,
          label: interactionBubble.label,
          source: autoExpandSource,
        }, { focus: false })
      } else if (interactionBubble.classList.contains('is-visible')) {
        layoutInteractionBubble()
      }
    }
    return true
  }

  function showBubble(text, duration = null, source = 'interaction', options = {}) {
    if (!text) return null
    const messageSource = source === 'ai' || source === 'external'
    if (
      messageSource && state.preferences &&
      state.preferences.interactionMode === 'locked' &&
      state.preferences.showMessagesWhenLocked === false
    ) return null
    // 气泡必须依附于已完成加载且已有有效像素边界的当前角色，不能在
    // 空画布上先于角色出现。启动问候由 ensureChatGreeting 单独暂存。
    if (
      !state.model || !state.model.loaded || !state.modelMeta || !state.lastHitBounds ||
      !state.snapshot || state.modelMeta.id !== state.snapshot.currentModelId
    ) return null
    // AI 请求期间只允许最终回复占用宠物气泡；拖动、点击和闲置反馈
    // 仍可执行动作与粒子效果，但不覆盖对话状态，也不在结束后补发。
    if (externalPriorityMessageId && source !== 'external') return null
    if (chatBusy && !['ai', 'external'].includes(source)) return null
    // 气泡是严格的单实例资源：当前内容存续期间，任何后来消息直接
    // 丢弃，不替换、不续时，也不进入队列。
    if (activeBubbleLease != null || interactionBubble.classList.contains('is-visible')) return null
    const lease = ++bubbleLeaseSequence
    activeBubbleLease = lease
    activeBubbleSource = source
    setBubbleSpeech(lease, options.speech, source)
    const ownsFinalMessageLifecycle = options.typewriter === true
    const streaming = ownsFinalMessageLifecycle && isMessageStreamingOutputEnabled(source)

    interactionBubble.fullMessage = text
    if (streaming) {
      interactionBubble.visibleMessage = Array.from(String(text))[0] || ''
    } else {
      interactionBubble.message = text
    }
    interactionBubble.classList.remove('is-left', 'is-right')
    interactionBubble.classList.add('is-top')
    syncBubbleChrome()
    if (typeof interactionBubble.measureOverflow === 'function') interactionBubble.measureOverflow()
    const autoExpandSource = options.autoExpandSource === 'external'
      ? 'external'
      : options.autoExpandSource === 'ai' ? 'ai' : ''
    const shouldOpenReader = autoExpandSource && shouldAutoOpenLongMessage(autoExpandSource)
      && messageExceedsLongMessageThreshold(text)
    if (shouldOpenReader) {
      // The bubble remains unpainted while the shared manual reader path opens.
      // This also preserves the user's current focus because auto-open passes
      // focus:false to the reader.
      void openLongMessageReader({
        text: interactionBubble.message,
        fullText: text,
        label: interactionBubble.label,
        source: autoExpandSource,
      }, { focus: false })
      if (ownsFinalMessageLifecycle) {
        startTypewriter(lease, text, {
          source,
          messageId: options.messageId,
          speech: options.speech,
          autoExpandSource,
          streaming,
        })
      }
      return lease
    }
    interactionBubble.classList.add('is-visible')
    layoutInteractionBubble()
    if (ownsFinalMessageLifecycle) {
      startTypewriter(lease, text, {
        source,
        messageId: options.messageId,
        speech: options.speech,
        autoExpandSource,
        streaming,
      })
      return lease
    }
    if (options.hold) return lease
    const visibleDuration = Number.isFinite(duration) && duration > 0
      ? duration
      : bubbleDurationForText(text)
    bubbleTimer = setTimeout(() => {
      bubbleTimer = null
      dismissBubble(lease)
    }, visibleDuration)
    return lease
  }

  function runInteraction(requestedKind = 'random', point = null, options = {}) {
    if (!state.model || !state.model.loaded) return
    const randomKinds = ['greet', 'head', 'praise', 'snack', 'curious']
    const kind = requestedKind === 'custom'
      ? 'curious'
      : requestedKind === 'random' ? randomItem(randomKinds) : requestedKind
    const config = {
      greet: { motion: 'greet', count: 7, pose: { x: 0.32, y: 0.08 } },
      head: { motion: 'head', count: 8, pose: { x: 0, y: 0.48 } },
      praise: { motion: 'happy', count: 9, pose: { x: -0.22, y: 0.18 } },
      snack: { motion: 'snack', count: 8, pose: { x: 0.2, y: 0.3 } },
      tap: { motion: 'tap', count: 6, pose: { x: 0, y: 0.2 } },
      calm: { motion: 'sleepy', count: 5, pose: { x: 0, y: -0.34 } },
      curious: { motion: 'curious', count: 6, pose: { x: 0.38, y: 0.24 } },
      surprised: { motion: 'surprised', count: 8, pose: { x: 0.28, y: 0.42 } },
      shy: { motion: 'shy', count: 6, pose: { x: -0.18, y: -0.08 } },
      excited: { motion: 'happy', count: 12, pose: { x: -0.4, y: 0.38 } },
      sad: { motion: 'sad', count: 4, pose: { x: 0, y: -0.46 } },
      angry: { motion: 'angry', count: 7, pose: { x: -0.36, y: -0.14 } },
      drag: { motion: 'drag', count: 5, pose: { x: 0.22, y: 0.12 } },
    }[kind] || { motion: 'tap', count: 6, pose: { x: 0, y: 0.2 } }
    const viewport = petViewportSize()
    const x = Math.max(20, Math.min(viewport.width - 20, Number(point && point.clientX) || viewport.width * 0.5))
    const y = Math.max(20, Math.min(viewport.height - 20, Number(point && point.clientY) || viewport.height * 0.32))

    clearReactionTimers()
    const priority = kind === 'excited' ? motionPriority.force : motionPriority.normal
    const mappedActionPlayed = options.actionId ? playMappedAction(options.actionId, priority) : false
    if (!mappedActionPlayed) playMotion(config.motion, priority)
    // 显式模型映射优先；没有配置、资源缺失或解析失败时，再按 ZIP 中原生
    // expression 的常见命名匹配。两者都不可用也不阻断动作与姿态反馈。
    if (!playProfileExpression(kind)) playNativeExpression(kind)
    state.reactionPose = { ...config.pose, until: performance.now() + (kind === 'calm' ? 1800 : 1150) }
    addReactionEffect(x, y, kind, config.count)
    const copy = options.text
      ? [options.text]
      : requestedKind === 'custom' && options.label
        ? [options.label]
        : interactionCopy[kind] || interactionCopy.greet
    if (options.bubble !== false) showBubble(randomItem(copy))
    markInteraction(kind === 'calm' ? 3000 : 2400)
  }

  function addSpeechButton(message, text, speech) {
    const playableSpeech = normalizePlayableSpeech(speech, 'ai')
    if (!message || !playableSpeech || message.querySelector('.ai-message-audio')) return null
    const audioButton = document.createElement('button')
    audioButton.className = 'ai-message-audio'
    audioButton.type = 'button'
    audioButton.dataset.speechAssetId = playableSpeech.id
    audioButton.setAttribute('aria-pressed', 'false')
    audioButton.setAttribute('aria-label', '播放这条语音')
    audioButton.title = '播放这条语音'
    audioButton.innerHTML = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 7h3l3.5-2.8v9.6L6 11H3z"/><path d="M12 6.2a4 4 0 0 1 0 5.6M14 4.3a6.6 6.6 0 0 1 0 9.4"/></svg>'
    audioButton.addEventListener('click', () => playGeneratedSpeech(playableSpeech, audioButton, text))
    message.classList.add('has-audio')
    message.appendChild(audioButton)
    return audioButton
  }

  function appendChatMessage(text, type = 'assistant', speech = null, kind = null, metadata = {}) {
    const message = document.createElement('div')
    message.className = `ai-message is-${type}`
    message.dataset.messageKind = kind || (type === 'thinking' || type === 'error' ? 'system' : 'conversation')
    const source = metadata.source === 'external' ? 'external' : 'app'
    const sourceLabel = source === 'external' ? '外部' : 'APP'
    message.dataset.messageSource = source
    message.dataset.messageSourceLabel = sourceLabel
    if (source === 'external' && metadata.sender) message.dataset.messageSender = String(metadata.sender).slice(0, 60)
    // APP messages already have an unambiguous side/alignment in the local chat,
    // so a repeated source badge only adds visual noise. External messages keep
    // their compact origin row because the sender is meaningful context.
    if (source === 'external') {
      const origin = document.createElement('span')
      origin.className = 'ai-message-origin'
      const badge = document.createElement('b')
      badge.className = 'ai-message-source'
      badge.textContent = sourceLabel
      origin.appendChild(badge)
      if (metadata.sender) {
        const sender = document.createElement('span')
        sender.className = 'ai-message-sender'
        sender.textContent = String(metadata.sender).slice(0, 60)
        origin.appendChild(sender)
      }
      message.appendChild(origin)
    }
    const content = document.createElement('span')
    content.className = 'ai-message-content'
    content.textContent = text
    message.appendChild(content)
    if (!['thinking', 'error'].includes(type)) {
      const timestamp = document.createElement('time')
      const now = new Date()
      timestamp.className = 'ai-message-time'
      timestamp.dateTime = now.toISOString()
      timestamp.textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
      message.appendChild(timestamp)
    }
    if (type === 'assistant') addSpeechButton(message, text, speech)
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
  let chatHistoryRestoreSequence = 0

  function snapshotChatHistory(modelId) {
    if (!modelId) return
    const entries = []
    chatMessages.querySelectorAll('.ai-message').forEach(el => {
      if (el.classList.contains('is-thinking')) return
      if (el.dataset.messageSource === 'external') return
      const type = ['user', 'error'].find(t => el.classList.contains(`is-${t}`)) || 'assistant'
      const kind = el.dataset.messageKind || (type === 'error' ? 'system' : 'conversation')
      const content = el.querySelector('.ai-message-content')
      if (content && content.textContent) {
        entries.push({
          type,
          kind,
          text: content.textContent,
          source: 'app',
          sourceLabel: 'APP',
        })
      }
    })
    chatHistories.set(modelId, entries.slice(-CHAT_HISTORY_KEEP))
  }

  function renderChatHistoryEntries(entries) {
    chatMessages.replaceChildren()
    for (const entry of entries) appendChatMessage(entry.text, entry.type, null, entry.kind, entry)
  }

  async function restoreChatHistory(modelId) {
    const sequence = ++chatHistoryRestoreSequence
    const cached = (modelId && chatHistories.get(modelId)) || null
    if (cached) {
      renderChatHistoryEntries(cached)
      return
    }
    chatMessages.replaceChildren()
    try {
      const result = await window.petAPI.getAIConversation(modelId)
      if (
        sequence !== chatHistoryRestoreSequence || !state.snapshot ||
        state.snapshot.currentModelId !== modelId
      ) return
      const entries = result && result.ok && Array.isArray(result.messages)
        ? result.messages.filter(message => message.source !== 'external').map(message => ({
            type: message.role === 'user' ? 'user' : 'assistant',
            kind: 'conversation',
            text: String(message.content || ''),
            source: 'app',
            sourceLabel: 'APP',
          })).filter(entry => entry.text)
        : []
      chatHistories.set(modelId, entries.slice(-CHAT_HISTORY_KEEP))
      renderChatHistoryEntries(chatHistories.get(modelId))
      if (!chatPanel.hidden) ensureChatGreeting()
    } catch (error) {
      console.warn('Persistent chat history restore failed:', error.message)
      if (sequence === chatHistoryRestoreSequence && !chatPanel.hidden) ensureChatGreeting()
    }
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
    const modelId = state.snapshot && state.snapshot.currentModelId
    snapshotChatHistory(modelId)
    if (
      state.model && state.model.loaded && state.modelMeta && state.modelMeta.id === modelId &&
      state.lastHitBounds
    ) {
      showBubble(greeting, null, 'ai')
    } else {
      pendingGreetingBubble = { modelId, text: greeting }
    }
    return true
  }

  function flushPendingGreetingBubble() {
    const pending = pendingGreetingBubble
    if (!pending) return false
    if (
      chatPanel.hidden || !state.snapshot || pending.modelId !== state.snapshot.currentModelId ||
      !state.model || !state.model.loaded || !state.modelMeta ||
      state.modelMeta.id !== pending.modelId || !state.lastHitBounds
    ) return false
    // 只让同一条启动问候等待角色首帧；若此时已有其他气泡占用，
    // 仍按单实例规则直接丢弃，不形成通用消息队列。
    pendingGreetingBubble = null
    return showBubble(pending.text, null, 'ai') != null
  }

  function chatAnchorMatchesCurrentModel() {
    const modelId = state.modelMeta && state.modelMeta.id
    const modelScale = state.model && Number(state.model.scale)
    const viewport = petViewportSize()
    return Number.isFinite(state.chatAnchorBottom)
      && state.chatAnchorModelId === modelId
      && Number.isFinite(modelScale)
      && Math.abs(state.chatAnchorScale - modelScale) < 0.001
      && state.chatAnchorViewportHeight === viewport.height
  }

  function captureChatAnchor(bounds = state.lastHitBounds) {
    if (!bounds || !state.modelMeta || !state.model) return false
    const modelScale = Number(state.model.scale)
    if (!Number.isFinite(modelScale)) return false
    const viewport = petViewportSize()
    state.chatAnchorBottom = Math.max(0, Math.min(viewport.height, bounds.y + bounds.height))
    state.chatAnchorModelId = state.modelMeta.id
    state.chatAnchorScale = modelScale
    state.chatAnchorViewportHeight = viewport.height
    return true
  }

  function updateStatusToastPosition() {
    if (chatPanel.hidden) {
      statusToast.style.removeProperty('--toast-bottom')
      return
    }
    const chatTop = chatPanel.offsetTop
    const bottom = Math.max(18, petViewportSize().height - chatTop + 10)
    statusToast.style.setProperty('--toast-bottom', `${bottom}px`)
    if (statusToast.classList.contains('is-visible')) requestAnimationFrame(reportStatusToastBounds)
  }

  function reportChatPanelVisualBounds() {
    if (chatPanel.hidden) {
      if (lastChatPanelBoundsSignature !== 'closed') {
        lastChatPanelBoundsSignature = 'closed'
        window.petAPI.reportChatBounds(null)
      }
      return
    }
    const bounds = {
      x: chatPanel.offsetLeft,
      y: chatPanel.offsetTop,
      width: chatPanel.offsetWidth,
      height: chatPanel.offsetHeight,
    }
    if (bounds.width <= 0 || bounds.height <= 0) return
    const signature = JSON.stringify(bounds)
    if (signature === lastChatPanelBoundsSignature) return
    lastChatPanelBoundsSignature = signature
    window.petAPI.reportChatBounds(bounds)
  }

  function updateChatPosition() {
    const bounds = state.lastHitBounds
    if (chatPanel.hidden) {
      chatPanel.classList.remove('is-overlapping-pet')
      chatPanel.style.removeProperty('--chat-top')
      updateStatusToastPosition()
      reportChatPanelVisualBounds()
      return
    }
    if (!chatAnchorMatchesCurrentModel() && !captureChatAnchor(bounds)) {
      updateStatusToastPosition()
      reportChatPanelVisualBounds()
      return
    }
    const characterBottom = state.chatAnchorBottom
    const panelHeight = chatPanel.offsetHeight || 222
    const maximumTop = Math.max(10, petViewportSize().height - panelHeight - 10)
    chatPanel.classList.toggle('is-overlapping-pet', characterBottom > maximumTop)
    chatPanel.style.setProperty('--chat-top', `${Math.min(characterBottom, maximumTop)}px`)
    updateStatusToastPosition()
    reportChatPanelVisualBounds()
  }

  function syncChatPositionDuringTransition() {
    if (chatPositionAnimationFrame != null) cancelAnimationFrame(chatPositionAnimationFrame)
    const startedAt = performance.now()
    const followPanelHeight = now => {
      updateChatPosition()
      if (now - startedAt < 280) {
        chatPositionAnimationFrame = requestAnimationFrame(followPanelHeight)
      } else {
        chatPositionAnimationFrame = null
        updateChatPosition()
      }
    }
    chatPositionAnimationFrame = requestAnimationFrame(followPanelHeight)
  }

  function setChatCollapsed(collapsed) {
    chatCollapsed = Boolean(collapsed)
    chatPanel.classList.toggle('is-collapsed', chatCollapsed)
    chatToggle.setAttribute('aria-expanded', String(!chatCollapsed))
    chatToggle.setAttribute('aria-label', chatCollapsed ? '展开对话' : '收起对话')
    chatToggle.title = chatCollapsed ? '展开对话' : '收起对话'
    updateChatPosition()
    syncChatPositionDuringTransition()
    if (!chatCollapsed) chatMessages.scrollTop = chatMessages.scrollHeight
  }

  function setChatOpen(open, notifyHost = true, options = {}) {
    const locked = Boolean(state.preferences && state.preferences.interactionMode === 'locked')
    const next = Boolean(open) && !locked
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
        if (!chatCollapsed) chatInput.focus()
      }, 0)
    } else {
      pendingGreetingBubble = null
      if (!locked && options.preserveDraft !== true) {
        chatInput.value = ''
        resizeChatInput()
        updateChatSendState()
      }
      reportChatPanelVisualBounds()
    }
  }

  // 面板身份跟随当前角色：名字、输入框占位符
  let lastChatIdentityName = '伙伴'
  function currentModelMeta() {
    // 快照代表用户当前选中的角色；模型实例在异步切换期间仍可能是上一只，
    // 因此聊天身份必须以快照为准，不能被旧 modelMeta 抢先命中。
    const modelId = (state.snapshot && state.snapshot.currentModelId) || (state.modelMeta && state.modelMeta.id)
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
    syncBubbleChrome()
  }

  function resizeChatInput() {
    chatInput.style.height = 'auto'
    chatInput.style.height = `${Math.min(82, chatInput.scrollHeight)}px`
  }

  function updateChatSendState() {
    chatSend.disabled = chatBusy || chatInput.value.trim().length === 0
  }

  function stopCurrentSpeech(options = {}) {
    const stoppedSpeechId = activeSpeechAssetId
    speechSequence += 1
    activeSpeechButton = null
    activeSpeechAssetId = null
    syncSpeechControlState()
    if (activeSpeechBubbleLease != null) {
      const lease = activeSpeechBubbleLease
      activeSpeechBubbleLease = null
      if (options.dismissBubble !== false) dismissBubble(lease)
    }
    if (
      activeTypewriter && activeTypewriter.speech &&
      activeTypewriter.speech.id === stoppedSpeechId
    ) activeTypewriter.speechCompleted = true
    if (activeTypewriter && activeTypewriter.complete) scheduleTypewriterDismissal(activeTypewriter)
    if (!state.model || typeof state.model.stopAudio !== 'function') return
    try { state.model.stopAudio() } catch (error) { /* 没有正在播放的语音 */ }
    // live2d-renderer stops the Web Audio source but intentionally retains the
    // decoded samples and RMS cursor. Its update loop therefore keeps driving
    // ParamMouthOpenY after playback was cancelled. Reset both the controller
    // and current lip-sync parameters so collapse closes the mouth immediately.
    const wavController = state.model.wavController
    if (wavController) {
      wavController.samples = null
      wavController.sampleOffset = 0
      wavController.samplesPerChannel = 0
      wavController.userTime = 0
      wavController.previousRms = 0
      wavController.rms = 0
    }
    const coreModel = state.model.model
    const lipSyncIds = state.model.lipSyncIds
    if (!coreModel || !lipSyncIds || typeof lipSyncIds.getSize !== 'function') return
    for (let index = 0; index < lipSyncIds.getSize(); index++) {
      try {
        const id = lipSyncIds.at(index)
        const parameterIndex = coreModel.getParameterIndex(id)
        const minimum = coreModel.getParameterMinimumValue(parameterIndex)
        const maximum = coreModel.getParameterMaximumValue(parameterIndex)
        coreModel.setParameterValueById(id, Math.max(minimum, Math.min(maximum, 0)))
      } catch (error) { /* 不完整模型可能没有可写的口型参数 */ }
    }
  }

  function chatCapabilityAvailability(capability) {
    const ai = state.snapshot && state.snapshot.ai
    const plugins = ai && Array.isArray(ai.plugins) ? ai.plugins : []
    const installed = plugins.filter(plugin => plugin.installed && plugin.capabilities.includes(capability))
    const configured = installed.filter(plugin => plugin.configured)
    const activeIds = ai && ai.activePluginIds ? ai.activePluginIds : {}
    const active = installed.find(plugin => plugin.id === activeIds[capability])
    return {
      configured: configured.length > 0,
      ready: Boolean(active && active.configured),
    }
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

  function wavDurationMs(buffer) {
    try {
      const view = new DataView(buffer)
      const chunkName = offset => String.fromCharCode(
        view.getUint8(offset), view.getUint8(offset + 1),
        view.getUint8(offset + 2), view.getUint8(offset + 3)
      )
      if (view.byteLength < 44 || chunkName(0) !== 'RIFF' || chunkName(8) !== 'WAVE') return 0
      let byteRate = 0
      let dataSize = 0
      let offset = 12
      while (offset + 8 <= view.byteLength) {
        const name = chunkName(offset)
        const declaredSize = view.getUint32(offset + 4, true)
        const availableSize = Math.max(0, Math.min(declaredSize, view.byteLength - offset - 8))
        if (name === 'fmt ' && availableSize >= 12) byteRate = view.getUint32(offset + 16, true)
        if (name === 'data') {
          dataSize = availableSize
          break
        }
        offset += 8 + declaredSize + (declaredSize % 2)
      }
      if (!byteRate || !dataSize) return 0
      return Math.max(1, Math.round(dataSize / byteRate * 1000))
    } catch (error) {
      return 0
    }
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
      return normalizePlayableSpeech({
        audioBase64: result.audioBase64,
        mimeType: result.mimeType || 'audio/wav',
      }, 'ai')
    } catch (error) {
      if (requestId !== speechSequence) return null
      console.warn('Speech synthesis failed:', error.message)
      showStatus(error.message || '语音生成失败', 'error', 3200)
      return null
    }
  }

  async function playGeneratedSpeech(speechInput, button = null, bubbleText = '', options = {}) {
    const speech = normalizePlayableSpeech(speechInput, options.source)
    if (!speech || !state.model || typeof state.model.inputAudio !== 'function') return false
    if (chatMuted && !options.ignoreMute) {
      showStatus('请先解除静音再播放语音', 'info', 2200)
      return false
    }
    if (activeSpeechAssetId === speech.id) {
      stopCurrentSpeech()
      return false
    }
    stopCurrentSpeech()
    const requestId = ++speechSequence
    const model = state.model
    activeSpeechButton = button
    activeSpeechAssetId = speech.id
    if (activeTypewriter && activeTypewriter.speech === speech) {
      activeTypewriter.speechCompleted = false
    }
    if (button) button.dataset.speechAssetId = speech.id
    syncSpeechControlState()
    try {
      if (model.audioContext && model.audioContext.state === 'suspended') await model.audioContext.resume()
      if (requestId !== speechSequence || model !== state.model) return false
      markInteraction(60000)
      const playback = model.inputAudio(base64ToArrayBuffer(speech.audioBase64), true)
      const speechBubbleLease = bubbleText && !options.reuseBubble
        ? showBubble(bubbleText, null, options.source === 'external' ? 'external' : 'ai', {
            hold: true,
            speech,
            autoExpandSource: options.autoExpandSource,
            typewriter: options.typewriter === true,
            messageId: options.messageId,
          })
        : null
      if (speechBubbleLease != null) activeSpeechBubbleLease = speechBubbleLease
      Promise.resolve(playback).then(() => {
        if (requestId !== speechSequence) return
        activeSpeechButton = null
        activeSpeechAssetId = null
        syncSpeechControlState()
        if (activeSpeechBubbleLease === speechBubbleLease) {
          activeSpeechBubbleLease = null
          if (activeTypewriter && activeTypewriter.lease === speechBubbleLease) {
            scheduleTypewriterDismissal(activeTypewriter)
          } else {
            dismissBubble(speechBubbleLease)
          }
        }
        if (activeTypewriter && activeTypewriter.speech === speech) {
          activeTypewriter.speechCompleted = true
          scheduleTypewriterDismissal(activeTypewriter)
        }
        markInteraction(1600)
        if (typeof options.onComplete === 'function') options.onComplete(true)
      }).catch(error => {
        if (requestId !== speechSequence) return
        stopCurrentSpeech({ dismissBubble: false })
        console.warn('Speech playback failed:', error.message)
        showStatus(error.message || '语音播放失败', 'error', 3200)
        if (typeof options.onComplete === 'function') options.onComplete(false)
      })
      return true
    } catch (error) {
      if (requestId !== speechSequence) return false
      stopCurrentSpeech({ dismissBubble: false })
      console.warn('Speech playback failed:', error.message)
      showStatus(error.message || '语音播放失败', 'error', 3200)
      if (typeof options.onComplete === 'function') options.onComplete(false)
      return false
    }
  }

  function releaseExternalPriority(messageId) {
    if (!messageId || externalPriorityMessageId !== messageId) return false
    if (longMessageState.open && longMessageState.lease === externalPriorityBubbleLease) return false
    if (externalPriorityTimer) clearTimeout(externalPriorityTimer)
    externalPriorityTimer = null
    if (externalPriorityBubbleLease != null) dismissBubble(externalPriorityBubbleLease)
    externalPriorityBubbleLease = null
    externalPriorityMessageId = ''
    syncBubbleChrome()
    return true
  }

  function shouldRetainReaderForExternalMessage(message) {
    // Only a non-speech direct message already has its final text at receive
    // time. Relay and TTS progress must stay in the compact bubble instead of
    // replacing an open reader with “思考中/语音合成中”.
    return Boolean(
      message && message.type === 'direct' && !message.speak &&
      messageExceedsLongMessageThreshold(message.content)
    )
  }

  function updateExternalPriorityFinalSurface(text, speech = null, messageId = externalPriorityMessageId) {
    const readerOwnsLease = longMessageState.open
      && longMessageState.lease === externalPriorityBubbleLease
      && externalPriorityBubbleLease === activeBubbleLease
    if (readerOwnsLease && !messageExceedsLongMessageThreshold(text)) {
      const readerLease = externalPriorityBubbleLease
      dismissBubble(readerLease, true)
      externalPriorityBubbleLease = showBubble(text, null, 'external', {
        speech,
        autoExpandSource: 'external',
        typewriter: true,
        messageId,
      })
      return externalPriorityBubbleLease != null
    }
    if (startTypewriter(externalPriorityBubbleLease, text, {
      speech,
      source: 'external',
      autoExpandSource: 'external',
      messageId,
      streaming: isMessageStreamingOutputEnabled('external'),
    })) return true
    if (activeBubbleLease != null) dismissBubble(activeBubbleLease)
    externalPriorityBubbleLease = showBubble(text, null, 'external', {
      speech,
      autoExpandSource: 'external',
      typewriter: true,
      messageId,
    })
    return externalPriorityBubbleLease != null
  }

  function scheduleExternalPriorityRelease(messageId, text, maximum = null) {
    if (externalPriorityTimer) clearTimeout(externalPriorityTimer)
    const duration = Number.isFinite(maximum) && maximum > 0
      ? maximum
      : bubbleDurationForText(text)
    externalPriorityTimer = setTimeout(() => releaseExternalPriority(messageId), duration)
  }

  function beginExternalPriority(message) {
    if (externalPriorityTimer) clearTimeout(externalPriorityTimer)
    externalPriorityTimer = null
    const retainedReaderLease = shouldRetainReaderForExternalMessage(message)
      && longMessageState.open && longMessageState.lease === activeBubbleLease
      ? activeBubbleLease
      : null
    if (retainedReaderLease == null && activeBubbleLease != null) dismissBubble(activeBubbleLease, true)
    if (retainedReaderLease != null) stopCurrentSpeech()
    externalPriorityMessageId = message.id
    externalPriorityBubbleLease = retainedReaderLease
    syncBubbleChrome()
    return retainedReaderLease
  }

  function externalMessageProgressText(event, message) {
    if (event && typeof event.progressText === 'string' && event.progressText.trim()) {
      return event.progressText.trim()
    }
    const stage = event && event.stage
    if (stage === 'thinking') return '思考中…'
    if (stage === 'speech') return '语音合成中…'
    if (message.type === 'relay') return '思考中…'
    if (message.speak) return '语音合成中…'
    return message.content
  }

  function handleExternalMessageEvent(event) {
    if (!event || !event.message || !event.message.id) return
    const message = event.message

    if (event.phase === 'received') {
      const retainedReaderLease = beginExternalPriority(message)
      const progressText = externalMessageProgressText(event, message)
      const finalTextKnownAtReceive = message.type === 'direct' && !message.speak
      if (retainedReaderLease != null) {
        externalPriorityBubbleLease = startTypewriter(retainedReaderLease, progressText, {
          source: 'external',
          autoExpandSource: 'external',
          messageId: message.id,
        }) ? retainedReaderLease : null
      } else {
        // A non-speech direct message already carries its final display text in
        // the received/display phase. Run the overflow decision here instead
        // of first painting the complete bubble and waiting for the nearly
        // identical completed event to open the reader.
        externalPriorityBubbleLease = showBubble(progressText, null, 'external', {
          autoExpandSource: finalTextKnownAtReceive ? 'external' : undefined,
          typewriter: finalTextKnownAtReceive,
          messageId: message.id,
          hold: !finalTextKnownAtReceive,
        })
      }
      markInteraction(60000)
      return
    }

    // 外部消息的中间态只更新当前长持有气泡：不设置超时，
    // 不进入 App 聊天记录，也不在阶段切换时销毁后重建。
    if (event.phase === 'progress') {
      if (externalPriorityMessageId !== message.id) return
      const progressText = externalMessageProgressText(event, message)
      if (!updateBubbleText(externalPriorityBubbleLease, progressText)) {
        if (activeBubbleLease != null) dismissBubble(activeBubbleLease, true)
        externalPriorityBubbleLease = showBubble(progressText, null, 'external', { hold: true })
      }
      markInteraction(60000)
      return
    }

    if (event.phase === 'failed') {
      if (externalPriorityMessageId !== message.id) return
      const errorText = event.error || '外部消息处理失败'
      if (!updateExternalPriorityFinalSurface(errorText, null, message.id)) {
        releaseExternalPriority(message.id)
      }
      return
    }

    if (event.phase !== 'completed' || !event.result) return
    if (externalPriorityMessageId !== message.id) return
    const result = event.result
    const speech = normalizePlayableSpeech(result.speech, 'external')
    const displayed = updateExternalPriorityFinalSurface(result.text, speech, message.id)
    runInteraction(emotionInteractions[result.emotion] || 'curious', null, { bubble: false })
    if (speech) {
      playGeneratedSpeech(speech, null, '', {
        ignoreMute: true,
        reuseBubble: true,
        source: 'external',
        typewriter: true,
        messageId: message.id,
        onComplete: displayed ? undefined : () => releaseExternalPriority(message.id),
      }).then(started => {
        if (!started && activeTypewriter && activeTypewriter.messageId === message.id) {
          activeTypewriter.speechCompleted = true
          scheduleTypewriterDismissal(activeTypewriter)
        }
        if (!started && !displayed) releaseExternalPriority(message.id)
      })
    } else if (!displayed) releaseExternalPriority(message.id)
  }

  async function submitChat() {
    const text = chatInput.value.trim()
    if (!text || chatBusy) return
    const requestSequence = ++chatRequestSequence
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
    // A reader belongs to the final message that opened it; it must never be
    // reused as the progress surface for a later request. Close and release the
    // old lease first, then show thinking/TTS progress in the ordinary bubble.
    if (longMessageState.open) await closeLongMessageReader({ dismissBubble: true })
    const progressBubbleLease = showBubble('思考中…', null, 'ai', { hold: true })
    markInteraction(60000)
    try {
      const result = await window.petAPI.sendAIMessage(text)
      if (requestSequence !== chatRequestSequence) return
      if (!result || !result.ok) throw new Error(result && result.error ? result.error : '暂时没有收到回复')
      const ai = state.snapshot && state.snapshot.ai
      const ttsReady = Boolean(!chatMuted && ai && ai.readyByCapability && ai.readyByCapability.tts)
      let speech = null
      if (ttsReady) {
        thinking.textContent = '语音合成中'
        chatPresenceText.textContent = '语音合成中'
        updateBubbleText(progressBubbleLease, '语音合成中…')
        markInteraction(60000)
        speech = await synthesizeAssistantSpeech(result.text)
        if (requestSequence !== chatRequestSequence) return
      }
      thinking.remove()
      dismissBubble(progressBubbleLease)
      const assistantMessage = appendChatMessage(result.text, 'assistant', speech)
      // 回复开头的情绪标签已由主进程剥离并解析为稳定键，映射到对应
      // 的情绪动作；模型没给标签时退回好奇反应（原默认行为）
      runInteraction(emotionInteractions[result.emotion] || 'curious', null, { bubble: false })
      if (speech) {
        const audioButton = assistantMessage.querySelector('.ai-message-audio')
        playGeneratedSpeech(speech, audioButton, result.text, {
          autoExpandSource: 'ai',
          typewriter: true,
        })
      } else {
        showBubble(result.text, null, 'ai', {
          autoExpandSource: 'ai',
          typewriter: true,
        })
      }
    } catch (error) {
      if (requestSequence !== chatRequestSequence) return
      thinking.remove()
      const message = error.message || '连接失败，请稍后再试'
      appendChatMessage(message, 'error')
      dismissBubble(progressBubbleLease)
      showBubble(message, null, 'ai')
    } finally {
      dismissBubble(progressBubbleLease)
      if (requestSequence === chatRequestSequence) {
        chatBusy = false
        chatInput.disabled = false
        updateChatSendState()
        chatPanel.classList.remove('is-thinking')
        chatPresenceText.textContent = '在线'
        chatInput.focus()
      } else {
        thinking.remove()
      }
    }
  }

  function drawEffects(timestamp) {
    const { width, height } = petViewportSize()
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

  function resumeSettingsBackgroundAfterDrag() {
    if (!state.settingsBackgroundCaptureActive) return
    state.settingsBackgroundLastFrameAt = 0
    state.wakeRecoveryAttempts = 0
    if (!state.wakeCheckTimer) scheduleWakeHealthCheck(80)
    ensureScheduler()
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
      if (state.model && state.model.kind === 'video-pet') state.model.paused = true
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
      if (state.model.kind === 'video-pet') state.model.paused = state.paused
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
    return pointIsHeadByPolicy({
      pointX: point && point.clientX,
      pointY: point && point.clientY,
      hitAreas,
      visibleBounds: state.lastHitBounds,
      video: Boolean(state.model && state.model.kind === 'video-pet'),
    })
  }

  function runGestureInteraction(gestureId, fallbackKind, point) {
    const gestures = state.modelMeta && Array.isArray(state.modelMeta.gestures) ? state.modelMeta.gestures : []
    const gesture = gestures.find(item => item.id === gestureId)
    if (gesture && gesture.enabled === false) return
    runInteraction(gesture ? gesture.kind : fallbackKind, point, {
      actionId: gesture && gesture.actionId,
      text: gesture && gesture.text,
    })
  }

  function triggerLongPress(point, hitAreas) {
    if (!state.pointerDown || state.dragging || state.longPressTriggered) return false
    state.longPressTriggered = true
    const onHead = pointIsHead(point, hitAreas)
    runGestureInteraction(onHead ? 'long-press-head' : 'long-press-body', onHead ? 'head' : 'calm', point)
    return true
  }

  function beginLongPress(point, hitAreas) {
    clearLongPress()
    state.longPressTriggered = false
    state.longPressTimer = setTimeout(() => {
      state.longPressTimer = null
      triggerLongPress(point, hitAreas)
    }, PET_GESTURE_LIMITS.longPressMs)
  }

  function runClickSequence(count, point, hitAreas) {
    if (count >= 3) runGestureInteraction('triple-click', 'excited', point)
    else if (count === 2) runGestureInteraction('double-click', 'praise', point)
    else {
      const onHead = pointIsHead(point, hitAreas)
      runGestureInteraction(onHead ? 'tap-head' : 'tap-body', onHead ? 'head' : 'tap', point)
    }
  }

  function flushClickSequence() {
    const count = state.clickCount
    const point = state.lastClickPoint
    const hitAreas = state.lastClickHitAreas
    state.clickTimer = null
    state.clickCount = 0
    if (count > 0 && point) runClickSequence(count, point, hitAreas)
  }

  function queueClickInteraction(point, hitAreas) {
    const now = performance.now()
    const transition = advanceMultiClick(state.clickCount, now - state.lastClickAt)
    if (transition.flushCount > 0) {
      if (state.clickTimer) clearTimeout(state.clickTimer)
      flushClickSequence()
    }
    state.lastClickAt = now
    state.clickCount = transition.nextCount
    state.lastClickPoint = point
    state.lastClickHitAreas = hitAreas
    if (state.clickTimer) clearTimeout(state.clickTimer)
    state.clickTimer = setTimeout(flushClickSequence, PET_GESTURE_LIMITS.multiClickMs)
  }

  function applySnapshot(snapshot) {
    const previousModelId = state.snapshot && state.snapshot.currentModelId
    const wasLocked = Boolean(state.preferences && state.preferences.interactionMode === 'locked')
    const modelChanged = previousModelId !== snapshot.currentModelId
    const nextSettingsTheme = snapshot.preferences.settingsTheme === 'healing' ? 'healing' : 'glass'
    const settingsThemeChanged = document.documentElement.dataset.settingsTheme !== nextSettingsTheme
    if (modelChanged) {
      invalidateChatAnchor(true)
      pendingGreetingBubble = null
      dismissBubble(activeBubbleLease, true)
    }
    state.snapshot = snapshot
    if (state.modelMeta && state.modelMeta.id === snapshot.currentModelId) {
      const refreshedMeta = snapshot.models.find(item => item.id === state.modelMeta.id)
      if (refreshedMeta) state.modelMeta = refreshedMeta
    }
    state.preferences = snapshot.preferences
    const locked = snapshot.preferences.interactionMode === 'locked'
    if (locked) {
      if (!chatPanel.hidden) setChatOpen(false, true, { preserveDraft: true })
      const hideLockedMessage = (
        snapshot.preferences.showMessagesWhenLocked === false &&
        ['ai', 'external'].includes(activeBubbleSource)
      )
      if (hideLockedMessage) dismissBubble(activeBubbleLease, true)
      else if (longMessageState.open || petWindowLayout.expanded) void closeLongMessageReader()
    }
    const nextOpacity = Math.min(1, Math.max(0.1, Number(snapshot.preferences.opacity) || 1))
    document.documentElement.style.setProperty('--pet-character-opacity', String(nextOpacity))
    document.documentElement.dataset.settingsTheme = nextSettingsTheme
    syncBubbleChrome()
    if (interactionBubble.classList.contains('is-visible')) {
      requestAnimationFrame(layoutInteractionBubble)
    }
    // 展开态在两套主题中的高度不同（glass 246px / healing 268px）。
    // 主题变化后必须在新样式生效期间持续重算顶部锚点，否则旧 top 与
    // 新高度组合会把输入区推出 400×600 窗口底部。
    if (settingsThemeChanged && !chatPanel.hidden) {
      // offsetHeight forces the new theme styles to resolve immediately, so
      // there is no one-frame interval where the old top meets the new height.
      updateChatPosition()
      requestAnimationFrame(syncChatPositionDuringTransition)
    }
    const backgroundDetectionActive = Boolean(
      snapshot.preferences.backgroundDetection && !locked
    )
    stage.classList.toggle('has-background-detection', backgroundDetectionActive)
    if (!backgroundDetectionActive) setDragAffordance(false)
    state.paused = Boolean(snapshot.runtime && snapshot.runtime.paused)
    if (state.model && state.model.kind === 'video-pet') state.model.paused = state.paused || !state.visible
    syncVisibility(Boolean(snapshot.runtime && snapshot.runtime.petVisible))
    if (!snapshot.ai || !snapshot.ai.ready) setChatOpen(false)
    if (!chatCapabilityAvailability('tts').ready && !chatMuted) setChatMuted(true)
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
    if (!chatPanel.hidden && !modelChanged) ensureChatGreeting()

    // A snapshot can arrive after the lock-triggered close IPC has already
    // updated the host. Avoid treating later locked snapshots as a fresh user
    // close; the draft remains available for the next explicit chat open.
    if (locked && !wasLocked) reportChatPanelVisualBounds()

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
    if (!state.dragging && Math.hypot(dx, dy) >= PET_GESTURE_LIMITS.moveThreshold) {
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
    if (isInteractivePetUi(event.target)) return
    const point = viewportPoint(event.clientX, event.clientY)
    if (!state.preferences || event.button !== 0 || state.preferences.interactionMode === 'locked' || !isOnPet(point.clientX, point.clientY)) return
    state.pointerDown = {
      screenX: event.screenX,
      screenY: event.screenY,
      clientX: point.clientX,
      clientY: point.clientY,
      time: performance.now(),
      hitAreas: hitAreasAt(point.clientX, point.clientY),
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
    const releaseKind = classifyPointerRelease({
      dragging: state.dragging,
      longPressTriggered: state.longPressTriggered,
      moved,
      elapsed,
      onPet: isOnPet(pointerDown.clientX, pointerDown.clientY),
    })
    clearLongPress()

    if (state.dragging) {
      window.petAPI.dragEnd()
      if (state.liveCanvas) state.liveCanvas.classList.remove('is-dragging')
      stage.classList.remove('is-dragging')
      if (
        moved >= PET_GESTURE_LIMITS.dragReactionThreshold &&
        performance.now() - state.lastDragReaction > PET_GESTURE_LIMITS.dragReactionCooldownMs
      ) {
        state.lastDragReaction = performance.now()
        runGestureInteraction('drag-end', 'drag', viewportPoint(event.clientX, event.clientY))
      }
    } else if (releaseKind === 'long-press') {
      triggerLongPress(pointerDown, pointerDown.hitAreas)
    } else if (releaseKind === 'click') {
      queueClickInteraction(pointerDown, pointerDown.hitAreas)
    }

    restoreDragCamera()
    if (!state.dragging) window.petAPI.dragEnd()
    state.pointerDown = null
    state.dragging = false
    state.dragCamera = null
    resumeSettingsBackgroundAfterDrag()
    updateMouseCapture(event.clientX, event.clientY, event.target)
  })

  document.addEventListener('mouseleave', () => {
    if (!state.dragging) setDragAffordance(false)
  })

  document.addEventListener('contextmenu', event => {
    if (isInteractivePetUi(event.target)) return
    event.preventDefault()
    const point = viewportPoint(event.clientX, event.clientY)
    if (state.preferences && state.preferences.interactionMode !== 'locked' && isOnPet(point.clientX, point.clientY)) {
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
    resumeSettingsBackgroundAfterDrag()
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
    if (event.key === 'Escape' && longMessageState.open) {
      event.preventDefault()
      closeLongMessageReader({ dismissBubble: true })
      return
    }
    if (event.key === 'Escape' && !chatPanel.hidden) {
      event.preventDefault()
      setChatOpen(false)
    }
  })

  window.petAPI.onCursorMove(point => {
    state.followPoint = point
    if (point.near) {
      state.activeUntil = Math.max(state.activeUntil, performance.now() + 500)
      ensureScheduler()
    }
    if (point.inside) {
      state.pointer = { clientX: point.clientX, clientY: point.clientY }
      setDragAffordance(isOnPet(point.clientX, point.clientY))
    }
    else if (!state.dragging) setDragAffordance(false)
  })

  window.petAPI.onPauseChanged(paused => {
    state.paused = Boolean(paused)
    if (state.model && state.model.kind === 'video-pet') state.model.paused = state.paused || !state.visible
    ensureScheduler()
  })

  window.petAPI.onInteractionRequested(request => {
    runInteraction(request && request.kind ? request.kind : 'random', null, {
      actionId: request && request.actionId,
      label: request && request.label,
      text: request && request.text,
    })
  })

  window.petAPI.onModelPreview(previewModelAsset)

  window.petAPI.onChatVisibility(open => setChatOpen(open, false))

  window.petAPI.onExternalMessage(handleExternalMessageEvent)

  interactionBubble.addEventListener('bubble-expand', event => {
    event.preventDefault()
    openLongMessageReader(event.detail || {})
  })

  longMessageCollapse.addEventListener('click', () => {
    closeLongMessageReader({ dismissBubble: true })
  })

  function toggleLongMessageAudio() {
    const speech = longMessageState.speech
    const lease = longMessageState.lease
    if (!longMessageState.open || lease == null || !speech) return
    playGeneratedSpeech(speech, longMessageAudio, '', {
      ignoreMute: true,
      reuseBubble: true,
      source: speech.source,
    })
  }

  longMessageAudio.addEventListener('click', toggleLongMessageAudio)

  if (typeof window.petAPI.onLongMessageReaderAction === 'function') {
    window.petAPI.onLongMessageReaderAction(action => {
      if (action === 'collapse') closeLongMessageReader({ dismissBubble: true })
      else if (action === 'audio') toggleLongMessageAudio()
    })
  }

  longMessageCopy.addEventListener('click', async () => {
    if (!longMessageState.open || !longMessageState.text) return
    const copySequence = ++longMessageCopySequence
    const copiedState = {
      lease: longMessageState.lease,
      text: longMessageState.text,
    }
    try {
      const result = await window.petAPI.writeClipboardText(copiedState.text)
      if (
        copySequence !== longMessageCopySequence || !longMessageState.open ||
        longMessageState.lease !== copiedState.lease || longMessageState.text !== copiedState.text
      ) return
      if (result !== true) throw new Error('复制失败')
      const label = longMessageCopy.querySelector('span')
      longMessageCopy.classList.add('is-copied')
      if (label) label.textContent = '已复制'
      longMessageCopy.setAttribute('aria-label', '完整消息已复制')
      if (longMessageCopyTimer) clearTimeout(longMessageCopyTimer)
      longMessageCopyTimer = setTimeout(() => {
        if (copySequence !== longMessageCopySequence) return
        longMessageCopyTimer = null
        longMessageCopy.classList.remove('is-copied')
        if (label) label.textContent = '复制'
        longMessageCopy.setAttribute('aria-label', '复制完整消息')
      }, 1500)
    } catch (error) {
      console.warn('Long-message copy failed:', error.message)
      showStatus('复制失败，请稍后再试', 'error', 2200)
    }
  })

  longMessageBody.addEventListener('scroll', updateLongMessageOverflowState, { passive: true })
  longMessageReader.addEventListener('animationend', scheduleLongMessageMeasurement)

  window.petAPI.onPetWindowLayoutChanged(layout => {
    if (longMessageState.open && layout && layout.expanded === false) {
      closeLongMessageReader({ hostLayout: layout, dismissBubble: true })
      return
    }
    applyPetWindowLayout(layout)
  })

  window.petAPI.onSettingsPetBackgroundCapture(active => {
    const next = Boolean(active)
    if (state.settingsBackgroundCaptureActive === next) return
    state.settingsBackgroundCaptureActive = next
    state.settingsBackgroundLastFrameAt = 0
    state.settingsBackgroundErrorReported = false
    if (!next) releaseSettingsBackgroundFrame()
    syncVisibility(state.hostVisible)
    if (next) ensureScheduler()
  })

  window.petAPI.onSettingsPetBackgroundFrameAck(sequence => {
    const normalized = Number(sequence)
    if (!Number.isSafeInteger(normalized) || normalized <= 0) return
    releaseSettingsBackgroundFrame(normalized)
  })

  document.getElementById('ai-chat-close').addEventListener('click', () => setChatOpen(false))
  chatToggle.addEventListener('click', () => {
    setChatCollapsed(!chatCollapsed)
    chatInput.focus()
  })
  chatMute.addEventListener('click', () => {
    if (chatMuted) {
      const availability = chatCapabilityAvailability('tts')
      if (!availability.ready) {
        showStatus(
          availability.configured
            ? '语音模型尚未启用，请先启用语音模型'
            : '请先配置语音模型',
          'info',
          3200
        )
        return
      }
    }
    setChatMuted(!chatMuted)
  })
  document.getElementById('ai-chat-clear').addEventListener('click', async () => {
    stopCurrentSpeech()
    chatHistoryRestoreSequence++
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

  async function centeredCoverDataURL(sourceCanvas, fitVisibleContent = false) {
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
      let opaquePixels = 0

      for (let y = 0; y < scanCanvas.height; y++) {
        for (let x = 0; x < scanCanvas.width; x++) {
          if (pixels[(y * scanCanvas.width + x) * 4 + 3] <= 8) continue
          opaquePixels++
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
        }
      }
      if (opaquePixels < 24 || maxX < minX || maxY < minY) return null

      const contentWidth = maxX - minX + 1
      const contentHeight = maxY - minY + 1
      const paddingRatio = fitVisibleContent ? 0.1 : 0
      const availableWidth = scanCanvas.width * (1 - paddingRatio * 2)
      const availableHeight = scanCanvas.height * (1 - paddingRatio * 2)
      const contentScale = fitVisibleContent
        ? Math.min(availableWidth / contentWidth, availableHeight / contentHeight)
        : 1
      const targetWidth = Math.round(contentWidth * contentScale)
      const targetHeight = Math.round(contentHeight * contentScale)
      const targetX = Math.round((scanCanvas.width - targetWidth) / 2)
      const targetY = Math.round((scanCanvas.height - targetHeight) / 2)
      const outputCanvas = document.createElement('canvas')
      outputCanvas.width = scanCanvas.width
      outputCanvas.height = scanCanvas.height
      outputCanvas.getContext('2d').drawImage(
        scanCanvas,
        minX, minY, contentWidth, contentHeight,
        targetX, targetY, targetWidth, targetHeight
      )
      return outputCanvas.toDataURL('image/png')
    } catch (error) {
      console.warn('Cover centering failed:', error.message)
      return null
    }
  }

  async function waitForVisibleCoverFrame(model, canvas) {
    // WebGL textures may need several compositor turns after load(),
    // especially on a new profile while all ZIP models are cold. Never cache
    // the first transparent frame: it would make the model card look empty on
    // every later launch.
    for (let attempt = 0; attempt < 18; attempt++) {
      model.update()
      if (visibleCanvasBounds(canvas)) return true
      await new Promise(resolve => requestAnimationFrame(resolve))
    }
    return false
  }

  async function renderModelCover(item) {
    const canvas = document.createElement('canvas')
    canvas.className = 'cover-render-canvas'
    canvas.width = 220
    canvas.height = 280
    canvas.style.width = '220px'
    canvas.style.height = '280px'
    canvas.style.opacity = '0'
    canvas.style.pointerEvents = 'none'
    canvas.style.zIndex = '-1'
    stage.appendChild(canvas)
    const model = createModelInstance(canvas, item)
    try {
      await model.load(item.path)
      model.touchController.cancelInteractions()
      model.cameraController.removeListeners()
      model.paused = false
      model.scale = 1
      model.centerModel()
      if (!await waitForVisibleCoverFrame(model, canvas)) {
        throw new Error('模型首帧保持透明，未写入封面缓存')
      }
      // A video frame is landscape and contains generous transparent margins;
      // fit its visible alpha bounds into the portrait cover instead of
      // shrinking the whole 16:9 frame into the role card.
      const dataURL = await centeredCoverDataURL(canvas, model.kind === 'video-pet')
      if (!dataURL) throw new Error('模型封面没有可见像素')

      // The role-card cover above may crop and enlarge visible content. Render a
      // separate 240x360 baseline frame for the settings background so switching
      // between cached and live modes preserves the pet's on-screen size.
      canvas.width = SETTINGS_BACKGROUND_WIDTH
      canvas.height = SETTINGS_BACKGROUND_HEIGHT
      canvas.style.width = `${SETTINGS_BACKGROUND_WIDTH}px`
      canvas.style.height = `${SETTINGS_BACKGROUND_HEIGHT}px`
      model.needsResize = true
      model.centerModel()
      if (!await waitForVisibleCoverFrame(model, canvas)) {
        throw new Error('设置页静态背景首帧保持透明，未写入缓存')
      }
      const staticBackgroundDataURL = canvas.toDataURL('image/png')
      window.petAPI.saveCover(item.id, dataURL, staticBackgroundDataURL)
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
    const queuedIds = new Set(coverQueue.map(item => item.id))
    coverQueue.push(...missing.filter(item => item && item.id && !queuedIds.has(item.id)))
    processCoverQueue()
  })

  window.petAPI.onStateChanged(payload => {
    if (payload && payload.snapshot) applySnapshot(payload.snapshot)
  })

  document.addEventListener('visibilitychange', () => {
    if (state.hostVisible) ensureScheduler()
  })

  window.addEventListener('resize', () => {
    const viewport = petViewportSize()
    const viewportChanged = viewport.width !== lastViewportSize.width || viewport.height !== lastViewportSize.height
    if (viewportChanged) {
      lastViewportSize = viewport
      resizeEffectsCanvas()
    }
    if (viewportChanged && state.model && state.model.loaded) {
      state.model.needsResize = true
      state.hitMaskPending = true
    }
    if (longMessageState.open) scheduleLongMessageMeasurement()
  })

  // 观察聊天框的真实尺寸，覆盖主题切换、展开动画和系统字体变化。
  // updateChatPosition 只改变 top，不改变尺寸，因此不会形成观察循环。
  if (typeof ResizeObserver === 'function') {
    const chatPanelResizeObserver = new ResizeObserver(() => {
      if (!chatPanel.hidden) updateChatPosition()
    })
    chatPanelResizeObserver.observe(chatPanel)
    const longMessageResizeObserver = new ResizeObserver(() => scheduleLongMessageMeasurement())
    longMessageResizeObserver.observe(longMessageReader)
  }

  resizeEffectsCanvas()
  lastViewportSize = petViewportSize()
  try {
    const snapshot = await window.petAPI.getSnapshot()
    applySnapshot(snapshot)
    if (!snapshot.models.some(model => model.status === 'ready')) {
      showStatus('没有找到可用的角色模型', 'error')
      reportStatus('empty', '', '没有找到可用的角色模型')
    }
  } catch (error) {
    console.error('App initialization failed:', error)
    showStatus('启动失败，请从托盘退出后重试', 'error')
    reportStatus('error', '', '应用初始化失败')
  }
})()
