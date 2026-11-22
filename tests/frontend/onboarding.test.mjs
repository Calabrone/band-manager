// Test della guida "Primi passi". Esecuzione: node --test tests/frontend/onboarding.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  STEPS, initialState, isComplete, load, markDone, markNotApplicable, nextStep, progress, resolveTarget, restart,
  serialize, showsBadge, showsWelcome, skip,
} from '../../frontend/src/lib/onboarding.js'

const T0 = '2026-11-22T10:00:00.000Z'
const T1 = '2026-11-22T11:00:00.000Z'

function doneAll(state, except = []) {
  return STEPS.reduce((s, st) => (except.includes(st.id) ? s : markDone(s, st.id, T0)), state)
}

test('stato iniziale: tutto da fare, 12 passi in 2 gruppi', () => {
  const s = initialState()
  assert.equal(STEPS.length, 12)
  assert.deepEqual(progress(s), { done: 0, total: 12, percent: 0 })
  assert.deepEqual(progress(s, 'repertorio'), { done: 0, total: 5, percent: 0 })
  assert.deepEqual(progress(s, 'prove'), { done: 0, total: 7, percent: 0 })
  assert.equal(showsWelcome(s), true)
  assert.equal(showsBadge(s), true)
  assert.equal(nextStep(s).id, 'propose')
})

test('markDone è idempotente e mantiene la prima data', () => {
  const a = markDone(initialState(), 'swipe', T0)
  const b = markDone(a, 'swipe', T1)
  assert.equal(b, a)
  assert.equal(b.done.swipe, T0)
  assert.equal(markDone(a, 'inesistente', T0), a)
})

test('progress per gruppo e nextStep seguono i passi fatti', () => {
  let s = markDone(initialState(), 'propose', T0)
  s = markDone(s, 'swipe', T0)
  assert.deepEqual(progress(s, 'repertorio'), { done: 2, total: 5, percent: 40 })
  assert.deepEqual(progress(s), { done: 2, total: 12, percent: 17 })
  assert.equal(nextStep(s).id, 'move')
})

test('completamento: tutti i passi -> completedAt, niente più pallino', () => {
  const almost = doneAll(initialState(), ['status'])
  assert.equal(almost.completedAt, null)
  assert.equal(isComplete(almost), false)
  const full = markDone(almost, 'status', T1)
  assert.equal(full.completedAt, T1)
  assert.equal(isComplete(full), true)
  assert.equal(showsBadge(full), false)
  assert.equal(nextStep(full), null)
})

test('"non mi riguarda" solo sul passo opzionale, e conta per il completamento', () => {
  const almost = doneAll(initialState(), ['status'])
  assert.equal(markNotApplicable(almost, 'loop', T1), almost) // non opzionale: ignorato
  const na = markNotApplicable(almost, 'status', T1)
  assert.equal(na.completedAt, T1)
  assert.deepEqual(progress(na, 'prove'), { done: 6, total: 6, percent: 100 })
})

test('skip: nasconde benvenuto e pallino, ma i passi restano', () => {
  const s = skip(markDone(initialState(), 'propose', T0))
  assert.equal(showsWelcome(s), false)
  assert.equal(showsBadge(s), false)
  assert.equal(progress(s).done, 1)
})

test('restart: azzera i passi ma non rimostra il benvenuto', () => {
  const s = restart()
  assert.equal(progress(s).done, 0)
  assert.equal(showsWelcome(s), false)
  assert.equal(showsBadge(s), true)
})

test('resolveTarget: rotte concrete', () => {
  const ctx = { lastSongId: 7, lastProjectId: 3, lastTakeId: 9 }
  const get = (id) => STEPS.find((s) => s.id === id)
  assert.deepEqual(resolveTarget(get('propose'), ctx), { route: '/', missing: null })
  assert.deepEqual(resolveTarget(get('like'), ctx), { route: '/songs/7', missing: null })
  assert.deepEqual(resolveTarget(get('take'), ctx), { route: '/studio/3', missing: null })
  assert.deepEqual(resolveTarget(get('marker'), ctx), { route: '/studio/3/takes/9', missing: null })
})

test('resolveTarget: prerequisiti mancanti portano al passo che li crea', () => {
  const get = (id) => STEPS.find((s) => s.id === id)
  assert.equal(resolveTarget(get('like'), {}).missing, 'song')
  assert.equal(resolveTarget(get('like'), {}).route, '/')
  assert.equal(resolveTarget(get('take'), {}).missing, 'project')
  assert.equal(resolveTarget(get('take'), {}).route, '/studio')
  const noTake = resolveTarget(get('loop'), { lastProjectId: 3 })
  assert.equal(noTake.missing, 'take')
  assert.equal(noTake.route, '/studio/3')
  assert.equal(resolveTarget(get('loop'), {}).missing, 'project')
})

test('serialize/load: round trip', () => {
  const s = markDone(skip(initialState()), 'like', T0)
  assert.deepEqual(load(serialize(s)), s)
})

test('load è tollerante: JSON rotto, versione diversa, campi strani', () => {
  assert.deepEqual(load(null), initialState())
  assert.deepEqual(load('{non json'), initialState())
  assert.deepEqual(load(JSON.stringify({ v: 99, done: { like: T0 } })), initialState())
  assert.deepEqual(load('42'), initialState())
  const odd = load(JSON.stringify({ v: 1, done: { like: T0, fantasma: T0 }, notApplicable: 'x', skipped: 'sì', completedAt: 5 }))
  assert.deepEqual(odd.done, { like: T0 })
  assert.deepEqual(odd.notApplicable, {})
  assert.equal(odd.skipped, false)
  assert.equal(odd.completedAt, null)
})
