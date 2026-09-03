(function () {
  const api = window.settingsAPI
  const elements = {
    onboarding: document.getElementById('onboarding'),
    currentModelName: document.getElementById('current-model-name'),
    runtimeStatus: document.getElementById('runtime-status'),
    modelCount: document.getElementById('model-count'),
    modelList: document.getElementById('model-list'),
    scaleRange: document.getElementById('scale-range'),
    scaleValue: document.getElementById('scale-value'),
    qualityDescription: document.getElementById('quality-description'),
    appVersion: document.getElementById('app-version'),
    toast: document.getElementById('toast'),
  }

  const qualityDescriptions = {
    auto: '互动时保持流畅，闲置后自动降低资源占用。',
    eco: '限制为 30fps，并减少附加效果与后台刷新。',
    high: '持续保持高刷新率，适合性能充足的设备。',
  }

  let snapshot = null
  let scaleSaveTimer = null
  let toastTimer = null

  function showToast(message) {
    elements.toast.textContent = message
    elements.toast.classList.add('is-visible')
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => elements.toast.classList.remove('is-visible'), 1800)
  }

  function setActiveSection(section) {
    const target = ['characters', 'behavior', 'system'].includes(section) ? section : 'characters'
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
  }

  function setScaleDisplay(value) {
    const scale = Math.min(2, Math.max(0.5, Number(value) || 1))
    const progress = ((scale - 0.5) / 1.5) * 100
    elements.scaleRange.value = String(scale)
    elements.scaleRange.style.setProperty('--range-progress', `${progress}%`)
    elements.scaleValue.textContent = `${Math.round(scale * 100)}%`
  }

  function createModelOption(model, currentModelId, runtime) {
    const button = document.createElement('button')
    const selected = model.id === currentModelId
    const loading = runtime.phase === 'loading' && runtime.modelId === model.id
    button.type = 'button'
    button.className = `model-option${selected ? ' is-selected' : ''}`
    button.dataset.modelId = model.id
    button.setAttribute('role', 'radio')
    button.setAttribute('aria-checked', String(selected))
    button.disabled = loading

    const mark = document.createElement('span')
    mark.className = 'model-mark'
    mark.textContent = model.name.slice(0, 2).toUpperCase()

    const meta = document.createElement('span')
    meta.className = 'model-meta'
    const name = document.createElement('strong')
    name.textContent = model.name
    const status = document.createElement('small')
    status.textContent = loading ? '正在切换…' : model.status === 'ready' ? 'Live2D 模型已就绪' : '需要检查模型文件'
    meta.append(name, status)

    const dot = document.createElement('span')
    dot.className = 'selection-dot'
    dot.setAttribute('aria-hidden', 'true')
    button.append(mark, meta, dot)
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
  }

  function render(nextSnapshot) {
    snapshot = nextSnapshot
    const current = snapshot.models.find(model => model.id === snapshot.currentModelId)
    const preferences = snapshot.preferences

    elements.onboarding.hidden = preferences.onboardingSeen
    elements.currentModelName.textContent = current ? current.name : '暂无角色'
    elements.modelCount.textContent = `${snapshot.models.length} 个可用`
    elements.appVersion.textContent = `v${snapshot.appVersion}`
    elements.modelList.replaceChildren(...snapshot.models.map(model => createModelOption(model, snapshot.currentModelId, snapshot.runtime)))
    setScaleDisplay(preferences.scale)
    renderRuntime(snapshot.runtime)
    renderToggles(preferences)
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

  document.querySelectorAll('.section-tab').forEach(button => {
    button.addEventListener('click', () => setActiveSection(button.dataset.section))
  })

  document.getElementById('minimize-window').addEventListener('click', api.minimizeWindow)
  document.getElementById('close-window').addEventListener('click', api.closeWindow)
  document.getElementById('quit-app').addEventListener('click', api.quitApp)

  document.getElementById('finish-onboarding').addEventListener('click', () => {
    savePreference({ onboardingSeen: true }, '设置会自动保存')
  })

  elements.modelList.addEventListener('click', async event => {
    const button = event.target.closest('.model-option')
    if (!button || button.disabled || button.dataset.modelId === snapshot.currentModelId) return
    document.querySelectorAll('.model-option').forEach(option => { option.disabled = true })
    try {
      const result = await api.selectModel(button.dataset.modelId)
      if (result && result.snapshot) render(result.snapshot)
    } catch (error) {
      showToast('角色切换失败')
      console.error(error)
    }
  })

  elements.scaleRange.addEventListener('input', () => {
    setScaleDisplay(elements.scaleRange.value)
    if (scaleSaveTimer) clearTimeout(scaleSaveTimer)
    scaleSaveTimer = setTimeout(() => {
      savePreference({ scale: Number(elements.scaleRange.value) })
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

  document.getElementById('reset-position').addEventListener('click', async () => {
    const moved = await api.resetPetPosition()
    showToast(moved ? '角色已移回屏幕右下角' : '角色窗口暂不可用')
  })

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

  api.getSnapshot()
    .then(render)
    .catch(error => {
      showToast('无法读取应用状态')
      console.error(error)
    })
})()
