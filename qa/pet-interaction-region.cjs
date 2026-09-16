const assert = require('assert/strict')
const { resolvePetInteractionPolicy } = require('../config/pet-interaction-region')

const fullStage = { id: 'full-stage' }
const characterRegion = { id: 'character' }
const chatRegion = { id: 'chat' }
const bubbleRegion = { id: 'bubble' }
const statusRegion = { id: 'status' }
const readerRegion = { id: 'reader' }

const lockedWithOpenSurfaces = resolvePetInteractionPolicy({
  interactionMode: 'locked',
  chatOpen: true,
  longMessageOpen: true,
  fullStage,
  characterRegion,
  chatRegion,
  bubbleRegion,
  statusRegion,
  readerRegion,
})
assert.equal(lockedWithOpenSurfaces.ignoreMouseEvents, true)
assert.equal(lockedWithOpenSurfaces.useFullStage, true)
assert.deepEqual(lockedWithOpenSurfaces.regions, [fullStage, readerRegion])

const smartChat = resolvePetInteractionPolicy({
  interactionMode: 'smart',
  chatOpen: true,
  fullStage,
  characterRegion,
  chatRegion,
  bubbleRegion,
  statusRegion,
})
assert.equal(smartChat.ignoreMouseEvents, false)
assert.equal(smartChat.useFullStage, false)
assert.deepEqual(smartChat.regions, [characterRegion, bubbleRegion, statusRegion, chatRegion])
assert.equal(smartChat.regions.includes(fullStage), false)

const closedChatWithStaleBounds = resolvePetInteractionPolicy({
  interactionMode: 'smart',
  chatOpen: false,
  fullStage,
  characterRegion,
  chatRegion,
})
assert.deepEqual(closedChatWithStaleBounds.regions, [characterRegion])

const backgroundDetection = resolvePetInteractionPolicy({
  interactionMode: 'smart',
  backgroundDetection: true,
  chatOpen: true,
  fullStage,
  characterRegion,
  chatRegion,
})
assert.equal(backgroundDetection.ignoreMouseEvents, false)
assert.equal(backgroundDetection.useFullStage, true)
assert.deepEqual(backgroundDetection.regions, [fullStage])

const layoutTransition = resolvePetInteractionPolicy({
  interactionMode: 'smart',
  chatOpen: true,
  longMessageOpen: true,
  transitionActive: true,
  fullStage,
  characterRegion,
  chatRegion,
  readerRegion,
})
assert.deepEqual(layoutTransition.regions, [characterRegion])

process.stdout.write(JSON.stringify({
  passed: true,
  assertions: {
    lockAlwaysPassesMouseThrough: true,
    lockDoesNotDiscardReaderVisualDuringCollapse: true,
    chatUsesMeasuredRegionInsteadOfFullStage: true,
    closedChatIgnoresStaleBounds: true,
    backgroundDetectionStillUsesFullStage: true,
    transitionKeepsStageOnly: true,
  },
}, null, 2))
