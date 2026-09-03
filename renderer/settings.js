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
    updateDot: document.getElementById('update-dot'),
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

  api.getSnapshot()
    .then(render)
    .catch(error => {
      showToast('无法读取应用状态')
      console.error(error)
    })
})()
