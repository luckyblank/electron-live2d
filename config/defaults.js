const defaultsJSON = require('./defaults.json')

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

// defaults.json 是新用户四个设置页的唯一默认配置源；这个模块只负责
// 冻结配置，并转换为 electron-store 所需的扁平初始化结构。
const INITIAL_USER_DEFAULTS = deepFreeze(defaultsJSON)
const CURRENT_SCHEMA_VERSION = INITIAL_USER_DEFAULTS.schemaVersion

const PREFERENCE_DEFAULTS = Object.freeze({
  ...INITIAL_USER_DEFAULTS.behavior,
  ...INITIAL_USER_DEFAULTS.system,
  onboardingSeen: INITIAL_USER_DEFAULTS.characters.onboardingSeen,
  chatGreeting: INITIAL_USER_DEFAULTS.ai.chatGreeting,
  longMessageCharacterThreshold: INITIAL_USER_DEFAULTS.ai.longMessageCharacterThreshold,
  appLongMessageAutoExpand: INITIAL_USER_DEFAULTS.ai.appLongMessageAutoExpand,
  externalLongMessageAutoExpand: INITIAL_USER_DEFAULTS.ai.externalLongMessageAutoExpand,
  appMessageStreamingOutput: INITIAL_USER_DEFAULTS.ai.appMessageStreamingOutput,
  externalMessageStreamingOutput: INITIAL_USER_DEFAULTS.ai.externalMessageStreamingOutput,
})

function createInitialAIPluginState() {
  return {
    installed: [...INITIAL_USER_DEFAULTS.ai.installedPluginIds],
    activeIds: { ...INITIAL_USER_DEFAULTS.ai.activePluginIds },
    settings: { ...INITIAL_USER_DEFAULTS.ai.pluginSettings },
    secrets: { ...INITIAL_USER_DEFAULTS.ai.credentials },
    credentialPreferences: { ...INITIAL_USER_DEFAULTS.ai.credentialPreferences },
  }
}

function createInitialStoreDefaults() {
  return {
    // 新配置始终直接使用 defaults.json 中的当前结构版本。
    schemaVersion: CURRENT_SCHEMA_VERSION,
    windowX: undefined,
    windowY: undefined,
    currentModelId: '',
    modelOrder: [...INITIAL_USER_DEFAULTS.characters.modelOrder],
    modelScales: { ...INITIAL_USER_DEFAULTS.characters.modelScales },
    modelOpacities: { ...INITIAL_USER_DEFAULTS.characters.modelOpacities },
    modelScaleApplyToAll: INITIAL_USER_DEFAULTS.characters.modelScaleApplyToAll === true,
    modelOpacityApplyToAll: INITIAL_USER_DEFAULTS.characters.modelOpacityApplyToAll === true,
    sharedModelScale: INITIAL_USER_DEFAULTS.characters.sharedModelScale,
    sharedModelOpacity: INITIAL_USER_DEFAULTS.characters.sharedModelOpacity,
    modelNicknames: { ...INITIAL_USER_DEFAULTS.characters.modelNicknames },
    modelProfiles: Object.fromEntries(Object.entries(INITIAL_USER_DEFAULTS.characters.modelProfiles || {}).map(
      ([modelId, profile]) => [modelId, { ...profile }]
    )),
    modelInteractions: {},
    modelGestures: {},
    ignoredUpdateVersion: '',
    aiPlugins: createInitialAIPluginState(),
    aiConversations: { ...INITIAL_USER_DEFAULTS.ai.conversations },
    aiExternalConversations: {},
    externalMessageHistory: [],
    ...PREFERENCE_DEFAULTS,
  }
}

module.exports = {
  CURRENT_SCHEMA_VERSION,
  INITIAL_USER_DEFAULTS,
  PREFERENCE_DEFAULTS,
  createInitialAIPluginState,
  createInitialStoreDefaults,
}
