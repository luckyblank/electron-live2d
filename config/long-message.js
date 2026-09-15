const defaults = require('./defaults.json')

const LONG_MESSAGE_CHARACTER_THRESHOLD_MIN = 10
const LONG_MESSAGE_CHARACTER_THRESHOLD_MAX = 500
const DEFAULT_LONG_MESSAGE_CHARACTER_THRESHOLD = Number(defaults.ai.longMessageCharacterThreshold) || 45

function normalizeLongMessageCharacterThreshold(
  value,
  fallback = DEFAULT_LONG_MESSAGE_CHARACTER_THRESHOLD
) {
  const fallbackNumber = Number(fallback)
  const safeFallback = Number.isFinite(fallbackNumber)
    ? Math.round(fallbackNumber)
    : DEFAULT_LONG_MESSAGE_CHARACTER_THRESHOLD
  const numericValue = typeof value === 'string' && !value.trim() ? Number.NaN : Number(value)
  const normalized = Number.isFinite(numericValue) ? Math.round(numericValue) : safeFallback
  return Math.min(
    LONG_MESSAGE_CHARACTER_THRESHOLD_MAX,
    Math.max(LONG_MESSAGE_CHARACTER_THRESHOLD_MIN, normalized)
  )
}

function countMessageCharacters(text) {
  return Array.from(String(text || '').replace(/\s/gu, '')).length
}

function isLongMessageText(text, threshold = DEFAULT_LONG_MESSAGE_CHARACTER_THRESHOLD) {
  return countMessageCharacters(text) > normalizeLongMessageCharacterThreshold(threshold)
}

module.exports = {
  DEFAULT_LONG_MESSAGE_CHARACTER_THRESHOLD,
  LONG_MESSAGE_CHARACTER_THRESHOLD_MIN,
  LONG_MESSAGE_CHARACTER_THRESHOLD_MAX,
  normalizeLongMessageCharacterThreshold,
  countMessageCharacters,
  isLongMessageText,
}
