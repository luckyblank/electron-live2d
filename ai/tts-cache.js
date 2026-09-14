const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const CACHE_SCHEMA_VERSION = 1
const MAX_AUDIO_BYTES = 32 * 1024 * 1024
const DEFAULT_MAX_ENTRIES = 200
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024

function normalizedFormat(value) {
  return ['wav', 'pcm'].includes(value) ? value : 'wav'
}

function normalizedMimeType(value) {
  return typeof value === 'string' && /^audio\/[a-z0-9.+-]+$/i.test(value) ? value : 'audio/wav'
}

function canonicalValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' || typeof value === 'boolean' || value === null) return value
  return value === undefined ? null : String(value)
}

function cacheDescriptor(plugin, input, config) {
  const fields = Array.isArray(plugin.ttsCacheKeyFields) ? [...plugin.ttsCacheKeyFields].sort() : []
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    pluginId: plugin.id,
    pluginVersion: plugin.version,
    input,
    config: Object.fromEntries(fields.map(field => [field, canonicalValue(config[field])])),
  }
}

function cacheKeyFor(plugin, input, config) {
  return crypto.createHash('sha256').update(JSON.stringify(cacheDescriptor(plugin, input, config))).digest('hex')
}

function createTTSCache({ directory, maxEntries = DEFAULT_MAX_ENTRIES, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const cacheDirectory = typeof directory === 'string' && directory ? path.resolve(directory) : ''
  const entryLimit = Math.max(1, Number(maxEntries) || DEFAULT_MAX_ENTRIES)
  const byteLimit = Math.max(MAX_AUDIO_BYTES, Number(maxBytes) || DEFAULT_MAX_BYTES)

  function pathsFor(cacheKey) {
    return {
      audioPath: path.join(cacheDirectory, `${cacheKey}.bin`),
      metadataPath: path.join(cacheDirectory, `${cacheKey}.json`),
    }
  }

  function removeEntry(cacheKey) {
    if (!cacheDirectory || !/^[a-f0-9]{64}$/.test(cacheKey)) return
    const { audioPath, metadataPath } = pathsFor(cacheKey)
    try { fs.rmSync(audioPath, { force: true }) } catch (error) {}
    try { fs.rmSync(metadataPath, { force: true }) } catch (error) {}
  }

  function read(plugin, input, config) {
    if (!cacheDirectory) return null
    const cacheKey = cacheKeyFor(plugin, input, config)
    const { audioPath, metadataPath } = pathsFor(cacheKey)
    try {
      const audioStats = fs.lstatSync(audioPath)
      const metadataStats = fs.lstatSync(metadataPath)
      if (!audioStats.isFile() || !metadataStats.isFile() || audioStats.size <= 0 || audioStats.size > MAX_AUDIO_BYTES) {
        removeEntry(cacheKey)
        return null
      }
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
      if (!metadata || metadata.schemaVersion !== CACHE_SCHEMA_VERSION || metadata.cacheKey !== cacheKey) {
        removeEntry(cacheKey)
        return null
      }
      const audio = fs.readFileSync(audioPath)
      if (!audio.length || audio.length > MAX_AUDIO_BYTES) {
        removeEntry(cacheKey)
        return null
      }
      const now = new Date()
      try { fs.utimesSync(audioPath, now, now) } catch (error) {}
      return {
        audio,
        format: normalizedFormat(metadata.format),
        mimeType: normalizedMimeType(metadata.mimeType),
        model: typeof metadata.model === 'string' ? metadata.model : config.model,
        voice: typeof metadata.voice === 'string' ? metadata.voice : config.voice,
        cacheKey,
      }
    } catch (error) {
      // 任意一半缺失也视为损坏条目，顺手清理另一半；缓存故障不应
      // 阻塞语音生成，调用方会把 null 当作未命中继续请求供应商。
      removeEntry(cacheKey)
      return null
    }
  }

  function prune() {
    if (!cacheDirectory || !fs.existsSync(cacheDirectory)) return
    let entries
    try {
      entries = fs.readdirSync(cacheDirectory, { withFileTypes: true })
        .filter(entry => entry.isFile() && /^[a-f0-9]{64}\.bin$/.test(entry.name))
        .flatMap(entry => {
          const cacheKey = entry.name.slice(0, -4)
          try {
            const metadataPath = path.join(cacheDirectory, `${cacheKey}.json`)
            if (!fs.statSync(metadataPath).isFile()) {
              removeEntry(cacheKey)
              return []
            }
            const stats = fs.statSync(path.join(cacheDirectory, entry.name))
            return [{ cacheKey, size: stats.size, modifiedAt: stats.mtimeMs }]
          } catch (error) {
            removeEntry(cacheKey)
            return []
          }
        })
        .sort((left, right) => right.modifiedAt - left.modifiedAt)
    } catch (error) {
      return
    }

    let keptEntries = 0
    let keptBytes = 0
    for (const entry of entries) {
      const canKeep = keptEntries < entryLimit && keptBytes + entry.size <= byteLimit
      if (!canKeep) {
        removeEntry(entry.cacheKey)
        continue
      }
      keptEntries += 1
      keptBytes += entry.size
    }

    // 清理写入中断后留下的孤立元数据与临时文件。
    try {
      for (const entry of fs.readdirSync(cacheDirectory, { withFileTypes: true })) {
        if (!entry.isFile()) continue
        const metadataMatch = entry.name.match(/^([a-f0-9]{64})\.json$/)
        if (metadataMatch && !fs.existsSync(path.join(cacheDirectory, `${metadataMatch[1]}.bin`))) {
          removeEntry(metadataMatch[1])
        } else if (/\.tmp$/.test(entry.name)) {
          try { fs.rmSync(path.join(cacheDirectory, entry.name), { force: true }) } catch (error) {}
        }
      }
    } catch (error) {}
  }

  function write(plugin, input, config, result) {
    if (!cacheDirectory || !result || !Buffer.isBuffer(result.audio) || !result.audio.length) return null
    if (result.audio.length > MAX_AUDIO_BYTES) return null
    const cacheKey = cacheKeyFor(plugin, input, config)
    const { audioPath, metadataPath } = pathsFor(cacheKey)
    const nonce = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`
    const temporaryAudioPath = `${audioPath}.${nonce}.tmp`
    const temporaryMetadataPath = `${metadataPath}.${nonce}.tmp`
    const metadata = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      cacheKey,
      createdAt: new Date().toISOString(),
      format: normalizedFormat(result.format),
      mimeType: normalizedMimeType(result.mimeType),
      model: typeof result.model === 'string' ? result.model : config.model,
      voice: typeof result.voice === 'string' ? result.voice : config.voice,
    }
    try {
      fs.mkdirSync(cacheDirectory, { recursive: true })
      fs.writeFileSync(temporaryAudioPath, result.audio, { flag: 'wx' })
      fs.writeFileSync(temporaryMetadataPath, JSON.stringify(metadata), { flag: 'wx' })
      fs.renameSync(temporaryAudioPath, audioPath)
      fs.renameSync(temporaryMetadataPath, metadataPath)
      prune()
      return cacheKey
    } catch (error) {
      try { fs.rmSync(temporaryAudioPath, { force: true }) } catch (cleanupError) {}
      try { fs.rmSync(temporaryMetadataPath, { force: true }) } catch (cleanupError) {}
      return null
    }
  }

  return { keyFor: cacheKeyFor, read, write, prune }
}

module.exports = {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_ENTRIES,
  createTTSCache,
}
