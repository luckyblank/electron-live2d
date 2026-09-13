const fs = require('fs')
const path = require('path')
const JSZip = require('jszip')
const { MODEL_REACTION_PROFILES } = require('../config/model-reactions')

const projectRoot = path.resolve(__dirname, '..')
const modelsRoot = path.join(projectRoot, 'models')
const requiredActionKinds = [
  'idle', 'tap', 'greet', 'head', 'happy', 'snack',
  'shy', 'curious', 'sleepy', 'sad', 'angry', 'drag',
]

function fileStem(fileName, suffix) {
  return String(fileName || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(suffix, '')
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
  const motionStems = new Set(motionGroups.flatMap(([, items]) => (
    items.map(item => fileStem(item.File, /\.motion3\.json$/i))
  )))
  const expressionStems = new Set((descriptor.FileReferences?.Expressions || []).map(item => (
    fileStem(item.File, /\.exp3\.json$/i)
  )))

  return { archiveName, descriptorName, motionGroups, motionStems, expressionStems }
}

async function validateProfile(modelId, profile) {
  const archive = await readModelArchive(modelId)
  const errors = []
  const generatedExpressionNames = new Set(Object.keys(profile.generatedExpressions || {}))

  for (const kind of requiredActionKinds) {
    if (!Array.isArray(profile.actions?.[kind]) || !profile.actions[kind].length) {
      errors.push(`missing action mapping: ${kind}`)
    }
  }

  for (const [kind, candidates] of Object.entries(profile.actions || {})) {
    for (const candidate of candidates) {
      if (!archive.motionStems.has(candidate.clip)) {
        errors.push(`${kind}: motion not found: ${candidate.clip}`)
      }
      if (candidate.followUp && !archive.motionStems.has(candidate.followUp.clip)) {
        errors.push(`${kind}: follow-up motion not found: ${candidate.followUp.clip}`)
      }
    }
  }

  for (const clip of profile.previewClips || []) {
    if (!archive.motionStems.has(clip)) errors.push(`preview motion not found: ${clip}`)
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
  const missingProfiles = bundledModelIds.filter(modelId => !MODEL_REACTION_PROFILES[modelId])
  const staleProfiles = Object.keys(MODEL_REACTION_PROFILES).filter(modelId => !bundledModelIds.includes(modelId))
  const models = []

  for (const [modelId, profile] of Object.entries(MODEL_REACTION_PROFILES)) {
    if (bundledModelIds.includes(modelId)) models.push(await validateProfile(modelId, profile))
  }

  const passed = !missingProfiles.length && !staleProfiles.length && models.every(model => !model.errors.length)
  const report = { passed, missingProfiles, staleProfiles, models }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!passed) process.exitCode = 1
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
