const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const JSZip = require('jszip')
const { AI_EMOTION_INTERACTIONS, MODEL_REACTION_PROFILES } = require('../config/model-reactions')
const { inspectModelDirectory } = require('../model-inspector')

const projectRoot = path.resolve(__dirname, '..')
const modelsRoot = path.join(projectRoot, 'models')
const requiredActionKinds = [
  'idle', 'tap', 'greet', 'head', 'happy', 'snack',
  'shy', 'curious', 'surprised', 'sleepy', 'sad', 'angry', 'drag',
]
const requiredExpressionKinds = ['praise', 'sad', 'angry', 'surprised', 'shy', 'curious', 'calm']
const requiredEmotionRoutes = {
  happy: 'praise',
  sad: 'sad',
  angry: 'angry',
  surprised: 'surprised',
  shy: 'shy',
  confused: 'curious',
  calm: 'calm',
}

function fileStem(fileName, suffix) {
  return String(fileName || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(suffix, '')
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableJson(value[key])]))
}

function assetHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableJson(value))).digest('hex')
}

function duplicateGroups(items, key) {
  const groups = new Map()
  for (const item of items) {
    const value = item[key]
    if (!groups.has(value)) groups.set(value, [])
    groups.get(value).push(item)
  }
  return [...groups.values()].filter(group => group.length > 1)
}

async function readModelArchive(modelId) {
  const directory = path.join(modelsRoot, modelId)
  const archiveName = fs.readdirSync(directory).find(name => name.toLowerCase().endsWith('.zip'))
  if (!archiveName) throw new Error(`${modelId}: missing ZIP archive`)

  const archive = await JSZip.loadAsync(fs.readFileSync(path.join(directory, archiveName)))
  const descriptorName = Object.keys(archive.files).find(name => name.toLowerCase().endsWith('.model3.json'))
  if (!descriptorName) throw new Error(`${modelId}: missing .model3.json`)

  const descriptor = JSON.parse(await archive.file(descriptorName).async('string'))
  const motionGroups = Object.entries(descriptor.FileReferences?.Motions || {})
  const referencedMotionFiles = motionGroups.flatMap(([, items]) => items.map(item => item.File))
  const motionStems = new Set(referencedMotionFiles.map(file => fileStem(file, /\.motion3\.json$/i)))
  const referencedExpressionFiles = (descriptor.FileReferences?.Expressions || []).map(item => item.File)
  const expressionStems = new Set(referencedExpressionFiles.map(file => fileStem(file, /\.exp3\.json$/i)))
  const motionAssets = []
  const expressionAssets = []

  for (const entryName of Object.keys(archive.files)) {
    if (/\.motion3\.json$/i.test(entryName)) {
      const value = JSON.parse(await archive.file(entryName).async('string'))
      const curves = Array.isArray(value.Curves) ? value.Curves : []
      motionAssets.push({
        entryName,
        stem: fileStem(entryName, /\.motion3\.json$/i),
        hash: assetHash(value),
        playable: curves.some(curve => (
          curve && ['Parameter', 'PartOpacity'].includes(curve.Target) &&
          Array.isArray(curve.Segments) && curve.Segments.length >= 2
        )),
        parameterIds: new Set(curves
          .filter(curve => curve && curve.Target === 'Parameter' && typeof curve.Id === 'string')
          .map(curve => curve.Id)),
        duration: Number(value.Meta?.Duration) || 0,
        loop: Boolean(value.Meta?.Loop),
      })
    } else if (/\.exp3\.json$/i.test(entryName)) {
      const value = JSON.parse(await archive.file(entryName).async('string'))
      expressionAssets.push({
        entryName,
        stem: fileStem(entryName, /\.exp3\.json$/i),
        hash: assetHash(value),
        playable: Array.isArray(value.Parameters) && value.Parameters.length > 0,
      })
    }
  }

  return {
    archiveName,
    descriptorName,
    motionGroups,
    referencedMotionFiles,
    referencedExpressionFiles,
    motionStems,
    expressionStems,
    motionAssets,
    expressionAssets,
  }
}

async function validateProfile(modelId, profile) {
  const archive = await readModelArchive(modelId)
  const errors = []
  const generatedExpressionNames = new Set(Object.keys(profile.generatedExpressions || {}))
  const playableMotionStems = new Set(archive.motionAssets.filter(item => item.playable).map(item => item.stem))

  if (profile.actions?.idle?.length !== 1) {
    errors.push(`idle must contain exactly one action, found: ${profile.actions?.idle?.length || 0}`)
  }
  if (new Set(profile.previewClips || []).size !== (profile.previewClips || []).length) {
    errors.push('preview list contains duplicate actions')
  }
  if (new Set(profile.previewExpressions || []).size !== (profile.previewExpressions || []).length) {
    errors.push('preview list contains duplicate expressions')
  }
  for (const [group, items] of archive.motionGroups) {
    if (!group.trim()) errors.push('motion group name is empty')
    if (items.length !== 1) errors.push(`motion group must contain exactly one action: ${group || '(empty)'} (${items.length})`)
  }
  for (const group of duplicateGroups(archive.referencedMotionFiles.map(file => ({ file })), 'file')) {
    errors.push(`motion is referenced more than once: ${group[0].file}`)
  }
  for (const group of duplicateGroups(archive.motionAssets, 'hash')) {
    errors.push(`duplicate motion files: ${group.map(item => item.entryName).join(', ')}`)
  }
  for (const group of duplicateGroups(archive.expressionAssets, 'hash')) {
    errors.push(`duplicate expression files: ${group.map(item => item.entryName).join(', ')}`)
  }
  for (const asset of archive.motionAssets) {
    if (!archive.motionStems.has(asset.stem)) errors.push(`unreferenced motion file: ${asset.entryName}`)
    if (!asset.playable) errors.push(`motion has no playable curves: ${asset.entryName}`)
  }
  for (const asset of archive.expressionAssets) {
    if (!archive.expressionStems.has(asset.stem)) errors.push(`unreferenced expression file: ${asset.entryName}`)
    if (!asset.playable) errors.push(`expression has no parameters: ${asset.entryName}`)
  }

  if (modelId === 'mori-suit') {
    const greetingStem = profile.actions?.greet?.[0]?.clip
    const greeting = archive.motionAssets.find(asset => asset.stem === greetingStem)
    if (!greeting) {
      errors.push('greet: redesigned Mori greeting motion is missing')
    } else {
      // Mori 的 ParamArmL / ParamArmR 在 moc3 中没有关键形。问候动作必须至少
      // 驱动这些已经验证会改变画面的参数，避免再次退化成“参数在变、画面不动”。
      for (const parameterId of ['ParamBodyAngleX', 'ParamBodyAngleZ', 'ParamTail']) {
        if (!greeting.parameterIds.has(parameterId)) {
          errors.push(`greet: redesigned Mori greeting is missing visible parameter: ${parameterId}`)
        }
      }
      if (greeting.duration < 1.5) errors.push('greet: redesigned Mori greeting is too short')
      if (greeting.loop) errors.push('greet: redesigned Mori greeting must not loop')
    }
  }

  for (const kind of requiredActionKinds) {
    if (!Array.isArray(profile.actions?.[kind]) || !profile.actions[kind].length) {
      errors.push(`missing action mapping: ${kind}`)
    }
  }

  for (const kind of requiredExpressionKinds) {
    if (typeof profile.expressions?.[kind] !== 'string' || !profile.expressions[kind]) {
      errors.push(`missing expression mapping: ${kind}`)
    }
  }

  for (const [kind, candidates] of Object.entries(profile.actions || {})) {
    for (const candidate of candidates) {
      if (!archive.motionStems.has(candidate.clip)) {
        errors.push(`${kind}: motion not found: ${candidate.clip}`)
      } else if (!playableMotionStems.has(candidate.clip)) {
        errors.push(`${kind}: motion has no playable curves: ${candidate.clip}`)
      }
      if (candidate.followUp && !archive.motionStems.has(candidate.followUp.clip)) {
        errors.push(`${kind}: follow-up motion not found: ${candidate.followUp.clip}`)
      } else if (candidate.followUp && !playableMotionStems.has(candidate.followUp.clip)) {
        errors.push(`${kind}: follow-up motion has no playable curves: ${candidate.followUp.clip}`)
      }
    }
  }

  for (const clip of profile.previewClips || []) {
    if (!archive.motionStems.has(clip)) errors.push(`preview motion not found: ${clip}`)
  }

  for (const source of profile.previewExpressions || []) {
    if (
      !archive.expressionStems.has(source) &&
      !generatedExpressionNames.has(source) &&
      !archive.motionStems.has(source)
    ) {
      errors.push(`preview expression not found: ${source}`)
    }
  }

  for (const [kind, source] of Object.entries(profile.expressions || {})) {
    // Runtime priority: explicit generated parameters -> ZIP native expression ->
    // same-stem motion conversion. The QA rule accepts those same three sources.
    if (
      !archive.expressionStems.has(source) &&
      !generatedExpressionNames.has(source) &&
      !archive.motionStems.has(source)
    ) {
      errors.push(`${kind}: expression, generated mapping or fallback motion not found: ${source}`)
    }
  }

  if (
    profile.neutralExpression &&
    !archive.expressionStems.has(profile.neutralExpression) &&
    !generatedExpressionNames.has(profile.neutralExpression) &&
    !archive.motionStems.has(profile.neutralExpression)
  ) {
    errors.push(`neutral expression not found: ${profile.neutralExpression}`)
  }

  return {
    modelId,
    archiveName: archive.archiveName,
    descriptorName: archive.descriptorName,
    nativeMotionGroups: archive.motionGroups.map(([name, items]) => ({ name, count: items.length })),
    indexedMotionClips: archive.motionStems.size,
    motionFiles: archive.motionAssets.length,
    nativeExpressions: archive.expressionStems.size,
    generatedExpressions: generatedExpressionNames.size,
    mappedActionKinds: Object.keys(profile.actions || {}).length,
    errors,
  }
}

async function run() {
  const bundledModelIds = fs.readdirSync(modelsRoot).filter(name => (
    fs.statSync(path.join(modelsRoot, name)).isDirectory()
  ))
  const bundledLive2DModelIds = bundledModelIds.filter(modelId => (
    inspectModelDirectory(path.join(modelsRoot, modelId))?.cubismVersion === 3
  ))
  const missingProfiles = bundledLive2DModelIds.filter(modelId => !MODEL_REACTION_PROFILES[modelId])
  const staleProfiles = Object.keys(MODEL_REACTION_PROFILES).filter(modelId => !bundledModelIds.includes(modelId))
  const emotionRoutingErrors = Object.entries(requiredEmotionRoutes)
    .filter(([emotion, interaction]) => AI_EMOTION_INTERACTIONS[emotion] !== interaction)
    .map(([emotion, interaction]) => `${emotion}: expected ${interaction}, got ${AI_EMOTION_INTERACTIONS[emotion] || 'missing'}`)
  const models = []

  for (const [modelId, profile] of Object.entries(MODEL_REACTION_PROFILES)) {
    if (bundledModelIds.includes(modelId)) models.push(await validateProfile(modelId, profile))
  }

  const passed = !missingProfiles.length && !staleProfiles.length && !emotionRoutingErrors.length && models.every(model => !model.errors.length)
  const report = { passed, missingProfiles, staleProfiles, emotionRoutingErrors, models }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!passed) process.exitCode = 1
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
