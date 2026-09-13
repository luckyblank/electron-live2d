const API_URL = 'https://api.deepseek.com/chat/completions'

function responseError(status, detail) {
  if (status === 401) return new Error('API Key 无效，请检查后重新保存')
  if (status === 402) return new Error('DeepSeek 账户余额不足')
  if (status === 429) return new Error('请求过于频繁，请稍后再试')
  if (status >= 500) return new Error('DeepSeek 服务暂时不可用')
  return new Error(detail || `DeepSeek 请求失败（HTTP ${status}）`)
}

async function chat({ apiKey, model, messages, maxTokens = 320, signal }) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      thinking: { type: 'disabled' },
      temperature: 1.3,
      max_tokens: Math.min(2048, Math.max(64, Math.round(Number(maxTokens) || 320))),
      stream: false,
    }),
    signal,
  })

  let payload = null
  try {
    payload = await response.json()
  } catch (error) {
    if (!response.ok) throw responseError(response.status)
    throw new Error('DeepSeek 返回了无法解析的数据')
  }

  if (!response.ok) {
    throw responseError(response.status, payload && payload.error && payload.error.message)
  }

  const text = payload && payload.choices && payload.choices[0] &&
    payload.choices[0].message && payload.choices[0].message.content
  if (typeof text !== 'string' || !text.trim()) throw new Error('DeepSeek 没有返回有效回复')

  return {
    text: text.trim(),
    model: typeof payload.model === 'string' ? payload.model : model,
    usage: payload.usage || null,
  }
}

module.exports = { chat }
