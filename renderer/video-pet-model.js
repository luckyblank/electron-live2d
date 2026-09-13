const fs = require('fs')
const path = require('path')
const { fileURLToPath } = require('url')

const INTERACTION_LABELS = Object.freeze({
  idle: '待机',
  tap: '点击回应',
  greet: '打招呼',
  head: '摸摸头',
  happy: '开心',
  snack: '投喂',
  curious: '好奇',
  sleepy: '休息',
  sad: '难过',
  angry: '生气',
  drag: '拖拽',
})

const INTERACTION_FALLBACKS = Object.freeze({
  idle: ['idle'],
  tap: ['tap', 'curious', 'idle'],
  greet: ['greet', 'happy', 'tap', 'idle'],
  head: ['head', 'happy', 'tap', 'idle'],
  happy: ['happy', 'greet', 'tap', 'idle'],
  snack: ['snack', 'happy', 'tap', 'idle'],
  curious: ['curious', 'tap', 'idle'],
  sleepy: ['sleepy', 'idle'],
  sad: ['sad', 'sleepy', 'idle'],
  angry: ['angry', 'tap', 'idle'],
  drag: ['drag', 'curious', 'idle'],
})

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)]
}

function waitForVideo(video, timeoutMs = 8000) {
  if (video.readyState >= 2 && video.videoWidth > 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('视频动画加载超时')), timeoutMs)
    const onReady = () => finish()
    const onError = () => finish(new Error('视频动画无法解码'))
    const finish = error => {
      clearTimeout(timeout)
      video.removeEventListener('loadeddata', onReady)
      video.removeEventListener('error', onError)
      if (error) reject(error)
      else resolve()
    }
    video.addEventListener('loadeddata', onReady, { once: true })
    video.addEventListener('error', onError, { once: true })
  })
}

class VideoPetModel {
  constructor(canvas) {
    this.kind = 'video-pet'
    this.canvas = canvas
    this.context = canvas.getContext('2d', { alpha: true })
    this.loaded = false
    this.scale = 1
    this.x = 0
    this.y = 0
    this.needsResize = false
    this.enableMotion = true
    this.settings = null
    this.buffers = { motionGroups: [] }
    this.expressionIds = []
    this.touchController = { cancelInteractions() {} }
    this.cameraController = { removeListeners() {} }
    this.audioContext = null

    this.video = document.createElement('video')
    this.video.muted = true
    this.video.playsInline = true
    this.video.preload = 'auto'
    this.video.disablePictureInPicture = true
    this.video.addEventListener('ended', () => {
      if (!this._destroyed && !this.video.loop) this.playReaction('idle').catch(() => {})
    })

    this._paused = false
    this._destroyed = false
    this._sourceSequence = 0
    this._assetURLs = new Map()
    this._currentAnimation = ''
    this._audioSource = null
    this._audioResolve = null
    this.manifest = null
    this.manifestPath = ''
    this.render = { width: 0.96, bottom: 8, anchor: 'bottom' }
  }

  get paused() {
    return this._paused
  }

  set paused(value) {
    this._paused = Boolean(value)
    if (this._paused) {
      this.video.pause()
    } else if (this.video.src) {
      this.video.play().catch(() => {})
    }
  }

  async load(manifestURL) {
    if (typeof manifestURL !== 'string' || !manifestURL.startsWith('file:')) {
      throw new Error('视频宠物清单必须来自本地文件')
    }
    this.manifestPath = fileURLToPath(manifestURL)
    const manifest = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'))
    if (!manifest || manifest.format !== 'video-pet-v1' || !manifest.animations) {
      throw new Error('pet.json 不是受支持的视频宠物清单')
    }
    this.manifest = manifest
    const width = Number(manifest.render && manifest.render.width)
    const bottom = Number(manifest.render && manifest.render.bottom)
    const anchor = manifest.render && manifest.render.anchor === 'center' ? 'center' : 'bottom'
    this.render = {
      width: Number.isFinite(width) ? Math.min(1.4, Math.max(0.35, width)) : 0.96,
      bottom: Number.isFinite(bottom) ? Math.min(120, Math.max(0, bottom)) : 8,
      anchor,
    }
    this.centerModel()
    await this.playReaction('idle')
    this.loaded = true
    this.update()
  }

  _assetURL(fileName) {
    if (this._assetURLs.has(fileName)) return this._assetURLs.get(fileName)
    const filePath = path.resolve(path.dirname(this.manifestPath), fileName)
    const buffer = fs.readFileSync(filePath)
    const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))
    this._assetURLs.set(fileName, url)
    return url
  }

  _candidates(kind) {
    const animations = this.manifest && this.manifest.animations
    if (!animations || typeof animations !== 'object') return []
    for (const key of INTERACTION_FALLBACKS[kind] || [kind, 'tap', 'idle']) {
      const candidates = Array.isArray(animations[key])
        ? animations[key].filter(value => typeof value === 'string' && value)
        : []
      if (candidates.length) return { key, candidates }
    }
    return { key: '', candidates: [] }
  }

  async playReaction(kind) {
    const { key, candidates } = this._candidates(kind)
    if (!candidates.length) return false
    await this.playAnimation(randomItem(candidates), key === 'idle')
    return true
  }

  async playAnimation(fileName, loop = false) {
    if (this._destroyed) return false
    const sequence = ++this._sourceSequence
    this.video.pause()
    this.video.loop = Boolean(loop)
    this.video.src = this._assetURL(fileName)
    this.video.load()
    await waitForVideo(this.video)
    if (sequence !== this._sourceSequence || this._destroyed) return false
    this._currentAnimation = fileName
    this.video.currentTime = 0
    if (!this._paused) await this.video.play()
    this.update()
    return true
  }

  previewCatalog() {
    const actions = []
    const animations = this.manifest && this.manifest.animations
    if (!animations) return { actions, expressions: [] }
    for (const kind of Object.keys(INTERACTION_LABELS)) {
      if (!Array.isArray(animations[kind]) || !animations[kind].length) continue
      actions.push({
        id: `interaction:${kind}`,
        label: INTERACTION_LABELS[kind],
        type: 'interaction',
        interaction: kind,
      })
    }
    const includedFiles = new Set()
    for (const [kind, files] of Object.entries(animations)) {
      if (!Array.isArray(files)) continue
      for (const fileName of files) {
        if (includedFiles.has(fileName)) continue
        includedFiles.add(fileName)
        actions.push({
          id: `video:${fileName}`,
          label: fileName.replace(/\.webm$/i, ''),
          type: 'video',
          video: fileName,
          interaction: kind,
        })
      }
    }
    return { actions, expressions: [] }
  }

  centerModel() {
    this.x = this.canvas.width / 2
    this.y = this.render.anchor === 'center'
      ? this.canvas.height / 2
      : this.canvas.height - this.render.bottom
  }

  setDragging() {}

  transformX(clientX) {
    return (Number(clientX) / Math.max(1, this.canvas.clientWidth)) * 2 - 1
  }

  transformY(clientY) {
    return 1 - (Number(clientY) / Math.max(1, this.canvas.clientHeight)) * 2
  }

  update() {
    if (this._destroyed || !this.context) return
    const width = Math.max(1, Math.round(this.canvas.clientWidth || this.canvas.width))
    const height = Math.max(1, Math.round(this.canvas.clientHeight || this.canvas.height))
    if (this.needsResize || this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
      this.needsResize = false
      this.centerModel()
    }

    if (this.video.readyState < 2 || !this.video.videoWidth || !this.video.videoHeight) return
    // Changing a WebM source briefly resets readyState. Keep the previous
    // canvas frame visible until the first frame of the next action is ready,
    // otherwise a double-click looks like the pet flashes off and back on.
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height)
    const drawWidth = this.canvas.width * this.render.width * this.scale
    const drawHeight = drawWidth * (this.video.videoHeight / this.video.videoWidth)
    const drawY = this.render.anchor === 'center' ? this.y - drawHeight / 2 : this.y - drawHeight
    this.context.drawImage(this.video, this.x - drawWidth / 2, drawY, drawWidth, drawHeight)
  }

  async inputAudio(arrayBuffer) {
    this.stopAudio()
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) throw new Error('当前环境不支持音频播放')
    if (!this.audioContext || this.audioContext.state === 'closed') this.audioContext = new AudioContextClass()
    if (this.audioContext.state === 'suspended') await this.audioContext.resume()
    const decoded = await this.audioContext.decodeAudioData(arrayBuffer.slice(0))
    const source = this.audioContext.createBufferSource()
    source.buffer = decoded
    source.connect(this.audioContext.destination)
    this._audioSource = source
    return new Promise((resolve, reject) => {
      this._audioResolve = resolve
      source.addEventListener('ended', () => {
        if (this._audioSource === source) this._audioSource = null
        if (this._audioResolve === resolve) this._audioResolve = null
        resolve()
      }, { once: true })
      try {
        source.start()
      } catch (error) {
        this._audioSource = null
        this._audioResolve = null
        reject(error)
      }
    })
  }

  stopAudio() {
    const source = this._audioSource
    this._audioSource = null
    if (source) {
      try { source.stop() } catch (error) { /* 音频已经自然结束 */ }
      try { source.disconnect() } catch (error) { /* 音频节点已经释放 */ }
    }
    if (this._audioResolve) {
      const resolve = this._audioResolve
      this._audioResolve = null
      resolve()
    }
  }

  destroy() {
    this._destroyed = true
    this.loaded = false
    this.stopAudio()
    this.video.pause()
    this.video.removeAttribute('src')
    this.video.load()
    for (const url of this._assetURLs.values()) URL.revokeObjectURL(url)
    this._assetURLs.clear()
    if (this.context) this.context.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }
}

module.exports = { VideoPetModel }
