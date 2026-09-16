function resolvePetInteractionPolicy({
  interactionMode = 'smart',
  backgroundDetection = false,
  chatOpen = false,
  longMessageOpen = false,
  transitionActive = false,
  fullStage = null,
  characterRegion = null,
  chatRegion = null,
  bubbleRegion = null,
  statusRegion = null,
  readerRegion = null,
} = {}) {
  const ignoreMouseEvents = interactionMode === 'locked'
  const useFullStage = ignoreMouseEvents || Boolean(backgroundDetection)
  const regions = []

  if (useFullStage && fullStage) regions.push(fullStage)
  else if (characterRegion) regions.push(characterRegion)

  if (!transitionActive && !useFullStage) {
    if (!longMessageOpen && bubbleRegion) regions.push(bubbleRegion)
    if (statusRegion) regions.push(statusRegion)
    if (chatOpen && chatRegion) regions.push(chatRegion)
  }

  // A side reader can live outside the 400x600 stage. Keep its visual surface
  // shaped until the renderer finishes the collapse transaction; locked mode
  // still passes all mouse input through the complete native window.
  if (!transitionActive && longMessageOpen && readerRegion) regions.push(readerRegion)

  return { ignoreMouseEvents, useFullStage, regions }
}

module.exports = { resolvePetInteractionPolicy }
