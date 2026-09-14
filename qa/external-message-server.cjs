const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { WebSocket } = require('ws')
const { createExternalMessageServer, normalizeExternalMessage } = require('../external-message-server')

async function expectJSON(response, status) {
  assert.equal(response.status, status)
  return response.json()
}

async function waitForWebSocketFrame(socket, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for WebSocket frame'))
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timeout)
      socket.removeListener('message', handleMessage)
      socket.removeListener('error', handleError)
    }
    const handleMessage = raw => {
      const frame = JSON.parse(raw.toString('utf8'))
      if (!predicate(frame)) return
      cleanup()
      resolve(frame)
    }
    const handleError = error => {
      cleanup()
      reject(error)
    }
    socket.on('message', handleMessage)
    socket.on('error', handleError)
  })
}

function silentWav() {
  const sampleRate = 8000
  const sampleCount = 800
  const dataSize = sampleCount * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  return buffer
}

async function run() {
  const normalized = normalizeExternalMessage({
    type: 'direct',
    content: ' 外部提醒 ',
    speak: true,
    sender: 'QA',
    requestId: 'normalize-1',
  })
  assert.equal(normalized.content, '外部提醒')
  assert.equal(normalized.source, 'external')
  assert.equal(normalized.sourceLabel, '外部')
  assert.equal(normalized.speak, true)
  assert.equal(normalized.useCurrentCharacterProfile, true)
  assert.equal(normalized.useExternalContext, true)
  const noProfileOrContext = normalizeExternalMessage({
    type: 'relay',
    content: 'x',
    useCurrentCharacterProfile: false,
    useExternalContext: false,
  })
  assert.equal(noProfileOrContext.useCurrentCharacterProfile, false)
  assert.equal(noProfileOrContext.useExternalContext, false)
  assert.throws(() => normalizeExternalMessage({ type: 'unknown', content: 'x' }), /direct 或 relay/)
  assert.throws(() => normalizeExternalMessage({ type: 'direct', content: ' ' }), /不能为空/)
  assert.throws(() => normalizeExternalMessage({ type: 'direct', content: 42 }), /必须是字符串/)
  assert.throws(() => normalizeExternalMessage({ type: 'direct', content: 'x', speak: 'true' }), /布尔值/)
  assert.throws(() => normalizeExternalMessage({ type: 'relay', content: 'x', useCurrentCharacterProfile: 'true' }), /useCurrentCharacterProfile/)
  assert.throws(() => normalizeExternalMessage({ type: 'relay', content: 'x', useExternalContext: 1 }), /useExternalContext/)
  assert.throws(() => normalizeExternalMessage({ type: 'direct', content: 'x'.repeat(2001) }), /2,000/)
  assert.throws(() => normalizeExternalMessage({ type: 'direct', content: 'x', sender: 'x'.repeat(61) }), /60/)
  assert.throws(() => normalizeExternalMessage({ type: 'direct', content: 'x', requestId: 'x'.repeat(121) }), /120/)

  const port = 28000 + Math.floor(Math.random() * 8000)
  const handled = []
  const transports = new Map()
  const history = []
  const audioMessageIds = new Set()
  const audioDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-external-audio-'))
  const audioPath = path.join(audioDirectory, 'history.wav')
  fs.writeFileSync(audioPath, silentWav())
  let service
  service = createExternalMessageServer({
    port,
    testerPath: path.join(__dirname, '..', 'renderer', 'external-message-tester.html'),
    handleMessage: async message => {
      handled.push(message.requestId)
      transports.set(message.requestId, message.transport)
      service.broadcast({ phase: 'received', message })
      await new Promise(resolve => setTimeout(resolve, message.type === 'relay' ? 35 : 5))
      const result = {
        ok: true,
        requestId: message.requestId,
        messageId: message.id,
        result: { text: message.type === 'relay' ? `转述：${message.content}` : message.content },
      }
      history.push({ messageId: message.id, requestId: message.requestId, content: message.content, status: 'completed' })
      audioMessageIds.add(message.id)
      service.broadcast({ phase: 'completed', message, result: result.result })
      return result
    },
    getHistory: ({ limit }) => history.slice(-limit).reverse(),
    getHistoryAudio: messageId => audioMessageIds.has(messageId)
      ? { filePath: audioPath, mimeType: 'audio/wav' }
      : null,
    clearHistory: () => {
      history.length = 0
      return []
    },
    logger: { warn() {} },
  })

  try {
    const started = await service.setEnabled(true)
    assert.equal(started.running, true)
    const base = `http://127.0.0.1:${port}`

    const health = await expectJSON(await fetch(`${base}/api/v1/health`, { method: 'POST' }), 200)
    assert.equal(health.ok, true)
    assert.equal(health.service.running, true)

    const session = await expectJSON(await fetch(`${base}/api/v1/session`, { method: 'POST' }), 200)
    assert.ok(session.capabilities.includes('external-context'))
    assert.ok(session.capabilities.includes('speech-cache'))
    assert.equal(session.endpoints.history, `${base}/api/v1/history`)

    const tester = await fetch(`${base}/external-message-tester.html`)
    assert.equal(tester.status, 200)
    assert.match(await tester.text(), /外部消息测试台/)

    const rejectedMethod = await expectJSON(await fetch(`${base}/api/v1/messages`), 405)
    assert.equal(rejectedMethod.code, 'METHOD_NOT_ALLOWED')

    const invalid = await expectJSON(await fetch(`${base}/api/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'direct', content: '' }),
    }), 400)
    assert.equal(invalid.ok, false)

    const oversized = await expectJSON(await fetch(`${base}/api/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'direct', content: 'x'.repeat(33 * 1024) }),
    }), 413)
    assert.equal(oversized.code, 'PAYLOAD_TOO_LARGE')

    const directPayload = {
      type: 'direct',
      content: '测试直接消息',
      speak: false,
      sender: 'QA',
      requestId: 'direct-1',
      useCurrentCharacterProfile: false,
      useExternalContext: false,
    }
    const direct = await expectJSON(await fetch(`${base}/api/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(directPayload),
    }), 200)
    assert.equal(direct.result.text, directPayload.content)
    assert.equal(history[0].requestId, 'direct-1')
    assert.equal(transports.get('direct-1'), 'http')

    const historyResult = await expectJSON(await fetch(`${base}/api/v1/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 20 }),
    }), 200)
    assert.equal(historyResult.items[0].requestId, 'direct-1')

    const audio = await fetch(`${base}/api/v1/history/audio/${encodeURIComponent(direct.messageId)}`)
    assert.equal(audio.status, 200)
    assert.equal(audio.headers.get('content-type'), 'audio/wav')
    assert.equal((await audio.arrayBuffer()).byteLength, silentWav().length)

    const audioRange = await fetch(`${base}/api/v1/history/audio/${encodeURIComponent(direct.messageId)}`, {
      headers: { Range: 'bytes=0-9' },
    })
    assert.equal(audioRange.status, 206)
    assert.equal(audioRange.headers.get('content-range'), `bytes 0-9/${silentWav().length}`)
    assert.equal((await audioRange.arrayBuffer()).byteLength, 10)

    const missingAudio = await expectJSON(await fetch(`${base}/api/v1/history/audio/not-found`), 404)
    assert.equal(missingAudio.code, 'AUDIO_NOT_FOUND')

    const invalidHistoryLimit = await expectJSON(await fetch(`${base}/api/v1/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 0 }),
    }), 400)
    assert.equal(invalidHistoryLimit.ok, false)

    const duplicate = await expectJSON(await fetch(`${base}/api/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(directPayload),
    }), 200)
    assert.equal(duplicate.messageId, direct.messageId)
    assert.equal(handled.filter(id => id === 'direct-1').length, 1)

    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/v1/events`)
    await new Promise((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    const resultFramePromise = waitForWebSocketFrame(socket, frame => frame.action === 'message.result')
    socket.send(JSON.stringify({
      action: 'message.post',
      payload: { type: 'relay', content: '测试转述消息', sender: 'WS QA', requestId: 'ws-1' },
    }))
    const resultFrame = await resultFramePromise
    assert.equal(resultFrame.requestId, 'ws-1')
    assert.equal(resultFrame.result.result.text, '转述：测试转述消息')
    assert.equal(transports.get('ws-1'), 'websocket')
    socket.close()

    const orderStart = handled.length
    const messages = [
      { type: 'relay', content: '第一条', requestId: 'queue-1' },
      { type: 'direct', content: '第二条', requestId: 'queue-2' },
    ]
    await Promise.all(messages.map(payload => fetch(`${base}/api/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })))
    assert.deepEqual(handled.slice(orderStart), ['queue-1', 'queue-2'])

    const cleared = await expectJSON(await fetch(`${base}/api/v1/history/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }), 200)
    assert.deepEqual(cleared.items, [])
    assert.equal(history.length, 0)

    console.log('External message server QA passed')
  } finally {
    await service.dispose()
  }
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
