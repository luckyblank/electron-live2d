(function () {
  const api = window.settingsAPI
  const captureRenderOnly = new URLSearchParams(window.location.search).get('capture') === '1'
  const MODEL_SCALE_MIN = 0.1
  const MODEL_SCALE_MAX = 2
  const MODEL_OPACITY_MIN = 0.1
  const MODEL_OPACITY_MAX = 1
  const elements = {
    titlebar: document.querySelector('.titlebar'),
    currentModelName: document.getElementById('current-model-name'),
    currentModelNameText: document.getElementById('current-model-name-text'),
    currentModelSource: document.getElementById('current-model-source'),
    heroModelScript: document.getElementById('hero-model-script'),
    runtimeStatus: document.getElementById('runtime-status'),
    companionChatStatus: document.getElementById('companion-chat-status'),
    companionVoiceStatus: document.getElementById('companion-voice-status'),
    companionPresets: document.getElementById('companion-presets'),
    modelCount: document.getElementById('model-count'),
    modelReveal: document.getElementById('reveal-selected-model'),
    modelList: document.getElementById('model-list'),
    modelNext: document.getElementById('model-next'),
    modelPagination: document.getElementById('model-pagination'),
    scaleRange: document.getElementById('scale-range'),
    scaleValue: document.getElementById('scale-value'),
    scaleApplyAll: document.getElementById('scale-apply-all'),
    opacityRange: document.getElementById('opacity-range'),
    opacityValue: document.getElementById('opacity-value'),
    opacityApplyAll: document.getElementById('opacity-apply-all'),
    modelNickname: document.getElementById('model-nickname'),
    characterProfile: document.getElementById('character-profile'),
    characterProfileToggle: document.getElementById('character-profile-toggle'),
    characterProfileBody: document.getElementById('character-profile-body'),
    profileBasicDisplay: document.getElementById('profile-basic-display'),
    profileBasicForm: document.getElementById('profile-basic-form'),
    profilePortrait: document.getElementById('profile-portrait'),
    profilePortraitName: document.getElementById('profile-portrait-name'),
    profilePortraitNickname: document.getElementById('profile-portrait-nickname'),
    profileCharacterName: document.getElementById('profile-character-name'),
    profileSpecies: document.getElementById('profile-species'),
    profileAge: document.getElementById('profile-age'),
    profileHeight: document.getElementById('profile-height'),
    profilePersonality: document.getElementById('profile-personality'),
    profileLikes: document.getElementById('profile-likes'),
    profileBio: document.getElementById('profile-bio'),
    profileActionPreview: document.getElementById('profile-action-preview'),
    profileExpressionPreview: document.getElementById('profile-expression-preview'),
    profileActionCount: document.getElementById('profile-action-count'),
    profileExpressionCount: document.getElementById('profile-expression-count'),
    profileActionLibrary: document.getElementById('profile-action-library'),
    profileExpressionLibrary: document.getElementById('profile-expression-library'),
    profileWorldForm: document.getElementById('profile-world-form'),
    modelInteractionsForm: document.getElementById('model-interactions-form'),
    modelInteractionsList: document.getElementById('model-interactions-list'),
    modelInteractionsCount: document.getElementById('model-interactions-count'),
    modelInteractionsEmpty: document.getElementById('model-interactions-empty'),
    modelInteractionAdd: document.getElementById('model-interaction-add'),
    modelInteractionsReset: document.getElementById('model-interactions-reset'),
    modelInteractionsSummaryCount: document.getElementById('model-interactions-summary-count'),
    modelGesturesForm: document.getElementById('model-gestures-form'),
    modelGesturesList: document.getElementById('model-gestures-list'),
    modelGesturesCount: document.getElementById('model-gestures-count'),
    modelGesturesReset: document.getElementById('model-gestures-reset'),
    modelGesturesSummaryCount: document.getElementById('model-gestures-summary-count'),
    qualityDescription: document.getElementById('quality-description'),
    shortcutList: document.getElementById('shortcut-list'),
    shortcutReset: document.getElementById('shortcut-reset'),
    shortcutAdd: document.getElementById('shortcut-add'),
    shortcutDialog: document.getElementById('shortcut-dialog'),
    shortcutDialogTitle: document.getElementById('shortcut-dialog-title'),
    shortcutActionField: document.getElementById('shortcut-action-field'),
    shortcutAction: document.getElementById('shortcut-action'),
    shortcutCapture: document.getElementById('shortcut-capture'),
    shortcutCaptureHint: document.getElementById('shortcut-capture-hint'),
    shortcutDelete: document.getElementById('shortcut-delete'),
    shortcutDialogClose: document.getElementById('shortcut-dialog-close'),
    shortcutDialogCancel: document.getElementById('shortcut-dialog-cancel'),
    shortcutDialogSave: document.getElementById('shortcut-dialog-save'),
    appVersion: document.getElementById('app-version'),
    modelsFolderPath: document.getElementById('models-folder-path'),
    pluginsFolderPath: document.getElementById('plugins-folder-path'),
    updateStatus: document.getElementById('update-status'),
    updateDot: document.getElementById('update-dot'),
    footerUpdate: document.getElementById('footer-update'),
    aiChatPluginList: document.getElementById('ai-chat-plugin-list'),
    aiTtsPluginList: document.getElementById('ai-tts-plugin-list'),
    aiChatActive: document.getElementById('ai-chat-active'),
    aiTtsActive: document.getElementById('ai-tts-active'),
    chatGreeting: document.getElementById('chat-greeting'),
    chatGreetingCount: document.getElementById('chat-greeting-count'),
    chatGreetingPresets: document.getElementById('chat-greeting-presets'),
    bubbleStyleCustomizer: document.getElementById('bubble-style-customizer'),
    bubbleStyleDescription: document.getElementById('bubble-style-description'),
    bubbleStyleOptions: document.getElementById('bubble-style-options'),
    bubbleStylePrevious: document.getElementById('bubble-style-previous'),
    bubbleStyleNext: document.getElementById('bubble-style-next'),
    bubbleStylePagination: document.getElementById('bubble-style-pagination'),
    bubblePreviewAvatar: document.getElementById('bubble-preview-avatar'),
    bubbleLivePreviewSlot: document.getElementById('bubble-live-preview-slot'),
    bubblePreviewNote: document.getElementById('bubble-preview-note'),
    longMessageCharacterThreshold: document.getElementById('long-message-character-threshold'),
    aiConfigTemplate: document.getElementById('ai-config-panel-template'),
    petBackground: document.getElementById('settings-pet-background'),
    petBackgroundCanvas: document.getElementById('settings-pet-background-canvas'),
    externalMessageService: document.getElementById('external-message-service'),
    externalMessageServiceStatus: document.getElementById('external-message-service-status'),
    externalMessageHttpUrl: document.getElementById('external-message-http-url'),
    externalMessageWebsocketUrl: document.getElementById('external-message-websocket-url'),
    externalMessageTesterTarget: document.getElementById('external-message-tester-target'),
    externalMessageOpenTester: document.getElementById('external-message-open-tester'),
    toast: document.getElementById('toast'),
  }

  function bindManualWindowDrag(region, windowAPI) {
    if (
      !region || !windowAPI ||
      typeof windowAPI.startWindowDrag !== 'function' ||
      typeof windowAPI.moveWindowDrag !== 'function' ||
      typeof windowAPI.endWindowDrag !== 'function'
    ) return

    let activePointerId = null
    const interactiveSelector = 'button, a, input, textarea, select, [contenteditable="true"], [role="button"]'
    const finishDrag = event => {
      if (activePointerId === null) return
      if (event && Number.isInteger(event.pointerId) && event.pointerId !== activePointerId) return
      const pointerId = activePointerId
      activePointerId = null
      region.classList.remove('is-window-dragging')
      try {
        if (region.hasPointerCapture(pointerId)) region.releasePointerCapture(pointerId)
      } catch (error) {}
      windowAPI.endWindowDrag()
    }

    region.addEventListener('pointerdown', event => {
      if (activePointerId !== null || event.isPrimary === false || event.button !== 0) return
      if (event.target.closest(interactiveSelector)) return
      event.preventDefault()
      activePointerId = event.pointerId
      region.classList.add('is-window-dragging')
      try { region.setPointerCapture(event.pointerId) } catch (error) {}
      windowAPI.startWindowDrag(event.screenX, event.screenY)
    })
    window.addEventListener('pointermove', event => {
      if (event.pointerId !== activePointerId) return
      if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) {
        finishDrag(event)
        return
      }
      event.preventDefault()
      windowAPI.moveWindowDrag(event.screenX, event.screenY)
    }, { passive: false })
    window.addEventListener('pointerup', finishDrag)
    window.addEventListener('pointercancel', finishDrag)
    window.addEventListener('blur', () => finishDrag())
  }

  if (!captureRenderOnly) bindManualWindowDrag(elements.titlebar, api)
  const externalMessageTesterTargetPicker = window.SearchSelect.enhance(
    elements.externalMessageTesterTarget,
    {
      searchable: false,
      density: 'compact',
      minMenuWidth: 136,
      maxMenuHeight: 96,
      showTriggerSecondary: false,
      showOptionSecondary: false,
    }
  )
  const shortcutActionPicker = window.SearchSelect.enhance(
    elements.shortcutAction,
    {
      searchable: false,
      density: 'regular',
      minMenuWidth: 240,
      maxMenuHeight: 260,
      showTriggerSecondary: false,
      showOptionSecondary: false,
    }
  )

  const qualityDescriptions = {
    auto: '互动时保持流畅，闲置后自动降低资源占用。',
    eco: '限制为 30fps，并减少附加效果与后台刷新。',
    high: '持续保持高刷新率，适合性能充足的设备。',
  }

  const fallbackBubbleStyleCatalog = {
    glass: {
      fallback: 'glass',
      styles: [
        { id: 'glass', name: '玻璃气泡', shortDescription: '清透柔光' },
        { id: 'sweet', name: '甜美气泡', shortDescription: '爱心柔光' },
        { id: 'pixel', name: '像素气泡', shortDescription: '复古像素' },
        { id: 'sci-fi', name: '科幻气泡', shortDescription: '未来 HUD' },
      ],
    },
    healing: {
      fallback: 'glass',
      styles: [
        { id: 'glass', name: '玻璃气泡', shortDescription: '柔粉玻璃' },
        { id: 'sweet', name: '甜美气泡', shortDescription: '爱心蝴蝶结' },
        { id: 'pixel', name: '像素气泡', shortDescription: '粉色像素' },
        { id: 'sci-fi', name: '科幻气泡', shortDescription: '柔光 HUD' },
      ],
    },
  }

  const companionPresets = {
    quiet: {
      label: '安静陪伴',
      preferences: { cursorFollow: 'off', effects: 'off', idleEnabled: true, qualityMode: 'auto' },
    },
    natural: {
      label: '自然互动',
      preferences: { cursorFollow: 'near', effects: 'subtle', idleEnabled: false, qualityMode: 'auto' },
    },
    eco: {
      label: '省电陪伴',
      preferences: { cursorFollow: 'off', effects: 'off', idleEnabled: true, qualityMode: 'eco' },
    },
  }

  const fallbackModelInteractions = [
    { id: 'greet', label: '打个招呼', kind: 'greet', text: '你好呀～', actionId: '', enabled: true, isDefault: true, defaultLabel: '打个招呼', defaultText: '你好呀～', defaultMapping: '问候 / 挥手动作' },
    { id: 'head', label: '摸摸头', kind: 'head', text: '好舒服～', actionId: '', enabled: true, isDefault: true, defaultLabel: '摸摸头', defaultText: '好舒服～', defaultMapping: '摸头动作' },
    { id: 'praise', label: '夸夸她', kind: 'praise', text: '被夸奖了 ✦', actionId: '', enabled: true, isDefault: true, defaultLabel: '夸夸她', defaultText: '被夸奖了 ✦', defaultMapping: '开心 / 夸奖动作' },
    { id: 'snack', label: '投喂点心', kind: 'snack', text: '好吃！', actionId: '', enabled: true, isDefault: true, defaultLabel: '投喂点心', defaultText: '好吃！', defaultMapping: '投喂动作' },
    { id: 'random', label: '随机互动', kind: 'random', text: '来和我玩吧～', actionId: '', enabled: true, isDefault: true, defaultLabel: '随机互动', defaultText: '来和我玩吧～', defaultMapping: '随机选择可用互动' },
  ]
  const fallbackModelGestures = [
    { id: 'tap-head', label: '单击头部', kind: 'head', actionId: '', text: '好舒服～', enabled: true, defaultMapping: '摸头动作' },
    { id: 'tap-body', label: '单击身体', kind: 'tap', actionId: '', text: '碰到我啦～', enabled: true, defaultMapping: '点击回应动作' },
    { id: 'double-click', label: '连续双击', kind: 'praise', actionId: '', text: '被夸奖了 ✦', enabled: true, defaultMapping: '开心 / 夸奖动作' },
    { id: 'triple-click', label: '连续三击', kind: 'excited', actionId: '', text: '最喜欢你啦！', enabled: true, defaultMapping: '兴奋 / 开心动作' },
    { id: 'long-press-head', label: '长按头部', kind: 'head', actionId: '', text: '再摸一下嘛', enabled: true, defaultMapping: '摸头动作' },
    { id: 'long-press-body', label: '长按身体', kind: 'calm', actionId: '', text: '让我靠一会儿', enabled: true, defaultMapping: '休息 / 安静动作' },
    { id: 'drag-end', label: '拖拽结束', kind: 'drag', actionId: '', text: '新位置不错', enabled: true, defaultMapping: '拖拽动作' },
  ]
  const gestureIconMarkup = {
    'tap-head': '<svg viewBox="0 0 24 24"><rect x="6" y="2.5" width="12" height="19" rx="6"/><path d="M12 2.5v6m-6 1h12"/></svg>',
    'tap-body': '<svg viewBox="0 0 24 24"><rect x="6" y="2.5" width="12" height="19" rx="6"/><path d="M12 2.5v6m-6 1h12"/><circle cx="12" cy="13.5" r="1.2"/></svg>',
    'double-click': '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.2-7-10a3.8 3.8 0 0 1 7-2.1A3.8 3.8 0 0 1 19 10c0 5.8-7 10-7 10Z"/><path d="m18.5 3 .5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5Z"/></svg>',
    'triple-click': '<svg viewBox="0 0 24 24"><path d="m12 2 1.4 5.6L19 9l-5.6 1.4L12 16l-1.4-5.6L5 9l5.6-1.4Z"/><path d="m18 15 .7 2.3L21 18l-2.3.7L18 21l-.7-2.3L15 18l2.3-.7Z"/></svg>',
    'long-press-head': '<svg viewBox="0 0 24 24"><rect x="6" y="2.5" width="12" height="19" rx="6"/><path d="M12 2.5v6m-6 1h12"/><path d="M9.5 15.5h5"/></svg>',
    'long-press-body': '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/><path d="M5 4 3 6m16-2 2 2"/></svg>',
    'drag-end': '<svg viewBox="0 0 24 24"><path d="m9 15-2 2a3 3 0 0 0 4 4l3-3a3 3 0 0 0 0-4m1-5 2-2a3 3 0 0 0-4-4l-3 3a3 3 0 0 0 0 4m-2 2 10-10"/></svg>',
  }

  let snapshot = null
  let scaleSaveTimer = null
  let pendingScaleSave = null
  let scaleSavePromise = null
  let opacitySaveTimer = null
  let pendingOpacitySave = null
  let opacitySavePromise = null
  let toastTimer = null
  let modelSliderPointerId = null
  let modelSliderStartX = 0
  let modelSliderStartY = 0
  let modelSliderStartScrollLeft = 0
  let modelSliderAxis = ''
  let modelSliderMoved = false
  let suppressModelClickUntil = 0
  let modelPaginationFrame = 0
  let renderedModelListKey = ''
  let sortingModelId = ''
  let sortingInteractionId = ''
  let profilePanelCollapsed = false
  let activeProfileTab = 'basic'
  let profileEditingModelId = ''
  const selectedProfileAssets = new Map()
  const profilePreviewFrames = new Map()
  const profilePreviewTimers = { action: null, expression: null }
  let profileSliderDrag = null
  let suppressProfileClickUntil = 0
  let petBackgroundFrameQueue = null
  let petBackgroundFrameBusy = false
  let petBackgroundFrameSequence = 0
  let shortcutEditor = null
  const petBackgroundProbeCanvas = document.createElement('canvas')
  petBackgroundProbeCanvas.width = 24
  petBackgroundProbeCanvas.height = 36

  function renderHeroModelName(value) {
    const displayName = String(value || '暂无角色').trim() || '暂无角色'
    const hasCjk = /[\u3400-\u9fff\uf900-\ufaff]/u.test(displayName)
    const visualUnits = Array.from(displayName).reduce((total, character) => (
      total + (/[\u3400-\u9fff\uf900-\ufaff]/u.test(character) ? 2 : /[A-Z]/.test(character) ? 1.15 : 1)
    ), 0)
    const nameChanged = elements.currentModelNameText.textContent !== displayName

    elements.currentModelName.classList.toggle('is-cjk', hasCjk)
    elements.currentModelName.classList.toggle('is-latin', !hasCjk)
    elements.currentModelName.classList.toggle('is-compact', visualUnits > 11)
    elements.currentModelName.classList.toggle('is-long', visualUnits > 17)
    elements.currentModelName.lang = hasCjk ? 'zh-CN' : 'en'
    elements.currentModelName.title = displayName
    elements.currentModelNameText.textContent = displayName

    if (nameChanged) {
      elements.currentModelName.classList.remove('is-name-entering')
      requestAnimationFrame(() => elements.currentModelName.classList.add('is-name-entering'))
    }
  }
  // 文本 / 语音两组各持有一份配置面板实例（aiPanels.chat / aiPanels.tts），
  // 点击「配置」只展开本组面板，另一组的展开/折叠状态不受影响；
  // 同一分组内面板随卡片迁移，始终只展开一个。
  const aiPanels = {}

  // 内置音色额外补充拼音与首字母检索词。第三方插件仍可按中文名和音色 ID
  // 模糊搜索；这里的别名只是让现有两组内置音色更符合中文用户的输入习惯。
  const voiceSearchAliases = Object.freeze({
    cherry: 'qian yue qianyue qy',
    serena: 'su yao suyao sy',
    ethan: 'chen xu chenxu cx',
    chelsie: 'qian xue qianxue qx',
    momo: 'mo tu motu mt',
    vivian: 'shi san shisan ss',
    moon: 'yue bai yuebai yb',
    maia: 'si yue siyue sy',
    kai: 'kai k',
    nofish: 'bu chi yu buchiyu bcy',
    bella: 'meng bao mengbao mb',
    jennifer: 'zhan ni fu zhannifu znf',
    ryan: 'tian cha tiancha tc',
    katerina: 'ka jie lin na kajielinna kjln',
    aiden: 'ai deng aideng ad',
    'eldric sage': 'cang ming zi cangmingzi cmz',
    mia: 'guai xiao mei guaixiaomei gxm',
    mochi: 'sha xiao mi shaxiaomi sxm',
    bellona: 'yan zheng ying yanzhengying yzy',
    vincent: 'tian shu tianshu ts',
    bunny: 'meng xiao ji mengxiaoji mxj',
    neil: 'a wen awen aw',
    elias: 'mo jiang shi mojiangshi mjs',
    arthur: 'xu da ye xudaye xdy',
    nini: 'lin jia mei mei linjiameimei ljmm',
    seren: 'xiao wan xiaowan xw',
    pip: 'wan pi xiao hai wanpixiaohai wpxh',
    stella: 'shao nv a yue shaonvayue snay',
    bodega: 'bo de jia bodejia bdj',
    sonrisa: 'suo ni sha suonisha sns',
    alek: 'a lie ke alieke alk',
    dolce: 'duo er qie duoerqie deq',
    sohee: 'su xi suxi sx',
    'ono anna': 'xiao ye xing xiaoyexing xyx',
    lenn: 'lai en laien le',
    emilien: 'ai mi er an aimieran aima',
    andre: 'an de lei andele adl',
    'radio gol': 'la di ao ge er ladio geer ldge',
    jada: 'shang hai a zhen shanghai azhen sh az',
    dylan: 'bei jing xiao dong beijing xiaodong bj xd',
    li: 'nan jing lao li nanjing laoli nj ll',
    marcus: 'shan xi qin chuan shaanxi qinchuan sx qc',
    roy: 'min nan a jie minnan ajie mn aj',
    peter: 'tian jin li bi de tianjin libide tj lbd',
    sunny: 'si chuan qing er sichuan qinger sc qe',
    eric: 'si chuan cheng chuan sichuan chengchuan sc cc',
    rocky: 'yue yu a qiang yueyu aqiang yy aq',
    kiki: 'yue yu a qing yueyu aqing yy aq',
    tongtong: 'tong tong tt',
    chuichui: 'chui chui cc',
    xiaochen: 'xiao chen xc',
    jam: 'dong dong dong wu quan dongdongdongwuquan dddwq',
    kazi: 'dong dong dong wu quan dongdongdongwuquan dddwq',
    douji: 'dong dong dong wu quan dongdongdongwuquan dddwq',
    luodo: 'dong dong dong wu quan dongdongdongwuquan dddwq',
  })

  function clearPetBackgroundFrame() {
    petBackgroundFrameSequence++
    petBackgroundFrameQueue = null
    const context = elements.petBackgroundCanvas.getContext('2d')
    context.clearRect(0, 0, elements.petBackgroundCanvas.width, elements.petBackgroundCanvas.height)
    elements.petBackground.classList.remove('is-ready', 'is-video-pet', 'is-static')
    delete elements.petBackground.dataset.modelId
    delete elements.petBackground.dataset.modelFormat
    delete elements.petBackground.dataset.backgroundMode
    delete elements.petBackground.dataset.backgroundSource
  }

  const LONG_MESSAGE_CHARACTER_THRESHOLD_MIN = 10
  const LONG_MESSAGE_CHARACTER_THRESHOLD_MAX = 500
  const DEFAULT_LONG_MESSAGE_CHARACTER_THRESHOLD = 45

  function normalizeLongMessageCharacterThreshold(value, fallback = DEFAULT_LONG_MESSAGE_CHARACTER_THRESHOLD) {
    const numericValue = typeof value === 'string' && !value.trim() ? Number.NaN : Number(value)
    const fallbackValue = Number(fallback)
    const normalized = Number.isFinite(numericValue)
      ? Math.round(numericValue)
      : Number.isFinite(fallbackValue) ? Math.round(fallbackValue) : DEFAULT_LONG_MESSAGE_CHARACTER_THRESHOLD
    return Math.min(
      LONG_MESSAGE_CHARACTER_THRESHOLD_MAX,
      Math.max(LONG_MESSAGE_CHARACTER_THRESHOLD_MIN, normalized)
    )
  }

  function renderStaticPetBackground() {
    const current = snapshot && snapshot.models.find(model => model.id === snapshot.currentModelId)
    const staticBackgroundUrl = current && snapshot.staticPetBackgrounds
      ? snapshot.staticPetBackgrounds[current.id]
      : ''
    const fallbackCoverUrl = current && snapshot.covers ? snapshot.covers[current.id] : ''
    const imageUrl = staticBackgroundUrl || fallbackCoverUrl
    if (!current || !imageUrl) {
      clearPetBackgroundFrame()
      return
    }

    const sequence = ++petBackgroundFrameSequence
    petBackgroundFrameQueue = null
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      if (
        sequence !== petBackgroundFrameSequence || !snapshot ||
        snapshot.currentModelId !== current.id || !image.naturalWidth || !image.naturalHeight
      ) return
      const canvas = elements.petBackgroundCanvas
      const context = canvas.getContext('2d')
      const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight)
      const width = image.naturalWidth * scale
      const height = image.naturalHeight * scale
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
      elements.petBackground.dataset.modelId = current.id
      elements.petBackground.dataset.modelFormat = current.format || ''
      elements.petBackground.dataset.backgroundMode = 'static'
      elements.petBackground.dataset.backgroundSource = imageUrl
      elements.petBackground.classList.toggle('is-video-pet', current.format === 'video-pet')
      elements.petBackground.classList.add('is-static', 'is-ready')
    }
    image.onerror = () => {
      if (sequence === petBackgroundFrameSequence) clearPetBackgroundFrame()
    }
    image.src = imageUrl
  }

  function petBackgroundFrameHasVisiblePixels(bitmap) {
    const context = petBackgroundProbeCanvas.getContext('2d', { alpha: true, willReadFrequently: true })
    context.clearRect(0, 0, petBackgroundProbeCanvas.width, petBackgroundProbeCanvas.height)
    context.drawImage(bitmap, 0, 0, petBackgroundProbeCanvas.width, petBackgroundProbeCanvas.height)
    const pixels = context.getImageData(0, 0, petBackgroundProbeCanvas.width, petBackgroundProbeCanvas.height).data
    let visiblePixels = 0
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 8 && ++visiblePixels >= 3) return true
    }
    return false
  }

  async function drawQueuedPetBackgroundFrames() {
    if (petBackgroundFrameBusy) return
    petBackgroundFrameBusy = true
    try {
      while (petBackgroundFrameQueue) {
        const queued = petBackgroundFrameQueue
        petBackgroundFrameQueue = null
        let bitmap = null
        try {
          bitmap = await createImageBitmap(new Blob([queued.frame], { type: 'image/webp' }))
          if (
            queued.sequence === petBackgroundFrameSequence && snapshot &&
            queued.modelId === snapshot.currentModelId && snapshot.preferences.settingsPetBackground &&
            petBackgroundFrameHasVisiblePixels(bitmap)
          ) {
            const canvas = elements.petBackgroundCanvas
            const context = canvas.getContext('2d')
            context.clearRect(0, 0, canvas.width, canvas.height)
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
            elements.petBackground.dataset.modelId = queued.modelId
            elements.petBackground.dataset.modelFormat = queued.format || ''
            elements.petBackground.dataset.backgroundMode = 'dynamic'
            delete elements.petBackground.dataset.backgroundSource
            elements.petBackground.classList.toggle('is-video-pet', queued.format === 'video-pet')
            elements.petBackground.classList.remove('is-static')
            elements.petBackground.classList.add('is-ready')
          }
        } catch (error) {
          console.warn('Pet background frame decode failed:', error.message)
        } finally {
          if (bitmap) bitmap.close()
          api.acknowledgePetBackgroundFrame(queued.deliverySequence)
        }
      }
    } finally {
      petBackgroundFrameBusy = false
      if (petBackgroundFrameQueue) drawQueuedPetBackgroundFrames()
    }
  }

  function queuePetBackgroundFrame(payload) {
    if (payload === null) {
      if (snapshot && snapshot.currentModelId) renderStaticPetBackground()
      else clearPetBackgroundFrame()
      return
    }
    if (!snapshot || !snapshot.preferences.settingsPetBackground) {
      const sequence = payload && Number(payload.sequence)
      if (Number.isSafeInteger(sequence) && sequence > 0) api.acknowledgePetBackgroundFrame(sequence)
      if (
        snapshot && snapshot.currentModelId &&
        (elements.petBackground.dataset.modelId !== snapshot.currentModelId ||
          elements.petBackground.dataset.backgroundMode !== 'static')
      ) renderStaticPetBackground()
      return
    }
    if (
      !payload || typeof payload !== 'object' || !payload.frame ||
      typeof payload.modelId !== 'string' || payload.modelId !== snapshot.currentModelId ||
      !Number.isSafeInteger(Number(payload.sequence)) || Number(payload.sequence) <= 0
    ) {
      if (payload && Number.isSafeInteger(Number(payload.sequence))) {
        api.acknowledgePetBackgroundFrame(Number(payload.sequence))
      }
      return
    }
    const sequence = ++petBackgroundFrameSequence
    petBackgroundFrameQueue = {
      frame: payload.frame,
      format: payload.format,
      modelId: payload.modelId,
      sequence,
      deliverySequence: Number(payload.sequence),
    }
    drawQueuedPetBackgroundFrames()
  }

  function closeVoicePicker(ctx, restoreFocus = false) {
    if (ctx && ctx.voiceSelect) ctx.voiceSelect.close(restoreFocus)
  }

  function setVoiceCatalog(ctx, voices, preferredVoiceId) {
    ctx.voiceCatalog = Array.isArray(voices) ? voices : []
    const selectedId = ctx.voiceCatalog.some(voice => voice.id === preferredVoiceId)
      ? preferredVoiceId
      : (ctx.voiceCatalog[0] ? ctx.voiceCatalog[0].id : '')
    ctx.els['ai-voice'].replaceChildren(...ctx.voiceCatalog.map(voice => {
      const option = document.createElement('option')
      option.value = voice.id
      option.textContent = voice.name
      option.dataset.primary = voice.name
      option.dataset.secondary = voice.id
      option.dataset.search = voiceSearchAliases[String(voice.id || '').toLocaleLowerCase('en-US')] || ''
      return option
    }))
    ctx.els['ai-voice'].value = selectedId
    ctx.voiceSelect.refresh()
    closeVoicePicker(ctx)
  }

  function resetVoicePreview(ctx) {
    if (ctx.previewAudio) {
      ctx.previewAudio.pause()
      try { ctx.previewAudio.currentTime = 0 } catch (error) { /* 尚未加载完成 */ }
    }
    ctx.previewAudio = null
    ctx.previewUrl = ''
    ctx.els['ai-voice-preview'].classList.remove('is-playing')
    ctx.els['ai-voice-preview'].setAttribute('aria-label', '试听当前音色')
    ctx.els['ai-voice-preview'].title = '试听当前音色'
    ctx.els['ai-voice-preview-label'].textContent = '试听'
  }

  function currentVoicePreviewUrl(ctx) {
    const plugin = snapshot && snapshot.ai && snapshot.ai.plugins.find(item => item.id === ctx.editingPluginId)
    const voiceId = ctx.els['ai-voice'].value
    const voice = plugin && plugin.voices.find(item => item.id === voiceId)
    return voice && voice.previewUrl ? voice.previewUrl : ''
  }

  function updateVoicePreviewAvailability(ctx) {
    const available = Boolean(currentVoicePreviewUrl(ctx))
    ctx.els['ai-voice-preview'].disabled = !available
    if (!available) {
      ctx.els['ai-voice-preview'].setAttribute('aria-label', '当前音色暂无试听')
      ctx.els['ai-voice-preview'].title = '当前音色暂无试听'
    }
  }

  async function toggleVoicePreview(ctx) {
    const url = currentVoicePreviewUrl(ctx)
    if (!url) {
      showToast('当前音色没有可用的试听音频')
      return
    }
    if (ctx.previewAudio && ctx.previewUrl === url) {
      resetVoicePreview(ctx)
      return
    }

    resetVoicePreview(ctx)
    const audio = new Audio(url)
    ctx.previewAudio = audio
    ctx.previewUrl = url
    ctx.els['ai-voice-preview'].classList.add('is-playing')
    ctx.els['ai-voice-preview'].setAttribute('aria-label', '停止试听')
    ctx.els['ai-voice-preview'].title = '停止试听'
    ctx.els['ai-voice-preview-label'].textContent = '停止'
    audio.addEventListener('ended', () => resetVoicePreview(ctx), { once: true })
    audio.addEventListener('error', () => {
      if (ctx.previewAudio !== audio) return
      resetVoicePreview(ctx)
      showToast('试听音频加载失败，请检查网络连接')
    }, { once: true })
    try {
      await audio.play()
    } catch (error) {
      if (ctx.previewAudio !== audio) return
      resetVoicePreview(ctx)
      showToast('无法播放试听音频')
      console.warn('Voice preview failed:', error.message)
    }
  }

  function showToast(message, duration = 1800) {
    elements.toast.textContent = message
    elements.toast.classList.add('is-visible')
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => elements.toast.classList.remove('is-visible'), duration)
  }

  const screenshotSections = ['characters', 'behavior', 'ai', 'system']
  const screenshotProfileTabs = ['basic', 'world', 'actions', 'expressions', 'interactions']
  let screenshotLayoutState = null

  function afterScreenshotLayout() {
    return new Promise(resolve => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(fallback)
        resolve()
      }
      const fallback = setTimeout(finish, 80)
      requestAnimationFrame(() => requestAnimationFrame(finish))
    })
  }

  function screenshotGeometry() {
    const shell = document.querySelector('.window-shell')
    if (!shell) throw new Error('找不到设置面板截图区域')
    const rect = shell.getBoundingClientRect()
    // Capture the shell's border box. scrollWidth/scrollHeight also include
    // intentional decorative overflow such as the glass theme's blurred glow,
    // which would otherwise become a large blank tail after the footer.
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    }
  }

  window.settingsLongScreenshot = Object.freeze({
    async prepare(requestedState) {
      if (screenshotLayoutState) throw new Error('长截图布局已在准备中')
      const root = document.documentElement
      const state = requestedState && typeof requestedState === 'object'
        ? requestedState
        : { section: requestedState }
      const originalSection = screenshotSections.includes(root.dataset.settingsView)
        ? root.dataset.settingsView
        : 'characters'
      const targetSection = screenshotSections.includes(state.section)
        ? state.section
        : originalSection
      const targetProfileTab = screenshotProfileTabs.includes(state.profileTab)
        ? state.profileTab
        : activeProfileTab
      const targetProfileCollapsed = typeof state.profileCollapsed === 'boolean'
        ? state.profileCollapsed
        : profilePanelCollapsed
      const scrollPositions = Object.fromEntries(
        [...document.querySelectorAll('.settings-section')]
          .map(section => [section.dataset.view, { top: section.scrollTop, left: section.scrollLeft }])
      )
      screenshotLayoutState = {
        originalSection,
        originalProfileTab: activeProfileTab,
        originalProfileCollapsed: profilePanelCollapsed,
        documentTop: document.scrollingElement ? document.scrollingElement.scrollTop : 0,
        scrollPositions,
      }

      if (targetSection !== originalSection) setActiveSection(targetSection)
      if (targetSection === 'characters') {
        setProfileTab(targetProfileTab)
        setCharacterProfileCollapsed(targetProfileCollapsed)
      }
      const activeSection = document.querySelector(`.settings-section[data-view="${targetSection}"]`)
      if (!activeSection) throw new Error('找不到需要截图的设置页面')
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      activeSection.scrollTo({ top: 0, left: 0, behavior: 'auto' })
      if (document.scrollingElement) document.scrollingElement.scrollTop = 0
      root.dataset.longScreenshot = 'true'
      if (document.fonts && document.fonts.ready) await document.fonts.ready
      await afterScreenshotLayout()

      const geometry = screenshotGeometry()
      return {
        ...geometry,
        section: targetSection,
        profileTab: activeProfileTab,
        profileCollapsed: profilePanelCollapsed,
      }
    },

    async settle() {
      await afterScreenshotLayout()
      return screenshotGeometry()
    },

    async restore() {
      if (!screenshotLayoutState) return
      const state = screenshotLayoutState
      screenshotLayoutState = null
      delete document.documentElement.dataset.longScreenshot
      if (document.documentElement.dataset.settingsView !== state.originalSection) {
        setActiveSection(state.originalSection)
      }
      setProfileTab(state.originalProfileTab)
      setCharacterProfileCollapsed(state.originalProfileCollapsed)
      await afterScreenshotLayout()
      document.querySelectorAll('.settings-section').forEach(section => {
        const saved = state.scrollPositions[section.dataset.view]
        if (saved) section.scrollTo({ top: saved.top, left: saved.left, behavior: 'auto' })
      })
      if (document.scrollingElement) document.scrollingElement.scrollTop = state.documentTop
    },
  })

  function updateGreetingPresetSelection() {
    elements.chatGreetingPresets.querySelectorAll('[data-greeting]').forEach(button => {
      const selected = button.dataset.greeting === elements.chatGreeting.value
      button.classList.toggle('is-active', selected)
      button.setAttribute('aria-pressed', String(selected))
    })
  }

  function bubbleThemeFor(preferences = snapshot && snapshot.preferences) {
    return preferences && preferences.settingsTheme === 'healing' ? 'healing' : 'glass'
  }

  function bubbleThemeDefinition(theme) {
    const catalog = snapshot && snapshot.bubbleStyleCatalog
      ? snapshot.bubbleStyleCatalog
      : fallbackBubbleStyleCatalog
    return catalog[theme] || fallbackBubbleStyleCatalog.glass
  }

  function selectedBubbleStyle(preferences, theme) {
    const definition = bubbleThemeDefinition(theme)
    const selected = preferences && preferences.bubbleStyles && preferences.bubbleStyles[theme]
    return definition.styles.some(style => style.id === selected) ? selected : definition.fallback
  }

  function bubblePreviewLabel(current) {
    const nickname = current && typeof current.nickname === 'string' ? current.nickname.trim() : ''
    const modelName = current && typeof current.name === 'string' ? current.name.trim() : ''
    const displayName = current && typeof current.displayName === 'string' ? current.displayName.trim() : ''
    return nickname || modelName || displayName || '伙伴'
  }

  function createBubbleArtwork(theme, styleId, label, message, tailSide = '') {
    const bubble = document.createElement('pet-speech-bubble')
    bubble.setAttribute('preview', '')
    bubble.setAttribute('theme', theme)
    if (tailSide) bubble.setAttribute('tail-side', tailSide)
    bubble.styleName = styleId
    bubble.label = label
    bubble.message = message
    return bubble
  }

  function renderBubbleStylePicker(preferences, current) {
    const theme = bubbleThemeFor(preferences)
    const definition = bubbleThemeDefinition(theme)
    const selectedStyle = selectedBubbleStyle(preferences, theme)
    const hasOverflow = definition.styles.length > 4
    const label = bubblePreviewLabel(current)
    const optionMessage = '你好呀～\n今天天气真不错呢！'

    elements.bubbleStyleCustomizer.dataset.theme = theme
    elements.bubbleStyleCustomizer.classList.toggle('has-overflow', hasOverflow)
    elements.bubbleStylePrevious.hidden = !hasOverflow
    elements.bubbleStyleNext.hidden = !hasOverflow
    elements.bubbleStylePagination.hidden = !hasOverflow
    elements.bubbleStyleDescription.textContent = theme === 'healing'
      ? '选择你喜欢的对话气泡样式，让聊天更有个性～'
      : '选择聊天时伙伴说话的气泡样式，让对话更有个性。'
    elements.bubblePreviewNote.textContent = theme === 'healing'
      ? '这样的感觉\n怎么样？♡'
      : '一小句问候，\n也要有自己的温度 ♡'

    const options = definition.styles.map(style => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'bubble-style-option'
      button.dataset.bubbleStyle = style.id
      button.setAttribute('role', 'radio')
      button.setAttribute('aria-checked', String(style.id === selectedStyle))
      button.setAttribute('aria-label', style.name + '，' + style.shortDescription)
      button.classList.toggle('is-active', style.id === selectedStyle)

      const sample = document.createElement('span')
      sample.className = 'bubble-style-option-art'
      sample.appendChild(createBubbleArtwork(theme, style.id, label, optionMessage))

      const name = document.createElement('strong')
      name.textContent = style.name
      const description = document.createElement('small')
      description.textContent = style.shortDescription
      const check = document.createElement('i')
      check.className = 'bubble-style-option-check'
      check.setAttribute('aria-hidden', 'true')
      check.textContent = '✓'
      button.append(sample, name, description, check)
      return button
    })
    elements.bubbleStyleOptions.replaceChildren(...options)
    elements.bubbleStyleOptions.scrollLeft = 0

    const pageCount = Math.ceil(definition.styles.length / 4)
    elements.bubbleStylePagination.replaceChildren(...Array.from({ length: pageCount }, (_, index) => {
      const dot = document.createElement('i')
      dot.classList.toggle('is-active', index === 0)
      return dot
    }))

    const livePreview = createBubbleArtwork(theme, selectedStyle, label, optionMessage, 'left')
    livePreview.classList.add('bubble-live-art')
    elements.bubbleLivePreviewSlot.replaceChildren(livePreview)

    const cover = snapshot && snapshot.covers && current ? snapshot.covers[current.id] : ''
    elements.bubblePreviewAvatar.classList.toggle('is-video-pet', Boolean(current && current.format === 'video-pet'))
    elements.bubblePreviewAvatar.classList.toggle('has-image', Boolean(cover))
    if (cover) {
      elements.bubblePreviewAvatar.src = cover
      elements.bubblePreviewAvatar.alt = current.displayName + ' 气泡预览'
    } else {
      elements.bubblePreviewAvatar.removeAttribute('src')
      elements.bubblePreviewAvatar.alt = ''
    }
  }

  function revealSelectedModel(behavior = 'auto') {
    requestAnimationFrame(() => {
      const selected = elements.modelList.querySelector('.model-card.is-selected')
      if (!selected || elements.modelList.clientWidth <= 0) return
      const listRect = elements.modelList.getBoundingClientRect()
      const selectedRect = selected.getBoundingClientRect()
      const selectedCenter = elements.modelList.scrollLeft + selectedRect.left - listRect.left + selectedRect.width / 2
      const maximum = Math.max(0, elements.modelList.scrollWidth - elements.modelList.clientWidth)
      const target = Math.max(0, Math.min(maximum, selectedCenter - elements.modelList.clientWidth / 2))
      elements.modelList.scrollTo({ left: target, behavior })
      updateModelPagination()
    })
  }

  function updateModelPagination() {
    if (modelPaginationFrame) cancelAnimationFrame(modelPaginationFrame)
    modelPaginationFrame = requestAnimationFrame(() => {
      modelPaginationFrame = 0
      const dots = [...elements.modelPagination.children]
      if (!dots.length) return
      const maximum = Math.max(0, elements.modelList.scrollWidth - elements.modelList.clientWidth)
      const progress = maximum > 0 ? elements.modelList.scrollLeft / maximum : 0
      const active = Math.min(dots.length - 1, Math.max(0, Math.round(progress * (dots.length - 1))))
      dots.forEach((dot, index) => dot.classList.toggle('is-active', index === active))
      elements.modelNext.classList.toggle('is-at-end', maximum > 0 && elements.modelList.scrollLeft >= maximum - 2)
    })
  }

  function renderModelPagination() {
    const cardCount = elements.modelList.querySelectorAll('.model-card').length
    const dotCount = Math.min(5, Math.max(1, cardCount - 2))
    elements.modelPagination.replaceChildren(...Array.from({ length: dotCount }, (_, index) => {
      const dot = document.createElement('i')
      dot.className = index === 0 ? 'is-active' : ''
      return dot
    }))
    elements.modelNext.hidden = cardCount <= 3
    updateModelPagination()
  }

  function snapModelSlider(behavior = 'smooth') {
    requestAnimationFrame(() => {
      const cards = [...elements.modelList.querySelectorAll('.model-card')]
      if (!cards.length || elements.modelList.clientWidth <= 0) return
      const listRect = elements.modelList.getBoundingClientRect()
      const current = elements.modelList.scrollLeft
      const maximum = Math.max(0, elements.modelList.scrollWidth - elements.modelList.clientWidth)
      const padding = parseFloat(getComputedStyle(elements.modelList).scrollPaddingLeft) || 0
      const positions = cards.map(card => {
        const rect = card.getBoundingClientRect()
        return Math.max(0, Math.min(maximum, current + rect.left - listRect.left - padding))
      })
      const target = positions.reduce((closest, position) => (
        Math.abs(position - current) < Math.abs(closest - current) ? position : closest
      ), positions[0])
      elements.modelList.scrollTo({ left: target, behavior })
      updateModelPagination()
    })
  }

  function setActiveSection(section) {
    const target = ['characters', 'behavior', 'ai', 'system'].includes(section) ? section : 'characters'
    document.documentElement.dataset.settingsView = target
    document.querySelectorAll('.section-tab').forEach(button => {
      const active = button.dataset.section === target
      button.classList.toggle('is-active', active)
      if (active) button.setAttribute('aria-current', 'page')
      else button.removeAttribute('aria-current')
    })
    document.querySelectorAll('.settings-section').forEach(view => {
      const active = view.dataset.view === target
      view.hidden = !active
      view.classList.toggle('is-active', active)
    })
    if (target === 'characters') revealSelectedModel()
  }

  function setScaleDisplay(value) {
    const scale = Math.min(MODEL_SCALE_MAX, Math.max(MODEL_SCALE_MIN, Number(value) || 1))
    const progress = ((scale - MODEL_SCALE_MIN) / (MODEL_SCALE_MAX - MODEL_SCALE_MIN)) * 100
    elements.scaleRange.value = String(scale)
    elements.scaleRange.style.setProperty('--range-progress', `${progress}%`)
    elements.scaleValue.textContent = `${Math.round(scale * 100)}%`
  }

  function shortcutKeyLabel(key) {
    const labels = {
      CommandOrControl: navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl',
      Command: '⌘',
      Control: 'Ctrl',
      Ctrl: 'Ctrl',
      Alt: navigator.platform.toLowerCase().includes('mac') ? '⌥' : 'Alt',
      Option: '⌥',
      Shift: 'Shift',
      Super: navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Win',
      Meta: navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Win',
      Space: 'Space',
      Period: '.',
      Plus: '+',
      Minus: '-',
      Return: 'Enter',
      Left: '←',
      Right: '→',
      Up: '↑',
      Down: '↓',
    }
    return labels[key] || key.replace(/^Key/, '').replace(/^Digit/, '')
  }

  function shortcutDisplay(accelerator) {
    return String(accelerator || '')
      .split('+')
      .filter(Boolean)
      .map(shortcutKeyLabel)
      .join(' + ')
  }

  function capturedShortcutKey(event) {
    const codeMap = {
      Space: 'Space',
      Comma: ',',
      Period: 'Period',
      Slash: '/',
      Backslash: '\\',
      Semicolon: ';',
      Quote: "'",
      BracketLeft: '[',
      BracketRight: ']',
      Minus: 'Minus',
      Equal: 'Plus',
      Enter: 'Return',
      Escape: 'Esc',
      Backspace: 'Backspace',
      Delete: 'Delete',
      Insert: 'Insert',
      Home: 'Home',
      End: 'End',
      PageUp: 'PageUp',
      PageDown: 'PageDown',
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      Tab: 'Tab',
    }
    if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3)
    if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5)
    if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.code)) return event.code
    return codeMap[event.code] || ''
  }

  function acceleratorFromKeyboardEvent(event) {
    const modifierCodes = new Set(['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'])
    if (modifierCodes.has(event.code)) return ''
    const key = capturedShortcutKey(event)
    if (!key || key === 'Esc') return ''
    const modifiers = []
    if (event.ctrlKey) modifiers.push('CommandOrControl')
    if (event.altKey) modifiers.push('Alt')
    if (event.shiftKey) modifiers.push('Shift')
    if (event.metaKey) modifiers.push('Super')
    if (!modifiers.length) return ''
    return [...modifiers, key].join('+')
  }

  function renderShortcuts(preferences) {
    const bindings = Array.isArray(preferences.shortcutBindings) ? preferences.shortcutBindings : []
    elements.shortcutList.replaceChildren(...bindings.map(binding => {
      const item = document.createElement('article')
      item.className = 'shortcut-settings-item'
      item.dataset.shortcutId = binding.id

      const label = document.createElement('span')
      label.className = 'shortcut-settings-label'
      label.textContent = binding.label
      label.title = binding.label

      const keycap = document.createElement('kbd')
      keycap.className = 'shortcut-keycap'
      keycap.textContent = shortcutDisplay(binding.accelerator)
      keycap.title = keycap.textContent

      const edit = document.createElement('button')
      edit.className = 'shortcut-edit'
      edit.type = 'button'
      edit.dataset.shortcutEdit = binding.id
      edit.setAttribute('aria-label', `修改${binding.label}快捷键`)
      edit.title = `修改${binding.label}`
      edit.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m3.2 13.8-.7 3.7 3.7-.7L16 7l-3-3-9.8 9.8Zm8.4-8.4 3 3"/></svg>'
      item.append(label, keycap, edit)
      return item
    }))

    const actionCount = Array.isArray(snapshot.shortcutActions) ? snapshot.shortcutActions.length : 0
    const limit = Number(snapshot.shortcutBindingLimit) || 24
    elements.shortcutAdd.disabled = !actionCount || bindings.length >= limit
    elements.shortcutAdd.title = bindings.length < limit ? '添加其他常用功能' : `最多可设置 ${limit} 个快捷键`
  }

  function closeShortcutDialog() {
    shortcutActionPicker.close()
    elements.shortcutDialog.hidden = true
    elements.shortcutCapture.classList.remove('is-listening')
    shortcutEditor = null
  }

  function fillShortcutActionOptions(selectedAction = '') {
    const actions = Array.isArray(snapshot && snapshot.shortcutActions) ? snapshot.shortcutActions : []
    elements.shortcutAction.replaceChildren(...actions
      .map(action => {
        const option = document.createElement('option')
        option.value = action.id
        option.textContent = action.label
        option.selected = action.id === selectedAction
        return option
      }))
    shortcutActionPicker.refresh()
  }

  function openShortcutDialog(binding = null) {
    const editing = Boolean(binding)
    fillShortcutActionOptions(binding ? binding.action : '')
    if (!editing && !elements.shortcutAction.options.length) {
      showToast('所有可用功能都已设置快捷键')
      return
    }
    shortcutEditor = {
      id: binding ? binding.id : '',
      accelerator: binding ? binding.accelerator : '',
      custom: Boolean(binding && binding.custom),
    }
    elements.shortcutDialogTitle.textContent = editing ? `修改「${binding.label}」` : '添加自定义快捷键'
    elements.shortcutActionField.hidden = editing
    elements.shortcutAction.disabled = editing
    if (editing) elements.shortcutAction.value = binding.action
    elements.shortcutDelete.hidden = !(editing && binding.custom)
    elements.shortcutCapture.textContent = binding ? shortcutDisplay(binding.accelerator) : '点击后按下组合键'
    elements.shortcutCaptureHint.textContent = '至少包含 Ctrl、Alt、Shift 或 Win 中的一个修饰键'
    elements.shortcutCapture.classList.remove('is-listening')
    elements.shortcutDialog.hidden = false
    requestAnimationFrame(() => elements.shortcutCapture.focus())
  }

  function setOpacityDisplay(value) {
    const opacity = Math.min(MODEL_OPACITY_MAX, Math.max(MODEL_OPACITY_MIN, Number(value) || 1))
    const progress = ((opacity - MODEL_OPACITY_MIN) / (MODEL_OPACITY_MAX - MODEL_OPACITY_MIN)) * 100
    elements.opacityRange.value = String(opacity)
    elements.opacityRange.style.setProperty('--range-progress', `${progress}%`)
    elements.opacityValue.textContent = `${Math.round(opacity * 100)}%`
  }

  function setCharacterProfileCollapsed(collapsed) {
    profilePanelCollapsed = Boolean(collapsed)
    elements.characterProfile.classList.toggle('is-collapsed', profilePanelCollapsed)
    elements.characterProfileBody.hidden = profilePanelCollapsed
    elements.characterProfileToggle.setAttribute('aria-expanded', String(!profilePanelCollapsed))
    elements.characterProfileToggle.querySelector('.profile-collapse-label').textContent = profilePanelCollapsed ? '展开' : '收起'
  }

  function setProfileTab(tab) {
    const target = ['basic', 'world', 'actions', 'expressions', 'interactions'].includes(tab) ? tab : 'basic'
    activeProfileTab = target
    document.querySelectorAll('[data-profile-tab]').forEach(button => {
      const active = button.dataset.profileTab === target
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-selected', String(active))
      button.tabIndex = active ? 0 : -1
    })
    document.querySelectorAll('[data-profile-pane]').forEach(pane => {
      const active = pane.dataset.profilePane === target
      pane.classList.toggle('is-active', active)
      pane.hidden = !active
    })
    if (profilePanelCollapsed) setCharacterProfileCollapsed(false)
    if (target === 'basic') {
      for (const kind of ['action', 'expression']) {
        revealSelectedProfileAsset(kind)
        updateProfileCarousel(kind)
      }
    }
  }

  function profileAssetKey(modelId, kind, assetId = '') {
    return `${modelId || ''}:${kind}:${assetId}`
  }

  function selectedProfileAsset(modelId, kind) {
    return selectedProfileAssets.get(profileAssetKey(modelId, kind)) || ''
  }

  function setSelectedProfileAsset(modelId, kind, assetId) {
    selectedProfileAssets.set(profileAssetKey(modelId, kind), assetId)
  }

  function profilePreviewList(kind) {
    return kind === 'expression' ? elements.profileExpressionPreview : elements.profileActionPreview
  }

  // The two compact preview shelves both show four cards per viewport. Keep
  // this value in sync with the grid-auto-columns rules in the active theme.
  function profilePreviewVisibleCount() {
    return 4
  }

  function createProfileAssetButton(asset, kind, index, coverUrl, compact) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = compact ? 'profile-preview-card' : 'profile-library-card'
    button.dataset.profileAssetId = asset.id
    button.dataset.profileAssetKind = kind
    button.dataset.previewIndex = String(index)
    button.draggable = false
    button.setAttribute('role', 'listitem')
    button.setAttribute('aria-label', `预览${kind === 'action' ? '动作' : '表情'}：${asset.label}`)
    button.title = `点击预览：${asset.label}`
    const visual = document.createElement('span')
    visual.className = 'profile-preview-visual'
    const modelId = snapshot && snapshot.currentModelId
    const cachedFrame = profilePreviewFrames.get(profileAssetKey(modelId, kind, asset.id))
    const imageUrl = cachedFrame || coverUrl
    if (imageUrl) {
      const image = document.createElement('img')
      image.src = imageUrl
      image.alt = ''
      image.draggable = false
      if (cachedFrame) image.dataset.livePreviewFrame = 'true'
      visual.appendChild(image)
    } else {
      const placeholder = document.createElement('span')
      placeholder.className = 'profile-preview-placeholder'
      placeholder.textContent = kind === 'action' ? '▶' : '●'
      visual.appendChild(placeholder)
    }
    const label = document.createElement('span')
    label.className = 'profile-preview-label'
    label.textContent = asset.label
    button.append(visual, label)
    const selected = selectedProfileAsset(modelId, kind) === asset.id
    button.classList.toggle('is-selected', selected)
    button.setAttribute('aria-pressed', String(selected))
    return button
  }

  function renderProfileAssetList(container, assets, kind, limit, compact, coverUrl) {
    const visibleAssets = compact ? assets : assets.slice(0, limit || assets.length)
    container.classList.toggle('is-empty', visibleAssets.length === 0)
    if (!visibleAssets.length) {
      const empty = document.createElement('p')
      empty.className = 'profile-assets-empty'
      empty.textContent = kind === 'expression' ? '该角色没有可用表情' : '该角色没有可用动作'
      container.replaceChildren(empty)
      if (compact) updateProfileCarousel(kind)
      return
    }
    container.replaceChildren(...visibleAssets.map((asset, index) => (
      createProfileAssetButton(asset, kind, index, coverUrl, compact)
    )))
    if (compact) {
      if (container.clientWidth > 0) {
        revealSelectedProfileAsset(kind)
        updateProfileCarousel(kind)
      }
    }
  }

  function updateProfileCarousel(kind) {
    const list = profilePreviewList(kind)
    const carousel = list && list.closest('.profile-preview-carousel')
    if (!list || !carousel) return
    const previous = carousel.querySelector('.profile-preview-arrow.is-previous')
    const next = carousel.querySelector('.profile-preview-arrow.is-next')
    const pagination = elements.characterProfile.querySelector(`[data-profile-pagination="${kind}"]`)
    const cardCount = list.querySelectorAll('.profile-preview-card').length
    const pageCount = Math.max(1, Math.ceil(cardCount / profilePreviewVisibleCount(kind)))
    const maximum = Math.max(0, list.scrollWidth - list.clientWidth)
    const overflow = cardCount > profilePreviewVisibleCount(kind) && maximum > 1
    const progress = maximum > 0 ? list.scrollLeft / maximum : 0
    const activePage = Math.min(pageCount - 1, Math.max(0, Math.round(progress * (pageCount - 1))))
    previous.hidden = !overflow
    next.hidden = !overflow
    previous.disabled = !overflow || list.scrollLeft <= 2
    next.disabled = !overflow || list.scrollLeft >= maximum - 2
    carousel.classList.toggle('has-overflow', overflow)
    carousel.classList.toggle('is-at-start', !overflow || list.scrollLeft <= 2)
    carousel.classList.toggle('is-at-end', !overflow || list.scrollLeft >= maximum - 2)
    if (pagination) {
      if (pagination.children.length !== pageCount) {
        pagination.replaceChildren(...Array.from({ length: pageCount }, () => document.createElement('i')))
      }
      pagination.hidden = !overflow
      ;[...pagination.children].forEach((dot, index) => dot.classList.toggle('is-active', index === activePage))
    }
    const locate = elements.characterProfile.querySelector(`[data-profile-locate="${kind}"]`)
    if (locate) locate.disabled = !selectedProfileAsset(snapshot && snapshot.currentModelId, kind)
  }

  function moveProfileCarousel(kind, direction) {
    const list = profilePreviewList(kind)
    if (!list) return
    const maximum = Math.max(0, list.scrollWidth - list.clientWidth)
    if (!maximum) return
    const card = list.querySelector('.profile-preview-card')
    const gap = parseFloat(getComputedStyle(list).columnGap) || 0
    const pageWidth = card
      ? (card.getBoundingClientRect().width + gap) * profilePreviewVisibleCount(kind)
      : list.clientWidth
    const currentPage = Math.round(list.scrollLeft / Math.max(1, pageWidth))
    const target = Math.max(0, Math.min(maximum, (currentPage + Math.sign(direction || 1)) * pageWidth))
    // A direct assignment is intentional: Chromium may cancel a smooth programmatic
    // scroll when scroll-snap is active after this pane has just become visible.
    list.scrollLeft = target
    requestAnimationFrame(() => updateProfileCarousel(kind))
  }

  function revealSelectedProfileAsset(kind) {
    const list = profilePreviewList(kind)
    const assetId = selectedProfileAsset(snapshot && snapshot.currentModelId, kind)
    const selected = assetId && list && list.querySelector(`[data-profile-asset-id="${CSS.escape(assetId)}"]`)
    if (!selected || !list.clientWidth) return
    const listRect = list.getBoundingClientRect()
    const selectedRect = selected.getBoundingClientRect()
    const center = list.scrollLeft + selectedRect.left - listRect.left + selectedRect.width / 2
    const maximum = Math.max(0, list.scrollWidth - list.clientWidth)
    const target = Math.max(0, Math.min(maximum, center - list.clientWidth / 2))
    list.scrollLeft = target
    requestAnimationFrame(() => updateProfileCarousel(kind))
  }

  function renderCharacterProfile(current) {
    const profile = current && current.profile ? current.profile : {}
    const assets = current && current.assets ? current.assets : { actions: [], expressions: [] }
    const actionAssets = Array.isArray(assets.actions) ? assets.actions : []
    const expressionAssets = Array.isArray(assets.expressions) ? assets.expressions : []
    const coverUrl = current && snapshot && snapshot.covers ? snapshot.covers[current.id] : ''
    if (current) {
      for (const kind of ['action', 'expression']) {
        const list = kind === 'action' ? actionAssets : expressionAssets
        const selected = selectedProfileAsset(current.id, kind)
        if (!list.some(asset => asset.id === selected)) {
          setSelectedProfileAsset(current.id, kind, list.length ? list[0].id : '')
        }
      }
    }
    elements.characterProfile.classList.toggle('is-unavailable', !current)
    elements.characterProfileToggle.disabled = !current
    elements.profilePortrait.classList.toggle('is-video-pet', Boolean(current && current.format === 'video-pet'))
    elements.profilePortraitName.textContent = current ? current.name : '暂无角色'
    elements.profilePortraitNickname.textContent = current && current.nickname ? current.nickname : ''
    elements.profilePortraitNickname.hidden = !(current && current.nickname)
    elements.profileCharacterName.textContent = current
      ? `${current.name}${current.nickname ? `（${current.nickname}）` : ''}`
      : '—'
    elements.profileSpecies.textContent = profile.species || '未设定'
    elements.profileAge.textContent = profile.age || '未设定'
    elements.profileHeight.textContent = profile.height || '未设定'
    elements.profilePersonality.textContent = profile.personality || '未设定'
    elements.profileLikes.textContent = profile.likes || '未设定'
    elements.profileBio.textContent = profile.bio || '未设定'
    // Counts come from the current model's discovered assets. Switching a
    // model or refreshing its ZIP/mapping metadata updates both badges here.
    elements.profileActionCount.textContent = String(actionAssets.length)
    elements.profileActionCount.setAttribute('aria-label', `共 ${actionAssets.length} 个动作`)
    elements.profileExpressionCount.textContent = String(expressionAssets.length)
    elements.profileExpressionCount.setAttribute('aria-label', `共 ${expressionAssets.length} 个表情`)
    if (coverUrl) {
      elements.profilePortrait.src = coverUrl
      elements.profilePortrait.hidden = false
    } else {
      elements.profilePortrait.removeAttribute('src')
      elements.profilePortrait.hidden = true
    }
    if (!elements.profileBasicForm.contains(document.activeElement) || profileEditingModelId !== (current && current.id)) {
      document.getElementById('profile-species-input').value = profile.species || ''
      document.getElementById('profile-age-input').value = profile.age || ''
      document.getElementById('profile-height-input').value = profile.height || ''
      document.getElementById('profile-personality-input').value = profile.personality || ''
      document.getElementById('profile-likes-input').value = profile.likes || ''
      document.getElementById('profile-bio-input').value = profile.bio || ''
    }
    if (!elements.profileWorldForm.contains(document.activeElement)) {
      document.getElementById('profile-worldview-input').value = profile.worldview || ''
      document.getElementById('profile-relationship-input').value = profile.relationship || ''
      document.getElementById('profile-rules-input').value = profile.rules || ''
    }
    renderProfileAssetList(elements.profileActionPreview, actionAssets, 'action', 4, true, coverUrl)
    renderProfileAssetList(elements.profileExpressionPreview, expressionAssets, 'expression', 4, true, coverUrl)
    renderProfileAssetList(elements.profileActionLibrary, actionAssets, 'action', 0, false, coverUrl)
    renderProfileAssetList(elements.profileExpressionLibrary, expressionAssets, 'expression', 0, false, coverUrl)
    renderModelGestures(current)
    renderModelInteractions(current)
  }

  function createInteractionGlyph(markup, className) {
    const glyph = document.createElement('span')
    glyph.className = className
    glyph.setAttribute('aria-hidden', 'true')
    glyph.innerHTML = markup
    return glyph
  }

  function createModelGestureRow(item, actionAssets) {
    const row = document.createElement('div')
    const enabled = item.enabled !== false
    row.className = `model-interaction-row model-gesture-row${enabled ? '' : ' is-disabled-gesture'}`
    row.dataset.gestureId = item.id
    row.dataset.gestureKind = item.kind
    row.dataset.gestureEnabled = String(enabled)

    const glyph = createInteractionGlyph(gestureIconMarkup[item.id] || gestureIconMarkup['tap-body'], 'model-gesture-glyph')

    const trigger = document.createElement('span')
    trigger.className = 'model-gesture-trigger'
    const triggerName = document.createElement('strong')
    triggerName.textContent = item.label
    trigger.appendChild(triggerName)

    const textField = document.createElement('label')
    textField.className = 'model-gesture-text'
    const textInput = document.createElement('input')
    textInput.type = 'text'
    textInput.maxLength = 80
    textInput.value = item.text
    textInput.placeholder = '互动时弹出的文字'
    textInput.setAttribute('aria-label', `${item.label}的提示文字`)
    textInput.dataset.gestureField = 'text'
    textField.appendChild(textInput)

    const mappingField = document.createElement('label')
    mappingField.className = 'model-interaction-mapping'
    const mapping = document.createElement('select')
    mapping.setAttribute('aria-label', `${item.label}的动作映射`)
    mapping.dataset.gestureField = 'actionId'
    mapping.dataset.searchSelect = ''
    mapping.dataset.searchPlaceholder = '搜索动作名称或 ID'
    mapping.dataset.itemLabel = '个动作'
    mapping.dataset.density = 'compact'
    mapping.dataset.menuMinWidth = '172'
    mapping.dataset.menuMaxHeight = '190'
    mapping.dataset.triggerSecondary = 'false'
    mapping.dataset.optionSecondary = 'false'
    const defaultOption = document.createElement('option')
    defaultOption.value = ''
    defaultOption.textContent = `按角色默认 · ${item.defaultMapping}`
    defaultOption.dataset.primary = defaultOption.textContent
    defaultOption.selected = !item.actionId
    mapping.appendChild(defaultOption)
    for (const asset of actionAssets) {
      const option = document.createElement('option')
      option.value = asset.id
      option.textContent = asset.label
      option.dataset.primary = asset.label
      option.dataset.secondary = asset.id
      option.selected = asset.id === item.actionId
      mapping.appendChild(option)
    }
    if (item.actionId && !actionAssets.some(asset => asset.id === item.actionId)) {
      const unavailable = document.createElement('option')
      unavailable.value = item.actionId
      unavailable.textContent = `动作不可用 · ${item.actionId}`
      unavailable.dataset.primary = '动作不可用'
      unavailable.dataset.secondary = item.actionId
      unavailable.dataset.unavailable = 'true'
      unavailable.selected = true
      mapping.appendChild(unavailable)
      mapping.classList.add('is-unavailable')
    }
    mappingField.appendChild(mapping)
    window.SearchSelect.enhance(mapping)

    const controls = document.createElement('span')
    controls.className = 'model-interaction-controls'
    const preview = document.createElement('button')
    preview.type = 'button'
    preview.dataset.gesturePreview = 'true'
    preview.title = '预览这个手势互动'
    preview.setAttribute('aria-label', `预览手势：${item.label}`)
    preview.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 9 6-9 6Z"/></svg>'
    controls.appendChild(preview)

    const operation = document.createElement('button')
    operation.type = 'button'
    operation.className = 'model-gesture-operation'
    operation.dataset.gestureToggle = 'true'
    operation.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v8"/><path d="M7.1 5.8a8 8 0 1 0 9.8 0"/></svg>'
    syncModelGestureRowState(row, operation, item.label)

    row.append(glyph, trigger, textField, mappingField, controls, operation)
    return row
  }

  function syncModelGestureRowState(row, operation, label) {
    const enabled = row.dataset.gestureEnabled !== 'false'
    row.classList.toggle('is-disabled-gesture', !enabled)
    operation.classList.toggle('is-enabled', enabled)
    operation.setAttribute('aria-pressed', String(enabled))
    operation.setAttribute('aria-label', `${enabled ? '禁用' : '启用'}手势：${label}`)
    operation.title = enabled ? '禁用此手势' : '启用此手势'
  }

  function renderModelGestures(current) {
    const actionAssets = current && current.assets && Array.isArray(current.assets.actions) ? current.assets.actions : []
    const gestures = current && Array.isArray(current.gestures) && current.gestures.length
      ? current.gestures
      : fallbackModelGestures
    window.SearchSelect.destroyAll(elements.modelGesturesList)
    elements.modelGesturesForm.dataset.modelId = current ? current.id : ''
    elements.modelGesturesList.replaceChildren(...gestures.map(item => createModelGestureRow(item, actionAssets)))
    elements.modelGesturesCount.textContent = `${gestures.length} 项`
    elements.modelGesturesSummaryCount.textContent = String(gestures.length)
    elements.modelGesturesReset.disabled = !current
    const submit = elements.modelGesturesForm.querySelector('[type="submit"]')
    if (submit) submit.disabled = !current
  }

  function collectModelGestures() {
    return [...elements.modelGesturesList.querySelectorAll('.model-gesture-row')].map(row => ({
      id: row.dataset.gestureId,
      text: row.querySelector('[data-gesture-field="text"]').value.trim(),
      actionId: row.querySelector('[data-gesture-field="actionId"]').value,
      enabled: row.dataset.gestureEnabled !== 'false',
    }))
  }

  function createModelInteractionRow(item, actionAssets) {
    const row = document.createElement('div')
    row.className = `model-interaction-row model-context-interaction-row${item.isDefault ? ' is-default' : ' is-custom'}${item.enabled === false ? ' is-hidden-interaction' : ''}`
    row.dataset.interactionId = item.id
    row.dataset.interactionKind = item.kind || 'custom'
    row.dataset.interactionDefault = String(Boolean(item.isDefault))

    const sortHandle = document.createElement('button')
    sortHandle.type = 'button'
    sortHandle.className = 'model-interaction-sort-handle'
    sortHandle.draggable = true
    sortHandle.title = '拖动排序'
    sortHandle.setAttribute('aria-label', `拖动排序：${item.label || '新互动'}`)
    sortHandle.innerHTML = '<svg viewBox="0 0 16 24" aria-hidden="true"><circle cx="5" cy="6" r="1.4"/><circle cx="11" cy="6" r="1.4"/><circle cx="5" cy="12" r="1.4"/><circle cx="11" cy="12" r="1.4"/><circle cx="5" cy="18" r="1.4"/><circle cx="11" cy="18" r="1.4"/></svg>'

    const enabledLabel = document.createElement('label')
    enabledLabel.className = 'model-interaction-enabled'
    enabledLabel.title = '是否显示在“和我互动”菜单中'
    const enabled = document.createElement('input')
    enabled.type = 'checkbox'
    enabled.checked = item.enabled !== false
    enabled.dataset.interactionField = 'enabled'
    const enabledMark = document.createElement('span')
    enabledMark.setAttribute('aria-hidden', 'true')
    enabledLabel.append(enabled, enabledMark)

    const nameField = document.createElement('label')
    nameField.className = 'model-interaction-name'
    const name = document.createElement('input')
    name.type = 'text'
    name.maxLength = 24
    name.value = item.label || '新互动'
    name.placeholder = '菜单名称'
    name.setAttribute('aria-label', '互动菜单名称')
    name.dataset.interactionField = 'label'

    nameField.appendChild(name)

    const messageField = document.createElement('label')
    messageField.className = 'model-interaction-message'
    const message = document.createElement('input')
    message.type = 'text'
    message.maxLength = 80
    message.value = item.text || item.label || '一起来玩吧～'
    message.placeholder = '互动时弹出的文字'
    message.setAttribute('aria-label', `${item.label || '互动'}触发后弹出的文字`)
    message.dataset.interactionField = 'text'
    messageField.appendChild(message)

    const mappingField = document.createElement('label')
    mappingField.className = 'model-interaction-mapping'
    const mapping = document.createElement('select')
    mapping.setAttribute('aria-label', `${item.label || '互动'}的动作映射`)
    mapping.dataset.interactionField = 'actionId'
    mapping.dataset.searchSelect = ''
    mapping.dataset.searchPlaceholder = '搜索动作名称或 ID'
    mapping.dataset.itemLabel = '个动作'
    mapping.dataset.density = 'compact'
    mapping.dataset.menuMinWidth = '172'
    mapping.dataset.menuMaxHeight = '190'
    mapping.dataset.triggerSecondary = 'false'
    mapping.dataset.optionSecondary = 'false'
    const defaultOption = document.createElement('option')
    defaultOption.value = ''
    defaultOption.textContent = item.isDefault ? `按角色默认 · ${item.defaultMapping}` : '请选择动作'
    defaultOption.dataset.primary = defaultOption.textContent
    defaultOption.disabled = !item.isDefault
    defaultOption.selected = !item.actionId
    mapping.appendChild(defaultOption)
    for (const asset of actionAssets) {
      const option = document.createElement('option')
      option.value = asset.id
      option.textContent = asset.label
      option.dataset.primary = asset.label
      option.dataset.secondary = asset.id
      option.selected = asset.id === item.actionId
      mapping.appendChild(option)
    }
    if (item.actionId && !actionAssets.some(asset => asset.id === item.actionId)) {
      const unavailable = document.createElement('option')
      unavailable.value = item.actionId
      unavailable.textContent = `动作不可用 · ${item.actionId}`
      unavailable.dataset.primary = '动作不可用'
      unavailable.dataset.secondary = item.actionId
      unavailable.dataset.unavailable = 'true'
      unavailable.selected = true
      mapping.appendChild(unavailable)
      mapping.classList.add('is-unavailable')
    }
    mappingField.appendChild(mapping)
    window.SearchSelect.enhance(mapping)

    const controls = document.createElement('span')
    controls.className = 'model-interaction-controls'
    const preview = document.createElement('button')
    preview.type = 'button'
    preview.dataset.interactionPreview = 'true'
    preview.title = '预览这个互动'
    preview.setAttribute('aria-label', `预览互动：${item.label || '新互动'}`)
    preview.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 9 6-9 6Z"/></svg>'
    preview.disabled = !item.isDefault && !item.actionId
    controls.appendChild(preview)

    const action = document.createElement('button')
    action.type = 'button'
    action.className = 'model-interaction-row-action'
    if (!item.isDefault) {
      action.dataset.interactionDelete = 'true'
      action.title = '删除这个互动'
      action.setAttribute('aria-label', `删除互动：${item.label || '新互动'}`)
      action.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14m-9-3h4l1 3H9l1-3Zm-3 3 1 14h8l1-14M10 11v6m4-6v6"/></svg>'
    } else {
      action.classList.add('is-static')
      action.title = '内置互动不能删除'
      action.setAttribute('aria-label', '内置互动不能删除')
      action.textContent = '•••'
    }

    row.append(sortHandle, enabledLabel, nameField, messageField, mappingField, controls, action)
    return row
  }

  function renderModelInteractions(current) {
    const actionAssets = current && current.assets && Array.isArray(current.assets.actions) ? current.assets.actions : []
    const interactions = current && Array.isArray(current.interactions) && current.interactions.length
      ? current.interactions
      : fallbackModelInteractions
    window.SearchSelect.destroyAll(elements.modelInteractionsList)
    elements.modelInteractionsForm.dataset.modelId = current ? current.id : ''
    elements.modelInteractionsList.replaceChildren(...interactions.map(item => createModelInteractionRow(item, actionAssets)))
    const enabledCount = interactions.filter(item => item.enabled !== false).length
    elements.modelInteractionsCount.textContent = `${enabledCount} / ${interactions.length}`
    elements.modelInteractionsSummaryCount.textContent = `${enabledCount} / ${interactions.length}`
    elements.modelInteractionsEmpty.hidden = !current || actionAssets.length > 0
    elements.modelInteractionAdd.disabled = !current || !actionAssets.length || interactions.length >= 12
    elements.modelInteractionsReset.disabled = !current
    const submit = elements.modelInteractionsForm.querySelector('[type="submit"]')
    if (submit) submit.disabled = !current
  }

  function reorderInteractionRowsByVisibility() {
    const rows = [...elements.modelInteractionsList.querySelectorAll('.model-context-interaction-row')]
    for (const row of rows) {
      const enabled = row.querySelector('[data-interaction-field="enabled"]').checked
      row.classList.toggle('is-hidden-interaction', !enabled)
    }
    elements.modelInteractionsList.append(
      ...rows.filter(row => row.querySelector('[data-interaction-field="enabled"]').checked),
      ...rows.filter(row => !row.querySelector('[data-interaction-field="enabled"]').checked)
    )
  }

  function collectModelInteractions() {
    return [...elements.modelInteractionsList.querySelectorAll('.model-interaction-row')].map(row => ({
      id: row.dataset.interactionId,
      kind: row.dataset.interactionKind,
      label: row.querySelector('[data-interaction-field="label"]').value.trim(),
      text: row.querySelector('[data-interaction-field="text"]').value.trim(),
      actionId: row.querySelector('[data-interaction-field="actionId"]').value,
      enabled: row.querySelector('[data-interaction-field="enabled"]').checked,
    }))
  }

  function syncModelInteractionEditorState() {
    reorderInteractionRowsByVisibility()
    const rows = [...elements.modelInteractionsList.querySelectorAll('.model-interaction-row')]
    const enabledCount = rows.filter(row => row.querySelector('[data-interaction-field="enabled"]').checked).length
    elements.modelInteractionsCount.textContent = `${enabledCount} / ${rows.length}`
    elements.modelInteractionsSummaryCount.textContent = `${enabledCount} / ${rows.length}`
    const current = snapshot && snapshot.models.find(model => model.id === snapshot.currentModelId)
    const actionAssets = current && current.assets && Array.isArray(current.assets.actions) ? current.assets.actions : []
    elements.modelInteractionAdd.disabled = !current || !actionAssets.length || rows.length >= 12
  }

  function createModelCard(model, currentModelId, runtime, covers) {
    const button = document.createElement('button')
    const selected = model.id === currentModelId
    const loading = runtime.phase === 'loading' && runtime.modelId === model.id
    const unavailable = model.status !== 'ready'
    const videoPet = model.format === 'video-pet'
    button.type = 'button'
    button.className = `model-card${selected ? ' is-selected' : ''}${loading ? ' is-loading' : ''}${unavailable ? ' is-unavailable' : ''}${videoPet ? ' is-video-pet' : ''}`
    button.dataset.modelId = model.id
    button.setAttribute('role', 'radio')
    button.setAttribute('aria-checked', String(selected))
    button.disabled = loading || unavailable

    const cover = document.createElement('span')
    cover.className = 'model-cover'
    const coverUrl = covers && covers[model.id]
    if (coverUrl && !unavailable) {
      const image = document.createElement('img')
      image.src = coverUrl
      image.alt = ''
      cover.appendChild(image)
    } else {
      cover.classList.add(unavailable ? 'is-unavailable' : 'is-pending')
      const mark = document.createElement('span')
      mark.className = 'model-cover-mark'
      mark.textContent = unavailable
        ? (model.cubismVersion === 2 ? 'V2' : '!')
        : model.displayName.slice(0, 2).toUpperCase()
      cover.appendChild(mark)
      if (!unavailable) {
        const pendingLabel = document.createElement('span')
        pendingLabel.className = 'model-cover-pending-label'
        pendingLabel.textContent = '正在生成预览'
        cover.appendChild(pendingLabel)
      }
    }

    const name = document.createElement('span')
    name.className = 'model-name'
    name.textContent = model.displayName
    const sourceTitle = model.nickname ? `${model.displayName}（模型：${model.name}）` : model.name
    button.title = unavailable && model.statusMessage ? `${sourceTitle} · ${model.statusMessage}` : sourceTitle

    const compatibility = document.createElement('span')
    compatibility.className = 'model-compatibility'
    compatibility.textContent = model.statusMessage || ''
    compatibility.hidden = !unavailable

    const seal = document.createElement('span')
    seal.className = 'model-seal'
    seal.setAttribute('aria-hidden', 'true')
    seal.innerHTML = '<svg viewBox="0 0 12 12"><path d="m2.6 6.4 2.1 2.1 4.7-5.2"/></svg>'

    const sortHandle = document.createElement('span')
    sortHandle.className = 'model-sort-handle'
    sortHandle.draggable = !unavailable
    sortHandle.title = '按住拖动调整角色顺序'
    sortHandle.setAttribute('aria-label', '拖动调整角色顺序')
    sortHandle.innerHTML = '<svg viewBox="0 0 12 16" aria-hidden="true"><circle cx="3" cy="3" r="1.15"/><circle cx="9" cy="3" r="1.15"/><circle cx="3" cy="8" r="1.15"/><circle cx="9" cy="8" r="1.15"/><circle cx="3" cy="13" r="1.15"/><circle cx="9" cy="13" r="1.15"/></svg>'

    button.append(cover, name, compatibility, seal, sortHandle)
    return button
  }

  function modelListRenderKey(nextSnapshot) {
    const runtime = nextSnapshot.runtime || {}
    const covers = Object.entries(nextSnapshot.covers || {}).sort(([left], [right]) => left.localeCompare(right))
    return JSON.stringify({
      currentModelId: nextSnapshot.currentModelId,
      runtime: [runtime.phase, runtime.modelId],
      models: nextSnapshot.models.map(model => [
        model.id,
        model.displayName,
        model.nickname,
        model.status,
        model.statusMessage,
        model.format,
      ]),
      covers,
    })
  }

  function renderRuntime(runtime) {
    const status = elements.runtimeStatus
    status.classList.remove('is-loading', 'is-error', 'is-muted')
    if (runtime.phase === 'ready') {
      if (runtime.paused) {
        status.textContent = '角色已暂停'
        status.classList.add('is-muted')
      } else if (runtime.petVisible === false) {
        status.textContent = '角色已隐藏'
        status.classList.add('is-muted')
      } else {
        status.textContent = '角色运行中'
      }
    } else if (runtime.phase === 'error') {
      status.textContent = '角色加载失败'
      status.classList.add('is-error')
    } else if (runtime.phase === 'empty') {
      status.textContent = '角色不可用'
      status.classList.add('is-error')
    } else {
      status.textContent = '角色准备中'
      status.classList.add('is-loading')
    }
  }

  function capabilityIsReady(ai, capability) {
    if (!ai) return false
    if (ai.readyByCapability && Object.prototype.hasOwnProperty.call(ai.readyByCapability, capability)) {
      return Boolean(ai.readyByCapability[capability])
    }
    const activeIds = ai.activePluginIds || { chat: ai.activePluginId, tts: '' }
    const plugins = Array.isArray(ai.plugins) ? ai.plugins : []
    const active = plugins.find(plugin => plugin.id === activeIds[capability] && plugin.installed)
    return Boolean(active && active.configured)
  }

  function renderCompanionState(current, ai, preferences) {
    const chatReady = capabilityIsReady(ai, 'chat')
    const voiceReady = capabilityIsReady(ai, 'tts')
    const plugins = ai && Array.isArray(ai.plugins) ? ai.plugins : []
    const activeIds = ai && ai.activePluginIds ? ai.activePluginIds : { chat: '', tts: '' }
    const activeChat = plugins.find(plugin => plugin.id === activeIds.chat && plugin.installed)
    const activeVoice = plugins.find(plugin => plugin.id === activeIds.tts && plugin.installed)
    const setCapabilityStatus = (element, ready, readyText, unavailableText) => {
      element.textContent = ready ? readyText : unavailableText
      element.classList.toggle('is-ready', ready)
      element.classList.toggle('is-unavailable', !ready)
    }

    setCapabilityStatus(elements.companionChatStatus, chatReady, '文字可用', activeChat ? '文字需配置' : '文字未启用')
    setCapabilityStatus(elements.companionVoiceStatus, voiceReady, '语音可用', activeVoice ? '语音需配置' : '语音未启用')

    elements.companionPresets.querySelectorAll('[data-companion-preset]').forEach(button => {
      const preset = companionPresets[button.dataset.companionPreset]
      const selected = Boolean(preset && Object.entries(preset.preferences)
        .every(([key, value]) => preferences[key] === value))
      button.classList.toggle('is-active', selected)
      button.setAttribute('aria-pressed', String(selected))
    })
  }

  function renderToggles(preferences) {
    document.querySelectorAll('[data-setting]').forEach(input => {
      const key = input.dataset.setting
      if (key === 'cursorFollow') input.checked = preferences.cursorFollow === 'near'
      else if (key === 'effects') input.checked = preferences.effects === 'subtle'
      else if (key === 'interactionMode') input.checked = preferences.interactionMode === 'locked'
      else if (key === 'reducedMotion') input.checked = preferences.reducedMotion === 'on'
      else input.checked = Boolean(preferences[key])
    })
    elements.longMessageCharacterThreshold.value = String(normalizeLongMessageCharacterThreshold(
      preferences.longMessageCharacterThreshold
    ))

    document.querySelectorAll('[data-quality]').forEach(button => {
      button.classList.toggle('is-active', button.dataset.quality === preferences.qualityMode)
      button.setAttribute('aria-checked', String(button.dataset.quality === preferences.qualityMode))
    })
    elements.qualityDescription.textContent = qualityDescriptions[preferences.qualityMode]
    const petBackgroundDynamic = Boolean(preferences.settingsPetBackground)
    const currentModelId = snapshot && snapshot.currentModelId
    const currentStaticBackgroundUrl = currentModelId && snapshot.staticPetBackgrounds
      ? snapshot.staticPetBackgrounds[currentModelId]
      : ''
    const currentFallbackCoverUrl = currentModelId && snapshot.covers
      ? snapshot.covers[currentModelId]
      : ''
    const currentBackgroundSource = currentStaticBackgroundUrl || currentFallbackCoverUrl
    elements.petBackground.classList.toggle('is-enabled', Boolean(currentModelId))
    elements.petBackground.classList.toggle('is-dynamic', petBackgroundDynamic)
    const staticBackgroundReady = Boolean(
      currentModelId && elements.petBackground.dataset.modelId === currentModelId &&
      elements.petBackground.dataset.backgroundMode === 'static' &&
      elements.petBackground.dataset.backgroundSource === currentBackgroundSource &&
      elements.petBackground.classList.contains('is-ready')
    )
    if (!petBackgroundDynamic && !staticBackgroundReady) renderStaticPetBackground()
    else if (petBackgroundDynamic && !elements.petBackground.classList.contains('is-ready')) {
      // Keep the static cover visible while the first live frame is being prepared.
      renderStaticPetBackground()
    }

    const settingsTheme = ['glass', 'healing'].includes(preferences.settingsTheme)
      ? preferences.settingsTheme
      : 'glass'
    document.documentElement.dataset.settingsTheme = settingsTheme
    document.querySelectorAll('[data-theme-option]').forEach(input => {
      const selected = input.dataset.themeOption === settingsTheme
      input.checked = selected
      input.closest('.theme-option').classList.toggle('is-active', selected)
    })
  }

  function renderExternalMessageService(service, preferences) {
    if (!elements.externalMessageService) return
    const value = service && typeof service === 'object' ? service : {}
    const enabled = Boolean(preferences && preferences.externalMessagesEnabled)
    elements.externalMessageService.hidden = !enabled
    const status = typeof value.status === 'string' ? value.status : 'stopped'
    const statusCopy = {
      starting: '正在启动本机接入服务…',
      running: `运行中 · ${Number(value.websocketClients) || 0} 个 WebSocket 连接`,
      stopping: '正在停止接入服务…',
      stopped: enabled ? '服务尚未启动' : '服务未开启',
      error: value.error ? `启动失败：${value.error}` : '服务启动失败',
    }
    elements.externalMessageService.dataset.status = status
    elements.externalMessageServiceStatus.textContent = statusCopy[status] || statusCopy.stopped
    elements.externalMessageHttpUrl.textContent = value.messageUrl || 'http://127.0.0.1:17373/api/v1/messages'
    elements.externalMessageWebsocketUrl.textContent = value.websocketUrl || 'ws://127.0.0.1:17373/api/v1/events'
    elements.externalMessageTesterTarget.disabled = !value.running
    externalMessageTesterTargetPicker.refresh()
    elements.externalMessageOpenTester.disabled = !value.running
  }

  function setAITestStatus(ctx, message, type = '') {
    ctx.els['ai-test-status'].textContent = message
    ctx.els['ai-test-status'].classList.toggle('is-success', type === 'success')
    ctx.els['ai-test-status'].classList.toggle('is-error', type === 'error')
  }

  function setAIConfigCollapsed(ctx, collapsed) {
    if (collapsed) closeVoicePicker(ctx)
    ctx.collapsed = collapsed
    ctx.root.classList.toggle('is-collapsed', collapsed)
    ctx.els['ai-config-body'].hidden = collapsed
    ctx.els['ai-config-heading'].setAttribute('aria-expanded', String(!collapsed))
  }

  function primaryCapability(plugin) {
    return plugin && plugin.capabilities.includes('tts') ? 'tts' : 'chat'
  }

  function hideAIConfig(ctx) {
    closeVoicePicker(ctx)
    resetVoicePreview(ctx)
    ctx.editingPluginId = ''
    ctx.formDirty = false
    ctx.keyEdited = false
    ctx.root.hidden = true
    setAIConfigCollapsed(ctx, true)
  }

  function showAIConfig(plugin, force = false) {
    if (!plugin || !plugin.installed) return
    const ctx = aiPanels[primaryCapability(plugin)]
    closeVoicePicker(ctx)
    resetVoicePreview(ctx)
    ctx.root.hidden = false
    // 配置面板整体归入对应插件的卡片（分层展示）。面板按能力分组各有一份：
    // 同组内切换卡片时面板随之迁移（原卡片自动回到折叠占位），另一分组的
    // 面板位置和展开状态完全不受影响。
    const card = document.querySelector(`.ai-plugin-card[data-plugin-id="${plugin.id}"]`)
    if (card) card.querySelector('.ai-plugin-body').append(ctx.root)
    if (!force && ctx.formDirty && ctx.editingPluginId === plugin.id) return
    if (force) setAIConfigCollapsed(ctx, false)
    else if (ctx.editingPluginId !== plugin.id) setAIConfigCollapsed(ctx, true)
    ctx.editingPluginId = plugin.id
    ctx.formDirty = false
    ctx.keyEdited = false
    ctx.els['ai-config-name'].textContent = plugin.name
    const capability = primaryCapability(plugin)
    const isSpeech = capability === 'tts'
    ctx.els['ai-config-badge'].classList.toggle('is-ready', plugin.configured)
    ctx.els['ai-config-badge'].classList.toggle('is-pending', !plugin.configured)
    ctx.els['ai-config-badge'].querySelector('em').textContent = plugin.configured
      ? (isSpeech ? '可以发声' : '可以对话')
      : '待配置'
    ctx.els['ai-open-chat'].hidden = isSpeech
    ctx.els['ai-open-chat'].disabled = isSpeech || !plugin.configured
    ctx.els.primaryActions.classList.toggle('is-single', isSpeech)
    ctx.els['ai-model-label'].textContent = isSpeech ? '语音模型' : '对话模型'
    ctx.els['ai-history-field'].hidden = isSpeech
    ctx.els['ai-max-response-field'].hidden = isSpeech
    ctx.els['ai-tts-fields'].hidden = !isSpeech
    ctx.els['ai-model'].replaceChildren(...plugin.models.map(model => {
      const option = document.createElement('option')
      option.value = model
      option.textContent = model
      option.dataset.primary = model
      option.selected = model === plugin.config.model
      return option
    }))
    ctx.modelSelect.refresh()
    ctx.els['ai-history-limit'].value = plugin.config.historyLimit
    ctx.els['ai-max-response-chars'].value = plugin.config.maxResponseChars
    setVoiceCatalog(ctx, plugin.voices || [], plugin.config.voice)
    updateVoicePreviewAvailability(ctx)
    ctx.els['ai-speed'].value = plugin.config.speed
    ctx.els['ai-volume'].value = plugin.config.volume
    ctx.els['ai-speed'].closest('.ai-field-pair').hidden = isSpeech && plugin.ttsTuning === false
    ctx.els['ai-tts-folder-note'].textContent = snapshot && snapshot.ai && snapshot.ai.ttsDirectory
      ? `语音存档：${snapshot.ai.ttsDirectory}`
      : '生成的语音会保存在应用数据目录。'
    const usesDotEnv = plugin.credentialSource === 'dotenv'
    const usesSystemEnvironment = plugin.credentialSource === 'environment'
    const usesManagedEnvironment = usesDotEnv || usesSystemEnvironment
    ctx.els['ai-api-key'].disabled = usesManagedEnvironment
    ctx.els['ai-api-key'].type = 'text'
    ctx.els['ai-api-key'].value = plugin.credentialPreview || ''
    ctx.els['ai-api-key'].dataset.preview = plugin.credentialPreview || ''
    ctx.els['ai-use-environment'].hidden = true
    ctx.els['ai-use-environment'].disabled = false
    ctx.els['ai-use-environment'].textContent = '切回环境变量'
    if (usesDotEnv) {
      ctx.els['ai-api-key'].placeholder = `项目 .env：${plugin.apiKeyEnv}`
      ctx.els['ai-key-hint'].textContent = `当前优先使用项目 .env 中的 ${plugin.apiKeyEnv}；修改后请重启应用。`
    } else if (usesSystemEnvironment) {
      ctx.els['ai-api-key'].placeholder = `系统环境变量 ${plugin.apiKeyEnv}`
      ctx.els['ai-key-hint'].textContent = `项目 .env 未配置该项，当前使用系统环境变量 ${plugin.apiKeyEnv}。`
    } else {
      ctx.els['ai-api-key'].placeholder = plugin.credentialSource === 'local'
        ? '输入新 Key 可替换当前配置'
        : `粘贴你的 ${plugin.name} API Key`
      ctx.els['ai-key-hint'].textContent = plugin.credentialSource === 'local'
        ? (plugin.environmentAvailable
            ? `当前使用本机加密 Key；环境变量 ${plugin.apiKeyEnv} 可用。`
            : '当前使用本机加密 Key；页面仅显示脱敏预览。')
        : `项目 .env 与系统环境变量均未检测到 ${plugin.apiKeyEnv || 'API Key'}，可在这里临时配置。`
    }
    setAITestStatus(ctx, plugin.configured
      ? `配置已就绪，可保存当前设置并测试${isSpeech ? '语音' : '连接'}。`
      : `需要配置 API Key 后才能使用${isSpeech ? '语音' : '对话'}。`)
  }

  function readAIConfigFields(ctx) {
    return {
      model: ctx.els['ai-model'].value,
      historyLimit: Number(ctx.els['ai-history-limit'].value),
      maxResponseChars: Number(ctx.els['ai-max-response-chars'].value),
      voice: ctx.els['ai-voice'].value,
      speed: Number(ctx.els['ai-speed'].value),
      volume: Number(ctx.els['ai-volume'].value),
    }
  }

  async function submitAIConfig(ctx, event) {
    event.preventDefault()
    const plugin = snapshot && snapshot.ai && snapshot.ai.plugins.find(item => item.id === ctx.editingPluginId)
    if (!plugin) return
    const apiKey = ctx.keyEdited ? ctx.els['ai-api-key'].value.trim() : ''
    if (!apiKey && plugin.credentialSource === 'missing') {
      setAITestStatus(ctx, `请在项目 .env 中填写 ${plugin.apiKeyEnv}，或设置同名系统环境变量后重启应用。`, 'error')
      ctx.els['ai-api-key'].focus()
      return
    }

    ctx.els['ai-save-test'].disabled = true
    ctx.els['ai-save-test-label'].textContent = '正在测试…'
    const capability = primaryCapability(plugin)
    setAITestStatus(ctx, `正在保存配置并测试${capability === 'tts' ? '语音生成' : plugin.name}…`)
    try {
      const configured = await api.configureAIPlugin(plugin.id, {
        ...readAIConfigFields(ctx),
        apiKey,
      })
      if (!configured || !configured.ok) throw new Error(configured && configured.error ? configured.error : '配置保存失败')
      snapshot.ai = configured.ai
      ctx.formDirty = false
      ctx.keyEdited = false
      renderAI(configured.ai)
      const tested = await api.testAIPlugin(plugin.id)
      if (!tested || !tested.ok) throw new Error(tested && tested.error ? tested.error : '连接测试失败')
      if (capability === 'tts' && tested.audioBase64) {
        const previewAudio = new Audio(`data:${tested.mimeType || 'audio/wav'};base64,${tested.audioBase64}`)
        previewAudio.play().catch(error => console.warn('TTS preview failed:', error.message))
      }
      setAITestStatus(ctx, capability === 'tts'
        ? `语音生成成功 · ${tested.model} · ${tested.voice}`
        : `连接成功 · ${tested.model}`, 'success')
      showToast(`${plugin.name} 已可以使用`)
    } catch (error) {
      setAITestStatus(ctx, error.message || '连接失败，请检查配置', 'error')
    } finally {
      ctx.els['ai-save-test'].disabled = false
      ctx.els['ai-save-test-label'].textContent = '保存并测试'
    }
  }

  function createAIConfigPanel(capability) {
    const fragment = elements.aiConfigTemplate.content.cloneNode(true)
    const root = fragment.querySelector('.ai-config-panel')
    // 面板按能力分组各实例化一份，模板内的 id / for / aria 引用统一加
    // 分组前缀，避免两个实例间的 id 冲突。
    const prefix = `${capability}-`
    root.querySelectorAll('[id]').forEach(el => {
      el.dataset.aiEl = el.id
      el.id = prefix + el.id
    })
    root.querySelectorAll('[for]').forEach(el => el.setAttribute('for', prefix + el.getAttribute('for')))
    root.querySelectorAll('[aria-controls]').forEach(el => el.setAttribute('aria-controls', prefix + el.getAttribute('aria-controls')))
    root.querySelectorAll('[aria-describedby]').forEach(el => el.setAttribute('aria-describedby', prefix + el.getAttribute('aria-describedby')))

    const els = { primaryActions: root.querySelector('.ai-primary-actions') }
    root.querySelectorAll('[data-ai-el]').forEach(el => { els[el.dataset.aiEl] = el })
    const ctx = {
      capability,
      root,
      els,
      editingPluginId: '',
      formDirty: false,
      keyEdited: false,
      collapsed: true,
      previewAudio: null,
      previewUrl: '',
      voiceCatalog: [],
    }
    ctx.modelSelect = window.SearchSelect.enhance(els['ai-model'])
    ctx.voiceSelect = window.SearchSelect.enhance(els['ai-voice'])

    els['ai-config-heading'].addEventListener('click', () => setAIConfigCollapsed(ctx, !ctx.collapsed))
    els['ai-config-heading'].addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setAIConfigCollapsed(ctx, !ctx.collapsed)
      }
    })

    for (const field of [els['ai-model'], els['ai-history-limit'], els['ai-max-response-chars'], els['ai-voice'], els['ai-speed'], els['ai-volume']]) {
      field.addEventListener('input', () => { ctx.formDirty = true })
      field.addEventListener('change', () => { ctx.formDirty = true })
    }

    els['ai-voice'].addEventListener('change', () => {
      resetVoicePreview(ctx)
      updateVoicePreviewAvailability(ctx)
    })
    els['ai-voice-preview'].addEventListener('click', () => toggleVoicePreview(ctx))

    els['ai-api-key'].addEventListener('focus', () => {
      if (!ctx.keyEdited) {
        els['ai-api-key'].type = 'password'
        els['ai-api-key'].value = ''
        els['ai-api-key'].placeholder = '输入新的 API Key'
      }
    })
    els['ai-api-key'].addEventListener('input', () => {
      els['ai-api-key'].type = 'password'
      ctx.keyEdited = true
      ctx.formDirty = true
    })
    els['ai-api-key'].addEventListener('keydown', event => {
      if (event.key !== 'Enter') return
      event.preventDefault()
    })
    els['ai-api-key'].addEventListener('blur', () => {
      if (!ctx.keyEdited && !els['ai-api-key'].value) {
        els['ai-api-key'].type = 'text'
        els['ai-api-key'].value = els['ai-api-key'].dataset.preview || ''
      }
      const plugin = snapshot && snapshot.ai && snapshot.ai.plugins.find(item => item.id === ctx.editingPluginId)
      const canReturnToEnvironment = Boolean(plugin && plugin.environmentAvailable && (
        plugin.credentialSource === 'local' || ctx.keyEdited
      ))
      els['ai-use-environment'].hidden = !canReturnToEnvironment
      if (canReturnToEnvironment && ctx.keyEdited && plugin.credentialSource === 'environment') {
        els['ai-key-hint'].textContent = `新 Key 尚未保存；环境变量 ${plugin.apiKeyEnv} 仍可用。`
      }
    })

    els['ai-use-environment'].addEventListener('click', async () => {
      const plugin = snapshot && snapshot.ai && snapshot.ai.plugins.find(item => item.id === ctx.editingPluginId)
      if (!plugin || !plugin.environmentAvailable) {
        setAITestStatus(ctx, `未检测到环境变量 ${plugin ? plugin.apiKeyEnv : ''}，无法切换。`, 'error')
        return
      }
      els['ai-use-environment'].disabled = true
      setAITestStatus(ctx, `正在切换到环境变量 ${plugin.apiKeyEnv}…`)
      try {
        const configured = await api.configureAIPlugin(plugin.id, {
          ...readAIConfigFields(ctx),
          credentialPreference: 'environment',
        })
        if (!configured || !configured.ok) throw new Error(configured && configured.error ? configured.error : '凭据来源切换失败')
        snapshot.ai = configured.ai
        ctx.formDirty = false
        ctx.keyEdited = false
        renderAI(configured.ai)
        setAITestStatus(ctx, `已改用环境变量 ${plugin.apiKeyEnv}；本机保存的 Key 已清除。`, 'success')
        showToast(`${plugin.name} 已改用环境变量`)
      } catch (error) {
        els['ai-use-environment'].disabled = false
        setAITestStatus(ctx, error.message || '凭据来源切换失败', 'error')
      }
    })

    root.addEventListener('submit', event => submitAIConfig(ctx, event))
    els['ai-open-chat'].addEventListener('click', api.openAIChat)
    return ctx
  }

  function createAIPluginCard(plugin) {
    const card = document.createElement('article')
    const capability = primaryCapability(plugin)
    const active = plugin.activeCapabilities.includes(capability)
    card.className = `ai-plugin-card${plugin.installed ? ' is-installed' : ''}${active ? ' is-active' : ''}`
    card.dataset.pluginId = plugin.id

    const head = document.createElement('div')
    head.className = 'ai-plugin-head'

    const mark = document.createElement('span')
    mark.className = 'plugin-mark'
    mark.textContent = plugin.shortName || plugin.name.slice(0, 3).toUpperCase()

    const copy = document.createElement('div')
    copy.className = 'plugin-copy'
    const name = document.createElement('strong')
    name.textContent = `${plugin.name} · v${plugin.version}`
    const description = document.createElement('small')
    description.textContent = plugin.installed
      ? (plugin.configured
          ? (capability === 'tts' ? '已安装，可以生成语音并驱动口型' : '已安装，可以开始文字对话')
          : '已安装，等待配置 API Key')
      : plugin.description
    const detail = document.createElement('small')
    detail.className = 'plugin-detail'
    detail.textContent = capability === 'tts'
      ? '把回复合成为语音并驱动 Live2D 口型；生成的音频会自动保存到外部数据目录。'
      : '负责理解消息和生成回复；DeepSeek 与 GLM 同时安装时也只会启用其中一个。'
    copy.append(name, description, detail)

    const action = document.createElement('button')
    action.type = 'button'
    action.className = 'plugin-action'
    if (plugin.installed) {
      action.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.1 10.9c.1-.3.1-.6.1-.9s0-.6-.1-.9l1.8-1.4-1.6-2.8-2.2.9c-.5-.4-1-.7-1.6-.9L12.2 2H9l-.4 2.9c-.6.2-1.1.5-1.6.9l-2.2-.9-1.6 2.8L5 9.1c-.1.3-.1.6-.1.9s0 .6.1.9l-1.8 1.4 1.6 2.8 2.2-.9c.5.4 1 .7 1.6.9L9 18h3.2l.4-2.9c.6-.2 1.1-.5 1.6-.9l2.2.9 1.6-2.8z"/><circle cx="10.6" cy="10" r="2.4"/></svg><span>配置</span>'
    } else {
      action.textContent = '安装'
    }
    action.addEventListener('click', async () => {
      if (plugin.installed) {
        showAIConfig(plugin, true)
        return
      }
      action.disabled = true
      action.textContent = '安装中…'
      const result = await api.installAIPlugin(plugin.id)
      if (!result || !result.ok) {
        action.disabled = false
        action.textContent = '重试'
        showToast(result && result.error ? result.error : '插件安装失败')
        return
      }
      snapshot.ai = result.ai
      renderAI(result.ai)
      const installedPlugin = result.ai.plugins.find(item => item.id === plugin.id)
      if (installedPlugin) showAIConfig(installedPlugin, true)
      showToast(`${plugin.name} 已安装`)
    })

    const badges = document.createElement('div')
    badges.className = 'plugin-card-badges'
    const provider = document.createElement('span')
    provider.className = 'plugin-provider-badge'
    provider.textContent = plugin.id === 'deepseek'
      ? 'DeepSeek'
      : (plugin.id === 'qwen-tts'
          ? '阿里云百炼'
          : (capability === 'tts' ? '智谱 GLM-TTS' : '智谱'))
    badges.appendChild(provider)

    const chevron = document.createElement('span')
    chevron.className = 'plugin-card-chevron'
    chevron.setAttribute('aria-hidden', 'true')
    chevron.innerHTML = '<svg viewBox="0 0 16 16"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg>'

    const headActions = document.createElement('div')
    headActions.className = 'plugin-head-actions'
    if (plugin.installed && plugin.configured) {
      const activeAction = document.createElement('button')
      activeAction.type = 'button'
      activeAction.className = `plugin-select-action${active ? ' is-active' : ''}`
      const renderActiveActionState = (isPending = false) => {
        activeAction.dataset.state = isPending ? 'pending' : (active ? 'active' : 'inactive')
        activeAction.setAttribute('aria-busy', String(isPending))
        if (isPending) {
          activeAction.innerHTML = '<svg class="plugin-state-icon is-spinner" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="M10 3.5a6.5 6.5 0 0 1 6.5 6.5"/></svg><span>处理中</span>'
          return
        }
        activeAction.innerHTML = active
          ? '<svg class="plugin-state-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.8v7.1"/><path d="M6.2 5.3a6 6 0 1 0 7.6 0"/></svg><span>停用</span>'
          : '<svg class="plugin-state-icon is-play" viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4.8 7.8 5.2L7 15.2z"/></svg><span>启用</span>'
      }
      renderActiveActionState()
      activeAction.setAttribute('aria-label', `${active ? '停用' : '启用'} ${plugin.name}`)
      activeAction.setAttribute('aria-pressed', String(active))
      activeAction.addEventListener('click', async () => {
        activeAction.disabled = true
        renderActiveActionState(true)
        const result = active
          ? await api.deactivateAIPlugin(plugin.id, capability)
          : await api.activateAIPlugin(plugin.id, capability)
        if (!result || !result.ok) {
          activeAction.disabled = false
          renderActiveActionState()
          showToast(result && result.error ? result.error : `模型${active ? '停用' : '启用'}失败`)
          return
        }
        snapshot.ai = result.ai
        renderAI(result.ai)
        showToast(`已${active ? '停用' : '启用'} ${plugin.name}`)
      })
      headActions.appendChild(activeAction)
    }
    headActions.appendChild(action)

    head.append(mark, copy, badges, chevron, headActions)

    // 配置面板挂载槽：插件安装后，设置表单作为一个整体归入该卡片
    const body = document.createElement('div')
    body.className = 'ai-plugin-body'

    card.append(head, body)
    return card
  }

  function renderAI(ai) {
    const plugins = ai && Array.isArray(ai.plugins) ? ai.plugins : []
    const chatPlugins = plugins.filter(plugin => plugin.capabilities.includes('chat'))
    const ttsPlugins = plugins.filter(plugin => plugin.capabilities.includes('tts'))
    const renderGroup = (container, groupPlugins, emptyText) => {
      container.replaceChildren(...groupPlugins.map(createAIPluginCard))
      if (groupPlugins.length) return
      const empty = document.createElement('p')
      empty.className = 'section-intro'
      empty.textContent = emptyText
      container.appendChild(empty)
    }
    renderGroup(elements.aiChatPluginList, chatPlugins, '当前安装包中没有可用的文本模型。')
    renderGroup(elements.aiTtsPluginList, ttsPlugins, '当前安装包中没有可用的语音模型。')
    const activeIds = ai && ai.activePluginIds ? ai.activePluginIds : { chat: ai && ai.activePluginId, tts: '' }
    const activeChat = chatPlugins.find(plugin => plugin.id === activeIds.chat && plugin.installed)
    const activeTts = ttsPlugins.find(plugin => plugin.id === activeIds.tts && plugin.installed)
    elements.aiChatActive.textContent = activeChat
      ? `${activeChat.name}${activeChat.configured ? '' : ' · 待配置'}`
      : '未启用'
    elements.aiTtsActive.textContent = activeTts
      ? `${activeTts.name}${activeTts.configured ? '' : ' · 待配置'}`
      : '未启用'
    elements.aiChatActive.classList.toggle('is-ready', Boolean(activeChat && activeChat.configured))
    elements.aiTtsActive.classList.toggle('is-ready', Boolean(activeTts && activeTts.configured))
    // 各分组的配置面板独立归位：继续编辑本组原插件，否则挂到本组启用的
    // 插件上；另一分组的面板保持原位、原展开状态。
    const reconcilePanel = (capability, fallback) => {
      const ctx = aiPanels[capability]
      const plugin = plugins.find(item => item.id === ctx.editingPluginId && item.installed) || fallback
      if (plugin) showAIConfig(plugin)
      else hideAIConfig(ctx)
    }
    reconcilePanel('chat', activeChat)
    reconcilePanel('tts', activeTts)
  }

  function render(nextSnapshot) {
    const previousModelId = snapshot && snapshot.currentModelId
    if (previousModelId && previousModelId !== nextSnapshot.currentModelId) {
      // 模型选择变化时，旧背景帧必须立即消失。后续只有带有相同模型 ID
      // 的新帧才能重新显示，避免视频宠物残帧套用普通模型的缩放规则。
      clearPetBackgroundFrame()
    }
    snapshot = nextSnapshot
    const current = snapshot.models.find(model => model.id === snapshot.currentModelId)
    const preferences = snapshot.preferences

    renderHeroModelName(current ? current.displayName : '暂无角色')
    elements.heroModelScript.textContent = `${current ? current.displayName : 'Companion'} ♡`
    elements.currentModelSource.textContent = current && current.nickname ? `模型：${current.name}` : ''
    elements.currentModelSource.hidden = !(current && current.nickname)
    elements.modelNickname.value = current ? current.nickname : ''
    elements.modelNickname.disabled = !current
    const readyModelCount = snapshot.models.filter(model => model.status === 'ready').length
    const unavailableModelCount = snapshot.models.length - readyModelCount
    elements.modelCount.textContent = unavailableModelCount
      ? `${readyModelCount} 个可用 · ${unavailableModelCount} 个不兼容`
      : `${readyModelCount} 个可用`
    elements.modelReveal.disabled = !current
    elements.modelReveal.title = current ? `定位到当前角色：${current.displayName}` : '当前没有可定位的角色'
    elements.appVersion.textContent = `v${snapshot.appVersion}`
    if (elements.modelsFolderPath) elements.modelsFolderPath.textContent = snapshot.modelsFolder || ''
    if (elements.pluginsFolderPath) elements.pluginsFolderPath.textContent = snapshot.pluginsFolder || ''
    const nextModelListKey = modelListRenderKey(snapshot)
    if (nextModelListKey !== renderedModelListKey) {
      const previousScrollLeft = elements.modelList.scrollLeft
      elements.modelList.replaceChildren(...snapshot.models.map(model => createModelCard(model, snapshot.currentModelId, snapshot.runtime, snapshot.covers)))
      renderModelPagination()
      renderedModelListKey = nextModelListKey
      if (previousModelId && previousModelId === snapshot.currentModelId) {
        requestAnimationFrame(() => {
          const maximum = Math.max(0, elements.modelList.scrollWidth - elements.modelList.clientWidth)
          elements.modelList.scrollLeft = Math.min(previousScrollLeft, maximum)
          updateModelPagination()
        })
      }
    }
    if (document.activeElement !== elements.chatGreeting) {
      elements.chatGreeting.value = preferences.chatGreeting || ''
    }
    elements.chatGreetingCount.textContent = `${elements.chatGreeting.value.length} / 200`
    updateGreetingPresetSelection()
    setScaleDisplay(preferences.scale)
    setOpacityDisplay(preferences.opacity)
    elements.scaleApplyAll.checked = preferences.scaleApplyToAll === true
    elements.opacityApplyAll.checked = preferences.opacityApplyToAll === true
    elements.scaleApplyAll.disabled = !current
    elements.opacityApplyAll.disabled = !current
    renderRuntime(snapshot.runtime)
    renderCompanionState(current, snapshot.ai, preferences)
    if (previousModelId && previousModelId !== snapshot.currentModelId) {
      profileEditingModelId = ''
      for (const kind of ['action', 'expression']) {
        if (profilePreviewTimers[kind]) clearTimeout(profilePreviewTimers[kind])
        profilePreviewTimers[kind] = null
      }
      elements.profileBasicForm.hidden = true
      elements.profileBasicDisplay.hidden = false
    }
    renderCharacterProfile(current)
    renderToggles(preferences)
    renderShortcuts(preferences)
    renderExternalMessageService(snapshot.externalMessages, preferences)
    renderBubbleStylePicker(preferences, current)
    renderAI(snapshot.ai)
    if (!previousModelId || previousModelId !== snapshot.currentModelId) {
      revealSelectedModel(previousModelId ? 'smooth' : 'auto')
    }
  }

  async function savePreference(patch, successMessage) {
    try {
      const next = await api.updatePreferences(patch)
      render(next)
      if (successMessage) showToast(successMessage)
    } catch (error) {
      showToast('设置保存失败')
      console.error(error)
    }
  }

  async function flushModelScaleSave() {
    if (scaleSaveTimer) {
      clearTimeout(scaleSaveTimer)
      scaleSaveTimer = null
    }
    if (scaleSavePromise) await scaleSavePromise
    if (!pendingScaleSave) return
    const pending = pendingScaleSave
    pendingScaleSave = null
    scaleSavePromise = (async () => {
      try {
        const result = await api.updateModelScale(pending.modelId, pending.scale)
        if (!result || !result.ok) showToast(result && result.error ? result.error : '角色尺寸保存失败')
      } catch (error) {
        showToast('角色尺寸保存失败')
        console.error(error)
      }
    })()
    try {
      await scaleSavePromise
    } finally {
      scaleSavePromise = null
    }
  }

  async function flushModelOpacitySave() {
    if (opacitySaveTimer) {
      clearTimeout(opacitySaveTimer)
      opacitySaveTimer = null
    }
    if (opacitySavePromise) await opacitySavePromise
    if (!pendingOpacitySave) return
    const pending = pendingOpacitySave
    pendingOpacitySave = null
    opacitySavePromise = (async () => {
      try {
        const result = await api.updateModelOpacity(pending.modelId, pending.opacity)
        if (!result || !result.ok) showToast(result && result.error ? result.error : '角色不透明度保存失败')
      } catch (error) {
        showToast('角色不透明度保存失败')
        console.error(error)
      }
    })()
    try {
      await opacitySavePromise
    } finally {
      opacitySavePromise = null
    }
  }

  document.querySelectorAll('.section-tab').forEach(button => {
    button.addEventListener('click', () => {
      setActiveSection(button.dataset.section)
      // 设置页会持续展示桌宠实时画面；切页后立刻重新推送当前光标，
      // 不让跟随效果依赖下一次大幅移动或点击角色才恢复。
      api.refreshCursorFollow()
    })
  })

  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !elements.shortcutDialog.hidden) {
      event.preventDefault()
      closeShortcutDialog()
    }
  })

  elements.companionPresets.addEventListener('click', event => {
    const button = event.target.closest('[data-companion-preset]')
    if (!button) return
    const preset = companionPresets[button.dataset.companionPreset]
    if (!preset) return
    savePreference(
      { ...preset.preferences },
      `已切换为${preset.label}，可在「行为」中继续细调`
    )
  })

  document.getElementById('minimize-window').addEventListener('click', api.minimizeWindow)
  document.getElementById('close-window').addEventListener('click', api.closeWindow)
  document.getElementById('quit-app').addEventListener('click', api.quitApp)

  const contactDialog = {
    root: document.getElementById('contact-author-dialog'),
    card: document.querySelector('#contact-author-dialog .contact-author-card'),
    open: document.getElementById('contact-author-open'),
    close: document.getElementById('contact-author-close'),
  }
  let contactReturnFocus = null

  function openContactDialog() {
    contactReturnFocus = document.activeElement
    contactDialog.root.hidden = false
    document.documentElement.classList.add('has-contact-dialog')
    requestAnimationFrame(() => contactDialog.close.focus())
  }

  function closeContactDialog() {
    if (contactDialog.root.hidden) return
    contactDialog.root.hidden = true
    document.documentElement.classList.remove('has-contact-dialog')
    if (toastTimer) {
      clearTimeout(toastTimer)
      toastTimer = null
    }
    elements.toast.classList.remove('is-visible')
    if (contactReturnFocus && typeof contactReturnFocus.focus === 'function') contactReturnFocus.focus()
    contactReturnFocus = null
  }

  contactDialog.open.addEventListener('click', openContactDialog)
  contactDialog.close.addEventListener('click', closeContactDialog)
  contactDialog.root.addEventListener('click', event => {
    if (event.target === contactDialog.root) closeContactDialog()
  })
  contactDialog.root.querySelectorAll('[data-contact-url]').forEach(button => {
    button.addEventListener('click', async () => {
      const opened = await api.openExternalUrl(button.dataset.contactUrl)
      if (!opened) showToast('暂时无法打开该联系方式')
    })
  })
  contactDialog.root.querySelectorAll('[data-contact-copy]').forEach(button => {
    button.addEventListener('click', async () => {
      const copied = await api.copyText(button.dataset.contactCopy)
      showToast(copied ? '邮箱已复制' : '复制失败，请手动复制')
    })
  })
  document.addEventListener('keydown', event => {
    if (contactDialog.root.hidden) return
    if (event.key === 'Escape') {
      event.preventDefault()
      closeContactDialog()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...contactDialog.card.querySelectorAll('button:not([disabled])')]
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  })

  elements.chatGreeting.addEventListener('input', () => {
    elements.chatGreetingCount.textContent = `${elements.chatGreeting.value.length} / 200`
    updateGreetingPresetSelection()
  })

  elements.chatGreetingPresets.addEventListener('click', event => {
    const button = event.target.closest('[data-greeting]')
    if (!button) return
    elements.chatGreeting.value = button.dataset.greeting
    elements.chatGreeting.dispatchEvent(new Event('input', { bubbles: true }))
    elements.chatGreeting.focus()
  })

  document.getElementById('chat-greeting-form').addEventListener('submit', event => {
    event.preventDefault()
    savePreference({ chatGreeting: elements.chatGreeting.value }, '聊天开场白已保存')
  })

  elements.bubbleStyleOptions.addEventListener('click', async event => {
    const button = event.target.closest('[data-bubble-style]')
    if (!button || !snapshot) return
    const theme = bubbleThemeFor(snapshot.preferences)
    const styleId = button.dataset.bubbleStyle
    if (styleId === selectedBubbleStyle(snapshot.preferences, theme)) return
    const previousStyles = { ...(snapshot.preferences.bubbleStyles || {}) }
    const nextStyles = { ...previousStyles, [theme]: styleId }
    snapshot.preferences.bubbleStyles = nextStyles
    const current = snapshot.models.find(model => model.id === snapshot.currentModelId)
    renderBubbleStylePicker(snapshot.preferences, current)
    try {
      const next = await api.updatePreferences({ bubbleStyles: nextStyles })
      render(next)
      const definition = bubbleThemeDefinition(theme)
      const selected = definition.styles.find(style => style.id === styleId)
      showToast((selected ? selected.name : '气泡样式') + '已应用')
    } catch (error) {
      snapshot.preferences.bubbleStyles = previousStyles
      renderBubbleStylePicker(snapshot.preferences, current)
      showToast('气泡样式保存失败')
      console.error(error)
    }
  })

  let bubbleStyleCarouselTarget = null

  function moveBubbleStyleCarousel(direction) {
    const scroller = elements.bubbleStyleOptions
    const maximum = Math.max(0, scroller.scrollWidth - scroller.clientWidth)
    if (!maximum) return
    const dots = [...elements.bubbleStylePagination.children]
    const pageCount = Math.max(1, dots.length)
    const currentPage = pageCount === 1
      ? 0
      : Math.round((scroller.scrollLeft / maximum) * (pageCount - 1))
    const nextPage = (currentPage + direction + pageCount) % pageCount
    const target = pageCount === 1 ? 0 : maximum * nextPage / (pageCount - 1)
    bubbleStyleCarouselTarget = { page: nextPage, left: target }
    dots.forEach((dot, index) => dot.classList.toggle('is-active', index === nextPage))
    scroller.scrollTo({ left: target, behavior: 'smooth' })
  }

  function updateBubbleStylePagination() {
    const scroller = elements.bubbleStyleOptions
    const dots = [...elements.bubbleStylePagination.children]
    if (!dots.length) return
    const maximum = Math.max(0, scroller.scrollWidth - scroller.clientWidth)
    if (bubbleStyleCarouselTarget) {
      dots.forEach((dot, index) => dot.classList.toggle('is-active', index === bubbleStyleCarouselTarget.page))
      if (Math.abs(scroller.scrollLeft - bubbleStyleCarouselTarget.left) <= 2) bubbleStyleCarouselTarget = null
      return
    }
    const activePage = maximum && dots.length > 1
      ? Math.round((scroller.scrollLeft / maximum) * (dots.length - 1))
      : 0
    dots.forEach((dot, index) => dot.classList.toggle('is-active', index === activePage))
  }

  elements.bubbleStylePrevious.addEventListener('click', () => moveBubbleStyleCarousel(-1))
  elements.bubbleStyleNext.addEventListener('click', () => moveBubbleStyleCarousel(1))
  elements.bubbleStyleOptions.addEventListener('scroll', updateBubbleStylePagination, { passive: true })
  elements.bubbleStyleOptions.addEventListener('wheel', event => {
    if (!elements.bubbleStyleCustomizer.classList.contains('has-overflow')) return
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    event.preventDefault()
    elements.bubbleStyleOptions.scrollLeft += event.deltaY
  }, { passive: false })

  elements.modelReveal.addEventListener('click', () => {
    if (!snapshot || !snapshot.currentModelId) return
    elements.modelList.classList.remove('is-free-scrolling')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    revealSelectedModel(reducedMotion ? 'auto' : 'smooth')
  })

  elements.modelNext.addEventListener('click', () => {
    const maximum = Math.max(0, elements.modelList.scrollWidth - elements.modelList.clientWidth)
    const atEnd = elements.modelList.scrollLeft >= maximum - 2
    const target = atEnd ? 0 : Math.min(maximum, elements.modelList.scrollLeft + elements.modelList.clientWidth * 0.82)
    elements.modelList.scrollTo({ left: target, behavior: 'smooth' })
  })

  elements.modelList.addEventListener('scroll', updateModelPagination, { passive: true })

  elements.modelList.addEventListener('click', async event => {
    if (event.target.closest('.model-sort-handle')) {
      event.preventDefault()
      return
    }
    if (performance.now() < suppressModelClickUntil) {
      event.preventDefault()
      return
    }
    const button = event.target.closest('.model-card')
    if (!button || button.disabled || button.dataset.modelId === snapshot.currentModelId) return
    const targetModelId = button.dataset.modelId
    document.querySelectorAll('.model-card').forEach(option => { option.disabled = true })
    try {
      await flushModelScaleSave()
      await flushModelOpacitySave()
      const result = await api.selectModel(targetModelId)
      if (result && result.snapshot) render(result.snapshot)
    } catch (error) {
      showToast('角色切换失败')
      console.error(error)
    }
  })

  elements.modelList.addEventListener('dragstart', event => {
    const handle = event.target.closest('.model-sort-handle')
    const card = handle && handle.closest('.model-card')
    if (!card || !handle.draggable) {
      event.preventDefault()
      return
    }
    sortingModelId = card.dataset.modelId
    suppressModelClickUntil = performance.now() + 600
    card.classList.add('is-drag-source')
    elements.modelList.classList.add('is-sorting', 'is-free-scrolling')
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', sortingModelId)
    event.dataTransfer.setDragImage(card, Math.round(card.offsetWidth / 2), 22)
  })

  elements.modelList.addEventListener('dragover', event => {
    if (!sortingModelId) return
    const source = elements.modelList.querySelector(`.model-card[data-model-id="${CSS.escape(sortingModelId)}"]`)
    const target = event.target.closest('.model-card')
    if (!source || !target || target === source) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = target.getBoundingClientRect()
    if (event.clientX < rect.left + rect.width / 2) target.before(source)
    else target.after(source)
    updateModelPagination()
  })

  elements.modelList.addEventListener('drop', event => {
    if (sortingModelId) event.preventDefault()
  })

  elements.modelList.addEventListener('dragend', async () => {
    if (!sortingModelId) return
    sortingModelId = ''
    suppressModelClickUntil = performance.now() + 450
    elements.modelList.classList.remove('is-sorting', 'is-free-scrolling')
    elements.modelList.querySelectorAll('.model-card').forEach(card => card.classList.remove('is-drag-source'))
    const nextOrder = [...elements.modelList.querySelectorAll('.model-card')].map(card => card.dataset.modelId)
    const previousOrder = snapshot.models.map(model => model.id)
    if (nextOrder.every((id, index) => id === previousOrder[index])) return
    try {
      const result = await api.reorderModels(nextOrder)
      if (!result || !result.ok) {
        if (result && result.snapshot) render(result.snapshot)
        showToast(result && result.error ? result.error : '角色顺序保存失败')
        return
      }
      render(result.snapshot)
      showToast('角色顺序已保存')
    } catch (error) {
      renderedModelListKey = ''
      render(snapshot)
      showToast('角色顺序保存失败')
      console.error(error)
    }
  })

  // 桌面端也使用类似触屏轮播的拖拽手感：横向跟手移动，松开后吸附到最近的卡片。
  elements.modelList.addEventListener('pointerdown', event => {
    if (event.target.closest('.model-sort-handle')) return
    if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return
    if (elements.modelList.scrollWidth <= elements.modelList.clientWidth) return
    modelSliderPointerId = event.pointerId
    modelSliderStartX = event.clientX
    modelSliderStartY = event.clientY
    modelSliderStartScrollLeft = elements.modelList.scrollLeft
    modelSliderAxis = ''
    modelSliderMoved = false
  })

  window.addEventListener('pointermove', event => {
    if (event.pointerId !== modelSliderPointerId) return
    const deltaX = event.clientX - modelSliderStartX
    const deltaY = event.clientY - modelSliderStartY
    if (!modelSliderAxis) {
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 5) return
      modelSliderAxis = Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y'
      if (modelSliderAxis === 'y') {
        suppressModelClickUntil = performance.now() + 300
        elements.modelList.classList.remove('is-dragging', 'is-free-scrolling')
        if (elements.modelList.hasPointerCapture(event.pointerId)) elements.modelList.releasePointerCapture(event.pointerId)
        modelSliderPointerId = null
        return
      }
    }
    if (modelSliderAxis !== 'x') return
    if (!modelSliderMoved) {
      modelSliderMoved = true
      elements.modelList.classList.add('is-dragging', 'is-free-scrolling')
      elements.modelList.setPointerCapture(event.pointerId)
    }
    event.preventDefault()
    elements.modelList.scrollLeft = modelSliderStartScrollLeft - deltaX
  })

  function finishModelSliderDrag(event) {
    if (event.pointerId !== modelSliderPointerId) return
    const shouldSnap = modelSliderMoved
    if (elements.modelList.hasPointerCapture(event.pointerId)) elements.modelList.releasePointerCapture(event.pointerId)
    elements.modelList.classList.remove('is-dragging', 'is-free-scrolling')
    modelSliderPointerId = null
    modelSliderAxis = ''
    modelSliderMoved = false
    if (!shouldSnap) return
    suppressModelClickUntil = performance.now() + 300
    event.preventDefault()
    snapModelSlider()
  }

  window.addEventListener('pointerup', finishModelSliderDrag)
  window.addEventListener('pointercancel', finishModelSliderDrag)

  document.getElementById('model-nickname-form').addEventListener('submit', async event => {
    event.preventDefault()
    const modelId = snapshot && snapshot.currentModelId
    if (!modelId) return
    const result = await api.updateModelNickname(modelId, elements.modelNickname.value)
    if (!result || !result.ok) {
      showToast(result && result.error ? result.error : '昵称保存失败')
      return
    }
    render(result.snapshot)
    showToast(elements.modelNickname.value.trim() ? '昵称已保存' : '已恢复模型原名')
  })

  elements.characterProfileToggle.addEventListener('click', () => {
    setCharacterProfileCollapsed(!profilePanelCollapsed)
  })

  document.querySelector('.character-profile-tabs').addEventListener('click', event => {
    const button = event.target.closest('[data-profile-tab]')
    if (button) setProfileTab(button.dataset.profileTab)
  })

  document.querySelector('.character-profile-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const tabs = [...document.querySelectorAll('[data-profile-tab]')]
    const currentIndex = Math.max(0, tabs.findIndex(button => button.dataset.profileTab === activeProfileTab))
    let index = currentIndex
    if (event.key === 'ArrowLeft') index = (currentIndex - 1 + tabs.length) % tabs.length
    if (event.key === 'ArrowRight') index = (currentIndex + 1) % tabs.length
    if (event.key === 'Home') index = 0
    if (event.key === 'End') index = tabs.length - 1
    event.preventDefault()
    setProfileTab(tabs[index].dataset.profileTab)
    tabs[index].focus()
  })

  document.querySelectorAll('[data-profile-open-tab]').forEach(button => {
    button.addEventListener('click', () => setProfileTab(button.dataset.profileOpenTab))
  })

  document.getElementById('profile-edit-open').addEventListener('click', () => {
    if (!snapshot || !snapshot.currentModelId) return
    profileEditingModelId = snapshot.currentModelId
    elements.profileBasicDisplay.hidden = true
    elements.profileBasicForm.hidden = false
    document.getElementById('profile-species-input').focus()
  })

  document.getElementById('profile-basic-cancel').addEventListener('click', () => {
    profileEditingModelId = ''
    elements.profileBasicForm.hidden = true
    elements.profileBasicDisplay.hidden = false
    const current = snapshot && snapshot.models.find(model => model.id === snapshot.currentModelId)
    renderCharacterProfile(current)
  })

  elements.profileBasicForm.addEventListener('submit', async event => {
    event.preventDefault()
    const modelId = snapshot && snapshot.currentModelId
    if (!modelId) return
    const result = await api.updateModelProfile(modelId, {
      species: document.getElementById('profile-species-input').value,
      age: document.getElementById('profile-age-input').value,
      height: document.getElementById('profile-height-input').value,
      personality: document.getElementById('profile-personality-input').value,
      likes: document.getElementById('profile-likes-input').value,
      bio: document.getElementById('profile-bio-input').value,
    })
    if (!result || !result.ok) {
      showToast(result && result.error ? result.error : '角色设定保存失败')
      return
    }
    profileEditingModelId = ''
    elements.profileBasicForm.hidden = true
    elements.profileBasicDisplay.hidden = false
    render(result.snapshot)
    showToast('基础设定已保存')
  })

  elements.profileWorldForm.addEventListener('submit', async event => {
    event.preventDefault()
    const modelId = snapshot && snapshot.currentModelId
    if (!modelId) return
    const result = await api.updateModelProfile(modelId, {
      worldview: document.getElementById('profile-worldview-input').value,
      relationship: document.getElementById('profile-relationship-input').value,
      rules: document.getElementById('profile-rules-input').value,
    })
    if (!result || !result.ok) {
      showToast(result && result.error ? result.error : '世界观保存失败')
      return
    }
    render(result.snapshot)
    showToast('世界观设定已保存')
  })

  async function persistModelGestures(showFeedback = false) {
    const modelId = snapshot && snapshot.currentModelId
    if (!modelId) return false
    const result = await api.updateModelGestures(modelId, collectModelGestures())
    if (!result || !result.ok) {
      showToast(result && result.error ? result.error : '手势互动保存失败')
      return false
    }
    if (result.snapshot) snapshot = result.snapshot
    if (showFeedback) showToast('手势互动已保存')
    return true
  }

  elements.modelGesturesList.addEventListener('change', async event => {
    if (event.target.matches('[data-gesture-field="actionId"]')) {
      event.target.classList.remove('is-unavailable')
    }
    if (event.target.matches('[data-gesture-field]')) await persistModelGestures()
  })

  elements.modelGesturesList.addEventListener('click', async event => {
    const row = event.target.closest('.model-gesture-row')
    if (!row) return
    const toggle = event.target.closest('[data-gesture-toggle]')
    if (toggle) {
      row.dataset.gestureEnabled = String(row.dataset.gestureEnabled === 'false')
      const label = row.querySelector('.model-gesture-trigger strong').textContent.trim()
      syncModelGestureRowState(row, toggle, label)
      await persistModelGestures()
      return
    }
    if (!event.target.closest('[data-gesture-preview]')) return
    const modelId = snapshot && snapshot.currentModelId
    if (!modelId) return
    const request = {
      kind: row.dataset.gestureKind,
      text: row.querySelector('[data-gesture-field="text"]').value.trim(),
      actionId: row.querySelector('[data-gesture-field="actionId"]').value,
    }
    const result = await api.previewModelInteraction(modelId, request)
    const label = row.querySelector('.model-gesture-trigger strong').textContent.trim()
    showToast(result && result.ok ? `已触发：${label}` : (result && result.error ? result.error : '手势预览失败'))
  })

  elements.modelGesturesForm.addEventListener('submit', async event => {
    event.preventDefault()
    await persistModelGestures(true)
  })

  elements.modelGesturesReset.addEventListener('click', async () => {
    const modelId = snapshot && snapshot.currentModelId
    if (!modelId) return
    const result = await api.updateModelGestures(modelId, null)
    if (!result || !result.ok) {
      showToast(result && result.error ? result.error : '恢复默认失败')
      return
    }
    render(result.snapshot)
    showToast('已恢复当前角色的默认手势')
  })

  elements.modelInteractionAdd.addEventListener('click', () => {
    const current = snapshot && snapshot.models.find(model => model.id === snapshot.currentModelId)
    const actionAssets = current && current.assets && Array.isArray(current.assets.actions) ? current.assets.actions : []
    if (!current || !actionAssets.length) {
      showToast('当前角色还没有可用动作')
      return
    }
    if (elements.modelInteractionsList.children.length >= 12) {
      showToast('每个角色最多保存 12 种互动')
      return
    }
    const preferred = actionAssets.find(asset => asset.interaction === 'tap')
      || actionAssets.find(asset => asset.interaction !== 'idle')
      || actionAssets[0]
    const item = {
      id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      label: '新互动',
      kind: 'custom',
      text: '一起来玩吧～',
      actionId: preferred.id,
      enabled: true,
      isDefault: false,
    }
    const row = createModelInteractionRow(item, actionAssets)
    const firstHidden = elements.modelInteractionsList.querySelector('.is-hidden-interaction')
    if (firstHidden) firstHidden.before(row)
    else elements.modelInteractionsList.appendChild(row)
    syncModelInteractionEditorState()
    row.querySelector('[data-interaction-field="label"]').select()
  })

  elements.modelInteractionsList.addEventListener('change', event => {
    const row = event.target.closest('.model-interaction-row')
    if (!row) return
    if (event.target.matches('[data-interaction-field="actionId"]')) {
      const preview = row.querySelector('[data-interaction-preview]')
      preview.disabled = row.dataset.interactionDefault !== 'true' && !event.target.value
      event.target.classList.remove('is-unavailable')
    }
    syncModelInteractionEditorState()
  })

  elements.modelInteractionsList.addEventListener('dragstart', event => {
    const handle = event.target.closest('.model-interaction-sort-handle')
    const row = handle && handle.closest('.model-context-interaction-row')
    if (!row || !handle.draggable) {
      event.preventDefault()
      return
    }
    sortingInteractionId = row.dataset.interactionId
    row.classList.add('is-drag-source')
    elements.modelInteractionsList.classList.add('is-sorting')
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', sortingInteractionId)
    event.dataTransfer.setDragImage(row, Math.round(row.offsetWidth / 2), Math.round(row.offsetHeight / 2))
  })

  elements.modelInteractionsList.addEventListener('dragover', event => {
    if (!sortingInteractionId) return
    const source = elements.modelInteractionsList.querySelector(`.model-context-interaction-row[data-interaction-id="${CSS.escape(sortingInteractionId)}"]`)
    const target = event.target.closest('.model-context-interaction-row')
    if (!source || !target || target === source) return
    const sourceEnabled = source.querySelector('[data-interaction-field="enabled"]').checked
    const targetEnabled = target.querySelector('[data-interaction-field="enabled"]').checked
    if (sourceEnabled !== targetEnabled) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = target.getBoundingClientRect()
    if (event.clientY < rect.top + rect.height / 2) target.before(source)
    else target.after(source)
  })

  elements.modelInteractionsList.addEventListener('drop', event => {
    if (sortingInteractionId) event.preventDefault()
  })

  elements.modelInteractionsList.addEventListener('dragend', () => {
    if (!sortingInteractionId) return
    sortingInteractionId = ''
    elements.modelInteractionsList.classList.remove('is-sorting')
    elements.modelInteractionsList.querySelectorAll('.model-context-interaction-row').forEach(row => row.classList.remove('is-drag-source'))
    syncModelInteractionEditorState()
  })

  elements.modelInteractionsList.addEventListener('click', async event => {
    const row = event.target.closest('.model-interaction-row')
    if (!row) return
    if (event.target.closest('[data-interaction-delete]')) {
      row.remove()
      syncModelInteractionEditorState()
      return
    }
    if (!event.target.closest('[data-interaction-preview]')) return
    const modelId = snapshot && snapshot.currentModelId
    if (!modelId) return
    const request = {
      kind: row.dataset.interactionKind,
      label: row.querySelector('[data-interaction-field="label"]').value.trim(),
      text: row.querySelector('[data-interaction-field="text"]').value.trim(),
      actionId: row.querySelector('[data-interaction-field="actionId"]').value,
    }
    const result = await api.previewModelInteraction(modelId, request)
    showToast(result && result.ok ? `已触发：${request.label || '互动'}` : (result && result.error ? result.error : '互动预览失败'))
  })

  elements.modelInteractionsForm.addEventListener('submit', async event => {
    event.preventDefault()
    const modelId = snapshot && snapshot.currentModelId
    if (!modelId) return
    const result = await api.updateModelInteractions(modelId, collectModelInteractions())
    if (!result || !result.ok) {
      showToast(result && result.error ? result.error : '互动方式保存失败')
      return
    }
    render(result.snapshot)
    showToast('互动方式已保存')
  })

  elements.modelInteractionsReset.addEventListener('click', async () => {
    const modelId = snapshot && snapshot.currentModelId
    if (!modelId) return
    const result = await api.updateModelInteractions(modelId, null)
    if (!result || !result.ok) {
      showToast(result && result.error ? result.error : '恢复默认失败')
      return
    }
    render(result.snapshot)
    showToast('已恢复当前角色的默认互动')
  })

  elements.characterProfile.addEventListener('click', async event => {
    const slideButton = event.target.closest('[data-profile-slide]')
    if (slideButton) {
      const [kind, rawDirection] = slideButton.dataset.profileSlide.split(':')
      moveProfileCarousel(kind, Number(rawDirection) || 1)
      return
    }
    const locateButton = event.target.closest('[data-profile-locate]')
    if (locateButton) {
      revealSelectedProfileAsset(locateButton.dataset.profileLocate)
      return
    }
    const button = event.target.closest('[data-profile-asset-id]')
    if (!button || !snapshot || !snapshot.currentModelId) return
    if (performance.now() < suppressProfileClickUntil) {
      event.preventDefault()
      return
    }
    const kind = button.dataset.profileAssetKind
    const assetId = button.dataset.profileAssetId
    const modelId = snapshot.currentModelId
    const label = button.querySelector('.profile-preview-label').textContent
    elements.characterProfile.querySelectorAll(`[data-profile-asset-kind="${kind}"][data-profile-asset-id="${CSS.escape(assetId)}"]`)
      .forEach(item => item.classList.add('is-loading'))
    let result
    try {
      result = await api.previewModelAsset(modelId, kind, assetId)
    } catch (error) {
      console.error(error)
      result = { ok: false, error: '预览请求失败' }
    }
    elements.characterProfile.querySelectorAll(`[data-profile-asset-kind="${kind}"][data-profile-asset-id="${CSS.escape(assetId)}"]`)
      .forEach(item => item.classList.remove('is-loading'))
    if (!result || !result.ok) {
      showToast(result && result.error ? result.error : '预览暂不可用')
      return
    }
    setSelectedProfileAsset(modelId, kind, assetId)
    if (result.preview && result.preview.frame) {
      profilePreviewFrames.set(profileAssetKey(modelId, kind, assetId), result.preview.frame)
    }
    elements.characterProfile.querySelectorAll(`[data-profile-asset-kind="${kind}"]`).forEach(item => {
      const selected = item.dataset.profileAssetId === assetId
      item.classList.toggle('is-selected', selected)
      item.classList.toggle('is-previewing', selected)
      item.setAttribute('aria-pressed', String(selected))
      if (selected && result.preview && result.preview.frame) {
        let image = item.querySelector('.profile-preview-visual img')
        if (!image) {
          image = document.createElement('img')
          image.alt = ''
          image.draggable = false
          item.querySelector('.profile-preview-visual').replaceChildren(image)
        }
        image.src = result.preview.frame
        image.dataset.livePreviewFrame = 'true'
      }
    })
    if (profilePreviewTimers[kind]) clearTimeout(profilePreviewTimers[kind])
    const restoreAfterMs = result.preview && Number(result.preview.restoreAfterMs) || (kind === 'expression' ? 3600 : 4200)
    profilePreviewTimers[kind] = setTimeout(() => {
      profilePreviewTimers[kind] = null
      elements.characterProfile.querySelectorAll(`[data-profile-asset-kind="${kind}"].is-previewing`)
        .forEach(item => item.classList.remove('is-previewing'))
    }, restoreAfterMs)
    updateProfileCarousel(kind)
    showToast(`${label} · 正在预览，${Math.round(restoreAfterMs / 100) / 10} 秒后恢复`, Math.min(3000, restoreAfterMs - 300))
  })

  for (const kind of ['action', 'expression']) {
    const list = profilePreviewList(kind)
    list.addEventListener('scroll', () => updateProfileCarousel(kind), { passive: true })
    list.addEventListener('pointerdown', event => {
      if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return
      if (list.scrollWidth <= list.clientWidth) return
      profileSliderDrag = {
        kind,
        list,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startScrollLeft: list.scrollLeft,
        axis: '',
        moved: false,
      }
    })
  }

  window.addEventListener('pointermove', event => {
    const drag = profileSliderDrag
    if (!drag || event.pointerId !== drag.pointerId) return
    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    if (!drag.axis) {
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 5) return
      drag.axis = Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y'
      if (drag.axis === 'y') {
        profileSliderDrag = null
        return
      }
    }
    if (drag.axis !== 'x') return
    if (!drag.moved) {
      drag.moved = true
      suppressProfileClickUntil = performance.now() + 450
      drag.list.classList.add('is-dragging')
      drag.list.setPointerCapture(event.pointerId)
    }
    event.preventDefault()
    drag.list.scrollLeft = drag.startScrollLeft - deltaX
  })

  function finishProfileSliderDrag(event) {
    const drag = profileSliderDrag
    if (!drag || (event && event.pointerId !== drag.pointerId)) return
    if (drag.list.hasPointerCapture(drag.pointerId)) drag.list.releasePointerCapture(drag.pointerId)
    drag.list.classList.remove('is-dragging')
    if (drag.moved) {
      suppressProfileClickUntil = performance.now() + 350
      const visible = profilePreviewVisibleCount(drag.kind)
      const page = Math.round(drag.list.scrollLeft / Math.max(1, drag.list.clientWidth))
      const card = drag.list.querySelector('.profile-preview-card')
      const gap = parseFloat(getComputedStyle(drag.list).columnGap) || 0
      const pageWidth = card ? (card.getBoundingClientRect().width + gap) * visible : drag.list.clientWidth
      drag.list.scrollTo({ left: page * pageWidth, behavior: 'smooth' })
    }
    profileSliderDrag = null
  }

  window.addEventListener('pointerup', finishProfileSliderDrag)
  window.addEventListener('pointercancel', finishProfileSliderDrag)

  elements.scaleRange.addEventListener('input', () => {
    setScaleDisplay(elements.scaleRange.value)
    const modelId = snapshot && snapshot.currentModelId
    if (!modelId) return
    pendingScaleSave = { modelId, scale: Number(elements.scaleRange.value) }
    if (scaleSaveTimer) clearTimeout(scaleSaveTimer)
    scaleSaveTimer = setTimeout(() => {
      scaleSaveTimer = null
      flushModelScaleSave()
    }, 120)
  })

  elements.opacityRange.addEventListener('input', () => {
    setOpacityDisplay(elements.opacityRange.value)
    const modelId = snapshot && snapshot.currentModelId
    if (!modelId) return
    pendingOpacitySave = { modelId, opacity: Number(elements.opacityRange.value) }
    if (opacitySaveTimer) clearTimeout(opacitySaveTimer)
    opacitySaveTimer = setTimeout(() => {
      opacitySaveTimer = null
      flushModelOpacitySave()
    }, 120)
  })

  async function updateModelDisplayScope(kind, input) {
    const modelId = snapshot && snapshot.currentModelId
    if (!modelId) return
    const applyToAll = input.checked
    input.disabled = true
    try {
      if (kind === 'scale') await flushModelScaleSave()
      else await flushModelOpacitySave()
      const result = await api.updateModelDisplayScope(modelId, kind, applyToAll)
      if (!result || !result.ok) {
        input.checked = !applyToAll
        showToast(result && result.error ? result.error : '全角色设置保存失败')
        return
      }
      render(result.snapshot)
    } catch (error) {
      input.checked = !applyToAll
      showToast('全角色设置保存失败')
      console.error(error)
    } finally {
      input.disabled = !(snapshot && snapshot.currentModelId)
    }
  }

  elements.scaleApplyAll.addEventListener('change', () => {
    updateModelDisplayScope('scale', elements.scaleApplyAll)
  })

  elements.opacityApplyAll.addEventListener('change', () => {
    updateModelDisplayScope('opacity', elements.opacityApplyAll)
  })

  document.querySelectorAll('[data-setting]').forEach(input => {
    input.addEventListener('change', () => {
      const key = input.dataset.setting
      let value = input.checked
      if (key === 'cursorFollow') value = input.checked ? 'near' : 'off'
      if (key === 'effects') value = input.checked ? 'subtle' : 'off'
      if (key === 'interactionMode') value = input.checked ? 'locked' : 'smart'
      if (key === 'reducedMotion') value = input.checked ? 'on' : 'system'
      savePreference({ [key]: value })
    })
  })

  elements.longMessageCharacterThreshold.addEventListener('change', () => {
    const fallback = snapshot && snapshot.preferences
      ? snapshot.preferences.longMessageCharacterThreshold
      : DEFAULT_LONG_MESSAGE_CHARACTER_THRESHOLD
    const value = normalizeLongMessageCharacterThreshold(
      elements.longMessageCharacterThreshold.value,
      fallback
    )
    elements.longMessageCharacterThreshold.value = String(value)
    savePreference({ longMessageCharacterThreshold: value })
  })

  elements.externalMessageOpenTester.addEventListener('click', async () => {
    const target = elements.externalMessageTesterTarget.value === 'browser' ? 'browser' : 'app'
    const opened = await api.openExternalMessageTester(target)
    if (!opened) showToast('请先开启外部消息接入')
  })

  document.querySelectorAll('[data-quality]').forEach(button => {
    button.addEventListener('click', () => savePreference({ qualityMode: button.dataset.quality }))
  })

  elements.shortcutList.addEventListener('click', event => {
    const button = event.target.closest('[data-shortcut-edit]')
    if (!button || !snapshot || !snapshot.preferences) return
    const bindings = Array.isArray(snapshot.preferences.shortcutBindings)
      ? snapshot.preferences.shortcutBindings
      : []
    const binding = bindings.find(item => item.id === button.dataset.shortcutEdit)
    if (binding) openShortcutDialog(binding)
  })

  elements.shortcutAdd.addEventListener('click', () => openShortcutDialog())

  elements.shortcutReset.addEventListener('click', async () => {
    elements.shortcutReset.disabled = true
    try {
      const result = await api.resetShortcuts()
      if (!result || !result.ok) {
        showToast(result && result.error ? result.error : '恢复默认快捷键失败', 3000)
        return
      }
      render(result.snapshot)
      showToast('快捷键已恢复默认')
    } catch (error) {
      showToast('恢复默认快捷键失败', 3000)
      console.error(error)
    } finally {
      elements.shortcutReset.disabled = false
    }
  })

  elements.shortcutDialogClose.addEventListener('click', closeShortcutDialog)
  elements.shortcutDialogCancel.addEventListener('click', closeShortcutDialog)
  elements.shortcutDialog.addEventListener('pointerdown', event => {
    if (event.target === elements.shortcutDialog) closeShortcutDialog()
  })

  elements.shortcutCapture.addEventListener('click', () => {
    if (!shortcutEditor) return
    elements.shortcutCapture.classList.add('is-listening')
    elements.shortcutCapture.textContent = '请按下组合键…'
    elements.shortcutCaptureHint.textContent = '正在监听键盘输入；按 Esc 取消本次录入'
  })

  elements.shortcutCapture.addEventListener('keydown', event => {
    if (!shortcutEditor || !elements.shortcutCapture.classList.contains('is-listening')) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      elements.shortcutCapture.classList.remove('is-listening')
      elements.shortcutCapture.textContent = shortcutEditor.accelerator
        ? shortcutDisplay(shortcutEditor.accelerator)
        : '点击后按下组合键'
      elements.shortcutCaptureHint.textContent = '已取消录入，当前组合键未改变'
      return
    }
    const accelerator = acceleratorFromKeyboardEvent(event)
    if (!accelerator) {
      elements.shortcutCaptureHint.textContent = '请同时按住修饰键，再按一个字母、数字或功能键'
      return
    }
    shortcutEditor.accelerator = accelerator
    elements.shortcutCapture.classList.remove('is-listening')
    elements.shortcutCapture.textContent = shortcutDisplay(accelerator)
    elements.shortcutCaptureHint.textContent = '组合键已录入，点击保存后立即生效'
  })

  elements.shortcutDialogSave.addEventListener('click', async () => {
    if (!shortcutEditor) return
    if (!shortcutEditor.accelerator) {
      elements.shortcutCapture.focus()
      elements.shortcutCapture.click()
      return
    }
    elements.shortcutDialogSave.disabled = true
    try {
      const result = await api.updateShortcut({
        id: shortcutEditor.id,
        action: elements.shortcutAction.value,
        accelerator: shortcutEditor.accelerator,
      })
      if (!result || !result.ok) {
        elements.shortcutCaptureHint.textContent = result && result.error ? result.error : '快捷键保存失败'
        showToast(elements.shortcutCaptureHint.textContent, 3000)
        return
      }
      render(result.snapshot)
      closeShortcutDialog()
      showToast('快捷键已更新')
    } catch (error) {
      showToast('快捷键保存失败', 3000)
      console.error(error)
    } finally {
      elements.shortcutDialogSave.disabled = false
    }
  })

  elements.shortcutDelete.addEventListener('click', async () => {
    if (!shortcutEditor || !shortcutEditor.custom) return
    elements.shortcutDelete.disabled = true
    try {
      const result = await api.deleteShortcut(shortcutEditor.id)
      if (!result || !result.ok) {
        showToast(result && result.error ? result.error : '删除快捷键失败', 3000)
        return
      }
      render(result.snapshot)
      closeShortcutDialog()
      showToast('自定义快捷键已删除')
    } catch (error) {
      showToast('删除快捷键失败', 3000)
      console.error(error)
    } finally {
      elements.shortcutDelete.disabled = false
    }
  })

  document.querySelectorAll('[data-theme-option]').forEach(input => {
    input.addEventListener('change', () => {
      if (!input.checked) return
      document.documentElement.dataset.settingsTheme = input.dataset.themeOption
      document.querySelectorAll('.theme-option').forEach(option => {
        option.classList.toggle('is-active', option.contains(input))
      })
      savePreference({ settingsTheme: input.dataset.themeOption })
    })
  })

  document.getElementById('preset-grid').addEventListener('click', async event => {
    const button = event.target.closest('[data-preset]')
    if (!button) return
    const names = {
      'top-left': '左上角',
      'top-right': '右上角',
      'bottom-left': '左下角',
      'bottom-right': '右下角',
      center: '屏幕中央',
    }
    const moved = await api.movePetPreset(button.dataset.preset)
    showToast(moved ? `角色已移到${names[button.dataset.preset] || '新位置'}` : '角色窗口暂不可用')
  })

  document.getElementById('open-models-folder').addEventListener('click', async () => {
    const opened = await api.openModelsFolder()
    if (!opened) showToast('无法打开模型文件夹')
  })

  document.getElementById('import-model-zip').addEventListener('click', async event => {
    const button = event.currentTarget
    button.disabled = true
    const originalText = button.textContent
    button.textContent = '检测中…'
    try {
      const result = await api.importModelZip()
      if (result && result.canceled) return
      if (!result || !result.ok) {
        showToast(result && result.error ? result.error : '模型导入失败', 4200)
        return
      }
      if (result.snapshot) render(result.snapshot)
      showToast('模型已导入')
    } catch (error) {
      showToast(error.message || '模型导入失败', 4200)
    } finally {
      button.disabled = false
      button.textContent = originalText
    }
  })

  document.getElementById('open-plugins-folder').addEventListener('click', async () => {
    const opened = await api.openPluginsFolder()
    if (!opened) showToast('无法打开插件文件夹')
  })

  // 文本 / 语音两组各实例化一份配置面板：点击「配置」只展开本组面板，
  // 另一组的展开状态不受影响；同组内面板随卡片迁移，始终只展开一个。
  aiPanels.chat = createAIConfigPanel('chat')
  aiPanels.tts = createAIConfigPanel('tts')

  // ---- 版本更新：统一弹窗（图标点击 / 检查更新共用） ----
  let lastCheck = null
  let downloading = false

  const updateDialog = {
    root: document.getElementById('update-dialog'),
    title: document.getElementById('update-dialog-title'),
    sub: document.getElementById('update-dialog-sub'),
    notes: document.getElementById('update-dialog-notes'),
    progress: document.getElementById('update-dialog-progress'),
    progressFill: document.getElementById('update-progress-fill'),
    progressText: document.getElementById('update-progress-text'),
    start: document.getElementById('update-start'),
  }

  // 轻量 Markdown 渲染：标题 / 列表 / 加粗 / 行内代码 / 链接
  function renderMarkdown(text) {
    const escapeHtml = value => String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
    const renderInline = value => escapeHtml(value)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    const html = []
    let inList = false
    const closeList = () => { if (inList) { html.push('</ul>'); inList = false } }
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line) { closeList(); continue }
      const heading = line.match(/^(#{1,4})\s+(.*)/)
      if (heading) {
        closeList()
        const level = heading[1].length
        html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`)
        continue
      }
      if (/^[-*]\s+/.test(line)) {
        if (!inList) { html.push('<ul>'); inList = true }
        html.push(`<li>${renderInline(line.replace(/^[-*]\s+/, ''))}</li>`)
        continue
      }
      closeList()
      html.push(`<p>${renderInline(line)}</p>`)
    }
    closeList()
    return html.join('')
  }

  function bindNotesLinks(container) {
    container.addEventListener('click', event => {
      if (event.target.tagName === 'A') {
        event.preventDefault()
        api.openExternalUrl(event.target.href)
      }
    })
  }
  bindNotesLinks(document.getElementById('update-dialog-notes'))

  function openUpdateDialog(result) {
    updateDialog.title.textContent = `发现新版本 v${result.latest}`
    updateDialog.sub.textContent = `当前版本 v${result.current}`
    updateDialog.notes.innerHTML = renderMarkdown(result.releaseNotes || '该版本没有提供更新说明。')
    updateDialog.progress.hidden = true
    updateDialog.progressFill.style.width = '0%'
    updateDialog.progressText.textContent = '0%'
    updateDialog.start.disabled = false
    updateDialog.start.textContent = '更新'
    updateDialog.root.hidden = false
  }

  function closeUpdateDialog() {
    updateDialog.root.hidden = true
    // 关闭弹窗即取消进行中的下载（进度只属于本次弹窗会话）
    if (downloading) {
      downloading = false
      api.cancelUpdateDownload()
    }
  }

  function setDownloadProgress(percent) {
    updateDialog.progress.hidden = false
    updateDialog.progressFill.style.width = `${percent}%`
    updateDialog.progressText.textContent = `${percent}%`
  }

  async function startUpdateDownload() {
    if (downloading) return
    downloading = true
    updateDialog.start.disabled = true
    updateDialog.start.textContent = '下载中…'
    setDownloadProgress(0)
    try {
      const result = await api.downloadUpdate()
      if (result && result.ok) {
        if (updateDialog.root.hidden) return
        setDownloadProgress(100)
        updateDialog.start.textContent = '正在启动安装程序…'
        updateDialog.title.textContent = '下载完成'
        const fileName = result.path ? result.path.split(/[\\/]/).pop() : '安装包'
        updateDialog.notes.innerHTML = `<p>${fileName} 已保存到下载目录，正在启动安装程序…</p>`
        // 下载完成自动安装
        setTimeout(() => {
          if (updateDialog.root.hidden) return
          api.openUpdateInstaller()
          closeUpdateDialog()
        }, 600)
      } else {
        updateDialog.start.disabled = false
        updateDialog.start.textContent = '重新下载'
        updateDialog.notes.textContent = '下载失败，请稍后重试。'
      }
    } catch (error) {
      updateDialog.start.disabled = false
      updateDialog.start.textContent = '重新下载'
      updateDialog.notes.textContent = '下载失败，请稍后重试。'
    } finally {
      downloading = false
    }
  }

  async function checkUpdate() {
    lastCheck = null
    elements.updateStatus.textContent = '正在检查…'
    elements.updateDot.hidden = true
    elements.footerUpdate.hidden = true
    elements.footerUpdate.title = '发现新版本时可在此查看'
    try {
      const result = await api.checkUpdate()
      if (result && result.ok) {
        lastCheck = result
        if (result.hasUpdate && !result.ignored) {
          elements.updateStatus.textContent = `发现新版本 v${result.latest}（当前 v${result.current}）`
          elements.updateDot.hidden = false
          elements.footerUpdate.hidden = false
          elements.footerUpdate.title = `发现新版本 v${result.latest}，点击下载`
        } else if (result.hasUpdate && result.ignored) {
          elements.updateStatus.textContent = `已忽略 v${result.latest}（当前 v${result.current}）`
        } else {
          elements.updateStatus.textContent = `已是最新版本（v${result.current}）`
        }
      } else {
        elements.updateStatus.textContent = '检查失败，请稍后重试'
      }
    } catch (error) {
      elements.updateStatus.textContent = '检查失败，请稍后重试'
    }
    return lastCheck
  }

  async function checkAndShowDialog() {
    const result = await checkUpdate()
    if (result && result.ok && result.hasUpdate && !result.ignored) {
      openUpdateDialog(result)
    } else if (result && result.ok && !result.hasUpdate) {
      showToast('已是最新版本')
    }
  }

  api.onUpdateProgress(progress => {
    // 只有本次弹窗会话内点击「更新」后的下载才显示进度
    if (!downloading || !progress || progress.total <= 0 || updateDialog.root.hidden) return
    const percent = Math.min(100, Math.round((progress.received / progress.total) * 100))
    setDownloadProgress(percent)
  })

  document.getElementById('check-update').addEventListener('click', checkAndShowDialog)
  elements.footerUpdate.addEventListener('click', checkAndShowDialog)
  updateDialog.start.addEventListener('click', startUpdateDownload)
  document.getElementById('update-later').addEventListener('click', closeUpdateDialog)
  document.getElementById('update-ignore').addEventListener('click', () => {
    if (lastCheck && lastCheck.latest) api.ignoreUpdateVersion(lastCheck.latest)
    closeUpdateDialog()
    checkUpdate()
  })
  if (!captureRenderOnly) {
    // 设置页每次加载时静默检查一次；只有发现未忽略的新版本才显示页脚入口。
    checkUpdate()
  }

  document.getElementById('reset-settings').addEventListener('click', async () => {
    try {
      render(await api.resetPreferences())
      showToast('已恢复默认设置')
    } catch (error) {
      showToast('恢复失败')
      console.error(error)
    }
  })

  api.onStateChanged(payload => {
    if (payload && payload.snapshot) render(payload.snapshot)
  })
  api.onNavigate(setActiveSection)
  api.onNotice(message => showToast(message, 3600))
  if (api.onModelPreviewRestored) {
    api.onModelPreviewRestored(({ modelId, kind, assetId } = {}) => {
      if (!snapshot || snapshot.currentModelId !== modelId || !['action', 'expression'].includes(kind)) return
      if (profilePreviewTimers[kind]) clearTimeout(profilePreviewTimers[kind])
      profilePreviewTimers[kind] = null
      elements.characterProfile.querySelectorAll(`[data-profile-asset-kind="${kind}"][data-profile-asset-id="${CSS.escape(assetId || '')}"].is-previewing`)
        .forEach(item => item.classList.remove('is-previewing'))
    })
  }
  api.onPetBackgroundFrame(queuePetBackgroundFrame)

  api.getSnapshot()
    .then(value => {
      render(value)
      if (captureRenderOnly) elements.updateStatus.textContent = `当前版本 v${value.appVersion}`
      document.documentElement.dataset.settingsReady = 'true'
    })
    .catch(error => {
      showToast('无法读取应用状态')
      console.error(error)
    })
})()
