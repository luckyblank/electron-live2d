function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

// cafe-gun 没有原生 .exp3.json。下面这组基线来自它的 stand 动作，只保留
// 眉眼、嘴型、脸红和情绪装饰参数；每个生成表情都带完整基线，因此从生气、
// 惊讶等状态切回默认时不会残留黑线、脸红或特殊眼型。
const CAFE_GUN_NEUTRAL_FACE = {
  PARAM_EYE_L_OPEN: 1,
  PARAM_EYE_R_OPEN: 1,
  PARAM_EYE_L_Deform: 0.5,
  PARAM_EYE_R_Deform: 0.5,
  PARAM_EYEBALL_TYPE: 0,
  PARAM_EYEBALL_CHANGE: 0,
  PARAM_EYESMALL: 0,
  PARAM_EYETYPE1: 0,
  PARAM_EYETYPE2: 0,
  PARAM_EYECHANGE: 0,
  PARAM_TEAR: 0,
  PARAM_BROW_L_X: 0,
  PARAM_BROW_L_Y: 0,
  PARAM_BROW_L_ANGLE: 0,
  PARAM_BROW_L_FORM: 0,
  PARAM_BROW_R_X: 0,
  PARAM_BROW_R_Y: 0,
  PARAM_BROW_R_ANGLE: 0,
  PARAM_BROW_R_FORM: 0,
  PARAM_MOUTH_FORM: -0.5,
  PARAM_MOUTH_OPEN_Y: 0,
  PARAM_MOUTH_WID: -0.5,
  PARAM_MOUTHTYPE1: 0,
  PARAM_MOUTHTYPE2: 0,
  PARAM_MOUTH_SPEACIAL1: 0,
  PARAM_MOUTH_SPEACIAL2: 0,
  PARAM_CheekNormal: 0.6,
  PARAM_CHEEK: 0,
  PARAM_CHEEK1: 0,
  PARAM_HEIXIAN0: 0,
  PARAM_HEIXIAN: 0,
  PARAM_HEIXIAN1: 0,
  PARAM_HAN: 0,
  PARAM_QI: 0,
  PARAM_NOSE_HY: 0,
  PARAM_FACE_DU: 0,
  PARAM_ZHAMAO: 0,
  PARAM_PENTI: 0,
  PARAM_PENTIZ: 0,
}

function cafeGunExpression(overrides = {}, fadeInTime = 0.22, fadeOutTime = 0.35) {
  return {
    fadeInTime,
    fadeOutTime,
    parameters: Object.entries({ ...CAFE_GUN_NEUTRAL_FACE, ...overrides })
      .map(([id, value]) => ({ id, value })),
  }
}

// 内置模型的显式互动映射，优先级高于 ZIP 自带的动作组名称。
//
// 每个 actions 条目按互动语义列出可播放的 motion 文件 stem（不含路径和
// .motion3.json 后缀）。渲染器会先尝试这里的映射；若映射缺失、文件不存在
// 或动作无法解析，再退回 ZIP 中 Idle / TapBody / PetGreet 等规范命名组。
//
// expressions 指向 ZIP 中原生 .exp3.json 的文件 stem。若原生表情不存在，
// 只有同 stem 的 motion 已被显式登记时才会转换成表情作为兼容兜底。
const MODEL_REACTION_PROFILES = deepFreeze({
  'cafe-gun': {
    // 该模型的原始包把动作全部登记在空名称组中，不能依赖动作组语义；这里按
    // 文件的拼音原名逐项映射。它没有 .exp3.json，因此情绪主要由动作表达。
    //
    // 它的视线参数也沿用旧式全大写命名，而 live2d-renderer 只会自动写入
    // ParamAngleX / ParamEyeBallX 等新版标准名，所以必须显式映射。为了符合
    // 角色端庄、柔和的形象，眼睛先响应，头部随后，身体只做小幅滞后跟随；
    // 避免头、眼、身体以相同速度和幅度同步旋转造成僵硬感。
    cursorFollow: {
      deadZone: 0.025,
      parameters: [
        // 眼球使用原始目标点并快速缓动，视线会自然地比头部早半拍到达。
        { id: 'PARAM_EYE_BALL_X', source: 'x', input: 'target', scale: 0.82, response: 13 },
        { id: 'PARAM_EYE_BALL_Y', source: 'y', input: 'target', scale: 0.58, response: 11 },
        // 头部使用 Cubism 自带的惯性结果，再增加一层柔和阻尼并收小转动幅度。
        { id: 'PARAM_ANGLE_X', source: 'x', input: 'drag', scale: 18, response: 6.2 },
        { id: 'PARAM_ANGLE_Y', source: 'y', input: 'drag', scale: 13, response: 5.4 },
        { id: 'PARAM_ANGLE_Z', source: 'x', input: 'drag', scale: -3.8, response: 3.8 },
        // 身体只承担重心跟随，不再和头部同幅度摆动，长裙轮廓会更稳重。
        { id: 'PARAM_BODY_ANGLE_X', source: 'x', input: 'drag', scale: 3.6, response: 2.8 },
        { id: 'PARAM_BODY_ANGLE_Y', source: 'y', input: 'drag', scale: 1.4, response: 2.3 },
      ],
    },
    // 从原动作的表情峰值中提取并人工收敛幅度，生成只影响脸部的独立表情。
    // 眼球 X/Y 不写入这里，确保所有表情下仍能继续跟随鼠标。
    neutralExpression: '默认',
    generatedExpressions: {
      默认: cafeGunExpression({}, 0.16, 0.25),
      微笑: cafeGunExpression({
        PARAM_EYE_L_Deform: 0.3,
        PARAM_EYE_R_Deform: 0.3,
        PARAM_EYEBALL_CHANGE: -0.72,
        PARAM_BROW_L_Y: 0.38,
        PARAM_BROW_R_Y: 0.38,
        PARAM_BROW_L_ANGLE: 0.28,
        PARAM_BROW_R_ANGLE: 0.31,
        PARAM_MOUTH_FORM: 0.42,
        PARAM_MOUTH_OPEN_Y: 0.32,
        PARAM_MOUTH_WID: -0.86,
        PARAM_CHEEK: 0.72,
      }),
      害羞: cafeGunExpression({
        PARAM_EYE_L_OPEN: 0.78,
        PARAM_EYE_R_OPEN: 0.78,
        PARAM_EYE_L_Deform: 0.38,
        PARAM_EYE_R_Deform: 0.38,
        PARAM_BROW_L_ANGLE: 0.42,
        PARAM_BROW_R_ANGLE: 0.43,
        PARAM_BROW_L_FORM: -0.26,
        PARAM_BROW_R_FORM: -0.28,
        PARAM_MOUTH_FORM: 0,
        PARAM_MOUTH_WID: -0.92,
        PARAM_CHEEK: 0.9,
      }),
      惊讶: cafeGunExpression({
        PARAM_EYE_L_Deform: 0.16,
        PARAM_EYE_R_Deform: 0.22,
        PARAM_EYEBALL_TYPE: 1,
        PARAM_EYEBALL_CHANGE: -1,
        PARAM_BROW_L_Y: 0.48,
        PARAM_BROW_R_Y: 0.48,
        PARAM_BROW_L_ANGLE: 0.35,
        PARAM_BROW_R_ANGLE: 0.4,
        PARAM_MOUTH_FORM: -1,
        PARAM_MOUTH_OPEN_Y: 0.86,
        PARAM_MOUTH_WID: -0.94,
        PARAM_CHEEK: 0.28,
      }, 0.12, 0.28),
      疑惑: cafeGunExpression({
        PARAM_EYE_L_Deform: 0.3,
        PARAM_EYE_R_Deform: 0.28,
        PARAM_BROW_L_Y: 0.18,
        PARAM_BROW_R_Y: 0.78,
        PARAM_BROW_L_ANGLE: 0.16,
        PARAM_BROW_R_ANGLE: 0.52,
        PARAM_BROW_L_FORM: -0.14,
        PARAM_BROW_R_FORM: -0.12,
        PARAM_MOUTH_FORM: 0.7,
        PARAM_MOUTH_OPEN_Y: 0.28,
        PARAM_MOUTH_WID: -0.92,
        PARAM_CHEEK: 0.18,
      }),
      生气: cafeGunExpression({
        PARAM_EYE_L_Deform: 0.54,
        PARAM_EYE_R_Deform: 0.58,
        PARAM_BROW_L_Y: 0.14,
        PARAM_BROW_R_Y: 0.1,
        PARAM_BROW_L_ANGLE: -0.76,
        PARAM_BROW_R_ANGLE: -0.79,
        PARAM_BROW_L_FORM: -0.58,
        PARAM_BROW_R_FORM: -0.56,
        PARAM_MOUTH_FORM: 0.45,
        PARAM_MOUTH_OPEN_Y: 0.1,
        PARAM_MOUTH_WID: -0.94,
        PARAM_CHEEK1: 0.75,
      }, 0.15, 0.3),
      无语: cafeGunExpression({
        PARAM_EYE_L_OPEN: 0.46,
        PARAM_EYE_R_OPEN: 0.46,
        PARAM_EYE_L_Deform: 0.35,
        PARAM_EYE_R_Deform: 0.39,
        PARAM_BROW_L_Y: -0.32,
        PARAM_BROW_R_Y: -0.32,
        PARAM_BROW_L_ANGLE: 0.28,
        PARAM_BROW_R_ANGLE: 0.28,
        PARAM_BROW_L_FORM: -0.38,
        PARAM_BROW_R_FORM: -0.38,
        PARAM_MOUTH_FORM: 0.48,
        PARAM_MOUTH_WID: -0.94,
        PARAM_CHEEK1: 0.82,
      }),
    },
    expressions: {
      idle: '默认',
      greet: '微笑',
      head: '害羞',
      shy: '害羞',
      praise: '微笑',
      snack: '微笑',
      calm: '默认',
      curious: '疑惑',
      excited: '惊讶',
      sad: '无语',
      angry: '生气',
      drag: '惊讶',
    },
    actions: {
      idle: [{ clip: 'Mgirl08_stand' }],
      tap: [{ clip: 'Mgirl08_jingya' }, { clip: 'Mgirl08_wuye' }],
      greet: [{ clip: 'Mgirl08_dazhaohu_a' }],
      head: [{ clip: 'Mgirl08_motouweixiao' }],
      happy: [
        { clip: 'Mgirl08_weixiao' },
        { clip: 'Mgirl08_gongwu' },
        { clip: 'Mgirl08_kending' },
      ],
      // 原资源没有进食动作，用肯定/微笑作为不突兀的正向回应。
      snack: [{ clip: 'Mgirl08_kending' }, { clip: 'Mgirl08_weixiao' }],
      shy: [{ clip: 'Mgirl08_xiuxiuqieqie' }, { clip: 'Mgirl08_duishouzhi' }],
      curious: [{ clip: 'Mgirl08_yihuo' }, { clip: 'Mgirl08_tuoyeyihuo' }],
      // 原资源没有睡眠动作，复用唯一待机片段作为安静状态。
      sleepy: [{ clip: 'Mgirl08_stand' }],
      sad: [{ clip: 'Mgirl08_wuye' }],
      angry: [{ clip: 'Mgirl08_shengqi' }],
      drag: [{ clip: 'Mgirl08_jingya' }],
    },
    previewClips: [
      'Mgirl08_stand',
      'Mgirl08_dazhaohu_a',
      'Mgirl08_motouweixiao',
      'Mgirl08_weixiao',
      'Mgirl08_gongwu',
      'Mgirl08_kending',
      'Mgirl08_jingya',
      'Mgirl08_yihuo',
      'Mgirl08_tuoyeyihuo',
      'Mgirl08_xiuxiuqieqie',
      'Mgirl08_duishouzhi',
      'Mgirl08_shengqi',
      'Mgirl08_wuye',
      'Mgirl08_shuijingxie',
      'Mgirl08_xianqunzi',
    ],
  },

  hiyori: {
    // Hiyori 的 ZIP 已有规范动作组；显式映射仍作为产品语义的高优先级选择，
    // 让“难过/生气/拖动”等 ZIP 未单独分组的互动也能命中合适资源。
    neutralExpression: '默认',
    actions: {
      idle: [{ clip: '轻摇' }],
      tap: [{ clip: '被戳' }],
      greet: [{ clip: '挥手' }],
      head: [{ clip: '点头' }],
      happy: [{ clip: '开心' }, { clip: '双手加油' }],
      snack: [{ clip: '吃零食' }],
      shy: [{ clip: '害羞' }, { clip: '脸红摇摆' }],
      curious: [{ clip: '好奇' }, { clip: '四处张望' }],
      sleepy: [{ clip: '哈欠' }, { clip: '闭眼轻晃' }],
      sad: [{ clip: '委屈' }, { clip: '担心' }],
      // 没有独立的生气 motion；“被戳”配合生气表情作为最接近的反馈。
      angry: [{ clip: '被戳' }],
      drag: [{ clip: '环顾' }],
    },
    expressions: {
      idle: '默认',
      greet: '微笑',
      head: '害羞',
      shy: '害羞',
      praise: '大笑',
      snack: '微笑',
      calm: '困倦',
      curious: '好奇',
      excited: '大笑',
      sad: '难过',
      angry: '生气',
      drag: '惊讶',
    },
    previewClips: [
      '轻摇', '呼吸', '环顾', '被戳', '挥手', '点头', '开心', '吃零食',
      '害羞', '好奇', '哈欠', '脸红摇摆', '闭眼轻晃', '四处张望',
      '捧脸期待', '惊讶', '双手加油', '委屈', '担心',
    ],
  },

  mao_pro: {
    // mao_pro 同时包含产品语义组和 Original 扩展动作。映射优先选取更有
    // 表现力的扩展动作；若某次模型包裁剪了这些文件，渲染器会回退到语义组。
    neutralExpression: '默认',
    actions: {
      idle: [{ clip: '待机' }],
      tap: [{ clip: '扶帽' }, { clip: '摇摆' }],
      greet: [{ clip: '挥手' }],
      head: [{ clip: '点头' }, { clip: '扶帽' }],
      happy: [{ clip: '开心' }, { clip: '治愈魔法' }, { clip: '兔兔魔法' }],
      snack: [{ clip: '吃零食' }],
      shy: [{ clip: '害羞' }],
      curious: [{ clip: '好奇' }, { clip: '伸展' }],
      sleepy: [{ clip: '哈欠' }],
      // 原资源没有难过 motion，用低强度扶帽动作叠加焦虑表情。
      sad: [{ clip: '扶帽' }],
      angry: [{ clip: '爆破魔法' }],
      drag: [{ clip: '摇摆' }],
    },
    expressions: {
      idle: '默认',
      greet: '微笑',
      head: '羞涩',
      shy: '羞涩',
      praise: '得意',
      snack: '笑眼',
      calm: '困倦',
      curious: '好奇',
      excited: '惊喜',
      sad: '焦虑',
      angry: '生气',
      drag: '惊讶',
    },
    previewClips: [
      '待机', '呼吸', '环顾', '挥手', '点头', '开心', '吃零食', '害羞',
      '好奇', '哈欠', '伸展', '摇摆', '扶帽', '治愈魔法', '爆破魔法',
      '兔兔魔法',
    ],
  },

  'mori-suit': {
    // Mori 把大量全身动作、局部耳尾参数和 face_* 表情预设混在空名称组。
    // 这里只选择可独立播放的完整动作，避免随机播放“恢复耳朵”等内部片段。
    neutralExpression: 'face_nor',
    actions: {
      idle: [{ clip: 'mtn_shake' }],
      tap: [{ clip: 'mtn_shake' }],
      greet: [{ clip: 'mtn_shake_huishou' }],
      head: [{ clip: 'head_diantou' }],
      shy: [{ clip: 'mtn_fushen', followUp: { clip: 'mtn_qishen', delay: 1250 } }],
      happy: [{ clip: 'mtn_shakeh' }],
      snack: [{ clip: 'head_diantou' }],
      curious: [{ clip: 'mtn_shake' }],
      sleepy: [{ clip: 'mtn_fushen', followUp: { clip: 'mtn_qishen', delay: 1600 } }],
      sad: [{ clip: 'mtn_fushen', followUp: { clip: 'mtn_qishen', delay: 1900 } }],
      angry: [{ clip: 'head_yaotou' }],
      drag: [{ clip: 'mtn_shake_huishou' }],
    },
    expressions: {
      idle: 'face_nor',
      greet: 'face_weixiao',
      head: 'face_gandong',
      shy: 'face_gandong',
      praise: 'face_daxiao',
      snack: 'face_xiao',
      calm: 'face_weixiao',
      curious: 'face_haoqi',
      excited: 'face_xingfen',
      sad: 'face_jusang',
      angry: 'face_xiaoqi',
      drag: 'face_haoqi',
    },
    previewClips: [
      'mtn_shake',
      'mtn_shake_huishou',
      'mtn_fushen',
      'mtn_shakeh',
      'head_diantou',
      'head_yaotou',
    ],
    // 默认/满足仍供互动重置和“吃零食”使用，但不作为独立预览入口。
    // 其余七种在眼睛、眉毛、嘴型或脸颊参数上都有明确差异。
    previewExpressions: [
      'face_weixiao',
      'face_gandong',
      'face_daxiao',
      'face_haoqi',
      'face_xingfen',
      'face_jusang',
      'face_xiaoqi',
    ],
  },
})

// 拼音资源名在设置页直接展示不够直观；中文资源名会自动使用自身文件名。
const PREVIEW_ACTION_LABELS = deepFreeze({
  Mgirl08_stand: '待机',
  Mgirl08_dazhaohu_a: '打招呼',
  Mgirl08_motouweixiao: '摸头微笑',
  Mgirl08_weixiao: '微笑',
  Mgirl08_gongwu: '鼓舞',
  Mgirl08_kending: '肯定',
  Mgirl08_jingya: '惊讶',
  Mgirl08_yihuo: '疑惑',
  Mgirl08_tuoyeyihuo: '托腮疑惑',
  Mgirl08_xiuxiuqieqie: '羞怯',
  Mgirl08_duishouzhi: '对手指',
  Mgirl08_shengqi: '生气',
  Mgirl08_wuye: '无语',
  Mgirl08_shuijingxie: '水晶鞋',
  Mgirl08_xianqunzi: '掀裙摆',
  mtn_shake_huishou: '挥手',
  mtn_fushen: '俯身',
  mtn_qishen: '起身',
  mtn_shakeh: '开心摇摆',
  mtn_shake: '待机',
  head_diantou: '点头',
  head_ditou: '低头',
  head_yaotou: '摇头',
})

const PREVIEW_EXPRESSION_LABELS = deepFreeze({
  face_nor: '默认',
  neutral: '默认',
  face_weixiao: '微笑',
  smile: '微笑',
  face_daxiao: '开心',
  happy: '开心',
  face_xingfen: '兴奋',
  excited: '兴奋',
  face_xiaoqi: '生气',
  angry: '生气',
  face_gandong: '害羞',
  touched: '害羞',
  face_jusang: '难过',
  sad: '难过',
  face_haoqi: '好奇',
  curious: '好奇',
  face_xiao: '满足',
  snack: '满足',
})

module.exports = {
  MODEL_REACTION_PROFILES,
  PREVIEW_ACTION_LABELS,
  PREVIEW_EXPRESSION_LABELS,
}
