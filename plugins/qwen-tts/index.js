const API_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
const MAX_AUDIO_BYTES = 32 * 1024 * 1024
const RESULT_HOST_PATTERN = /^dashscope-result-[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/i

function responseError(status, detail) {
  if (status === 401) return new Error('DASHSCOPE_API_KEY 无效，请检查后重新保存')
  if (status === 402) return new Error('阿里云百炼账户余额或可用额度不足')
  if (status === 403) return new Error('当前阿里云百炼账号无权使用 Qwen-TTS，请确认模型已开通')
  if (status === 404) return new Error('找不到指定的 Qwen-TTS 模型')
  if (status === 429) return new Error('Qwen-TTS 请求过于频繁，请稍后再试')
  if (status >= 500) return new Error('阿里云百炼语音服务暂时不可用')
  return new Error(detail || `Qwen-TTS 请求失败（HTTP ${status}）`)
}

async function readPayload(response) {
  try {
    return JSON.parse(await response.text())
  } catch (error) {
    if (!response.ok) throw responseError(response.status)
    throw new Error('阿里云百炼返回了无法解析的数据')
  }
}

function responseDetail(payload) {
  if (!payload || typeof payload !== 'object') return ''
  if (typeof payload.message === 'string') return payload.message
  if (payload.error && typeof payload.error.message === 'string') return payload.error.message
  return ''
}

function ensureWav(audio) {
  if (!Buffer.isBuffer(audio) || !audio.length) throw new Error('Qwen-TTS 没有返回音频')
  if (audio.length > MAX_AUDIO_BYTES) throw new Error('Qwen-TTS 返回的音频文件过大')
  if (audio.length < 12 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Qwen-TTS 返回的音频不是有效的 WAV 文件')
  }
  return audio
}

function audioFromBase64(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const encoded = value.trim()
  if (encoded.length > Math.ceil(MAX_AUDIO_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('Qwen-TTS 返回了无效的音频数据')
  }
  return ensureWav(Buffer.from(encoded, 'base64'))
}

function trustedAudioUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch (error) {
    throw new Error('Qwen-TTS 返回了无效的音频下载地址')
  }
  if (!['http:', 'https:'].includes(url.protocol) || !RESULT_HOST_PATTERN.test(url.hostname)) {
    throw new Error('Qwen-TTS 返回了不受信任的音频下载地址')
  }
  // 官方示例中的临时 OSS 地址可能是 http；下载时统一升级为 https。
  url.protocol = 'https:'
  return url.href
}

async function downloadAudio(value, signal) {
  const response = await fetch(trustedAudioUrl(value), {
    method: 'GET',
    redirect: 'error',
    signal,
  })
  if (!response.ok) throw responseError(response.status, 'Qwen-TTS 音频下载失败')
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_AUDIO_BYTES) throw new Error('Qwen-TTS 返回的音频文件过大')
  const contentType = (response.headers.get('content-type') || '').toLowerCase()
  if (contentType && !contentType.includes('audio/') && !contentType.includes('application/octet-stream')) {
    throw new Error('Qwen-TTS 音频下载返回了非音频数据')
  }
  return ensureWav(Buffer.from(await response.arrayBuffer()))
}

async function synthesize({ apiKey, model, input, voice, signal }) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: {
        text: Array.from(input).slice(0, 600).join(''),
        voice,
        language_type: 'Auto',
      },
    }),
    signal,
  })

  const payload = await readPayload(response)
  const payloadStatus = Number(payload && payload.status_code)
  const status = Number.isFinite(payloadStatus) && payloadStatus >= 400 ? payloadStatus : response.status
  if (!response.ok || status >= 400 || (payload && payload.code)) {
    throw responseError(status || 500, responseDetail(payload))
  }

  const result = payload && payload.output && payload.output.audio
  if (!result || typeof result !== 'object') throw new Error('Qwen-TTS 没有返回音频结果')
  const inlineAudio = audioFromBase64(result.data)
  const audio = inlineAudio || await downloadAudio(result.url, signal)
  return { audio, format: 'wav', mimeType: 'audio/wav', model, voice }
}

module.exports = { synthesize }
