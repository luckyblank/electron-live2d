const fs = require('fs')
const path = require('path')
const JSZip = require('jszip')

const projectRoot = path.resolve(__dirname, '..')

function createLinearMotion(duration, curveKeyframes) {
  const curves = Object.entries(curveKeyframes).map(([Id, keyframes]) => {
    if (!Array.isArray(keyframes) || keyframes.length < 2) {
      throw new Error(`${Id}: a motion curve needs at least two keyframes`)
    }
    const [first, ...remaining] = keyframes
    const Segments = [first[0], first[1]]
    for (const [time, value] of remaining) Segments.push(0, time, value)
    return { Target: 'Parameter', Id, Segments }
  })
  return {
    Version: 3,
    Meta: {
      Duration: duration,
      Fps: 30,
      Loop: false,
      AreBeziersRestricted: true,
      CurveCount: curves.length,
      TotalSegmentCount: curves.reduce((total, curve) => total + (curve.Segments.length - 2) / 3, 0),
      TotalPointCount: curves.reduce((total, curve) => total + 1 + (curve.Segments.length - 2) / 3, 0),
      UserDataCount: 0,
      TotalUserDataSize: 0,
    },
    Curves: curves,
    UserData: [],
  }
}

// Every group intentionally contains one clip. live2d-renderer 0.6.x uses the
// group index as part of its preload cache key, so multi-clip and empty-name
// groups can overwrite the action that a later click expects to play.
const archivePlans = {
  'cafe-gun': {
    archive: 'cafe-gun.zip',
    motions: {
      Idle: 'Mgirl08_stand',
      PetGreet: 'Mgirl08_dazhaohu_a',
      TapHead: 'Mgirl08_motouweixiao',
      PetSmile: 'Mgirl08_weixiao',
      PetEncourage: 'Mgirl08_gongwu',
      PetAgree: 'Mgirl08_kending',
      PetSurprise: 'Mgirl08_jingya',
      PetCurious: 'Mgirl08_yihuo',
      PetThinking: 'Mgirl08_tuoyeyihuo',
      PetShy: 'Mgirl08_xiuxiuqieqie',
      PetFidget: 'Mgirl08_duishouzhi',
      PetAngry: 'Mgirl08_shengqi',
      PetSpeechless: 'Mgirl08_wuye',
      PetCrystalShoe: 'Mgirl08_shuijingxie',
      PetSkirt: 'Mgirl08_xianqunzi',
    },
  },
  hiyori: {
    archive: 'Hiyori.zip',
    motions: {
      Idle: '轻摇',
      TapBody: '被戳',
      PetGreet: '挥手',
      TapHead: '点头',
      PetHappy: '开心',
      PetSnack: '吃零食',
      PetShy: '害羞',
      PetCurious: '好奇',
      PetSleepy: '哈欠',
      PetBreath: '呼吸',
      PetLookAround: '环顾',
      PetBlush: '脸红摇摆',
      PetDoze: '闭眼轻晃',
      PetExplore: '四处张望',
      PetExpect: '捧脸期待',
      PetSurprise: '惊讶',
      PetCheer: '双手加油',
      PetWronged: '委屈',
      PetWorried: '担心',
    },
  },
  mao_pro: {
    archive: 'mao_pro.zip',
    motions: {
      Idle: '待机',
      PetGreet: '挥手',
      TapHead: '点头',
      PetHappy: '开心',
      PetSnack: '吃零食',
      PetShy: '害羞',
      PetCurious: '好奇',
      PetSleepy: '哈欠',
      PetBreath: '呼吸',
      PetLookAround: '环顾',
      PetStretch: '伸展',
      TapBody: '摇摆',
      PetHat: '扶帽',
      PetHeal: '治愈魔法',
      PetAngry: '爆破魔法',
      PetRabbit: '兔兔魔法',
    },
  },
  'mori-suit': {
    archive: 'mori-suit.zip',
    relativeExpressions: 'face_nor',
    motionOverrides: {
      // 原始 mtn_shake 只写 ParamBodyAngleY；该参数在 Mori 成品模型中不会
      // 产生可见变化。改用已由俯身/开心动作验证可用的竖直身体参数。
      mtn_shake: {
        Version: 3,
        Meta: {
          Duration: 1.8,
          Fps: 30,
          Loop: true,
          AreBeziersRestricted: true,
          CurveCount: 1,
          TotalSegmentCount: 4,
          TotalPointCount: 5,
          UserDataCount: 0,
          TotalUserDataSize: 0,
        },
        Curves: [{
          Target: 'Parameter',
          Id: 'ParamBodyVertical',
          Segments: [0, 0, 0, 0.45, 0.06, 0, 0.9, 0, 0, 1.35, -0.045, 0, 1.8, 0],
        }],
        UserData: [],
      },
      // ParamArmL / ParamArmR 存在于 moc3 参数表中，但没有任何关键形，
      // 从 -10 到 10 都不会改变 drawable。原动作只写这两个无效参数，因而
      // 看起来完全没有手部动作。Mori 的双手素材是合掌姿态，无法在不重做
      // moc3 的前提下拆成单手挥动；这里改为合掌摇摆问候，让双手随上身
      // 明显左右移动，并用轻鞠躬、点头、眨眼、狐耳和尾巴补足问候语义。
      mtn_shake_huishou: createLinearMotion(2.2, {
        ParamBodyAngleX: [
          [0, 0], [0.18, -2], [0.45, 6], [0.72, -6], [0.99, 6],
          [1.26, -5], [1.53, 4], [1.82, -2], [2.08, 0], [2.2, 0],
        ],
        ParamBodyAngleY: [
          [0, 0], [0.18, -2], [0.38, -5], [0.55, 1], [0.72, 0],
          [1.82, -1], [2.08, 0], [2.2, 0],
        ],
        ParamBodyAngleZ: [
          [0, 0], [0.18, -2], [0.45, 7], [0.72, -7], [0.99, 7],
          [1.26, -6], [1.53, 4], [1.82, -2], [2.08, 0], [2.2, 0],
        ],
        ParamBodyVertical: [
          [0, 0], [0.18, 0.06], [0.38, -0.1], [0.55, 0.05], [0.72, 0],
          [0.99, 0.05], [1.26, -0.03], [1.53, 0.04], [1.82, 0], [2.2, 0],
        ],
        ParamAngleY: [
          [0, 0], [0.18, -3], [0.38, -10], [0.55, 3], [0.72, 0], [2.2, 0],
        ],
        ParamAngleZ: [
          [0, 0], [0.18, 3], [0.45, -8], [0.72, 8], [0.99, -8],
          [1.26, 7], [1.53, -5], [1.82, 3], [2.08, 0], [2.2, 0],
        ],
        ParamTail: [
          [0, 0], [0.18, 0.15], [0.45, 0.55], [0.72, -0.45], [0.99, 0.6],
          [1.26, -0.45], [1.53, 0.4], [1.82, -0.2], [2.08, 0], [2.2, 0],
        ],
        ParamTailHide: [[0, 0], [2.2, 0]],
        ParamFoxearL: [
          [0, 0], [0.18, -0.15], [0.35, 0.18], [0.52, -0.35], [0.7, 0.1],
          [0.9, -0.25], [1.08, 0.15], [1.3, -0.2], [1.52, 0.08], [1.8, 0], [2.2, 0],
        ],
        ParamFoxearR: [
          [0, 0], [0.28, -0.15], [0.45, 0.18], [0.62, -0.35], [0.8, 0.1],
          [1, -0.25], [1.18, 0.15], [1.4, -0.2], [1.62, 0.08], [1.9, 0], [2.2, 0],
        ],
        ParamEyeLOpen: [
          [0, 1], [0.28, 1], [0.36, 0.15], [0.46, 1],
          [1.42, 1], [1.5, 0.1], [1.6, 1], [2.2, 1],
        ],
        ParamEyeROpen: [
          [0, 1], [0.28, 1], [0.36, 0.15], [0.46, 1],
          [1.42, 1], [1.5, 0.1], [1.6, 1], [2.2, 1],
        ],
      }),
    },
    motions: {
      Idle: 'mtn_shake',
      PetGreet: 'mtn_shake_huishou',
      PetSit: 'mtn_fushen',
      PetStand: 'mtn_qishen',
      PetHappy: 'mtn_shakeh',
      TapHead: 'head_diantou',
      PetAngry: 'head_yaotou',
    },
  },
}

function archiveRoot(descriptorName) {
  return descriptorName.slice(0, descriptorName.lastIndexOf('/') + 1)
}

function assetStem(fileName) {
  return path.posix.basename(fileName).replace(/\.(motion3|exp3)\.json$/i, '')
}

async function convertExpressionsToRelative(zip, descriptor, root, neutralStem) {
  const expressions = descriptor.FileReferences && Array.isArray(descriptor.FileReferences.Expressions)
    ? descriptor.FileReferences.Expressions
    : []
  const neutralReference = expressions.find(item => assetStem(item.File || '') === neutralStem)
  if (!neutralReference) throw new Error(`neutral expression is missing: ${neutralStem}`)

  const neutralName = `${root}${neutralReference.File}`
  const neutralEntry = zip.file(neutralName)
  if (!neutralEntry) throw new Error(`neutral expression file is missing: ${neutralReference.File}`)
  const neutralData = JSON.parse(await neutralEntry.async('string'))
  const neutralValues = new Map((neutralData.Parameters || []).map(parameter => [parameter.Id, Number(parameter.Value) || 0]))

  for (const reference of expressions) {
    const entryName = `${root}${reference.File}`
    const entry = zip.file(entryName)
    if (!entry) throw new Error(`expression file is missing: ${reference.File}`)
    const expression = JSON.parse(await entry.async('string'))
    expression.Parameters = (expression.Parameters || []).map(parameter => ({
      Id: parameter.Id,
      Value: Number((Number(parameter.Value) - (neutralValues.get(parameter.Id) || 0)).toFixed(6)),
      Blend: 'Add',
    }))
    zip.file(entryName, `${JSON.stringify(expression, null, 2)}\n`, {
      date: entry.date,
      unixPermissions: entry.unixPermissions,
      dosPermissions: entry.dosPermissions,
    })
  }
}

async function cleanArchive(modelId, plan) {
  const archivePath = path.join(projectRoot, 'models', modelId, plan.archive)
  const zip = await JSZip.loadAsync(fs.readFileSync(archivePath))
  const descriptorName = Object.keys(zip.files).find(name => name.toLowerCase().endsWith('.model3.json'))
  if (!descriptorName) throw new Error(`${modelId}: missing .model3.json`)

  const descriptorEntry = zip.file(descriptorName)
  const descriptor = JSON.parse(await descriptorEntry.async('string'))
  const root = archiveRoot(descriptorName)
  const motionDirectory = `${root}motions/`
  const keptFiles = new Set()
  const groups = {}

  for (const [group, stem] of Object.entries(plan.motions)) {
    const relativeFile = `motions/${stem}.motion3.json`
    const archiveFile = `${root}${relativeFile}`
    if (!zip.file(archiveFile)) throw new Error(`${modelId}: planned motion is missing: ${relativeFile}`)
    if (keptFiles.has(archiveFile)) throw new Error(`${modelId}: motion is assigned more than once: ${relativeFile}`)
    keptFiles.add(archiveFile)
    groups[group] = [{ File: relativeFile }]
    if (plan.motionOverrides && plan.motionOverrides[stem]) {
      const entry = zip.file(archiveFile)
      zip.file(archiveFile, JSON.stringify(plan.motionOverrides[stem]), {
        date: entry.date,
        unixPermissions: entry.unixPermissions,
        dosPermissions: entry.dosPermissions,
      })
    }
  }

  const removed = []
  for (const name of Object.keys(zip.files)) {
    if (name.startsWith(motionDirectory) && name.toLowerCase().endsWith('.motion3.json') && !keptFiles.has(name)) {
      zip.remove(name)
      removed.push(name.slice(motionDirectory.length))
    }
  }

  descriptor.FileReferences = descriptor.FileReferences || {}
  descriptor.FileReferences.Motions = groups
  if (plan.relativeExpressions) {
    await convertExpressionsToRelative(zip, descriptor, root, plan.relativeExpressions)
  }
  zip.file(descriptorName, `${JSON.stringify(descriptor, null, 2)}\n`, {
    date: descriptorEntry.date,
    unixPermissions: descriptorEntry.unixPermissions,
    dosPermissions: descriptorEntry.dosPermissions,
  })

  const output = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'DOS',
  })
  fs.writeFileSync(archivePath, output)
  return {
    modelId,
    archive: plan.archive,
    groups: Object.keys(groups).length,
    removed,
    bytes: output.length,
  }
}

async function run() {
  const requestedModelIds = process.argv.slice(2)
  const selectedPlans = requestedModelIds.length
    ? Object.entries(archivePlans).filter(([modelId]) => requestedModelIds.includes(modelId))
    : Object.entries(archivePlans)
  if (requestedModelIds.length && selectedPlans.length !== requestedModelIds.length) {
    const known = new Set(selectedPlans.map(([modelId]) => modelId))
    throw new Error(`unknown model plan: ${requestedModelIds.filter(modelId => !known.has(modelId)).join(', ')}`)
  }
  const results = []
  for (const [modelId, plan] of selectedPlans) {
    results.push(await cleanArchive(modelId, plan))
  }
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
