'use strict'

const assert = require('assert')
const {
  PET_GESTURE_LIMITS,
  advanceMultiClick,
  classifyHitAreaRole,
  classifyPointerRelease,
  isWithinMultiClickWindow,
  pointIsHeadByPolicy,
} = require('../config/pet-gesture-policy')

assert.strictEqual(PET_GESTURE_LIMITS.multiClickMs, 300)
assert.strictEqual(classifyPointerRelease({ moved: 0, elapsed: 519, onPet: true }), 'click')
assert.strictEqual(classifyPointerRelease({ moved: 0, elapsed: 520, onPet: true }), 'click')
assert.strictEqual(classifyPointerRelease({ moved: 0, elapsed: 649, onPet: true }), 'click')
assert.strictEqual(classifyPointerRelease({ moved: 0, elapsed: 650, onPet: true }), 'long-press')
assert.strictEqual(classifyPointerRelease({ moved: 0, elapsed: 651, onPet: true }), 'long-press')
assert.strictEqual(classifyPointerRelease({ longPressTriggered: true, onPet: true }), 'long-press')
assert.strictEqual(classifyPointerRelease({ moved: 5.9, elapsed: 100, onPet: true }), 'click')
assert.strictEqual(classifyPointerRelease({ moved: 6, elapsed: 100, onPet: true }), 'none')
assert.strictEqual(classifyPointerRelease({ dragging: true, moved: 30, onPet: true }), 'drag')
assert.strictEqual(classifyPointerRelease({ moved: 0, elapsed: 100, onPet: false }), 'none')
assert.strictEqual(isWithinMultiClickWindow(280), true)
assert.strictEqual(isWithinMultiClickWindow(320), false)
assert.deepStrictEqual(advanceMultiClick(0, Infinity), { flushCount: 0, nextCount: 1 })
assert.deepStrictEqual(advanceMultiClick(1, 280), { flushCount: 0, nextCount: 2 })
assert.deepStrictEqual(advanceMultiClick(2, 280), { flushCount: 0, nextCount: 3 })
assert.deepStrictEqual(advanceMultiClick(1, 320), { flushCount: 1, nextCount: 1 })

assert.strictEqual(classifyHitAreaRole('Head', ''), 'head')
assert.strictEqual(classifyHitAreaRole('', 'HitAreaHead'), 'head')
assert.strictEqual(classifyHitAreaRole('Body', 'HitArea'), 'body')
assert.strictEqual(pointIsHeadByPolicy({
  pointX: 200,
  pointY: 500,
  hitAreas: { hits: [{ id: 'HitAreaHead', role: 'head' }], hasHeadArea: true },
  visibleBounds: { x: 100, y: 100, width: 200, height: 300 },
}), true)
assert.strictEqual(pointIsHeadByPolicy({
  pointX: 200,
  pointY: 150,
  hitAreas: { hits: [{ id: 'HitAreaBody', role: 'body' }], hasHeadArea: true },
  visibleBounds: { x: 100, y: 100, width: 200, height: 300 },
}), false)
assert.strictEqual(pointIsHeadByPolicy({
  pointX: 200,
  pointY: 201,
  hitAreas: { hits: [{ name: 'Body', role: 'body' }], hasHeadArea: false },
  visibleBounds: { x: 100, y: 100, width: 200, height: 300 },
}), true)
assert.strictEqual(pointIsHeadByPolicy({ pointX: 200, pointY: 203, visibleBounds: { x: 100, y: 100, width: 200, height: 300 } }), false)
assert.strictEqual(pointIsHeadByPolicy({ pointX: 200, pointY: 225, visibleBounds: { x: 100, y: 100, width: 200, height: 300 }, video: true }), true)
assert.strictEqual(pointIsHeadByPolicy({ pointX: 50, pointY: 150, visibleBounds: { x: 100, y: 100, width: 200, height: 300 } }), false)
assert.strictEqual(pointIsHeadByPolicy({ pointX: 200, pointY: 150, visibleBounds: null }), false)

console.log('Pet gesture policy QA passed.')
