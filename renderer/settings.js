(function () {
  const api = window.settingsAPI
  const elements = {
    onboarding: document.getElementById('onboarding'),
    currentModelName: document.getElementById('current-model-name'),
    currentModelSource: document.getElementById('current-model-source'),
    runtimeStatus: document.getElementById('runtime-status'),
    modelCount: document.getElementById('model-count'),
    modelReveal: document.getElementById('reveal-selected-model'),
    modelList: document.getElementById('model-list'),
    scaleRange: document.getElementById('scale-range'),
    scaleValue: document.getElementById('scale-value'),
    modelNickname: document.getElementById('model-nickname'),
    qualityDescription: document.getElementById('quality-description'),
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
    aiConfigTemplate: document.getElementById('ai-config-panel-template'),
    petBackground: document.getElementById('settings-pet-background'),
    petBackgroundCanvas: document.getElementById('settings-pet-background-canvas'),
    toast: document.getElementById('toast'),
  }

  const qualityDescriptions = {
    auto: '互动时保持流畅，闲置后自动降低资源占用。',
    eco: '限制为 30fps，并减少附加效果与后台刷新。',
    high: '持续保持高刷新率，适合性能充足的设备。',
  }

  let snapshot = null
  let scaleSaveTimer = null
  let pendingScaleSave = null
  let scaleSavePromise = null
  let toastTimer = null
  let modelSliderPointerId = null
  let modelSliderStartX = 0
  let modelSliderStartY = 0
  let modelSliderStartScrollLeft = 0
  let modelSliderAxis = ''
  let modelSliderMoved = false
  let suppressModelClickUntil = 0
  let petBackgroundFrameQueue = null
  let petBackgroundFrameBusy = false
  let petBackgroundFrameSequence = 0
  // 文本 / 语音两组各持有一份配置面板实例（aiPanels.chat / aiPanels.tts），
  // 点击「配置」只展开本组面板，另一组的展开/折叠状态不受影响；
  // 同一分组内面板随卡片迁移，始终只展开一个。
  const aiPanels = {}

  function clearPetBackgroundFrame() {
    petBackgroundFrameSequence++
    petBackgroundFrameQueue = null
    const context = elements.petBackgroundCanvas.getContext('2d')
    context.clearRect(0, 0, elements.petBackgroundCanvas.width, elements.petBackgroundCanvas.height)
    elements.petBackground.classList.remove('is-ready')
  }

  async function drawQueuedPetBackgroundFrames() {
    if (petBackgroundFrameBusy) return
    petBackgroundFrameBusy = true
    try {
      while (petBackgroundFrameQueue) {
        const queued = petBackgroundFrameQueue
        petBackgroundFrameQueue = null
        const bitmap = await createImageBitmap(new Blob([queued.frame], { type: 'image/webp' }))
        if (
          queued.sequence === petBackgroundFrameSequence && snapshot &&
          snapshot.preferences.settingsPetBackground
        ) {
          const canvas = elements.petBackgroundCanvas
          const context = canvas.getContext('2d')
          context.clearRect(0, 0, canvas.width, canvas.height)
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
          elements.petBackground.classList.add('is-ready')
        }
        bitmap.close()
      }
    } catch (error) {
      console.warn('Pet background frame decode failed:', error.message)
    } finally {
      petBackgroundFrameBusy = false
      if (petBackgroundFrameQueue) drawQueuedPetBackgroundFrames()
    }
  }

  function queuePetBackgroundFrame(frame) {
    if (!frame || !snapshot || !snapshot.preferences.settingsPetBackground) {
      clearPetBackgroundFrame()
      return
    }
    const sequence = ++petBackgroundFrameSequence
    petBackgroundFrameQueue = { frame, sequence }
    drawQueuedPetBackgroundFrames()
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
    })
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
    })
  }

  function setActiveSection(section) {
    const target = ['characters', 'behavior', 'ai', 'system'].includes(section) ? section : 'characters'
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
    const scale = Math.min(2, Math.max(0.5, Number(value) || 1))
    const progress = ((scale - 0.5) / 1.5) * 100
    elements.scaleRange.value = String(scale)
    elements.scaleRange.style.setProperty('--range-progress', `${progress}%`)
    elements.scaleValue.textContent = `${Math.round(scale * 100)}%`
  }

  function createModelCard(model, currentModelId, runtime, covers) {
    const button = document.createElement('button')
    const selected = model.id === currentModelId
    const loading = runtime.phase === 'loading' && runtime.modelId === model.id
    const unavailable = model.status !== 'ready'
    button.type = 'button'
    button.className = `model-card${selected ? ' is-selected' : ''}${loading ? ' is-loading' : ''}${unavailable ? ' is-unavailable' : ''}`
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

    button.append(cover, name, compatibility, seal)
    return button
  }

  function renderRuntime(runtime) {
    const status = elements.runtimeStatus
    status.classList.remove('is-loading', 'is-error')
    if (runtime.phase === 'ready') {
      status.textContent = '运行中'
    } else if (runtime.phase === 'error') {
      status.textContent = '加载失败'
      status.classList.add('is-error')
    } else if (runtime.phase === 'empty') {
      status.textContent = '无可用模型'
      status.classList.add('is-error')
    } else {
      status.textContent = '准备中'
      status.classList.add('is-loading')
    }
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

    document.querySelectorAll('[data-quality]').forEach(button => {
      button.classList.toggle('is-active', button.dataset.quality === preferences.qualityMode)
      button.setAttribute('aria-checked', String(button.dataset.quality === preferences.qualityMode))
    })
    elements.qualityDescription.textContent = qualityDescriptions[preferences.qualityMode]
    const petBackgroundEnabled = Boolean(preferences.settingsPetBackground)
    elements.petBackground.classList.toggle('is-enabled', petBackgroundEnabled)
    if (!petBackgroundEnabled) clearPetBackgroundFrame()

    const settingsTheme = ['glass', 'healing'].includes(preferences.settingsTheme)
      ? preferences.settingsTheme
      : 'glass'
    document.documentElement.dataset.settingsTheme = settingsTheme
    document.querySelectorAll('[data-settings-theme]').forEach(button => {
      const selected = button.dataset.settingsTheme === settingsTheme
      button.classList.toggle('is-active', selected)
      button.setAttribute('aria-checked', String(selected))
    })
  }

  function setAITestStatus(ctx, message, type = '') {
    ctx.els['ai-test-status'].textContent = message
    ctx.els['ai-test-status'].classList.toggle('is-success', type === 'success')
    ctx.els['ai-test-status'].classList.toggle('is-error', type === 'error')
  }

  function setAIConfigCollapsed(ctx, collapsed) {
    ctx.collapsed = collapsed
    ctx.root.classList.toggle('is-collapsed', collapsed)
    ctx.els['ai-config-body'].hidden = collapsed
    ctx.els['ai-config-heading'].setAttribute('aria-expanded', String(!collapsed))
  }

  function primaryCapability(plugin) {
    return plugin && plugin.capabilities.includes('tts') ? 'tts' : 'chat'
  }

  function hideAIConfig(ctx) {
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
    ctx.els['ai-persona-field'].hidden = isSpeech
    ctx.els['ai-history-field'].hidden = isSpeech
    ctx.els['ai-max-response-field'].hidden = isSpeech
    ctx.els['ai-tts-fields'].hidden = !isSpeech
    ctx.els['ai-model'].replaceChildren(...plugin.models.map(model => {
      const option = document.createElement('option')
      option.value = model
      option.textContent = model
      option.selected = model === plugin.config.model
      return option
    }))
    ctx.els['ai-persona'].value = plugin.config.persona
    ctx.els['ai-history-limit'].value = plugin.config.historyLimit
    ctx.els['ai-max-response-chars'].value = plugin.config.maxResponseChars
    ctx.els['ai-voice'].replaceChildren(...(plugin.voices || []).map(voice => {
      const option = document.createElement('option')
      option.value = voice.id
      option.textContent = `${voice.name} · ${voice.id}`
      option.selected = voice.id === plugin.config.voice
      return option
    }))
    updateVoicePreviewAvailability(ctx)
    ctx.els['ai-speed'].value = plugin.config.speed
    ctx.els['ai-volume'].value = plugin.config.volume
    ctx.els['ai-tts-folder-note'].textContent = snapshot && snapshot.ai && snapshot.ai.ttsDirectory
      ? `语音存档：${snapshot.ai.ttsDirectory}`
      : '生成的语音会保存在应用数据目录。'
    ctx.els['ai-api-key'].disabled = false
    ctx.els['ai-api-key'].type = 'text'
    ctx.els['ai-api-key'].value = plugin.credentialPreview || ''
    ctx.els['ai-api-key'].dataset.preview = plugin.credentialPreview || ''
    if (plugin.credentialSource === 'environment') {
      ctx.els['ai-api-key'].placeholder = `环境变量 ${plugin.apiKeyEnv}`
      ctx.els['ai-key-hint'].textContent = `已从 ${plugin.apiKeyEnv} 读取并脱敏；输入新 Key 后将优先使用本机加密配置。`
    } else {
      ctx.els['ai-api-key'].placeholder = plugin.credentialSource === 'local'
        ? '输入新 Key 可替换当前配置'
        : `粘贴你的 ${plugin.name} API Key`
      ctx.els['ai-key-hint'].textContent = plugin.credentialSource === 'local'
        ? '当前使用本机加密 Key；页面仅显示脱敏预览。'
        : `未检测到 ${plugin.apiKeyEnv || 'API Key 环境变量'}，请在这里配置。`
    }
    setAITestStatus(ctx, plugin.configured
      ? `配置已就绪，可保存当前设置并测试${isSpeech ? '语音' : '连接'}。`
      : `需要配置 API Key 后才能使用${isSpeech ? '语音' : '对话'}。`)
  }

  async function submitAIConfig(ctx, event) {
    event.preventDefault()
    const plugin = snapshot && snapshot.ai && snapshot.ai.plugins.find(item => item.id === ctx.editingPluginId)
    if (!plugin) return
    const apiKey = ctx.keyEdited ? ctx.els['ai-api-key'].value.trim() : ''
    if (!apiKey && plugin.credentialSource === 'missing') {
      setAITestStatus(ctx, `请填写 API Key，或设置环境变量 ${plugin.apiKeyEnv} 后重启应用。`, 'error')
      ctx.els['ai-api-key'].focus()
      return
    }

    ctx.els['ai-save-test'].disabled = true
    ctx.els['ai-save-test-label'].textContent = '正在测试…'
    const capability = primaryCapability(plugin)
    setAITestStatus(ctx, `正在保存配置并测试${capability === 'tts' ? '语音生成' : plugin.name}…`)
    try {
      const configured = await api.configureAIPlugin(plugin.id, {
        apiKey,
        model: ctx.els['ai-model'].value,
        persona: ctx.els['ai-persona'].value,
        historyLimit: Number(ctx.els['ai-history-limit'].value),
        maxResponseChars: Number(ctx.els['ai-max-response-chars'].value),
        voice: ctx.els['ai-voice'].value,
        speed: Number(ctx.els['ai-speed'].value),
        volume: Number(ctx.els['ai-volume'].value),
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
    }

    els['ai-config-heading'].addEventListener('click', () => setAIConfigCollapsed(ctx, !ctx.collapsed))
    els['ai-config-heading'].addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setAIConfigCollapsed(ctx, !ctx.collapsed)
      }
    })

    for (const field of [els['ai-model'], els['ai-persona'], els['ai-history-limit'], els['ai-max-response-chars'], els['ai-voice'], els['ai-speed'], els['ai-volume']]) {
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
    els['ai-api-key'].addEventListener('blur', () => {
      if (!ctx.keyEdited && !els['ai-api-key'].value) {
        els['ai-api-key'].type = 'text'
        els['ai-api-key'].value = els['ai-api-key'].dataset.preview || ''
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
    copy.append(name, description)

    const action = document.createElement('button')
    action.type = 'button'
    action.className = 'plugin-action'
    action.textContent = plugin.installed ? '配置' : '安装'
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

    const headActions = document.createElement('div')
    headActions.className = 'plugin-head-actions'
    if (plugin.installed) {
      const removeAction = document.createElement('button')
      removeAction.type = 'button'
      removeAction.className = 'plugin-remove-action'
      removeAction.textContent = '卸载'
      removeAction.setAttribute('aria-label', `卸载 ${plugin.name} 插件`)
      removeAction.addEventListener('click', async () => {
        removeAction.disabled = true
        const result = await api.uninstallAIPlugin(plugin.id)
        if (!result || !result.ok) {
          removeAction.disabled = false
          showToast(result && result.error ? result.error : '插件卸载失败')
          return
        }
        snapshot.ai = result.ai
        renderAI(result.ai)
        showToast(`${plugin.name} 已卸载`)
      })
      headActions.appendChild(removeAction)

      const activeAction = document.createElement('button')
      activeAction.type = 'button'
      activeAction.className = `plugin-select-action${active ? ' is-active' : ''}`
      activeAction.textContent = active ? (plugin.configured ? '已启用' : '待配置') : '启用'
      activeAction.disabled = active
      activeAction.setAttribute('aria-label', `${active ? '已启用' : '启用'} ${plugin.name}`)
      activeAction.addEventListener('click', async () => {
        if (!plugin.configured) {
          showAIConfig(plugin, true)
          return
        }
        activeAction.disabled = true
        const result = await api.activateAIPlugin(plugin.id, capability)
        if (!result || !result.ok) {
          activeAction.disabled = false
          showToast(result && result.error ? result.error : '模型启用失败')
          return
        }
        snapshot.ai = result.ai
        renderAI(result.ai)
        showToast(`已启用 ${plugin.name}`)
      })
      headActions.appendChild(activeAction)
    }
    headActions.appendChild(action)

    head.append(mark, copy, headActions)

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
    elements.aiChatActive.textContent = activeChat ? activeChat.name : '未启用'
    elements.aiTtsActive.textContent = activeTts ? activeTts.name : '未启用'
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
    snapshot = nextSnapshot
    const current = snapshot.models.find(model => model.id === snapshot.currentModelId)
    const preferences = snapshot.preferences

    elements.onboarding.hidden = preferences.onboardingSeen
    elements.currentModelName.textContent = current ? current.displayName : '暂无角色'
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
    elements.modelList.replaceChildren(...snapshot.models.map(model => createModelCard(model, snapshot.currentModelId, snapshot.runtime, snapshot.covers)))
    if (document.activeElement !== elements.chatGreeting) {
      elements.chatGreeting.value = preferences.chatGreeting || ''
    }
    elements.chatGreetingCount.textContent = `${elements.chatGreeting.value.length} / 200`
    setScaleDisplay(preferences.scale)
    renderRuntime(snapshot.runtime)
    renderToggles(preferences)
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

  document.querySelectorAll('.section-tab').forEach(button => {
    button.addEventListener('click', () => setActiveSection(button.dataset.section))
  })

  document.getElementById('minimize-window').addEventListener('click', api.minimizeWindow)
  document.getElementById('close-window').addEventListener('click', api.closeWindow)
  document.getElementById('quit-app').addEventListener('click', api.quitApp)

  document.getElementById('finish-onboarding').addEventListener('click', () => {
    savePreference({ onboardingSeen: true }, '设置会自动保存')
  })

  elements.chatGreeting.addEventListener('input', () => {
    elements.chatGreetingCount.textContent = `${elements.chatGreeting.value.length} / 200`
  })

  document.getElementById('chat-greeting-form').addEventListener('submit', event => {
    event.preventDefault()
    savePreference({ chatGreeting: elements.chatGreeting.value }, '聊天开场白已保存')
  })

  elements.modelReveal.addEventListener('click', () => {
    if (!snapshot || !snapshot.currentModelId) return
    elements.modelList.classList.remove('is-free-scrolling')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    revealSelectedModel(reducedMotion ? 'auto' : 'smooth')
  })

  elements.modelList.addEventListener('click', async event => {
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
      const result = await api.selectModel(targetModelId)
      if (result && result.snapshot) render(result.snapshot)
    } catch (error) {
      showToast('角色切换失败')
      console.error(error)
    }
  })

  // 桌面端也使用类似触屏轮播的拖拽手感：横向跟手移动，松开后吸附到最近的卡片。
  elements.modelList.addEventListener('pointerdown', event => {
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

  document.querySelectorAll('[data-quality]').forEach(button => {
    button.addEventListener('click', () => savePreference({ qualityMode: button.dataset.quality }))
  })

  document.querySelectorAll('[data-settings-theme]').forEach(button => {
    button.addEventListener('click', () => savePreference({ settingsTheme: button.dataset.settingsTheme }))
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
    elements.updateStatus.textContent = '正在检查…'
    elements.updateDot.hidden = true
    elements.footerUpdate.hidden = true
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
  // 窗口重新获得焦点时自动重查（用户切回来就能看到最新状态）
  window.addEventListener('focus', checkUpdate)
  checkUpdate()

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
  api.onPetBackgroundFrame(queuePetBackgroundFrame)

  api.getSnapshot()
    .then(render)
    .catch(error => {
      showToast('无法读取应用状态')
      console.error(error)
    })
})()
