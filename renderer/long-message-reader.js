(function () {
  const api = window.longMessageAPI
  const reader = document.getElementById('long-message-reader')
  const body = document.getElementById('long-message-reader-body')
  const title = document.getElementById('long-message-title')
  const source = document.getElementById('long-message-source')
  const badge = document.getElementById('long-message-badge')
  const audioKind = document.getElementById('long-message-audio-kind')
  const audio = document.getElementById('long-message-audio')
  const status = document.getElementById('long-message-status')
  const count = document.getElementById('long-message-count')
  const copy = document.getElementById('long-message-copy')
  const collapse = document.getElementById('long-message-collapse')
  let currentState = null
  let contentKey = ''
  let copySequence = 0
  let copyTimer = null

  function characterCount(text) {
    return Array.from(String(text || '').replace(/\s/gu, '')).length
  }

  function setStatusText(value) {
    const textNode = Array.from(status.childNodes).find(node => node.nodeType === Node.TEXT_NODE)
    if (textNode) textNode.nodeValue = value
    else status.appendChild(document.createTextNode(value))
  }

  function updateOverflowState() {
    if (reader.hidden) return
    const scrollable = body.scrollHeight > body.clientHeight + 1
    const atStart = body.scrollTop <= 1
    const atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 1
    reader.classList.toggle('is-scrollable', scrollable)
    reader.classList.toggle('is-at-start', atStart)
    reader.classList.toggle('is-at-end', atEnd)
    const fullText = currentState && (currentState.fullText || currentState.text)
    const typing = Boolean(currentState && (
      currentState.typing || String(currentState.text || '') !== String(fullText || '')
    ))
    setStatusText(typing ? '文字展示中…' : scrollable ? '可滚动查看全文' : '内容已完整显示')
  }

  function resetCopyFeedback() {
    copySequence += 1
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = null
    copy.classList.remove('is-copied')
    const label = copy.querySelector('span')
    if (label) label.textContent = '复制'
    copy.setAttribute('aria-label', '复制完整消息')
  }

  function syncAudioState(state) {
    audioKind.dataset.kind = state.hasVoice ? 'voice' : 'text'
    audioKind.textContent = state.hasVoice ? '语音消息' : '非语音消息'
    audioKind.setAttribute('aria-label', state.hasVoice ? '这是一条语音消息' : '这是一条非语音消息')
    audio.hidden = !state.hasVoice
    audio.classList.toggle('is-playing', Boolean(state.hasVoice && state.playing))
    audio.setAttribute('aria-pressed', String(Boolean(state.hasVoice && state.playing)))
    const label = state.playing ? '停止播放这条语音' : '播放这条语音'
    audio.setAttribute('aria-label', label)
    audio.title = label
  }

  function applyState(payload) {
    const state = payload && typeof payload === 'object' ? payload : {}
    currentState = state
    const normalizedText = String(state.text || '')
    const normalizedFullText = String(state.fullText || state.text || '')
    if (!state.open || !normalizedFullText) {
      reader.hidden = true
      reader.classList.remove('is-visible', 'is-scrollable', 'is-at-start', 'is-at-end')
      contentKey = ''
      return
    }

    const normalizedLabel = String(state.label || '伙伴')
    const side = state.side === 'left' ? 'left' : 'right'
    const theme = state.theme === 'healing' ? 'healing' : 'glass'
    const nextContentKey = JSON.stringify([
      state.revision, normalizedFullText, normalizedLabel, side, theme,
    ])
    document.documentElement.dataset.settingsTheme = theme
    document.body.style.setProperty('--long-message-reader-offset-x', `${Number(state.offsetX) || 18}px`)
    document.body.style.setProperty('--long-message-reader-width', `${Number(state.readerWidth) || 380}px`)
    reader.style.top = `${Number(state.top) || 40}px`
    reader.style.height = `${Number(state.height) || 520}px`
    reader.dataset.side = side
    reader.dataset.layoutRevision = String(Number(state.revision) || 0)
    syncAudioState(state)

    if (nextContentKey !== contentKey) {
      contentKey = nextContentKey
      title.textContent = normalizedLabel
      body.textContent = normalizedText
      source.hidden = state.source !== 'external'
      if (state.source === 'external') reader.dataset.source = 'external'
      else delete reader.dataset.source
      const characters = characterCount(normalizedFullText)
      count.textContent = `${characters} 字`
      badge.setAttribute('aria-label', `长消息，共 ${characters} 字`)
      reader.setAttribute('aria-label', `${normalizedLabel}的完整消息`)
      resetCopyFeedback()
      reader.hidden = false
      reader.classList.remove('is-visible')
      body.scrollTop = 0
      requestAnimationFrame(() => {
        if (contentKey !== nextContentKey || reader.hidden) return
        reader.classList.add('is-visible')
        updateOverflowState()
        requestAnimationFrame(() => {
          if (contentKey === nextContentKey && !reader.hidden) api.reportRendered(state.revision)
        })
      })
      return
    }

    reader.hidden = false
    if (body.textContent !== normalizedText) body.textContent = normalizedText
    updateOverflowState()
    requestAnimationFrame(() => api.reportRendered(state.revision))
  }

  copy.addEventListener('click', async () => {
    if (!currentState || !currentState.open || !(currentState.fullText || currentState.text)) return
    const text = String(currentState.fullText || currentState.text)
    const sequence = ++copySequence
    try {
      const copied = await api.writeClipboardText(text)
      if (
        sequence !== copySequence || !currentState ||
        String(currentState.fullText || currentState.text) !== text
      ) return
      if (copied !== true) throw new Error('复制失败')
      const label = copy.querySelector('span')
      copy.classList.add('is-copied')
      if (label) label.textContent = '已复制'
      copy.setAttribute('aria-label', '完整消息已复制')
      copyTimer = setTimeout(() => {
        if (sequence !== copySequence) return
        copyTimer = null
        copy.classList.remove('is-copied')
        if (label) label.textContent = '复制'
        copy.setAttribute('aria-label', '复制完整消息')
      }, 1500)
    } catch (error) {
      console.warn('Long-message copy failed:', error.message)
    }
  })

  collapse.addEventListener('click', () => api.sendAction('collapse'))
  audio.addEventListener('click', () => {
    if (currentState && currentState.open && currentState.hasVoice) api.sendAction('audio')
  })
  body.addEventListener('scroll', updateOverflowState, { passive: true })
  window.addEventListener('resize', updateOverflowState)
  api.onState(applyState)
  api.requestState()
})()
