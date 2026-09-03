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
    modelsFolderPath: document.getElementById('models-folder-path'),
    updateStatus: document.getElementById('update-status'),
    updateDownload: document.getElementById('update-download'),
    releaseNotes: document.getElementById('release-notes'),
    footerUpdate: document.getElementById('footer-update'),
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

  function createModelCard(model, currentModelId, runtime, covers) {
    const button = document.createElement('button')
    const selected = model.id === currentModelId
    const loading = runtime.phase === 'loading' && runtime.modelId === model.id
    button.type = 'button'
    button.className = `model-card${selected ? ' is-selected' : ''}${loading ? ' is-loading' : ''}`
    button.dataset.modelId = model.id
    button.setAttribute('role', 'radio')
    button.setAttribute('aria-checked', String(selected))
    button.disabled = loading

    const cover = document.createElement('span')
    cover.className = 'model-cover'
    const coverUrl = covers && covers[model.id]
    if (coverUrl) {
      const image = document.createElement('img')
      image.src = coverUrl
      image.alt = ''
      cover.appendChild(image)
    } else {
      cover.classList.add('is-pending')
      const mark = document.createElement('span')
      mark.className = 'model-cover-mark'
      mark.textContent = model.name.slice(0, 2).toUpperCase()
      cover.appendChild(mark)
    }

    const name = document.createElement('span')
    name.className = 'model-name'
    name.textContent = model.name

    const seal = document.createElement('span')
    seal.className = 'model-seal'
    seal.setAttribute('aria-hidden', 'true')
    seal.innerHTML = '<svg viewBox="0 0 12 12"><path d="m2.6 6.4 2.1 2.1 4.7-5.2"/></svg>'

    button.append(cover, name, seal)
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
    if (elements.modelsFolderPath) elements.modelsFolderPath.textContent = snapshot.modelsFolder || ''
    elements.modelList.replaceChildren(...snapshot.models.map(model => createModelCard(model, snapshot.currentModelId, snapshot.runtime, snapshot.covers)))
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
    const button = event.target.closest('.model-card')
    if (!button || button.disabled || button.dataset.modelId === snapshot.currentModelId) return
    document.querySelectorAll('.model-card').forEach(option => { option.disabled = true })
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

  async function checkUpdate() {
    elements.updateStatus.textContent = '正在检查…'
    elements.updateDownload.hidden = true
    elements.footerUpdate.hidden = true
    try {
      const result = await api.checkUpdate()
      if (result && result.ok) {
        if (result.hasUpdate) {
          elements.updateStatus.textContent = `发现新版本 v${result.latest}（当前 v${result.current}）`
          elements.updateDownload.hidden = false
          elements.footerUpdate.hidden = false
          if (result.releaseNotes) {
            elements.releaseNotes.textContent = result.releaseNotes
            elements.releaseNotes.hidden = false
          } else {
            elements.releaseNotes.hidden = true
          }
        } else {
          elements.updateStatus.textContent = `已是最新版本（v${result.current}）`
          elements.releaseNotes.hidden = true
        }
      } else {
        elements.updateStatus.textContent = '检查失败，请稍后重试'
        showToast('无法检查更新')
      }
    } catch (error) {
      elements.updateStatus.textContent = '检查失败，请稍后重试'
    }
  }

  document.getElementById('check-update').addEventListener('click', checkUpdate)
  document.getElementById('update-download').addEventListener('click', () => {
    api.openUpdateDownload()
    showToast('已打开下载页面')
  })
  elements.footerUpdate.addEventListener('click', () => {
    api.openUpdateDownload()
    showToast('已打开下载页面')
  })
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

  api.getSnapshot()
    .then(render)
    .catch(error => {
      showToast('无法读取应用状态')
      console.error(error)
    })
})()
