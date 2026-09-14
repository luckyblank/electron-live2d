const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const path = require('path')
const { WebSocket, WebSocketServer } = require('ws')

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 17373
const MAX_BODY_BYTES = 32 * 1024
const MAX_CONTENT_CHARACTERS = 2000
const MAX_SENDER_CHARACTERS = 60
const MAX_REQUEST_ID_CHARACTERS = 120
const MAX_AUDIO_BYTES = 64 * 1024 * 1024
const RESULT_CACHE_TTL_MS = 10 * 60 * 1000
const RESULT_CACHE_LIMIT = 200
const AUDIO_MIME_TYPES = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
])

class ExternalMessageError extends Error {
  constructor(message, statusCode = 400, code = 'INVALID_REQUEST') {
    super(message)
    this.name = 'ExternalMessageError'
    this.statusCode = statusCode
    this.code = code
  }
}

function safeCharacters(value, maximum) {
  return Array.from(String(value || '').trim()).slice(0, maximum).join('')
}

function normalizeExternalMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExternalMessageError('请求体必须是 JSON 对象')
  }
  const type = value.type === 'relay' ? 'relay' : value.type === 'direct' ? 'direct' : ''
  if (!type) throw new ExternalMessageError('type 必须是 direct 或 relay')
  if (typeof value.content !== 'string') throw new ExternalMessageError('content 必须是字符串')
  const content = value.content.trim()
  if (!content) throw new ExternalMessageError('content 不能为空')
  if (Array.from(content).length > MAX_CONTENT_CHARACTERS) {
    throw new ExternalMessageError('content 不能超过 2,000 个字符')
  }
  if (value.requestId != null && typeof value.requestId !== 'string') {
    throw new ExternalMessageError('requestId 必须是字符串')
  }
  if (value.sender != null && typeof value.sender !== 'string') {
    throw new ExternalMessageError('sender 必须是字符串')
  }
  if (value.speak != null && typeof value.speak !== 'boolean') {
    throw new ExternalMessageError('speak 必须是布尔值')
  }
  if (value.useCurrentCharacterProfile != null && typeof value.useCurrentCharacterProfile !== 'boolean') {
    throw new ExternalMessageError('useCurrentCharacterProfile 必须是布尔值')
  }
  if (value.useExternalContext != null && typeof value.useExternalContext !== 'boolean') {
    throw new ExternalMessageError('useExternalContext 必须是布尔值')
  }
  const rawRequestId = typeof value.requestId === 'string' ? value.requestId.trim() : ''
  const rawSender = typeof value.sender === 'string' ? value.sender.trim() : ''
  if (Array.from(rawRequestId).length > MAX_REQUEST_ID_CHARACTERS) {
    throw new ExternalMessageError('requestId 不能超过 120 个字符')
  }
  if (Array.from(rawSender).length > MAX_SENDER_CHARACTERS) {
    throw new ExternalMessageError('sender 不能超过 60 个字符')
  }
  const requestId = rawRequestId || crypto.randomUUID()
  const sender = rawSender || '外部系统'
  return {
    id: crypto.randomUUID(),
    requestId,
    type,
    content,
    speak: value.speak === true,
    useCurrentCharacterProfile: value.useCurrentCharacterProfile !== false,
    useExternalContext: value.useExternalContext !== false,
    sender,
    source: 'external',
    sourceLabel: '外部',
    receivedAt: new Date().toISOString(),
  }
}

function jsonResponse(response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload))
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(body)
}

function readJSONBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let tooLarge = false
    request.on('data', chunk => {
      if (tooLarge) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        tooLarge = true
        chunks.length = 0
        reject(new ExternalMessageError('请求体不能超过 32 KiB', 413, 'PAYLOAD_TOO_LARGE'))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (tooLarge) return
      if (!chunks.length) {
        reject(new ExternalMessageError('请求体不能为空'))
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(new ExternalMessageError('请求体不是有效的 JSON'))
      }
    })
    request.on('error', reject)
  })
}

function publicError(error) {
  return {
    ok: false,
    error: error && error.message ? String(error.message).slice(0, 240) : '外部消息处理失败',
    code: error && error.code ? error.code : 'MESSAGE_FAILED',
  }
}

function byteRange(value, size) {
  if (!value) return null
  const match = String(value).match(/^bytes=(\d*)-(\d*)$/)
  if (!match) return false
  let start
  let end
  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return false
    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) return false
  return { start, end: Math.min(end, size - 1) }
}

function createExternalMessageServer({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  testerPath,
  handleMessage,
  getHistory = () => [],
  getHistoryAudio = () => null,
  clearHistory = () => [],
  onStatusChanged = () => {},
  logger = console,
} = {}) {
  if (typeof handleMessage !== 'function') throw new TypeError('handleMessage is required')

  let desiredEnabled = false
  let status = 'stopped'
  let lastError = ''
  let server = null
  let webSocketServer = null
  let queueTail = Promise.resolve()
  let queueDepth = 0
  let lifecycleSequence = 0
  const resultCache = new Map()

  const httpBaseUrl = `http://${host}:${port}`
  const websocketUrl = `ws://${host}:${port}/api/v1/events`

  function getSnapshot() {
    return {
      enabled: desiredEnabled,
      status,
      running: status === 'running',
      host,
      port,
      httpBaseUrl,
      messageUrl: `${httpBaseUrl}/api/v1/messages`,
      websocketUrl,
      testerUrl: `${httpBaseUrl}/external-message-tester.html`,
      queueDepth,
      websocketClients: webSocketServer ? webSocketServer.clients.size : 0,
      error: lastError,
    }
  }

  function notifyStatus() {
    try { onStatusChanged(getSnapshot()) } catch (error) { logger.warn('External message status listener failed:', error.message) }
  }

  function setStatus(next, error = '') {
    status = next
    lastError = error ? String(error).slice(0, 240) : ''
    notifyStatus()
  }

  function pruneResultCache(now = Date.now()) {
    for (const [key, entry] of resultCache) {
      if (now - entry.createdAt > RESULT_CACHE_TTL_MS) resultCache.delete(key)
    }
    while (resultCache.size > RESULT_CACHE_LIMIT) resultCache.delete(resultCache.keys().next().value)
  }

  function enqueue(message) {
    pruneResultCache()
    const cached = resultCache.get(message.requestId)
    if (cached) return cached.promise

    queueDepth += 1
    notifyStatus()
    const promise = queueTail
      .then(() => handleMessage(message))
      .finally(() => {
        queueDepth = Math.max(0, queueDepth - 1)
        notifyStatus()
      })
    queueTail = promise.catch(() => {})
    resultCache.set(message.requestId, { createdAt: Date.now(), promise })
    return promise
  }

  function broadcast(event) {
    if (!webSocketServer) return 0
    const frame = JSON.stringify({ action: 'message.event', event })
    let delivered = 0
    for (const client of webSocketServer.clients) {
      if (client.readyState !== WebSocket.OPEN) continue
      client.send(frame)
      delivered += 1
    }
    return delivered
  }

  function serveTester(request, response) {
    if (!testerPath || !fs.existsSync(testerPath)) {
      jsonResponse(response, 404, { ok: false, code: 'TESTER_NOT_FOUND', error: '测试页面不存在' })
      return
    }
    const body = fs.readFileSync(testerPath)
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss: http: https:; img-src 'self' data:; media-src 'self' blob:",
    })
    response.end(body)
  }

  function serveTesterStyle(request, response) {
    const stylePath = testerPath
      ? path.join(path.dirname(testerPath), 'external-message-tester-redesign.css')
      : ''
    if (!stylePath || !fs.existsSync(stylePath)) {
      jsonResponse(response, 404, { ok: false, code: 'TESTER_STYLE_NOT_FOUND', error: '测试页面样式不存在' })
      return
    }
    const body = fs.readFileSync(stylePath)
    response.writeHead(200, {
      'Content-Type': 'text/css; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    response.end(body)
  }

  function serveTesterHeaderArt(request, response) {
    const assetPath = testerPath
      ? path.join(path.dirname(testerPath), 'assets', 'external-tester-header-art.png')
      : ''
    if (!assetPath || !fs.existsSync(assetPath)) {
      jsonResponse(response, 404, { ok: false, code: 'TESTER_ASSET_NOT_FOUND', error: '测试台装饰资源不存在' })
      return
    }
    const body = fs.readFileSync(assetPath)
    response.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    response.end(body)
  }

  async function serveHistoryAudio(request, response, pathname) {
    const prefix = '/api/v1/history/audio/'
    let messageId = ''
    try { messageId = decodeURIComponent(pathname.slice(prefix.length)) } catch (error) {}
    if (!messageId || messageId.length > 160 || messageId.includes('/')) {
      jsonResponse(response, 400, { ok: false, code: 'INVALID_AUDIO_ID', error: '语音记录标识无效' })
      return
    }
    const audio = await getHistoryAudio(messageId)
    if (!audio || typeof audio.filePath !== 'string') {
      jsonResponse(response, 404, { ok: false, code: 'AUDIO_NOT_FOUND', error: '语音文件不存在或已被清理' })
      return
    }
    let stats
    try { stats = await fs.promises.stat(audio.filePath) } catch (error) {}
    if (!stats || !stats.isFile() || stats.size <= 0 || stats.size > MAX_AUDIO_BYTES) {
      jsonResponse(response, 404, { ok: false, code: 'AUDIO_NOT_FOUND', error: '语音文件不存在或不可播放' })
      return
    }
    const mimeType = AUDIO_MIME_TYPES.has(audio.mimeType) ? audio.mimeType : 'audio/wav'
    const range = byteRange(request.headers.range, stats.size)
    if (range === false) {
      response.writeHead(416, {
        'Content-Range': `bytes */${stats.size}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      response.end()
      return
    }
    const start = range ? range.start : 0
    const end = range ? range.end : stats.size - 1
    const headers = {
      'Content-Type': mimeType,
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    }
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${stats.size}`
    response.writeHead(range ? 206 : 200, headers)
    const stream = fs.createReadStream(audio.filePath, { start, end })
    stream.on('error', error => {
      logger.warn('External message history audio failed:', error.message)
      response.destroy(error)
    })
    stream.pipe(response)
  }

  async function handleHTTPRequest(request, response) {
    const url = new URL(request.url || '/', httpBaseUrl)
    if (request.method === 'GET' && ['/', '/external-message-tester.html'].includes(url.pathname)) {
      serveTester(request, response)
      return
    }
    if (request.method === 'GET' && url.pathname === '/external-message-tester-redesign.css') {
      serveTesterStyle(request, response)
      return
    }
    if (request.method === 'GET' && url.pathname === '/assets/external-tester-header-art.png') {
      serveTesterHeaderArt(request, response)
      return
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/v1/history/audio/')) {
      await serveHistoryAudio(request, response, url.pathname)
      return
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST')
      jsonResponse(response, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: '业务接口仅支持 POST 请求' })
      return
    }
    try {
      if (url.pathname === '/api/v1/health') {
        jsonResponse(response, 200, { ok: true, service: getSnapshot(), version: 1 })
        return
      }
      if (url.pathname === '/api/v1/session') {
        jsonResponse(response, 200, {
          ok: true,
          version: 1,
          capabilities: ['direct', 'relay', 'speech', 'speech-cache', 'character-profile-option', 'external-context', 'history', 'history-audio', 'websocket-events'],
          endpoints: {
            messages: `${httpBaseUrl}/api/v1/messages`,
            health: `${httpBaseUrl}/api/v1/health`,
            history: `${httpBaseUrl}/api/v1/history`,
            clearHistory: `${httpBaseUrl}/api/v1/history/clear`,
            historyAudio: `${httpBaseUrl}/api/v1/history/audio/{messageId}`,
            websocket: websocketUrl,
            tester: `${httpBaseUrl}/external-message-tester.html`,
          },
        })
        return
      }
      if (url.pathname === '/api/v1/history') {
        const body = await readJSONBody(request)
        const rawLimit = body && body.limit
        if (rawLimit != null && (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 200)) {
          throw new ExternalMessageError('limit 必须是 1 到 200 之间的整数')
        }
        const items = await getHistory({ limit: rawLimit || 100 })
        jsonResponse(response, 200, { ok: true, items, total: Array.isArray(items) ? items.length : 0 })
        return
      }
      if (url.pathname === '/api/v1/history/clear') {
        const items = await clearHistory()
        jsonResponse(response, 200, { ok: true, items: Array.isArray(items) ? items : [], total: 0 })
        return
      }
      if (url.pathname !== '/api/v1/messages') {
        jsonResponse(response, 404, { ok: false, code: 'NOT_FOUND', error: '接口不存在' })
        return
      }
      const message = normalizeExternalMessage(await readJSONBody(request))
      message.transport = 'http'
      const result = await enqueue(message)
      jsonResponse(response, 200, result)
    } catch (error) {
      const statusCode = Number(error && error.statusCode) || 500
      jsonResponse(response, statusCode, publicError(error))
    }
  }

  function handleWebSocketConnection(socket) {
    notifyStatus()
    socket.send(JSON.stringify({
      action: 'session.ready',
      version: 1,
      service: getSnapshot(),
    }))
    socket.on('message', async raw => {
      let frame
      try {
        if (raw.length > MAX_BODY_BYTES) throw new ExternalMessageError('消息帧不能超过 32 KiB', 413, 'PAYLOAD_TOO_LARGE')
        frame = JSON.parse(raw.toString('utf8'))
        if (!frame || frame.action !== 'message.post') {
          throw new ExternalMessageError('action 必须是 message.post', 400, 'INVALID_ACTION')
        }
        const message = normalizeExternalMessage(frame.payload)
        message.transport = 'websocket'
        const result = await enqueue(message)
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ action: 'message.result', requestId: message.requestId, result }))
        }
      } catch (error) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            action: 'message.error',
            requestId: safeCharacters(frame && frame.payload && frame.payload.requestId, MAX_REQUEST_ID_CHARACTERS),
            error: publicError(error),
          }))
        }
      }
    })
    socket.on('close', notifyStatus)
    socket.on('error', error => logger.warn('External message WebSocket failed:', error.message))
  }

  function originAllowed(request) {
    const origin = request.headers.origin
    if (!origin) return true
    return origin === httpBaseUrl || origin === `http://localhost:${port}`
  }

  async function start() {
    if (server || status === 'starting') return getSnapshot()
    const sequence = ++lifecycleSequence
    setStatus('starting')
    const nextServer = http.createServer((request, response) => {
      handleHTTPRequest(request, response).catch(error => {
        if (!response.headersSent) jsonResponse(response, 500, publicError(error))
        else response.destroy()
      })
    })
    const nextWebSocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY_BYTES })
    nextServer.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url || '/', httpBaseUrl)
      if (url.pathname !== '/api/v1/events' || !originAllowed(request)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      nextWebSocketServer.handleUpgrade(request, socket, head, client => {
        nextWebSocketServer.emit('connection', client, request)
      })
    })
    nextWebSocketServer.on('connection', handleWebSocketConnection)

    try {
      await new Promise((resolve, reject) => {
        const handleError = error => {
          nextServer.removeListener('listening', handleListening)
          reject(error)
        }
        const handleListening = () => {
          nextServer.removeListener('error', handleError)
          resolve()
        }
        nextServer.once('error', handleError)
        nextServer.once('listening', handleListening)
        nextServer.listen(port, host)
      })
      if (sequence !== lifecycleSequence || !desiredEnabled) {
        nextWebSocketServer.close()
        nextServer.close()
        return getSnapshot()
      }
      server = nextServer
      webSocketServer = nextWebSocketServer
      server.on('error', error => {
        logger.warn('External message server failed:', error.message)
        setStatus('error', error.message)
      })
      setStatus('running')
    } catch (error) {
      try { nextWebSocketServer.close() } catch {}
      try { nextServer.close() } catch {}
      setStatus('error', error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用` : error.message)
    }
    return getSnapshot()
  }

  async function stop() {
    ++lifecycleSequence
    const activeServer = server
    const activeWebSocketServer = webSocketServer
    server = null
    webSocketServer = null
    if (!activeServer && status !== 'starting') {
      setStatus('stopped')
      return getSnapshot()
    }
    setStatus('stopping')
    if (activeWebSocketServer) {
      for (const client of activeWebSocketServer.clients) client.close(1001, 'External messages disabled')
      try { activeWebSocketServer.close() } catch {}
    }
    if (activeServer) {
      await new Promise(resolve => activeServer.close(() => resolve()))
    }
    setStatus('stopped')
    return getSnapshot()
  }

  async function setEnabled(enabled) {
    desiredEnabled = Boolean(enabled)
    notifyStatus()
    return desiredEnabled ? start() : stop()
  }

  async function dispose() {
    desiredEnabled = false
    await stop()
    resultCache.clear()
  }

  return { broadcast, dispose, getSnapshot, setEnabled }
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  ExternalMessageError,
  createExternalMessageServer,
  normalizeExternalMessage,
}
