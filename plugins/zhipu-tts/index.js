const API_URL = 'https://open.bigmodel.cn/api/paas/v4/audio/speech'

function responseError(status, detail) {
  if (status === 401) return new Error('ZHIPU_API_KEY 无效，请检查后重新保存')
  if (status === 402) return new Error('智谱账户余额不足')
  if (status === 429) return new Error('智谱语音请求过于频繁，请稍后再试')
  if (status >= 500) return new Error('智谱语音服务暂时不可用')
  return new Error(detail || `智谱语音请求失败（HTTP ${status}）`)
}

async function responseDetail(response) {
  try {
    const payload = JSON.parse(await response.text())
    return payload && payload.error && payload.error.message
      ? payload.error.message
      : (payload && payload.message ? payload.message : '')
  } catch (error) {
    return ''
  }
}

async function synthesize({ apiKey, model, input, voice, speed, volume, signal }) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input,
      voice,
      response_format: 'wav',
      stream: false,
      speed,
      volume,
    }),
    signal,
  })

  if (!response.ok) throw responseError(response.status, await responseDetail(response))
  const contentType = response.headers.get('content-type') || 'audio/wav'
  if (contentType.includes('application/json')) {
    throw new Error('智谱语音服务返回了非音频数据')
  }
  const audio = Buffer.from(await response.arrayBuffer())
  if (!audio.length) throw new Error('智谱语音服务没有返回音频')
  return { audio, format: 'wav', mimeType: 'audio/wav', model, voice }
}

module.exports = { synthesize }
