// Test dei motori di riproduzione con AudioContext ed elemento media finti.
// Esecuzione: node --test tests/frontend/engines.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createBufferEngine, createMediaEngine, engineKindFor, BUFFER_MAX_BYTES } from '../../frontend/src/lib/engines.js'

function fakeCtx() {
  const ctx = {
    currentTime: 0,
    state: 'running',
    destination: {},
    sources: [],
    gains: [],
    resume() {
      ctx.state = 'running'
    },
    createGain() {
      const g = { gain: { value: 1 }, connect() {}, disconnect() {} }
      ctx.gains.push(g)
      return g
    },
    createBufferSource() {
      const s = {
        loop: false, loopStart: 0, loopEnd: 0, onended: null, started: false, stopped: false,
        start(when, offset) { s.started = true; s.when = when; s.offset = offset },
        stop() { s.stopped = true },
        connect() {}, disconnect() {},
      }
      ctx.sources.push(s)
      return s
    },
  }
  return ctx
}

const engine = (seconds = 10) => {
  const ctx = fakeCtx()
  return { ctx, e: createBufferEngine({ ctx, buffer: { duration: seconds } }) }
}
const last = (ctx) => ctx.sources[ctx.sources.length - 1]

test('buffer: play, posizione, pausa e ripresa', async () => {
  const { ctx, e } = engine()
  await e.play()
  assert.equal(e.isPlaying(), true)
  assert.equal(last(ctx).offset, 0)
  ctx.currentTime = 2
  assert.equal(e.position(), 2000)
  e.pause()
  assert.equal(e.isPlaying(), false)
  ctx.currentTime = 9
  assert.equal(e.position(), 2000)                       // da fermo la posizione non avanza
  await e.play()
  assert.equal(last(ctx).offset, 2)                      // riprende da dove si era fermato
  assert.equal(ctx.sources.length, 2)
  assert.equal(ctx.sources[0].stopped, true)
})

test('buffer: loop A-B nativo e posizione che ripassa da A', async () => {
  const { ctx, e } = engine()
  e.setLoop({ a: 2000, b: 6000, active: true })
  e.seek(3000)
  await e.play()
  const s = last(ctx)
  assert.deepEqual([s.loop, s.loopStart, s.loopEnd, s.offset], [true, 2, 6, 3])
  ctx.currentTime = 4                                    // 3000 + 4000 = 7000 → oltre B di 1000
  assert.equal(e.position(), 3000)
  ctx.currentTime = 11                                   // 3000 + 11000 = 14000 → (14000−6000) % 4000 = 0
  assert.equal(e.position(), 2000)
})

test('buffer: partendo oltre B con il loop attivo si riparte da A', async () => {
  const { ctx, e } = engine()
  e.setLoop({ a: 2000, b: 6000, active: true })
  e.seek(8000)
  await e.play()
  assert.equal(last(ctx).offset, 2)
})

test('buffer: loop modificato durante la riproduzione, sullo stesso source', async () => {
  const { ctx, e } = engine()
  await e.play()
  ctx.currentTime = 1
  const s = last(ctx)
  e.setLoop({ a: 2000, b: 6000, active: true })
  assert.equal(last(ctx), s)                             // nessun riavvio: niente interruzioni mentre si trascinano le maniglie
  assert.deepEqual([s.loop, s.loopStart, s.loopEnd], [true, 2, 6])
  ctx.currentTime = 3
  assert.equal(e.position(), 3000)
  ctx.currentTime = 6                                    // 1000 + 5000 = 6000 = B → torna ad A
  assert.equal(e.position(), 2000)
  e.setLoop({ a: 2000, b: 6000, active: false })         // loop disattivato: prosegue oltre B
  assert.equal(s.loop, false)
  ctx.currentTime = 8                                    // a t=6 era in A (2000), poi 2 s senza loop
  assert.equal(e.position(), 4000)
})

test('buffer: se la posizione è oltre il nuovo B si riparte da A con un nuovo source', async () => {
  const { ctx, e } = engine()
  await e.play()
  ctx.currentTime = 7
  e.setLoop({ a: 2000, b: 6000, active: true })
  assert.equal(ctx.sources.length, 2)
  assert.equal(last(ctx).offset, 2)
  assert.equal(e.position(), 2000)
})

test('buffer: fine naturale → evento ended, e play riparte da capo', async () => {
  const { ctx, e } = engine()
  const events = []
  e.on('ended', () => events.push('ended'))
  e.on('pause', () => events.push('pause'))
  await e.play()
  ctx.currentTime = 10
  last(ctx).onended()
  assert.deepEqual(events, ['pause', 'ended'])
  assert.equal(e.isPlaying(), false)
  assert.equal(e.position(), 10000)
  await e.play()
  assert.equal(last(ctx).offset, 0)
  assert.equal(e.isPlaying(), true)
})

test('buffer: partenza ritardata (conteggio) → la posizione resta ferma finché non parte', async () => {
  const { ctx, e } = engine()
  ctx.currentTime = 5
  await e.play(0.5)
  assert.equal(last(ctx).when, 5.5)
  ctx.currentTime = 5.25
  assert.equal(e.position(), 0)
  ctx.currentTime = 6.5
  assert.equal(e.position(), 1000)
  ctx.currentTime = 5.1                                  // loop impostato durante l'attesa: non sposta la base dei tempi
  e.setLoop({ a: 0, b: 4000, active: true })
  ctx.currentTime = 6.5
  assert.equal(e.position(), 1000)
})

test('buffer: seek durante la riproduzione riavvia il source dalla nuova posizione', async () => {
  const { ctx, e } = engine()
  await e.play()
  const first = last(ctx)
  e.seek(4500)
  assert.equal(first.stopped, true)
  assert.equal(last(ctx).offset, 4.5)
  e.seek(99999)
  assert.equal(e.position() <= 10000, true)
  e.pause()
  e.seek(-5)
  assert.equal(e.position(), 0)
})

test('buffer: volume limitato a 0-1, durata e destroy', async () => {
  const { ctx, e } = engine(12)
  e.setVolume(3)
  assert.equal(ctx.gains[0].gain.value, 1)
  e.setVolume(-1)
  assert.equal(ctx.gains[0].gain.value, 0)
  assert.equal(e.duration(), 12000)
  await e.play()
  e.destroy()
  assert.equal(e.isPlaying(), false)
  assert.equal(last(ctx).stopped, true)
})

test('buffer: ctx sospeso viene riattivato dal play', async () => {
  const { ctx, e } = engine()
  ctx.state = 'suspended'
  await e.play()
  assert.equal(ctx.state, 'running')
})

// ── motore a elemento media ─────────────────────────────────────────────────

function fakeEl() {
  const listeners = {}
  const el = {
    currentTime: 0, duration: 10, paused: true, ended: false, volume: 1, plays: 0,
    addEventListener(n, f) { (listeners[n] ||= new Set()).add(f) },
    removeEventListener(n, f) { listeners[n]?.delete(f) },
    fire(n) { listeners[n]?.forEach((f) => f()) },
    play() { el.plays++; el.paused = false; el.fire('play'); return Promise.resolve() },
    pause() { el.paused = true; el.fire('pause') },
    listeners,
  }
  return el
}

function manualRaf() {
  const queue = []
  return { raf: (fn) => queue.push(fn), caf() { queue.length = 0 }, run() { const q = queue.splice(0); q.forEach((fn) => fn()) }, queue }
}

test('media: con il loop attivo il cursore torna ad A vicino a B', async () => {
  const el = fakeEl()
  const r = manualRaf()
  const e = createMediaEngine(el, r)
  e.setLoop({ a: 2000, b: 6000, active: true })
  el.currentTime = 3
  await e.play()
  r.run()
  assert.equal(el.currentTime, 3)                        // lontano da B: nessun salto
  el.currentTime = 5.98
  r.run()
  assert.equal(el.currentTime, 2)                        // entro 30 ms da B: salta ad A
  assert.equal(r.queue.length, 1)                        // il controllo continua finché si suona
  e.pause()
  r.run()
  assert.equal(r.queue.length, 0)                        // in pausa non rischedula
})

test('media: senza loop non salta; fine contenuto → ended, con loop → riparte da A', async () => {
  const el = fakeEl()
  const r = manualRaf()
  const e = createMediaEngine(el, r)
  let ended = 0
  e.on('ended', () => ended++)
  await e.play()
  el.currentTime = 9.99
  r.run()
  assert.equal(el.currentTime, 9.99)
  el.paused = true
  el.ended = true
  el.fire('ended')
  assert.equal(ended, 1)
  e.setLoop({ a: 1000, b: 10000, active: true })
  el.fire('ended')
  assert.equal(ended, 1)                                 // niente ended: il loop riparte
  assert.equal(el.currentTime, 1)
  assert.equal(el.plays, 2)
})

test('media: posizione, durata, seek, volume, partenza ritardata e destroy', async () => {
  const el = fakeEl()
  const r = manualRaf()
  const e = createMediaEngine(el, r)
  e.seek(4000)
  assert.equal(el.currentTime, 4)
  assert.equal(e.position(), 4000)
  e.seek(99999)
  assert.equal(el.currentTime, 10)
  assert.equal(e.duration(), 10000)
  el.duration = NaN
  assert.equal(e.duration(), 0)
  e.setVolume(5)
  assert.equal(el.volume, 1)
  el.duration = 10
  e.play(0.02)                                           // ritardata: prima non suona
  assert.equal(el.plays, 0)
  await new Promise((res) => setTimeout(res, 60))
  assert.equal(el.plays, 1)
  assert.equal(e.isPlaying(), true)
  const delayed = createMediaEngine(fakeEl(), r)
  delayed.play(5)
  delayed.pause()                                        // la pausa annulla la partenza ritardata
  e.destroy()
  assert.equal(el.listeners.play.size, 0)
})

test('engineKindFor: buffer per gli audio non enormi, media per video e file grandi', () => {
  assert.equal(engineKindFor({ kind: 'audio', size: 5e6 }), 'buffer')
  assert.equal(engineKindFor({ kind: 'audio', size: BUFFER_MAX_BYTES }), 'buffer')
  assert.equal(engineKindFor({ kind: 'audio', size: BUFFER_MAX_BYTES + 1 }), 'media')
  assert.equal(engineKindFor({ kind: 'video', size: 1 }), 'media')
})
