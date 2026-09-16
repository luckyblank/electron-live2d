'use strict'

const PET_GESTURE_LIMITS = Object.freeze({
  moveThreshold: 6,
  longPressMs: 650,
  multiClickMs: 300,
  dragReactionThreshold: 24,
  dragReactionCooldownMs: 1800,
  live2dHeadRatio: 0.34,
  videoHeadRatio: 0.42,
})

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function classifyPointerRelease({
  dragging = false,
  longPressTriggered = false,
  moved = 0,
  elapsed = 0,
  onPet = false,
} = {}) {
  if (dragging) return 'drag'
  if (longPressTriggered) return 'long-press'
  if (!onPet || finiteNumber(moved, Infinity) >= PET_GESTURE_LIMITS.moveThreshold) return 'none'
  return finiteNumber(elapsed, Infinity) >= PET_GESTURE_LIMITS.longPressMs ? 'long-press' : 'click'
}

function isWithinMultiClickWindow(elapsed) {
  const milliseconds = finiteNumber(elapsed, Infinity)
  return milliseconds >= 0 && milliseconds <= PET_GESTURE_LIMITS.multiClickMs
}

function advanceMultiClick(currentCount, elapsed) {
  const count = Math.max(0, Math.floor(finiteNumber(currentCount, 0)))
  const continues = count > 0 && isWithinMultiClickWindow(elapsed)
  return {
    flushCount: continues ? 0 : count,
    nextCount: continues ? count + 1 : 1,
  }
}

function classifyHitAreaRole(...values) {
  const text = values.map(value => String(value || '').trim()).filter(Boolean).join(' ').toLowerCase()
  if (/head|face|头|脸/.test(text)) return 'head'
  if (/body|torso|身体|躯干/.test(text)) return 'body'
  return 'other'
}

function pointIsHeadByPolicy({
  pointY,
  pointX,
  hitAreas = [],
  visibleBounds = null,
  video = false,
} = {}) {
  const info = hitAreas && !Array.isArray(hitAreas) && typeof hitAreas === 'object'
    ? hitAreas
    : { hits: Array.isArray(hitAreas) ? hitAreas : [], hasHeadArea: false }
  const hits = (Array.isArray(info.hits) ? info.hits : []).map(hit => {
    if (hit && typeof hit === 'object') {
      return hit.role || classifyHitAreaRole(hit.name, hit.id)
    }
    return classifyHitAreaRole(hit)
  })

  if (hits.includes('head')) return true
  if (info.hasHeadArea) return false

  const y = finiteNumber(pointY, Infinity)
  const x = finiteNumber(pointX, Infinity)
  const boundsX = finiteNumber(visibleBounds && visibleBounds.x, NaN)
  const boundsY = finiteNumber(visibleBounds && visibleBounds.y, NaN)
  const boundsWidth = finiteNumber(visibleBounds && visibleBounds.width, NaN)
  const boundsHeight = finiteNumber(visibleBounds && visibleBounds.height, NaN)
  if (
    !Number.isFinite(boundsX) || !Number.isFinite(boundsY) ||
    !Number.isFinite(boundsWidth) || !Number.isFinite(boundsHeight) ||
    boundsWidth <= 0 || boundsHeight <= 0 ||
    x < boundsX || x > boundsX + boundsWidth || y < boundsY || y > boundsY + boundsHeight
  ) return false

  const ratio = video ? PET_GESTURE_LIMITS.videoHeadRatio : PET_GESTURE_LIMITS.live2dHeadRatio
  return y <= boundsY + boundsHeight * ratio
}

module.exports = {
  PET_GESTURE_LIMITS,
  advanceMultiClick,
  classifyHitAreaRole,
  classifyPointerRelease,
  isWithinMultiClickWindow,
  pointIsHeadByPolicy,
}
