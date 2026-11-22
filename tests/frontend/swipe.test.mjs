// Test dello swipe tra sezioni. Esecuzione: node --test tests/frontend/swipe.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { axisLock, dragOffset, nextIndex, startsInEdge, swipeDecision } from '../../frontend/src/lib/swipe.js'

test('dito verso sinistra -> sezione successiva, verso destra -> precedente', () => {
  assert.equal(swipeDecision({ dx: -100, dy: 5, dt: 300 }), 1)
  assert.equal(swipeDecision({ dx: 100, dy: 5, dt: 300 }), -1)
})

test('gesto corto e lento non cambia sezione', () => {
  assert.equal(swipeDecision({ dx: -40, dy: 0, dt: 400 }), 0)
})

test('gesto corto ma rapido (flick) cambia sezione', () => {
  assert.equal(swipeDecision({ dx: -35, dy: 0, dt: 60 }), 1)
  assert.equal(swipeDecision({ dx: 35, dy: 0, dt: 60 }), -1)
})

test('flick troppo breve (< 30 px) non conta', () => {
  assert.equal(swipeDecision({ dx: -20, dy: 0, dt: 20 }), 0)
})

test('gesto diagonale o verticale non cambia sezione', () => {
  assert.equal(swipeDecision({ dx: -100, dy: 90, dt: 300 }), 0)
  assert.equal(swipeDecision({ dx: -10, dy: 200, dt: 300 }), 0)
  // al limite del rapporto 1,5: 90 / 60 = 1,5 -> valido
  assert.equal(swipeDecision({ dx: -90, dy: 60, dt: 300 }), 1)
})

test('nextIndex resta nei limiti, senza giro circolare', () => {
  assert.equal(nextIndex(0, -1, 3), 0)
  assert.equal(nextIndex(2, 1, 3), 2)
  assert.equal(nextIndex(1, 1, 3), 2)
  assert.equal(nextIndex(1, -1, 3), 0)
  assert.equal(nextIndex(0, 0, 3), 0)
})

test('dragOffset: resistenza solo oltre la prima e l\'ultima sezione', () => {
  assert.equal(dragOffset(90, 0, 3), 30) // tira a destra dalla prima
  assert.equal(dragOffset(-90, 2, 3), -30) // tira a sinistra dall'ultima
  assert.equal(dragOffset(90, 1, 3), 90)
  assert.equal(dragOffset(-90, 0, 3), -90) // dalla prima verso la successiva: nessuna resistenza
  assert.equal(dragOffset(90, 2, 3), 90)
})

test('startsInEdge: i 20 px dei bordi sono zona morta', () => {
  assert.equal(startsInEdge(5, 360), true)
  assert.equal(startsInEdge(19, 360), true)
  assert.equal(startsInEdge(20, 360), false)
  assert.equal(startsInEdge(340, 360), false)
  assert.equal(startsInEdge(341, 360), true)
})

test('axisLock: incerto sotto 10 px, poi x o y', () => {
  assert.equal(axisLock(5, 3), null)
  assert.equal(axisLock(20, 4), 'x')
  assert.equal(axisLock(4, 20), 'y')
  assert.equal(axisLock(15, 15), 'y') // diagonale pura: vince lo scroll verticale
})
