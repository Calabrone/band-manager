// Test delle notifiche lato client. Esecuzione: node --test tests/frontend/push.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { urlB64ToUint8Array, bytesToUrlB64, pushSupport, detectEnv } from '../../frontend/src/lib/push.js'
import { parseServerDate, timeAgo, dayLabel, groupByDay, splitTitle } from '../../frontend/src/lib/timeAgo.js'

test('urlB64ToUint8Array e bytesToUrlB64 sono inverse (con e senza padding, - e _)', () => {
  const key = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'
  const bytes = urlB64ToUint8Array(key)
  assert.equal(bytes.length, 65)
  assert.equal(bytes[0], 4)
  assert.equal(bytesToUrlB64(bytes), key)
  assert.equal(bytesToUrlB64(bytes.buffer), key)
  assert.deepEqual([...urlB64ToUint8Array('_-8')], [0xff, 0xef])
  assert.deepEqual([...urlB64ToUint8Array('AQ==')], [1])
})

const OK = { hasSW: true, hasPush: true, hasNotification: true, isIOS: false, standalone: false, permission: 'default' }

test('pushSupport: tutti i rami', () => {
  assert.equal(pushSupport(OK), 'ok')
  assert.equal(pushSupport({ ...OK, permission: 'granted' }), 'ok')
  assert.equal(pushSupport({ ...OK, permission: 'denied' }), 'denied')
  assert.equal(pushSupport({ ...OK, hasPush: false }), 'unsupported')
  assert.equal(pushSupport({ ...OK, hasSW: false }), 'unsupported')
  assert.equal(pushSupport({ ...OK, hasNotification: false }), 'unsupported')
  // iPhone da Safari: prima di tutto serve l'installazione, anche se Push API manca
  assert.equal(pushSupport({ ...OK, isIOS: true, hasPush: false, hasNotification: false }), 'ios-install')
  assert.equal(pushSupport({ ...OK, isIOS: true, standalone: true }), 'ok')
  assert.equal(pushSupport({ ...OK, isIOS: true, standalone: true, hasPush: false }), 'unsupported')
})

test('detectEnv riconosce iPhone, iPad (come Mac con touch) e standalone', () => {
  const win = (ua, extra = {}) => ({
    navigator: { userAgent: ua, maxTouchPoints: 0, serviceWorker: {}, ...extra.nav },
    matchMedia: () => ({ matches: Boolean(extra.standalone) }),
    ...(extra.push ? { PushManager: function () {}, Notification: { permission: 'granted' } } : {}),
  })
  const iphone = detectEnv(win('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'))
  assert.equal(iphone.isIOS, true)
  assert.equal(iphone.standalone, false)
  assert.equal(pushSupport(iphone), 'ios-install')
  const ipad = detectEnv(win('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', { nav: { maxTouchPoints: 5 }, standalone: true, push: true }))
  assert.equal(ipad.isIOS, true)
  assert.equal(pushSupport(ipad), 'ok')
  const mac = detectEnv(win('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', { push: true }))
  assert.equal(mac.isIOS, false)
  assert.equal(mac.permission, 'granted')
  assert.equal(pushSupport(mac), 'ok')
  const android = detectEnv(win('Mozilla/5.0 (Linux; Android 14)', { push: true }))
  assert.equal(pushSupport(android), 'ok')
})

test('parseServerDate: UTC senza fuso, microsecondi, spazio', () => {
  assert.equal(parseServerDate('2026-11-22T10:15:00.123456').toISOString(), '2026-11-22T10:15:00.123Z')
  assert.equal(parseServerDate('2026-11-22 10:15:00').toISOString(), '2026-11-22T10:15:00.000Z')
  assert.equal(parseServerDate('2026-11-22T10:15:00Z').toISOString(), '2026-11-22T10:15:00.000Z')
  assert.ok(Number.isNaN(parseServerDate(null).getTime()))
})

test('timeAgo', () => {
  const now = new Date(2026, 10, 22, 15, 0, 0)
  const ago = (ms) => new Date(now - ms)
  assert.equal(timeAgo(ago(20e3), now), 'adesso')
  assert.equal(timeAgo(ago(5 * 60e3), now), '5 min fa')
  assert.equal(timeAgo(ago(3 * 3600e3), now), '3 h fa')
  assert.equal(timeAgo(new Date(2026, 10, 21, 23, 0), now), 'ieri')
  assert.equal(timeAgo(new Date(2026, 10, 18, 9, 0), now), '4 giorni fa')
  assert.equal(timeAgo(new Date(2026, 9, 3, 9, 0), now), '3 ott')
  assert.equal(timeAgo(new Date(2025, 9, 3, 9, 0), now), '3 ott 2025')
  assert.equal(timeAgo('non una data', now), '')
})

test('dayLabel e groupByDay', () => {
  const now = new Date(2026, 10, 22, 15, 0, 0)          // domenica 22 novembre
  const iso = (d) => d.toISOString().replace('Z', '')
  assert.equal(dayLabel(new Date(2026, 10, 22, 1, 0), now), 'Oggi')
  assert.equal(dayLabel(new Date(2026, 10, 21, 23, 0), now), 'Ieri')
  assert.equal(dayLabel(new Date(2026, 10, 16, 12, 0), now), 'lunedì 16 novembre')
  const items = [
    { id: 3, updated_at: iso(new Date(2026, 10, 22, 14, 0)) },
    { id: 2, updated_at: iso(new Date(2026, 10, 22, 9, 0)) },
    { id: 1, updated_at: iso(new Date(2026, 10, 20, 9, 0)) },
  ]
  const groups = groupByDay(items, now)
  assert.deepEqual(groups.map((g) => [g.label, g.items.map((i) => i.id)]), [['Oggi', [3, 2]], ['venerdì 20 novembre', [1]]])
})

test('splitTitle separa i titoli tra «»', () => {
  assert.deepEqual(splitTitle('Marco ha commentato «Wonderwall»'), [
    { text: 'Marco ha commentato ', title: false },
    { text: 'Wonderwall', title: true },
  ])
  assert.deepEqual(splitTitle('Marco ha aggiunto 3 brani'), [{ text: 'Marco ha aggiunto 3 brani', title: false }])
  assert.deepEqual(splitTitle('«A» e «B»!').map((p) => p.title), [true, false, true, false])
})
